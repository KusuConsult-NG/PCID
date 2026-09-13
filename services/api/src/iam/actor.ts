import { SetMetadata, createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { PolicySubject } from '@pcid/policy';
import type { Request } from 'express';

import { AppError } from '../common/errors';

/**
 * The authenticated caller, assembled fresh on every request from the session,
 * the user record and the agency registry. Nothing here comes from the token
 * beyond identity and assurance level, so a revoked role or a suspended agency
 * takes effect immediately (§43).
 */
export interface AuthenticatedActor {
  readonly sessionId: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly agencyCode: string | null;
  readonly agencyName: string | null;
  readonly subject: PolicySubject;
}

declare module 'express-serve-static-core' {
  interface Request {
    pcidActor?: AuthenticatedActor;
  }
}

export const IS_PUBLIC = 'pcid:public';
/** Marks a route reachable without authentication. Used sparingly and audited. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);

export const REQUIRES_AAL2 = 'pcid:requires-aal2';
/** Requires a freshly re-authenticated session, over and above the action's own rule. */
export const RequiresStepUp = (): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRES_AAL2, true);

export const Actor = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<Request>();
  const actor = request.pcidActor;
  if (actor === undefined) {
    throw new AppError('UNAUTHENTICATED', 'Authentication is required.');
  }
  return actor;
});
