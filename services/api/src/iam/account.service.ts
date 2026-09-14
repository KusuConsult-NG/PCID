import { Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../common/correlation';
import { AppError } from '../common/errors';
import { Database } from '../database/pool';
import { summariseUserAgent } from '../identity/citizen-security.service';
import { PasswordService, validatePasswordStrength } from '../security/password.service';
import type { AuthenticatedActor } from './actor';

/**
 * An officer's own account security (master system prompt §41, §42).
 *
 * This existed for residents and not for the people who run the platform. An
 * account was created with a passphrase an administrator chose and typed;
 * `government_user.must_change_password` was set, the login endpoint reported
 * it, and there was no endpoint that could clear it. So every officer account
 * ran indefinitely on a secret a second person knew, and the officer had no way
 * to replace it.
 *
 * Nothing here needs an authorisation action: the subject is the caller's own
 * account, not the register. It is all audited, and a passphrase change ends
 * every other session - which is how somebody recovers an account they think
 * has been used by another person.
 */
@Injectable()
export class GovernmentAccountService {
  constructor(
    private readonly db: Database,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  private ownAccount(actor: AuthenticatedActor): string {
    if (actor.subject.actorType !== 'GOVERNMENT_USER') {
      throw AppError.denied(
        'This endpoint is for government accounts.',
        'non-government actor on account route',
      );
    }
    return actor.subject.userId;
  }

  async changePassword(
    actor: AuthenticatedActor,
    input: { currentPassword: string; newPassword: string },
    context: RequestContext,
  ): Promise<{ changed: true; otherSessionsEnded: number }> {
    const userId = this.ownAccount(actor);

    const row = await this.db.queryOne<{
      password_hash: string;
      password_algorithm: string;
      password_params: Record<string, unknown>;
      email: string;
      full_name: string;
    }>(
      `SELECT password_hash, password_algorithm, password_params, email, full_name
         FROM government_user WHERE id = $1`,
      [userId],
    );
    if (row === null) throw AppError.notFoundOrNotPermitted('government user not found');

    const verified = await this.passwords.verify(input.currentPassword, {
      hash: row.password_hash,
      algorithm: row.password_algorithm,
      params: row.password_params,
    });
    if (!verified) {
      await this.audit.record({
        action: 'ADMIN_USER_MANAGE',
        outcome: 'DENIED',
        actorType: 'GOVERNMENT_USER',
        actorId: userId,
        actorDisplay: actor.displayName,
        agencyId: actor.subject.agencyId,
        agencyCode: actor.agencyCode,
        resourceType: 'GOVERNMENT_USER',
        resourceId: userId,
        correlationId: context.correlationId,
        ipAddress: context.ipAddress,
        detail: { change: 'PASSWORD_CHANGE_REFUSED', reason: 'CURRENT_PASSWORD_INCORRECT' },
      });
      throw new AppError('UNAUTHENTICATED', 'Your current passphrase is not correct.');
    }

    // The account's own name and address are the words an attacker tries first.
    const problems = validatePasswordStrength(input.newPassword, [row.email, row.full_name]);
    if (problems.length > 0) {
      throw AppError.validation('That passphrase does not meet the requirements.', [
        { path: 'newPassword', message: problems.join(' ') },
      ]);
    }
    if (input.newPassword === input.currentPassword) {
      throw AppError.validation('Choose a passphrase you have not used on this account before.', [
        {
          path: 'newPassword',
          message: 'The new passphrase must be different from the current one.',
        },
      ]);
    }

    const stored = await this.passwords.hash(input.newPassword);
    const ended = await this.db.transaction(async (runner) => {
      await runner.query(
        `UPDATE government_user
            SET password_hash = $2, password_algorithm = $3, password_params = $4::jsonb,
                password_updated_at = now(), must_change_password = false
          WHERE id = $1`,
        [userId, stored.hash, stored.algorithm, JSON.stringify(stored.params)],
      );
      const revoked = await runner.query<{ id: string }>(
        `UPDATE user_session SET revoked_at = now(), revoked_reason = 'PASSWORD_CHANGED'
          WHERE government_user_id = $1 AND id <> $2 AND revoked_at IS NULL
          RETURNING id`,
        [userId, actor.sessionId],
      );
      return revoked.length;
    });

    await this.audit.record({
      action: 'ADMIN_USER_MANAGE',
      outcome: 'PERMITTED',
      actorType: 'GOVERNMENT_USER',
      actorId: userId,
      actorDisplay: actor.displayName,
      agencyId: actor.subject.agencyId,
      agencyCode: actor.agencyCode,
      resourceType: 'GOVERNMENT_USER',
      resourceId: userId,
      correlationId: context.correlationId,
      ipAddress: context.ipAddress,
      detail: { change: 'PASSWORD_CHANGED', otherSessionsEnded: ended, self: true },
    });
    return { changed: true, otherSessionsEnded: ended };
  }

  async listSessions(actor: AuthenticatedActor): Promise<Record<string, unknown>[]> {
    const userId = this.ownAccount(actor);
    const rows = await this.db.query<{
      id: string;
      issued_at: Date;
      expires_at: Date;
      ip_address: string | null;
      user_agent: string | null;
    }>(
      `SELECT id, issued_at, expires_at, ip_address, user_agent
         FROM user_session
        WHERE government_user_id = $1 AND revoked_at IS NULL AND expires_at > now()
        ORDER BY issued_at DESC`,
      [userId],
    );
    return rows.map((row) => ({
      id: row.id,
      current: row.id === actor.sessionId,
      signedInAt: row.issued_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      ipAddress: row.ip_address,
      // Deliberately coarse. A device fingerprint precise enough to be useful
      // here would be precise enough to track somebody with.
      device: summariseUserAgent(row.user_agent),
    }));
  }

  async revokeSession(
    actor: AuthenticatedActor,
    sessionId: string,
    context: RequestContext,
  ): Promise<{ ended: boolean }> {
    const userId = this.ownAccount(actor);
    const rows = await this.db.query<{ id: string }>(
      `UPDATE user_session SET revoked_at = now(), revoked_reason = 'ENDED_BY_USER'
        WHERE id = $1 AND government_user_id = $2 AND revoked_at IS NULL
        RETURNING id`,
      [sessionId, userId],
    );
    await this.audit.record({
      action: 'SESSION_ENDED',
      outcome: rows.length > 0 ? 'PERMITTED' : 'DENIED',
      actorType: 'GOVERNMENT_USER',
      actorId: userId,
      actorDisplay: actor.displayName,
      agencyId: actor.subject.agencyId,
      agencyCode: actor.agencyCode,
      resourceType: 'GOVERNMENT_USER',
      resourceId: userId,
      correlationId: context.correlationId,
      ipAddress: context.ipAddress,
      detail: { endedSessionId: sessionId, self: true },
    });
    return { ended: rows.length > 0 };
  }
}
