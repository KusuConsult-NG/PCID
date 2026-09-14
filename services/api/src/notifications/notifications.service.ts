import { Inject, Injectable } from '@nestjs/common';
import type { Classification, NotificationChannel, NotificationTemplate } from '@pcid/contracts';
import {
  channelsFor,
  isExternalChannel,
  notificationTemplate,
  rankDominates,
} from '@pcid/contracts';

import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { Database } from '../database/pool';
import type { QueryRunner } from '../database/pool';

export type RecipientType = 'CITIZEN' | 'GOVERNMENT_USER' | 'AGENCY' | 'RESPONSE_UNIT';

export interface EnqueueInput {
  readonly template: NotificationTemplate;
  readonly recipientType: RecipientType;
  readonly recipientId: string;
  /** The subject line and sentence a resident reads *in the portal*. */
  readonly subject: string;
  readonly detail: string;
  /**
   * Channels to try, narrowed to what the template permits.
   *
   * Omit to use the template's own list, which is the ordinary case: a producer
   * deciding channel by channel is a producer that will one day decide wrongly.
   */
  readonly channels?: readonly NotificationChannel[];
  readonly alertId?: string | null;
  readonly incidentId?: string | null;
  /**
   * Makes the enqueue idempotent.
   *
   * A producer that is retried - a request replayed, a sync run twice - passes
   * the same key and the second attempt writes nothing.
   */
  readonly dedupeKey?: string | null;
}

export interface EnqueueResult {
  readonly queued: readonly { id: string; channel: NotificationChannel }[];
  readonly suppressed: readonly { channel: NotificationChannel; reason: string }[];
}

