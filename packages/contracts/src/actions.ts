/**
 * Actions (permissions) recognised by the platform.
 *
 * Roles are bags of actions; the policy engine checks the action first (RBAC) and
 * then applies attribute-based gates (ABAC). Action names double as audit event
 * types, so §25's required audit vocabulary is a subset of this list.
 */
export const ACTIONS = [
  // Identity and citizen registry
  'CITIZEN_SEARCH',
  'CITIZEN_VIEW',
  'CITIZEN_CREATE',
  'CITIZEN_UPDATE',
  'CITIZEN_VERIFY',
  'CITIZEN_EXPORT',
  'EMERGENCY_PROFILE_VIEW',
  'CREDENTIAL_VIEW',
  'CREDENTIAL_REVOKE',
  'RELATIONSHIP_VIEW',
  'CORRECTION_REQUEST_CREATE',
  'CORRECTION_REQUEST_REVIEW',
  'DUPLICATE_REVIEW',

  // Linked government records (source agency remains authoritative, §28)
  'VEHICLE_SEARCH',
  'VEHICLE_VIEW',
  'PROPERTY_SEARCH',
  'PROPERTY_VIEW',
  'BUSINESS_VIEW',
  'LICENCE_VIEW',
  'REVENUE_VIEW',
  'PROGRAMME_VIEW',

  // Emergency response
  'INCIDENT_CREATE',
  'INCIDENT_VIEW',
  'INCIDENT_UPDATE',
  'INCIDENT_CLOSE',
  'DISPATCH_CREATE',
  'DISPATCH_UPDATE',
  'RESPONSE_UNIT_VIEW',
  'RESPONSE_UNIT_MANAGE',

  // Cases and investigations
  'CASE_CREATE',
  'CASE_VIEW',
  'CASE_UPDATE',
  'CASE_ASSIGN',
  'CASE_CLOSE',
  'CASE_LINK_SUBJECT',

  // Missing and unidentified persons
  'MISSING_PERSON_CREATE',
  'MISSING_PERSON_VIEW',
  'MISSING_PERSON_UPDATE',
  'MISSING_PERSON_RESOLVE',
  'UNIDENTIFIED_PERSON_CREATE',
  'UNIDENTIFIED_PERSON_VIEW',
  'UNIDENTIFIED_PERSON_UPDATE',
  'MATCH_RUN',
  'MATCH_CONFIRM',

  // Authorisation workflows
  'ACCESS_REQUEST_CREATE',
  'ACCESS_REQUEST_APPROVE',
  'BREAK_GLASS_INITIATE',
  'BREAK_GLASS_REVIEW',

  // Oversight
  'AUDIT_VIEW',
  'AUDIT_VERIFY',
  'ALERT_VIEW',
  'ALERT_REVIEW',
  'ANALYTICS_VIEW',

  // Administration (technical administration is not citizen-data entitlement, §7)
  'ADMIN_AGENCY_MANAGE',
  'ADMIN_USER_MANAGE',
  'ADMIN_ROLE_MANAGE',
  'ADMIN_POLICY_MANAGE',
  'ADMIN_REFERENCE_DATA_MANAGE',
  'ADMIN_INTEGRATION_MANAGE',
  'ADMIN_NOTIFICATION_RULE_MANAGE',
  'ADMIN_SYSTEM_MANAGE',
  'IMPORT_RUN',
] as const;

export type Action = (typeof ACTIONS)[number];

/**
 * Actions that require a step-up authenticated session (AAL2) regardless of role.
 * §42 mandates MFA; these are the operations where a cached AAL1 session is not
 * sufficient even if the user authenticated with MFA earlier in the day.
 */
export const STEP_UP_ACTIONS: readonly Action[] = Object.freeze([
  'CITIZEN_EXPORT',
  'BREAK_GLASS_INITIATE',
  'ACCESS_REQUEST_APPROVE',
  'ADMIN_ROLE_MANAGE',
  'ADMIN_POLICY_MANAGE',
  'ADMIN_USER_MANAGE',
  'ADMIN_AGENCY_MANAGE',
  'ADMIN_SYSTEM_MANAGE',
  'IMPORT_RUN',
]);

/** Actions that always produce an audit event, even when denied. */
export function isAuditableAction(_action: Action): boolean {
  // Every action in this platform is auditable. The function exists so that the
  // rule is stated once and cannot drift into per-module conditionals.
  return true;
}

export function isAction(value: unknown): value is Action {
  return typeof value === 'string' && (ACTIONS as readonly string[]).includes(value);
}
