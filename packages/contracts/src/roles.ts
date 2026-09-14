import type { Action } from './actions';

/**
 * Seeded role definitions (master system prompt §7).
 *
 * Roles are *configuration*: they live in the `role` and `role_action` tables and
 * authorised administrators can create new ones. This module is the bootstrap
 * seed and the reference used by the authorisation test suite - the running
 * system reads roles from the database, never from this constant.
 */
export const SEEDED_ROLES = [
  'PLATFORM_ADMINISTRATOR',
  'SECURITY_ADMINISTRATOR',
  'AGENCY_ADMINISTRATOR',
  'SUPERVISOR',
  'INVESTIGATOR',
  'INCIDENT_OFFICER',
  'DISPATCHER',
  'EMERGENCY_RESPONDER',
  'MISSING_PERSON_OFFICER',
  'ANALYST',
  'AUDITOR',
  'DATA_PROTECTION_OFFICER',
  'REGISTRATION_OFFICER',
  'VERIFICATION_OFFICER',
  'MDA_OFFICER',
  'REVENUE_OFFICER',
  'CITIZEN',
] as const;

export type SeededRole = (typeof SEEDED_ROLES)[number];

export interface RoleDefinition {
  readonly name: SeededRole;
  readonly description: string;
  /** Actions this role grants. */
  readonly actions: readonly Action[];
  /**
   * When true, holders of this role are *technical* administrators. Holding it
   * confers no entitlement to citizen data (§7): the policy engine never widens a
   * data decision because the subject is an administrator.
   */
  readonly technicalOnly?: boolean;
}

