import { ROLE_DEFINITIONS, STATEWIDE_JURISDICTION } from '@pcid/contracts';
import type { Action, Classification, Jurisdiction, Purpose, ResourceType } from '@pcid/contracts';

import type {
  AccessApproval,
  BreakGlassGrant,
  CaseContext,
  IncidentContext,
  PolicyRequest,
  PolicyResource,
  PolicySubject,
} from '../src/types';

export const NOW = new Date('2026-03-04T10:00:00.000Z');

export function actionsForRoles(...roles: string[]): readonly Action[] {
  const actions = new Set<Action>();
  for (const role of roles) {
    const definition = ROLE_DEFINITIONS.find((candidate) => candidate.name === role);
    if (!definition) throw new Error(`Unknown role in fixture: ${role}`);
    for (const action of definition.actions) actions.add(action);
  }
  return [...actions];
}

export interface SubjectOverrides {
  userId?: string;
  actorType?: PolicySubject['actorType'];
  accountStatus?: PolicySubject['accountStatus'];
  agencyId?: string | null;
  agencyCategory?: PolicySubject['agencyCategory'];
  agencyStatus?: PolicySubject['agencyStatus'];
  dataSharingAgreement?: PolicySubject['dataSharingAgreement'];
  agencyMaxClassification?: Classification;
  compartments?: readonly Classification[];
  roles?: readonly string[];
  actions?: readonly Action[];
  clearance?: Classification;
  jurisdiction?: Jurisdiction;
  authenticationLevel?: PolicySubject['authenticationLevel'];
  mfaEnrolled?: boolean;
  accessWindow?: PolicySubject['accessWindow'];
  subjectPcid?: string | null;
}

export function subject(roles: string[], overrides: SubjectOverrides = {}): PolicySubject {
  return {
    userId: overrides.userId ?? 'usr-001',
    actorType: overrides.actorType ?? 'GOVERNMENT_USER',
    accountStatus: overrides.accountStatus ?? 'ACTIVE',
    agencyId: overrides.agencyId !== undefined ? overrides.agencyId : 'agy-police',
    agencyCategory: overrides.agencyCategory ?? 'SECURITY',
    agencyStatus: overrides.agencyStatus ?? 'ACTIVE',
    dataSharingAgreement: overrides.dataSharingAgreement ?? 'SIGNED',
    agencyMaxClassification: overrides.agencyMaxClassification ?? 'LAW_ENFORCEMENT_RESTRICTED',
    compartments: overrides.compartments ?? ['LAW_ENFORCEMENT_RESTRICTED'],
    roles: overrides.roles ?? roles,
    actions: overrides.actions ?? actionsForRoles(...roles),
    clearance: overrides.clearance ?? 'LAW_ENFORCEMENT_RESTRICTED',
    jurisdiction: overrides.jurisdiction ?? STATEWIDE_JURISDICTION,
    authenticationLevel: overrides.authenticationLevel ?? 'AAL2',
    mfaEnrolled: overrides.mfaEnrolled ?? true,
    accessWindow: overrides.accessWindow ?? null,
    subjectPcid: overrides.subjectPcid ?? null,
  };
}

export function resource(
  type: ResourceType,
  overrides: Partial<PolicyResource> = {},
): PolicyResource {
  return {
    type,
    id: overrides.id !== undefined ? overrides.id : 'res-001',
    classification: overrides.classification ?? 'CONFIDENTIAL',
    ownerAgencyId: overrides.ownerAgencyId ?? null,
    lgaCode: overrides.lgaCode !== undefined ? overrides.lgaCode : 'PL-JNO',
    wardCode: overrides.wardCode !== undefined ? overrides.wardCode : 'PL-JNO-01',
    subjectPcid: overrides.subjectPcid !== undefined ? overrides.subjectPcid : 'PL-4K7T9-QM2XB-7H',
    linkedCaseIds: overrides.linkedCaseIds ?? [],
    linkedIncidentIds: overrides.linkedIncidentIds ?? [],
    ...(overrides.requestedFields !== undefined
      ? { requestedFields: overrides.requestedFields }
      : {}),
  };
}

export function caseContext(overrides: Partial<CaseContext> = {}): CaseContext {
  return {
    caseId: overrides.caseId ?? 'case-001',
    caseNumber: overrides.caseNumber ?? 'CASE-2026-00928',
    caseType: overrides.caseType ?? 'CRIMINAL_INVESTIGATION',
    status: overrides.status ?? 'ACTIVE',
    classification: overrides.classification ?? 'LAW_ENFORCEMENT_RESTRICTED',
    agencyId: overrides.agencyId ?? 'agy-police',
    assignedUserIds: overrides.assignedUserIds ?? ['usr-001'],
    supervisorUserIds: overrides.supervisorUserIds ?? ['usr-sup'],
  };
}

export function incidentContext(overrides: Partial<IncidentContext> = {}): IncidentContext {
  return {
    incidentId: overrides.incidentId ?? 'inc-001',
    incidentNumber: overrides.incidentNumber ?? 'INC-2026-000123',
    status: overrides.status ?? 'DISPATCHED',
    assignedAgencyIds: overrides.assignedAgencyIds ?? ['agy-police'],
    assignedUserIds: overrides.assignedUserIds ?? ['usr-001'],
    lgaCode: overrides.lgaCode ?? 'PL-JNO',
    wardCode: overrides.wardCode ?? 'PL-JNO-01',
  };
}

export function breakGlass(overrides: Partial<BreakGlassGrant> = {}): BreakGlassGrant {
  return {
    grantId: overrides.grantId ?? 'bg-001',
    userId: overrides.userId ?? 'usr-001',
    status: overrides.status ?? 'ACTIVE',
    expiresAt: overrides.expiresAt ?? new Date(NOW.getTime() + 15 * 60 * 1000),
    resourceType: overrides.resourceType ?? 'CITIZEN',
    subjectPcid: overrides.subjectPcid !== undefined ? overrides.subjectPcid : 'PL-4K7T9-QM2XB-7H',
    incidentId: overrides.incidentId ?? 'inc-001',
    caseId: overrides.caseId ?? null,
    gates: overrides.gates ?? [
      'INCIDENT_BINDING',
      'CASE_BINDING',
      'JURISDICTION',
      'FIELD_APPROVAL',
    ],
  };
}

export function approval(overrides: Partial<AccessApproval> = {}): AccessApproval {
  return {
    accessRequestId: overrides.accessRequestId ?? 'ar-001',
    userId: overrides.userId ?? 'usr-001',
    status: 'APPROVED',
    expiresAt: overrides.expiresAt ?? new Date(NOW.getTime() + 60 * 60 * 1000),
    resourceType: overrides.resourceType ?? 'CITIZEN',
    subjectPcid: overrides.subjectPcid !== undefined ? overrides.subjectPcid : 'PL-4K7T9-QM2XB-7H',
    caseId: overrides.caseId ?? 'case-001',
    purpose: overrides.purpose ?? 'CRIMINAL_INVESTIGATION',
    approvedFields: overrides.approvedFields ?? [],
  };
}

export function request(
  overrides: Partial<PolicyRequest> & {
    subject: PolicySubject;
    action: Action;
    purpose: Purpose;
    resource: PolicyResource;
  },
): PolicyRequest {
  return {
    now: NOW,
    caseContext: null,
    incidentContext: null,
    breakGlass: null,
    approvals: [],
    ...overrides,
  };
}
