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
 * The weight each independently observable agreement contributes (§51, §65).
 *
 * Named rather than written into the scoring loop because the candidate query
 * depends on the arithmetic: it pairs the name net with the date of birth, and
 * that is only sound while no combination of name, locality and an approximate
 * date of birth can reach the review threshold. The test
 * `the name net cannot lose a record that could have been queued` asserts it.
 */
export const DUPLICATE_WEIGHTS = {
  nin: 100,
  phonePrimary: 40,
  email: 25,
  /** Names agreeing exactly. The factor is scaled by how closely they agree. */
  nameMaximum: 35,
  dateOfBirthExact: 20,
  dateOfBirthWithinAYear: 8,
  ward: 10,
  lga: 5,
} as const;

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
      // Four separate nets, unioned, each of which an index can serve.
      //
      // The previous single predicate called `similarity(family_name, $2) > 0.3`,
      // and a function call is not an index condition: every registration read
      // the whole register. Measured at four million records that was a 5.7
      // second sequential scan on the one path that must never be skipped.
      //
      // It was also, by then, the wrong net. A surname net over a statewide
      // register returns a couple of hundred thousand people; the query took an
      // arbitrary fifty of them by surname similarity, so a real duplicate -
      // same surname, same first name, same date of birth - was very likely not
      // among the fifty that came back. The control had quietly stopped working
      // before it became slow.
      //
      // The name net is now paired with the date of birth, and that loses
      // nothing: read `scoreOf` below. Without an exact date-of-birth agreement
      // the most a record can score on names and locality together is 45, and
      // the review threshold is 60. A record the old net would have found and
      // this one does not is a record that could never have been queued.
      // `nameNetRequiresDateOfBirth` in the tests holds that arithmetic.
      `WITH candidate AS (
         SELECT id FROM citizen
          WHERE status <> 'MERGED' AND date_of_birth = $6::date AND family_name % $2
         UNION
         SELECT id FROM citizen
          WHERE $3::text IS NOT NULL AND status <> 'MERGED' AND phone_primary = $3
         UNION
         SELECT id FROM citizen
          WHERE $4::text IS NOT NULL AND status <> 'MERGED' AND nin = $4
         UNION
         SELECT id FROM citizen
          WHERE $5::text IS NOT NULL AND status <> 'MERGED' AND lower(email) = lower($5)
       )
       SELECT c.id, c.pcid, c.given_name, c.family_name, c.date_of_birth, c.phone_primary,
              c.email, c.lga_code, c.ward_code, c.nin,
              similarity(c.given_name, $1) AS given_similarity,
              similarity(c.family_name, $2) AS family_similarity
         FROM citizen c
         JOIN candidate ON candidate.id = c.id
        ORDER BY similarity(c.family_name, $2) DESC
        LIMIT 50`,
      [
        input.givenName,
        input.familyName,
        input.phonePrimary ?? null,
        input.nin ?? null,
        input.email ?? null,
        input.dateOfBirth,
      ],
    );

    const candidates: DuplicateCandidate[] = [];
    for (const row of rows) {
      const factors: DuplicateFactor[] = [];

      if (input.nin != null && row.nin !== null && row.nin === input.nin) {
        factors.push({
          attribute: 'nin',
          weight: DUPLICATE_WEIGHTS.nin,
          detail: 'The same national identifier is recorded on both records.',
        });
      }
      if (input.phonePrimary != null && row.phone_primary === input.phonePrimary) {
        factors.push({
          attribute: 'phonePrimary',
          weight: DUPLICATE_WEIGHTS.phonePrimary,
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
          weight: DUPLICATE_WEIGHTS.email,
          detail: 'The same email address is recorded on both records.',
        });
      }

      const nameSimilarity =
        Number(row.family_similarity) * 0.6 + Number(row.given_similarity) * 0.4;
      if (nameSimilarity > 0.45) {
        factors.push({
          attribute: 'name',
          weight: Math.round(nameSimilarity * DUPLICATE_WEIGHTS.nameMaximum),
          detail: `Names agree closely (similarity ${nameSimilarity.toFixed(2)}).`,
        });
      }

      const existingDob = row.date_of_birth.toISOString().slice(0, 10);
      if (existingDob === input.dateOfBirth) {
        factors.push({
          attribute: 'dateOfBirth',
          weight: DUPLICATE_WEIGHTS.dateOfBirthExact,
          detail: 'The recorded dates of birth are identical.',
        });
      } else if (withinYears(existingDob, input.dateOfBirth, 1)) {
        factors.push({
          attribute: 'dateOfBirth',
          weight: DUPLICATE_WEIGHTS.dateOfBirthWithinAYear,
          detail: 'The recorded dates of birth are within a year of each other.',
        });
      }

      if (input.wardCode != null && row.ward_code === input.wardCode) {
        factors.push({
          attribute: 'ward',
          weight: DUPLICATE_WEIGHTS.ward,
          detail: 'Both records give the same ward of residence.',
        });
      } else if (input.lgaCode != null && row.lga_code === input.lgaCode) {
        factors.push({
          attribute: 'lga',
          weight: DUPLICATE_WEIGHTS.lga,
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
