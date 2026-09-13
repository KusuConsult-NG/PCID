import { Injectable } from '@nestjs/common';
import { DEFAULT_LAW_ENFORCEMENT_COMPARTMENT_CATEGORIES } from '@pcid/contracts';

import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { RequestContext } from '../common/correlation';
import { Database } from '../database/pool';
import { PolicyService } from '../policy/policy.service';
import { CryptoService } from '../security/crypto.service';
import { PasswordService, validatePasswordStrength } from '../security/password.service';
import { TotpService, generateRecoveryCodes } from '../security/totp.service';
import type { AuthenticatedActor } from './actor';

export interface CreateAgencyInput {
  readonly code: string;
  readonly name: string;
  readonly category: string;
  readonly jurisdictionScope: 'STATE' | 'LGA' | 'WARD';
  readonly jurisdictionLgaCodes: readonly string[];
  readonly jurisdictionWardCodes: readonly string[];
  readonly maxClassification: string;
  readonly contactEmail?: string | null;
  readonly contactPhone?: string | null;
  readonly dataProtectionOfficer?: string | null;
  readonly administratorName?: string | null;
}

export interface CreateUserInput {
  readonly email: string;
  readonly fullName: string;
  readonly agencyId: string;
  readonly roles: readonly string[];
  readonly clearance: string;
  readonly jurisdictionScope?: 'STATE' | 'LGA' | 'WARD';
  readonly jurisdictionLgaCodes?: readonly string[];
  readonly jurisdictionWardCodes?: readonly string[];
  readonly temporaryPassword: string;
}

