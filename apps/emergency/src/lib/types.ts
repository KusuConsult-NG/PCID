/** The shapes the emergency response portal reads from the platform. */

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

export interface IncidentSummary {
  readonly id: string;
  readonly incidentNumber: string;
  readonly type: string;
  readonly severity: string;
  readonly status: string;
  readonly description: string;
  readonly address: string | null;
  readonly lgaCode: string | null;
  readonly wardCode: string | null;
  readonly location: {
    readonly latitude: number | null;
    readonly longitude: number | null;
    readonly source: string | null;
  } | null;
  readonly reportedAt: string;
  readonly firstDispatchedAt: string | null;
  readonly firstArrivalAt: string | null;
  readonly resolvedAt: string | null;
  readonly responseTimes: {
    readonly callToDispatchSeconds: number | null;
    readonly dispatchToArrivalSeconds: number | null;
    readonly totalResponseSeconds: number | null;
    readonly resolutionSeconds: number | null;
  };
}

export interface IncidentFile extends IncidentSummary {
  readonly timeline: readonly {
    readonly occurredAt: string;
    readonly type: string;
    readonly summary: string;
    readonly detail: unknown;
  }[];
  readonly responseUnits: readonly {
    readonly dispatchId: string;
    readonly unitCode: string;
    readonly type: string;
    readonly status: string;
    readonly dispatchedAt: string;
    readonly arrivedAt: string | null;
  }[];
  readonly assignedOfficers: readonly { readonly name: string; readonly role: string }[];
}

export interface ResponseUnit {
  readonly unitCode: string;
  readonly agencyId: string;
  readonly type: string;
  readonly status: string;
  readonly homeLgaCode: string | null;
  readonly homeWardCode: string | null;
  readonly capabilities: readonly string[];
  readonly contactPhone: string | null;
  readonly position: {
    readonly latitude: number;
    readonly longitude: number;
    readonly reportedAt: string | null;
    readonly source: string;
  } | null;
  readonly distanceMetres: number | null;
}

/** The Minimum Necessary Emergency Profile, and what was withheld from it. */
export interface EmergencyProfile {
  readonly data: Record<string, unknown>;
  readonly restrictedFields: readonly string[];
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
  readonly foundAt: string;
  readonly restrictedFields: readonly string[];
}

/** A point on the command picture, and how its coordinate was obtained. */
export interface Pin {
  readonly latitude: number;
  readonly longitude: number;
  readonly source: string | null;
  readonly reportedAt?: string | null;
}

export interface SituationView {
  readonly extent: {
    readonly north: number;
    readonly south: number;
    readonly east: number;
    readonly west: number;
  } | null;
  readonly incidents: readonly {
    readonly incidentNumber: string;
    readonly type: string;
    readonly severity: string;
    readonly status: string;
    readonly description: string;
    readonly address: string | null;
    readonly lgaCode: string | null;
    readonly position: Pin;
    readonly reportedAt: string;
    readonly unitsSent: number;
    readonly awaitingDispatch: boolean;
  }[];
  readonly units: readonly {
    readonly unitCode: string;
    readonly type: string;
    readonly status: string;
    readonly homeLgaCode: string | null;
    readonly position: Pin;
  }[];
  /** Live incidents with no coordinate. A map must not invent one for them. */
  readonly withoutPosition: readonly {
    readonly incidentNumber: string;
    readonly severity: string;
    readonly status: string;
    readonly description: string;
    readonly address: string | null;
    readonly lgaCode: string | null;
    readonly reportedAt: string;
    readonly reason: string;
  }[];
  readonly layers: readonly string[];
}
