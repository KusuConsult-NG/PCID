/** Case management vocabulary (master system prompt §21, §22). */

export const CASE_TYPES = [
  'CRIMINAL_INVESTIGATION',
  'MISSING_PERSON',
  'FRAUD',
  'IDENTITY_FRAUD',
  'PUBLIC_SAFETY',
  'EMERGENCY',
  'DISASTER',
  'OTHER',
] as const;
export type CaseType = (typeof CASE_TYPES)[number];

export const CASE_STATUSES = [
  'DRAFT',
  'OPEN',
  'ACTIVE',
  'SUSPENDED',
  'PENDING_REVIEW',
  'CLOSED',
  'ARCHIVED',
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

/** Statuses during which case-bound data access is permitted. */
export const ACTIVE_CASE_STATUSES: readonly CaseStatus[] = Object.freeze([
  'OPEN',
  'ACTIVE',
  'PENDING_REVIEW',
]);

export const CASE_SUBJECT_ROLES = [
  'SUBJECT_OF_INTEREST',
  'COMPLAINANT',
  'WITNESS',
  'VICTIM',
  'REPORTING_PERSON',
  'NEXT_OF_KIN',
  'MISSING_PERSON',
] as const;
export type CaseSubjectRole = (typeof CASE_SUBJECT_ROLES)[number];
