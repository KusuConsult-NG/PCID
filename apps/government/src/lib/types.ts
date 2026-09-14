/** The shapes this portal reads from the platform. */

export interface Me {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
  readonly actorType: string;
  readonly agency: {
    readonly id: string | null;
    readonly code: string | null;
    readonly name: string | null;
    readonly category: string | null;
    readonly status: string | null;
    readonly dataSharingAgreement: string | null;
  };
  readonly roles: readonly string[];
  readonly actions: readonly string[];
  readonly clearance: string;
  readonly compartments: readonly string[];
  readonly jurisdiction: { readonly scope: string; readonly lgaCodes: readonly string[] };
  readonly authenticationLevel: string;
  readonly mfaEnrolled: boolean;
}

export interface SearchResult {
  readonly total: number;
  readonly results: readonly {
    readonly data: Record<string, unknown>;
    readonly restrictedFields: readonly string[];
  }[];
}

export type Card =
  | {
      readonly key: string;
      readonly title: string;
      readonly status: 'RELEASED';
      readonly items?: readonly Record<string, unknown>[];
      readonly restrictedFields?: readonly string[];
    }
  | {
      readonly key: string;
      readonly title: string;
      readonly status: 'RESTRICTED';
      readonly reason?: string;
    };

export interface CitizenRecord {
  readonly pcid: string;
  readonly cards: readonly Card[];
}

export interface DuplicateCandidate {
  readonly id: string;
  readonly score: number;
  readonly status: string;
  readonly raisedAt: string;
  readonly reviewedAt: string | null;
  readonly reviewNote: string | null;
  readonly matchedAttributes: readonly { field?: string; weight?: number; note?: string }[];
  readonly registrationReference: string | null;
  readonly existingPerson: Record<string, unknown>;
  readonly applicant: Record<string, unknown>;
  readonly restrictedFields: readonly string[];
}

export interface CorrectionRequest {
  readonly reference: string;
  readonly subjectPcid: string;
  readonly subjectName: string;
  readonly raisedBy: string;
  readonly fieldPath: string;
  readonly currentValue: string | null;
  readonly requestedValue: string;
  readonly justification: string;
  readonly evidenceReference: string | null;
  readonly status: string;
  readonly submittedAt: string;
  readonly reviewedAt: string | null;
  readonly reviewedBy: string | null;
  readonly reviewNote: string | null;
  readonly appliedAt: string | null;
  readonly applicable: boolean;
}

export interface Alert {
  readonly reference: string;
  readonly ruleKey: string;
  readonly category: string;
  readonly severity: string;
  readonly title: string;
  readonly summary: string;
  readonly explanation: Record<string, unknown>;
  readonly confidence: number | null;
  readonly subjectType: string | null;
  readonly subjectPcid: string | null;
  readonly agency: string | null;
  readonly status: string;
  readonly raisedAt: string;
  readonly reviewedAt: string | null;
  readonly reviewedBy: string | null;
  readonly reviewNote: string | null;
}

export interface AuditEvent {
  readonly seq: number;
  readonly id: string;
  readonly occurredAt: string;
  readonly action: string;
  readonly outcome: string;
  readonly actor: {
    readonly type: string;
    readonly id: string | null;
    readonly displayName: string | null;
    readonly agencyCode: string | null;
  };
  readonly purpose: string | null;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly subjectPcid: string | null;
  readonly caseNumber: string | null;
  readonly incidentNumber: string | null;
  readonly fieldsReleased: readonly string[];
  readonly decisionReasons: readonly { gate: string; code: string; message: string }[];
  readonly breakGlassUsed: boolean;
  readonly citizenVisibility: string;
  readonly restrictionBasis: string | null;
  readonly correlationId: string;
  readonly detail: Record<string, unknown>;
}

export interface AuditSearch {
  readonly total: number;
  readonly events: readonly AuditEvent[];
}

export interface ChainVerification {
  readonly intact: boolean;
  readonly problems: readonly unknown[];
  readonly checkedAt: string;
}

export interface AccessRequest {
  readonly reference: string;
  readonly purpose: string;
  readonly resourceType: string;
  readonly subjectPcid: string | null;
  readonly requestedFields: readonly string[];
  readonly approvedFields: readonly string[] | null;
  readonly justification: string;
  readonly status: string;
  readonly caseNumber: string | null;
  readonly requestedBy: string | null;
  readonly createdAt: string;
  readonly expiresAt: string | null;
}

export interface Agency {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly category: string;
  readonly status: string;
  readonly maxClassification: string;
  readonly dataSharingAgreement: string;
  readonly apiIntegrationStatus: string;
  readonly jurisdictionScope: string;
  readonly compartments: readonly string[];
}

export interface GovernmentUser {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly status: string;
  readonly clearance: string;
  readonly authenticatorConfirmed: boolean;
  readonly jurisdictionScope: string;
  readonly agencyCode: string;
  readonly agency: string;
  readonly roles: readonly string[];
  readonly lastSignedInAt: string | null;
  readonly createdAt: string;
}

export interface DataSource {
  readonly id: string;
  readonly agencyCode: string | null;
  readonly domain: string;
  readonly systemName: string;
  readonly mode: string;
  readonly lastHealthyAt: string | null;
  readonly lastError: string | null;
  readonly lastSync: { readonly status: string | null; readonly finishedAt: string | null };
}

/**
 * The delivery queue, as an operator sees it.
 *
 * No bodies, no subjects and no recipients — the API does not return them, and
 * this type exists partly to say so in a place somebody will read before adding
 * a column.
 */
export interface NotificationQueue {
  readonly counts: readonly { channel: string; status: string; count: number }[];
  readonly oldestWaitingAt: string | null;
  readonly abandoned: readonly {
    readonly id: string;
    readonly channel: string;
    readonly template: string;
    readonly attempts: number;
    readonly lastError: string | null;
    readonly queuedAt: string;
  }[];
  readonly failuresLast24Hours: readonly {
    readonly channel: string;
    readonly detail: string | null;
    readonly count: number;
  }[];
}

/**
 * The retention schedule, as the Data Protection Officer reads it.
 *
 * `basis` is on the wire deliberately. A page that shows periods without the
 * reasons behind them invites somebody to shorten one because it looks long, or
 * to leave one alone because nobody remembers why it is what it is.
 */
export interface RetentionPolicyView {
  readonly key: string;
  readonly holds: string;
  readonly disposition: 'DELETE' | 'REDACT' | 'KEEP';
  readonly retainDays: number | null;
  readonly basis: string;
  readonly redacts: readonly string[];
  readonly table: string | null;
  readonly measuredFrom: string | null;
  readonly due?: number;
  readonly dueIsAtLeast?: boolean;
  readonly cutoff?: string;
}

export interface RetentionErasureView {
  readonly policy: string;
  readonly holds: string | null;
  readonly disposition: string;
  readonly table: string;
  readonly cutoff: string;
  readonly rowsAffected: number;
  readonly capped: boolean;
}

export interface RetentionRunView {
  readonly reference: string;
  readonly trigger: string;
  readonly orderedBy: string | null;
  readonly dryRun: boolean;
  readonly status: string;
  readonly rowsAffected: number;
  readonly moreRemaining: boolean;
  readonly error: string | null;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly erasures: readonly RetentionErasureView[];
}

export interface RetentionSchedule {
  readonly policies: readonly RetentionPolicyView[];
  readonly lastRun: RetentionRunView | null;
}
