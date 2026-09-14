import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';

import { contextOf } from '../common/correlation';
import {
  alertQueueSchema,
  alertReviewSchema,
  correctionDecisionSchema,
  correctionQueueSchema,
} from '../common/dto';
import { documentRoute } from '../common/openapi/registry';
import { validate } from '../common/zod-validation.pipe';
import { Actor, RequiresStepUp } from '../iam/actor';
import type { AuthenticatedActor } from '../iam/actor';
import { AlertsService } from './alerts.service';
import { CorrectionsService } from './corrections.service';

documentRoute({
  method: 'get',
  path: '/api/v1/correction-requests',
  tag: 'Oversight',
  summary: 'The queue of correction requests awaiting a decision',
  description:
    'What residents and officers have asked to have put right, oldest first, because a correction ' +
    'queue worked newest-first leaves the oldest complaint permanently last.',
  parameters: [
    { name: 'status', in: 'query', description: 'Filter by status. Defaults to every status.' },
    { name: 'subjectPcid', in: 'query', description: 'Only requests about one person.' },
  ],
  actions: ['CORRECTION_REQUEST_REVIEW'],
});
documentRoute({
  method: 'post',
  path: '/api/v1/correction-requests/:reference/decision',
  tag: 'Oversight',
  summary: 'Approve, reject, or ask for evidence',
  description:
    'Approving applies the value to the record in the same transaction that records the decision, ' +
    'and notifies the resident. Only fields the catalogue marks as the resident’s own to correct ' +
    'can be applied, whatever is approved.',
  parameters: [{ name: 'reference', in: 'path', description: 'Correction request reference.' }],
  body: correctionDecisionSchema,
  requiresStepUp: true,
  actions: ['CORRECTION_REQUEST_REVIEW'],
});
documentRoute({
  method: 'get',
  path: '/api/v1/alerts',
  tag: 'Oversight',
  summary: 'Detection events awaiting review, most serious first',
  description:
    'Each alert carries the explanation that produced it - the factors and the confidence - so the ' +
    'officer asked to act on it can see why. An alert names an event and carries an identifier; ' +
    'reading the person behind it is a separate act under a stated purpose.',
  parameters: [
    { name: 'status', in: 'query', description: 'Filter by review status.' },
    { name: 'category', in: 'query', description: 'Filter by category.' },
    { name: 'severity', in: 'query', description: 'Filter by severity.' },
  ],
  actions: ['ALERT_VIEW'],
});
documentRoute({
  method: 'get',
  path: '/api/v1/alerts/:reference',
  tag: 'Oversight',
  summary: 'One alert with its full explanation',
  parameters: [{ name: 'reference', in: 'path', description: 'Alert reference.' }],
  actions: ['ALERT_VIEW'],
});
documentRoute({
  method: 'post',
  path: '/api/v1/alerts/:reference/review',
  tag: 'Oversight',
  summary: 'Record what was done about an alert',
  description:
    'Dismissing as a false positive is a first-class outcome and is recorded as one: a queue where ' +
    'the only way to clear an item is to act on it produces action rather than judgement.',
  parameters: [{ name: 'reference', in: 'path', description: 'Alert reference.' }],
  body: alertReviewSchema,
  actions: ['ALERT_REVIEW'],
});

@Controller('api/v1')
export class OversightController {
  constructor(
    private readonly corrections: CorrectionsService,
    private readonly alerts: AlertsService,
  ) {}

  @Get('correction-requests')
  async correctionQueue(
    @Actor() actor: AuthenticatedActor,
    @Query() query: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(correctionQueueSchema, query);
    return this.corrections.list(
      actor,
      {
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.subjectPcid !== undefined ? { subjectPcid: input.subjectPcid } : {}),
        limit: input.limit,
        offset: input.offset,
      },
      contextOf(request),
    );
  }

  @RequiresStepUp()
  @Post('correction-requests/:reference/decision')
  async decideCorrection(
    @Actor() actor: AuthenticatedActor,
    @Param('reference') reference: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(correctionDecisionSchema, body);
    return this.corrections.decide(
      actor,
      reference,
      input.decision,
      input.note,
      contextOf(request),
    );
  }

  @Get('alerts')
  async alertQueue(
    @Actor() actor: AuthenticatedActor,
    @Query() query: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(alertQueueSchema, query);
    return this.alerts.list(
      actor,
      {
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.severity !== undefined ? { severity: input.severity } : {}),
        limit: input.limit,
        offset: input.offset,
      },
      contextOf(request),
    );
  }

  @Get('alerts/:reference')
  async alert(
    @Actor() actor: AuthenticatedActor,
    @Param('reference') reference: string,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.alerts.get(actor, reference, contextOf(request));
  }

  @Post('alerts/:reference/review')
  async reviewAlert(
    @Actor() actor: AuthenticatedActor,
    @Param('reference') reference: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(alertReviewSchema, body);
    return this.alerts.review(actor, reference, input.decision, input.note, contextOf(request));
  }
}