/**
 * The one place a notification is created (master system prompt §33, §58).
 *
 * Every producer went straight to `INSERT INTO notification` before this, each
 * choosing its own channel and writing its own body, which is how a detail
 * intended for a portal inbox ends up in an SMS. This service is the choke
 * point: the template decides which channels are allowed at all, and what each
 * of them is allowed to carry.
 *
 * The rule it enforces:
 *
 * - Inside the platform - `IN_APP`, `DASHBOARD` - the message carries the
 *   detail, because it is read behind authentication by the person it is about.
 * - Outside - `SMS`, `EMAIL`, `PUSH` - it carries the template's notice and
 *   nothing else. No name, no reference, no description of what happened. An
 *   SMS is read on a lock screen by whoever is holding the handset, at a number
 *   that may have been reassigned since the resident gave it.
 *
 * A resident is not told less as a result. They are told in the place where
 * being told is safe, and nudged to go there.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async enqueue(input: EnqueueInput, runner: QueryRunner = this.db): Promise<EnqueueResult> {
    const definition = notificationTemplate(input.template);
    const requested = input.channels ?? channelsFor(input.template);
    const permitted = requested.filter((channel) => definition.channels.includes(channel));

    const queued: { id: string; channel: NotificationChannel }[] = [];
    const suppressed: { channel: NotificationChannel; reason: string }[] = [];

    for (const channel of permitted) {
      const address = await this.addressFor(
        input.recipientType,
        input.recipientId,
        channel,
        runner,
      );

      if (address.reason !== null) {
        suppressed.push({ channel, reason: address.reason });
        await this.recordSuppressed(
          input,
          channel,
          address.reason,
          definition.classification,
          runner,
        );
        continue;
      }

      const body = isExternalChannel(channel) ? definition.notice : input.detail;
      const subject = isExternalChannel(channel) ? definition.notice : input.subject;

      const row = await runner.queryOne<{ id: string }>(
        `INSERT INTO notification (
           channel, recipient_type, recipient_id, recipient_address, subject, body,
           alert_id, incident_id, classification, template_key, dedupe_key, status, next_attempt_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'QUEUED', now())
         ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
         RETURNING id`,
        [
          channel,
          input.recipientType,
          input.recipientId,
          address.value,
          subject,
          body,
          input.alertId ?? null,
          input.incidentId ?? null,
          definition.classification,
          input.template,
          keyFor(input.dedupeKey, channel),
        ],
      );
      if (row === null) {
        // The unique index refused it: this exact message is already queued.
        suppressed.push({ channel, reason: 'DUPLICATE' });
        continue;
      }
      queued.push({ id: row.id, channel });
    }

    return { queued, suppressed };
  }

  /**
   * Where a message would go, and why it cannot.
   *
   * `IN_APP` and `DASHBOARD` are delivered by existing: the recipient reads them
   * in the portal, so there is no address to resolve and nothing to fail.
   */
  private async addressFor(
    recipientType: RecipientType,
    recipientId: string,
    channel: NotificationChannel,
    runner: QueryRunner,
  ): Promise<{ value: string | null; reason: string | null }> {
    if (!isExternalChannel(channel)) return { value: null, reason: null };

    if (recipientType === 'CITIZEN') {
      const row = await runner.queryOne<{
        phone_primary: string | null;
        email: string | null;
        status: string;
      }>('SELECT phone_primary, email, status FROM citizen WHERE pcid = $1', [recipientId]);
      if (row === null) return { value: null, reason: 'RECIPIENT_INACTIVE' };
      if (row.status !== 'ACTIVE') return { value: null, reason: 'RECIPIENT_INACTIVE' };
      const value = channel === 'SMS' ? row.phone_primary : row.email;
      return value === null || value.trim() === ''
        ? { value: null, reason: 'NO_ADDRESS' }
        : { value, reason: null };
    }

    if (recipientType === 'GOVERNMENT_USER') {
      const row = await runner.queryOne<{ email: string; status: string }>(
        'SELECT email, status FROM government_user WHERE id = $1',
        [recipientId],
      );
      if (row === null || row.status !== 'ACTIVE') {
        return { value: null, reason: 'RECIPIENT_INACTIVE' };
      }
      // No telephone number is held for officers, by design: the platform has
      // no reason to hold one and an SMS to an officer says nothing an email
      // would not.
      if (channel !== 'EMAIL') return { value: null, reason: 'NO_ADDRESS' };
      return { value: row.email, reason: null };
    }

    // Agencies and response units are reached through the people in them.
    return { value: null, reason: 'NO_ADDRESS' };
  }

  private async recordSuppressed(
    input: EnqueueInput,
    channel: NotificationChannel,
    reason: string,
    classification: Classification,
    runner: QueryRunner,
  ): Promise<void> {
    // Recorded rather than dropped. "Nothing was sent because we hold no
    // telephone number for this resident" is an answer somebody will need, and
    // a queue that silently discards is a queue that cannot be audited.
    await runner.query(
      `INSERT INTO notification (
         channel, recipient_type, recipient_id, subject, body, classification,
         template_key, status, suppressed_reason, next_attempt_at, dedupe_key
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'SUPPRESSED',$8, now(), $9)
       ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
      [
        channel,
        input.recipientType,
        input.recipientId,
        notificationTemplate(input.template).notice,
        notificationTemplate(input.template).notice,
        classification,
        input.template,
        reason,
        keyFor(input.dedupeKey, channel),
      ],
    );
  }

  /**
   * Whether a channel may carry the detail rather than the notice.
   *
   * Exported through the service so the rule is stated once and testable. It is
   * deliberately not "is the channel encrypted": an encrypted channel to a
   * handset on a table in front of other people is still a broadcast.
   */
  static carriesDetail(channel: NotificationChannel, classification: Classification): boolean {
    if (isExternalChannel(channel)) return false;
    // Inside the platform, the ordinary classification rules still apply.
    return rankDominates('HIGHLY_RESTRICTED', classification);
  }

  /** Sandbox senders must not be constructible in production (§77, §78). */
  get sandboxAllowed(): boolean {
    return this.env.ALLOW_SANDBOX_ADAPTERS;
  }
}

function keyFor(dedupeKey: string | null | undefined, channel: NotificationChannel): string | null {
  return dedupeKey == null || dedupeKey === '' ? null : `${dedupeKey}:${channel}`;
}
