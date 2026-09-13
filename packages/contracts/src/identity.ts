/** Citizen registry vocabulary (master system prompt §48, §50, §51, §52). */

export const CITIZEN_STATUSES = [
  'PENDING_VERIFICATION',
  'ACTIVE',
  'SUSPENDED',
  'DECEASED',
  'MERGED',
] as const;
export type CitizenStatus = (typeof CITIZEN_STATUSES)[number];

/**
 * Assurance level of the identity record. A PCID is issued at SELF_ASSERTED and
 * is upgraded as evidence is presented; a low level never blocks emergency
 * identification, it only limits which services will rely on the record.
 */
export const VERIFICATION_LEVELS = [
  'SELF_ASSERTED',
  'DOCUMENT_VERIFIED',
  'AGENCY_VERIFIED',
  'BIOMETRIC_VERIFIED',
] as const;
export type VerificationLevel = (typeof VERIFICATION_LEVELS)[number];

export const SEXES = ['FEMALE', 'MALE', 'UNSPECIFIED'] as const;
export type Sex = (typeof SEXES)[number];

export const REGISTRATION_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'DUPLICATE_REVIEW',
  'APPROVED',
  'REJECTED',
  'ISSUED',
] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

export const REGISTRATION_CHANNELS = [
  'CITIZEN_PORTAL',
  'REGISTRATION_DESK',
  'FIELD_ENROLMENT',
  'AGENCY_IMPORT',
  'MDA_API',
] as const;
export type RegistrationChannel = (typeof REGISTRATION_CHANNELS)[number];

export const DUPLICATE_CANDIDATE_STATUSES = [
  'PENDING_REVIEW',
  'CONFIRMED_DUPLICATE',
  'DISTINCT_PERSON',
  'MERGED',
] as const;
export type DuplicateCandidateStatus = (typeof DUPLICATE_CANDIDATE_STATUSES)[number];

export const CORRECTION_REQUEST_STATUSES = [
  'SUBMITTED',
  'EVIDENCE_REQUIRED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'APPLIED',
] as const;
export type CorrectionRequestStatus = (typeof CORRECTION_REQUEST_STATUSES)[number];

export const EMERGENCY_CONTACT_VERIFICATION_STATUSES = [
  'UNVERIFIED',
  'PENDING',
  'VERIFIED',
  'FAILED',
] as const;
export type EmergencyContactVerificationStatus =
  (typeof EMERGENCY_CONTACT_VERIFICATION_STATUSES)[number];
