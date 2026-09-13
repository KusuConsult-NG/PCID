/** Incident, dispatch and response-unit vocabulary (master system prompt §8, §36, §37). */

export const INCIDENT_TYPES = [
  'MEDICAL_EMERGENCY',
  'FIRE',
  'ROAD_ACCIDENT',
  'MISSING_PERSON',
  'DISASTER',
  'FLOOD',
  'BUILDING_COLLAPSE',
  'SECURITY_INCIDENT',
  'PUBLIC_DISTURBANCE',
  'RESCUE_OPERATION',
  'UNIDENTIFIED_PERSON',
  'UNIDENTIFIED_DECEASED_PERSON',
  'OTHER',
] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];

export const INCIDENT_SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const INCIDENT_STATUSES = [
  'REPORTED',
  'VERIFIED',
  'DISPATCHED',
  'ON_SCENE',
  'CONTAINED',
  'RESOLVED',
  'CLOSED',
  'CANCELLED',
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

/** Statuses during which incident-bound data access is permitted. */
export const ACTIVE_INCIDENT_STATUSES: readonly IncidentStatus[] = Object.freeze([
  'REPORTED',
  'VERIFIED',
  'DISPATCHED',
  'ON_SCENE',
  'CONTAINED',
]);

export const RESPONSE_UNIT_TYPES = [
  'POLICE_UNIT',
  'AMBULANCE',
  'FIRE_TRUCK',
  'RESCUE_TEAM',
  'EMERGENCY_VEHICLE',
  'PERSONNEL',
] as const;
export type ResponseUnitType = (typeof RESPONSE_UNIT_TYPES)[number];

export const RESPONSE_UNIT_STATUSES = [
  'AVAILABLE',
  'DISPATCHED',
  'EN_ROUTE',
  'ON_SCENE',
  'BUSY',
  'OFFLINE',
] as const;
export type ResponseUnitStatus = (typeof RESPONSE_UNIT_STATUSES)[number];

export const DISPATCH_STATUSES = [
  'ASSIGNED',
  'ACKNOWLEDGED',
  'EN_ROUTE',
  'ON_SCENE',
  'COMPLETED',
  'STOOD_DOWN',
] as const;
export type DispatchStatus = (typeof DISPATCH_STATUSES)[number];

/**
 * Provenance of a location (master system prompt §16). The platform holds no
 * covert tracking capability: every stored coordinate must say where it came from,
 * and `REAL_TIME_DEVICE` is reserved for a future, separately authorised module
 * that does not exist in this codebase.
 */
export const LOCATION_SOURCES = [
  'REGISTERED_ADDRESS',
  'INCIDENT_REPORT',
  'CALLER_SUPPLIED',
  'RESPONDER_OBSERVED',
  'GOVERNMENT_RECORD',
  'REAL_TIME_DEVICE',
] as const;
export type LocationSource = (typeof LOCATION_SOURCES)[number];
