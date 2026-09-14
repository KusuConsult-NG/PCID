/**
 * The notification delivery worker, as its own process.
 *
 * `npm run worker:notifications`. It shares the API's configuration and its
 * database connection code and nothing else: it serves no HTTP, opens no port,
 * and holds no session. A deployment runs one or more of these next to the API
 * instances, and `FOR UPDATE SKIP LOCKED` means the number of them is an
 * operational decision rather than a correctness one.
 *
 * It stops cleanly. A sweep in flight is allowed to finish, because a message
 * that has been handed to a gateway and then abandoned by a dying process is
 * the one case where somebody gets told twice.
 */
import { logger } from '../common/logger';
import { loadEnv } from '../config/env';
import { Database } from '../database/pool';
import { NotificationDeliveryWorker } from './delivery.worker';

async function main(): Promise<void> {
  const env = loadEnv();
  logger.setLevel(env.LOG_LEVEL);

  const db = new Database(env);
  const worker = new NotificationDeliveryWorker(db, env);

  let stopping = false;
  let inFlight: Promise<unknown> = Promise.resolve();

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      logger.info('notification_worker_stopping', { signal });
      void inFlight.finally(async () => {
        await db.onModuleDestroy();
        process.exit(0);
      });
    });
  }

  logger.info('notification_worker_started', {
    intervalSeconds: env.NOTIFICATION_WORKER_INTERVAL_SECONDS,
    batchSize: env.NOTIFICATION_WORKER_BATCH_SIZE,
    standalone: true,
  });

  while (!stopping) {
    inFlight = worker.sweep(env.NOTIFICATION_WORKER_BATCH_SIZE).catch((error: unknown) => {
      logger.error('notification_sweep_failed', {
        message: error instanceof Error ? error.message : 'unknown',
      });
    });
    await inFlight;
    if (stopping) break;
    await new Promise((settle) =>
      setTimeout(settle, env.NOTIFICATION_WORKER_INTERVAL_SECONDS * 1000),
    );
  }
}

void main().catch((error: unknown) => {
  logger.error('notification_worker_failed', {
    message: error instanceof Error ? error.message : 'unknown',
  });
  process.exit(1);
});
