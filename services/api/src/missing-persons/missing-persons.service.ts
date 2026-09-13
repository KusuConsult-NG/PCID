import { Injectable } from '@nestjs/common';
import type {
  MissingPersonStatus,
  UnidentifiedPersonCondition,
  UnidentifiedPersonStatus,
} from '@pcid/contracts';
import { OPEN_MISSING_PERSON_STATUSES } from '@pcid/contracts';

import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { RequestContext } from '../common/correlation';
import { project, withheld } from '../common/projection';
import { WhereBuilder } from '../common/sql';
import { Database } from '../database/pool';
import type { AuthenticatedActor } from '../iam/actor';
import { PolicyService } from '../policy/policy.service';
import { MatchingEngine } from './matching.engine';
import type { MissingPersonProfile } from './matching.engine';
import type { PolicyDecision } from '@pcid/policy';

export interface CreateMissingPersonInput {
  readonly fullName: string;
  readonly citizenPcid?: string | null;
  readonly ageYears?: number | null;
  readonly sex?: string | null;
  readonly photographUri?: string | null;
  readonly physicalDescription?: string | null;
  readonly clothingDescription?: string | null;
  readonly distinguishingFeatures?: string | null;
  readonly lastSeenAddress?: string | null;
  readonly lastSeenLgaCode?: string | null;
  readonly lastSeenWardCode?: string | null;
  readonly lastSeenAt?: string | null;
  readonly circumstances?: string | null;
  readonly reporterName?: string | null;
  readonly reporterPhone?: string | null;
  readonly reporterRelationship?: string | null;
  readonly caseId?: string | null;
}

export interface CreateUnidentifiedPersonInput {
  readonly condition: UnidentifiedPersonCondition;
  readonly estimatedAgeMin?: number | null;
  readonly estimatedAgeMax?: number | null;
  readonly apparentSex?: string | null;
  readonly photographUri?: string | null;
  readonly physicalDescription?: string | null;
  readonly clothingDescription?: string | null;
  readonly distinguishingFeatures?: string | null;
  readonly identityClues?: string | null;
  readonly foundAddress?: string | null;
  readonly foundLgaCode?: string | null;
  readonly foundWardCode?: string | null;
  readonly incidentId?: string | null;
  /**
   * Reference held by an agency that has lawful authority and infrastructure for
   * biometrics. The platform stores the reference only and performs no biometric
   * matching of its own (§12).
   */
  readonly externalBiometricReference?: string | null;
  readonly biometricCustodianAgencyId?: string | null;
}

/**
 * Missing and unidentified persons (master system prompt §11, §12, §13).
 *
 * The two registers are kept apart and joined only through reviewed candidate
 * matches. Nothing here ever sets a person's identity from a score: `confirmMatch`
 * requires a named reviewer, and the database refuses a CONFIRMED row without one.
 */
@Injectable()
export class MissingPersonsService {
  constructor(
    private readonly db: Database,
    private readonly policy: PolicyService,
    private readonly matching: MatchingEngine,
    private readonly audit: AuditService,
  ) {}

