import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';

import { contextOf } from '../common/correlation';
import {
  agencySchema,
  agencyStatusSchema,
  changePasswordSchema,
  classificationSchema,
  userQueueSchema,
  uuidSchema,
} from '../common/dto';
import { documentRoute } from '../common/openapi/registry';
import { validate } from '../common/zod-validation.pipe';
import { Actor, RequiresStepUp } from './actor';
import type { AuthenticatedActor } from './actor';
import { GovernmentAccountService } from './account.service';
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
  actions: ['ADMIN_AGENCY_MANAGE'],
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
  actions: ['ADMIN_AGENCY_MANAGE'],
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
  actions: ['ADMIN_AGENCY_MANAGE'],
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
  actions: ['ADMIN_POLICY_MANAGE'],
});
documentRoute({
  method: 'get',
  path: '/api/v1/users',
  tag: 'Administration',
  summary: 'Government users, for access review',
  description:
    'Carries what an access review turns on: whether the account is still active, whether its ' +
    'authenticator was ever confirmed, what roles it holds and when it was last used. It carries ' +
    'no citizen data - administering the platform is not an entitlement to the register. An ' +
    'administrator who is not a platform administrator sees their own agency only.',
  parameters: [
    {
      name: 'agencyId',
      in: 'query',
      description: 'Platform administrators only; ignored otherwise.',
    },
    { name: 'status', in: 'query', description: 'Filter by account status.' },
  ],
  actions: ['ADMIN_USER_MANAGE'],
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
  actions: ['ADMIN_USER_MANAGE'],
});
documentRoute({
  method: 'post',
  path: '/api/v1/users/me/mfa/confirm',
  tag: 'Administration',
  summary: 'Confirm your own authenticator enrolment',
  body: confirmMfaSchema,
});
documentRoute({
  method: 'post',
  path: '/api/v1/users/me/password',
  tag: 'Administration',
  summary: 'Change your own passphrase',
  description:
    'An account is created with a passphrase an administrator chose and typed, and is flagged to ' +
    'change it. This is how it gets changed: until it is, the officer and the administrator share ' +
    'the secret. Changing it ends every other session for the account.',
  body: changePasswordSchema,
});
documentRoute({
  method: 'get',
  path: '/api/v1/users/me/sessions',
  tag: 'Administration',
  summary: 'Where your own account is currently signed in',
  description:
    'Deliberately coarse about the device. A fingerprint precise enough to be useful here would be ' +
    'precise enough to track somebody with.',
});
documentRoute({
  method: 'delete',
  path: '/api/v1/users/me/sessions/:sessionId',
  tag: 'Administration',
  summary: 'End one of your own sessions',
  description: 'For the counter machine you walked away from.',
  parameters: [{ name: 'sessionId', in: 'path', description: 'Session id.' }],
});

@Controller('api/v1')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly accounts: GovernmentAccountService,
  ) {}

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

  @Post('users/me/password')
  async changeOwnPassword(
    @Actor() actor: AuthenticatedActor,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(changePasswordSchema, body);
    return this.accounts.changePassword(
      actor,
      { currentPassword: input.currentPassword, newPassword: input.newPassword },
      contextOf(request),
    );
  }

  @Get('users/me/sessions')
  async ownSessions(@Actor() actor: AuthenticatedActor): Promise<unknown> {
    return this.accounts.listSessions(actor);
  }

  @Delete('users/me/sessions/:sessionId')
  async endOwnSession(
    @Actor() actor: AuthenticatedActor,
    @Param('sessionId') sessionId: string,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.accounts.revokeSession(actor, sessionId, contextOf(request));
  }

  @Get('users')
  async listUsers(
    @Actor() actor: AuthenticatedActor,
    @Query() query: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(userQueueSchema, query);
    return this.admin.listUsers(
      actor,
      {
        ...(input.agencyId !== undefined ? { agencyId: input.agencyId } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        limit: input.limit,
        offset: input.offset,
      },
      contextOf(request),
    );
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
