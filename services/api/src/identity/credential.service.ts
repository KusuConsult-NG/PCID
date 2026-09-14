import { randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import {
  CREDENTIAL_DEFAULT_VALIDITY_DAYS,
  CREDENTIAL_PORTAL_TOKEN_MAX_TTL_SECONDS,
  CREDENTIAL_PORTAL_TOKEN_TTL_SECONDS,
  PCID_ALPHABET,
  isCredentialUsable,
} from '@pcid/contracts';
import type { CredentialFormat, CredentialStatus } from '@pcid/contracts';

import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { RequestContext } from '../common/correlation';
import { project } from '../common/projection';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { Database } from '../database/pool';
import type { QueryRunner } from '../database/pool';
import type { AuthenticatedActor } from '../iam/actor';
import { PolicyService } from '../policy/policy.service';
import type { PolicyDecision } from '@pcid/policy';
import { opaqueTokenHash } from '../security/crypto.service';
import { RateLimiter } from '../security/rate-limit';
import { PcidService } from './pcid.service';

export interface CredentialView {
  readonly serial: string;
  readonly format: CredentialFormat;
  readonly status: CredentialStatus;
  readonly issuedAt: string;
  readonly expiresAt: string | null;
  readonly usable: boolean;
  /** The URL the QR encodes. An opaque token and nothing else (§39, §40). */
  readonly verificationUrl: string;
  readonly verificationTokenExpiresAt: string;
}

export interface CredentialVerification {
  readonly valid: boolean;
  readonly reason: string;
  readonly displayName: string | null;
  readonly pcid: string | null;
  readonly photographUri: string | null;
  readonly verificationLevel: string | null;
  readonly credentialSerial: string | null;
  readonly credentialExpiresAt: string | null;
}

interface CredentialRow {
  id: string;
  pcid: string;
  serial: string;
  format: CredentialFormat;
  status: CredentialStatus;
  issued_at: Date;
  expires_at: Date | null;
}

/**
 * Issuing and verifying the PCID credential (master system prompt §39, §40).
 *
 * The design point is that the QR is worthless on its own. It carries a random
 * token, so photographing somebody's card tells you nothing; resolving the token
 * needs an authenticated officer with the verification action, and returns only
 * whether the credential is live and the name printed on it. The token shown in
 * the portal is minted fresh on each view and expires in minutes, so a
 * screenshot does not become a reusable credential.
 */
@Injectable()
export class CredentialService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: Database,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly pcid: PcidService,
    private readonly limiter: RateLimiter,
  ) {}

  /**
   * The signed-in resident's own credential, with a freshly minted display
   * token. Issues the digital credential on first view, so a resident who was
   * registered before credentials existed simply has one when they look.
   */
  async currentForCitizen(
    actor: AuthenticatedActor,
    context: RequestContext,
  ): Promise<CredentialView> {
    const pcid = actor.subject.subjectPcid;
    if (actor.subject.actorType !== 'CITIZEN' || pcid === null || pcid === undefined) {
      throw AppError.denied(
        'This endpoint is for citizen accounts.',
        'non-citizen actor on credential route',
      );
    }

    const citizen = await this.db.queryOne<{ id: string; lga_code: string | null }>(
      'SELECT id, lga_code FROM citizen WHERE pcid = $1',
      [pcid],
    );
    const outcome = await this.policy.authorize({
      actor,
      action: 'CREDENTIAL_VIEW',
      purpose: 'CITIZEN_SELF_SERVICE',
      resource: {
        type: 'CREDENTIAL',
        id: null,
        classification: 'CONFIDENTIAL',
        subjectPcid: pcid,
        lgaCode: citizen?.lga_code ?? null,
      },
      context,
    });
    if (citizen === null)
      throw AppError.notFoundOrNotPermitted('citizen account has no registry record');

    const credential = await this.db.transaction(async (runner) => {
      const existing = await runner.queryOne<CredentialRow>(
        `SELECT id, pcid, serial, format, status, issued_at, expires_at
           FROM credential
          WHERE pcid = $1 AND format = 'DIGITAL' AND status = 'ACTIVE'
          ORDER BY issued_at DESC LIMIT 1`,
        [pcid],
      );
      return existing ?? (await this.issue(runner, pcid, 'DIGITAL', null));
    });

    const token = await this.mintDisplayToken(credential.id);
    return this.toView(credential, token, outcome.decision);
  }

  /**
   * Resolve a scanned token. The verifier must be an authenticated officer
   * holding the verification action; the token alone authorises nothing.
   */
  async verifyByToken(
    actor: AuthenticatedActor,
    token: string,
    context: RequestContext,
  ): Promise<CredentialVerification> {
    // A verifier that starts guessing tokens is throttled before it can profile
    // the token space.
    const limit = await this.limiter.consume(`credential-verify:${actor.subject.userId}`, 60, 60, {
      failClosed: true,
    });
    if (!limit.allowed) {
      throw new AppError(
        'RATE_LIMITED',
        'Too many verification attempts. Wait a moment and try again.',
      );
    }

    const row = await this.db.queryOne<
      CredentialRow & {
        token_id: string;
        token_expires_at: Date;
        token_consumed_at: Date | null;
        single_use: boolean;
        display_name: string;
        citizen_status: string;
        verification_level: string;
        photograph_uri: string | null;
        citizen_id: string;
        citizen_classification: string;
        lga_code: string | null;
      }
    >(
      `SELECT c.id, c.pcid, c.serial, c.format, c.status, c.issued_at, c.expires_at,
              t.id AS token_id, t.expires_at AS token_expires_at, t.consumed_at AS token_consumed_at,
              t.single_use,
              cz.id AS citizen_id, cz.display_name, cz.status AS citizen_status,
              cz.verification_level, cz.photograph_uri,
              cz.classification AS citizen_classification, cz.lga_code
         FROM credential_verification_token t
         JOIN credential c ON c.id = t.credential_id
         JOIN citizen cz ON cz.pcid = c.pcid
        WHERE t.token_hash = $1`,
      [opaqueTokenHash(token.trim())],
    );

    // Authorise on the record the token points at, so a verification is audited
    // against the person even when the token turns out to be stale.
    const outcome = await this.policy.authorize({
      actor,
      action: 'CITIZEN_VERIFY',
      purpose: 'IDENTITY_VERIFICATION',
      resource: {
        type: 'CITIZEN',
        id: row?.citizen_id ?? null,
        classification: (row?.citizen_classification ?? 'CONFIDENTIAL') as 'CONFIDENTIAL',
        subjectPcid: row?.pcid ?? null,
        lgaCode: row?.lga_code ?? null,
        requestedFields: [
          'citizen.displayName',
          'citizen.status',
          'citizen.verificationLevel',
          'citizen.photographUri',
        ],
      },
      context,
      auditDetail: { method: 'CREDENTIAL_QR', tokenRecognised: row !== null },
    });

    if (row === null) {
      return this.notValid('This code is not recognised. It may have expired.');
    }
    if (row.token_expires_at.getTime() <= Date.now()) {
      return this.notValid('This code has expired. Ask the holder to display a new one.');
    }
    if (row.token_consumed_at !== null) {
      return this.notValid('This code has already been used.');
    }
    if (!isCredentialUsable(row.status, row.expires_at)) {
      return this.notValid(
        row.status === 'REVOKED'
          ? 'This credential has been reported lost and is no longer valid.'
          : `This credential is ${row.status.toLowerCase()}.`,
      );
    }
    if (row.citizen_status !== 'ACTIVE') {
      return this.notValid('The record behind this credential is not active.');
    }

    if (row.single_use) {
      await this.db.query(
        'UPDATE credential_verification_token SET consumed_at = now() WHERE id = $1',
        [row.token_id],
      );
    }

    const released = new Set(outcome.decision.allowedFields);
    return {
      valid: true,
      reason: 'The credential is valid.',
      displayName: released.has('citizen.displayName') ? row.display_name : null,
      pcid: released.has('citizen.pcid') ? row.pcid : null,
      photographUri: released.has('citizen.photographUri') ? row.photograph_uri : null,
      verificationLevel: released.has('citizen.verificationLevel') ? row.verification_level : null,
      credentialSerial: row.serial,
      credentialExpiresAt: row.expires_at?.toISOString() ?? null,
    };
  }

  /**
   * Report a credential lost or stolen. Revoking invalidates every token issued
   * against it at once, which is the whole point of separating the credential
   * from the identity.
   */
  async revokeOwn(
    actor: AuthenticatedActor,
    reason: string,
    context: RequestContext,
  ): Promise<{ serial: string; status: CredentialStatus }> {
    const pcid = actor.subject.subjectPcid;
    if (actor.subject.actorType !== 'CITIZEN' || pcid === null || pcid === undefined) {
      throw AppError.denied(
        'This endpoint is for citizen accounts.',
        'non-citizen actor on credential route',
      );
    }
    const citizen = await this.db.queryOne<{ id: string }>(
      'SELECT id FROM citizen WHERE pcid = $1',
      [pcid],
    );
    await this.policy.authorize({
      actor,
      action: 'CREDENTIAL_REVOKE',
      purpose: 'CITIZEN_SELF_SERVICE',
      resource: {
        type: 'CREDENTIAL',
        id: null,
        classification: 'CONFIDENTIAL',
        subjectPcid: pcid,
        requestedFields: ['credential.status'],
      },
      context,
      auditDetail: { change: 'CREDENTIAL_REVOKED' },
    });

    const row = await this.db.queryOne<{ serial: string; status: CredentialStatus }>(
      `UPDATE credential
          SET status = 'REVOKED', revoked_at = now(), revoked_reason = $2
        WHERE pcid = $1 AND status = 'ACTIVE'
        RETURNING serial, status`,
      [pcid, reason],
    );
    if (row === null) throw AppError.conflict('There is no active credential to report.');

    await this.db.query(
      `DELETE FROM credential_verification_token
        WHERE credential_id IN (SELECT id FROM credential WHERE pcid = $1 AND status = 'REVOKED')
          AND consumed_at IS NULL`,
      [pcid],
    );

    await this.audit.record({
      action: 'UPDATE_CITIZEN',
      outcome: 'PERMITTED',
      actorType: 'CITIZEN',
      actorId: actor.subject.userId,
      actorDisplay: actor.displayName,
      purpose: 'CITIZEN_SELF_SERVICE',
      resourceType: 'CITIZEN',
      resourceId: citizen?.id ?? null,
      subjectPcid: pcid,
      correlationId: context.correlationId,
      ipAddress: context.ipAddress,
      detail: { change: 'CREDENTIAL_REVOKED', serial: row.serial, reason },
    });
    return row;
  }

  /** When and by whom this person's credential has been verified (§58). */
  async verificationHistory(
    actor: AuthenticatedActor,
    options: { limit: number; offset: number },
    context: RequestContext,
  ): Promise<{ total: number; verifications: Record<string, unknown>[] }> {
    const pcid = actor.subject.subjectPcid;
    if (actor.subject.actorType !== 'CITIZEN' || pcid === null || pcid === undefined) {
      throw AppError.denied(
        'This endpoint is for citizen accounts.',
        'non-citizen actor on credential route',
      );
    }
    await this.policy.authorize({
      actor,
      action: 'AUDIT_VIEW',
      purpose: 'CITIZEN_SELF_SERVICE',
      resource: { type: 'AUDIT_EVENT', id: null, classification: 'INTERNAL', subjectPcid: pcid },
      context,
      auditDetail: { view: 'VERIFICATION_HISTORY' },
    });

    const rows = await this.db.query<{
      occurred_at: Date;
      agency_code: string | null;
      agency_name: string | null;
      outcome: string;
      detail: Record<string, unknown>;
    }>(
      // The office's name, not its code: a resident checking where their ID was
      // presented should not have to know the government's internal shorthand.
      `SELECT e.occurred_at, e.agency_code, a.name AS agency_name, e.outcome, e.detail
         FROM audit_event e
         LEFT JOIN agency a ON a.id = e.agency_id
        WHERE e.subject_pcid = $1 AND e.action = 'CITIZEN_VERIFY'
          AND e.citizen_visibility = 'ACCESS_VISIBLE_TO_CITIZEN'
        ORDER BY e.occurred_at DESC LIMIT $2 OFFSET $3`,
      [pcid, options.limit, options.offset],
    );
    const total = await this.db.queryOne<{ count: string }>(
      `SELECT count(*)::text AS count FROM audit_event
        WHERE subject_pcid = $1 AND action = 'CITIZEN_VERIFY'
          AND citizen_visibility = 'ACCESS_VISIBLE_TO_CITIZEN'`,
      [pcid],
    );
    return {
      total: Number(total?.count ?? 0),
      verifications: rows.map((row) => ({
        occurredAt: row.occurred_at.toISOString(),
        agency: row.agency_name ?? row.agency_code,
        outcome: row.outcome,
        method: (row.detail as { method?: string }).method ?? 'PCID',
      })),
    };
  }

  private async issue(
    runner: QueryRunner,
    pcid: string,
    format: CredentialFormat,
    issuedByUserId: string | null,
  ): Promise<CredentialRow> {
    const expiresAt = new Date(Date.now() + CREDENTIAL_DEFAULT_VALIDITY_DAYS * 86_400_000);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const serial = credentialSerial();
      const row = await runner.queryOne<CredentialRow>(
        `INSERT INTO credential (pcid, serial, format, status, expires_at, issued_by_user_id)
         VALUES ($1, $2, $3, 'ACTIVE', $4, $5)
         ON CONFLICT (serial) DO NOTHING
         RETURNING id, pcid, serial, format, status, issued_at, expires_at`,
        [pcid, serial, format, expiresAt, issuedByUserId],
      );
      if (row !== null) return row;
    }
    throw new AppError('INTERNAL_ERROR', 'A credential could not be issued.', {
      internalReason: 'credential serial collisions exhausted',
    });
  }

  private async mintDisplayToken(
    credentialId: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    const ttl = Math.min(
      CREDENTIAL_PORTAL_TOKEN_TTL_SECONDS,
      CREDENTIAL_PORTAL_TOKEN_MAX_TTL_SECONDS,
    );
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + ttl * 1000);
    await this.db.query(
      `INSERT INTO credential_verification_token (credential_id, token_hash, purpose, expires_at, single_use)
       VALUES ($1, $2, 'PORTAL_DISPLAY', $3, false)`,
      [credentialId, opaqueTokenHash(token), expiresAt],
    );
    // Housekeeping: expired display tokens are of no further use to anyone.
    await this.db.query(
      `DELETE FROM credential_verification_token
        WHERE credential_id = $1 AND purpose = 'PORTAL_DISPLAY' AND expires_at < now() - interval '1 hour'`,
      [credentialId],
    );
    return { token, expiresAt };
  }

  private toView(
    row: CredentialRow,
    token: { token: string; expiresAt: Date },
    decision: PolicyDecision,
  ): CredentialView {
    const base = this.env.VERIFICATION_BASE_URL.replace(/\/+$/, '');
    // Projected through the decision like every other record, so the credential
    // view cannot drift into returning a field the catalogue has not cleared.
    const projected = project(decision, {
      'credential.serial': row.serial,
      'credential.format': row.format,
      'credential.status': row.status,
      'credential.issuedAt': row.issued_at.toISOString(),
      'credential.expiresAt': row.expires_at?.toISOString() ?? null,
      'credential.verificationUrl': `${base}/${token.token}`,
    });
    return {
      serial: projected.serial as string,
      format: projected.format as CredentialFormat,
      status: projected.status as CredentialStatus,
      issuedAt: projected.issuedAt as string,
      expiresAt: (projected.expiresAt as string | null) ?? null,
      usable: isCredentialUsable(row.status, row.expires_at),
      verificationUrl: projected.verificationUrl as string,
      verificationTokenExpiresAt: token.expiresAt.toISOString(),
    };
  }

  private notValid(reason: string): CredentialVerification {
    return {
      valid: false,
      reason,
      displayName: null,
      pcid: null,
      photographUri: null,
      verificationLevel: null,
      credentialSerial: null,
      credentialExpiresAt: null,
    };
  }
}

function credentialSerial(): string {
  const year = new Date().getUTCFullYear();
  const bytes = randomBytes(8);
  let serial = '';
  for (let i = 0; i < 8; i += 1) {
    serial += PCID_ALPHABET[(bytes[i] as number) % PCID_ALPHABET.length];
  }
  return `PLC-${year}-${serial}`;
}
