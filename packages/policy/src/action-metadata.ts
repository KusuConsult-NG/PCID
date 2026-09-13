import type { Action, Purpose, ResourceType } from '@pcid/contracts';

const EMERGENCY: readonly Purpose[] = [
  'EMERGENCY_RESPONSE',
  'EMERGENCY_IDENTIFICATION',
  'DISASTER_RESPONSE',
];
const INVESTIGATION: readonly Purpose[] = [
  'CRIMINAL_INVESTIGATION',
  'MISSING_PERSON_INVESTIGATION',
];
const SERVICE: readonly Purpose[] = [
  'IDENTITY_VERIFICATION',
  'SERVICE_DELIVERY',
  'REVENUE_ADMINISTRATION',
  'PUBLIC_HEALTH_RESPONSE',
];
const SELF: readonly Purpose[] = ['CITIZEN_SELF_SERVICE'];
const ADMIN: readonly Purpose[] = ['SYSTEM_ADMINISTRATION'];

/**
 * The closed set of purposes each action may be invoked for (master system
 * prompt §20, §22, §68). An action attempted under a purpose outside its set is
 * denied before any data is touched, and the attempt is audited.
 *
 * There is deliberately no wildcard. Adding an action without adding it here
 * makes it unusable, which is the safe failure direction.
 */
