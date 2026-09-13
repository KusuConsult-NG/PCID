/** Audit vocabulary (master system prompt §25, §26). */

export const AUDIT_OUTCOMES = ['PERMITTED', 'DENIED', 'ERROR'] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

/**
 * Whether the citizen may see this access in their own access history (§26).
 * Restricting disclosure is possible but never silent: a restricted event must
 * carry a legal basis and the identity of the authority that restricted it.
 */
export const AUDIT_CITIZEN_VISIBILITIES = [
  'ACCESS_VISIBLE_TO_CITIZEN',
  'ACCESS_RESTRICTED_FROM_CITIZEN',
] as const;
export type AuditCitizenVisibility = (typeof AUDIT_CITIZEN_VISIBILITIES)[number];

export const AUDIT_ACTOR_TYPES = [
  'GOVERNMENT_USER',
  'CITIZEN',
  'API_CLIENT',
  'SYSTEM',
  'INTEGRATION',
] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

/** Hash algorithm used for the tamper-evident audit chain. */
export const AUDIT_CHAIN_ALGORITHM = 'sha256';
/** Chain genesis value for the first event in a partition. */
export const AUDIT_CHAIN_GENESIS = '0'.repeat(64);
