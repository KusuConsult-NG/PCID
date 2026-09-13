import { HttpException, HttpStatus } from '@nestjs/common';
import type { ErrorCode } from '@pcid/contracts';

const STATUS_BY_CODE: Readonly<Record<ErrorCode, HttpStatus>> = Object.freeze({
  VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
  UNAUTHENTICATED: HttpStatus.UNAUTHORIZED,
  MFA_REQUIRED: HttpStatus.UNAUTHORIZED,
  STEP_UP_REQUIRED: HttpStatus.FORBIDDEN,
  ACCESS_DENIED: HttpStatus.FORBIDDEN,
  NOT_FOUND_OR_NOT_PERMITTED: HttpStatus.NOT_FOUND,
  CONFLICT: HttpStatus.CONFLICT,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  ACCOUNT_LOCKED: HttpStatus.LOCKED,
  PURPOSE_REQUIRED: HttpStatus.BAD_REQUEST,
  CASE_REFERENCE_REQUIRED: HttpStatus.FORBIDDEN,
  INCIDENT_REFERENCE_REQUIRED: HttpStatus.FORBIDDEN,
  APPROVAL_REQUIRED: HttpStatus.FORBIDDEN,
  INTEGRATION_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  INTERNAL_ERROR: HttpStatus.INTERNAL_SERVER_ERROR,
});

export interface AppErrorDetail {
  readonly path: string;
  readonly message: string;
}

/**
 * The single error type crossing the HTTP boundary.
 *
 * `message` is what the requester is told. `internalReason` is what goes to the
 * audit record and the operator log and is never serialised to the client - so a
 * denial can be precise for oversight without becoming an oracle for probing the
 * registry.
 */
export class AppError extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly context: {
      readonly details?: readonly AppErrorDetail[];
      readonly internalReason?: string;
      readonly cause?: unknown;
    } = {},
  ) {
    super(message, STATUS_BY_CODE[code]);
    this.name = 'AppError';
  }

  static validation(message: string, details: readonly AppErrorDetail[] = []): AppError {
    return new AppError('VALIDATION_FAILED', message, { details });
  }

  /**
   * Used for every unauthorised read of a record that may or may not exist.
   * Deliberately identical whether the record is missing or merely off limits.
   */
  static notFoundOrNotPermitted(internalReason: string): AppError {
    return new AppError(
      'NOT_FOUND_OR_NOT_PERMITTED',
      'The record does not exist or is not available to this account.',
      { internalReason },
    );
  }

  static denied(message: string, internalReason: string): AppError {
    return new AppError('ACCESS_DENIED', message, { internalReason });
  }

  static conflict(message: string): AppError {
    return new AppError('CONFLICT', message);
  }
}
