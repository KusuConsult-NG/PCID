import {
  ACTIVE_CASE_STATUSES,
  ACTIVE_INCIDENT_STATUSES,
  CASE_BOUND_PURPOSES,
  INCIDENT_BOUND_PURPOSES,
  STEP_UP_ACTIONS,
  isCompartmented,
  lowestClassification,
  rankDominates,
} from '@pcid/contracts';
import type { Action, BreakGlassSatisfiableGate, Classification } from '@pcid/contracts';

import {
  BINDING_EXEMPT_ACTIONS,
  CASE_LINKAGE_REQUIRED_ACTIONS,
  CASE_RECORD_ACTIONS,
  CITIZEN_DATA_ACTIONS,
  purposesForAction,
  resourceTypesForAction,
} from './action-metadata';
import type { AccessWindow, GateId, PolicyRequest, PolicyReason, PolicySubject } from './types';

export interface GateFailure {
  readonly reason: PolicyReason;
  /**
   * When set, an active break-glass grant covering this gate may satisfy it.
   * Gates without this property can never be relaxed (§23).
   */
  readonly relaxableBy?: BreakGlassSatisfiableGate;
}

export type GateResult = GateFailure | null;

function fail(
  gate: GateId,
  code: string,
  message: string,
  relaxableBy?: BreakGlassSatisfiableGate,
): GateFailure {
  return relaxableBy === undefined
    ? { reason: { gate, code, message } }
    : { reason: { gate, code, message }, relaxableBy };
}

/** Citizen actors may report these about someone other than themselves (§17). */
const CITIZEN_THIRD_PARTY_REPORT_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  'INCIDENT_CREATE',
  'MISSING_PERSON_CREATE',
]);

/** Purposes a citizen acting on the citizen portal may ever assert. */
const CITIZEN_PERMITTED_PURPOSES = new Set(['CITIZEN_SELF_SERVICE', 'EMERGENCY_RESPONSE']);

/**
 * The classification ceiling that actually applies: the lower of what the person
 * is cleared for and what their agency is approved to receive. An agency cannot
 * be bypassed by clearing an individual, and vice versa.
 */
export function effectiveClearance(subject: PolicySubject): Classification {
  return lowestClassification([subject.clearance, subject.agencyMaxClassification]);
}

export function accountStandingGate(request: PolicyRequest): GateResult {
  const { accountStatus } = request.subject;
  if (accountStatus === 'ACTIVE') return null;
  return fail(
    'ACCOUNT_STANDING',
    `ACCOUNT_${accountStatus}`,
    `The account is ${accountStatus.toLowerCase()} and cannot be used.`,
  );
}

export function agencyStandingGate(request: PolicyRequest): GateResult {
  const { actorType, agencyId, agencyStatus } = request.subject;
  if (actorType === 'CITIZEN' || actorType === 'SYSTEM') return null;
  if (agencyId === null) {
    return fail(
      'AGENCY_STANDING',
      'NO_AGENCY',
      'The account is not attached to a registered agency.',
    );
  }
  if (agencyStatus !== 'ACTIVE') {
    return fail(
      'AGENCY_STANDING',
      `AGENCY_${agencyStatus ?? 'UNKNOWN'}`,
      'The requesting agency is not active in the Government Agency Registry.',
    );
  }
  return null;
}

export function dataSharingAgreementGate(request: PolicyRequest): GateResult {
  const { actorType, dataSharingAgreement } = request.subject;
  if (actorType === 'CITIZEN' || actorType === 'SYSTEM') return null;
  if (!CITIZEN_DATA_ACTIONS.has(request.action)) return null;
  if (dataSharingAgreement === 'SIGNED') return null;
  return fail(
    'DATA_SHARING_AGREEMENT',
    `DSA_${dataSharingAgreement ?? 'NONE'}`,
    'The agency has no data-sharing agreement in force for citizen information.',
  );
}

