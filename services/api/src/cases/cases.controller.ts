import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { CaseStatus, CaseType } from '@pcid/contracts';
import type { Request } from 'express';

import { contextOf } from '../common/correlation';
import {
  caseAssignSchema,
  caseCloseSchema,
  caseLinkSubjectSchema,
  caseListSchema,
  caseNoteSchema,
  caseUpdateSchema,
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
  method: 'patch',
  path: '/api/v1/cases/:reference',
  tag: 'Cases',
  summary: 'Correct or advance a case',
  description:
    'Title, summary, status and geography. It cannot close a case - that is a separate entitlement ' +
    'and demands a closure note - and it cannot change the classification or the owning agency, ' +
    'because those decide who may reach the case at all.',
  parameters: [{ name: 'reference', in: 'path', description: 'Case number.' }],
  body: caseUpdateSchema,
  actions: ['CASE_UPDATE'],
});
documentRoute({
  method: 'post',
  path: '/api/v1/cases/:reference/notes',
  tag: 'Cases',
  summary: 'Add a note to the case file',
  description:
    'Append-only by intent: a note carries its author and its time, and no route edits or removes ' +
    'one. A case file somebody can quietly rewrite is not a case file.',
  parameters: [{ name: 'reference', in: 'path', description: 'Case number.' }],
  body: caseNoteSchema,
  actions: ['CASE_UPDATE'],
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

  @Patch(':reference')
  async update(
    @Actor() actor: AuthenticatedActor,
    @Param('reference') reference: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(caseUpdateSchema, body);
    return this.cases.update(
      actor,
      reference,
      {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.summary !== undefined ? { summary: input.summary } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.lgaCode !== undefined ? { lgaCode: input.lgaCode } : {}),
        ...(input.wardCode !== undefined ? { wardCode: input.wardCode } : {}),
      },
      contextOf(request),
    );
  }

  @Post(':reference/notes')
  async addNote(
    @Actor() actor: AuthenticatedActor,
    @Param('reference') reference: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(caseNoteSchema, body);
    return this.cases.addNote(actor, reference, input.body, contextOf(request));
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
