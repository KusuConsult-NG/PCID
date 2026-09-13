import type {
  Action,
  AgencyCategory,
  AgencyStatus,
  AuditActorType,
  AuditCitizenVisibility,
  BreakGlassSatisfiableGate,
  BreakGlassStatus,
  CaseStatus,
  CaseType,
  Classification,
  DataSharingAgreementStatus,
  IncidentStatus,
  Jurisdiction,
  Purpose,
  ResourceType,
} from '@pcid/contracts';

/** Authentication assurance level of the presented session (§42, §43). */
export type AuthenticationLevel = 'AAL1' | 'AAL2';

export type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'LOCKED' | 'DISABLED';

/**
 * A weekly access window, expressed in the state's civil time. Used to express
 * "this account may only operate during its shift" restrictions (§3).
 */
export interface AccessWindow {
  /** ISO weekday numbers, 1 = Monday .. 7 = Sunday. */
  readonly daysOfWeek: readonly number[];
  /** Inclusive start hour, 0-23, in the configured timezone. */
  readonly startHour: number;
  /** Exclusive end hour, 1-24, in the configured timezone. */
  readonly endHour: number;
  /** IANA timezone the window is expressed in. */
  readonly timezone: string;
}

/**
 * Everything the engine is allowed to know about who is asking. Assembled by the
 * API from the session, the user record and the agency registry - the engine
 * itself performs no I/O, which is what makes it exhaustively testable.
 */
export interface PolicySubject {
  readonly userId: string;
  readonly actorType: AuditActorType;
  readonly accountStatus: AccountStatus;

  readonly agencyId: string | null;
  readonly agencyCategory: AgencyCategory | null;
  readonly agencyStatus: AgencyStatus | null;
  readonly dataSharingAgreement: DataSharingAgreementStatus | null;
  /** Highest classification the *agency* is approved to receive. */
  readonly agencyMaxClassification: Classification;
  /** Compartments the agency holds, e.g. LAW_ENFORCEMENT_RESTRICTED. */
  readonly compartments: readonly Classification[];

  readonly roles: readonly string[];
  /** Actions resolved from the subject's roles. The engine reads only this. */
  readonly actions: readonly Action[];
  /** Highest classification the *individual* is cleared for. */
  readonly clearance: Classification;
  readonly jurisdiction: Jurisdiction;

  readonly authenticationLevel: AuthenticationLevel;
  readonly mfaEnrolled: boolean;
  readonly accessWindow?: AccessWindow | null;

  /** For a citizen actor, the PCID of the record they own. */
  readonly subjectPcid?: string | null;
}

/** The thing being asked about. */
export interface PolicyResource {
  readonly type: ResourceType;
  readonly id: string | null;
  /** Classification of the record as a whole. Field classifications refine this. */
  readonly classification: Classification;
  /** Agency that is authoritative for this record (§28). */
  readonly ownerAgencyId?: string | null;
  readonly lgaCode?: string | null;
  readonly wardCode?: string | null;
  /** PCID of the citizen this record is about, when it is about one. */
  readonly subjectPcid?: string | null;
  readonly linkedCaseIds?: readonly string[];
  readonly linkedIncidentIds?: readonly string[];
  /**
   * Fields the caller wants. When omitted the engine returns every field the
   * subject is entitled to for this action and purpose.
   */
  readonly requestedFields?: readonly string[];
}

export interface CaseContext {
  readonly caseId: string;
  readonly caseNumber: string;
  readonly caseType: CaseType;
  readonly status: CaseStatus;
  readonly classification: Classification;
  readonly agencyId: string;
  readonly assignedUserIds: readonly string[];
  readonly supervisorUserIds: readonly string[];
}

export interface IncidentContext {
  readonly incidentId: string;
  readonly incidentNumber: string;
  readonly status: IncidentStatus;
  readonly assignedAgencyIds: readonly string[];
  readonly assignedUserIds: readonly string[];
  readonly lgaCode: string | null;
  readonly wardCode: string | null;
}

export interface BreakGlassGrant {
  readonly grantId: string;
  readonly userId: string;
  readonly status: BreakGlassStatus;
  readonly expiresAt: Date;
  readonly resourceType: ResourceType;
  /** Scope of the grant. A grant for one person never opens another's record. */
  readonly subjectPcid?: string | null;
  readonly incidentId?: string | null;
  readonly caseId?: string | null;
  readonly gates: readonly BreakGlassSatisfiableGate[];
}

export interface AccessApproval {
  readonly accessRequestId: string;
  readonly userId: string;
  readonly status: 'APPROVED';
  readonly expiresAt: Date;
  readonly resourceType: ResourceType;
  readonly subjectPcid?: string | null;
  readonly caseId?: string | null;
  readonly purpose: Purpose;
  readonly approvedFields: readonly string[];
}

export interface PolicyRequest {
  readonly subject: PolicySubject;
  readonly action: Action;
  readonly purpose: Purpose;
  readonly resource: PolicyResource;
  readonly caseContext?: CaseContext | null;
  readonly incidentContext?: IncidentContext | null;
  readonly breakGlass?: BreakGlassGrant | null;
  readonly approvals?: readonly AccessApproval[];
  readonly now: Date;
}

export const GATES = [
  'ACCOUNT_STANDING',
  'AGENCY_STANDING',
  'DATA_SHARING_AGREEMENT',
  'AUTHENTICATION',
  'STEP_UP',
  'RBAC',
  'RESOURCE_TYPE',
  'ACCESS_WINDOW',
  'SEPARATION_OF_DUTY',
  'SELF_SERVICE_SCOPE',
  'PURPOSE',
  'CLASSIFICATION_RANK',
  'COMPARTMENT',
  'JURISDICTION',
  'CASE_BINDING',
  'INCIDENT_BINDING',
  'FIELD_RELEASE',
] as const;
export type GateId = (typeof GATES)[number];

export interface PolicyReason {
  readonly gate: GateId;
  readonly code: string;
  /** Operator-facing explanation. Safe to log; never contains citizen data. */
  readonly message: string;
}

export type Obligation =
  | { readonly kind: 'AUDIT' }
  | { readonly kind: 'NOTIFY_SUPERVISOR'; readonly reason: string }
  | { readonly kind: 'POST_EVENT_REVIEW'; readonly dueWithinSeconds: number }
  | { readonly kind: 'RESTRICT_FROM_CITIZEN'; readonly legalBasis: string }
  | { readonly kind: 'MINIMUM_NECESSARY_PROFILE' }
  | { readonly kind: 'RATE_LIMIT_SENSITIVE' };

export interface WithheldField {
  readonly field: string;
  readonly gate: GateId;
  readonly code: string;
}

export interface PolicyDecision {
  readonly effect: 'PERMIT' | 'DENY';
  readonly reasons: readonly PolicyReason[];
  /** Fields the caller may return. Never widen this downstream. */
  readonly allowedFields: readonly string[];
  /** Fields deliberately withheld, with the gate that withheld them (§29). */
  readonly withheldFields: readonly WithheldField[];
  readonly obligations: readonly Obligation[];
  readonly citizenVisibility: AuditCitizenVisibility;
  readonly breakGlassUsed: boolean;
  readonly approvalsUsed: readonly string[];
  /** How long a caller may cache this decision, in seconds. */
  readonly ttlSeconds: number;
}
