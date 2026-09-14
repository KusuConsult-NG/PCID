import { Inject, Injectable } from '@nestjs/common';
import type { NotificationChannel } from '@pcid/contracts';
import { isExternalChannel } from '@pcid/contracts';

import { logger } from '../common/logger';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { Database } from '../database/pool';
import { GatewaySender } from './senders/gateway.sender';
import { LoggingSender } from './senders/logging.sender';
import type { NotificationSender, SendOutcome } from './sender';

interface ClaimedRow {
  id: string;
  channel: NotificationChannel;
  recipient_address: string | null;
  subject: string | null;
  body: string;
  attempts: number;
}

export interface SweepResult {
  readonly claimed: number;
  readonly sent: number;
  readonly failed: number;
  readonly abandoned: number;
}

/**
 * The worker that drains the notification queue (master system prompt §33, §58).
 *
 * Four properties it is built for:
 *
 * **It never sends the same thing twice.** A sweep claims rows with
 * `FOR UPDATE SKIP LOCKED` and moves them to `SENDING` in the same transaction,
 * so two workers - or two instances of one - never take the same message. A
 * process that dies mid-send leaves a row in `SENDING`; `next_attempt_at` is
 * what brings it back, rather than a lock nobody is left to clear.
 *
 * **It gives up.** Five attempts with exponential backoff, then `FAILED` and it
 * stops. A queue that retries for ever is a queue whose depth means nothing, and
 * an operator who cannot tell a backlog from a permanently broken number stops
 * looking at either.
 *
 * **It tells a retryable failure from a final one.** A timeout is worth another
 * attempt; a gateway saying the number is malformed is not, and sending it forty
 * more times produces forty more rejections.
 *
 * **It carries what the template allowed and nothing more.** The body was
 * decided when the notification was enqueued, and this worker does not compose,
 * interpolate or enrich. It reads a row and hands a sender an address and a
 * string.
 */
@Injectable()
export class NotificationDeliveryWorker {
  private readonly senders = new Map<NotificationChannel, NotificationSender>();

