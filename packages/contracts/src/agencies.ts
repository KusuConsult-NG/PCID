/**
 * Government Agency Registry vocabulary (master system prompt §5, §6).
 *
 * Agency *names* are never referenced by authorisation logic. Every decision is
 * driven by the agency's category, its approved data-access level, its
 * jurisdiction and the status of its data-sharing agreement - all of which are
 * configuration held in the agency registry, not code.
 */
export const AGENCY_CATEGORIES = [
  'MDA',
  'SECURITY',
  'EMERGENCY',
  'HEALTH',
  'JUSTICE',
  'REVENUE',
  'TRANSPORT',
  'LANDS',
  'EDUCATION',
  'SOCIAL_SERVICES',
  'LOCAL_GOVERNMENT',
  'OTHER',
] as const;
export type AgencyCategory = (typeof AGENCY_CATEGORIES)[number];

export const AGENCY_STATUSES = ['ACTIVE', 'SUSPENDED', 'INACTIVE'] as const;
export type AgencyStatus = (typeof AGENCY_STATUSES)[number];

/**
 * Status of the formal data-sharing agreement between the state and the agency.
 * Without a SIGNED agreement an agency cannot read citizen information at all -
 * a legal control expressed as a hard gate in the policy engine.
 */
export const DATA_SHARING_AGREEMENT_STATUSES = [
  'SIGNED',
  'PENDING',
  'EXPIRED',
  'SUSPENDED',
  'NONE',
] as const;
export type DataSharingAgreementStatus = (typeof DATA_SHARING_AGREEMENT_STATUSES)[number];

export const API_INTEGRATION_STATUSES = [
  'NOT_INTEGRATED',
  'SANDBOX',
  'CERTIFYING',
  'LIVE',
  'SUSPENDED',
] as const;
export type ApiIntegrationStatus = (typeof API_INTEGRATION_STATUSES)[number];

/**
 * Agency categories authorised to hold the LAW_ENFORCEMENT_RESTRICTED compartment.
 * Seeded as configuration in `agency_compartment_grant`; this constant is the
 * bootstrap default, not a hardcoded authorisation rule.
 */
export const DEFAULT_LAW_ENFORCEMENT_COMPARTMENT_CATEGORIES: readonly AgencyCategory[] =
  Object.freeze(['SECURITY', 'JUSTICE']);
