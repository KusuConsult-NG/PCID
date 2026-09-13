import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { AppError } from '../common/errors';
import { logger } from '../common/logger';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { Database } from '../database/pool';
import { AuditService } from '../audit/audit.service';
import { CryptoService, newOpaqueToken, opaqueTokenHash } from '../security/crypto.service';
import { PasswordService } from '../security/password.service';
import { RateLimiter } from '../security/rate-limit';
import { TokenService } from '../security/token.service';
import { TotpService } from '../security/totp.service';
import type { RequestContext } from '../common/correlation';

export interface LoginResult {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: string;
  readonly authenticationLevel: 'AAL1' | 'AAL2';
  readonly mfaRequired: boolean;
  readonly mustChangePassword: boolean;
  readonly actor: {
    readonly id: string;
    readonly displayName: string;
    readonly actorType: 'GOVERNMENT_USER' | 'CITIZEN';
    readonly agencyCode: string | null;
    readonly roles: readonly string[];
  };
}

interface AuthenticatableRow {
  id: string;
  status: string;
  password_hash: string;
  password_algorithm: string;
  password_params: Record<string, unknown>;
  mfa_enrolled: boolean;
  failed_login_count: number;
  locked_until: Date | null;
  must_change_password?: boolean;
  full_name?: string;
  display_name?: string | null;
}

/**
 * Authentication (master system prompt §42).
 *
 * Sign-in is two steps by design for government users: password establishes a
 * session at AAL1, which alone authorises nothing that touches citizen data,
 * because the policy engine refuses a government user who is not MFA-enrolled
 * and refuses step-up actions below AAL2. The second factor raises the session.
 *
 * Failure handling is uniform: the same message and, as far as practical, the
 * same cost whether the account exists, the password was wrong, or the account is
 * locked - so the endpoint is not a directory of who works for the government.
 */
