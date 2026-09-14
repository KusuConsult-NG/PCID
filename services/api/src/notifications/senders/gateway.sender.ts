import type { NotificationChannel } from '@pcid/contracts';

import type { NotificationSender, OutboundMessage, SendOutcome } from '../sender';

export interface GatewayConfig {
  readonly url: string;
  /**
   * Sent as `Authorization: Bearer …`.
   *
   * Held in the environment and read at the point of use, like every other
   * secret here: it is never logged, never returned by a route, and never
   * stored on a notification row.
   */
  readonly token: string | null;
  readonly timeoutMs: number;
}

/**
 * The production sender: an HTTP POST to the state's messaging gateway.
 *
 * One shape for SMS, email and push, because that is what the gateways in use
 * here actually are - an HTTP endpoint that takes a destination and a body. A
 * gateway that needs something else gets its own sender rather than a flag on
 * this one.
 *
 * The distinction that matters is between a failure worth retrying and one that
 * is not. A timeout, a 429 or a 5xx is the network or the gateway having a bad
 * minute. A 4xx is the gateway telling us the destination is wrong, and sending
 * it again forty times produces forty identical rejections and an operator who
 * has stopped reading the queue.
 */
export class GatewaySender implements NotificationSender {
  readonly mode = 'PRODUCTION' as const;

  constructor(
    readonly channel: NotificationChannel,
    private readonly config: GatewayConfig,
  ) {}

  async send(message: OutboundMessage): Promise<SendOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(this.config.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(this.config.token === null ? {} : { authorization: `Bearer ${this.config.token}` }),
        },
        body: JSON.stringify({
          channel: message.channel,
          to: message.address,
          subject: message.subject,
          body: message.body,
          reference: message.notificationId,
        }),
        signal: controller.signal,
      });

      if (response.ok) {
        const reference = await providerReference(response);
        return { outcome: 'SENT', providerReference: reference };
      }
      if (response.status === 429 || response.status >= 500) {
        return {
          outcome: 'TRANSIENT_FAILURE',
          detail: `gateway responded ${response.status}`,
        };
      }
      return { outcome: 'PERMANENT_FAILURE', detail: `gateway rejected: ${response.status}` };
    } catch (error) {
      // A network error, a DNS failure or our own timeout. Never the message.
      return {
        outcome: 'TRANSIENT_FAILURE',
        detail: error instanceof Error ? error.name : 'send failed',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

async function providerReference(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { id?: unknown; reference?: unknown };
    const value = body.id ?? body.reference;
    return typeof value === 'string' ? value.slice(0, 128) : null;
  } catch {
    return null;
  }
}
