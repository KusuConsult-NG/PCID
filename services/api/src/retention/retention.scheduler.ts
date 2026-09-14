import { Inject, Injectable } from '@nestjs/common';
import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { logger } from '../common/logger';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { RetentionWorker } from './retention.worker';

/**
 * Runs the sweep on a timer, inside the API process, when asked to.
 *
 * Off by default, like the notification worker and for the same reasons: a
 * single-box deployment turns it on, a real one runs `npm run worker:retention`
 * as its own process so an erasure batch cannot compete with a request path for
 * the event loop.
 *
 * Two runs at once are safe rather than merely unlikely to collide - each rule
 * is a bounded statement against rows already past their period, and a row two
 * sweeps both try to erase is simply erased once - but the guard below still
 * stops a slow sweep starting on top of itself, because two of them double the
 * write load on tables a live platform is also using.
 */
@Injectable()
export class RetentionScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly worker: RetentionWorker,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.env.RETENTION_WORKER_ENABLED) return;
    const interval = this.env.RETENTION_WORKER_INTERVAL_SECONDS * 1000;
    this.timer = setInterval(() => void this.tick(), interval);
    this.timer.unref();
    logger.info('retention_worker_started', { intervalSeconds: interval / 1000 });
  }

  onModuleDestroy(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await runScheduledSweep(this.worker, this.audit);
    } catch (error) {
      // A failed sweep must not stop the schedule. The next tick tries again,
      // and a run that never completes is visible in the ledger as RUNNING.
      logger.error('retention_sweep_failed', {
        message: error instanceof Error ? error.message : 'unknown',
      });
    } finally {
      this.running = false;
    }
  }
}

/**
 * One scheduled sweep, audited as the platform itself.
 *
 * The audit row matters more here than for most background work. An erasure
 * nobody ordered and nobody recorded is indistinguishable, afterwards, from data
 * that was lost - so the trail says the platform did it, on the schedule, and
 * how many rows each policy took.
 */
export async function runScheduledSweep(
  worker: RetentionWorker,
  audit: AuditService,
): Promise<void> {
  const correlationId = `retention-${Date.now().toString(36)}`;
  const result = await worker.sweep({ trigger: 'SCHEDULED', dryRun: false, correlationId });

  // Nothing due is the normal state of a platform whose schedule is being kept,
  // and an audit row for every quiet night would bury the ones that are not.
  if (result.rowsAffected === 0) return;

  await audit.record({
    action: 'RETENTION_RUN',
    outcome: 'PERMITTED',
    actorType: 'SYSTEM',
    actorDisplay: 'Retention schedule',
    resourceType: 'SYSTEM',
    resourceId: result.reference,
    purpose: 'AUDIT_REVIEW',
    correlationId,
    detail: {
      reference: result.reference,
      trigger: 'SCHEDULED',
      rowsAffected: result.rowsAffected,
      moreRemaining: result.moreRemaining,
      erasures: result.erasures
        .filter((one) => one.rowsAffected > 0)
        .map((one) => ({
          policy: one.policy,
          table: one.table,
          disposition: one.disposition,
          cutoff: one.cutoff,
          rowsAffected: one.rowsAffected,
        })),
    },
  });
}
