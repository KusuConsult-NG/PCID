import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';

import { contextOf } from '../common/correlation';
import { agencySchema, agencyStatusSchema, classificationSchema, uuidSchema } from '../common/dto';
import { documentRoute } from '../common/openapi/registry';
import { validate } from '../common/zod-validation.pipe';
import { Actor, RequiresStepUp } from './actor';
import type { AuthenticatedActor } from './actor';
import { AdminService } from './admin.service';
import type { CreateAgencyInput, CreateUserInput } from './admin.service';

const createUserSchema = z.object({
  email: z.string().email().max(320),
  fullName: z.string().min(2).max(200),
  agencyId: uuidSchema,
  roles: z.array(z.string().min(2).max(64)).min(1).max(10),
  clearance: classificationSchema.default('INTERNAL'),
  jurisdictionScope: z.enum(['STATE', 'LGA', 'WARD']).default('STATE'),
  jurisdictionLgaCodes: z.array(z.string().max(16)).default([]),
  jurisdictionWardCodes: z.array(z.string().max(24)).default([]),
  temporaryPassword: z.string().min(14).max(256),
});

const compartmentSchema = z.object({ legalBasis: z.string().min(20).max(2000) });
const confirmMfaSchema = z.object({ code: z.string().min(4).max(16) });

documentRoute({
  method: 'get',
  path: '/api/v1/agencies',
  tag: 'Administration',
  summary: 'List agencies in the Government Agency Registry',
});
documentRoute({
  method: 'post',
  path: '/api/v1/agencies',
  tag: 'Administration',
  summary: 'Register an agency',
  description:
    'A new agency starts INACTIVE with no data-sharing agreement, so registering one grants nothing ' +
    'until it is deliberately activated.',
  body: agencySchema,
  requiresStepUp: true,
});
documentRoute({
  method: 'patch',
  path: '/api/v1/agencies/:agencyId/status',
  tag: 'Administration',
  summary: 'Activate, suspend or update an agency’s data-sharing agreement',
  description:
    'Citizen access stops the moment the agreement lapses: the expiry is evaluated on every request ' +
    'rather than by a background job.',
  parameters: [{ name: 'agencyId', in: 'path', description: 'Agency id.' }],
  body: agencyStatusSchema,
  requiresStepUp: true,
});
documentRoute({
  method: 'post',
  path: '/api/v1/agencies/:agencyId/compartments/law-enforcement',
  tag: 'Administration',
  summary: 'Grant the law-enforcement compartment to an agency',
  description:
    'Requires a stated legal basis and an eligible agency category. Compartments are held as ' +
    'registry data so that no agency name ever appears in authorisation logic.',
  parameters: [{ name: 'agencyId', in: 'path', description: 'Agency id.' }],
  body: compartmentSchema,
  requiresStepUp: true,
});
documentRoute({
  method: 'post',
  path: '/api/v1/users',
  tag: 'Administration',
  summary: 'Create a government user',
  description:
    'Returns the authenticator enrolment material once. The account cannot reach citizen data until ' +
    'the authenticator is confirmed, because the policy engine refuses a government user who is ' +
    'not MFA-enrolled.',
  body: createUserSchema,
  requiresStepUp: true,
});
documentRoute({
  method: 'post',
  path: '/api/v1/users/me/mfa/confirm',
  tag: 'Administration',
  summary: 'Confirm your own authenticator enrolment',
  body: confirmMfaSchema,
});

@Controller('api/v1')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('agencies')
  async listAgencies(
    @Actor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.admin.listAgencies(actor, contextOf(request));
  }

  @RequiresStepUp()
  @Post('agencies')
  async createAgency(
    @Actor() actor: AuthenticatedActor,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(agencySchema, body);
    return this.admin.createAgency(
      actor,
      input as unknown as CreateAgencyInput,
      contextOf(request),
    );
  }

  @RequiresStepUp()
  @Patch('agencies/:agencyId/status')
  async updateAgencyStatus(
    @Actor() actor: AuthenticatedActor,
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(agencyStatusSchema, body);
    return this.admin.updateAgencyStatus(
      actor,
      agencyId,
      {
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.dataSharingAgreement !== undefined
          ? { dataSharingAgreement: input.dataSharingAgreement }
          : {}),
        ...(input.dataSharingExpiresAt !== undefined && input.dataSharingExpiresAt !== null
          ? { dataSharingExpiresAt: input.dataSharingExpiresAt }
          : {}),
        ...(input.apiIntegrationStatus !== undefined
          ? { apiIntegrationStatus: input.apiIntegrationStatus }
          : {}),
      },
      contextOf(request),
    );
  }

  @RequiresStepUp()
  @Post('agencies/:agencyId/compartments/law-enforcement')
  async grantCompartment(
    @Actor() actor: AuthenticatedActor,
    @Param('agencyId') agencyId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(compartmentSchema, body);
    return this.admin.grantCompartment(actor, agencyId, input.legalBasis, contextOf(request));
  }

  @RequiresStepUp()
  @Post('users')
  async createUser(
    @Actor() actor: AuthenticatedActor,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(createUserSchema, body);
    return this.admin.createUser(actor, input as unknown as CreateUserInput, contextOf(request));
  }

  @Post('users/me/mfa/confirm')
  async confirmMfa(
    @Actor() actor: AuthenticatedActor,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(confirmMfaSchema, body);
    return this.admin.confirmMfa(actor, input.code, contextOf(request));
  }
}
