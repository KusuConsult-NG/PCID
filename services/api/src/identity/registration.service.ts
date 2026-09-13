import { Injectable } from '@nestjs/common';
import type { RegistrationChannel, Sex } from '@pcid/contracts';

import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { RequestContext } from '../common/correlation';
import { Database } from '../database/pool';
import type { AuthenticatedActor } from '../iam/actor';
import { PolicyService } from '../policy/policy.service';
import { DuplicateDetectionService } from './duplicate-detection';
import type { DuplicateCandidate } from './duplicate-detection';
import { PcidService } from './pcid.service';

export interface RegistrationInput {
  readonly givenName: string;
  readonly middleName?: string | null;
  readonly familyName: string;
  readonly sex: Sex;
  readonly dateOfBirth: string;
  readonly phonePrimary?: string | null;
  readonly phoneSecondary?: string | null;
  readonly email?: string | null;
  readonly residentialAddress?: string | null;
  readonly lgaCode?: string | null;
  readonly wardCode?: string | null;
  readonly communityCode?: string | null;
  readonly channel: RegistrationChannel;
  /** Optional external identifier, supplied only by an authoritative source. */
  readonly nin?: string | null;
}

export type RegistrationOutcome =
  | {
      readonly status: 'ISSUED';
      readonly reference: string;
      readonly pcid: string;
      readonly verificationLevel: string;
    }
  | {
      readonly status: 'DUPLICATE_REVIEW';
      readonly reference: string;
      readonly candidates: readonly { score: number; factors: readonly unknown[] }[];
      readonly message: string;
    };

/**
 * Citizen registration (master system prompt §50, §51).
 *
 * The workflow in full: record the request, search for duplicates, and only then
 * allocate an identifier. A registration that looks like an existing person stops
 * and waits for a human - the platform never merges records on a score, and never
 * issues a second PCID to someone who may already hold one without a decision
 * being recorded against a named officer.
 *
 * A NIN is accepted if an authoritative source supplied one, and is never
 * required: the PCID stands on its own (§2).
 */
@Injectable()
export class RegistrationService {
  constructor(
    private readonly db: Database,
    private readonly policy: PolicyService,
    private readonly pcid: PcidService,
    private readonly duplicates: DuplicateDetectionService,
    private readonly audit: AuditService,
  ) {}

