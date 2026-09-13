import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';

import { documentRoute } from '../common/openapi/registry';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { Database } from '../database/pool';
import { Public } from '../iam/actor';
import { RateLimiter } from '../security/rate-limit';

documentRoute({
  method: 'get',
  path: '/api/v1/health/live',
  tag: 'Operations',
  summary: 'Liveness probe',
  description: 'Answers as long as the process is running. Carries no dependency checks.',
  public: true,
});
documentRoute({
  method: 'get',
  path: '/api/v1/health/ready',
  tag: 'Operations',
  summary: 'Readiness probe',
  description:
    'Reports the database and the rate-limit store. The identity service is treated as ' +
    'mission-critical, so an instance that cannot reach the database removes itself from the ' +
    'load balancer rather than serving errors (§71).',
  public: true,
  responses: { '503': 'A dependency required to serve traffic is unavailable.' },
});

@Controller('api/v1/health')
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: Database,
    private readonly limiter: RateLimiter,
  ) {}

  @Public()
  @Get('live')
  live(): Record<string, unknown> {
    return {
      status: 'ok',
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      environment: this.env.NODE_ENV,
    };
  }

  @Public()
  @Get('ready')
  async ready(@Res({ passthrough: true }) response: Response): Promise<Record<string, unknown>> {
    const [database, counters] = await Promise.all([this.db.healthy(), this.limiter.healthy()]);
    const ready = database && counters;
    // A degraded instance must fail its readiness probe, not return 200 with a
    // warning: the load balancer only reads the status code.
    response.status(ready ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status: ready ? 'ready' : 'degraded',
      checks: {
        database: database ? 'ok' : 'unavailable',
        counterStore: counters ? 'ok' : 'unavailable',
      },
      checkedAt: new Date().toISOString(),
    };
  }
}