  async createMissingPerson(
    actor: AuthenticatedActor,
    input: CreateMissingPersonInput,
    context: RequestContext,
  ): Promise<{ caseReference: string; id: string; status: MissingPersonStatus }> {
    const isCitizen = actor.subject.actorType === 'CITIZEN';
    await this.policy.authorize({
      actor,
      action: 'MISSING_PERSON_CREATE',
      purpose: isCitizen ? 'CITIZEN_SELF_SERVICE' : 'MISSING_PERSON_INVESTIGATION',
      resource: {
        type: 'MISSING_PERSON',
        id: null,
        classification: 'SENSITIVE',
        subjectPcid: input.citizenPcid ?? null,
        lgaCode: input.lastSeenLgaCode ?? null,
        wardCode: input.lastSeenWardCode ?? null,
      },
      caseRef: input.caseId ?? null,
      context,
    });

    const caseReference = await this.policy.nextReference('MISSING_PERSON', 'MP');

    return this.db.transaction(async (runner) => {
      const row = await runner.queryOne<{ id: string; status: MissingPersonStatus }>(
        `INSERT INTO missing_person (
           case_reference, case_id, citizen_pcid, full_name, age_years, sex, photograph_uri,
           physical_description, clothing_description, distinguishing_features,
           last_seen_address, last_seen_lga_code, last_seen_ward_code, last_seen_at,
           circumstances, reporter_name, reporter_phone, reporter_relationship,
           reporter_citizen_pcid, status, agency_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'REPORTED',$20)
         RETURNING id, status`,
        [
          caseReference,
          input.caseId ?? null,
          input.citizenPcid ?? null,
          input.fullName,
          input.ageYears ?? null,
          input.sex ?? null,
          input.photographUri ?? null,
          input.physicalDescription ?? null,
          input.clothingDescription ?? null,
          input.distinguishingFeatures ?? null,
          input.lastSeenAddress ?? null,
          input.lastSeenLgaCode ?? null,
          input.lastSeenWardCode ?? null,
          input.lastSeenAt ?? null,
          input.circumstances ?? null,
          input.reporterName ?? (isCitizen ? actor.displayName : null),
          input.reporterPhone ?? null,
          input.reporterRelationship ?? null,
          isCitizen ? actor.subject.subjectPcid : null,
          actor.subject.agencyId,
        ],
      );
      if (row === null) throw new Error('missing person insert returned no row');

      if (!isCitizen) {
        await runner.query(
          'INSERT INTO missing_person_officer (missing_person_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [row.id, actor.subject.userId],
        );
      }

      await this.audit.record(
        {
          action: 'MISSING_PERSON_CREATE',
          outcome: 'PERMITTED',
          actorType: actor.subject.actorType,
          actorId: actor.subject.userId,
          actorDisplay: actor.displayName,
          agencyId: actor.subject.agencyId,
          agencyCode: actor.agencyCode,
          roles: actor.subject.roles,
          purpose: isCitizen ? 'CITIZEN_SELF_SERVICE' : 'MISSING_PERSON_INVESTIGATION',
          resourceType: 'MISSING_PERSON',
          resourceId: row.id,
          subjectPcid: input.citizenPcid ?? null,
          correlationId: context.correlationId,
          ipAddress: context.ipAddress,
          detail: { caseReference, reportedByCitizen: isCitizen },
        },
        runner,
      );

      return { caseReference, id: row.id, status: row.status };
    });
  }

  async listMissingPersons(
    actor: AuthenticatedActor,
    filters: {
      status?: MissingPersonStatus;
      openOnly?: boolean;
      lgaCode?: string;
      limit: number;
      offset: number;
    },
    context: RequestContext,
  ): Promise<{ records: Record<string, unknown>[]; total: number }> {
    const outcome = await this.policy.authorize({
      actor,
      action: 'MISSING_PERSON_VIEW',
      purpose: 'MISSING_PERSON_INVESTIGATION',
      resource: {
        type: 'MISSING_PERSON',
        id: null,
        classification: 'SENSITIVE',
        subjectPcid: null,
        lgaCode: filters.lgaCode ?? null,
      },
      context,
    });

    const where = new WhereBuilder();
    if (filters.status !== undefined) where.add('status = ?', filters.status);
    if (filters.openOnly === true)
      where.add('status = ANY(?::text[])', [...OPEN_MISSING_PERSON_STATUSES]);
    if (filters.lgaCode !== undefined) where.add('last_seen_lga_code = ?', filters.lgaCode);

    const rows = await this.db.query<MissingPersonRow>(
      `SELECT * FROM missing_person ${where.sql} ORDER BY created_at DESC
        LIMIT $${where.next()} OFFSET $${where.next(2)}`,
      where.withExtra(filters.limit, filters.offset),
    );
    const total = await this.db.queryOne<{ count: string }>(
      `SELECT count(*)::text AS count FROM missing_person ${where.sql}`,
      where.params,
    );
    return {
      records: rows.map((row) => toMissingPerson(row, outcome.decision)),
      total: Number(total?.count ?? 0),
    };
  }

