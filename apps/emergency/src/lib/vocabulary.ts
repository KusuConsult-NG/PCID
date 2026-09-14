import { sentenceCase } from '@pcid/portal-kit/format';

/**
 * The platform's vocabulary, said to somebody on a scene.
 *
 * The fourth of these. The reader here may be standing in the road at night,
 * reading a tablet in a moving vehicle, so the words are short and the labels
 * say what to do rather than what the record is called.
 */
const PURPOSE_LABELS: Record<string, string> = {
  EMERGENCY_RESPONSE: 'Responding to an emergency',
  EMERGENCY_IDENTIFICATION: 'Identifying somebody at a scene',
  DISASTER_RESPONSE: 'Disaster response',
  CRIMINAL_INVESTIGATION: 'Criminal investigation',
  MISSING_PERSON_INVESTIGATION: 'Missing-person enquiry',
  IDENTITY_VERIFICATION: 'Verifying an identity',
  SERVICE_DELIVERY: 'Delivering a service',
  AUDIT_REVIEW: 'Oversight and audit',
  SYSTEM_ADMINISTRATION: 'Platform administration',
};

export function purposeLabel(purpose: string | null | undefined): string {
  if (purpose == null) return 'Not stated';
  return PURPOSE_LABELS[purpose] ?? sentenceCase(purpose);
}

export const INCIDENT_TYPES = [
  { value: 'MEDICAL_EMERGENCY', label: 'Medical emergency' },
  { value: 'ROAD_ACCIDENT', label: 'Road accident' },
  { value: 'FIRE', label: 'Fire' },
  { value: 'BUILDING_COLLAPSE', label: 'Building collapse' },
  { value: 'FLOOD', label: 'Flood' },
  { value: 'DISASTER', label: 'Disaster' },
  { value: 'SECURITY_INCIDENT', label: 'Security incident' },
  { value: 'PUBLIC_DISTURBANCE', label: 'Public disturbance' },
  { value: 'RESCUE_OPERATION', label: 'Rescue operation' },
  { value: 'MISSING_PERSON', label: 'Missing person' },
  { value: 'UNIDENTIFIED_PERSON', label: 'Somebody found who cannot say who they are' },
  { value: 'OTHER', label: 'Something else' },
];

/**
 * Severity, said as what it means for the response.
 *
 * "Critical" and "low" mean nothing to somebody taking their first call at
 * 3 a.m.; "life at risk now" does. The stored value is unchanged.
 */
export const SEVERITIES = [
  { value: 'CRITICAL', label: 'Critical — life at risk now' },
  { value: 'HIGH', label: 'High — serious, needs a unit quickly' },
  { value: 'MEDIUM', label: 'Medium — needs attending to' },
  { value: 'LOW', label: 'Low — no immediate danger' },
];

/** The statuses a controller moves an incident through. */
export const WORKING_STATUSES = [
  { value: 'VERIFIED', label: 'Verified — the call is real' },
  { value: 'DISPATCHED', label: 'Dispatched' },
  { value: 'ON_SCENE', label: 'On scene' },
  { value: 'CONTAINED', label: 'Contained' },
];

export const UNIT_TYPES = [
  { value: 'AMBULANCE', label: 'Ambulance' },
  { value: 'FIRE_TRUCK', label: 'Fire appliance' },
  { value: 'RESCUE_TEAM', label: 'Rescue team' },
  { value: 'POLICE_UNIT', label: 'Police unit' },
  { value: 'EMERGENCY_VEHICLE', label: 'Other emergency vehicle' },
  { value: 'PERSONNEL', label: 'Personnel on foot' },
];

export const PERSON_ROLES = [
  { value: 'CASUALTY', label: 'Casualty' },
  { value: 'WITNESS', label: 'Witness' },
  { value: 'REPORTER', label: 'The person who called it in' },
  { value: 'NEXT_OF_KIN', label: 'Next of kin' },
  { value: 'RESPONDER', label: 'Responder' },
  { value: 'OTHER', label: 'Someone else' },
];

export const OFFICER_ROLES = [
  { value: 'RESPONDER', label: 'Responder' },
  { value: 'INCIDENT_OFFICER', label: 'Incident officer' },
  { value: 'COMMANDER', label: 'Commander' },
  { value: 'OBSERVER', label: 'Observer' },
];

