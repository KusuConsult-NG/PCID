import { sentenceCase } from '@pcid/portal-kit/format';

/**
 * The platform's vocabulary, said to an investigating officer.
 *
 * Two vocabularies already exist for the same audit rows - the resident's and
 * the counter officer's. This is the third, because the reader here is somebody
 * running an enquiry and the useful sentence is different again.
 */
const PURPOSE_LABELS: Record<string, string> = {
  CRIMINAL_INVESTIGATION: 'Criminal investigation',
  MISSING_PERSON_INVESTIGATION: 'Missing-person enquiry',
  EMERGENCY_IDENTIFICATION: 'Identifying somebody found',
  EMERGENCY_RESPONSE: 'Emergency response',
  IDENTITY_VERIFICATION: 'Verifying an identity',
  SERVICE_DELIVERY: 'Delivering a service',
  AUDIT_REVIEW: 'Oversight and audit',
  STATISTICAL_ANALYSIS: 'Statistical analysis',
};

export function purposeLabel(purpose: string | null | undefined): string {
  if (purpose == null) return 'Not stated';
  return PURPOSE_LABELS[purpose] ?? sentenceCase(purpose);
}

/**
 * The purposes an officer here may open a record under.
 *
 * Short on purpose. The platform holds the authoritative set and refuses
 * anything this account's role does not allow; offering three clear options is
 * kinder than twenty in which the honest choice is hard to find.
 */
export const INVESTIGATION_PURPOSES = [
  { value: 'CRIMINAL_INVESTIGATION', label: 'A criminal investigation I am assigned to' },
  { value: 'MISSING_PERSON_INVESTIGATION', label: 'A missing-person enquiry' },
  { value: 'EMERGENCY_IDENTIFICATION', label: 'Identifying somebody who was found' },
] as const;

export const CASE_TYPES = [
  { value: 'CRIMINAL_INVESTIGATION', label: 'Criminal investigation' },
  { value: 'MISSING_PERSON', label: 'Missing person' },
  { value: 'FRAUD', label: 'Fraud' },
  { value: 'IDENTITY_FRAUD', label: 'Identity fraud' },
  { value: 'PUBLIC_SAFETY', label: 'Public safety' },
  { value: 'OTHER', label: 'Something else' },
];

/**
 * What a person is to a case.
 *
 * Chosen from a closed list and recorded, because "subject of interest" and
 * "witness" are not the same thing and a file that does not say which is a file
 * nobody can review.
 */
export const SUBJECT_ROLES = [
  { value: 'SUBJECT_OF_INTEREST', label: 'Subject of interest' },
  { value: 'COMPLAINANT', label: 'Complainant' },
  { value: 'WITNESS', label: 'Witness' },
  { value: 'VICTIM', label: 'Victim' },
  { value: 'REPORTING_PERSON', label: 'Reporting person' },
  { value: 'NEXT_OF_KIN', label: 'Next of kin' },
];

const ACTION_LABELS: Record<string, string> = {
  CITIZEN_SEARCH: 'Searched the register',
  CITIZEN_VIEW: 'Opened a citizen record',
  CASE_CREATE: 'Opened a case',
  CASE_VIEW: 'Opened a case file',
  CASE_UPDATE: 'Changed a case',
  CASE_ASSIGN: 'Assigned an officer',
  CASE_CLOSE: 'Closed a case',
  CASE_LINK_SUBJECT: 'Linked somebody to a case',
  LINK_RECORD: 'Linked a record to a case',
  MISSING_PERSON_CREATE: 'Reported a missing person',
  MISSING_PERSON_VIEW: 'Opened a missing-person enquiry',
  MISSING_PERSON_UPDATE: 'Changed a missing-person enquiry',
  MISSING_PERSON_RESOLVE: 'Recorded the outcome of an enquiry',
  UNIDENTIFIED_PERSON_CREATE: 'Recorded an unidentified person',
  UNIDENTIFIED_PERSON_VIEW: 'Opened an unidentified-person record',
  UNIDENTIFIED_PERSON_UPDATE: 'Changed an unidentified-person record',
  MATCH_RUN: 'Ran the matching engine',
  MATCH_CONFIRM: 'Decided a candidate match',
  ACCESS_REQUEST_CREATE: 'Requested access',
  ACCESS_REQUEST_APPROVE: 'Decided an access request',
  BREAK_GLASS_INITIATE: 'Used break-glass access',
  BREAK_GLASS_REVIEW: 'Reviewed break-glass access',
  ANALYTICS_VIEW: 'Read aggregated analytics',
  ALERT_VIEW: 'Opened the alert queue',
  ALERT_REVIEW: 'Reviewed an alert',
  AUTHENTICATE: 'Signed in',
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? sentenceCase(action);
}