  async viewMissingPerson(
    actor: AuthenticatedActor,
    reference: string,
    context: RequestContext,
  ): Promise<Record<string, unknown>> {
    const row = await this.findMissingPerson(reference);
    const outcome = await this.policy.authorize({
      actor,
      action: 'MISSING_PERSON_VIEW',
      purpose: 'MISSING_PERSON_INVESTIGATION',
      resource: {
        type: 'MISSING_PERSON',
        id: row?.id ?? null,
        classification: 'SENSITIVE',
        subjectPcid: row?.citizen_pcid ?? null,
        lgaCode: row?.last_seen_lga_code ?? null,
      },
      caseRef: row?.case_id ?? null,
      context,
    });
    if (row === null) throw AppError.notFoundOrNotPermitted(`no missing person ${reference}`);

    const [sightings, matches] = await Promise.all([
      this.db.query<{
        id: string;
        reported_at: Date;
        description: string;
        verification_status: string;
        address_text: string | null;
      }>(
        `SELECT id, reported_at, description, verification_status, address_text
           FROM sighting WHERE missing_person_id = $1 ORDER BY reported_at DESC`,
        [row.id],
      ),
      this.db.query<{
        id: string;
        score: string;
        status: string;
        factors: unknown;
        engine_version: string;
        unidentified_person_id: string | null;
      }>(
        `SELECT id, score, status, factors, engine_version, unidentified_person_id
           FROM person_match WHERE missing_person_id = $1 ORDER BY score DESC`,
        [row.id],
      ),
    ]);

    return {
      ...toMissingPerson(row, outcome.decision),
      sightings: sightings.map((sighting) => ({
        id: sighting.id,
        reportedAt: sighting.reported_at.toISOString(),
        description: sighting.description,
        address: sighting.address_text,
        verificationStatus: sighting.verification_status,
      })),
      candidateMatches: matches.map((match) => ({
        id: match.id,
        score: Number(match.score),
        status: match.status,
        engineVersion: match.engine_version,
        unidentifiedPersonId: match.unidentified_person_id,
        // §67: the alert explains itself.
        explanation: {
          factorsConsidered: match.factors,
          note: 'A candidate match is a prompt for human verification, never an identification.',
        },
      })),
    };
  }

  async createUnidentifiedPerson(
    actor: AuthenticatedActor,
    input: CreateUnidentifiedPersonInput,
    incidentRef: string | null,
    context: RequestContext,
  ): Promise<{ reference: string; id: string }> {
    await this.policy.authorize({
      actor,
      action: 'UNIDENTIFIED_PERSON_CREATE',
      purpose: 'EMERGENCY_IDENTIFICATION',
      resource: {
        type: 'UNIDENTIFIED_PERSON',
        id: null,
        classification: 'SENSITIVE',
        subjectPcid: null,
        lgaCode: input.foundLgaCode ?? null,
        wardCode: input.foundWardCode ?? null,
      },
      incidentRef,
      context,
    });

    const reference = await this.policy.nextReference('UNIDENTIFIED_PERSON', 'UP');
    const row = await this.db.queryOne<{ id: string }>(
      `INSERT INTO unidentified_person (
         reference, incident_id, condition, estimated_age_min, estimated_age_max, apparent_sex,
         photograph_uri, physical_description, clothing_description, distinguishing_features,
         identity_clues, found_address, found_lga_code, found_ward_code,
         external_biometric_reference, biometric_custodian_agency_id, agency_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING id`,
      [
        reference,
        input.incidentId ?? null,
        input.condition,
        input.estimatedAgeMin ?? null,
        input.estimatedAgeMax ?? null,
        input.apparentSex ?? null,
        input.photographUri ?? null,
        input.physicalDescription ?? null,
        input.clothingDescription ?? null,
        input.distinguishingFeatures ?? null,
        input.identityClues ?? null,
        input.foundAddress ?? null,
        input.foundLgaCode ?? null,
        input.foundWardCode ?? null,
        input.externalBiometricReference ?? null,
        input.biometricCustodianAgencyId ?? null,
        actor.subject.agencyId,
      ],
    );
    if (row === null) throw new Error('unidentified person insert returned no row');

    await this.audit.record({
      action: 'UNIDENTIFIED_PERSON_CREATE',
      outcome: 'PERMITTED',
      actorType: actor.subject.actorType,
      actorId: actor.subject.userId,
      actorDisplay: actor.displayName,
      agencyId: actor.subject.agencyId,
      agencyCode: actor.agencyCode,
      roles: actor.subject.roles,
      purpose: 'EMERGENCY_IDENTIFICATION',
      resourceType: 'UNIDENTIFIED_PERSON',
      resourceId: row.id,
      correlationId: context.correlationId,
      ipAddress: context.ipAddress,
      detail: {
        reference,
        condition: input.condition,
        biometricReferenceHeldExternally: input.externalBiometricReference != null,
      },
    });
    return { reference, id: row.id };
  }