export const ACTION_PURPOSES: Readonly<Record<Action, readonly Purpose[]>> = Object.freeze({
  CITIZEN_SEARCH: [
    ...SELF,
    ...SERVICE,
    ...EMERGENCY,
    ...INVESTIGATION,
    'IDENTITY_INTEGRITY_REVIEW',
    'CORRECTION_REVIEW',
  ],
  CITIZEN_VIEW: [
    ...SELF,
    ...SERVICE,
    ...EMERGENCY,
    ...INVESTIGATION,
    'IDENTITY_INTEGRITY_REVIEW',
    'CORRECTION_REVIEW',
  ],
  CITIZEN_CREATE: ['SERVICE_DELIVERY', 'IDENTITY_VERIFICATION'],
  CITIZEN_UPDATE: ['CORRECTION_REVIEW', 'SERVICE_DELIVERY', 'CITIZEN_SELF_SERVICE'],
  CITIZEN_VERIFY: ['IDENTITY_VERIFICATION', 'SERVICE_DELIVERY', ...EMERGENCY],
  CITIZEN_EXPORT: ['STATISTICAL_ANALYSIS', 'AUDIT_REVIEW'],
  EMERGENCY_PROFILE_VIEW: EMERGENCY,
  RELATIONSHIP_VIEW: [...SELF, ...INVESTIGATION, ...EMERGENCY, 'SERVICE_DELIVERY'],
  CORRECTION_REQUEST_CREATE: [...SELF, 'CORRECTION_REVIEW', 'SERVICE_DELIVERY'],
  CORRECTION_REQUEST_REVIEW: ['CORRECTION_REVIEW'],
  DUPLICATE_REVIEW: ['IDENTITY_INTEGRITY_REVIEW'],

  VEHICLE_SEARCH: [...INVESTIGATION, ...EMERGENCY, 'REVENUE_ADMINISTRATION'],
  VEHICLE_VIEW: [
    ...SELF,
    ...INVESTIGATION,
    ...EMERGENCY,
    'REVENUE_ADMINISTRATION',
    'SERVICE_DELIVERY',
  ],
  PROPERTY_SEARCH: [...INVESTIGATION, ...EMERGENCY, 'REVENUE_ADMINISTRATION'],
  PROPERTY_VIEW: [
    ...SELF,
    ...INVESTIGATION,
    ...EMERGENCY,
    'REVENUE_ADMINISTRATION',
    'SERVICE_DELIVERY',
  ],
  BUSINESS_VIEW: [...SELF, ...INVESTIGATION, 'REVENUE_ADMINISTRATION', 'SERVICE_DELIVERY'],
  LICENCE_VIEW: [...SELF, ...INVESTIGATION, 'IDENTITY_VERIFICATION', 'SERVICE_DELIVERY'],
  REVENUE_VIEW: [...SELF, 'REVENUE_ADMINISTRATION', 'SERVICE_DELIVERY'],
  PROGRAMME_VIEW: [...SELF, 'SERVICE_DELIVERY', 'PUBLIC_HEALTH_RESPONSE'],

  INCIDENT_CREATE: [...EMERGENCY, ...SELF, 'CRIMINAL_INVESTIGATION'],
  INCIDENT_VIEW: [...EMERGENCY, ...INVESTIGATION, 'STATISTICAL_ANALYSIS'],
  INCIDENT_UPDATE: EMERGENCY,
  INCIDENT_CLOSE: EMERGENCY,
  DISPATCH_CREATE: EMERGENCY,
  DISPATCH_UPDATE: EMERGENCY,
  RESPONSE_UNIT_VIEW: [...EMERGENCY, 'STATISTICAL_ANALYSIS', ...ADMIN],
  RESPONSE_UNIT_MANAGE: ADMIN,

  CASE_CREATE: INVESTIGATION,
  CASE_VIEW: [...INVESTIGATION, 'AUDIT_REVIEW'],
  CASE_UPDATE: INVESTIGATION,
  CASE_ASSIGN: INVESTIGATION,
  CASE_CLOSE: INVESTIGATION,
  CASE_LINK_SUBJECT: INVESTIGATION,

  MISSING_PERSON_CREATE: ['MISSING_PERSON_INVESTIGATION', ...SELF],
  MISSING_PERSON_VIEW: [...INVESTIGATION, ...EMERGENCY],
  MISSING_PERSON_UPDATE: ['MISSING_PERSON_INVESTIGATION'],
  MISSING_PERSON_RESOLVE: ['MISSING_PERSON_INVESTIGATION'],
  UNIDENTIFIED_PERSON_CREATE: [...EMERGENCY, 'MISSING_PERSON_INVESTIGATION'],
  UNIDENTIFIED_PERSON_VIEW: [...EMERGENCY, ...INVESTIGATION],
  UNIDENTIFIED_PERSON_UPDATE: [...EMERGENCY, 'MISSING_PERSON_INVESTIGATION'],
  MATCH_RUN: ['MISSING_PERSON_INVESTIGATION'],
  MATCH_CONFIRM: ['MISSING_PERSON_INVESTIGATION'],

  ACCESS_REQUEST_CREATE: [
    ...SERVICE,
    ...EMERGENCY,
    ...INVESTIGATION,
    'IDENTITY_INTEGRITY_REVIEW',
    'CORRECTION_REVIEW',
  ],
  ACCESS_REQUEST_APPROVE: [
    ...SERVICE,
    ...EMERGENCY,
    ...INVESTIGATION,
    'IDENTITY_INTEGRITY_REVIEW',
    'CORRECTION_REVIEW',
  ],
  BREAK_GLASS_INITIATE: EMERGENCY,
  BREAK_GLASS_REVIEW: ['AUDIT_REVIEW'],

  AUDIT_VIEW: ['AUDIT_REVIEW', ...SELF],
  AUDIT_VERIFY: ['AUDIT_REVIEW'],
  ALERT_VIEW: ['IDENTITY_INTEGRITY_REVIEW', 'AUDIT_REVIEW', ...EMERGENCY, ...INVESTIGATION],
  ALERT_REVIEW: ['IDENTITY_INTEGRITY_REVIEW', 'AUDIT_REVIEW'],
  ANALYTICS_VIEW: ['STATISTICAL_ANALYSIS', ...EMERGENCY],

  ADMIN_AGENCY_MANAGE: ADMIN,
  ADMIN_USER_MANAGE: ADMIN,
  ADMIN_ROLE_MANAGE: ADMIN,
  ADMIN_POLICY_MANAGE: ADMIN,
  ADMIN_REFERENCE_DATA_MANAGE: ADMIN,
  ADMIN_INTEGRATION_MANAGE: ADMIN,
  ADMIN_NOTIFICATION_RULE_MANAGE: ADMIN,
  ADMIN_SYSTEM_MANAGE: ADMIN,
  IMPORT_RUN: ['SERVICE_DELIVERY', 'IDENTITY_VERIFICATION', ...ADMIN],
});

/**
 * Actions that read citizen or citizen-linked information. These require the
 * agency's data-sharing agreement to be in force before anything is released.
 */
export const CITIZEN_DATA_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  'CITIZEN_SEARCH',
  'CITIZEN_VIEW',
  'CITIZEN_UPDATE',
  'CITIZEN_VERIFY',
  'CITIZEN_EXPORT',
  'EMERGENCY_PROFILE_VIEW',
  'RELATIONSHIP_VIEW',
  'VEHICLE_SEARCH',
  'VEHICLE_VIEW',
  'PROPERTY_SEARCH',
  'PROPERTY_VIEW',
  'BUSINESS_VIEW',
  'LICENCE_VIEW',
  'REVENUE_VIEW',
  'PROGRAMME_VIEW',
  'MISSING_PERSON_VIEW',
  'UNIDENTIFIED_PERSON_VIEW',
]);

/**
 * Actions that address a case record itself.
 *
 * Reading a case is as case-bound as reading a citizen under one: belonging to
 * the owning agency is not the same as being assigned to the case, and §22 turns
 * on the assignment. The gate applies whenever a specific case is addressed; a
 * collection listing carries no case, and each service scopes those by
 * assignment in its own query.
 */
