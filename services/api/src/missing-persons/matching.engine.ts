import { Injectable } from '@nestjs/common';

import { Database } from '../database/pool';

export interface MatchFactor {
  readonly attribute: string;
  readonly weight: number;
  readonly observed: string;
  readonly detail: string;
}

export interface MatchCandidate {
  readonly unidentifiedPersonId: string | null;
  readonly candidateCitizenPcid: string | null;
  readonly reference: string;
  readonly score: number;
  readonly factors: readonly MatchFactor[];
}

export interface MissingPersonProfile {
  readonly id: string;
  readonly caseReference: string;
  readonly fullName: string;
  readonly ageYears: number | null;
  readonly sex: string | null;
  readonly lastSeenLgaCode: string | null;
  readonly lastSeenWardCode: string | null;
  readonly lastSeenAt: Date | null;
  readonly distinguishingFeatures: string | null;
  readonly citizenPcid: string | null;
}

/**
 * Missing-person matching (master system prompt §13, §66, §67).
 *
 * The engine compares an open missing-person record against unidentified-person
 * records and returns *candidates*, with every contributing factor and its weight
 * attached. Three properties are deliberate:
 *
 *  - it writes nothing but CANDIDATE rows. Confirming an identification is a
 *    human act recorded against a named officer, enforced by a database check
 *    constraint as well as by this code;
 *  - it uses only observable physical and circumstantial attributes - age band,
 *    apparent sex, where and when, and described features. Nothing derived from
 *    ethnicity, religion, address deprivation or any similar characteristic
 *    contributes, and there is no place in the model for one;
 *  - every factor carries a plain-language explanation, so the "why am I seeing
 *    this?" question is answerable directly from the stored record.
 */
@Injectable()
export class MatchingEngine {
  static readonly VERSION = 'missing-person-matching/1.0';
  /** Below this, a pairing is not worth an officer's attention. */
  static readonly CANDIDATE_THRESHOLD = 45;

  constructor(private readonly db: Database) {}

  async findCandidates(profile: MissingPersonProfile): Promise<readonly MatchCandidate[]> {
    const rows = await this.db.query<{
      id: string;
      reference: string;
      estimated_age_min: number | null;
      estimated_age_max: number | null;
      apparent_sex: string | null;
      found_lga_code: string | null;
      found_ward_code: string | null;
      found_at: Date;
      distinguishing_features: string | null;
      feature_similarity: number | null;
    }>(
      `SELECT id, reference, estimated_age_min, estimated_age_max, apparent_sex,
              found_lga_code, found_ward_code, found_at, distinguishing_features,
              CASE WHEN $1::text IS NULL OR distinguishing_features IS NULL THEN NULL
                   ELSE similarity(distinguishing_features, $1) END AS feature_similarity
         FROM unidentified_person
        WHERE status IN ('UNIDENTIFIED','UNDER_REVIEW')
          AND ($2::timestamptz IS NULL OR found_at >= $2::timestamptz - interval '30 days')
        ORDER BY found_at DESC
        LIMIT 200`,
      [profile.distinguishingFeatures, profile.lastSeenAt],
    );

    const candidates: MatchCandidate[] = [];
    for (const row of rows) {
      const factors: MatchFactor[] = [];

      if (profile.sex !== null && row.apparent_sex !== null) {
        if (profile.sex === row.apparent_sex) {
          factors.push({
            attribute: 'sex',
            weight: 15,
            observed: row.apparent_sex,
            detail: 'The apparent sex recorded on the unidentified person matches the report.',
          });
        } else if (profile.sex !== 'UNSPECIFIED' && row.apparent_sex !== 'UNSPECIFIED') {
          // A clear disagreement counts against the pairing rather than being ignored.
          factors.push({
            attribute: 'sex',
            weight: -25,
            observed: row.apparent_sex,
            detail: 'The apparent sex recorded does not match the report.',
          });
        }
      }

      if (
        profile.ageYears !== null &&
        row.estimated_age_min !== null &&
        row.estimated_age_max !== null
      ) {
        if (
          profile.ageYears >= row.estimated_age_min &&
          profile.ageYears <= row.estimated_age_max
        ) {
          factors.push({
            attribute: 'age',
            weight: 25,
            observed: `${row.estimated_age_min}-${row.estimated_age_max}`,
            detail: 'The reported age falls inside the estimated age range.',
          });
        } else {
          const distance = Math.min(
            Math.abs(profile.ageYears - row.estimated_age_min),
            Math.abs(profile.ageYears - row.estimated_age_max),
          );
          if (distance <= 5) {
            factors.push({
              attribute: 'age',
              weight: 10,
              observed: `${row.estimated_age_min}-${row.estimated_age_max}`,
              detail: `The reported age is within ${distance} years of the estimated range.`,
            });
          } else {
            factors.push({
              attribute: 'age',
              weight: -20,
              observed: `${row.estimated_age_min}-${row.estimated_age_max}`,
              detail: 'The reported age is well outside the estimated range.',
            });
          }
        }
      }

      if (profile.lastSeenWardCode !== null && row.found_ward_code === profile.lastSeenWardCode) {
        factors.push({
          attribute: 'location',
          weight: 25,
          observed: row.found_ward_code,
          detail: 'Found in the same ward as the last known sighting.',
        });
      } else if (
        profile.lastSeenLgaCode !== null &&
        row.found_lga_code === profile.lastSeenLgaCode
      ) {
        factors.push({
          attribute: 'location',
          weight: 15,
          observed: row.found_lga_code ?? '',
          detail: 'Found in the same Local Government Area as the last known sighting.',
        });
      }

      if (profile.lastSeenAt !== null) {
        const days = Math.abs(row.found_at.getTime() - profile.lastSeenAt.getTime()) / 86_400_000;
        if (days <= 2) {
          factors.push({
            attribute: 'timing',
            weight: 20,
            observed: `${days.toFixed(1)} days`,
            detail: 'Found within two days of the person last being seen.',
          });
        } else if (days <= 14) {
          factors.push({
            attribute: 'timing',
            weight: 10,
            observed: `${days.toFixed(1)} days`,
            detail: 'Found within two weeks of the person last being seen.',
          });
        }
      }

      const featureSimilarity =
        row.feature_similarity === null ? 0 : Number(row.feature_similarity);
      if (featureSimilarity > 0.35) {
        factors.push({
          attribute: 'distinguishingFeatures',
          weight: Math.round(featureSimilarity * 30),
          observed: row.distinguishing_features ?? '',
          detail: `Described distinguishing features agree (similarity ${featureSimilarity.toFixed(2)}).`,
        });
      }

      const score = clamp(factors.reduce((total, factor) => total + factor.weight, 0));
      if (score >= MatchingEngine.CANDIDATE_THRESHOLD) {
        candidates.push({
          unidentifiedPersonId: row.id,
          candidateCitizenPcid: null,
          reference: row.reference,
          score,
          factors,
        });
      }
    }

    return candidates.sort((a, b) => b.score - a.score).slice(0, 20);
  }
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