export function authenticationGate(request: PolicyRequest): GateResult {
  const { actorType, mfaEnrolled, authenticationLevel } = request.subject;
  if (actorType === 'GOVERNMENT_USER' && !mfaEnrolled) {
    return fail(
      'AUTHENTICATION',
      'MFA_NOT_ENROLLED',
      'Multi-factor authentication is mandatory for government users.',
    );
  }
  if (
    (actorType === 'API_CLIENT' || actorType === 'INTEGRATION') &&
    authenticationLevel !== 'AAL2'
  ) {
    return fail(
      'AUTHENTICATION',
      'CLIENT_AUTH_INSUFFICIENT',
      'Service-to-service callers must present a strongly authenticated credential.',
    );
  }
  return null;
}

export function stepUpGate(request: PolicyRequest): GateResult {
  if (!STEP_UP_ACTIONS.includes(request.action)) return null;
  if (request.subject.authenticationLevel === 'AAL2') return null;
  return fail(
    'STEP_UP',
    'STEP_UP_REQUIRED',
    'This operation requires a freshly re-authenticated session.',
  );
}

export function rbacGate(request: PolicyRequest): GateResult {
  if (request.subject.actions.includes(request.action)) return null;
  return fail(
    'RBAC',
    'ACTION_NOT_GRANTED',
    `No role held by this account grants ${request.action}.`,
  );
}

function windowHourAndWeekday(now: Date, window: AccessWindow): { hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: window.timezone,
    hour: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(now);
  const hourPart = parts.find((part) => part.type === 'hour')?.value ?? '00';
  const weekdayPart = parts.find((part) => part.type === 'weekday')?.value ?? 'Mon';
  const weekdays: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  return { hour: Number.parseInt(hourPart, 10) % 24, weekday: weekdays[weekdayPart] ?? 1 };
}

export function resourceTypeGate(request: PolicyRequest): GateResult {
  const permitted = resourceTypesForAction(request.action);
  if (permitted.includes(request.resource.type)) return null;
  return fail(
    'RESOURCE_TYPE',
    'ACTION_NOT_VALID_FOR_RESOURCE',
    `${request.action} cannot be applied to a ${request.resource.type} record.`,
  );
}

export function accessWindowGate(request: PolicyRequest): GateResult {
  const window = request.subject.accessWindow;
  if (!window) return null;
  const { hour, weekday } = windowHourAndWeekday(request.now, window);
  const dayAllowed = window.daysOfWeek.includes(weekday);
  const hourAllowed =
    window.startHour <= window.endHour
      ? hour >= window.startHour && hour < window.endHour
      : hour >= window.startHour || hour < window.endHour; // window crossing midnight
  if (dayAllowed && hourAllowed) return null;
  return fail(
    'ACCESS_WINDOW',
    'OUTSIDE_ACCESS_WINDOW',
    'This account may only be used during its authorised hours.',
  );
}

export function separationOfDutyGate(request: PolicyRequest): GateResult {
  const { action, resource, subject } = request;
  const selfAdminActions: readonly Action[] = [
    'ADMIN_USER_MANAGE',
    'ADMIN_ROLE_MANAGE',
    'ADMIN_POLICY_MANAGE',
  ];
  if (!selfAdminActions.includes(action)) return null;
  if (resource.type === 'GOVERNMENT_USER' && resource.id === subject.userId) {
    return fail(
      'SEPARATION_OF_DUTY',
      'SELF_ADMINISTRATION',
      'An account may not administer its own entitlements.',
    );
  }
  return null;
}

