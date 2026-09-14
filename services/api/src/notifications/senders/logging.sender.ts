import type { NotificationChannel } from '@pcid/contracts';

import { logger } from '../../common/logger';
import type { NotificationSender, OutboundMessage, SendOutcome } from '../sender';

/**
 * The development and test sender.
 *
 * It writes what would have gone out and reports success. It is a sandbox
 * adapter in the §77/§78 sense and the factory refuses to construct it when
 * `ALLOW_SANDBOX_ADAPTERS` is false, so a production process cannot end up
 * silently "delivering" every message to a log file and reporting a hundred per
 * cent delivery rate.
 *
 * The body is logged and the address is not. That is not an arbitrary split:
 * a sender only ever receives the template's notice, which is a constant from
 * the catalogue and says nothing about anybody, whereas the address is a
 * resident's telephone number. Operator logs are not an audit trail and must
 * not become a second, unguarded copy of personal information.
 */
export class LoggingSender implements NotificationSender {
  readonly mode = 'SANDBOX' as const;

  constructor(readonly channel: NotificationChannel) {}

  async send(message: OutboundMessage): Promise<SendOutcome> {
    logger.info('notification_sent_sandbox', {
      notificationId: message.notificationId,
      channel: message.channel,
      address: redact(message.address),
      body: message.body,
    });
    return { outcome: 'SENT', providerReference: `sandbox:${message.notificationId}` };
  }
}

/** Enough to tell two fixtures apart, and not enough to be a phone number. */
function redact(address: string): string {
  return address.length <= 4 ? '…' : `…${address.slice(-3)}`;
}
