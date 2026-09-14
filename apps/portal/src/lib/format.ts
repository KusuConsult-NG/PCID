/**
 * Presentation helpers.
 *
 * Dates are shown in the state's civil time with the timezone named, because a
 * resident checking who looked at their record needs to know whether "14:05"
 * means their afternoon.
 */
const DATE_TIME = new Intl.DateTimeFormat('en-NG', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Africa/Lagos',
});

const DATE_ONLY = new Intl.DateTimeFormat('en-NG', {
  dateStyle: 'long',
  timeZone: 'Africa/Lagos',
});

export function formatDateTime(iso: string | null | undefined): string {
  if (iso == null) return '—';
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? '—' : DATE_TIME.format(parsed);
}

export function formatDate(iso: string | null | undefined): string {
  if (iso == null) return '—';
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? '—' : DATE_ONLY.format(parsed);
}

/**
 * Turn a platform vocabulary value into something a resident reads without
 * effort. `REVENUE_ADMINISTRATION` is not a sentence.
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

export function sentenceCase(value: string): string {
  const words = value.replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Field paths come back as `registeredAddress`; residents read "Registered address". */
export function fieldLabel(field: string): string {
  const bare = field.includes('.') ? (field.split('.').pop() as string) : field;
  const spaced = bare.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Group a PCID for reading aloud, without changing what it is. */
export function formatPcid(pcid: string): string {
  return pcid.toUpperCase();
}

export function relativeMinutes(iso: string): number {
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60_000));
}
