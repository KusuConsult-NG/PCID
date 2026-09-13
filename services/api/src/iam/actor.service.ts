import { Injectable } from '@nestjs/common';
import type { Action, Classification, Jurisdiction } from '@pcid/contracts';
import type { AccessWindow, PolicySubject } from '@pcid/policy';

import { Database } from '../database/pool';
import type { AuthenticatedActor } from './actor';

interface GovernmentUserRow {
  id: string;
  email: string;
  full_name: string;
  status: string;
  mfa_enrolled: boolean;
  clearance: string;
  jurisdiction_scope: string;
  jurisdiction_lga_codes: string[];
  jurisdiction_ward_codes: string[];
  access_window: AccessWindow | null;
  agency_id: string;
  agency_code: string;
  agency_name: string;
  agency_category: string;
  agency_status: string;
  agency_max_classification: string;
  data_sharing_agreement: string;
  data_sharing_expires_at: Date | null;
}

interface CitizenAccountRow {
  id: string;
  pcid: string;
  email: string | null;
  status: string;
  mfa_enrolled: boolean;
  display_name: string | null;
}

/**
 * Assembles the policy subject the engine reasons over.
 *
 * Three things are worth noting about how this is built:
 *
 *  - Roles are resolved to *actions* here, and only actions reach the engine. A
 *    role named PLATFORM_ADMINISTRATOR is just a bag of administrative actions;
 *    it has no special meaning further down (§7).
 *  - An expired data-sharing agreement is downgraded on read, so an agreement
 *    that lapsed overnight stops citizen access without anyone running a job.
 *  - Compartments come from the agency registry, never from the agency's name.
 */
@Injectable()
export class ActorService {
  constructor(private readonly db: Database) {}

  async loadGovernmentActor(
    userId: string,
    sessionId: string,
    authenticationLevel: 'AAL1' | 'AAL2',
  ): Promise<AuthenticatedActor | null> {
    const row = await this.db.queryOne<GovernmentUserRow>(
      `SELECT u.id, u.email, u.full_name, u.status, u.mfa_enrolled, u.clearance,
              u.jurisdiction_scope, u.jurisdiction_lga_codes, u.jurisdiction_ward_codes,
              u.access_window,
              a.id AS agency_id, a.code AS agency_code, a.name AS agency_name,
              a.category AS agency_category, a.status AS agency_status,
              a.max_classification AS agency_max_classification,
              a.data_sharing_agreement, a.data_sharing_expires_at
         FROM government_user u
         JOIN agency a ON a.id = u.agency_id
        WHERE u.id = $1`,
      [userId],
    );
    if (row === null) return null;

    const actions = await this.actionsForUser(userId);
    const compartments = await this.compartmentsForAgency(row.agency_id);

    const agreementInForce =
      row.data_sharing_agreement === 'SIGNED' &&
      (row.data_sharing_expires_at === null || row.data_sharing_expires_at.getTime() > Date.now());

    const jurisdiction: Jurisdiction = {
      scope: row.jurisdiction_scope as Jurisdiction['scope'],
      lgaCodes: row.jurisdiction_lga_codes,
      wardCodes: row.jurisdiction_ward_codes,
    };

    const subject: PolicySubject = {
      userId: row.id,
      actorType: 'GOVERNMENT_USER',
      accountStatus: row.status as PolicySubject['accountStatus'],
      agencyId: row.agency_id,
      agencyCategory: row.agency_category as PolicySubject['agencyCategory'],
      agencyStatus: row.agency_status as PolicySubject['agencyStatus'],
      dataSharingAgreement: agreementInForce
        ? 'SIGNED'
        : row.data_sharing_agreement === 'SIGNED'
          ? 'EXPIRED'
          : (row.data_sharing_agreement as PolicySubject['dataSharingAgreement']),
      agencyMaxClassification: row.agency_max_classification as Classification,
      compartments,
      roles: await this.roleNamesForUser(userId),
      actions,
      clearance: row.clearance as Classification,
      jurisdiction,
      authenticationLevel,
      mfaEnrolled: row.mfa_enrolled,
      accessWindow: row.access_window,
      subjectPcid: null,
    };

    return {
      sessionId,
      displayName: row.full_name,
      email: row.email,
      agencyCode: row.agency_code,
      agencyName: row.agency_name,
      subject,
    };
  }

  async loadCitizenActor(
    accountId: string,
    sessionId: string,
    authenticationLevel: 'AAL1' | 'AAL2',
  ): Promise<AuthenticatedActor | null> {
    const row = await this.db.queryOne<CitizenAccountRow>(
      `SELECT ca.id, ca.pcid, ca.email, ca.status, ca.mfa_enrolled, c.display_name
         FROM citizen_account ca
         LEFT JOIN citizen c ON c.pcid = ca.pcid
        WHERE ca.id = $1`,
      [accountId],
    );
    if (row === null) return null;

    const actions = await this.actionsForRoleNames(['CITIZEN']);

    const subject: PolicySubject = {
      userId: row.id,
      actorType: 'CITIZEN',
      accountStatus: row.status as PolicySubject['accountStatus'],
      agencyId: null,
      agencyCategory: null,
      agencyStatus: null,
      dataSharingAgreement: null,
      // A citizen's ceiling on their own record is the top of the scale; the
      // self-service scope gate and the catalogue's self-service flags are what
      // actually bound what they see.
      agencyMaxClassification: 'HIGHLY_RESTRICTED',
      compartments: [],
      roles: ['CITIZEN'],
      actions,
      clearance: 'HIGHLY_RESTRICTED',
      jurisdiction: { scope: 'STATE', lgaCodes: [], wardCodes: [] },
      authenticationLevel,
      mfaEnrolled: row.mfa_enrolled,
      accessWindow: null,
      subjectPcid: row.pcid,
    };

    return {
      sessionId,
      displayName: row.display_name ?? 'Citizen',
      email: row.email,
      agencyCode: null,
      agencyName: null,
      subject,
    };
  }

  async actionsForUser(userId: string): Promise<readonly Action[]> {
    const rows = await this.db.query<{ action: string }>(
      `SELECT DISTINCT ra.action
         FROM user_role ur
         JOIN role_action ra ON ra.role_id = ur.role_id
        WHERE ur.user_id = $1
          AND (ur.expires_at IS NULL OR ur.expires_at > now())`,
      [userId],
    );
    return rows.map((row) => row.action as Action);
  }

  async roleNamesForUser(userId: string): Promise<readonly string[]> {
    const rows = await this.db.query<{ name: string }>(
      `SELECT r.name
         FROM user_role ur
         JOIN role r ON r.id = ur.role_id
        WHERE ur.user_id = $1
          AND (ur.expires_at IS NULL OR ur.expires_at > now())
        ORDER BY r.name`,
      [userId],
    );
    return rows.map((row) => row.name);
  }

  private async actionsForRoleNames(names: readonly string[]): Promise<readonly Action[]> {
    const rows = await this.db.query<{ action: string }>(
      `SELECT DISTINCT ra.action
         FROM role r JOIN role_action ra ON ra.role_id = r.id
        WHERE r.name = ANY($1::text[])`,
      [names],
    );
    return rows.map((row) => row.action as Action);
  }

  private async compartmentsForAgency(agencyId: string): Promise<readonly Classification[]> {
    const rows = await this.db.query<{ compartment: string }>(
      'SELECT compartment FROM agency_compartment_grant WHERE agency_id = $1',
      [agencyId],
    );
    return rows.map((row) => row.compartment as Classification);
  }
}