export const CASE_RECORD_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  'CASE_VIEW',
  'CASE_UPDATE',
  'CASE_ASSIGN',
  'CASE_CLOSE',
]);

/**
 * Reads that are exempt from case and incident binding.
 *
 * The missing-person and unidentified-person registers *are* the investigative
 * record for their own workflow: they carry their own reference, their own
 * assigned officers and their own status, and demanding a separate case number
 * before an officer can open one would put paperwork in front of a live search
 * for a person. They remain governed by role, purpose, agency standing,
 * jurisdiction, classification and the field catalogue like everything else.
 */
export const BINDING_EXEMPT_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  'MISSING_PERSON_VIEW',
  'UNIDENTIFIED_PERSON_VIEW',
]);

/**
 * Search actions. A search returns a deliberately thin projection so that an
 * officer cannot use repeated searching as a substitute for an authorised record
 * view (§62, §63).
 */
export const SEARCH_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  'CITIZEN_SEARCH',
  'VEHICLE_SEARCH',
  'PROPERTY_SEARCH',
]);

/**
 * Read actions whose resource must already be linked to the authorising case
 * (§22). Searching finds a candidate; linking them to the case is a separate,
 * audited act; only then does the full record open.
 */
export const CASE_LINKAGE_REQUIRED_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  'CITIZEN_VIEW',
  'VEHICLE_VIEW',
  'PROPERTY_VIEW',
  'BUSINESS_VIEW',
  'LICENCE_VIEW',
  'REVENUE_VIEW',
  'RELATIONSHIP_VIEW',
]);

/** Actions that mutate state. Used to decide cache TTL and audit weight. */
export const MUTATING_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  'CITIZEN_CREATE',
  'CITIZEN_UPDATE',
  'CORRECTION_REQUEST_CREATE',
  'CORRECTION_REQUEST_REVIEW',
  'DUPLICATE_REVIEW',
  'INCIDENT_CREATE',
  'INCIDENT_UPDATE',
  'INCIDENT_CLOSE',
  'DISPATCH_CREATE',
  'DISPATCH_UPDATE',
  'RESPONSE_UNIT_MANAGE',
  'CASE_CREATE',
  'CASE_UPDATE',
  'CASE_ASSIGN',
  'CASE_CLOSE',
  'CASE_LINK_SUBJECT',
  'MISSING_PERSON_CREATE',
  'MISSING_PERSON_UPDATE',
  'MISSING_PERSON_RESOLVE',
  'UNIDENTIFIED_PERSON_CREATE',
  'UNIDENTIFIED_PERSON_UPDATE',
  'MATCH_CONFIRM',
  'ACCESS_REQUEST_CREATE',
  'ACCESS_REQUEST_APPROVE',
  'BREAK_GLASS_INITIATE',
  'BREAK_GLASS_REVIEW',
  'ALERT_REVIEW',
  'ADMIN_AGENCY_MANAGE',
  'ADMIN_USER_MANAGE',
  'ADMIN_ROLE_MANAGE',
  'ADMIN_POLICY_MANAGE',
  'ADMIN_REFERENCE_DATA_MANAGE',
  'ADMIN_INTEGRATION_MANAGE',
  'ADMIN_NOTIFICATION_RULE_MANAGE',
  'ADMIN_SYSTEM_MANAGE',
  'IMPORT_RUN',
]);

/**
 * Administrative actions whose target is a user or role. Subject to the
 * separation-of-duty gate: nobody administers their own entitlements.
 */
export const SELF_ADMINISTRATION_SENSITIVE_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  'ADMIN_USER_MANAGE',
  'ADMIN_ROLE_MANAGE',
  'ADMIN_POLICY_MANAGE',
]);

/** Resource types that are aggregate or operational, carrying no direct citizen data. */
export const NON_CITIZEN_RESOURCE_TYPES: ReadonlySet<ResourceType> = new Set<ResourceType>([
  'ANALYTICS_AGGREGATE',
  'RESPONSE_UNIT',
  'AGENCY',
  'GOVERNMENT_USER',
  'IMPORT_JOB',
  'SYSTEM',
]);

export function purposesForAction(action: Action): readonly Purpose[] {
  return ACTION_PURPOSES[action] ?? [];
}

/**
 * The resource types each action may target.
 *
 * Without this, an action whose field catalogue happens to overlap another
 * resource's could be pointed at the wrong record type - for example a citizen
 * registry update aimed at a lands-registry property record. The platform links
 * records; it never becomes a write path into another agency's source of
 * truth (§28, §55), and this gate is where that is enforced.
 */
