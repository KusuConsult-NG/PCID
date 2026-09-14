import { Injectable } from '@nestjs/common';
import { RETENTION_POLICIES, retentionPolicy } from '@pcid/contracts';
import type { RetentionPolicyKey } from '@pcid/contracts';

import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../common/correlation';
import { Database } from '../database/pool';
import type { AuthenticatedActor } from '../iam/actor';
import { PolicyService } from '../policy/policy.service';
import { RETENTION_RULES } from './retention.rules';
import { RetentionWorker } from './retention.worker';
import type { RetentionRunResult } from './retention.worker';

interface RunRow {
  id: string;
  reference: string;
  trigger: string;
  actor_type: string;
  actor_display: string | null;
  dry_run: boolean;
  status: string;
  rows_affected: number;
  more_remaining: boolean;
  error: string | null;
  started_at: Date;
  finished_at: Date | null;
}

interface ErasureRow {
  run_id: string;
  policy_key: string;
  disposition: string;
  table_name: string;
  cutoff: Date;
  rows_affected: number;
  capped: boolean;
}

/**
 * The retention schedule, as something a person can read and act on (§21, §68).
 *
 * The Data Protection Officer is the holder of `RETENTION_VIEW` and
 * `RETENTION_RUN`, and deliberately not a technical administrator: applying a
 * retention schedule is how the platform discharges storage limitation, and §7
 * is explicit that administering the servers confers no entitlement over
 * citizen data. Erasure is the most irreversible thing this platform does, and
 * the person answerable for it should be the person who can order it.
 *
 * Everything here is audited, including reading the schedule. That is not
 * ceremony: the schedule states, for every category of data the platform holds,
 * how long it is held and why, which is a map of the estate. Reading it is worth
 * a line in the trail for the same reason searching the register is.
 */
@Injectable()
export class RetentionService {
  constructor(
    private readonly db: Database,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly worker: RetentionWorker,
  ) {}

  /**
   * The schedule, and what is past its period right now.
   *
   * The two are on one response because they answer one question. A schedule
   * without the backlog beside it says what should happen; the backlog says
   * whether it is happening, and that is the part that was missing from this
   * platform for eleven phases.
   */
  async schedule(actor: AuthenticatedActor, context: RequestContext): Promise<unknown> {
    await this.policy.authorize({
      actor,
      action: 'RETENTION_VIEW',
      purpose: 'AUDIT_REVIEW',
      resource: { type: 'SYSTEM', id: null, classification: 'INTERNAL', subjectPcid: null },
      context,
      auditDetail: { view: 'RETENTION_SCHEDULE' },
    });

    const rules = new Map(RETENTION_RULES.map((rule) => [rule.policy, rule]));
    const due = new Map((await this.worker.due()).map((row) => [row.policy, row]));

    return {
      policies: RETENTION_POLICIES.map((policy) => {
        const rule = rules.get(policy.key) ?? null;
        const backlog = due.get(policy.key) ?? null;
        return {
          key: policy.key,
          holds: policy.holds,
          disposition: policy.disposition,
          retainDays: policy.retainDays,
          basis: policy.basis,
          redacts: policy.redacts ?? [],
          table: rule?.table ?? null,
          measuredFrom: rule?.measuredFrom ?? null,
          ...(backlog === null
            ? {}
            : { due: backlog.due, dueIsAtLeast: backlog.atLeast, cutoff: backlog.cutoff }),
        };
      }),
      lastRun: await this.lastRun(),
    };
  }

  /** What the sweeps have done, most recent first, with the per-policy counts. */
  async history(
    actor: AuthenticatedActor,
    options: { limit: number; offset: number },
    context: RequestContext,
  ): Promise<unknown> {
    await this.policy.authorize({
      actor,
      action: 'RETENTION_VIEW',
      purpose: 'AUDIT_REVIEW',
      resource: { type: 'SYSTEM', id: null, classification: 'INTERNAL', subjectPcid: null },
      context,
      auditDetail: { view: 'RETENTION_RUNS' },
    });

    const runs = await this.db.query<RunRow>(
      `SELECT id, reference, trigger, actor_type, actor_display, dry_run, status,
              rows_affected, more_remaining, error, started_at, finished_at
         FROM retention_run
        ORDER BY started_at DESC
        LIMIT $1 OFFSET $2`,
      [options.limit, options.offset],
    );
    const total = await this.db.queryOne<{ count: string }>(
      'SELECT count(*)::text AS count FROM retention_run',
    );

    const erasures =
      runs.length === 0
        ? []
        : await this.db.query<ErasureRow>(
            `SELECT run_id, policy_key, disposition, table_name, cutoff, rows_affected, capped
               FROM retention_erasure
              WHERE run_id = ANY($1::uuid[])
              ORDER BY policy_key`,
            [runs.map((run) => run.id)],
          );

    return {
      total: Number(total?.count ?? 0),
      runs: runs.map((run) => this.presentRun(run, erasures)),
    };
  }

