import { Inject, Injectable } from '@nestjs/common';
import { RETENTION_BATCH_LIMIT } from '@pcid/contracts';
import type { RetentionPolicyKey } from '@pcid/contracts';

import { logger } from '../common/logger';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { Database } from '../database/pool';
import type { QueryRunner } from '../database/pool';
import { RETENTION_DUE_COUNT_CEILING, RETENTION_RULES, retentionCutoff } from './retention.rules';
import type { RetentionRule } from './retention.rules';

export interface RetentionErasureResult {
  readonly policy: RetentionPolicyKey;
  readonly table: string;
  readonly disposition: 'DELETE' | 'REDACT';
  readonly cutoff: string;
  readonly rowsAffected: number;
  /** True when the rule hit its batch limit: there is more, and the next sweep takes it. */
  readonly capped: boolean;
}

export interface RetentionRunResult {
  readonly reference: string;
  readonly runId: string;
  readonly dryRun: boolean;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly rowsAffected: number;
  readonly moreRemaining: boolean;
  readonly erasures: readonly RetentionErasureResult[];
}

export interface RetentionRunRequest {
  readonly trigger: 'SCHEDULED' | 'MANUAL';
  readonly dryRun: boolean;
  readonly actorId?: string | null;
  readonly actorDisplay?: string | null;
  readonly correlationId?: string | null;
}

/**
 * The retention sweep (master system prompt §21, §68).
 *
 * It applies the catalogue and does nothing else. Each rule is given the cutoff
 * its policy implies, erases up to a batch, and reports how many rows it
 * touched; the run and each rule's count go into the ledger. What it erased is
 * never recorded - a ledger that kept the contents of a deleted row in order to
 * prove the deletion would defeat it.
 *
 * Three decisions worth stating:
 *
 * **A rule that fails does not stop the sweep.** One table under a lock, or one
 * statement timing out on a first run against years of rows, must not mean the
 * other seven policies go unapplied for another night. The run is marked FAILED
 * with the reason, the rules that succeeded keep their ledger rows, and the next
 * sweep retries what did not.
 *
 * **Each rule commits on its own.** Wrapping the whole sweep in one transaction
 * would hold locks across every table for its duration and roll back six
 * successful erasures because the seventh met a timeout. Retention is idempotent
 * - a row erased is a row no longer due - so partial progress is progress.
 *
 * **A dry run takes the same path.** It counts through the same predicates the
 * erasure uses, rather than through a second set that could disagree with them.
 */
