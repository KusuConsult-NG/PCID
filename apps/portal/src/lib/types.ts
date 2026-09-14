/** Shapes the portal reads back from the platform. */

export interface Card {
  readonly key: string;
  readonly title: string;
  readonly status: 'RELEASED' | 'RESTRICTED';
  readonly items?: readonly Record<string, unknown>[];
  readonly restrictedFields?: readonly string[];
  readonly reason?: string;
}

export interface CitizenRecord {
  readonly pcid: string;
  readonly cards: readonly Card[];
  readonly generatedAt: string;
}

export interface EmergencyContact {
  readonly id: string;
  readonly fullName: string;
  readonly relationship: string;
  readonly phonePrimary: string;
  readonly phoneSecondary: string | null;
  readonly priority: number;
  readonly verificationStatus: string;
  readonly lastChangedBy: string;
}

export interface AccessHistory {
  readonly total: number;
  readonly note: string;
  readonly accesses: readonly {
    readonly occurredAt: string;
    readonly agency: string | null;
    readonly purpose: string | null;
    readonly action: string;
    readonly reference: string;
  }[];
}

export interface Credential {
  readonly serial: string;
  readonly format: string;
  readonly status: string;
  readonly issuedAt: string;
  readonly expiresAt: string | null;
  readonly usable: boolean;
  readonly verificationUrl: string;
  readonly verificationTokenExpiresAt: string;
}

export interface VerificationHistory {
  readonly total: number;
  readonly verifications: readonly {
    readonly occurredAt: string;
    readonly agency: string | null;
    readonly outcome: string;
    readonly method: string;
  }[];
}

export interface CorrectionRequest {
  readonly reference: string;
  readonly fieldPath: string;
  readonly requestedValue: string;
  readonly status: string;
  readonly submittedAt: string;
  readonly reviewNote: string | null;
}

export interface NotificationInbox {
  readonly total: number;
  readonly unread: number;
  readonly notifications: readonly {
    readonly id: string;
    readonly subject: string | null;
    readonly body: string;
    readonly receivedAt: string;
    readonly read: boolean;
    readonly incidentNumber: string | null;
  }[];
}

export interface PortalSessionRow {
  readonly id: string;
  readonly current: boolean;
  readonly signedInAt: string;
  readonly expiresAt: string;
  readonly ipAddress: string | null;
  readonly device: string;
}

export interface Me {
  readonly id: string;
  readonly displayName: string;
  readonly actorType: string;
  readonly mfaEnrolled: boolean;
  readonly subjectPcid: string | null;
  readonly actions: readonly string[];
}