export function caseStatusTone(status: string): 'ok' | 'warn' | 'danger' | 'info' | 'muted' {
  switch (status) {
    case 'ACTIVE':
    case 'OPEN':
      return 'ok';
    case 'SUSPENDED':
    case 'PENDING_REVIEW':
      return 'warn';
    case 'CLOSED':
    case 'ARCHIVED':
      return 'muted';
    default:
      return 'info';
  }
}

export function enquiryStatusTone(status: string): 'ok' | 'warn' | 'danger' | 'info' | 'muted' {
  switch (status) {
    case 'ACTIVE':
      return 'danger';
    case 'VERIFIED':
    case 'REPORTED':
      return 'warn';
    case 'LOCATED':
    case 'REUNITED':
      return 'ok';
    default:
      return 'muted';
  }
}

/**
 * The fields an investigator most often has to ask for.
 *
 * The catalogue holds several hundred; offering all of them in a form invites
 * an officer to tick a row of boxes and call it a request. These are the ones
 * the engine most often withholds from an investigation purpose, said in
 * ordinary words, with a free-text box underneath for anything else.
 */
export const REQUESTABLE_FIELDS = [
  { value: 'citizen.nin', label: 'National Identification Number' },
  { value: 'citizen.dateOfBirth', label: 'Date of birth' },
  { value: 'citizen.registeredAddress', label: 'Registered address' },
  { value: 'citizen.phonePrimary', label: 'Telephone number' },
  { value: 'citizen.emergencyContacts', label: 'Emergency contacts' },
  { value: 'citizen.photographUri', label: 'Photograph' },
  { value: 'citizen.identityIntegrityFlags', label: 'Identity integrity flags' },
  { value: 'citizen.lawEnforcementMarkers', label: 'Law-enforcement markers' },
  { value: 'vehicle.ownerPcid', label: 'Registered keeper of a vehicle' },
  { value: 'property.ownerPcid', label: 'Registered owner of a property' },
];

/**
 * What break-glass may stand in for.
 *
 * Four gates and no more. It cannot grant a role the account does not hold, it
 * cannot lift the clearance ceiling, and it cannot put an agency inside the
 * law-enforcement compartment. An officer choosing from this list is choosing
 * which ordinary check they are bypassing, which is the thing the reviewer will
 * afterwards be asked to weigh.
 */
export const BREAK_GLASS_GATES = [
  {
    value: 'CASE_BINDING',
    label: 'The person is not linked to my case',
    hint: 'Use when the link cannot be made in time — not when it simply has not been made yet.',
  },
  {
    value: 'INCIDENT_BINDING',
    label: 'I am not assigned to the incident',
    hint: 'Use when responding to something unfolding that the roster has not caught up with.',
  },
  {
    value: 'JURISDICTION',
    label: 'The person is outside my jurisdiction',
    hint: 'Use when a life is at risk across an LGA boundary.',
  },
  {
    value: 'FIELD_APPROVAL',
    label: 'A field needs an approval I cannot wait for',
    hint: 'Use only when an approver cannot be reached in the time available.',
  },
];

export function accessRequestTone(status: string): 'ok' | 'warn' | 'danger' | 'info' | 'muted' {
  switch (status) {
    case 'APPROVED':
      return 'ok';
    case 'DENIED':
    case 'AUTO_DENIED':
      return 'danger';
    case 'EXPIRED':
    case 'WITHDRAWN':
      return 'muted';
    default:
      return 'info';
  }
}
