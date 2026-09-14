import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';

import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { logger } from '../common/logger';

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly resetAtMs: number;
  readonly count: number;
}

/**
 * Counter store behind rate limiting and search-abuse detection.
 *
 * Two implementations: Redis for a multi-instance deployment, and an in-process
 * map for single-instance and test runs. The interface is the same so the
 * limiter's behaviour does not depend on which one is configured (§45, §63, §78).
 */
export interface CounterStore {
  increment(
    key: string,
    windowSeconds: number,
    amount?: number,
  ): Promise<{ count: number; resetAtMs: number }>;
  reset(key: string): Promise<void>;
  healthy(): Promise<boolean>;
  close(): Promise<void>;
}

export class MemoryCounterStore implements CounterStore {
  private readonly buckets = new Map<string, { count: number; resetAtMs: number }>();
  private readonly sweeper: NodeJS.Timeout;

  constructor() {
    this.sweeper = setInterval(() => this.sweep(), 30_000);
    this.sweeper.unref?.();
  }

  async increment(
    key: string,
    windowSeconds: number,
    amount = 1,
  ): Promise<{ count: number; resetAtMs: number }> {
    const now = Date.now();
    const existing = this.buckets.get(key);
    if (existing === undefined || existing.resetAtMs <= now) {
      const fresh = { count: amount, resetAtMs: now + windowSeconds * 1000 };
      this.buckets.set(key, fresh);
      return fresh;
    }
    existing.count += amount;
    return existing;
  }

  async reset(key: string): Promise<void> {
    this.buckets.delete(key);
  }

  async healthy(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    clearInterval(this.sweeper);
    this.buckets.clear();
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAtMs <= now) this.buckets.delete(key);
    }
  }
}

interface RedisLike {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
  del(key: string): Promise<unknown>;
  ping(): Promise<string>;
  quit(): Promise<unknown>;
}

export class RedisCounterStore implements CounterStore {
  // Increment and set the expiry atomically, so a crash between the two cannot
  // leave a counter that never resets.
  private static readonly SCRIPT = `
    local current = redis.call('INCRBY', KEYS[1], ARGV[1])
    if current == tonumber(ARGV[1]) then
      redis.call('PEXPIRE', KEYS[1], ARGV[2])
    end
    local ttl = redis.call('PTTL', KEYS[1])
    return { current, ttl }
  `;

  constructor(private readonly redis: RedisLike) {}

  async increment(
    key: string,
    windowSeconds: number,
    amount = 1,
  ): Promise<{ count: number; resetAtMs: number }> {
    const result = (await this.redis.eval(
      RedisCounterStore.SCRIPT,
      1,
      key,
      amount,
      windowSeconds * 1000,
    )) as [number, number];
    const ttl = result[1] > 0 ? result[1] : windowSeconds * 1000;
    return { count: Number(result[0]), resetAtMs: Date.now() + ttl };
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async healthy(): Promise<boolean> {
    try {
      return (await this.redis.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}

@Injectable()
export class RateLimiter implements OnModuleDestroy {
  private readonly store: CounterStore;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.store = createCounterStore(env);
  }

  /**
   * Consume one unit against `key`. Fails *closed* only for the sensitive
   * limiters; the general limiter fails open on a store outage so a Redis
   * incident cannot take emergency response offline.
   *
   * `amount: 0` reads the budget without spending from it, which is how a
   * limiter that counts failures is checked before the outcome is known.
   */
  async consume(
    key: string,
    max: number,
    windowSeconds: number = this.env.RATE_LIMIT_WINDOW_SECONDS,
    options: { failClosed?: boolean; amount?: number } = {},
  ): Promise<RateLimitDecision> {
    try {
      const { count, resetAtMs } = await this.store.increment(
        key,
        windowSeconds,
        options.amount ?? 1,
      );
      return { allowed: count <= max, remaining: Math.max(0, max - count), resetAtMs, count };
    } catch (error) {
      logger.error('rate_limit_store_unavailable', {
        message: (error as Error).message,
        failClosed: options.failClosed === true,
      });
      if (options.failClosed === true) {
        return {
          allowed: false,
          remaining: 0,
          resetAtMs: Date.now() + windowSeconds * 1000,
          count: max + 1,
        };
      }
      return {
        allowed: true,
        remaining: max,
        resetAtMs: Date.now() + windowSeconds * 1000,
        count: 0,
      };
    }
  }

  async reset(key: string): Promise<void> {
    await this.store.reset(key).catch(() => undefined);
  }

  async healthy(): Promise<boolean> {
    return this.store.healthy();
  }

  async onModuleDestroy(): Promise<void> {
    await this.store.close();
  }
}

export function createCounterStore(env: Env): CounterStore {
  if (env.REDIS_URL === undefined || env.REDIS_URL === '') {
    if (env.NODE_ENV === 'production') {
      throw new Error(
        'REDIS_URL is required in production: rate limiting must be shared across API instances.',
      );
    }
    logger.info('counter_store_selected', { store: 'memory' });
    return new MemoryCounterStore();
  }
  // Imported lazily so a deployment without Redis does not pay for the driver.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Redis } = require('ioredis') as {
    Redis: new (url: string, options?: unknown) => RedisLike;
  };
  logger.info('counter_store_selected', { store: 'redis' });
  return new RedisCounterStore(
    new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2, enableOfflineQueue: false }),
  );
}
