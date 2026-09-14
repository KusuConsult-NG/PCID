import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { MissingPersonStatus } from '@pcid/contracts';
import type { Request } from 'express';

import { contextOf } from '../common/correlation';
import {
  createMissingPersonSchema,
  createUnidentifiedPersonSchema,
  matchReviewSchema,
  missingPersonListSchema,
  missingPersonResolveSchema,
} from '../common/dto';
import { documentRoute } from '../common/openapi/registry';
import { validate } from '../common/zod-validation.pipe';
import { Actor } from '../iam/actor';
import type { AuthenticatedActor } from '../iam/actor';
import { MissingPersonsService } from './missing-persons.service';
import type {
  CreateMissingPersonInput,
  CreateUnidentifiedPersonInput,
} from './missing-persons.service';

documentRoute({
  method: 'post',
  path: '/api/v1/missing-persons',
  tag: 'Missing persons',
  summary: 'Report a missing person',
  description: 'Open to authorised officers and, through the citizen portal, to the public.',
  body: createMissingPersonSchema,
  actions: ['MISSING_PERSON_CREATE'],
});
documentRoute({
  method: 'get',
  path: '/api/v1/missing-persons',
  tag: 'Missing persons',
  summary: 'List missing-person cases',
  parameters: [
    { name: 'status', in: 'query', description: 'Filter by status.' },
    { name: 'openOnly', in: 'query', description: 'Only cases still open.' },
    { name: 'lgaCode', in: 'query', description: 'Filter by last-seen LGA.' },
  ],
  actions: ['MISSING_PERSON_VIEW'],
});
documentRoute({
  method: 'get',
  path: '/api/v1/missing-persons/:reference',
  tag: 'Missing persons',
  summary: 'View a missing-person case with sightings and candidate matches',
  parameters: [
    { name: 'reference', in: 'path', description: 'Case reference, e.g. MP-2026-00042.' },
  ],
  actions: ['MISSING_PERSON_VIEW'],
});
documentRoute({
  method: 'post',
  path: '/api/v1/missing-persons/:reference/matches/run',
  tag: 'Missing persons',
  summary: 'Run the matching engine against open unidentified-person records',
  description:
    'Produces candidates with every contributing factor and its weight. A candidate is never an ' +
    'identification: confirming one is a separate act by a named officer (§13, §66).',
  parameters: [{ name: 'reference', in: 'path', description: 'Case reference.' }],
  actions: ['MATCH_RUN'],
});
documentRoute({
  method: 'post',
  path: '/api/v1/matches/:matchId/review',
  tag: 'Missing persons',
  summary: 'Confirm or reject a candidate match',
  description:
    'Confirmation records the deciding officer. The database refuses a confirmed match with no ' +
    'reviewer, so an automated path cannot produce one.',
  parameters: [{ name: 'matchId', in: 'path', description: 'Candidate match id.' }],
  body: matchReviewSchema,
  actions: ['MATCH_CONFIRM'],
});
documentRoute({
  method: 'post',
  path: '/api/v1/missing-persons/:reference/resolve',
  tag: 'Missing persons',
  summary: 'Record the outcome of a missing-person case',
  parameters: [{ name: 'reference', in: 'path', description: 'Case reference.' }],
  body: missingPersonResolveSchema,
  actions: ['MISSING_PERSON_RESOLVE'],
});
documentRoute({
  method: 'post',
  path: '/api/v1/unidentified-persons',
  tag: 'Missing persons',
  summary: 'Record an unidentified person encountered by an emergency or security agency',
  description:
    'Biometrics are out of scope for this release: the record can carry a reference to material ' +
    'held by an agency with lawful authority and the infrastructure for it, and the platform ' +
    'stores no biometric data and performs no biometric matching (§12).',
  parameters: [
    { name: 'incidentRef', in: 'query', description: 'Incident the person was encountered at.' },
  ],
  body: createUnidentifiedPersonSchema,
  actions: ['UNIDENTIFIED_PERSON_CREATE'],
});

@Controller('api/v1')
export class MissingPersonsController {
  constructor(private readonly service: MissingPersonsService) {}

  @Post('missing-persons')
  async create(
    @Actor() actor: AuthenticatedActor,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(createMissingPersonSchema, body);
    return this.service.createMissingPerson(
      actor,
      input as unknown as CreateMissingPersonInput,
      contextOf(request),
    );
  }

  @Get('missing-persons')
  async list(
    @Actor() actor: AuthenticatedActor,
    @Query() query: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(missingPersonListSchema, query);
    return this.service.listMissingPersons(
      actor,
      {
        ...(input.status !== undefined ? { status: input.status as MissingPersonStatus } : {}),
        ...(input.openOnly !== undefined ? { openOnly: input.openOnly } : {}),
        ...(input.lgaCode !== undefined ? { lgaCode: input.lgaCode } : {}),
        limit: input.limit,
        offset: input.offset,
      },
      contextOf(request),
    );
  }

  @Get('missing-persons/:reference')
  async view(
    @Actor() actor: AuthenticatedActor,
    @Param('reference') reference: string,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.service.viewMissingPerson(actor, reference, contextOf(request));
  }

  @Post('missing-persons/:reference/matches/run')
  async runMatching(
    @Actor() actor: AuthenticatedActor,
    @Param('reference') reference: string,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.service.runMatching(actor, reference, contextOf(request));
  }

  @Post('matches/:matchId/review')
  async reviewMatch(
    @Actor() actor: AuthenticatedActor,
    @Param('matchId') matchId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(matchReviewSchema, body);
    return this.service.reviewMatch(actor, matchId, input.decision, input.note, contextOf(request));
  }

  @Post('missing-persons/:reference/resolve')
  async resolve(
    @Actor() actor: AuthenticatedActor,
    @Param('reference') reference: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(missingPersonResolveSchema, body);
    return this.service.resolveMissingPerson(
      actor,
      reference,
      input.status,
      input.note,
      contextOf(request),
    );
  }

  @Post('unidentified-persons')
  async createUnidentified(
    @Actor() actor: AuthenticatedActor,
    @Body() body: unknown,
    @Query('incidentRef') incidentRef: string | undefined,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(createUnidentifiedPersonSchema, body);
    return this.service.createUnidentifiedPerson(
      actor,
      input as unknown as CreateUnidentifiedPersonInput,
      incidentRef ?? null,
      contextOf(request),
    );
  }
}
