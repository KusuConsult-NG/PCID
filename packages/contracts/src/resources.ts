/** Resource types the policy engine can be asked about. */
export const RESOURCE_TYPES = [
  'CITIZEN',
  'EMERGENCY_PROFILE',
  'VEHICLE',
  'PROPERTY',
  'BUSINESS',
  'LICENCE',
  'REVENUE_PROFILE',
  'GOVERNMENT_PROGRAMME',
  'INCIDENT',
  'DISPATCH',
  'RESPONSE_UNIT',
  'CASE',
  'MISSING_PERSON',
  'UNIDENTIFIED_PERSON',
  'ACCESS_REQUEST',
  'ALERT',
  'AUDIT_EVENT',
  'ANALYTICS_AGGREGATE',
  'AGENCY',
  'GOVERNMENT_USER',
  'CORRECTION_REQUEST',
  'IMPORT_JOB',
  'RELATIONSHIP',
  'SYSTEM',
] as const;

export type ResourceType = (typeof RESOURCE_TYPES)[number];

export function isResourceType(value: unknown): value is ResourceType {
  return typeof value === 'string' && (RESOURCE_TYPES as readonly string[]).includes(value);
}