export function selfServiceScopeGate(request: PolicyRequest): GateResult {
  const { subject, resource, action, purpose } = request;
  if (subject.actorType !== 'CITIZEN') return null;

  if (!CITIZEN_PERMITTED_PURPOSES.has(purpose)) {
    return fail(
      'SELF_SERVICE_SCOPE',
      'PURPOSE_NOT_AVAILABLE_TO_CITIZEN',
      'A citizen account may only act for self-service or to raise an emergency.',
    );
  }

  const ownPcid = subject.subjectPcid ?? null;
  if (ownPcid === null) {
    return fail(
      'SELF_SERVICE_SCOPE',
      'NO_LINKED_RECORD',
      'The citizen account is not linked to a registry record.',
    );
  }

  const target = resource.subjectPcid ?? null;
  if (target === null) return null;
  if (target === ownPcid) return null;
  if (CITIZEN_THIRD_PARTY_REPORT_ACTIONS.has(action) && resource.id === null) {
    // Reporting an emergency or a missing person about someone else creates a
    // record for official review. It releases nothing about that person.
    return null;
  }
  return fail(
    'SELF_SERVICE_SCOPE',
    'NOT_OWN_RECORD',
    'A citizen account may only access its own record.',
  );
}

export function purposeGate(request: PolicyRequest): GateResult {
  const permitted = purposesForAction(request.action);
  if (permitted.includes(request.purpose)) return null;
  return fail(
    'PURPOSE',
    'PURPOSE_NOT_PERMITTED_FOR_ACTION',
    `${request.action} may not be performed for the purpose ${request.purpose}.`,
  );
}

export function classificationRankGate(request: PolicyRequest): GateResult {
  const ceiling = effectiveClearance(request.subject);
  if (rankDominates(ceiling, request.resource.classification)) return null;
  return fail(
    'CLASSIFICATION_RANK',
    'INSUFFICIENT_CLEARANCE',
    'The record is classified above the clearance held by this account or its agency.',
  );
}

export function compartmentGate(request: PolicyRequest): GateResult {
  const { classification } = request.resource;
  if (!isCompartmented(classification)) return null;
  if (request.subject.compartments.includes(classification)) return null;
  return fail(
    'COMPARTMENT',
    'COMPARTMENT_NOT_HELD',
    'The record carries a compartment marking this agency is not authorised for.',
  );
}

export function jurisdictionGate(request: PolicyRequest): GateResult {
  const { subject, resource } = request;
  if (subject.actorType === 'CITIZEN' || subject.actorType === 'SYSTEM') return null;
  const { jurisdiction } = subject;
  if (jurisdiction.scope === 'STATE') return null;
  const lga = resource.lgaCode ?? null;
  if (lga === null) return null;
  if (!jurisdiction.lgaCodes.includes(lga)) {
    return fail(
      'JURISDICTION',
      'OUTSIDE_JURISDICTION_LGA',
      'The record lies outside the geographic jurisdiction of this account.',
      'JURISDICTION',
    );
  }
  if (jurisdiction.scope === 'WARD') {
    const ward = resource.wardCode ?? null;
    if (ward !== null && !jurisdiction.wardCodes.includes(ward)) {
      return fail(
        'JURISDICTION',
        'OUTSIDE_JURISDICTION_WARD',
        'The record lies outside the ward jurisdiction of this account.',
        'JURISDICTION',
      );
    }
  }
  return null;
}

