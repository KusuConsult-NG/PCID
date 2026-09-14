import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';

import { contextOf } from '../common/correlation';
import { AppError } from '../common/errors';
import {
  changePasswordSchema,
  citizenReportSchema,
  confirmCodeSchema,
  correctionRequestSchema,
  credentialRevokeSchema,
  emergencyContactSchema,
  emergencyRequestSchema,
  paginationSchema,
} from '../common/dto';
import { documentRoute } from '../common/openapi/registry';
import { validate } from '../common/zod-validation.pipe';
import { Actor } from '../iam/actor';
import type { AuthenticatedActor } from '../iam/actor';
import { Citizen360Service } from './citizen360.service';
import { CitizenPortalService } from './citizen-portal.service';
import { CitizenSafetyService } from './citizen-safety.service';
import { CitizenSecurityService } from './citizen-security.service';
import { CredentialService } from './credential.service';

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
documentRoute({
  method: 'patch',
  path: '/api/v1/me/emergency-contacts/:contactId',
  tag: 'Citizen portal',
  summary: 'Update an emergency contact',
  description:
    'Changing a contact resets its verification status: the number may now belong to someone else, and an unconfirmed contact should not look confirmed.',
  parameters: [{ name: 'contactId', in: 'path', description: 'Contact id.' }],
  body: emergencyContactSchema,
});
documentRoute({
  method: 'get',
  path: '/api/v1/me/credential',
  tag: 'Citizen portal',
  summary: 'The digital PCID credential and a fresh verification code',
  description:
    'Returns the credential and the URL its QR encodes. The URL ends in an opaque token that carries no name, no PCID and no date of birth, and expires within minutes, so a screenshot of somebody else\u2019s screen stops working. Resolving it requires an authenticated officer.',
});
documentRoute({
  method: 'post',
  path: '/api/v1/me/credential/report-lost',
  tag: 'Citizen portal',
  summary: 'Report the credential lost or stolen',
  description:
    'Revokes the credential and invalidates every code issued against it. The PCID itself is unaffected: a credential can be replaced, an identity cannot.',
  body: credentialRevokeSchema,
});
documentRoute({
  method: 'get',
  path: '/api/v1/me/verification-history',
  tag: 'Citizen portal',
  summary: 'When and by whom this credential has been verified',
});
documentRoute({
  method: 'post',
  path: '/api/v1/me/password',
  tag: 'Citizen portal',
  summary: 'Change the account passphrase',
  description:
    'Ends every other session, which is how somebody recovers an account they think has been used by another person.',
  body: changePasswordSchema,
});
documentRoute({
  method: 'post',
  path: '/api/v1/me/mfa/enrol',
  tag: 'Citizen portal',
  summary: 'Begin adding an authenticator',
  description:
    'Returns the secret once. It is not in force until confirmed, so an interrupted enrolment changes nothing.',
});
documentRoute({
  method: 'post',
  path: '/api/v1/me/mfa/confirm',
  tag: 'Citizen portal',
  summary: 'Confirm the authenticator with a code',
  body: confirmCodeSchema,
});
documentRoute({
  method: 'get',
  path: '/api/v1/me/sessions',
  tag: 'Citizen portal',
  summary: 'Where this account is currently signed in',
});
documentRoute({
  method: 'delete',
  path: '/api/v1/me/sessions/:sessionId',
  tag: 'Citizen portal',
  summary: 'End a session you do not recognise',
  parameters: [{ name: 'sessionId', in: 'path', description: 'Session id.' }],
});
documentRoute({
  method: 'get',
  path: '/api/v1/me/notifications',
  tag: 'Citizen portal',
  summary: 'Messages and alerts for this resident',
});
documentRoute({
  method: 'post',
  path: '/api/v1/me/notifications/:notificationId/read',
  tag: 'Citizen portal',
  summary: 'Mark a notification read',
  parameters: [{ name: 'notificationId', in: 'path', description: 'Notification id.' }],
});
documentRoute({
  method: 'post',
  path: '/api/v1/me/emergency',
  tag: 'Citizen portal',
  summary: 'Raise an emergency',
  description:
    'Creates an incident for the emergency service. Coordinates are shared only if the resident chooses to, are recorded as caller-supplied, and carry a retention date. Without them the registered address is used as a starting point.',
  body: emergencyRequestSchema,
});
documentRoute({
  method: 'post',
  path: '/api/v1/me/reports/identity-fraud',
  tag: 'Citizen portal',
  summary: 'Report that this identity may have been used by someone else',
  body: citizenReportSchema,
});
documentRoute({
  method: 'post',
  path: '/api/v1/me/reports/unauthorised-access',
  tag: 'Citizen portal',
  summary: 'Report an access in the history the resident does not recognise',
  description:
    'Quote the reference shown against the access. The audit record cannot be altered or deleted, so it will still be there when the Data Protection Officer reviews it.',
  body: citizenReportSchema,
});

