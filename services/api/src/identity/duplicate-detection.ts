import { Injectable } from '@nestjs/common';

import type { QueryRunner } from '../database/pool';
import { Database } from '../database/pool';

export interface DuplicateFactor {
  readonly attribute: string;
  readonly weight: number;
  readonly detail: string;
}

export interface DuplicateCandidate {
  readonly citizenId: string;
  readonly pcid: string;
  readonly score: number;
  readonly factors: readonly DuplicateFactor[];
}

export interface DuplicateSearchInput {
  readonly givenName: string;
  readonly familyName: string;
  readonly dateOfBirth: string;
  readonly phonePrimary?: string | null;
  readonly email?: string | null;
  readonly lgaCode?: string | null;
  readonly wardCode?: string | null;
  readonly nin?: string | null;
}

/**
 * Duplicate detection before a PCID is issued (master system prompt §51).
 *
 * The score is a weighted sum of independently observable agreements, and every
 * contributing factor is returned with its weight so a reviewer sees exactly why
 * two records were brought together (§65, §67). Nothing here merges anything: a
 * candidate above the review threshold goes into a queue for a person to decide.
 *
 * Deliberately absent: any factor derived from ethnicity, religion, address
 * deprivation or any other protected or sensitive characteristic. Similarity is
 * computed only over the identifying attributes a registration actually supplies.
 */
@Injectable()
export class DuplicateDetectionService {
  /** At or above this score the registration goes to human review. */
  static readonly REVIEW_THRESHOLD = 60;
  /** At or above this score reviewers are told the agreement is strong. */
  static readonly STRONG_THRESHOLD = 85;

  constructor(private readonly db: Database) {}

  async findCandidates(
    input: DuplicateSearchInput,
    runner: QueryRunner = this.db,
  ): Promise<readonly DuplicateCandidate[]> {
    const rows = await runner.query<{
      id: string;
      pcid: string;
      given_name: string;
      family_name: string;
      date_of_birth: Date;
      phone_primary: string | null;
      email: string | null;
      lga_code: string | null;
      ward_code: string | null;
      nin: string | null;
      given_similarity: number;
      family_similarity: number;
    }>(
      `SELECT id, pcid, given_name, family_name, date_of_birth, phone_primary, email,
              lga_code, ward_code, nin,
              similarity(given_name, $1) AS given_similarity,
              similarity(family_name, $2) AS family_similarity
         FROM citizen
        WHERE status <> 'MERGED'
          AND (
            similarity(family_name, $2) > 0.3
            OR ($3::text IS NOT NULL AND phone_primary = $3)
            OR ($4::text IS NOT NULL AND nin = $4)
            OR ($5::text IS NOT NULL AND lower(email) = lower($5))
          )
        ORDER BY similarity(family_name, $2) DESC
        LIMIT 50`,
      [
        input.givenName,
        input.familyName,
        input.phonePrimary ?? null,
        input.nin ?? null,
        input.email ?? null,
      ],
    );

    const candidates: DuplicateCandidate[] = [];
    for (const row of rows) {
      const factors: DuplicateFactor[] = [];

      if (input.nin != null && row.nin !== null && row.nin === input.nin) {
        factors.push({
          attribute: 'nin',
          weight: 100,
          detail: 'The same national identifier is recorded on both records.',
        });
      }
      if (input.phonePrimary != null && row.phone_primary === input.phonePrimary) {
        factors.push({
          attribute: 'phonePrimary',
          weight: 40,
          detail: 'The same primary telephone number is recorded on both records.',
        });
      }
      if (
        input.email != null &&
        row.email !== null &&
        row.email.toLowerCase() === input.email.toLowerCase()
      ) {
        factors.push({
          attribute: 'email',
          weight: 25,
          detail: 'The same email address is recorded on both records.',
        });
      }

      const nameSimilarity =
        Number(row.family_similarity) * 0.6 + Number(row.given_similarity) * 0.4;
      if (nameSimilarity > 0.45) {
        factors.push({
          attribute: 'name',
          weight: Math.round(nameSimilarity * 35),
          detail: `Names agree closely (similarity ${nameSimilarity.toFixed(2)}).`,
        });
      }

      const existingDob = row.date_of_birth.toISOString().slice(0, 10);
      if (existingDob === input.dateOfBirth) {
        factors.push({
          attribute: 'dateOfBirth',
          weight: 20,
          detail: 'The recorded dates of birth are identical.',
        });
      } else if (withinYears(existingDob, input.dateOfBirth, 1)) {
        factors.push({
          attribute: 'dateOfBirth',
          weight: 8,
          detail: 'The recorded dates of birth are within a year of each other.',
        });
      }

      if (input.wardCode != null && row.ward_code === input.wardCode) {
        factors.push({
          attribute: 'ward',
          weight: 10,
          detail: 'Both records give the same ward of residence.',
        });
      } else if (input.lgaCode != null && row.lga_code === input.lgaCode) {
        factors.push({
          attribute: 'lga',
          weight: 5,
          detail: 'Both records give the same Local Government Area.',
        });
      }

      const score = Math.min(
        100,
        factors.reduce((total, factor) => total + factor.weight, 0),
      );
      if (score >= DuplicateDetectionService.REVIEW_THRESHOLD) {
        candidates.push({ citizenId: row.id, pcid: row.pcid, score, factors });
      }
    }

    return candidates.sort((a, b) => b.score - a.score);
  }
}

function withinYears(a: string, b: string, years: number): boolean {
  const left = Date.parse(a);
  const right = Date.parse(b);
  if (Number.isNaN(left) || Number.isNaN(right)) return false;
  return Math.abs(left - right) <= years * 365.25 * 24 * 60 * 60 * 1000;
}
