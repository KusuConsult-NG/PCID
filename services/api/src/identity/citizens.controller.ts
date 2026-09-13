import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Purpose } from '@pcid/contracts';
import type { Request } from 'express';

import { contextOf } from '../common/correlation';
import {
  citizenSearchSchema,
  citizenViewQuerySchema,
  accessReferencesSchema,
  duplicateReviewSchema,
  registrationSchema,
  verifySchema,
} from '../common/dto';
import { documentRoute } from '../common/openapi/registry';
import { validate } from '../common/zod-validation.pipe';
import { Actor } from '../iam/actor';
import type { AuthenticatedActor } from '../iam/actor';
import { Citizen360Service } from './citizen360.service';
import { CitizensService } from './citizens.service';
import { CitizenAccountService } from './citizen-account.service';
import { RegistrationService } from './registration.service';
import type { RegistrationInput } from './registration.service';

documentRoute({
  method: 'get',
  path: '/api/v1/citizens',
  tag: 'Citizens',
  summary: 'Search the citizen registry',
  description:
    'Returns a deliberately thin projection - enough to confirm you have the right person, and ' +
    'nothing more. A full record is obtained by viewing it under a stated authority. Searches are ' +
    'rate limited per account and an unusual volume raises a security alert for review.',
  parameters: [
    {
      name: 'purpose',
      in: 'query',
      required: true,
      description: 'The lawful purpose for this search.',
    },
    { name: 'pcid', in: 'query', description: 'Exact Plateau Citizen ID.' },
    { name: 'name', in: 'query', description: 'Name, matched approximately.' },
    { name: 'phone', in: 'query', description: 'Telephone number, matched exactly.' },
    { name: 'dateOfBirth', in: 'query', description: 'Date of birth, matched exactly.' },
    { name: 'caseRef', in: 'query', description: 'Case authorising an investigative search.' },
    { name: 'incidentRef', in: 'query', description: 'Incident authorising an emergency search.' },
  ],
});
documentRoute({
  method: 'get',
  path: '/api/v1/citizens/:pcid',
  tag: 'Citizens',
  summary: 'View a citizen record',
  description:
    'Field-by-field release governed by the data catalogue. Fields withheld are listed in ' +
    'restrictedFields so the interface can show "Restricted information" rather than implying absence.',
  parameters: [
    { name: 'pcid', in: 'path', description: 'Plateau Citizen ID.' },
    {
      name: 'purpose',
      in: 'query',
      required: true,
      description: 'The lawful purpose for this access.',
    },
    { name: 'caseRef', in: 'query', description: 'Case the access is made under (§22).' },
    { name: 'incidentRef', in: 'query', description: 'Incident the access is made under.' },
    {
      name: 'breakGlassRef',
      in: 'query',
      description: 'Break-glass grant being relied upon (§23).',
    },
  ],
});
documentRoute({
  method: 'get',
  path: '/api/v1/citizens/:pcid/360',
  tag: 'Citizens',
  summary: 'Citizen 360 view, card by card',
  description:
    'Every card is authorised independently. Cards the caller may not see are returned with ' +
    'status RESTRICTED and a reason; for most callers most cards are restricted, which is intended.',
  parameters: [
    { name: 'pcid', in: 'path', description: 'Plateau Citizen ID.' },
    {
      name: 'purpose',
      in: 'query',
      required: true,
      description: 'The lawful purpose for this access.',
    },
    { name: 'caseRef', in: 'query', description: 'Case the access is made under.' },
    { name: 'incidentRef', in: 'query', description: 'Incident the access is made under.' },
  ],
});
documentRoute({
  method: 'get',
  path: '/api/v1/citizens/:pcid/emergency-profile',
  tag: 'Emergency',
  summary: 'Minimum Necessary Emergency Profile',
  description:
    'The only citizen data a field responder receives: name, approximate age, sex, photograph ' +
    'reference, emergency contacts and - where the responder is cleared and the purpose is ' +
    'emergency response - blood group and disclosed critical conditions. Requires an active ' +
    'incident the caller or their agency is assigned to.',
  parameters: [
    {
      name: 'pcid',
      in: 'path',
      description: 'Plateau Citizen ID, typically read from the credential QR.',
    },
    {
      name: 'incidentRef',
      in: 'query',
      required: true,
      description: 'The active incident being attended.',
    },
    {
      name: 'breakGlassRef',
      in: 'query',
      description: 'Break-glass grant, where there was no time to be assigned.',
    },
  ],
});
documentRoute({
  method: 'post',
  path: '/api/v1/verification/pcid',
  tag: 'Verification',
  summary: 'Verify that a presented PCID is live',
  description:
    'Answers only whether the identifier matches an active record, at what assurance level, and ' +
    'the name printed on the credential. It releases no other attribute.',
  body: verifySchema,
});
documentRoute({
  method: 'post',
  path: '/api/v1/citizens',
  tag: 'Citizens',
  summary: 'Register a resident and issue a Plateau Citizen ID',
  description:
    'Runs duplicate detection before allocating an identifier. A close match stops the ' +
    'registration and queues it for human review; no identifier is issued and nothing is merged. ' +
    'A NIN is accepted where an authoritative source supplied one and is never required.',
  body: registrationSchema,
  responses: {
    '200': 'Either an issued PCID, or a DUPLICATE_REVIEW outcome with the matching factors.',
  },
});
documentRoute({
  method: 'post',
  path: '/api/v1/citizens/:pcid/portal-account',
  tag: 'Citizens',
  summary: 'Issue citizen portal credentials at a registration desk',
  description:
    'Deliberately not self-service: an open enrolment endpoint on a state identity registry would ' +
    'let anyone who knows a PCID claim the record. The temporary passphrase is shown once.',
  parameters: [{ name: 'pcid', in: 'path', description: 'Plateau Citizen ID.' }],
});
documentRoute({
  method: 'post',
  path: '/api/v1/citizens/duplicates/:candidateId/review',
  tag: 'Citizens',
  summary: 'Resolve a queued duplicate candidate',
  description: 'Records a named officer’s decision. Records are never merged automatically.',
  parameters: [{ name: 'candidateId', in: 'path', description: 'Duplicate candidate id.' }],
  body: duplicateReviewSchema,
});