@Injectable()
export class AuthService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: Database,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly totp: TotpService,
    private readonly crypto: CryptoService,
    private readonly limiter: RateLimiter,
    private readonly audit: AuditService,
  ) {}

  async loginGovernmentUser(
    email: string,
    password: string,
    context: RequestContext,
  ): Promise<LoginResult> {
    await this.enforceLoginRateLimit(email, context);

    const row = await this.db.queryOne<AuthenticatableRow & { full_name: string }>(
      `SELECT id, status, password_hash, password_algorithm, password_params, mfa_enrolled,
              failed_login_count, locked_until, must_change_password, full_name
         FROM government_user WHERE lower(email) = lower($1)`,
      [email],
    );

    const verified = await this.passwords.verify(
      password,
      row === null
        ? null
        : {
            hash: row.password_hash,
            algorithm: row.password_algorithm,
            params: row.password_params,
          },
    );

    if (row === null || !verified) {
      await this.recordFailure(
        email,
        'GOVERNMENT_USER',
        row?.id ?? null,
        context,
        'BAD_CREDENTIALS',
      );
      throw new AppError('UNAUTHENTICATED', 'The email address or password is not correct.');
    }
    if (row.locked_until !== null && row.locked_until.getTime() > Date.now()) {
      await this.recordFailure(email, 'GOVERNMENT_USER', row.id, context, 'ACCOUNT_LOCKED');
      throw new AppError('ACCOUNT_LOCKED', 'This account is locked. Contact your administrator.');
    }
    if (row.status !== 'ACTIVE') {
      await this.recordFailure(email, 'GOVERNMENT_USER', row.id, context, 'ACCOUNT_NOT_ACTIVE');
      throw new AppError('UNAUTHENTICATED', 'The email address or password is not correct.');
    }

    await this.db.query(
      'UPDATE government_user SET failed_login_count = 0, locked_until = NULL, last_login_at = now() WHERE id = $1',
      [row.id],
    );
    await this.limiter.reset(`login:${email.toLowerCase()}`);

    const session = await this.createSession('GOVERNMENT_USER', row.id, context);
    const roles = await this.db.query<{ name: string }>(
      `SELECT r.name FROM user_role ur JOIN role r ON r.id = ur.role_id WHERE ur.user_id = $1`,
      [row.id],
    );
    const agency = await this.db.queryOne<{ code: string }>(
      'SELECT a.code FROM government_user u JOIN agency a ON a.id = u.agency_id WHERE u.id = $1',
      [row.id],
    );

    await this.recordSuccess(email, 'GOVERNMENT_USER', row.id, context);
    await this.audit.record({
      action: 'AUTHENTICATE',
      outcome: 'PERMITTED',
      actorType: 'GOVERNMENT_USER',
      actorId: row.id,
      actorDisplay: row.full_name,
      resourceType: 'GOVERNMENT_USER',
      resourceId: row.id,
      correlationId: context.correlationId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      deviceFingerprint: context.deviceFingerprint,
      detail: { step: 'PASSWORD', mfaRequired: row.mfa_enrolled },
    });

    return {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt.toISOString(),
      authenticationLevel: 'AAL1',
      mfaRequired: row.mfa_enrolled,
      mustChangePassword: row.must_change_password === true,
      actor: {
        id: row.id,
        displayName: row.full_name,
        actorType: 'GOVERNMENT_USER',
        agencyCode: agency?.code ?? null,
        roles: roles.map((role) => role.name),
      },
    };
  }

  async loginCitizen(
    identifier: string,
    password: string,
    context: RequestContext,
  ): Promise<LoginResult> {
    await this.enforceLoginRateLimit(identifier, context);

    const row = await this.db.queryOne<
      AuthenticatableRow & { pcid: string; display_name: string | null }
    >(
      `SELECT ca.id, ca.status, ca.password_hash, ca.password_algorithm, ca.password_params,
              ca.mfa_enrolled, ca.failed_login_count, ca.locked_until, ca.pcid, c.display_name
         FROM citizen_account ca
         LEFT JOIN citizen c ON c.pcid = ca.pcid
        WHERE lower(ca.email) = lower($1) OR ca.pcid = upper($1)`,
      [identifier],
    );

    const verified = await this.passwords.verify(
      password,
      row === null
        ? null
        : {
            hash: row.password_hash,
            algorithm: row.password_algorithm,
            params: row.password_params,
          },
    );
    if (row === null || !verified || row.status !== 'ACTIVE') {
      await this.recordFailure(identifier, 'CITIZEN', row?.id ?? null, context, 'BAD_CREDENTIALS');
      throw new AppError('UNAUTHENTICATED', 'Those sign-in details are not correct.');
    }
    if (row.locked_until !== null && row.locked_until.getTime() > Date.now()) {
      throw new AppError('ACCOUNT_LOCKED', 'This account is locked. Contact support.');
    }

    await this.db.query(
      'UPDATE citizen_account SET failed_login_count = 0, locked_until = NULL, last_login_at = now() WHERE id = $1',
      [row.id],
    );
    const session = await this.createSession('CITIZEN', row.id, context);
    await this.recordSuccess(identifier, 'CITIZEN', row.id, context);
    await this.audit.record({
      action: 'AUTHENTICATE',
      outcome: 'PERMITTED',
      actorType: 'CITIZEN',
      actorId: row.id,
      subjectPcid: row.pcid,
      resourceType: 'CITIZEN',
      resourceId: row.pcid,
      correlationId: context.correlationId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      detail: { step: 'PASSWORD' },
    });

    return {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt.toISOString(),
      authenticationLevel: 'AAL1',
      mfaRequired: row.mfa_enrolled,
      mustChangePassword: false,
      actor: {
        id: row.id,
        displayName: row.display_name ?? 'Citizen',
        actorType: 'CITIZEN',
        agencyCode: null,
        roles: ['CITIZEN'],
      },
    };
  }

  /**
   * Present the second factor and raise the session to AAL2 for a bounded window.
   * The time step that matched is stored so the same code cannot be replayed,
   * including by an observer who saw it on the officer's screen.
   */
  async verifyMfa(
    sessionId: string,
    code: string,
    context: RequestContext,
  ): Promise<{ accessToken: string; expiresAt: string; authenticationLevel: 'AAL2' }> {
    const limit = await this.limiter.consume(`mfa:${sessionId}`, 6, 300, { failClosed: true });
    if (!limit.allowed) {
      throw new AppError('RATE_LIMITED', 'Too many attempts. Wait a few minutes and try again.');
    }

    const session = await this.db.queryOne<{
      id: string;
      actor_type: string;
      government_user_id: string | null;
      citizen_account_id: string | null;
      revoked_at: Date | null;
      expires_at: Date;
    }>(
      `SELECT id, actor_type, government_user_id, citizen_account_id, revoked_at, expires_at
         FROM user_session WHERE id = $1`,
      [sessionId],
    );
    if (
      session === null ||
      session.revoked_at !== null ||
      session.expires_at.getTime() <= Date.now()
    ) {
      throw new AppError('UNAUTHENTICATED', 'The session has ended. Sign in again.');
    }

    const isGovernment = session.actor_type === 'GOVERNMENT_USER';
    const ownerId = isGovernment ? session.government_user_id : session.citizen_account_id;
    if (ownerId === null) throw new AppError('UNAUTHENTICATED', 'The session is not valid.');

    const table = isGovernment ? 'mfa_credential' : 'citizen_mfa_credential';
    const ownerColumn = isGovernment ? 'user_id' : 'account_id';
    const credential = await this.db.queryOne<{
      id: string;
      secret_ciphertext: string;
      last_used_counter: string | null;
    }>(
      `SELECT id, secret_ciphertext, last_used_counter FROM ${table}
        WHERE ${ownerColumn} = $1 AND kind = 'TOTP' AND confirmed_at IS NOT NULL
        ORDER BY created_at DESC LIMIT 1`,
      [ownerId],
    );
    if (credential === null) {
      throw AppError.denied('No authenticator is enrolled for this account.', 'no confirmed TOTP');
    }

    const secret = this.crypto.decrypt(credential.secret_ciphertext);
    const result = this.totp.verify(secret, code, {
      lastUsedCounter:
        credential.last_used_counter === null ? null : Number(credential.last_used_counter),
    });
    if (!result.valid) {
      const consumed = await this.consumeRecoveryCode(table, ownerColumn, ownerId, code);
      if (!consumed) {
        await this.audit.record({
          action: 'AUTHENTICATE_MFA',
          outcome: 'DENIED',
          actorType: isGovernment ? 'GOVERNMENT_USER' : 'CITIZEN',
          actorId: ownerId,
          resourceType: 'GOVERNMENT_USER',
          resourceId: ownerId,
          correlationId: context.correlationId,
          ipAddress: context.ipAddress,
          decisionReasons: [
            {
              gate: 'AUTHENTICATION',
              code: 'MFA_CODE_INVALID',
              message: 'The code did not verify.',
            },
          ],
        });
        throw new AppError('UNAUTHENTICATED', 'That code is not correct.');
      }
    } else {
      await this.db.query(
        `UPDATE ${table} SET last_used_at = now(), last_used_counter = $2 WHERE id = $1`,
        [credential.id, result.counter],
      );
    }

    const aal2ExpiresAt = new Date(Date.now() + this.env.AAL2_TTL_SECONDS * 1000);
    await this.db.query(
      `UPDATE user_session SET authentication_level = 'AAL2', aal2_expires_at = $2 WHERE id = $1`,
      [sessionId, aal2ExpiresAt],
    );

    const access = this.tokens.issue({
      subject: ownerId,
      sessionId,
      actorType: isGovernment ? 'GOVERNMENT_USER' : 'CITIZEN',
      authenticationLevel: 'AAL2',
      jti: randomUUID(),
    });

    await this.audit.record({
      action: 'AUTHENTICATE_MFA',
      outcome: 'PERMITTED',
      actorType: isGovernment ? 'GOVERNMENT_USER' : 'CITIZEN',
      actorId: ownerId,
      resourceType: 'GOVERNMENT_USER',
      resourceId: ownerId,
      correlationId: context.correlationId,
      ipAddress: context.ipAddress,
      detail: { aal2ExpiresAt: aal2ExpiresAt.toISOString() },
    });

    return {
      accessToken: access.token,
      expiresAt: access.expiresAt.toISOString(),
      authenticationLevel: 'AAL2',
    };
  }

  /**
   * Rotate a refresh token. The old token is marked replaced; presenting it again
   * revokes the whole chain, which is how a stolen refresh token gets caught
   * rather than silently shared.
   */
  async refresh(refreshToken: string, context: RequestContext): Promise<LoginResult> {
    const hash = opaqueTokenHash(refreshToken);
    const session = await this.db.queryOne<{
      id: string;
      actor_type: string;
      government_user_id: string | null;
      citizen_account_id: string | null;
      revoked_at: Date | null;
      expires_at: Date;
      replaced_by: string | null;
    }>(
      `SELECT id, actor_type, government_user_id, citizen_account_id, revoked_at, expires_at, replaced_by
         FROM user_session WHERE refresh_token_hash = $1`,
      [hash],
    );
    if (session === null) {
      throw new AppError('UNAUTHENTICATED', 'The session has ended. Sign in again.');
    }
    if (session.replaced_by !== null || session.revoked_at !== null) {
      // Reuse of a rotated token: treat the whole family as compromised.
      await this.revokeChain(session.id, 'REFRESH_TOKEN_REUSE');
      logger.warn('refresh_token_reuse_detected', {
        correlationId: context.correlationId,
        sessionId: session.id,
      });
      await this.audit.record({
        action: 'SESSION_REVOKED',
        outcome: 'DENIED',
        actorType: session.actor_type === 'CITIZEN' ? 'CITIZEN' : 'GOVERNMENT_USER',
        actorId: session.government_user_id ?? session.citizen_account_id,
        resourceType: 'GOVERNMENT_USER',
        resourceId: session.id,
        correlationId: context.correlationId,
        ipAddress: context.ipAddress,
        decisionReasons: [
          {
            gate: 'AUTHENTICATION',
            code: 'REFRESH_TOKEN_REUSE',
            message: 'A rotated refresh token was presented again; the session family was revoked.',
          },
        ],
      });
      throw new AppError('UNAUTHENTICATED', 'The session has ended. Sign in again.');
    }
    if (session.expires_at.getTime() <= Date.now()) {
      throw new AppError('UNAUTHENTICATED', 'The session has ended. Sign in again.');
    }

    const ownerId = session.government_user_id ?? session.citizen_account_id;
    if (ownerId === null) throw new AppError('UNAUTHENTICATED', 'The session is not valid.');

    const isGovernment = session.actor_type === 'GOVERNMENT_USER';
    const next = await this.createSession(
      isGovernment ? 'GOVERNMENT_USER' : 'CITIZEN',
      ownerId,
      context,
    );
    await this.db.query(
      `UPDATE user_session SET replaced_by = $2, revoked_at = now(), revoked_reason = 'ROTATED' WHERE id = $1`,
      [session.id, next.sessionId],
    );

    return {
      accessToken: next.accessToken,
      refreshToken: next.refreshToken,
      expiresAt: next.expiresAt.toISOString(),
      authenticationLevel: 'AAL1',
      mfaRequired: true,
      mustChangePassword: false,
      actor: {
        id: ownerId,
        displayName: '',
        actorType: isGovernment ? 'GOVERNMENT_USER' : 'CITIZEN',
        agencyCode: null,
        roles: [],
      },
    };
  }

  async logout(sessionId: string, context: RequestContext): Promise<void> {
    await this.db.query(
      `UPDATE user_session SET revoked_at = now(), revoked_reason = 'SIGNED_OUT'
        WHERE id = $1 AND revoked_at IS NULL`,
      [sessionId],
    );
    await this.audit.record({
      action: 'SESSION_ENDED',
      outcome: 'PERMITTED',
      actorType: 'SYSTEM',
      resourceType: 'GOVERNMENT_USER',
      resourceId: sessionId,
      correlationId: context.correlationId,
      ipAddress: context.ipAddress,
    });
  }

  private async createSession(
    actorType: 'GOVERNMENT_USER' | 'CITIZEN',
    ownerId: string,
    context: RequestContext,
  ): Promise<{ sessionId: string; accessToken: string; refreshToken: string; expiresAt: Date }> {
    const refreshToken = newOpaqueToken();
    const expiresAt = new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_SECONDS * 1000);
    const row = await this.db.queryOne<{ id: string }>(
      `INSERT INTO user_session (
         actor_type, government_user_id, citizen_account_id, refresh_token_hash,
         authentication_level, expires_at, ip_address, user_agent, device_fingerprint
       ) VALUES ($1, $2, $3, $4, 'AAL1', $5, $6, $7, $8)
       RETURNING id`,
      [
        actorType,
        actorType === 'GOVERNMENT_USER' ? ownerId : null,
        actorType === 'CITIZEN' ? ownerId : null,
        opaqueTokenHash(refreshToken),
        expiresAt,
        context.ipAddress,
        context.userAgent,
        context.deviceFingerprint,
      ],
    );
    if (row === null) throw new Error('session insert returned no row');
    const access = this.tokens.issue({
      subject: ownerId,
      sessionId: row.id,
      actorType,
      authenticationLevel: 'AAL1',
      jti: randomUUID(),
    });
    return {
      sessionId: row.id,
      accessToken: access.token,
      refreshToken,
      expiresAt: access.expiresAt,
    };
  }

  private async revokeChain(sessionId: string, reason: string): Promise<void> {
    await this.db.query(
      `WITH RECURSIVE family AS (
         SELECT id, replaced_by FROM user_session WHERE id = $1
         UNION ALL
         SELECT s.id, s.replaced_by FROM user_session s JOIN family f ON s.id = f.replaced_by
       )
       UPDATE user_session SET revoked_at = now(), revoked_reason = $2
        WHERE id IN (SELECT id FROM family) AND revoked_at IS NULL`,
      [sessionId, reason],
    );
  }

  private async consumeRecoveryCode(
    table: string,
    ownerColumn: string,
    ownerId: string,
    code: string,
  ): Promise<boolean> {
    const candidates = await this.db.query<{ id: string; secret_ciphertext: string }>(
      `SELECT id, secret_ciphertext FROM ${table}
        WHERE ${ownerColumn} = $1 AND kind = 'RECOVERY_CODE' AND consumed_at IS NULL`,
      [ownerId],
    );
    const normalized = code.trim().toUpperCase();
    for (const candidate of candidates) {
      let plain: string;
      try {
        plain = this.crypto.decrypt(candidate.secret_ciphertext);
      } catch {
        continue;
      }
      if (plain === normalized) {
        await this.db.query(`UPDATE ${table} SET consumed_at = now() WHERE id = $1`, [
          candidate.id,
        ]);
        return true;
      }
    }
    return false;
  }

  private async enforceLoginRateLimit(identifier: string, context: RequestContext): Promise<void> {
    const byIdentifier = await this.limiter.consume(
      `login:${identifier.toLowerCase()}`,
      this.env.LOGIN_MAX_FAILURES * 3,
      this.env.LOGIN_LOCKOUT_SECONDS,
      { failClosed: true },
    );
    const byIp = await this.limiter.consume(
      `login-ip:${context.ipAddress ?? 'unknown'}`,
      this.env.LOGIN_MAX_FAILURES * 10,
      this.env.LOGIN_LOCKOUT_SECONDS,
      { failClosed: true },
    );
    if (!byIdentifier.allowed || !byIp.allowed) {
      throw new AppError('RATE_LIMITED', 'Too many sign-in attempts. Try again later.');
    }
  }

  private async recordFailure(
    identifier: string,
    actorType: 'GOVERNMENT_USER' | 'CITIZEN',
    userId: string | null,
    context: RequestContext,
    failureCode: string,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO login_attempt (identifier, actor_type, succeeded, failure_code, ip_address, user_agent)
       VALUES ($1, $2, false, $3, $4, $5)`,
      [identifier, actorType, failureCode, context.ipAddress, context.userAgent],
    );
    if (userId !== null) {
      const table = actorType === 'GOVERNMENT_USER' ? 'government_user' : 'citizen_account';
      await this.db.query(
        `UPDATE ${table}
            SET failed_login_count = failed_login_count + 1,
                locked_until = CASE
                  WHEN failed_login_count + 1 >= $2 THEN now() + make_interval(secs => $3)
                  ELSE locked_until END
          WHERE id = $1`,
        [userId, this.env.LOGIN_MAX_FAILURES, this.env.LOGIN_LOCKOUT_SECONDS],
      );
    }
  }

  private async recordSuccess(
    identifier: string,
    actorType: 'GOVERNMENT_USER' | 'CITIZEN',
    userId: string,
    context: RequestContext,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO login_attempt (identifier, actor_type, succeeded, ip_address, user_agent)
       VALUES ($1, $2, true, $3, $4)`,
      [identifier, actorType, context.ipAddress, context.userAgent],
    );
    logger.info('login_succeeded', {
      correlationId: context.correlationId,
      actorType,
      userId,
    });
  }
}
