/**
 * Stable machine-readable error codes.
 *
 * Denials deliberately do not leak whether the underlying record exists: an
 * unauthorised citizen lookup and a lookup for a non-existent PCID both return
 * `NOT_FOUND_OR_NOT_PERMITTED` at the HTTP boundary, while the audit record
 * retains the precise reason for oversight.
 */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'MFA_REQUIRED',
  'STEP_UP_REQUIRED',
  'ACCESS_DENIED',
  'NOT_FOUND_OR_NOT_PERMITTED',
  'CONFLICT',
  'RATE_LIMITED',
  'ACCOUNT_LOCKED',
  'PURPOSE_REQUIRED',
  'CASE_REFERENCE_REQUIRED',
  'INCIDENT_REFERENCE_REQUIRED',
  'APPROVAL_REQUIRED',
  'INTEGRATION_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  readonly error: {
    readonly code: ErrorCode;
    /** Human-readable message safe to show to the requesting user. */
    readonly message: string;
    /** Correlation id, present on every response, for support and audit lookup. */
    readonly correlationId: string;
    /** Field-level validation detail; never present on authorisation denials. */
    readonly details?: readonly { readonly path: string; readonly message: string }[];
  };
}
