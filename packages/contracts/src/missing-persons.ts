/** Missing and unidentified person vocabulary (master system prompt §11, §12, §13). */

export const MISSING_PERSON_STATUSES = [
  'REPORTED',
  'VERIFIED',
  'ACTIVE',
  'LOCATED',
  'REUNITED',
  'CLOSED',
  'CANCELLED',
] as const;
export type MissingPersonStatus = (typeof MISSING_PERSON_STATUSES)[number];

export const OPEN_MISSING_PERSON_STATUSES: readonly MissingPersonStatus[] = Object.freeze([
  'REPORTED',
  'VERIFIED',
  'ACTIVE',
]);

export const UNIDENTIFIED_PERSON_STATUSES = [
  'UNIDENTIFIED',
  'UNDER_REVIEW',
  'PROVISIONALLY_IDENTIFIED',
  'IDENTIFIED',
  'CLOSED',
] as const;
export type UnidentifiedPersonStatus = (typeof UNIDENTIFIED_PERSON_STATUSES)[number];

export const UNIDENTIFIED_PERSON_CONDITIONS = [
  'CONSCIOUS',
  'UNCONSCIOUS',
  'INJURED',
  'DECEASED',
  'UNKNOWN',
] as const;
export type UnidentifiedPersonCondition = (typeof UNIDENTIFIED_PERSON_CONDITIONS)[number];

export const MATCH_STATUSES = [
  'CANDIDATE',
  'UNDER_REVIEW',
  'CONFIRMED',
  'REJECTED',
  'SUPERSEDED',
] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

/**
 * A candidate match is never an identification (master system prompt §13, §66).
 * The matching engine may only ever produce CANDIDATE records; moving a candidate
 * to CONFIRMED requires an authorised human decision recorded against a named user.
 */
export const AUTOMATED_MATCH_TERMINAL_STATUS: MatchStatus = 'CANDIDATE';
