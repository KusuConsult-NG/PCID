/** The shapes the security portal reads from the platform. */

export interface Me {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
  readonly agency: {
    readonly id: string | null;
    readonly code: string | null;
    readonly name: string | null;
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

export interface CaseSummary {
  readonly id: string;
  readonly caseNumber: string;
  readonly type: string;
  readonly title: string;
  readonly summary: string | null;
  readonly status: string;
  readonly classification: string;
  readonly lgaCode: string | null;
  readonly wardCode: string | null;
  readonly openedAt: string;
  readonly closedAt: string | null;
}

export interface CaseFile extends CaseSummary {
  readonly subjects: readonly {
    readonly type: string;
    readonly id: string;
    readonly role: string;
    readonly linkedAt: string;
    readonly justification: string;
  }[];
  readonly assignedOfficers: readonly {
    readonly name: string;
    readonly role: string;
    readonly assignedAt: string;
  }[];
  readonly notes: readonly {
    readonly body: string;
    readonly author: string | null;
    readonly createdAt: string;
  }[];
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

export interface MissingPerson {
  readonly id: string;
  readonly caseReference: string;
  readonly status: string;
  readonly fullName?: string;
  readonly ageYears?: number | null;
  readonly sex?: string | null;
  readonly citizenPcid?: string | null;
  readonly physicalDescription?: string | null;
  readonly clothingDescription?: string | null;
  readonly distinguishingFeatures?: string | null;
  readonly circumstances?: string | null;
  readonly lastSeen?: {
    readonly address: string | null;
    readonly lgaCode: string | null;
    readonly wardCode: string | null;
    readonly at: string | null;
  };
  readonly reporter?: {
    readonly name: string | null;
    readonly phone: string | null;
    readonly relationship: string | null;
  };
  readonly resolution?: { readonly resolvedAt: string | null; readonly note: string | null };
  readonly createdAt: string;
  readonly restrictedFields: readonly string[];
}

export interface Sighting {
  readonly id: string;
  readonly reportedAt: string;
  readonly description: string;
  readonly address: string | null;
  readonly verificationStatus: string;
}

export interface CandidateMatch {
  readonly id: string;
  readonly score: number;
  readonly factors: readonly { field?: string; weight?: number; note?: string }[];
  readonly status: string;
  readonly engineVersion?: string;
  readonly unidentifiedPersonReference?: string | null;
  readonly candidateCitizenPcid?: string | null;
  readonly missingPersonReference?: string;
  readonly missingPersonName?: string;
  readonly note?: string;
}

export interface MissingPersonFile extends MissingPerson {
  readonly sightings: readonly Sighting[];
  readonly candidateMatches: readonly CandidateMatch[];
}

export interface UnidentifiedPerson {
  readonly id: string;
  readonly reference: string;
  readonly status: string;
  readonly condition?: string;
  readonly estimatedAgeRange?: { readonly min: number | null; readonly max: number | null } | null;
  readonly apparentSex?: string | null;
  readonly physicalDescription?: string | null;
  readonly clothingDescription?: string | null;
  readonly distinguishingFeatures?: string | null;
  readonly identityClues?: string | null;
  readonly found?: {
    readonly address: string | null;
    readonly lgaCode: string | null;
    readonly wardCode: string | null;
    readonly at: string;
  };
  readonly biometricCustody?: {
    readonly reference: string;
    readonly custodianAgencyId: string | null;
  } | null;
  readonly identifiedPcid?: string | null;
  readonly foundAt: string;
  readonly restrictedFields: readonly string[];
}

export interface UnidentifiedPersonFile extends UnidentifiedPerson {
  readonly candidateMatches: readonly CandidateMatch[];
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

export interface BreakGlassGrant {
  readonly reference: string;
  readonly officer: string | null;
  readonly incidentNumber: string | null;
  readonly reason: string;
  readonly gates: readonly string[];
  readonly grantedAt: string;
  readonly expiresAt: string;
  readonly reviewDueAt: string;
  readonly accessCount: number;
  readonly status: string;
}
