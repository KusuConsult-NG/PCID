import { Body, Controller, Delete, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';

import { contextOf } from '../common/correlation';
import { correctionRequestSchema, emergencyContactSchema, paginationSchema } from '../common/dto';
import { documentRoute } from '../common/openapi/registry';
import { validate } from '../common/zod-validation.pipe';
import { Actor } from '../iam/actor';
import type { AuthenticatedActor } from '../iam/actor';
import { Citizen360Service } from './citizen360.service';
import { CitizenPortalService } from './citizen-portal.service';

documentRoute({
  method: 'get',
  path: '/api/v1/me/record',
  tag: 'Citizen portal',
  summary: 'The signed-in resident’s own record',
});
documentRoute({
  method: 'get',
  path: '/api/v1/me/emergency-contacts',
  tag: 'Citizen portal',
  summary: 'List the contacts to be called in an emergency',
});
documentRoute({
  method: 'post',
  path: '/api/v1/me/emergency-contacts',
  tag: 'Citizen portal',
  summary: 'Add an emergency contact',
  description:
    'Every change records who made it, so an alteration by an officer is visible as such (§18).',
  body: emergencyContactSchema,
});
documentRoute({
  method: 'delete',
  path: '/api/v1/me/emergency-contacts/:contactId',
  tag: 'Citizen portal',
  summary: 'Remove an emergency contact',
  parameters: [{ name: 'contactId', in: 'path', description: 'Contact id.' }],
});
documentRoute({
  method: 'get',
  path: '/api/v1/me/access-history',
  tag: 'Citizen portal',
  summary: 'Who in government accessed this record, when and for what purpose',
  description:
    'Accesses made under an active investigation may be withheld under a recorded legal basis. ' +
    'The response says so plainly rather than presenting an incomplete list as complete.',
});
documentRoute({
  method: 'post',
  path: '/api/v1/me/correction-requests',
  tag: 'Citizen portal',
  summary: 'Ask for something in the record to be corrected',
  body: correctionRequestSchema,
});
documentRoute({
  method: 'get',
  path: '/api/v1/me/correction-requests',
  tag: 'Citizen portal',
  summary: 'Track submitted correction requests',
});

@Controller('api/v1/me')
export class CitizenPortalController {
  constructor(
    private readonly portal: CitizenPortalService,
    private readonly citizen360: Citizen360Service,
  ) {}

  @Get('record')
  async record(@Actor() actor: AuthenticatedActor, @Req() request: Request): Promise<unknown> {
    const pcid = actor.subject.subjectPcid;
    return this.citizen360.build(actor, pcid ?? '', 'CITIZEN_SELF_SERVICE', {}, contextOf(request));
  }

  @Get('emergency-contacts')
  async listContacts(
    @Actor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.portal.listEmergencyContacts(actor, contextOf(request));
  }

  @Post('emergency-contacts')
  async addContact(
    @Actor() actor: AuthenticatedActor,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(emergencyContactSchema, body);
    return this.portal.addEmergencyContact(
      actor,
      {
        fullName: input.fullName,
        relationship: input.relationship,
        phonePrimary: input.phonePrimary,
        phoneSecondary: input.phoneSecondary ?? null,
        priority: input.priority,
      },
      contextOf(request),
    );
  }

  @Delete('emergency-contacts/:contactId')
  async removeContact(
    @Actor() actor: AuthenticatedActor,
    @Param('contactId') contactId: string,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.portal.removeEmergencyContact(actor, contactId, contextOf(request));
  }

  @Get('access-history')
  async accessHistory(
    @Actor() actor: AuthenticatedActor,
    @Query() query: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(paginationSchema, query);
    return this.portal.accessHistory(
      actor,
      { limit: input.limit, offset: input.offset },
      contextOf(request),
    );
  }

  @Post('correction-requests')
  async createCorrection(
    @Actor() actor: AuthenticatedActor,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(correctionRequestSchema, body);
    return this.portal.createCorrectionRequest(
      actor,
      {
        fieldPath: input.fieldPath,
        requestedValue: input.requestedValue,
        justification: input.justification,
        evidenceReference: input.evidenceReference ?? null,
      },
      contextOf(request),
    );
  }

  @Get('correction-requests')
  async listCorrections(
    @Actor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.portal.listCorrectionRequests(actor, contextOf(request));
  }
}
