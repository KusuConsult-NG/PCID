/** Access-request, approval and break-glass vocabulary (master system prompt §23, §24). */

export const ACCESS_REQUEST_STATUSES = [
  'SUBMITTED',
  'AUTO_DENIED',
  'PENDING_APPROVAL',
  'APPROVED',
  'DENIED',
  'EXPIRED',
  'REVOKED',
] as const;
export type AccessRequestStatus = (typeof ACCESS_REQUEST_STATUSES)[number];

export const BREAK_GLASS_STATUSES = [
  'ACTIVE',
  'EXPIRED',
  'REVOKED',
  'REVIEWED_JUSTIFIED',
  'REVIEWED_UNJUSTIFIED',
] as const;
export type BreakGlassStatus = (typeof BREAK_GLASS_STATUSES)[number];

/**
 * A break-glass grant is temporary, minimal and reviewable (§23). These are the
 * ceiling values the platform enforces; an administrator may configure shorter
 * windows but never longer ones.
 */
export const BREAK_GLASS_MAX_TTL_SECONDS = 60 * 60; // one hour
export const BREAK_GLASS_DEFAULT_TTL_SECONDS = 15 * 60;
export const ACCESS_APPROVAL_MAX_TTL_SECONDS = 60 * 60 * 24 * 7; // seven days
export const ACCESS_APPROVAL_DEFAULT_TTL_SECONDS = 60 * 60 * 24;

/**
 * Gates a break-glass grant may satisfy. Break glass relaxes *binding* gates -
 * it can stand in for a case assignment or an approval that there was no time to
 * obtain. It can never relax agency standing, authentication, role, or the
 * law-enforcement compartment (§23).
 */
export const BREAK_GLASS_SATISFIABLE_GATES = [
  'JURISDICTION',
  'CASE_BINDING',
  'INCIDENT_BINDING',
  'FIELD_APPROVAL',
] as const;
export type BreakGlassSatisfiableGate = (typeof BREAK_GLASS_SATISFIABLE_GATES)[number];