const ACTION_LABELS: Record<string, string> = {
  INCIDENT_CREATE: 'Took a call',
  INCIDENT_VIEW: 'Opened an incident',
  INCIDENT_UPDATE: 'Changed an incident',
  INCIDENT_CLOSE: 'Closed an incident',
  DISPATCH_CREATE: 'Sent a unit',
  DISPATCH_UPDATE: 'Updated a unit',
  RESPONSE_UNIT_VIEW: 'Saw the fleet',
  RESPONSE_UNIT_MANAGE: 'Managed the fleet',
  EMERGENCY_PROFILE_VIEW: 'Read an emergency profile',
  CITIZEN_SEARCH: 'Searched the register',
  CITIZEN_VERIFY: 'Checked an identity',
  UNIDENTIFIED_PERSON_CREATE: 'Recorded somebody found',
  UNIDENTIFIED_PERSON_VIEW: 'Opened an unidentified-person record',
  UNIDENTIFIED_PERSON_UPDATE: 'Changed an unidentified-person record',
  ACCESS_REQUEST_CREATE: 'Requested access',
  ACCESS_REQUEST_APPROVE: 'Decided an access request',
  BREAK_GLASS_INITIATE: 'Used break-glass access',
  BREAK_GLASS_REVIEW: 'Reviewed break-glass access',
  ANALYTICS_VIEW: 'Read aggregated analytics',
  ALERT_VIEW: 'Opened the alert queue',
  ADMIN_USER_MANAGE: 'Managed accounts',
  AUTHENTICATE: 'Signed in',
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? sentenceCase(action);
}

export function severityTone(severity: string): 'ok' | 'warn' | 'danger' | 'info' | 'muted' {
  switch (severity) {
    case 'CRITICAL':
      return 'danger';
    case 'HIGH':
      return 'warn';
    case 'MEDIUM':
      return 'info';
    default:
      return 'muted';
  }
}

export function incidentStatusTone(status: string): 'ok' | 'warn' | 'danger' | 'info' | 'muted' {
  switch (status) {
    case 'REPORTED':
      return 'danger';
    case 'VERIFIED':
    case 'DISPATCHED':
      return 'warn';
    case 'ON_SCENE':
    case 'CONTAINED':
      return 'info';
    case 'RESOLVED':
      return 'ok';
    default:
      return 'muted';
  }
}

export function unitStatusTone(status: string): 'ok' | 'warn' | 'danger' | 'info' | 'muted' {
  switch (status) {
    case 'AVAILABLE':
      return 'ok';
    case 'DISPATCHED':
    case 'EN_ROUTE':
      return 'warn';
    case 'ON_SCENE':
      return 'info';
    case 'BUSY':
      return 'danger';
    default:
      return 'muted';
  }
}

/** Minutes and seconds, for a response time somebody will be asked about. */
export function duration(seconds: number | null | undefined): string {
  if (seconds == null) return '—';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** Metres, said the way somebody driving would say it. */
export function distance(metres: number | null | undefined): string {
  if (metres == null) return 'Distance not known';
  if (metres < 1000) return `${metres} m away`;
  return `${(metres / 1000).toFixed(1)} km away`;
}

/**
 * What break-glass may stand in for, said to a responder.
 *
 * The one this portal's readers actually meet is the first: the person is in
 * front of them and control has not attached them yet.
 */
export const BREAK_GLASS_GATES = [
  {
    value: 'INCIDENT_BINDING',
    label: 'I am not attached to this incident',
    hint: 'Use when control cannot attach you in the time you have. This is the ordinary one.',
  },
  {
    value: 'JURISDICTION',
    label: 'The person is outside my area',
    hint: 'Use when you have crossed an LGA boundary to reach somebody.',
  },
  {
    value: 'FIELD_APPROVAL',
    label: 'A field needs an approval I cannot wait for',
    hint: 'Rare in an emergency: the emergency profile already carries what care needs.',
  },
  {
    value: 'CASE_BINDING',
    label: 'The person is not linked to a case',
    hint: 'For an investigative read, not an emergency one.',
  },
];
