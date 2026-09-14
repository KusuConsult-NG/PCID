import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { CaseStatus, CaseType } from '@pcid/contracts';
import type { Request } from 'express';

import { contextOf } from '../common/correlation';
import {
  caseAssignSchema,
  caseCloseSchema,
  caseLinkSubjectSchema,
  caseListSchema,
  createCaseSchema,
} from '../common/dto';
import { documentRoute } from '../common/openapi/registry';
import { validate } from '../common/zod-validation.pipe';
import { Actor } from '../iam/actor';
import type { AuthenticatedActor } from '../iam/actor';
import { CasesService } from './cases.service';
import type { CreateCaseInput } from './cases.service';

documentRoute({
  method: 'post',
  path: '/api/v1/cases',
  tag: 'Cases',
  summary: 'Open a case',
  description:
    'The officer who opens a case is assigned to it. Cases carry a classification and an owning agency.',
  body: createCaseSchema,
  actions: ['CASE_CREATE'],
});
documentRoute({
  method: 'get',
  path: '/api/v1/cases',
  tag: 'Cases',
  summary: 'List the cases this account is assigned to',
  description: 'There is no browse-all view: a case you are not assigned to does not appear (§22).',
  parameters: [
    { name: 'status', in: 'query', description: 'Filter by status.' },
    { name: 'type', in: 'query', description: 'Filter by case type.' },
  ],
  actions: ['CASE_VIEW'],
});
documentRoute({
  method: 'get',
  path: '/api/v1/cases/:reference',
  tag: 'Cases',
  summary: 'View a case with its subjects, assignments and notes',
  parameters: [
    { name: 'reference', in: 'path', description: 'Case number, e.g. CASE-2026-00928.' },
  ],
  actions: ['CASE_VIEW'],
});
documentRoute({
  method: 'post',
  path: '/api/v1/cases/:reference/subjects',
  tag: 'Cases',
  summary: 'Associate a person, vehicle or property with the case',
  description:
    'This is the act that opens a record to the officers on the case, so it requires a written ' +
    'justification and is audited as a LINK_RECORD event in its own right.',
  parameters: [{ name: 'reference', in: 'path', description: 'Case number.' }],
  body: caseLinkSubjectSchema,
  actions: ['CASE_LINK_SUBJECT'],
});
documentRoute({
  method: 'post',
  path: '/api/v1/cases/:reference/assignments',
  tag: 'Cases',
  summary: 'Assign an officer to the case',
  parameters: [{ name: 'reference', in: 'path', description: 'Case number.' }],
  body: caseAssignSchema,
  actions: ['CASE_ASSIGN'],
});
documentRoute({
  method: 'post',
  path: '/api/v1/cases/:reference/close',
  tag: 'Cases',
  summary: 'Close a case',
  description: 'A closed case authorises no further access.',
  parameters: [{ name: 'reference', in: 'path', description: 'Case number.' }],
  body: caseCloseSchema,
  actions: ['CASE_CLOSE'],
});

@Controller('api/v1/cases')
export class CasesController {
  constructor(private readonly cases: CasesService) {}

  @Post()
  async create(
    @Actor() actor: AuthenticatedActor,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(createCaseSchema, body);
    return this.cases.create(actor, input as unknown as CreateCaseInput, contextOf(request));
  }

  @Get()
  async list(
    @Actor() actor: AuthenticatedActor,
    @Query() query: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(caseListSchema, query);
    return this.cases.list(
      actor,
      {
        ...(input.status !== undefined ? { status: input.status as CaseStatus } : {}),
        ...(input.type !== undefined ? { type: input.type as CaseType } : {}),
        limit: input.limit,
        offset: input.offset,
      },
      contextOf(request),
    );
  }

  @Get(':reference')
  async view(
    @Actor() actor: AuthenticatedActor,
    @Param('reference') reference: string,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.cases.view(actor, reference, contextOf(request));
  }

  @Post(':reference/subjects')
  async linkSubject(
    @Actor() actor: AuthenticatedActor,
    @Param('reference') reference: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(caseLinkSubjectSchema, body);
    return this.cases.linkSubject(actor, reference, input as never, contextOf(request));
  }

  @Post(':reference/assignments')
  async assign(
    @Actor() actor: AuthenticatedActor,
    @Param('reference') reference: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(caseAssignSchema, body);
    return this.cases.assign(actor, reference, input.userId, input.role, contextOf(request));
  }

  @Post(':reference/close')
  async close(
    @Actor() actor: AuthenticatedActor,
    @Param('reference') reference: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(caseCloseSchema, body);
    return this.cases.close(actor, reference, input.closureNote, contextOf(request));
  }
}
