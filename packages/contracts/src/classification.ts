/**
 * Data classification (master system prompt §27).
 *
 * Classification has two independent dimensions:
 *
 *  1. `rank` - an ordered sensitivity level. A subject may only read a field whose
 *     rank is at or below the subject's clearance AND at or below the maximum
 *     classification their agency is approved to receive.
 *
 *  2. `compartment` - an additional need-to-know marking that rank alone does not
 *     satisfy. `LAW_ENFORCEMENT_RESTRICTED` is a compartment: a Revenue officer with
 *     a HIGHLY_RESTRICTED clearance still cannot read law-enforcement material,
 *     because their agency category is not authorised for that compartment.
 *
 * Both dimensions are enforced; neither can be substituted for the other.
 */
export const CLASSIFICATIONS = [
  'PUBLIC',
  'INTERNAL',
  'CONFIDENTIAL',
  'SENSITIVE',
  'HIGHLY_RESTRICTED',
  'LAW_ENFORCEMENT_RESTRICTED',
] as const;

export type Classification = (typeof CLASSIFICATIONS)[number];

const RANKS: Readonly<Record<Classification, number>> = Object.freeze({
  PUBLIC: 0,
  INTERNAL: 1,
  CONFIDENTIAL: 2,
  SENSITIVE: 3,
  HIGHLY_RESTRICTED: 4,
  LAW_ENFORCEMENT_RESTRICTED: 5,
});

export function classificationRank(value: Classification): number {
  return RANKS[value];
}

/** True when `clearance` dominates `required` on the ordered rank dimension. */
export function rankDominates(clearance: Classification, required: Classification): boolean {
  return RANKS[clearance] >= RANKS[required];
}

/** The most restrictive of a set of classifications. */
export function highestClassification(values: readonly Classification[]): Classification {
  let highest: Classification = 'PUBLIC';
  for (const value of values) {
    if (RANKS[value] > RANKS[highest]) highest = value;
  }
  return highest;
}

/** The least restrictive of a set of classifications. */
export function lowestClassification(values: readonly Classification[]): Classification {
  if (values.length === 0) return 'PUBLIC';
  let lowest: Classification = 'LAW_ENFORCEMENT_RESTRICTED';
  for (const value of values) {
    if (RANKS[value] < RANKS[lowest]) lowest = value;
  }
  return lowest;
}

/** Classifications that are compartments rather than plain sensitivity levels. */
export const COMPARTMENTED_CLASSIFICATIONS: readonly Classification[] = Object.freeze([
  'LAW_ENFORCEMENT_RESTRICTED',
]);

export function isCompartmented(value: Classification): boolean {
  return COMPARTMENTED_CLASSIFICATIONS.includes(value);
}

export function isClassification(value: unknown): value is Classification {
  return typeof value === 'string' && (CLASSIFICATIONS as readonly string[]).includes(value);
}