/**
 * Administration of the Government Agency Registry and government users (§6, §41).
 *
 * Two invariants this service exists to hold:
 *
 *  - a new agency starts INACTIVE with no data-sharing agreement, so registering
 *    one grants nothing until someone deliberately activates it;
 *  - the law-enforcement compartment is granted explicitly, with a stated legal
 *    basis, to an agency in an eligible category. It is never inferred from the
 *    agency's name.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly db: Database,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly totp: TotpService,
    private readonly crypto: CryptoService,
  ) {}

  async createAgency(
    actor: AuthenticatedActor,
    input: CreateAgencyInput,
    context: RequestContext,
  ): Promise<{ id: string; code: string; status: string }> {
    await this.policy.authorize({
      actor,
      action: 'ADMIN_AGENCY_MANAGE',
      purpose: 'SYSTEM_ADMINISTRATION',
      resource: { type: 'AGENCY', id: null, classification: 'INTERNAL', subjectPcid: null },
      context,
    });

    const row = await this.db.queryOne<{ id: string; code: string; status: string }>(
      `INSERT INTO agency (
         code, name, category, status, jurisdiction_scope, jurisdiction_lga_codes,
         jurisdiction_ward_codes, max_classification, data_sharing_agreement,
         contact_email, contact_phone, data_protection_officer, administrator_name
       ) VALUES ($1,$2,$3,'INACTIVE',$4,$5,$6,$7,'NONE',$8,$9,$10,$11)
       RETURNING id, code, status`,
      [
        input.code,
        input.name,
        input.category,
        input.jurisdictionScope,
        input.jurisdictionLgaCodes,
        input.jurisdictionWardCodes,
        input.maxClassification,
        input.contactEmail ?? null,
        input.contactPhone ?? null,
        input.dataProtectionOfficer ?? null,
        input.administratorName ?? null,
      ],
    );
    if (row === null) throw new Error('agency insert returned no row');

    await this.audit.record({
      action: 'ADMIN_AGENCY_MANAGE',
      outcome: 'PERMITTED',
      actorType: actor.subject.actorType,
      actorId: actor.subject.userId,
      actorDisplay: actor.displayName,
      agencyId: actor.subject.agencyId,
      agencyCode: actor.agencyCode,
      roles: actor.subject.roles,
      purpose: 'SYSTEM_ADMINISTRATION',
      resourceType: 'AGENCY',
      resourceId: row.id,
      correlationId: context.correlationId,
      ipAddress: context.ipAddress,
      detail: { change: 'AGENCY_CREATED', code: input.code, category: input.category },
    });
    return row;
  }

  async updateAgencyStatus(
    actor: AuthenticatedActor,
    agencyId: string,
    input: {
      status?: string;
      dataSharingAgreement?: string;
      dataSharingExpiresAt?: string | null;
      apiIntegrationStatus?: string;
    },
    context: RequestContext,
  ): Promise<Record<string, unknown>> {
    await this.policy.authorize({
      actor,
      action: 'ADMIN_AGENCY_MANAGE',
      purpose: 'SYSTEM_ADMINISTRATION',
      resource: { type: 'AGENCY', id: agencyId, classification: 'INTERNAL', subjectPcid: null },
      context,
    });

    const row = await this.db.queryOne<{
      id: string;
      code: string;
      status: string;
      data_sharing_agreement: string;
      api_integration_status: string;
    }>(
      `UPDATE agency
          SET status = COALESCE($2, status),
              data_sharing_agreement = COALESCE($3, data_sharing_agreement),
              data_sharing_expires_at = COALESCE($4::timestamptz, data_sharing_expires_at),
              api_integration_status = COALESCE($5, api_integration_status)
        WHERE id = $1
        RETURNING id, code, status, data_sharing_agreement, api_integration_status`,
      [
        agencyId,
        input.status ?? null,
        input.dataSharingAgreement ?? null,
        input.dataSharingExpiresAt ?? null,
        input.apiIntegrationStatus ?? null,
      ],
    );
    if (row === null) throw AppError.notFoundOrNotPermitted(`no agency ${agencyId}`);

    await this.audit.record({
      action: 'ADMIN_AGENCY_MANAGE',
      outcome: 'PERMITTED',
      actorType: actor.subject.actorType,
      actorId: actor.subject.userId,
      actorDisplay: actor.displayName,
      agencyId: actor.subject.agencyId,
      agencyCode: actor.agencyCode,
      roles: actor.subject.roles,
      purpose: 'SYSTEM_ADMINISTRATION',
      resourceType: 'AGENCY',
      resourceId: agencyId,
      correlationId: context.correlationId,
      ipAddress: context.ipAddress,
      detail: { change: 'AGENCY_STATUS_UPDATED', ...input },
    });
    return {
      id: row.id,
      code: row.code,
      status: row.status,
      dataSharingAgreement: row.data_sharing_agreement,
      apiIntegrationStatus: row.api_integration_status,
    };
  }

  async grantCompartment(
    actor: AuthenticatedActor,
    agencyId: string,
    legalBasis: string,
    context: RequestContext,
  ): Promise<{ agencyId: string; compartment: string }> {
    await this.policy.authorize({
      actor,
      action: 'ADMIN_POLICY_MANAGE',
      purpose: 'SYSTEM_ADMINISTRATION',
      resource: { type: 'SYSTEM', id: agencyId, classification: 'INTERNAL', subjectPcid: null },
      context,
    });
    if (legalBasis.trim().length < 20) {
      throw AppError.validation('State the legal basis for the compartment grant.', [
        { path: 'legalBasis', message: 'At least 20 characters are required.' },
      ]);
    }

    const agency = await this.db.queryOne<{ category: string; code: string }>(
      'SELECT category, code FROM agency WHERE id = $1',
      [agencyId],
    );
    if (agency === null) throw AppError.notFoundOrNotPermitted(`no agency ${agencyId}`);
    if (!DEFAULT_LAW_ENFORCEMENT_COMPARTMENT_CATEGORIES.includes(agency.category as never)) {
      throw AppError.denied(
        'The law-enforcement compartment may only be granted to a security or justice agency.',
        `agency category ${agency.category} is not eligible`,
      );
    }

    await this.db.query(
      `INSERT INTO agency_compartment_grant (agency_id, compartment, granted_by, legal_basis)
       VALUES ($1,'LAW_ENFORCEMENT_RESTRICTED',$2,$3)
       ON CONFLICT (agency_id, compartment) DO UPDATE SET legal_basis = EXCLUDED.legal_basis`,
      [agencyId, actor.subject.userId, legalBasis],
    );
    await this.audit.record({
      action: 'ADMIN_POLICY_MANAGE',
      outcome: 'PERMITTED',
      actorType: actor.subject.actorType,
      actorId: actor.subject.userId,
      actorDisplay: actor.displayName,
      agencyId: actor.subject.agencyId,
      agencyCode: actor.agencyCode,
      roles: actor.subject.roles,
      purpose: 'SYSTEM_ADMINISTRATION',
      resourceType: 'SYSTEM',
      resourceId: agencyId,
      correlationId: context.correlationId,
      ipAddress: context.ipAddress,
      detail: {
        change: 'COMPARTMENT_GRANTED',
        compartment: 'LAW_ENFORCEMENT_RESTRICTED',
        agencyCode: agency.code,
        legalBasis,
      },
    });
    return { agencyId, compartment: 'LAW_ENFORCEMENT_RESTRICTED' };
  }

  async listAgencies(
    actor: AuthenticatedActor,
    context: RequestContext,
  ): Promise<Record<string, unknown>[]> {
    await this.policy.authorize({
      actor,
      action: 'ADMIN_AGENCY_MANAGE',
      purpose: 'SYSTEM_ADMINISTRATION',
      resource: { type: 'AGENCY', id: null, classification: 'INTERNAL', subjectPcid: null },
      context,
    });
    const rows = await this.db.query<{
      id: string;
      code: string;
      name: string;
      category: string;
      status: string;
      max_classification: string;
      data_sharing_agreement: string;
      api_integration_status: string;
      jurisdiction_scope: string;
      compartments: string[] | null;
    }>(
      `SELECT a.id, a.code, a.name, a.category, a.status, a.max_classification,
              a.data_sharing_agreement, a.api_integration_status, a.jurisdiction_scope,
              array_agg(g.compartment) FILTER (WHERE g.compartment IS NOT NULL) AS compartments
         FROM agency a
         LEFT JOIN agency_compartment_grant g ON g.agency_id = a.id
        GROUP BY a.id
        ORDER BY a.name`,
    );
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      category: row.category,
      status: row.status,
      maxClassification: row.max_classification,
      dataSharingAgreement: row.data_sharing_agreement,
      apiIntegrationStatus: row.api_integration_status,
      jurisdictionScope: row.jurisdiction_scope,
      compartments: row.compartments ?? [],
    }));
  }

  /**
   * Create a government user. MFA enrolment material is returned once, at
   * creation, and the account cannot reach citizen data until it is confirmed -
   * the policy engine refuses a government user who is not MFA-enrolled.
   */
  async createUser(
    actor: AuthenticatedActor,
    input: CreateUserInput,
    context: RequestContext,
  ): Promise<{
    id: string;
    email: string;
    totpSecret: string;
    provisioningUri: string;
    recoveryCodes: string[];
  }> {
    await this.policy.authorize({
      actor,
      action: 'ADMIN_USER_MANAGE',
      purpose: 'SYSTEM_ADMINISTRATION',
      resource: {
        type: 'GOVERNMENT_USER',
        id: null,
        classification: 'INTERNAL',
        subjectPcid: null,
      },
      context,
    });

    const problems = validatePasswordStrength(input.temporaryPassword, [
      input.email,
      input.fullName,
    ]);
    if (problems.length > 0) {
      throw AppError.validation('The temporary password does not meet the policy.', [
        { path: 'temporaryPassword', message: problems.join(' ') },
      ]);
    }

    const stored = await this.passwords.hash(input.temporaryPassword);
    const secret = this.totp.generateSecret();
    const recoveryCodes = generateRecoveryCodes();

    return this.db.transaction(async (runner) => {
      const user = await runner.queryOne<{ id: string; email: string }>(
        `INSERT INTO government_user (
           agency_id, email, full_name, status, password_hash, password_algorithm, password_params,
           must_change_password, mfa_enrolled, clearance, jurisdiction_scope,
           jurisdiction_lga_codes, jurisdiction_ward_codes
         ) VALUES ($1,$2,$3,'ACTIVE',$4,$5,$6::jsonb,true,false,$7,$8,$9,$10)
         RETURNING id, email`,
        [
          input.agencyId,
          input.email,
          input.fullName,
          stored.hash,
          stored.algorithm,
          JSON.stringify(stored.params),
          input.clearance,
          input.jurisdictionScope ?? 'STATE',
          input.jurisdictionLgaCodes ?? [],
          input.jurisdictionWardCodes ?? [],
        ],
      );
      if (user === null) throw new Error('user insert returned no row');

      for (const roleName of input.roles) {
        const role = await runner.queryOne<{ id: string }>('SELECT id FROM role WHERE name = $1', [
          roleName,
        ]);
        if (role === null) throw AppError.validation(`Unknown role: ${roleName}`);
        await runner.query(
          'INSERT INTO user_role (user_id, role_id, granted_by) VALUES ($1,$2,$3)',
          [user.id, role.id, actor.subject.userId],
        );
      }

      await runner.query(
        `INSERT INTO mfa_credential (user_id, kind, secret_ciphertext, label)
         VALUES ($1,'TOTP',$2,'Primary authenticator')`,
        [user.id, this.crypto.encrypt(secret)],
      );
      for (const code of recoveryCodes) {
        await runner.query(
          `INSERT INTO mfa_credential (user_id, kind, secret_ciphertext) VALUES ($1,'RECOVERY_CODE',$2)`,
          [user.id, this.crypto.encrypt(code)],
        );
      }

      await this.audit.record(
        {
          action: 'ADMIN_USER_MANAGE',
          outcome: 'PERMITTED',
          actorType: actor.subject.actorType,
          actorId: actor.subject.userId,
          actorDisplay: actor.displayName,
          agencyId: actor.subject.agencyId,
          agencyCode: actor.agencyCode,
          roles: actor.subject.roles,
          purpose: 'SYSTEM_ADMINISTRATION',
          resourceType: 'GOVERNMENT_USER',
          resourceId: user.id,
          correlationId: context.correlationId,
          ipAddress: context.ipAddress,
          detail: { change: 'USER_CREATED', roles: input.roles, agencyId: input.agencyId },
        },
        runner,
      );

      return {
        id: user.id,
        email: user.email,
        totpSecret: secret,
        provisioningUri: this.totp.provisioningUri(secret, input.email, 'PCID Plateau State'),
        recoveryCodes,
      };
    });
  }

  /** Confirm the authenticator, which is what makes the account usable. */
  async confirmMfa(
    actor: AuthenticatedActor,
    code: string,
    context: RequestContext,
  ): Promise<{ mfaEnrolled: boolean }> {
    const credential = await this.db.queryOne<{ id: string; secret_ciphertext: string }>(
      `SELECT id, secret_ciphertext FROM mfa_credential
        WHERE user_id = $1 AND kind = 'TOTP' AND confirmed_at IS NULL
        ORDER BY created_at DESC LIMIT 1`,
      [actor.subject.userId],
    );
    if (credential === null) {
      throw AppError.conflict('There is no authenticator awaiting confirmation for this account.');
    }
    const secret = this.crypto.decrypt(credential.secret_ciphertext);
    const result = this.totp.verify(secret, code);
    if (!result.valid) throw new AppError('UNAUTHENTICATED', 'That code is not correct.');

    await this.db.transaction(async (runner) => {
      await runner.query(
        'UPDATE mfa_credential SET confirmed_at = now(), last_used_counter = $2 WHERE id = $1',
        [credential.id, result.counter],
      );
      await runner.query('UPDATE government_user SET mfa_enrolled = true WHERE id = $1', [
        actor.subject.userId,
      ]);
    });
    await this.audit.record({
      action: 'ADMIN_USER_MANAGE',
      outcome: 'PERMITTED',
      actorType: actor.subject.actorType,
      actorId: actor.subject.userId,
      actorDisplay: actor.displayName,
      agencyId: actor.subject.agencyId,
      agencyCode: actor.agencyCode,
      purpose: 'SYSTEM_ADMINISTRATION',
      resourceType: 'GOVERNMENT_USER',
      resourceId: actor.subject.userId,
      correlationId: context.correlationId,
      ipAddress: context.ipAddress,
      detail: { change: 'MFA_CONFIRMED' },
    });
    return { mfaEnrolled: true };
  }
}
