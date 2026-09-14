import { Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { RequestContext } from '../common/correlation';
import { Database } from '../database/pool';
import type { AuthenticatedActor } from '../iam/actor';
import { CryptoService } from '../security/crypto.service';
import { PasswordService, validatePasswordStrength } from '../security/password.service';
import { TotpService, generateRecoveryCodes } from '../security/totp.service';

/**
 * The security settings a resident manages themselves (master system prompt §58).
 *
 * Everything here changes how the account is protected, so everything here is
 * audited, and a passphrase change ends every other session — the ordinary way
 * somebody recovers an account they think has been used by someone else.
 */
@Injectable()
export class CitizenSecurityService {
  constructor(
    private readonly db: Database,
    private readonly passwords: PasswordService,
    private readonly totp: TotpService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  private ownAccount(actor: AuthenticatedActor): { accountId: string; pcid: string } {
    const pcid = actor.subject.subjectPcid;
    if (actor.subject.actorType !== 'CITIZEN' || pcid === null || pcid === undefined) {
      throw AppError.denied(
        'This endpoint is for citizen accounts.',
        'non-citizen actor on portal route',
      );
    }
    return { accountId: actor.subject.userId, pcid };
  }

  async changePassword(
    actor: AuthenticatedActor,
    input: { currentPassword: string; newPassword: string },
    context: RequestContext,
  ): Promise<{ changed: true; otherSessionsEnded: number }> {
    const { accountId, pcid } = this.ownAccount(actor);

    const row = await this.db.queryOne<{
      password_hash: string;
      password_algorithm: string;
      password_params: Record<string, unknown>;
      email: string | null;
    }>(
      'SELECT password_hash, password_algorithm, password_params, email FROM citizen_account WHERE id = $1',
      [accountId],
    );
    if (row === null) throw AppError.notFoundOrNotPermitted('citizen account not found');

    const verified = await this.passwords.verify(input.currentPassword, {
      hash: row.password_hash,
      algorithm: row.password_algorithm,
      params: row.password_params,
    });
    if (!verified) {
      await this.audit.record({
        action: 'UPDATE_CITIZEN',
        outcome: 'DENIED',
        actorType: 'CITIZEN',
        actorId: accountId,
        purpose: 'CITIZEN_SELF_SERVICE',
        resourceType: 'CITIZEN',
        subjectPcid: pcid,
        correlationId: context.correlationId,
        ipAddress: context.ipAddress,
        detail: { change: 'PASSWORD_CHANGE_REFUSED', reason: 'CURRENT_PASSWORD_INCORRECT' },
      });
      throw new AppError('UNAUTHENTICATED', 'Your current passphrase is not correct.');
    }

    const problems = validatePasswordStrength(input.newPassword, [row.email ?? '', pcid]);
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
        `UPDATE citizen_account
            SET password_hash = $2, password_algorithm = $3, password_params = $4::jsonb,
                password_updated_at = now(), must_change_password = false
          WHERE id = $1`,
        [accountId, stored.hash, stored.algorithm, JSON.stringify(stored.params)],
      );
      // Every other session ends. If somebody else had this account, they lose it now.
      const revoked = await runner.query<{ id: string }>(
        `UPDATE user_session SET revoked_at = now(), revoked_reason = 'PASSWORD_CHANGED'
          WHERE citizen_account_id = $1 AND id <> $2 AND revoked_at IS NULL
          RETURNING id`,
        [accountId, actor.sessionId],
      );
      return revoked.length;
    });

    await this.audit.record({
      action: 'UPDATE_CITIZEN',
      outcome: 'PERMITTED',
      actorType: 'CITIZEN',
      actorId: accountId,
      actorDisplay: actor.displayName,
      purpose: 'CITIZEN_SELF_SERVICE',
      resourceType: 'CITIZEN',
      subjectPcid: pcid,
      correlationId: context.correlationId,
      ipAddress: context.ipAddress,
      detail: { change: 'PASSWORD_CHANGED', otherSessionsEnded: ended },
    });
    return { changed: true, otherSessionsEnded: ended };
  }

  /**
   * Begin enrolling an authenticator. Returns the secret once; it is not usable
   * until confirmed with a code, so an interrupted enrolment leaves the account
   * exactly as it was.
   */
  async beginMfaEnrolment(
    actor: AuthenticatedActor,
    context: RequestContext,
  ): Promise<{ secret: string; provisioningUri: string; recoveryCodes: string[] }> {
    const { accountId, pcid } = this.ownAccount(actor);
    const enrolled = await this.db.queryOne<{ mfa_enrolled: boolean; email: string | null }>(
      'SELECT mfa_enrolled, email FROM citizen_account WHERE id = $1',
      [accountId],
    );
    if (enrolled?.mfa_enrolled === true) {
      throw AppError.conflict(
        'This account already has an authenticator. Remove it before adding another.',
      );
    }

    const secret = this.totp.generateSecret();
    const recoveryCodes = generateRecoveryCodes();
    await this.db.transaction(async (runner) => {
      await runner.query(
        `DELETE FROM citizen_mfa_credential WHERE account_id = $1 AND confirmed_at IS NULL`,
        [accountId],
      );
      await runner.query(
        `INSERT INTO citizen_mfa_credential (account_id, kind, secret_ciphertext)
         VALUES ($1, 'TOTP', $2)`,
        [accountId, this.crypto.encrypt(secret)],
      );
      for (const code of recoveryCodes) {
        await runner.query(
          `INSERT INTO citizen_mfa_credential (account_id, kind, secret_ciphertext)
           VALUES ($1, 'RECOVERY_CODE', $2)`,
          [accountId, this.crypto.encrypt(code)],
        );
      }
    });

    await this.audit.record({
      action: 'UPDATE_CITIZEN',
      outcome: 'PERMITTED',
      actorType: 'CITIZEN',
      actorId: accountId,
      purpose: 'CITIZEN_SELF_SERVICE',
      resourceType: 'CITIZEN',
      subjectPcid: pcid,
      correlationId: context.correlationId,
      ipAddress: context.ipAddress,
      detail: { change: 'MFA_ENROLMENT_STARTED' },
    });

    return {
      secret,
      provisioningUri: this.totp.provisioningUri(secret, pcid, 'PCID Plateau State'),
      recoveryCodes,
    };
  }

  async confirmMfaEnrolment(
    actor: AuthenticatedActor,
    code: string,
    context: RequestContext,
  ): Promise<{ mfaEnrolled: true }> {
    const { accountId, pcid } = this.ownAccount(actor);
    const credential = await this.db.queryOne<{ id: string; secret_ciphertext: string }>(
      `SELECT id, secret_ciphertext FROM citizen_mfa_credential
        WHERE account_id = $1 AND kind = 'TOTP' AND confirmed_at IS NULL
        ORDER BY created_at DESC LIMIT 1`,
      [accountId],
    );
    if (credential === null) {
      throw AppError.conflict('There is no authenticator waiting to be confirmed.');
    }
    const result = this.totp.verify(this.crypto.decrypt(credential.secret_ciphertext), code);
    if (!result.valid) throw new AppError('UNAUTHENTICATED', 'That code is not correct.');

    await this.db.transaction(async (runner) => {
      await runner.query(
        'UPDATE citizen_mfa_credential SET confirmed_at = now(), last_used_counter = $2 WHERE id = $1',
        [credential.id, result.counter],
      );
      await runner.query('UPDATE citizen_account SET mfa_enrolled = true WHERE id = $1', [
        accountId,
      ]);
    });

    await this.audit.record({
      action: 'UPDATE_CITIZEN',
      outcome: 'PERMITTED',
      actorType: 'CITIZEN',
      actorId: accountId,
      purpose: 'CITIZEN_SELF_SERVICE',
      resourceType: 'CITIZEN',
      subjectPcid: pcid,
      correlationId: context.correlationId,
      ipAddress: context.ipAddress,
      detail: { change: 'MFA_CONFIRMED' },
    });
    return { mfaEnrolled: true };
  }

  /** Where this account is signed in, so a resident can end a session they do not recognise. */
  async listSessions(
    actor: AuthenticatedActor,
    context: RequestContext,
  ): Promise<Record<string, unknown>[]> {
    const { accountId } = this.ownAccount(actor);
    const rows = await this.db.query<{
      id: string;
      issued_at: Date;
      expires_at: Date;
      ip_address: string | null;
      user_agent: string | null;
    }>(
      `SELECT id, issued_at, expires_at, ip_address, user_agent
         FROM user_session
        WHERE citizen_account_id = $1 AND revoked_at IS NULL AND expires_at > now()
        ORDER BY issued_at DESC`,
      [accountId],
    );
    void context;
    return rows.map((row) => ({
      id: row.id,
      current: row.id === actor.sessionId,
      signedInAt: row.issued_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      ipAddress: row.ip_address,
      device: summariseUserAgent(row.user_agent),
    }));
  }

  async revokeSession(
    actor: AuthenticatedActor,
    sessionId: string,
    context: RequestContext,
  ): Promise<{ ended: boolean }> {
    const { accountId, pcid } = this.ownAccount(actor);
    const rows = await this.db.query<{ id: string }>(
      `UPDATE user_session SET revoked_at = now(), revoked_reason = 'ENDED_BY_CITIZEN'
        WHERE id = $1 AND citizen_account_id = $2 AND revoked_at IS NULL
        RETURNING id`,
      [sessionId, accountId],
    );
    await this.audit.record({
      action: 'SESSION_ENDED',
      outcome: rows.length > 0 ? 'PERMITTED' : 'DENIED',
      actorType: 'CITIZEN',
      actorId: accountId,
      purpose: 'CITIZEN_SELF_SERVICE',
      resourceType: 'CITIZEN',
      subjectPcid: pcid,
      correlationId: context.correlationId,
      ipAddress: context.ipAddress,
      detail: { change: 'SESSION_ENDED_BY_CITIZEN', sessionId },
    });
    return { ended: rows.length > 0 };
  }
}

/**
 * A coarse device description for the sessions list. Deliberately coarse: the
 * point is to help someone recognise "that was not me", not to fingerprint them.
 */
export function summariseUserAgent(userAgent: string | null): string {
  if (userAgent === null || userAgent.trim() === '') return 'Unknown device';
  const value = userAgent.toLowerCase();
  const platform = value.includes('android')
    ? 'Android'
    : value.includes('iphone') || value.includes('ipad') || value.includes('ios')
      ? 'iPhone or iPad'
      : value.includes('windows')
        ? 'Windows'
        : value.includes('mac os') || value.includes('macintosh')
          ? 'Mac'
          : value.includes('linux')
            ? 'Linux'
            : 'Unknown device';
  const browser = value.includes('edg/')
    ? 'Edge'
    : value.includes('opr/') || value.includes('opera')
      ? 'Opera'
      : value.includes('chrome')
        ? 'Chrome'
        : value.includes('firefox')
          ? 'Firefox'
          : value.includes('safari')
            ? 'Safari'
            : 'browser';
  return `${platform} · ${browser}`;
}
