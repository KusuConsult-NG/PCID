import { Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../common/correlation';
import { AppError } from '../common/errors';
import { WhereBuilder } from '../common/sql';
import { Database } from '../database/pool';
import type { AuthenticatedActor } from '../iam/actor';
import { PolicyService } from '../policy/policy.service';
import { NotificationDeliveryWorker } from './delivery.worker';

/**
 * The operations view of the delivery queue (§33, §58, §76).
 *
 * It answers the questions an operator actually has - is anything stuck, which
 * channel is failing, how old is the oldest thing still waiting - and answers
 * none of the questions they should not be asking. No bodies, no subjects, no
 * recipient addresses, no recipient identifiers. A queue screen that showed
 * those would be a second copy of everybody's inbox, reachable by a technical
 * role that carries no entitlement to citizen data at all (§7).
 *
 * What it does show is the template key, which says what kind of message it was
 * without saying what it said, and that is the level an operational decision is
 * taken at.
 */
@Injectable()
export class NotificationOperationsService {
  constructor(
    private readonly db: Database,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly worker: NotificationDeliveryWorker,
  ) {}

  async queue(
    actor: AuthenticatedActor,
    filters: { channel?: string; status?: string },
    context: RequestContext,
  ): Promise<Record<string, unknown>> {
    await this.authorise(actor, context);

    const where = new WhereBuilder();
    if (filters.channel !== undefined) where.add('channel = ?', filters.channel);
    if (filters.status !== undefined) where.add('status = ?', filters.status);

    const [counts, oldest, abandoned, failures] = await Promise.all([
      this.db.query<{ channel: string; status: string; count: string }>(
        `SELECT channel, status, count(*)::text AS count
           FROM notification ${where.sql}
          GROUP BY channel, status
          ORDER BY channel, status`,
        where.params,
      ),
      this.db.queryOne<{ queued_at: Date | null }>(
        `SELECT min(queued_at) AS queued_at FROM notification
          WHERE status IN ('QUEUED','SENDING')`,
      ),
      this.db.query<{
        id: string;
        channel: string;
        template_key: string;
        attempts: number;
        last_error: string | null;
        queued_at: Date;
      }>(
        `SELECT id, channel, template_key, attempts, last_error, queued_at
           FROM notification
          WHERE status = 'FAILED'
          ORDER BY queued_at DESC
          LIMIT 50`,
      ),
      this.db.query<{ channel: string; detail: string | null; count: string }>(
        // Grouped, because "eleven of these and one of those" is the shape of an
        // operational problem and a list of eleven identical rows is not.
        `SELECT channel, detail, count(*)::text AS count
           FROM notification_delivery_attempt
          WHERE outcome = 'FAILED' AND attempted_at > now() - interval '24 hours'
          GROUP BY channel, detail
          ORDER BY count(*) DESC
          LIMIT 20`,
      ),
    ]);

    return {
      counts: counts.map((row) => ({
        channel: row.channel,
        status: row.status,
        count: Number(row.count),
      })),
      oldestWaitingAt: oldest?.queued_at?.toISOString() ?? null,
      abandoned: abandoned.map((row) => ({
        id: row.id,
        channel: row.channel,
        template: row.template_key,
        attempts: row.attempts,
        lastError: row.last_error,
        queuedAt: row.queued_at.toISOString(),
      })),
      failuresLast24Hours: failures.map((row) => ({
        channel: row.channel,
        detail: row.detail,
        count: Number(row.count),
      })),
    };
  }

  async retry(
    actor: AuthenticatedActor,
    notificationId: string,
    note: string,
    context: RequestContext,
  ): Promise<{ id: string; status: string }> {
    await this.authorise(actor, context, { notificationId });

    const row = await this.db.queryOne<{ id: string; template_key: string; channel: string }>(
      `UPDATE notification
          SET status = 'QUEUED', attempts = 0, next_attempt_at = now(), last_error = NULL
        WHERE id = $1 AND status = 'FAILED'
        RETURNING id, template_key, channel`,
      [notificationId],
    );
    if (row === null) {
      throw AppError.notFoundOrNotPermitted(`no failed notification ${notificationId}`);
    }

    await this.audit.record({
      action: 'ADMIN_SYSTEM_MANAGE',
      outcome: 'PERMITTED',
      actorType: actor.subject.actorType,
      actorId: actor.subject.userId,
      actorDisplay: actor.displayName,
      agencyId: actor.subject.agencyId,
      agencyCode: actor.agencyCode,
      roles: actor.subject.roles,
      purpose: 'SYSTEM_ADMINISTRATION',
      resourceType: 'SYSTEM',
      resourceId: row.id,
      correlationId: context.correlationId,
      ipAddress: context.ipAddress,
      // The template and the channel, never the body: an audit record of an
      // operational act should not become a copy of the message.
      detail: { change: 'RETRY_QUEUED', template: row.template_key, channel: row.channel, note },
    });
    return { id: row.id, status: 'QUEUED' };
  }

  async sweepNow(
    actor: AuthenticatedActor,
    context: RequestContext,
  ): Promise<Record<string, unknown>> {
    await this.authorise(actor, context);
    const result = await this.worker.sweep();
    return { ...result };
  }

  private async authorise(
    actor: AuthenticatedActor,
    context: RequestContext,
    auditDetail?: Record<string, unknown>,
  ): Promise<void> {
    await this.policy.authorize({
      actor,
      action: 'ADMIN_SYSTEM_MANAGE',
      purpose: 'SYSTEM_ADMINISTRATION',
      resource: {
        type: 'SYSTEM',
        id: null,
        classification: 'INTERNAL',
        subjectPcid: null,
      },
      context,
      ...(auditDetail === undefined ? {} : { auditDetail }),
    });
  }
}
