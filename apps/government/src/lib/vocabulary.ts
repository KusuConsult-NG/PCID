import { sentenceCase } from '@pcid/portal-kit/format';

/**
 * The platform's vocabulary, said to the officer who caused the event.
 *
 * The citizen portal says "Viewed your record". Here the same audit row reads
 * "Opened a citizen record", because the reader is the person who did it or the
 * person reviewing them, and the useful sentence is different.
 */
const PURPOSE_LABELS: Record<string, string> = {
  CITIZEN_SELF_SERVICE: 'The resident, in their own portal',
  IDENTITY_VERIFICATION: 'Verifying an identity',
  SERVICE_DELIVERY: 'Delivering a service',
  REVENUE_ADMINISTRATION: 'Revenue administration',
  EMERGENCY_RESPONSE: 'Emergency response',
  EMERGENCY_IDENTIFICATION: 'Emergency identification',
  DISASTER_RESPONSE: 'Disaster response',
  PUBLIC_HEALTH_RESPONSE: 'Public health response',
  MISSING_PERSON_INVESTIGATION: 'Missing-person investigation',
  CRIMINAL_INVESTIGATION: 'Criminal investigation',
  IDENTITY_INTEGRITY_REVIEW: 'Identity integrity review',
  CORRECTION_REVIEW: 'Correction review',
  AUDIT_REVIEW: 'Oversight and audit',
  STATISTICAL_ANALYSIS: 'Statistical analysis',
  SYSTEM_ADMINISTRATION: 'System administration',
};

export function purposeLabel(purpose: string | null | undefined): string {
  if (purpose == null) return 'Not stated';
  return PURPOSE_LABELS[purpose] ?? sentenceCase(purpose);
}

/**
 * The purposes an officer may choose from when opening a record.
 *
 * Deliberately a short list of the everyday ones. The platform holds the
 * authoritative set and refuses anything this account's role does not allow;
 * offering fewer, clearer options is kinder than a dropdown of twenty in which
 * the honest choice is hard to find.
 */
export const SERVICE_PURPOSES = [
  { value: 'SERVICE_DELIVERY', label: 'Delivering a service to this person' },
  { value: 'IDENTITY_VERIFICATION', label: 'Verifying who they are' },
  { value: 'REVENUE_ADMINISTRATION', label: 'A revenue or tax matter' },
  { value: 'CORRECTION_REVIEW', label: 'Reviewing a correction to their record' },
] as const;

const ACTION_LABELS: Record<string, string> = {
  CITIZEN_SEARCH: 'Searched the register',
  CITIZEN_VIEW: 'Opened a citizen record',
  CITIZEN_CREATE: 'Registered a resident',
  CITIZEN_UPDATE: 'Changed a citizen record',
  CITIZEN_VERIFY: 'Checked a Plateau Citizen ID',
  EMERGENCY_PROFILE_VIEW: 'Opened an emergency profile',
  CREDENTIAL_VIEW: 'Opened a credential',
  CREDENTIAL_REVOKE: 'Revoked a credential',
  DUPLICATE_REVIEW: 'Decided a duplicate candidate',
  CORRECTION_REQUEST_CREATE: 'Raised a correction request',
  CORRECTION_REQUEST_REVIEW: 'Decided a correction request',
  ALERT_VIEW: 'Opened the alert queue',
  ALERT_REVIEW: 'Reviewed an alert',
  AUDIT_VIEW: 'Searched the audit trail',
  AUDIT_VERIFY: 'Verified the audit chain',
  RETENTION_VIEW: 'Read the retention schedule',
  RETENTION_RUN: 'Applied the retention schedule',
  ACCESS_REQUEST_CREATE: 'Requested access',
  ACCESS_REQUEST_APPROVE: 'Decided an access request',
  BREAK_GLASS_INITIATE: 'Used break-glass access',
  BREAK_GLASS_REVIEW: 'Reviewed break-glass access',
  ADMIN_AGENCY_MANAGE: 'Administered an agency',
  ADMIN_USER_MANAGE: 'Administered an account',
  ADMIN_INTEGRATION_MANAGE: 'Administered a data source',
  AUTHENTICATE: 'Signed in',
  UPDATE_CITIZEN: 'Changed a citizen record',
  LINK_RECORD: 'Linked a record to a case',
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? sentenceCase(action);
}

const OUTCOME_LABELS: Record<string, string> = {
  PERMITTED: 'Permitted',
  DENIED: 'Refused',
  ERROR: 'Failed',
};

export function outcomeLabel(outcome: string): string {
  return OUTCOME_LABELS[outcome] ?? sentenceCase(outcome);
}

export function severityTone(severity: string): 'danger' | 'warn' | 'info' | 'muted' {
  switch (severity) {
    case 'CRITICAL':
    case 'HIGH':
      return 'danger';
    case 'MEDIUM':
      return 'warn';
    case 'LOW':
      return 'info';
    default:
      return 'muted';
  }
}