export const ACTION_RESOURCE_TYPES: Readonly<Record<Action, readonly ResourceType[]>> =
  Object.freeze({
    CITIZEN_SEARCH: ['CITIZEN'],
    CITIZEN_VIEW: ['CITIZEN'],
    CITIZEN_CREATE: ['CITIZEN'],
    CITIZEN_UPDATE: ['CITIZEN'],
    CITIZEN_VERIFY: ['CITIZEN'],
    CITIZEN_EXPORT: ['CITIZEN'],
    EMERGENCY_PROFILE_VIEW: ['CITIZEN'],
    RELATIONSHIP_VIEW: ['CITIZEN', 'RELATIONSHIP'],
    CORRECTION_REQUEST_CREATE: ['CORRECTION_REQUEST', 'CITIZEN'],
    CORRECTION_REQUEST_REVIEW: ['CORRECTION_REQUEST'],
    DUPLICATE_REVIEW: ['CITIZEN'],

    VEHICLE_SEARCH: ['VEHICLE'],
    VEHICLE_VIEW: ['VEHICLE'],
    PROPERTY_SEARCH: ['PROPERTY'],
    PROPERTY_VIEW: ['PROPERTY'],
    BUSINESS_VIEW: ['BUSINESS'],
    LICENCE_VIEW: ['LICENCE'],
    REVENUE_VIEW: ['REVENUE_PROFILE'],
    PROGRAMME_VIEW: ['GOVERNMENT_PROGRAMME'],

    INCIDENT_CREATE: ['INCIDENT'],
    INCIDENT_VIEW: ['INCIDENT'],
    INCIDENT_UPDATE: ['INCIDENT'],
    INCIDENT_CLOSE: ['INCIDENT'],
    DISPATCH_CREATE: ['DISPATCH', 'INCIDENT'],
    DISPATCH_UPDATE: ['DISPATCH'],
    RESPONSE_UNIT_VIEW: ['RESPONSE_UNIT'],
    RESPONSE_UNIT_MANAGE: ['RESPONSE_UNIT'],

    CASE_CREATE: ['CASE'],
    CASE_VIEW: ['CASE'],
    CASE_UPDATE: ['CASE'],
    CASE_ASSIGN: ['CASE'],
    CASE_CLOSE: ['CASE'],
    CASE_LINK_SUBJECT: ['CASE', 'CITIZEN', 'VEHICLE', 'PROPERTY'],

    MISSING_PERSON_CREATE: ['MISSING_PERSON'],
    MISSING_PERSON_VIEW: ['MISSING_PERSON'],
    MISSING_PERSON_UPDATE: ['MISSING_PERSON'],
    MISSING_PERSON_RESOLVE: ['MISSING_PERSON'],
    UNIDENTIFIED_PERSON_CREATE: ['UNIDENTIFIED_PERSON'],
    UNIDENTIFIED_PERSON_VIEW: ['UNIDENTIFIED_PERSON'],
    UNIDENTIFIED_PERSON_UPDATE: ['UNIDENTIFIED_PERSON'],
    MATCH_RUN: ['MISSING_PERSON', 'UNIDENTIFIED_PERSON'],
    MATCH_CONFIRM: ['MISSING_PERSON', 'UNIDENTIFIED_PERSON'],

    ACCESS_REQUEST_CREATE: ['ACCESS_REQUEST'],
    ACCESS_REQUEST_APPROVE: ['ACCESS_REQUEST'],
    BREAK_GLASS_INITIATE: [
      'CITIZEN',
      'VEHICLE',
      'PROPERTY',
      'MISSING_PERSON',
      'UNIDENTIFIED_PERSON',
    ],
    BREAK_GLASS_REVIEW: ['ACCESS_REQUEST', 'AUDIT_EVENT'],

    AUDIT_VIEW: ['AUDIT_EVENT'],
    AUDIT_VERIFY: ['AUDIT_EVENT'],
    ALERT_VIEW: ['ALERT'],
    ALERT_REVIEW: ['ALERT'],
    ANALYTICS_VIEW: ['ANALYTICS_AGGREGATE'],

    ADMIN_AGENCY_MANAGE: ['AGENCY'],
    ADMIN_USER_MANAGE: ['GOVERNMENT_USER'],
    ADMIN_ROLE_MANAGE: ['GOVERNMENT_USER', 'SYSTEM'],
    ADMIN_POLICY_MANAGE: ['SYSTEM'],
    ADMIN_REFERENCE_DATA_MANAGE: ['SYSTEM'],
    ADMIN_INTEGRATION_MANAGE: ['SYSTEM'],
    ADMIN_NOTIFICATION_RULE_MANAGE: ['SYSTEM'],
    ADMIN_SYSTEM_MANAGE: ['SYSTEM'],
    IMPORT_RUN: ['IMPORT_JOB'],
  });

export function resourceTypesForAction(action: Action): readonly ResourceType[] {
  return ACTION_RESOURCE_TYPES[action] ?? [];
}