  /**
   * Run the sweep now.
   *
   * Step-up authenticated, because this is the platform's most irreversible
   * operation and a session that was second-factored this morning is not the
   * same assurance as one second-factored a moment ago. The decision is audited
   * before the sweep starts and the outcome after it: a run that erased rows and
   * then failed to record the decision behind it would be indistinguishable from
   * one nobody ordered.
   */
  async run(
    actor: AuthenticatedActor,
    options: { dryRun: boolean },
    context: RequestContext,
  ): Promise<RetentionRunResult> {
    await this.policy.authorize({
      actor,
      action: 'RETENTION_RUN',
      purpose: 'AUDIT_REVIEW',
      resource: { type: 'SYSTEM', id: null, classification: 'INTERNAL', subjectPcid: null },
      context,
      auditDetail: { dryRun: options.dryRun },
    });

    const result = await this.worker.sweep({
      trigger: 'MANUAL',
      dryRun: options.dryRun,
      actorId: actor.subject.userId,
      actorDisplay: actor.displayName,
      correlationId: context.correlationId,
    });

    await this.audit.record({
      action: 'RETENTION_RUN',
      outcome: 'PERMITTED',
      actorType: 'GOVERNMENT_USER',
      actorId: actor.subject.userId,
      actorDisplay: actor.displayName,
      agencyId: actor.subject.agencyId,
      agencyCode: actor.agencyCode,
      purpose: 'AUDIT_REVIEW',
      resourceType: 'SYSTEM',
      resourceId: result.reference,
      correlationId: context.correlationId,
      // Counts and cutoffs, never contents. The ledger holds the same shape and
      // for the same reason.
      detail: {
        reference: result.reference,
        dryRun: result.dryRun,
        rowsAffected: result.rowsAffected,
        moreRemaining: result.moreRemaining,
        erasures: result.erasures.map((one) => ({
          policy: one.policy,
          table: one.table,
          disposition: one.disposition,
          cutoff: one.cutoff,
          rowsAffected: one.rowsAffected,
        })),
      },
    });

    return result;
  }

  private async lastRun(): Promise<unknown> {
    const run = await this.db.queryOne<RunRow>(
      `SELECT id, reference, trigger, actor_type, actor_display, dry_run, status,
              rows_affected, more_remaining, error, started_at, finished_at
         FROM retention_run
        ORDER BY started_at DESC
        LIMIT 1`,
    );
    if (run === null) return null;
    const erasures = await this.db.query<ErasureRow>(
      `SELECT run_id, policy_key, disposition, table_name, cutoff, rows_affected, capped
         FROM retention_erasure WHERE run_id = $1 ORDER BY policy_key`,
      [run.id],
    );
    return this.presentRun(run, erasures);
  }

  private presentRun(run: RunRow, erasures: readonly ErasureRow[]): Record<string, unknown> {
    return {
      reference: run.reference,
      trigger: run.trigger,
      // A scheduled sweep has no person behind it and says so, rather than
      // borrowing the name of whoever deployed the worker.
      orderedBy: run.actor_type === 'SYSTEM' ? null : run.actor_display,
      dryRun: run.dry_run,
      status: run.status,
      rowsAffected: run.rows_affected,
      moreRemaining: run.more_remaining,
      error: run.error,
      startedAt: run.started_at.toISOString(),
      finishedAt: run.finished_at === null ? null : run.finished_at.toISOString(),
      erasures: erasures
        .filter((one) => one.run_id === run.id)
        .map((one) => ({
          policy: one.policy_key,
          holds: this.describe(one.policy_key),
          disposition: one.disposition,
          table: one.table_name,
          cutoff: one.cutoff.toISOString(),
          rowsAffected: one.rows_affected,
          capped: one.capped,
        })),
    };
  }

  /**
   * A policy key read back from the ledger may predate a catalogue change, so
   * this never throws: a run that recorded a policy since renamed should still
   * be readable, and "no longer in the catalogue" is a more useful answer than a
   * failed page.
   */
  private describe(key: string): string | null {
    try {
      return retentionPolicy(key as RetentionPolicyKey).holds;
    } catch {
      return null;
    }
  }
}