  /** Run the matching engine and persist the candidates it produces. */
  async runMatching(
    actor: AuthenticatedActor,
    reference: string,
    context: RequestContext,
  ): Promise<{ caseReference: string; candidates: Record<string, unknown>[] }> {
    const row = await this.findMissingPerson(reference);
    await this.policy.authorize({
      actor,
      action: 'MATCH_RUN',
      purpose: 'MISSING_PERSON_INVESTIGATION',
      resource: {
        type: 'MISSING_PERSON',
        id: row?.id ?? null,
        classification: 'SENSITIVE',
        subjectPcid: row?.citizen_pcid ?? null,
        lgaCode: row?.last_seen_lga_code ?? null,
      },
      caseRef: row?.case_id ?? null,
      context,
    });
    if (row === null) throw AppError.notFoundOrNotPermitted(`no missing person ${reference}`);

    const profile: MissingPersonProfile = {
      id: row.id,
      caseReference: row.case_reference,
      fullName: row.full_name,
      ageYears: row.age_years,
      sex: row.sex,
      lastSeenLgaCode: row.last_seen_lga_code,
      lastSeenWardCode: row.last_seen_ward_code,
      lastSeenAt: row.last_seen_at,
      distinguishingFeatures: row.distinguishing_features,
      citizenPcid: row.citizen_pcid,
    };
    const candidates = await this.matching.findCandidates(profile);

    for (const candidate of candidates) {
      await this.db.query(
        `INSERT INTO person_match (
           missing_person_id, unidentified_person_id, candidate_citizen_pcid, score, factors,
           engine_version, status
         ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,'CANDIDATE')
         ON CONFLICT DO NOTHING`,
        [
          row.id,
          candidate.unidentifiedPersonId,
          candidate.candidateCitizenPcid,
          candidate.score,
          JSON.stringify(candidate.factors),
          MatchingEngine.VERSION,
        ],
      );
    }

    await this.audit.record({
      action: 'MATCH_RUN',
      outcome: 'PERMITTED',
      actorType: actor.subject.actorType,
      actorId: actor.subject.userId,
      actorDisplay: actor.displayName,
      agencyId: actor.subject.agencyId,
      agencyCode: actor.agencyCode,
      roles: actor.subject.roles,
      purpose: 'MISSING_PERSON_INVESTIGATION',
      resourceType: 'MISSING_PERSON',
      resourceId: row.id,
      subjectPcid: row.citizen_pcid,
      correlationId: context.correlationId,
      ipAddress: context.ipAddress,
      detail: {
        caseReference: row.case_reference,
        candidateCount: candidates.length,
        engineVersion: MatchingEngine.VERSION,
      },
    });

    return {
      caseReference: row.case_reference,
      candidates: candidates.map((candidate) => ({
        unidentifiedPersonReference: candidate.reference,
        score: candidate.score,
        status: 'CANDIDATE',
        explanation: {
          engineVersion: MatchingEngine.VERSION,
          factorsConsidered: candidate.factors,
          confidence: candidate.score,
          note: 'This is a candidate for human verification. It is not an identification.',
        },
      })),
    };
  }

