import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';

import { contextOf } from '../common/correlation';
import {
  accessDecisionSchema,
  accessRequestSchema,
  breakGlassReviewSchema,
  breakGlassSchema,
  paginationSchema,
} from '../common/dto';
import { documentRoute } from '../common/openapi/registry';
import { validate } from '../common/zod-validation.pipe';
import { Actor, RequiresStepUp } from '../iam/actor';
import type { AuthenticatedActor } from '../iam/actor';
import { AccessService } from './access.service';
import type { CreateAccessRequestInput, InitiateBreakGlassInput } from './access.service';
import { z } from 'zod';

documentRoute({
  method: 'post',
  path: '/api/v1/access-requests',
  tag: 'Authorisation',
  summary: 'Request access to fields that need approval',
  description:
    'Runs the policy check first and stores the engine’s verbatim answer on the request, so the ' +
    'approver sees what the platform concluded rather than only the requester’s account. If the ' +
    'fields are already available to you, the request is not queued and you are told to proceed.',
  body: accessRequestSchema,
  actions: ['ACCESS_REQUEST_CREATE'],
});
documentRoute({
  method: 'get',
  path: '/api/v1/access-requests',
  tag: 'Authorisation',
  summary: 'List your requests, or the queue awaiting your approval',
  parameters: [
    {
      name: 'forApproval',
      in: 'query',
      description: 'Show the approval queue for your agency instead of your own requests.',
    },
    { name: 'status', in: 'query', description: 'Filter your own requests by status.' },
  ],
  actions: ['ACCESS_REQUEST_CREATE', 'ACCESS_REQUEST_APPROVE'],
});
documentRoute({
  method: 'post',
  path: '/api/v1/access-requests/:reference/decision',
  tag: 'Authorisation',
  summary: 'Approve or deny a request',
  description:
    'Requires a freshly re-authenticated session. Nobody approves their own request: the API and a ' +
    'database constraint both refuse it. An approval is bounded to the fields named and expires.',
  parameters: [{ name: 'reference', in: 'path', description: 'Access request reference.' }],
  body: accessDecisionSchema,
  requiresStepUp: true,
  actions: ['ACCESS_REQUEST_APPROVE'],
});
documentRoute({
  method: 'post',
  path: '/api/v1/break-glass',
  tag: 'Authorisation',
  summary: 'Initiate break-glass emergency access',
  description:
    'Temporary, minimal, logged and reviewable. A grant can stand in for a jurisdiction boundary, ' +
    'a case or incident assignment, or a field approval - never for a role, a clearance ceiling or ' +
    'the law-enforcement compartment. It expires within an hour at the outside, notifies ' +
    'supervisors immediately, and creates a review obligation due within 24 hours.',
  body: breakGlassSchema,
  requiresStepUp: true,
  actions: ['BREAK_GLASS_INITIATE'],
});
documentRoute({
  method: 'get',
  path: '/api/v1/break-glass/review-queue',
  tag: 'Authorisation',
  summary: 'Break-glass grants awaiting their mandatory post-event review',
  actions: ['BREAK_GLASS_REVIEW'],
});
documentRoute({
  method: 'post',
  path: '/api/v1/break-glass/:reference/review',
  tag: 'Authorisation',
  summary: 'Record the post-event review of a break-glass grant',
  description: 'An officer cannot review their own emergency access.',
  parameters: [{ name: 'reference', in: 'path', description: 'Break-glass reference.' }],
  body: breakGlassReviewSchema,
  actions: ['BREAK_GLASS_REVIEW'],
});

const listQuerySchema = paginationSchema.extend({
  status: z.string().max(32).optional(),
  forApproval: z.coerce.boolean().optional(),
});

@Controller('api/v1')
export class AccessController {
  constructor(private readonly access: AccessService) {}

  @Post('access-requests')
  async createRequest(
    @Actor() actor: AuthenticatedActor,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(accessRequestSchema, body);
    return this.access.createRequest(
      actor,
      input as unknown as CreateAccessRequestInput,
      contextOf(request),
    );
  }

  @Get('access-requests')
  async listRequests(
    @Actor() actor: AuthenticatedActor,
    @Query() query: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(listQuerySchema, query);
    return this.access.listRequests(
      actor,
      {
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.forApproval !== undefined ? { forApproval: input.forApproval } : {}),
        limit: input.limit,
        offset: input.offset,
      },
      contextOf(request),
    );
  }

  @RequiresStepUp()
  @Post('access-requests/:reference/decision')
  async decide(
    @Actor() actor: AuthenticatedActor,
    @Param('reference') reference: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(accessDecisionSchema, body);
    return this.access.decide(
      actor,
      reference,
      input.decision,
      {
        ...(input.approvedFields !== undefined ? { approvedFields: input.approvedFields } : {}),
        note: input.note,
        ...(input.ttlSeconds !== undefined ? { ttlSeconds: input.ttlSeconds } : {}),
      },
      contextOf(request),
    );
  }

  @RequiresStepUp()
  @Post('break-glass')
  async initiateBreakGlass(
    @Actor() actor: AuthenticatedActor,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(breakGlassSchema, body);
    return this.access.initiateBreakGlass(
      actor,
      input as unknown as InitiateBreakGlassInput,
      contextOf(request),
    );
  }

  @Get('break-glass/review-queue')
  async reviewQueue(@Actor() actor: AuthenticatedActor, @Req() request: Request): Promise<unknown> {
    return this.access.listBreakGlassForReview(actor, contextOf(request));
  }

  @Post('break-glass/:reference/review')
  async reviewBreakGlass(
    @Actor() actor: AuthenticatedActor,
    @Param('reference') reference: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(breakGlassReviewSchema, body);
    return this.access.reviewBreakGlass(
      actor,
      reference,
      input.decision,
      input.note,
      contextOf(request),
    );
  }
}