  constructor(
    private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * One pass over the queue.
   *
   * Returns what it did so a scheduler, a test or an operator command can say
   * so. Sweeping is deliberately a plain method rather than a timer inside the
   * class: what schedules it is the caller's decision, and a test that has to
   * wait for a timer is a test that is sometimes flaky.
   */
  async sweep(batchSize = 25): Promise<SweepResult> {
    const claimed = await this.claim(batchSize);
    let sent = 0;
    let failed = 0;
    let abandoned = 0;

    for (const row of claimed) {
      const outcome = await this.deliver(row);
      if (outcome.outcome === 'SENT') {
        sent += 1;
        await this.recordSent(row, outcome);
        continue;
      }

      const attempt = row.attempts + 1;
      const final = outcome.outcome === 'PERMANENT_FAILURE' || attempt >= this.maxAttempts;
      if (final) abandoned += 1;
      else failed += 1;
      await this.recordFailure(row, outcome.detail, attempt, final);
    }

    if (claimed.length > 0) {
      logger.info('notification_sweep', {
        claimed: claimed.length,
        sent,
        failed,
        abandoned,
      });
    }
    return { claimed: claimed.length, sent, failed, abandoned };
  }

  private get maxAttempts(): number {
    return this.env.NOTIFICATION_MAX_ATTEMPTS;
  }

  /**
   * Take a batch, and take it exclusively.
   *
   * `SENDING` rows are reclaimed once their `next_attempt_at` has passed, which
   * is how a worker that was killed between the claim and the send stops being
   * a message that is never delivered and never reported.
   */
  private async claim(batchSize: number): Promise<ClaimedRow[]> {
    return this.db.transaction(async (runner) => {
      const rows = await runner.query<{ id: string }>(
        `SELECT id FROM notification
          WHERE status IN ('QUEUED','SENDING')
            AND next_attempt_at <= now()
          ORDER BY next_attempt_at
          LIMIT $1
          FOR UPDATE SKIP LOCKED`,
        [batchSize],
      );
      if (rows.length === 0) return [];

      const ids = rows.map((row) => row.id);
      return runner.query<ClaimedRow>(
        `UPDATE notification
            SET status = 'SENDING',
                -- The visibility timeout: if this process dies now, the row
                -- becomes claimable again rather than being stuck in SENDING.
                next_attempt_at = now() + make_interval(secs => $2)
          WHERE id = ANY($1::uuid[])
          RETURNING id, channel, recipient_address, subject, body, attempts`,
        [ids, this.env.NOTIFICATION_VISIBILITY_TIMEOUT_SECONDS],
      );
    });
  }

  private async deliver(row: ClaimedRow): Promise<SendOutcome> {
    // Inside the platform a notification is delivered by existing: the resident
    // reads it in their portal inbox. There is no gateway and nothing to fail.
    if (!isExternalChannel(row.channel)) {
      return { outcome: 'SENT', providerReference: null };
    }
    if (row.recipient_address === null || row.recipient_address.trim() === '') {
      return { outcome: 'PERMANENT_FAILURE', detail: 'no address on the notification' };
    }

    const sender = this.senderFor(row.channel);
    if (sender === null) {
      return {
        outcome: 'PERMANENT_FAILURE',
        detail: `no sender configured for ${row.channel}`,
      };
    }

    try {
      return await sender.send({
        notificationId: row.id,
        channel: row.channel,
        address: row.recipient_address,
        subject: row.subject,
        body: row.body,
      });
    } catch (error) {
      // A sender that throws is a sender with a bug. It must not take the sweep
      // down with it, or one bad gateway stops every other channel.
      return {
        outcome: 'TRANSIENT_FAILURE',
        detail: error instanceof Error ? error.name : 'sender threw',
      };
    }
  }

  /**
   * The sender for a channel, built once.
   *
   * A sandbox sender is refused outright when `ALLOW_SANDBOX_ADAPTERS` is false,
   * which is enforced in production by configuration (§77, §78). Without that, a
   * production deployment that forgot to configure a gateway would log every
   * message and report a hundred per cent delivery.
   */
  senderFor(channel: NotificationChannel): NotificationSender | null {
    const existing = this.senders.get(channel);
    if (existing !== undefined) return existing;

    const url = this.gatewayUrl(channel);
    if (url !== null) {
      const sender = new GatewaySender(channel, {
        url,
        token: this.env.NOTIFICATION_GATEWAY_TOKEN ?? null,
        timeoutMs: this.env.NOTIFICATION_GATEWAY_TIMEOUT_MS,
      });
      this.senders.set(channel, sender);
      return sender;
    }

    if (!this.env.ALLOW_SANDBOX_ADAPTERS) return null;
    const sender = new LoggingSender(channel);
    this.senders.set(channel, sender);
    return sender;
  }

  private gatewayUrl(channel: NotificationChannel): string | null {
    switch (channel) {
      case 'SMS':
        return this.env.SMS_GATEWAY_URL ?? null;
      case 'EMAIL':
        return this.env.EMAIL_GATEWAY_URL ?? null;
      case 'PUSH':
        return this.env.PUSH_GATEWAY_URL ?? null;
      default:
        return null;
    }
  }

  private async recordSent(row: ClaimedRow, outcome: SendOutcome): Promise<void> {
    const attempt = row.attempts + 1;
    await this.db.transaction(async (runner) => {
      await runner.query(
        `UPDATE notification
            SET status = 'SENT', attempts = $2, sent_at = now(), last_error = NULL
          WHERE id = $1`,
        [row.id, attempt],
      );
      await runner.query(
        `INSERT INTO notification_delivery_attempt
           (notification_id, attempt, channel, outcome, provider_reference)
         VALUES ($1,$2,$3,'SENT',$4)
         ON CONFLICT (notification_id, attempt) DO NOTHING`,
        [
          row.id,
          attempt,
          row.channel,
          outcome.outcome === 'SENT' ? outcome.providerReference : null,
        ],
      );
    });
  }

  private async recordFailure(
    row: ClaimedRow,
    detail: string,
    attempt: number,
    final: boolean,
  ): Promise<void> {
    await this.db.transaction(async (runner) => {
      await runner.query(
        `UPDATE notification
            SET status = $3,
                attempts = $2,
                last_error = $4,
                next_attempt_at = CASE WHEN $3 = 'FAILED' THEN next_attempt_at
                                       ELSE now() + make_interval(secs => $5) END
          WHERE id = $1`,
        [
          row.id,
          attempt,
          final ? 'FAILED' : 'QUEUED',
          detail.slice(0, 500),
          backoffSeconds(attempt),
        ],
      );
      await runner.query(
        `INSERT INTO notification_delivery_attempt
           (notification_id, attempt, channel, outcome, detail)
         VALUES ($1,$2,$3,'FAILED',$4)
         ON CONFLICT (notification_id, attempt) DO NOTHING`,
        [row.id, attempt, row.channel, detail.slice(0, 500)],
      );
    });
  }
}

/**
 * Exponential backoff, capped.
 *
 * 30s, 2m, 8m, 32m, then no further attempt. The cap matters more than the
 * curve: a gateway that has been down for an hour does not need a worker
 * hammering it, and a message that has waited half an hour is already late
 * enough that another doubling changes nothing for the recipient.
 */
export function backoffSeconds(attempt: number): number {
  const seconds = 30 * 4 ** Math.max(0, attempt - 1);
  return Math.min(seconds, 30 * 60);
}
