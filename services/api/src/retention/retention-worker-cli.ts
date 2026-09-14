/**
 * The retention sweep, as its own process.
 *
 * `npm run worker:retention`. It shares the API's configuration and its database
 * connection code and nothing else: it serves no HTTP, opens no port, and holds
 * no session. A deployment runs one of these on a timer - nightly is the usual
 * answer, because the periods are measured in days and an hourly sweep erases
 * the same rows a few hours earlier at the cost of a nightly write burst against
 * tables that are busy all day.
 *
 * It stops cleanly. A sweep in flight is allowed to finish, because each rule
 * commits with its ledger row and a process killed between the two would leave
 * an erasure nobody can account for.
 */
import { AuditService } from '../audit/audit.service';
import { logger } from '../common/logger';
import { loadEnv } from '../config/env';
import { Database } from '../database/pool';
import { RetentionWorker } from './retention.worker';
import { runScheduledSweep } from './retention.scheduler';

async function main(): Promise<void> {
  const env = loadEnv();
  logger.setLevel(env.LOG_LEVEL);

  const db = new Database(env);
  const worker = new RetentionWorker(db, env);
  const audit = new AuditService(db);

  const once = process.argv.includes('--once');
  let stopping = false;
  let inFlight: Promise<unknown> = Promise.resolve();

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      logger.info('retention_worker_stopping', { signal });
      void inFlight.finally(async () => {
        await db.onModuleDestroy();
        process.exit(0);
      });
    });
  }

  logger.info('retention_worker_started', {
    intervalSeconds: env.RETENTION_WORKER_INTERVAL_SECONDS,
    batchSize: env.RETENTION_BATCH_SIZE,
    once,
    standalone: true,
  });

  do {
    inFlight = runScheduledSweep(worker, audit).catch((error: unknown) => {
      logger.error('retention_sweep_failed', {
        message: error instanceof Error ? error.message : 'unknown',
      });
    });
    await inFlight;
    if (once || stopping) break;
    await new Promise((settle) => setTimeout(settle, env.RETENTION_WORKER_INTERVAL_SECONDS * 1000));
  } while (!stopping);

  await db.onModuleDestroy();
}

void main().catch((error: unknown) => {
  logger.error('retention_worker_failed', {
    message: error instanceof Error ? error.message : 'unknown',
  });
  process.exit(1);
});