@Injectable()
export class RetentionWorker {
  constructor(
    private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** What is past its period right now, per policy, without erasing anything. */
  async due(now: Date = new Date()): Promise<
    readonly {
      policy: RetentionPolicyKey;
      table: string;
      cutoff: string;
      due: number;
      atLeast: boolean;
    }[]
  > {
    const counts = [];
    for (const rule of RETENTION_RULES) {
      const cutoff = retentionCutoff(rule, now);
      const row = await this.db.queryOne<{ due: number }>(rule.due, [cutoff]);
      const counted = Number(row?.due ?? 0);
      // The count is bounded so that a page showing it stays fast: the query
      // scans one row past the ceiling and stops. Report the ceiling rather than
      // that extra row, so the page reads "at least 1000" rather than the
      // oddly precise "at least 1001".
      const atLeast = counted > RETENTION_DUE_COUNT_CEILING;
      counts.push({
        policy: rule.policy,
        table: rule.table,
        cutoff: cutoff.toISOString(),
        due: atLeast ? RETENTION_DUE_COUNT_CEILING : counted,
        atLeast,
      });
    }
    return counts;
  }

  async sweep(request: RetentionRunRequest, now: Date = new Date()): Promise<RetentionRunResult> {
    const batch = this.env.RETENTION_BATCH_SIZE;
    const started = new Date();
    const run = await this.openRun(request, started);

    const erasures: RetentionErasureResult[] = [];
    const failures: string[] = [];

    for (const rule of RETENTION_RULES) {
      try {
        erasures.push(await this.applyRule(rule, run.id, request.dryRun, batch, now));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown';
        failures.push(`${rule.policy}: ${message}`);
        logger.error('retention_rule_failed', { policy: rule.policy, table: rule.table, message });
      }
    }

    const rowsAffected = erasures.reduce((total, one) => total + one.rowsAffected, 0);
    const moreRemaining = erasures.some((one) => one.capped);
    const finished = new Date();

    await this.db.query(
      `UPDATE retention_run
          SET status = $2, rows_affected = $3, more_remaining = $4, error = $5, finished_at = $6
        WHERE id = $1`,
      [
        run.id,
        failures.length === 0 ? 'COMPLETED' : 'FAILED',
        rowsAffected,
        moreRemaining,
        failures.length === 0 ? null : failures.join('; '),
        finished,
      ],
    );

    logger.info('retention_sweep_completed', {
      reference: run.reference,
      dryRun: request.dryRun,
      rowsAffected,
      moreRemaining,
      failed: failures.length,
    });

    return {
      reference: run.reference,
      runId: run.id,
      dryRun: request.dryRun,
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString(),
      rowsAffected,
      moreRemaining,
      erasures,
    };
  }

  /**
   * One rule, in its own transaction.
   *
   * The erasure and its ledger row commit together: a sweep that erased rows and
   * then failed to record that it had would leave a Data Protection Officer
   * unable to say what happened, which is the one outcome worse than not having
   * erased them.
   */
  private async applyRule(
    rule: RetentionRule,
    runId: string,
    dryRun: boolean,
    batch: number,
    now: Date,
  ): Promise<RetentionErasureResult> {
    const cutoff = retentionCutoff(rule, now);
    const limit = Math.min(batch, RETENTION_BATCH_LIMIT);

    return this.db.transaction(async (runner: QueryRunner) => {
      let rowsAffected: number;
      if (dryRun) {
        const row = await runner.queryOne<{ due: number }>(rule.due, [cutoff]);
        rowsAffected = Math.min(Number(row?.due ?? 0), limit);
      } else {
        const row = await runner.queryOne<{ erased: number }>(rule.erase, [cutoff, limit]);
        rowsAffected = Number(row?.erased ?? 0);
      }

      const capped = rowsAffected >= limit;

      await runner.query(
        `INSERT INTO retention_erasure
           (run_id, policy_key, disposition, table_name, cutoff, rows_affected, capped)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [runId, rule.policy, rule.disposition, rule.table, cutoff, rowsAffected, capped],
      );

      return {
        policy: rule.policy,
        table: rule.table,
        disposition: rule.disposition,
        cutoff: cutoff.toISOString(),
        rowsAffected,
        capped,
      };
    });
  }

  private async openRun(
    request: RetentionRunRequest,
    started: Date,
  ): Promise<{ id: string; reference: string }> {
    // The platform's own sequence, not a random suffix: `reference` is UNIQUE, so
    // a collision would fail a sweep rather than merely repeat a label, and a
    // ledger somebody reads in order should be numbered in order.
    const year = started.getUTCFullYear().toString();
    const sequence = await this.db.queryOne<{ next_reference: string }>(
      'SELECT next_reference($1, $2) AS next_reference',
      ['RETENTION', year],
    );
    const reference = `RET-${year}-${String(Number(sequence?.next_reference ?? 1)).padStart(5, '0')}`;
    const row = await this.db.queryOne<{ id: string }>(
      `INSERT INTO retention_run
         (reference, trigger, actor_type, actor_id, actor_display, dry_run, started_at, correlation_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        reference,
        request.trigger,
        request.trigger === 'MANUAL' ? 'GOVERNMENT_USER' : 'SYSTEM',
        request.trigger === 'MANUAL' ? (request.actorId ?? null) : null,
        request.actorDisplay ?? null,
        request.dryRun,
        started,
        request.correlationId ?? null,
      ],
    );
    if (row === null) throw new Error('the retention run could not be opened');
    return { id: row.id, reference };
  }
}
