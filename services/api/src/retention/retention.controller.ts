import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';

import { contextOf } from '../common/correlation';
import { paginationSchema, retentionRunSchema } from '../common/dto';
import { documentRoute } from '../common/openapi/registry';
import { validate } from '../common/zod-validation.pipe';
import { Actor, RequiresStepUp } from '../iam/actor';
import type { AuthenticatedActor } from '../iam/actor';
import { RetentionService } from './retention.service';

documentRoute({
  method: 'get',
  path: '/api/v1/retention/schedule',
  tag: 'Oversight',
  summary: 'What the platform keeps, for how long, why — and what is overdue now',
  description:
    'Every retention policy with its period, what happens when the period ends, and the reason ' +
    'that period was chosen. Beside each one, how many rows are past it right now: a schedule ' +
    'without its backlog says what should happen, and the backlog says whether it is happening. ' +
    'Counts are bounded, so a large one reports “at least”.',
  actions: ['RETENTION_VIEW'],
});
documentRoute({
  method: 'get',
  path: '/api/v1/retention/runs',
  tag: 'Oversight',
  summary: 'What the sweeps have erased',
  description:
    'Each run with its per-policy counts and cutoffs. Never the contents of what was erased: a ' +
    'ledger that recorded a deleted row in order to prove the deletion would defeat it.',
  parameters: [
    { name: 'limit', in: 'query', description: 'Page size, 1–100. Defaults to 25.' },
    { name: 'offset', in: 'query', description: 'Rows to skip.' },
  ],
  actions: ['RETENTION_VIEW'],
});
documentRoute({
  method: 'post',
  path: '/api/v1/retention/runs',
  tag: 'Oversight',
  summary: 'Apply the schedule now',
  description:
    'Runs the sweep out of turn. `dryRun` counts what would go and erases nothing, which is what ' +
    'the first run on a deployment that has been collecting for a year should be. Each policy is ' +
    'bounded to a batch, so a run that reports more remaining has more to do and the next one ' +
    'continues. Step-up authenticated: erasure is the least reversible thing this platform does.',
  body: retentionRunSchema,
  requiresStepUp: true,
  actions: ['RETENTION_RUN'],
});

@Controller('api/v1/retention')
export class RetentionController {
  constructor(private readonly retention: RetentionService) {}

  @Get('schedule')
  async schedule(@Actor() actor: AuthenticatedActor, @Req() request: Request): Promise<unknown> {
    return this.retention.schedule(actor, contextOf(request));
  }

  @Get('runs')
  async runs(
    @Actor() actor: AuthenticatedActor,
    @Query() query: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(paginationSchema, query);
    return this.retention.history(
      actor,
      { limit: input.limit, offset: input.offset },
      contextOf(request),
    );
  }

  @RequiresStepUp()
  @Post('runs')
  async run(
    @Actor() actor: AuthenticatedActor,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(retentionRunSchema, body);
    return this.retention.run(actor, { dryRun: input.dryRun }, contextOf(request));
  }
}