@Controller('api/v1')
export class CitizensController {
  constructor(
    private readonly citizens: CitizensService,
    private readonly citizen360: Citizen360Service,
    private readonly registration: RegistrationService,
    private readonly accounts: CitizenAccountService,
  ) {}

  @Get('citizens')
  async search(
    @Actor() actor: AuthenticatedActor,
    @Query() query: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(citizenSearchSchema, query);
    return this.citizens.search(
      actor,
      input.purpose as Purpose,
      {
        ...(input.pcid !== undefined ? { pcid: input.pcid } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.dateOfBirth !== undefined ? { dateOfBirth: input.dateOfBirth } : {}),
        ...(input.lgaCode !== undefined ? { lgaCode: input.lgaCode } : {}),
        ...(input.wardCode !== undefined ? { wardCode: input.wardCode } : {}),
        limit: input.limit,
        offset: input.offset,
      },
      {
        caseRef: input.caseRef ?? null,
        incidentRef: input.incidentRef ?? null,
        breakGlassRef: input.breakGlassRef ?? null,
      },
      contextOf(request),
    );
  }

  @Get('citizens/:pcid')
  async view(
    @Actor() actor: AuthenticatedActor,
    @Param('pcid') pcid: string,
    @Query() query: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(citizenViewQuerySchema, query);
    return this.citizens.view(
      actor,
      pcid,
      input.purpose as Purpose,
      {
        caseRef: input.caseRef ?? null,
        incidentRef: input.incidentRef ?? null,
        breakGlassRef: input.breakGlassRef ?? null,
      },
      contextOf(request),
    );
  }

  @Get('citizens/:pcid/360')
  async view360(
    @Actor() actor: AuthenticatedActor,
    @Param('pcid') pcid: string,
    @Query() query: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(citizenViewQuerySchema, query);
    return this.citizen360.build(
      actor,
      pcid,
      input.purpose as Purpose,
      {
        caseRef: input.caseRef ?? null,
        incidentRef: input.incidentRef ?? null,
        breakGlassRef: input.breakGlassRef ?? null,
      },
      contextOf(request),
    );
  }

  @Get('citizens/:pcid/emergency-profile')
  async emergencyProfile(
    @Actor() actor: AuthenticatedActor,
    @Param('pcid') pcid: string,
    @Query() query: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(accessReferencesSchema, query);
    return this.citizens.emergencyProfile(
      actor,
      pcid,
      {
        incidentRef: input.incidentRef ?? null,
        breakGlassRef: input.breakGlassRef ?? null,
      },
      contextOf(request),
    );
  }

  @Post('verification/pcid')
  async verify(
    @Actor() actor: AuthenticatedActor,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(verifySchema, body);
    return this.citizens.verify(actor, input.pcid, contextOf(request));
  }

  @Post('citizens')
  async register(
    @Actor() actor: AuthenticatedActor,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(registrationSchema, body);
    return this.registration.register(
      actor,
      input as unknown as RegistrationInput,
      contextOf(request),
    );
  }

  @Post('citizens/:pcid/portal-account')
  async issuePortalAccount(
    @Actor() actor: AuthenticatedActor,
    @Param('pcid') pcid: string,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.accounts.issuePortalCredentials(actor, pcid, contextOf(request));
  }

  @Post('citizens/duplicates/:candidateId/review')
  async reviewDuplicate(
    @Actor() actor: AuthenticatedActor,
    @Param('candidateId') candidateId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = validate(duplicateReviewSchema, body);
    return this.registration.reviewDuplicate(
      actor,
      candidateId,
      input.decision,
      input.note,
      contextOf(request),
    );
  }
}