export const ROLE_DEFINITIONS: readonly RoleDefinition[] = Object.freeze([
  {
    name: 'PLATFORM_ADMINISTRATOR',
    description:
      'Technical administration of the platform. Explicitly carries no entitlement to citizen data.',
    technicalOnly: true,
    actions: [
      'ADMIN_AGENCY_MANAGE',
      'ADMIN_USER_MANAGE',
      'ADMIN_ROLE_MANAGE',
      'ADMIN_POLICY_MANAGE',
      'ADMIN_REFERENCE_DATA_MANAGE',
      'ADMIN_INTEGRATION_MANAGE',
      'ADMIN_NOTIFICATION_RULE_MANAGE',
      'ADMIN_SYSTEM_MANAGE',
      'RESPONSE_UNIT_MANAGE',
      'RESPONSE_UNIT_VIEW',
    ],
  },
  {
    name: 'SECURITY_ADMINISTRATOR',
    description: 'Manages users and roles within one approved security agency.',
    technicalOnly: true,
    actions: ['ADMIN_USER_MANAGE', 'RESPONSE_UNIT_MANAGE', 'RESPONSE_UNIT_VIEW', 'ALERT_VIEW'],
  },
  {
    name: 'AGENCY_ADMINISTRATOR',
    description: 'Manages users within one MDA.',
    technicalOnly: true,
    actions: ['ADMIN_USER_MANAGE'],
  },
  {
    name: 'SUPERVISOR',
    description: 'Approves sensitive access requests and reviews break-glass events.',
    actions: [
      'ACCESS_REQUEST_APPROVE',
      'BREAK_GLASS_REVIEW',
      'CASE_VIEW',
      'CASE_ASSIGN',
      'CASE_CLOSE',
      'INCIDENT_VIEW',
      'ALERT_VIEW',
      'ALERT_REVIEW',
      'ANALYTICS_VIEW',
      'MATCH_CONFIRM',
    ],
  },
  {
    name: 'INVESTIGATOR',
    description: 'Accesses information relevant to lawful investigations they are assigned to.',
    actions: [
      'CITIZEN_SEARCH',
      'CITIZEN_VIEW',
      'RELATIONSHIP_VIEW',
      'VEHICLE_SEARCH',
      'VEHICLE_VIEW',
      'PROPERTY_SEARCH',
      'PROPERTY_VIEW',
      'BUSINESS_VIEW',
      'CASE_CREATE',
      'CASE_VIEW',
      'CASE_UPDATE',
      'CASE_LINK_SUBJECT',
      'INCIDENT_VIEW',
      'ACCESS_REQUEST_CREATE',
      'MISSING_PERSON_VIEW',
      'UNIDENTIFIED_PERSON_VIEW',
      'MATCH_RUN',
    ],
  },
  {
    name: 'INCIDENT_OFFICER',
    description: 'Accesses information required for an active incident they are assigned to.',
    actions: [
      'INCIDENT_CREATE',
      'INCIDENT_VIEW',
      'INCIDENT_UPDATE',
      'INCIDENT_CLOSE',
      'CITIZEN_SEARCH',
      'EMERGENCY_PROFILE_VIEW',
      'RESPONSE_UNIT_VIEW',
      'DISPATCH_UPDATE',
      'UNIDENTIFIED_PERSON_CREATE',
      'UNIDENTIFIED_PERSON_VIEW',
      'UNIDENTIFIED_PERSON_UPDATE',
      'ACCESS_REQUEST_CREATE',
      'BREAK_GLASS_INITIATE',
    ],
  },
  {
    name: 'DISPATCHER',
    description: 'Coordinates emergency response and assigns response units.',
    actions: [
      'INCIDENT_CREATE',
      'INCIDENT_VIEW',
      'INCIDENT_UPDATE',
      'DISPATCH_CREATE',
      'DISPATCH_UPDATE',
      'RESPONSE_UNIT_VIEW',
      'CITIZEN_SEARCH',
      'EMERGENCY_PROFILE_VIEW',
      'UNIDENTIFIED_PERSON_VIEW',
      'ANALYTICS_VIEW',
    ],
  },
  {
    name: 'EMERGENCY_RESPONDER',
    description:
      'Field responder. Receives only the minimum necessary emergency profile for an assigned incident.',
    actions: [
      'INCIDENT_VIEW',
      'INCIDENT_UPDATE',
      'EMERGENCY_PROFILE_VIEW',
      'DISPATCH_UPDATE',
      'UNIDENTIFIED_PERSON_CREATE',
      'BREAK_GLASS_INITIATE',
      // The one role that works where there is no signal (§56).
      'OFFLINE_ACCESS',
    ],
  },
  {
    name: 'MISSING_PERSON_OFFICER',
    description: 'Creates and manages missing-person cases.',
    actions: [
      'MISSING_PERSON_CREATE',
      'MISSING_PERSON_VIEW',
      'MISSING_PERSON_UPDATE',
      'MISSING_PERSON_RESOLVE',
      'UNIDENTIFIED_PERSON_CREATE',
      'UNIDENTIFIED_PERSON_VIEW',
      'UNIDENTIFIED_PERSON_UPDATE',
      'MATCH_RUN',
      'CITIZEN_SEARCH',
      'CITIZEN_VIEW',
      'CASE_CREATE',
      'CASE_VIEW',
      'CASE_UPDATE',
      'CASE_LINK_SUBJECT',
      'ACCESS_REQUEST_CREATE',
    ],
  },
  {
    name: 'ANALYST',
    description: 'Reads approved aggregated and de-identified intelligence only.',
    actions: ['ANALYTICS_VIEW', 'ALERT_VIEW'],
  },
  {
    name: 'AUDITOR',
    description: 'Reviews access and activity logs. Cannot read the citizen data itself.',
    actions: ['AUDIT_VIEW', 'AUDIT_VERIFY', 'ALERT_VIEW', 'BREAK_GLASS_REVIEW'],
  },
  {
    name: 'DATA_PROTECTION_OFFICER',
    description:
      'Oversees data-protection compliance, correction requests and access transparency.',
    actions: [
      'AUDIT_VIEW',
      'AUDIT_VERIFY',
      'CORRECTION_REQUEST_REVIEW',
      'ALERT_VIEW',
      'ALERT_REVIEW',
      'BREAK_GLASS_REVIEW',
      'RETENTION_VIEW',
      'RETENTION_RUN',
    ],
  },
  {
    name: 'REGISTRATION_OFFICER',
    description: 'Registers residents and resolves duplicate-candidate queues.',
    actions: [
      'CITIZEN_CREATE',
      'CITIZEN_SEARCH',
      'CITIZEN_VIEW',
      'CITIZEN_UPDATE',
      'DUPLICATE_REVIEW',
      'CORRECTION_REQUEST_REVIEW',
      'IMPORT_RUN',
    ],
  },
  {
    name: 'VERIFICATION_OFFICER',
    description: 'Verifies a presented PCID against the registry for service delivery.',
    actions: ['CITIZEN_VERIFY', 'CITIZEN_SEARCH'],
  },
  {
    name: 'MDA_OFFICER',
    description:
      'Ordinary government user delivering a service to a citizen, including the property, business and licence registers their ministry works with.',
    actions: [
      'CITIZEN_SEARCH',
      'CITIZEN_VIEW',
      'CITIZEN_VERIFY',
      'PROGRAMME_VIEW',
      'PROPERTY_VIEW',
      'PROPERTY_SEARCH',
      'BUSINESS_VIEW',
      'LICENCE_VIEW',
      'ACCESS_REQUEST_CREATE',
      'CORRECTION_REQUEST_CREATE',
    ],
  },
  {
    name: 'REVENUE_OFFICER',
    description:
      'Revenue service user administering assessments and collections. Held separately from MDA_OFFICER so that a ministry desk does not acquire access to tax records.',
    actions: [
      'CITIZEN_SEARCH',
      'CITIZEN_VIEW',
      'CITIZEN_VERIFY',
      'REVENUE_VIEW',
      'PROPERTY_VIEW',
      'PROPERTY_SEARCH',
      'BUSINESS_VIEW',
      'ACCESS_REQUEST_CREATE',
      'CORRECTION_REQUEST_CREATE',
    ],
  },
  {
    name: 'CITIZEN',
    description: 'A resident acting on their own record through the citizen portal.',
    actions: [
      'CITIZEN_VIEW',
      // Scoped to their own record by the self-service gate, and to the fields
      // the catalogue marks self-service editable.
      'CITIZEN_UPDATE',
      'CREDENTIAL_VIEW',
      'CREDENTIAL_REVOKE',
      'RELATIONSHIP_VIEW',
      'VEHICLE_VIEW',
      'PROPERTY_VIEW',
      'BUSINESS_VIEW',
      'LICENCE_VIEW',
      'REVENUE_VIEW',
      'PROGRAMME_VIEW',
      'CORRECTION_REQUEST_CREATE',
      'AUDIT_VIEW',
      'INCIDENT_CREATE',
      'MISSING_PERSON_CREATE',
      // Their own identifier, on their own phone, where a queue at a counter has
      // no coverage (§56).
      'OFFLINE_ACCESS',
    ],
  },
]);

export function roleDefinition(name: SeededRole): RoleDefinition {
  const found = ROLE_DEFINITIONS.find((role) => role.name === name);
  if (!found) throw new Error(`Unknown seeded role: ${name}`);
  return found;
}