/**
 * Every route in this controller acts on the caller's own record. A caller that
 * is not a resident is refused here rather than being handed a validation error
 * about an empty identifier further down.
 */
function ownPcid(actor: AuthenticatedActor): string {
  const pcid = actor.subject.subjectPcid;
  if (actor.subject.actorType !== 'CITIZEN' || pcid === null || pcid === undefined) {
    throw AppError.denied(
      'This endpoint is for citizen accounts.',
      'non-citizen actor on portal route',
    );
  }
  return pcid;
}

@Controller('api/v1/me')
export class CitizenPortalController {
  constructor(
    private readonly portal: CitizenPortalService,
    private readonly citizen360: Citizen360Service,
    private readonly credentials: CredentialService,
    private readonly security: CitizenSecurityService,
    private readonly safety: CitizenSafetyService,
  ) {}

  @Get('record')
  async record(@Actor() actor: AuthenticatedActor, @Req() request: Request): Promise<unknown> {
    const pcid = ownPcid(actor);
    return this.citizen360.build(actor, pcid, 'CITIZEN_SELF_SERVICE', {}, contextOf(request));
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

  @Patch('emergency-contacts/:contactId')
  async updateContact(
    @Actor() actor: AuthenticatedActor,
    @Param('contactId') contactId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(emergencyContactSchema, body);
    return this.portal.updateEmergencyContact(
      actor,
      contactId,
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

  @Get('credential')
  async credential(@Actor() actor: AuthenticatedActor, @Req() request: Request): Promise<unknown> {
    return this.credentials.currentForCitizen(actor, contextOf(request));
  }

  @Post('credential/report-lost')
  async reportCredentialLost(
    @Actor() actor: AuthenticatedActor,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(credentialRevokeSchema, body);
    return this.credentials.revokeOwn(actor, input.reason, contextOf(request));
  }

  @Get('verification-history')
  async verificationHistory(
    @Actor() actor: AuthenticatedActor,
    @Query() query: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(paginationSchema, query);
    return this.credentials.verificationHistory(
      actor,
      { limit: input.limit, offset: input.offset },
      contextOf(request),
    );
  }

  @Post('password')
  async changePassword(
    @Actor() actor: AuthenticatedActor,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(changePasswordSchema, body);
    return this.security.changePassword(actor, input, contextOf(request));
  }

  @Post('mfa/enrol')
  async beginMfa(@Actor() actor: AuthenticatedActor, @Req() request: Request): Promise<unknown> {
    return this.security.beginMfaEnrolment(actor, contextOf(request));
  }

  @Post('mfa/confirm')
  async confirmMfa(
    @Actor() actor: AuthenticatedActor,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(confirmCodeSchema, body);
    return this.security.confirmMfaEnrolment(actor, input.code, contextOf(request));
  }

  @Get('sessions')
  async sessions(@Actor() actor: AuthenticatedActor, @Req() request: Request): Promise<unknown> {
    return this.security.listSessions(actor, contextOf(request));
  }

  @Delete('sessions/:sessionId')
  async endSession(
    @Actor() actor: AuthenticatedActor,
    @Param('sessionId') sessionId: string,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.security.revokeSession(actor, sessionId, contextOf(request));
  }

  @Get('notifications')
  async notifications(
    @Actor() actor: AuthenticatedActor,
    @Query() query: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(paginationSchema, query);
    return this.safety.listNotifications(
      actor,
      { limit: input.limit, offset: input.offset },
      contextOf(request),
    );
  }

  @Post('notifications/:notificationId/read')
  async markNotificationRead(
    @Actor() actor: AuthenticatedActor,
    @Param('notificationId') notificationId: string,
  ): Promise<unknown> {
    return this.safety.markNotificationRead(actor, notificationId);
  }

  @Post('emergency')
  async raiseEmergency(
    @Actor() actor: AuthenticatedActor,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(emergencyRequestSchema, body);
    return this.safety.raiseEmergency(
      actor,
      {
        type: input.type as never,
        description: input.description,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        contactPhone: input.contactPhone ?? null,
      },
      contextOf(request),
    );
  }

  @Post('reports/identity-fraud')
  async reportIdentityFraud(
    @Actor() actor: AuthenticatedActor,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(citizenReportSchema, body);
    return this.safety.reportIdentityFraud(
      actor,
      { description: input.description, accessReference: input.accessReference ?? null },
      contextOf(request),
    );
  }

  @Post('reports/unauthorised-access')
  async reportUnauthorisedAccess(
    @Actor() actor: AuthenticatedActor,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(citizenReportSchema, body);
    return this.safety.reportUnauthorisedAccess(
      actor,
      { description: input.description, accessReference: input.accessReference ?? null },
      contextOf(request),
    );
  }
}