  /**
   * Confirm or reject a candidate. Only a person does this, and the decision is
   * recorded against them (§13).
   */
  async reviewMatch(
    actor: AuthenticatedActor,
    matchId: string,
    decision: 'CONFIRMED' | 'REJECTED',
    note: string,
    context: RequestContext,
  ): Promise<{ matchId: string; status: string; identifiedPcid: string | null }> {
    const match = await this.db.queryOne<{
      id: string;
      missing_person_id: string;
      unidentified_person_id: string | null;
      status: string;
      citizen_pcid: string | null;
      case_id: string | null;
      last_seen_lga_code: string | null;
    }>(
      `SELECT pm.id, pm.missing_person_id, pm.unidentified_person_id, pm.status,
              mp.citizen_pcid, mp.case_id, mp.last_seen_lga_code
         FROM person_match pm JOIN missing_person mp ON mp.id = pm.missing_person_id
        WHERE pm.id = $1`,
      [matchId],
    );

    await this.policy.authorize({
      actor,
      action: 'MATCH_CONFIRM',
      purpose: 'MISSING_PERSON_INVESTIGATION',
      resource: {
        type: 'MISSING_PERSON',
        id: match?.missing_person_id ?? null,
        classification: 'SENSITIVE',
        subjectPcid: match?.citizen_pcid ?? null,
        lgaCode: match?.last_seen_lga_code ?? null,
      },
      caseRef: match?.case_id ?? null,
      context,
      auditDetail: { decision },
    });
    if (match === null) throw AppError.notFoundOrNotPermitted(`no match ${matchId}`);
    if (match.status !== 'CANDIDATE' && match.status !== 'UNDER_REVIEW') {
      throw AppError.conflict('That candidate has already been reviewed.');
    }

    return this.db.transaction(async (runner) => {
      await runner.query(
        `UPDATE person_match SET status = $2, reviewed_by_user_id = $3, reviewed_at = now(), review_note = $4
          WHERE id = $1`,
        [matchId, decision, actor.subject.userId, note],
      );

      let identifiedPcid: string | null = null;
      if (decision === 'CONFIRMED') {
        identifiedPcid = match.citizen_pcid;
        if (match.unidentified_person_id !== null) {
          await runner.query(
            `UPDATE unidentified_person
                SET status = CASE WHEN $2::text IS NOT NULL THEN 'IDENTIFIED' ELSE 'PROVISIONALLY_IDENTIFIED' END,
                    identified_pcid = $2, identified_at = now(), identified_by_user_id = $3
              WHERE id = $1`,
            [match.unidentified_person_id, identifiedPcid, actor.subject.userId],
          );
        }
        await runner.query(
          `UPDATE missing_person SET status = 'LOCATED' WHERE id = $1 AND status <> 'REUNITED'`,
          [match.missing_person_id],
        );
        // Any other open candidate for the same person is superseded, not left
        // hanging for someone else to act on.
        await runner.query(
          `UPDATE person_match SET status = 'SUPERSEDED'
            WHERE missing_person_id = $1 AND id <> $2 AND status IN ('CANDIDATE','UNDER_REVIEW')`,
          [match.missing_person_id, matchId],
        );
      }

      await this.audit.record(
        {
          action: 'MATCH_CONFIRM',
          outcome: 'PERMITTED',
          actorType: actor.subject.actorType,
          actorId: actor.subject.userId,
          actorDisplay: actor.displayName,
          agencyId: actor.subject.agencyId,
          agencyCode: actor.agencyCode,
          roles: actor.subject.roles,
          purpose: 'MISSING_PERSON_INVESTIGATION',
          resourceType: 'MISSING_PERSON',
          resourceId: match.missing_person_id,
          subjectPcid: identifiedPcid,
          correlationId: context.correlationId,
          ipAddress: context.ipAddress,
          detail: { matchId, decision, note, decidedBy: actor.displayName },
        },
        runner,
      );

      return { matchId, status: decision, identifiedPcid };
    });
  }

