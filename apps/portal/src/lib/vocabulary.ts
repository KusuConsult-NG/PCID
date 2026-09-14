import { sentenceCase } from '@pcid/portal-kit/format';

/**
 * The platform's vocabulary, said to a resident.
 *
 * `REVENUE_ADMINISTRATION` is not a sentence, and "CITIZEN_VIEW" is not what
 * happened from where the resident is standing. These labels are the citizen
 * portal's own: the government portal describes the same events to the officer
 * who caused them, and one shared wording would be wrong for one of them.
 */
const PURPOSE_LABELS: Record<string, string> = {
  CITIZEN_SELF_SERVICE: 'You used the portal',
  IDENTITY_VERIFICATION: 'Confirming your identity',
  SERVICE_DELIVERY: 'Providing a service to you',
  REVENUE_ADMINISTRATION: 'Tax and revenue',
  EMERGENCY_RESPONSE: 'Responding to an emergency',
  EMERGENCY_IDENTIFICATION: 'Identifying someone in an emergency',
  DISASTER_RESPONSE: 'Responding to a disaster',
  PUBLIC_HEALTH_RESPONSE: 'Public health',
  MISSING_PERSON_INVESTIGATION: 'A missing person enquiry',
  IDENTITY_INTEGRITY_REVIEW: 'Checking the registry for duplicate records',
  CORRECTION_REVIEW: 'Reviewing a correction',
  AUDIT_REVIEW: 'Oversight and audit',
  STATISTICAL_ANALYSIS: 'Statistics',
};

export function purposeLabel(purpose: string | null): string {
  if (purpose === null) return 'Not stated';
  return PURPOSE_LABELS[purpose] ?? sentenceCase(purpose);
}

const ACTION_LABELS: Record<string, string> = {
  CITIZEN_VIEW: 'Viewed your record',
  CITIZEN_SEARCH: 'Searched the registry',
  CITIZEN_VERIFY: 'Checked your Plateau Citizen ID',
  CITIZEN_UPDATE: 'Updated your record',
  CITIZEN_CREATE: 'Created your record',
  EMERGENCY_PROFILE_VIEW: 'Opened your emergency information',
  UPDATE_CITIZEN: 'Changed something on your record',
  LINK_RECORD: 'Linked your record to a case',
  CORRECTION_REQUEST_CREATE: 'Raised a request about your record',
  AUTHENTICATE: 'Signed in',
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? sentenceCase(action);
}