  async register(
    actor: AuthenticatedActor,
    input: RegistrationInput,
    context: RequestContext,
  ): Promise<RegistrationOutcome> {
    await this.policy.authorize({
      actor,
      action: 'CITIZEN_CREATE',
      purpose: 'SERVICE_DELIVERY',
      resource: {
        type: 'CITIZEN',
        id: null,
        classification: 'CONFIDENTIAL',
        subjectPcid: null,
        lgaCode: input.lgaCode ?? null,
        wardCode: input.wardCode ?? null,
      },
      context,
      auditDetail: { channel: input.channel },
    });

    const reference = await this.policy.nextReference('REGISTRATION', 'REG');

    return this.db.transaction(async (runner) => {
      const request = await runner.queryOne<{ id: string }>(
        `INSERT INTO registration_request (reference, status, channel, payload,
           submitted_by_user_id, submitted_by_agency_id)
         VALUES ($1, 'SUBMITTED', $2, $3::jsonb, $4, $5)
         RETURNING id`,
        [
          reference,
          input.channel,
          JSON.stringify(redactForStorage(input)),
          actor.subject.actorType === 'GOVERNMENT_USER' ? actor.subject.userId : null,
          actor.subject.agencyId,
        ],
      );
      if (request === null) throw new Error('registration insert returned no row');

      const candidates = await this.duplicates.findCandidates(
        {
          givenName: input.givenName,
          familyName: input.familyName,
          dateOfBirth: input.dateOfBirth,
          phonePrimary: input.phonePrimary ?? null,
          email: input.email ?? null,
          lgaCode: input.lgaCode ?? null,
          wardCode: input.wardCode ?? null,
          nin: input.nin ?? null,
        },
        runner,
      );

      if (candidates.length > 0) {
        await this.queueForReview(runner, request.id, candidates);
        await runner.query(
          `UPDATE registration_request SET status = 'DUPLICATE_REVIEW' WHERE id = $1`,
          [request.id],
        );
        await this.raiseIdentityIntegrityAlert(runner, reference, candidates);
        await this.audit.record(
          {
            action: 'CITIZEN_CREATE',
            outcome: 'PERMITTED',
            actorType: actor.subject.actorType,
            actorId: actor.subject.userId,
            actorDisplay: actor.displayName,
            agencyId: actor.subject.agencyId,
            agencyCode: actor.agencyCode,
            roles: actor.subject.roles,
            purpose: 'SERVICE_DELIVERY',
            resourceType: 'CITIZEN',
            resourceId: reference,
            correlationId: context.correlationId,
            ipAddress: context.ipAddress,
            detail: {
              step: 'DUPLICATE_REVIEW_QUEUED',
              candidateCount: candidates.length,
              highestScore: candidates[0]?.score ?? 0,
            },
          },
          runner,
        );
        return {
          status: 'DUPLICATE_REVIEW' as const,
          reference,
          candidates: candidates.map((candidate) => ({
            score: candidate.score,
            factors: candidate.factors,
          })),
          message:
            'This registration closely matches an existing record and has been sent for review. No identifier has been issued.',
        };
      }

      const pcid = await this.pcid.allocate(runner, {
        channel: input.channel,
        allocatedBy: actor.subject.actorType === 'GOVERNMENT_USER' ? actor.subject.userId : null,
      });

      const displayName = [input.givenName, input.middleName, input.familyName]
        .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
        .join(' ');

      await runner.query(
        `INSERT INTO citizen (
           pcid, status, given_name, middle_name, family_name, display_name, sex, date_of_birth,
           phone_primary, phone_secondary, email, residential_address, lga_code, ward_code,
           community_code, nin, nin_source_agency_id, verification_level, classification,
           source_agency_id, registration_channel
         ) VALUES ($1,'ACTIVE',$2,$3,$4,$5,$6,$7::date,$8,$9,$10,$11,$12,$13,$14,$15,$16,
                   'SELF_ASSERTED','CONFIDENTIAL',$17,$18)`,
        [
          pcid,
          input.givenName,
          input.middleName ?? null,
          input.familyName,
          displayName,
          input.sex,
          input.dateOfBirth,
          input.phonePrimary ?? null,
          input.phoneSecondary ?? null,
          input.email ?? null,
          input.residentialAddress ?? null,
          input.lgaCode ?? null,
          input.wardCode ?? null,
          input.communityCode ?? null,
          input.nin ?? null,
          input.nin != null ? actor.subject.agencyId : null,
          actor.subject.agencyId,
          input.channel,
        ],
      );

      await runner.query(
        `UPDATE registration_request SET status = 'ISSUED', issued_pcid = $2,
                decided_by_user_id = $3, decided_at = now()
          WHERE id = $1`,
        [
          request.id,
          pcid,
          actor.subject.actorType === 'GOVERNMENT_USER' ? actor.subject.userId : null,
        ],
      );

      await this.audit.record(
        {
          action: 'CITIZEN_CREATE',
          outcome: 'PERMITTED',
          actorType: actor.subject.actorType,
          actorId: actor.subject.userId,
          actorDisplay: actor.displayName,
          agencyId: actor.subject.agencyId,
          agencyCode: actor.agencyCode,
          roles: actor.subject.roles,
          purpose: 'SERVICE_DELIVERY',
          resourceType: 'CITIZEN',
          resourceId: pcid,
          subjectPcid: pcid,
          correlationId: context.correlationId,
          ipAddress: context.ipAddress,
          detail: {
            step: 'PCID_ISSUED',
            registrationReference: reference,
            channel: input.channel,
            ninSupplied: input.nin != null,
          },
        },
        runner,
      );

      return {
        status: 'ISSUED' as const,
        reference,
        pcid,
        verificationLevel: 'SELF_ASSERTED',
      };
    });
  }

