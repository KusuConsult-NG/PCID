/**
 * Purpose of processing (master system prompt §20, §22, §68).
 *
 * Every access to citizen information must declare a lawful purpose. The purpose
 * is checked against the subject's role grants and against the field catalogue,
 * and it is written to the immutable audit record. There is no "general browsing"
 * purpose, by design.
 */
export const PURPOSES = [
  'CITIZEN_SELF_SERVICE',
  'IDENTITY_VERIFICATION',
  'SERVICE_DELIVERY',
  'REVENUE_ADMINISTRATION',
  'EMERGENCY_RESPONSE',
  'EMERGENCY_IDENTIFICATION',
  'DISASTER_RESPONSE',
  'PUBLIC_HEALTH_RESPONSE',
  'MISSING_PERSON_INVESTIGATION',
  'CRIMINAL_INVESTIGATION',
  'IDENTITY_INTEGRITY_REVIEW',
  'CORRECTION_REVIEW',
  'AUDIT_REVIEW',
  'STATISTICAL_ANALYSIS',
  'SYSTEM_ADMINISTRATION',
] as const;
export type Purpose = (typeof PURPOSES)[number];

/** Purposes that bind an access to an investigative case (§22). */
export const CASE_BOUND_PURPOSES: readonly Purpose[] = Object.freeze([
  'CRIMINAL_INVESTIGATION',
  'MISSING_PERSON_INVESTIGATION',
]);

/** Purposes that bind an access to an active incident (§9, §10). */
export const INCIDENT_BOUND_PURPOSES: readonly Purpose[] = Object.freeze([
  'EMERGENCY_RESPONSE',
  'EMERGENCY_IDENTIFICATION',
  'DISASTER_RESPONSE',
]);

export function isPurpose(value: unknown): value is Purpose {
  return typeof value === 'string' && (PURPOSES as readonly string[]).includes(value);
}
