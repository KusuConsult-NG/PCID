import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { AppError } from '../common/errors';
import { contextOf } from '../common/correlation';
import { Database } from '../database/pool';
import { TokenService } from '../security/token.service';
import { IS_PUBLIC, REQUIRES_AAL2 } from './actor';
import { ActorService } from './actor.service';

interface SessionRow {
  id: string;
  actor_type: string;
  government_user_id: string | null;
  citizen_account_id: string | null;
  authentication_level: string;
  aal2_expires_at: Date | null;
  expires_at: Date;
  revoked_at: Date | null;
}

/**
 * Zero trust at the request boundary (master system prompt §43).
 *
 * Being inside the government network grants nothing. Every request presents a
 * token, and the token alone is not enough: the session must still exist and be
 * unrevoked, and the actor is rebuilt from the database so that entitlements are
 * always current rather than whatever they were when the token was minted.
 *
 * The AAL2 window is re-derived here too: a session that stepped up ten minutes
 * ago is back to AAL1 now, without anything having to expire it.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly actors: ActorService,
    private readonly db: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = bearerToken(request);
    if (token === null) {
      throw new AppError('UNAUTHENTICATED', 'Authentication is required.');
    }

    const claims = this.tokens.verify(token);
    if (claims === null) {
      throw new AppError('UNAUTHENTICATED', 'The session is not valid. Sign in again.');
    }

    const session = await this.db.queryOne<SessionRow>(
      `SELECT id, actor_type, government_user_id, citizen_account_id,
              authentication_level, aal2_expires_at, expires_at, revoked_at
         FROM user_session WHERE id = $1`,
      [claims.sid],
    );
    if (
      session === null ||
      session.revoked_at !== null ||
      session.expires_at.getTime() <= Date.now()
    ) {
      throw new AppError('UNAUTHENTICATED', 'The session has ended. Sign in again.');
    }

    const stepUpStillValid =
      session.authentication_level === 'AAL2' &&
      session.aal2_expires_at !== null &&
      session.aal2_expires_at.getTime() > Date.now();
    const authenticationLevel = stepUpStillValid ? 'AAL2' : 'AAL1';

    const actor =
      session.actor_type === 'GOVERNMENT_USER' && session.government_user_id !== null
        ? await this.actors.loadGovernmentActor(
            session.government_user_id,
            session.id,
            authenticationLevel,
          )
        : session.citizen_account_id !== null
          ? await this.actors.loadCitizenActor(
              session.citizen_account_id,
              session.id,
              authenticationLevel,
            )
          : null;

    if (actor === null) {
      throw new AppError('UNAUTHENTICATED', 'The session is not valid. Sign in again.');
    }
    if (actor.subject.accountStatus === 'LOCKED') {
      throw new AppError('ACCOUNT_LOCKED', 'This account is locked. Contact your administrator.');
    }
    if (actor.subject.accountStatus !== 'ACTIVE') {
      throw AppError.denied(
        'This account is not active.',
        `account status ${actor.subject.accountStatus}`,
      );
    }

    const requiresStepUp = this.reflector.getAllAndOverride<boolean>(REQUIRES_AAL2, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requiresStepUp === true && authenticationLevel !== 'AAL2') {
      throw new AppError('STEP_UP_REQUIRED', 'Confirm your identity again to continue.');
    }

    request.pcidActor = actor;
    // Correlate the operator log with the session without logging the token.
    contextOf(request);
    return true;
  }
}

function bearerToken(request: Request): string | null {
  const header = request.header('authorization');
  if (header === undefined) return null;
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || value === undefined || value.length === 0) return null;
  return value;
}