  /** Resolve a queued duplicate candidate. Only a person can do this (§51). */
  async reviewDuplicate(
    actor: AuthenticatedActor,
    candidateId: string,
    decision: 'CONFIRMED_DUPLICATE' | 'DISTINCT_PERSON',
    note: string,
    context: RequestContext,
  ): Promise<{ status: string; registrationReference: string | null; issuedPcid: string | null }> {
    await this.policy.authorize({
      actor,
      action: 'DUPLICATE_REVIEW',
      purpose: 'IDENTITY_INTEGRITY_REVIEW',
      resource: {
        type: 'CITIZEN',
        id: candidateId,
        classification: 'SENSITIVE',
        subjectPcid: null,
      },
      context,
    });

    return this.db.transaction(async (runner) => {
      const candidate = await runner.queryOne<{
        id: string;
        registration_request_id: string | null;
        status: string;
      }>('SELECT id, registration_request_id, status FROM duplicate_candidate WHERE id = $1', [
        candidateId,
      ]);
      if (candidate === null) {
        throw AppError.notFoundOrNotPermitted(`no duplicate candidate ${candidateId}`);
      }
      if (candidate.status !== 'PENDING_REVIEW') {
        throw AppError.conflict('That candidate has already been reviewed.');
      }

      await runner.query(
        `UPDATE duplicate_candidate
            SET status = $2, reviewed_by_user_id = $3, reviewed_at = now(), review_note = $4
          WHERE id = $1`,
        [candidateId, decision, actor.subject.userId, note],
      );

      let issuedPcid: string | null = null;
      let registrationReference: string | null = null;

      if (candidate.registration_request_id !== null) {
        const remaining = await runner.queryOne<{ count: string }>(
          `SELECT count(*)::text AS count FROM duplicate_candidate
            WHERE registration_request_id = $1 AND status = 'PENDING_REVIEW'`,
          [candidate.registration_request_id],
        );
        const request = await runner.queryOne<{ reference: string; payload: RegistrationInput }>(
          'SELECT reference, payload FROM registration_request WHERE id = $1',
          [candidate.registration_request_id],
        );
        registrationReference = request?.reference ?? null;

        if (decision === 'CONFIRMED_DUPLICATE') {
          await runner.query(
            `UPDATE registration_request
                SET status = 'REJECTED', rejection_reason = $2,
                    decided_by_user_id = $3, decided_at = now()
              WHERE id = $1`,
            [
              candidate.registration_request_id,
              'Confirmed as an existing registered person.',
              actor.subject.userId,
            ],
          );
        } else if (Number(remaining?.count ?? 0) === 0 && request !== null) {
          issuedPcid = await this.issueFromRequest(
            runner,
            candidate.registration_request_id,
            request.payload,
            actor,
          );
        }
      }

      await this.audit.record(
        {
          action: 'DUPLICATE_REVIEW',
          outcome: 'PERMITTED',
          actorType: actor.subject.actorType,
          actorId: actor.subject.userId,
          actorDisplay: actor.displayName,
          agencyId: actor.subject.agencyId,
          agencyCode: actor.agencyCode,
          roles: actor.subject.roles,
          purpose: 'IDENTITY_INTEGRITY_REVIEW',
          resourceType: 'CITIZEN',
          resourceId: candidateId,
          subjectPcid: issuedPcid,
          correlationId: context.correlationId,
          ipAddress: context.ipAddress,
          detail: { decision, issuedPcid, registrationReference },
        },
        runner,
      );

      return { status: decision, registrationReference, issuedPcid };
    });
  }

