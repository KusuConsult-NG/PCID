import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import type { Request } from 'express';

import { contextOf } from '../common/correlation';
import { documentRoute } from '../common/openapi/registry';
import { citizenLoginSchema, loginSchema, mfaVerifySchema, refreshSchema } from '../common/dto';
import { validate } from '../common/zod-validation.pipe';
import { Actor, Public } from './actor';
import type { AuthenticatedActor } from './actor';
import { AuthService } from './auth.service';

documentRoute({
  method: 'post',
  path: '/api/v1/auth/login',
  tag: 'Authentication',
  summary: 'Sign in a government user with a password',
  description:
    'Establishes a session at AAL1. A government user must then present their second factor: ' +
    'AAL1 alone authorises nothing that touches citizen information.',
  body: loginSchema,
  public: true,
  responses: {
    '401': 'The email address or password is not correct.',
    '423': 'The account is locked.',
  },
});
documentRoute({
  method: 'post',
  path: '/api/v1/auth/citizen/login',
  tag: 'Authentication',
  summary: 'Sign in a citizen with their PCID or email address',
  body: citizenLoginSchema,
  public: true,
});
documentRoute({
  method: 'post',
  path: '/api/v1/auth/mfa/verify',
  tag: 'Authentication',
  summary: 'Present a second factor and raise the session to AAL2',
  description:
    'A verified code raises the session for a bounded window. The matched time step is stored, ' +
    'so the same code cannot be presented twice. Recovery codes are single use.',
  body: mfaVerifySchema,
  public: true,
});
documentRoute({
  method: 'post',
  path: '/api/v1/auth/refresh',
  tag: 'Authentication',
  summary: 'Rotate a refresh token',
  description:
    'Refresh tokens rotate on every use. Presenting a token that was already rotated revokes the ' +
    'whole session family, which is how a stolen token is caught.',
  body: refreshSchema,
  public: true,
});
documentRoute({
  method: 'post',
  path: '/api/v1/auth/logout',
  tag: 'Authentication',
  summary: 'End the current session',
});
documentRoute({
  method: 'get',
  path: '/api/v1/auth/me',
  tag: 'Authentication',
  summary: 'Describe the authenticated caller and what they are currently entitled to do',
});

@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  async login(@Body() body: unknown, @Req() request: Request): Promise<unknown> {
    const input = validate(loginSchema, body);
    return this.auth.loginGovernmentUser(input.email, input.password, contextOf(request));
  }

  @Public()
  @Post('citizen/login')
  async citizenLogin(@Body() body: unknown, @Req() request: Request): Promise<unknown> {
    const input = validate(citizenLoginSchema, body);
    return this.auth.loginCitizen(input.identifier, input.password, contextOf(request));
  }

  @Public()
  @Post('mfa/verify')
  async verifyMfa(@Body() body: unknown, @Req() request: Request): Promise<unknown> {
    const input = validate(mfaVerifySchema, body);
    return this.auth.verifyMfa(input.sessionId, input.code, contextOf(request));
  }

  @Public()
  @Post('refresh')
  async refresh(@Body() body: unknown, @Req() request: Request): Promise<unknown> {
    const input = validate(refreshSchema, body);
    return this.auth.refresh(input.refreshToken, contextOf(request));
  }

  @Post('logout')
  async logout(@Actor() actor: AuthenticatedActor, @Req() request: Request): Promise<{ ok: true }> {
    await this.auth.logout(actor.sessionId, contextOf(request));
    return { ok: true };
  }

  @Get('me')
  me(@Actor() actor: AuthenticatedActor): unknown {
    return {
      id: actor.subject.userId,
      displayName: actor.displayName,
      email: actor.email,
      actorType: actor.subject.actorType,
      agency: {
        id: actor.subject.agencyId,
        code: actor.agencyCode,
        name: actor.agencyName,
        category: actor.subject.agencyCategory,
        status: actor.subject.agencyStatus,
        dataSharingAgreement: actor.subject.dataSharingAgreement,
      },
      roles: actor.subject.roles,
      // The resolved action list is what the policy engine actually reads, so the
      // interface can disable what the account genuinely cannot do rather than
      // guessing from role names.
      actions: actor.subject.actions,
      clearance: actor.subject.clearance,
      compartments: actor.subject.compartments,
      jurisdiction: actor.subject.jurisdiction,
      authenticationLevel: actor.subject.authenticationLevel,
      mfaEnrolled: actor.subject.mfaEnrolled,
      subjectPcid: actor.subject.subjectPcid,
    };
  }
}