export function caseBindingGate(request: PolicyRequest): GateResult {
  const { subject, action, purpose, resource, caseContext } = request;
  // A case record action applies the gate only when a specific case is being
  // addressed: a listing carries neither a case reference nor a record id, and is
  // scoped to the caller's assignments by the service that serves it.
  const addressesOneCase = caseContext !== null || resource.id !== null;
  const applies =
    CASE_BOUND_PURPOSES.includes(purpose) &&
    !BINDING_EXEMPT_ACTIONS.has(action) &&
    (CITIZEN_DATA_ACTIONS.has(action) ||
      action === 'CASE_LINK_SUBJECT' ||
      (CASE_RECORD_ACTIONS.has(action) && addressesOneCase));
  if (!applies) return null;
  if (subject.actorType === 'CITIZEN') return null;

  if (!caseContext) {
    return fail(
      'CASE_BINDING',
      'CASE_REFERENCE_REQUIRED',
      'This purpose requires the case the access is being made under.',
      'CASE_BINDING',
    );
  }
  if (!ACTIVE_CASE_STATUSES.includes(caseContext.status)) {
    return fail(
      'CASE_BINDING',
      'CASE_NOT_ACTIVE',
      `Case ${caseContext.caseNumber} is ${caseContext.status.toLowerCase()} and authorises no access.`,
      'CASE_BINDING',
    );
  }
  const inOwningAgency = caseContext.agencyId === subject.agencyId;

  if (action === 'CASE_ASSIGN') {
    // Managing who works a case is an administrative act over the agency's own
    // caseload, and it releases nothing about anyone. Requiring the assigner to
    // already be assigned would make a case unjoinable once its original officer
    // left, so agency authority is what counts here.
    if (!inOwningAgency) {
      return fail(
        'CASE_BINDING',
        'AGENCY_LACKS_CASE_AUTHORITY',
        'The case belongs to another agency.',
        'CASE_BINDING',
      );
    }
    if (!rankDominates(effectiveClearance(subject), caseContext.classification)) {
      return fail(
        'CASE_BINDING',
        'CASE_ABOVE_CLEARANCE',
        'The case is classified above the clearance held by this account or its agency.',
      );
    }
    return null;
  }

  const assigned =
    caseContext.assignedUserIds.includes(subject.userId) ||
    caseContext.supervisorUserIds.includes(subject.userId);
  if (!assigned) {
    return fail(
      'CASE_BINDING',
      'NOT_ASSIGNED_TO_CASE',
      `This account is not assigned to case ${caseContext.caseNumber}.`,
      'CASE_BINDING',
    );
  }
  if (!inOwningAgency && !caseContext.assignedUserIds.includes(subject.userId)) {
    return fail(
      'CASE_BINDING',
      'AGENCY_LACKS_CASE_AUTHORITY',
      'The case belongs to another agency and this account has no explicit assignment on it.',
      'CASE_BINDING',
    );
  }
  if (!rankDominates(effectiveClearance(subject), caseContext.classification)) {
    // Clearance is never relaxable, including through a case.
    return fail(
      'CASE_BINDING',
      'CASE_ABOVE_CLEARANCE',
      'The case is classified above the clearance held by this account or its agency.',
    );
  }
  if (CASE_LINKAGE_REQUIRED_ACTIONS.has(action)) {
    const linked = resource.linkedCaseIds ?? [];
    if (!linked.includes(caseContext.caseId)) {
      return fail(
        'CASE_BINDING',
        'RECORD_NOT_LINKED_TO_CASE',
        'The record is not associated with this case. Associate it first, which is itself audited.',
        'CASE_BINDING',
      );
    }
  }
  return null;
}

export function incidentBindingGate(request: PolicyRequest): GateResult {
  const { subject, action, purpose, incidentContext } = request;
  const applies =
    INCIDENT_BOUND_PURPOSES.includes(purpose) &&
    !BINDING_EXEMPT_ACTIONS.has(action) &&
    CITIZEN_DATA_ACTIONS.has(action);
  if (!applies) return null;
  if (subject.actorType === 'CITIZEN') return null;

  if (!incidentContext) {
    return fail(
      'INCIDENT_BINDING',
      'INCIDENT_REFERENCE_REQUIRED',
      'Emergency access requires the incident the access is being made under.',
      'INCIDENT_BINDING',
    );
  }
  if (!ACTIVE_INCIDENT_STATUSES.includes(incidentContext.status)) {
    return fail(
      'INCIDENT_BINDING',
      'INCIDENT_NOT_ACTIVE',
      `Incident ${incidentContext.incidentNumber} is ${incidentContext.status.toLowerCase()} and authorises no further access.`,
      'INCIDENT_BINDING',
    );
  }
  const assigned =
    incidentContext.assignedUserIds.includes(subject.userId) ||
    (subject.agencyId !== null && incidentContext.assignedAgencyIds.includes(subject.agencyId));
  if (!assigned) {
    return fail(
      'INCIDENT_BINDING',
      'NOT_ASSIGNED_TO_INCIDENT',
      `Neither this account nor its agency is assigned to incident ${incidentContext.incidentNumber}.`,
      'INCIDENT_BINDING',
    );
  }
  return null;
}