  private async issueFromRequest(
    runner: Parameters<Parameters<Database['transaction']>[0]>[0],
    requestId: string,
    payload: RegistrationInput,
    actor: AuthenticatedActor,
  ): Promise<string> {
    const pcid = await this.pcid.allocate(runner, {
      channel: payload.channel,
      allocatedBy: actor.subject.userId,
    });
    const displayName = [payload.givenName, payload.middleName, payload.familyName]
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
      .join(' ');
    await runner.query(
      `INSERT INTO citizen (
         pcid, status, given_name, middle_name, family_name, display_name, sex, date_of_birth,
         phone_primary, phone_secondary, email, residential_address, lga_code, ward_code,
         community_code, verification_level, classification, source_agency_id, registration_channel
       ) VALUES ($1,'ACTIVE',$2,$3,$4,$5,$6,$7::date,$8,$9,$10,$11,$12,$13,$14,
                 'SELF_ASSERTED','CONFIDENTIAL',$15,$16)`,
      [
        pcid,
        payload.givenName,
        payload.middleName ?? null,
        payload.familyName,
        displayName,
        payload.sex,
        payload.dateOfBirth,
        payload.phonePrimary ?? null,
        payload.phoneSecondary ?? null,
        payload.email ?? null,
        payload.residentialAddress ?? null,
        payload.lgaCode ?? null,
        payload.wardCode ?? null,
        payload.communityCode ?? null,
        actor.subject.agencyId,
        payload.channel,
      ],
    );
    await runner.query(
      `UPDATE registration_request SET status = 'ISSUED', issued_pcid = $2,
              decided_by_user_id = $3, decided_at = now()
        WHERE id = $1`,
      [requestId, pcid, actor.subject.userId],
    );
    return pcid;
  }

  private async queueForReview(
    runner: Parameters<Parameters<Database['transaction']>[0]>[0],
    requestId: string,
    candidates: readonly DuplicateCandidate[],
  ): Promise<void> {
    for (const candidate of candidates) {
      await runner.query(
        `INSERT INTO duplicate_candidate (registration_request_id, existing_citizen_id, score, matched_attributes)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [requestId, candidate.citizenId, candidate.score, JSON.stringify(candidate.factors)],
      );
    }
  }

  private async raiseIdentityIntegrityAlert(
    runner: Parameters<Parameters<Database['transaction']>[0]>[0],
    registrationReference: string,
    candidates: readonly DuplicateCandidate[],
  ): Promise<void> {
    const reference = await this.policy.nextReference('ALERT');
    const strongest = candidates[0];
    await runner.query(
      `INSERT INTO alert (
         reference, rule_key, category, severity, title, summary, explanation, confidence,
         engine_version, subject_type, subject_id, classification, status
       ) VALUES ($1,'DUPLICATE_IDENTITY_ATTRIBUTES','IDENTITY_INTEGRITY',$2,
                 'Identity Integrity Alert', $3, $4::jsonb, $5, 'duplicate-detection/1',
                 'REGISTRATION_REQUEST', $6, 'SENSITIVE', 'OPEN')`,
      [
        reference,
        strongest !== undefined && strongest.score >= DuplicateDetectionService.STRONG_THRESHOLD
          ? 'HIGH'
          : 'MEDIUM',
        'A registration request shares identifying attributes with an existing record. Review whether these are the same person.',
        JSON.stringify({
          reason: 'Identifying attributes agree with one or more existing registry records.',
          factorsConsidered: strongest?.factors ?? [],
          candidateCount: candidates.length,
          reviewThreshold: DuplicateDetectionService.REVIEW_THRESHOLD,
          note: 'This alert describes a record match, not a finding about any person.',
        }),
        strongest?.score ?? null,
        registrationReference,
      ],
    );
  }
}

/** Strip anything not needed to re-issue the registration if review clears it. */
function redactForStorage(input: RegistrationInput): Record<string, unknown> {
  const { nin: _nin, ...rest } = input;
  return { ...rest, ninSupplied: input.nin != null };
}
