import { Inject, Injectable } from '@nestjs/common';
import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';

import { logger } from '../common/logger';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { NotificationDeliveryWorker } from './delivery.worker';

/**
 * Runs the delivery sweep inside the API process, when asked to.
 *
 * Off by default. A single-box deployment turns it on and is done; a real one
 * runs `npm run worker:notifications` as its own process, so a burst of
 * messages cannot compete with a request path for the same event loop, and the
 * worker can be restarted without restarting the API.
 *
 * Either way the same sweep runs, and `FOR UPDATE SKIP LOCKED` means running
 * both at once is safe rather than merely unlikely to collide.
 */
@Injectable()
export class NotificationWorkerScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly worker: NotificationDeliveryWorker,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.env.NOTIFICATION_WORKER_ENABLED) return;
    const interval = this.env.NOTIFICATION_WORKER_INTERVAL_SECONDS * 1000;
    this.timer = setInterval(() => void this.tick(), interval);
    // Never hold the process open for a timer: a shutdown should not wait for
    // the next sweep.
    this.timer.unref();
    logger.info('notification_worker_started', { intervalSeconds: interval / 1000 });
  }

  onModuleDestroy(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * One tick, and never two at once.
   *
   * A sweep that runs longer than the interval must not start a second one on
   * top of it: the claim is safe, but two overlapping sweeps double the load on
   * a gateway that is already the reason the first one is slow.
   */
  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.worker.sweep(this.env.NOTIFICATION_WORKER_BATCH_SIZE);
    } catch (error) {
      // A failed sweep must not stop the schedule. The next tick tries again.
      logger.error('notification_sweep_failed', {
        message: error instanceof Error ? error.message : 'unknown',
      });
    } finally {
      this.running = false;
    }
  }
}