  async resolveMissingPerson(
    actor: AuthenticatedActor,
    reference: string,
    status: 'LOCATED' | 'REUNITED' | 'CLOSED' | 'CANCELLED',
    note: string,
    context: RequestContext,
  ): Promise<{ caseReference: string; status: MissingPersonStatus }> {
    const row = await this.findMissingPerson(reference);
    await this.policy.authorize({
      actor,
      action: 'MISSING_PERSON_RESOLVE',
      purpose: 'MISSING_PERSON_INVESTIGATION',
      resource: {
        type: 'MISSING_PERSON',
        id: row?.id ?? null,
        classification: 'SENSITIVE',
        subjectPcid: row?.citizen_pcid ?? null,
        lgaCode: row?.last_seen_lga_code ?? null,
      },
      caseRef: row?.case_id ?? null,
      context,
    });
    if (row === null) throw AppError.notFoundOrNotPermitted(`no missing person ${reference}`);

    const updated = await this.db.queryOne<{ case_reference: string; status: MissingPersonStatus }>(
      `UPDATE missing_person SET status = $2, resolved_at = now(), resolution_note = $3
        WHERE id = $1 RETURNING case_reference, status`,
      [row.id, status, note],
    );
    if (updated === null) throw new Error('missing person update returned no row');

    await this.audit.record({
      action: 'MISSING_PERSON_RESOLVE',
      outcome: 'PERMITTED',
      actorType: actor.subject.actorType,
      actorId: actor.subject.userId,
      actorDisplay: actor.displayName,
      agencyId: actor.subject.agencyId,
      agencyCode: actor.agencyCode,
      roles: actor.subject.roles,
      purpose: 'MISSING_PERSON_INVESTIGATION',
      resourceType: 'MISSING_PERSON',
      resourceId: row.id,
      subjectPcid: row.citizen_pcid,
      correlationId: context.correlationId,
      ipAddress: context.ipAddress,
      detail: { status, note },
    });
    return { caseReference: updated.case_reference, status: updated.status };
  }

  async findMissingPerson(reference: string): Promise<MissingPersonRow | null> {
    return this.db.queryOne<MissingPersonRow>(
      'SELECT * FROM missing_person WHERE case_reference = $1 OR id::text = $1',
      [reference],
    );
  }
}

export interface MissingPersonRow {
  id: string;
  case_reference: string;
  case_id: string | null;
  citizen_pcid: string | null;
  full_name: string;
  age_years: number | null;
  sex: string | null;
  photograph_uri: string | null;
  physical_description: string | null;
  clothing_description: string | null;
  distinguishing_features: string | null;
  last_seen_address: string | null;
  last_seen_lga_code: string | null;
  last_seen_ward_code: string | null;
  last_seen_at: Date | null;
  circumstances: string | null;
  reporter_name: string | null;
  reporter_phone: string | null;
  reporter_relationship: string | null;
  status: MissingPersonStatus;
  created_at: Date;
  resolved_at: Date | null;
  resolution_note: string | null;
}

/**
 * Map a stored missing-person row onto catalogue field paths, so the response is
 * projected through the policy decision like every other record (§27).
 */
function missingPersonFieldValues(row: MissingPersonRow): Record<string, unknown> {
  return {
    'missingPerson.caseReference': row.case_reference,
    'missingPerson.status': row.status,
    'missingPerson.citizenPcid': row.citizen_pcid,
    'missingPerson.fullName': row.full_name,
    'missingPerson.ageYears': row.age_years,
    'missingPerson.sex': row.sex,
    'missingPerson.photographUri': row.photograph_uri,
    'missingPerson.physicalDescription': row.physical_description,
    'missingPerson.clothingDescription': row.clothing_description,
    'missingPerson.distinguishingFeatures': row.distinguishing_features,
    'missingPerson.lastSeen': {
      address: row.last_seen_address,
      lgaCode: row.last_seen_lga_code,
      wardCode: row.last_seen_ward_code,
      at: row.last_seen_at?.toISOString() ?? null,
    },
    'missingPerson.circumstances': row.circumstances,
    'missingPerson.reporter': {
      name: row.reporter_name,
      phone: row.reporter_phone,
      relationship: row.reporter_relationship,
    },
    'missingPerson.resolution': {
      resolvedAt: row.resolved_at?.toISOString() ?? null,
      note: row.resolution_note,
    },
  };
}

function toMissingPerson(row: MissingPersonRow, decision: PolicyDecision): Record<string, unknown> {
  return {
    id: row.id,
    createdAt: row.created_at.toISOString(),
    ...project(decision, missingPersonFieldValues(row)),
    restrictedFields: withheld(decision),
  };
}

export type { UnidentifiedPersonStatus };
