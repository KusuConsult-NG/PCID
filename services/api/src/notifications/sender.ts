import type { NotificationChannel } from '@pcid/contracts';

/** One message, as a gateway receives it. */
export interface OutboundMessage {
  readonly notificationId: string;
  readonly channel: NotificationChannel;
  /** Telephone number, email address or device token, per channel. */
  readonly address: string;
  readonly subject: string | null;
  /**
   * What actually goes out.
   *
   * For an external channel this is the template's notice and nothing else: no
   * name, no reference, no description of what happened. See
   * `@pcid/contracts/notifications` for why.
   */
  readonly body: string;
}

export type SendOutcome =
  | { readonly outcome: 'SENT'; readonly providerReference: string | null }
  /**
   * The gateway refused and will refuse again: a malformed number, a blocked
   * address, an account that does not exist. Retrying is pointless and looks to
   * an operator like a transient problem that is not clearing.
   */
  | { readonly outcome: 'PERMANENT_FAILURE'; readonly detail: string }
  /** Timeout, 5xx, rate limit. Worth another attempt later. */
  | { readonly outcome: 'TRANSIENT_FAILURE'; readonly detail: string };

/**
 * The contract every delivery gateway is reached through (§54, §78).
 *
 * The same shape as the integration adapters, for the same reason: one
 * interface, two kinds of implementation. A production sender talks to the
 * state's SMS or email gateway under configuration; the logging sender writes
 * to the operator log and is refused outright in production.
 *
 * A sender receives an address and a body. It is given no PCID, no record, and
 * no template context, so there is no path by which a gateway integration can
 * quietly start sending more than the body it was handed.
 */
export interface NotificationSender {
  readonly channel: NotificationChannel;
  readonly mode: 'PRODUCTION' | 'SANDBOX';
  send(message: OutboundMessage): Promise<SendOutcome>;
}
