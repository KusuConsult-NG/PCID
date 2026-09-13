/** Integration framework vocabulary (master system prompt §54, §55, §78). */

export const DATA_DOMAINS = [
  'REVENUE',
  'LANDS',
  'PROPERTY',
  'TRANSPORT',
  'VEHICLES',
  'BUSINESS',
  'EDUCATION',
  'HEALTH',
  'SOCIAL_SERVICES',
  'EMERGENCY_SERVICES',
  'SECURITY',
  'LOCAL_GOVERNMENT',
] as const;
export type DataDomain = (typeof DATA_DOMAINS)[number];

export const ADAPTER_MODES = ['PRODUCTION', 'SANDBOX', 'DISABLED'] as const;
export type AdapterMode = (typeof ADAPTER_MODES)[number];

export const SYNC_JOB_STATUSES = [
  'SCHEDULED',
  'RUNNING',
  'SUCCEEDED',
  'PARTIAL',
  'FAILED',
  'CANCELLED',
] as const;
export type SyncJobStatus = (typeof SYNC_JOB_STATUSES)[number];

export const DATA_CONFLICT_STATUSES = [
  'OPEN',
  'UNDER_REVIEW',
  'RESOLVED_SOURCE_WINS',
  'RESOLVED_PLATFORM_CORRECTED',
  'RESOLVED_NO_ACTION',
] as const;
export type DataConflictStatus = (typeof DATA_CONFLICT_STATUSES)[number];

/**
 * Provenance every externally-sourced record must carry (master system prompt §55).
 * The platform links records; it never becomes the authority for data another
 * agency owns.
 */
export interface SourceProvenance {
  readonly sourceAgencyId: string;
  readonly sourceSystem: string;
  readonly sourceRecordId: string;
  readonly sourceUpdatedAt: string | null;
  readonly lastSyncedAt: string;
  readonly verificationStatus: 'UNVERIFIED' | 'SOURCE_CONFIRMED' | 'STALE' | 'CONFLICTED';
}

export const IMPORT_JOB_STATUSES = [
  'UPLOADED',
  'VALIDATING',
  'VALIDATION_FAILED',
  'PREVIEW_READY',
  'AWAITING_APPROVAL',
  'IMPORTING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;
export type ImportJobStatus = (typeof IMPORT_JOB_STATUSES)[number];
