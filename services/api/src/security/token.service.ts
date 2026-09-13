import { createHmac, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { decodeKey } from './crypto.service';

export interface AccessTokenClaims {
  /** Subject: the government user id or citizen account id. */
  readonly sub: string;
  /** Session id, so a revoked session invalidates its tokens immediately. */
  readonly sid: string;
  readonly act: 'GOVERNMENT_USER' | 'CITIZEN' | 'API_CLIENT';
  readonly aal: 'AAL1' | 'AAL2';
  readonly iss: string;
  readonly aud: string;
  readonly iat: number;
  readonly exp: number;
  readonly jti: string;
}

const ISSUER = 'pcid.plateaustate.gov.ng';
const AUDIENCE = 'pcid-api';
const ALGORITHM = 'HS256';

/**
 * Access tokens (master system prompt §42).
 *
 * A deliberately minimal JWS: one algorithm, fixed issuer and audience, and no
 * algorithm negotiation on the verify path - the header is required to be exactly
 * `{"alg":"HS256","typ":"JWT"}`, which removes the algorithm-confusion class of
 * attack by construction rather than by careful configuration.
 *
 * The token carries identity and assurance level only. Roles, agency standing
 * and clearance are read from the database on every request, so revoking a role
 * or suspending an agency takes effect on the next call rather than when the
 * token happens to expire.
 */
@Injectable()
export class TokenService {
  private readonly key: Buffer;
  private readonly ttlSeconds: number;

  constructor(@Inject(ENV) env: Env) {
    this.key = decodeKey(env.TOKEN_SIGNING_KEY);
    this.ttlSeconds = env.ACCESS_TOKEN_TTL_SECONDS;
  }

  issue(input: {
    subject: string;
    sessionId: string;
    actorType: AccessTokenClaims['act'];
    authenticationLevel: AccessTokenClaims['aal'];
    jti: string;
    nowSeconds?: number;
  }): { token: string; expiresAt: Date; claims: AccessTokenClaims } {
    const iat = input.nowSeconds ?? Math.floor(Date.now() / 1000);
    const claims: AccessTokenClaims = {
      sub: input.subject,
      sid: input.sessionId,
      act: input.actorType,
      aal: input.authenticationLevel,
      iss: ISSUER,
      aud: AUDIENCE,
      iat,
      exp: iat + this.ttlSeconds,
      jti: input.jti,
    };
    const header = encode(JSON.stringify({ alg: ALGORITHM, typ: 'JWT' }));
    const payload = encode(JSON.stringify(claims));
    const signature = this.sign(`${header}.${payload}`);
    return {
      token: `${header}.${payload}.${signature}`,
      expiresAt: new Date(claims.exp * 1000),
      claims,
    };
  }

  /** Returns the claims, or null for any token that is not valid right now. */
  verify(
    token: string,
    nowSeconds: number = Math.floor(Date.now() / 1000),
  ): AccessTokenClaims | null {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payload, signature] = parts as [string, string, string];

    let decodedHeader: unknown;
    try {
      decodedHeader = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    if (
      typeof decodedHeader !== 'object' ||
      decodedHeader === null ||
      (decodedHeader as Record<string, unknown>).alg !== ALGORITHM ||
      (decodedHeader as Record<string, unknown>).typ !== 'JWT'
    ) {
      return null;
    }

    const expected = this.sign(`${header}.${payload}`);
    const provided = Buffer.from(signature, 'utf8');
    const computed = Buffer.from(expected, 'utf8');
    if (provided.length !== computed.length || !timingSafeEqual(provided, computed)) return null;

    let claims: AccessTokenClaims;
    try {
      claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AccessTokenClaims;
    } catch {
      return null;
    }
    if (claims.iss !== ISSUER || claims.aud !== AUDIENCE) return null;
    if (typeof claims.exp !== 'number' || claims.exp <= nowSeconds) return null;
    if (typeof claims.iat !== 'number' || claims.iat > nowSeconds + 60) return null;
    if (typeof claims.sub !== 'string' || typeof claims.sid !== 'string') return null;
    if (
      claims.act !== 'GOVERNMENT_USER' &&
      claims.act !== 'CITIZEN' &&
      claims.act !== 'API_CLIENT'
    ) {
      return null;
    }
    if (claims.aal !== 'AAL1' && claims.aal !== 'AAL2') return null;
    return claims;
  }

  private sign(input: string): string {
    return createHmac('sha256', this.key).update(input, 'utf8').digest('base64url');
  }
}

function encode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}
