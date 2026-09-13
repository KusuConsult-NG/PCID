import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { ApiErrorBody, ErrorCode } from '@pcid/contracts';
import type { Request, Response } from 'express';

import { AppError } from './errors';
import { contextOf } from './correlation';
import { logger } from './logger';

/**
 * Turns every thrown error into the one documented error shape.
 *
 * An unexpected error never reaches the client as a stack trace or a database
 * message: it is logged with its correlation id and answered with a generic
 * INTERNAL_ERROR, because database text routinely contains column values.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const { correlationId } = contextOf(request);

    if (exception instanceof AppError) {
      logger.warn('request_denied', {
        correlationId,
        code: exception.code,
        path: request.path,
        method: request.method,
        internalReason: exception.context.internalReason,
      });
      response
        .status(exception.getStatus())
        .json(body(exception.code, exception.message, correlationId, exception.context.details));
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code: ErrorCode =
        status === HttpStatus.NOT_FOUND
          ? 'NOT_FOUND_OR_NOT_PERMITTED'
          : status === HttpStatus.UNAUTHORIZED
            ? 'UNAUTHENTICATED'
            : status === HttpStatus.FORBIDDEN
              ? 'ACCESS_DENIED'
              : status === HttpStatus.TOO_MANY_REQUESTS
                ? 'RATE_LIMITED'
                : status >= 500
                  ? 'INTERNAL_ERROR'
                  : 'VALIDATION_FAILED';
      logger.warn('request_rejected', { correlationId, status, path: request.path });
      response.status(status).json(body(code, genericMessage(code), correlationId));
      return;
    }

    logger.error('unhandled_error', {
      correlationId,
      path: request.path,
      method: request.method,
      message: exception instanceof Error ? exception.message : String(exception),
      stack: exception instanceof Error ? exception.stack : undefined,
    });
    response
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json(body('INTERNAL_ERROR', genericMessage('INTERNAL_ERROR'), correlationId));
  }
}

function genericMessage(code: ErrorCode): string {
  switch (code) {
    case 'UNAUTHENTICATED':
      return 'Authentication is required.';
    case 'ACCESS_DENIED':
      return 'This account is not authorised for that operation.';
    case 'NOT_FOUND_OR_NOT_PERMITTED':
      return 'The record does not exist or is not available to this account.';
    case 'RATE_LIMITED':
      return 'Too many requests. Try again shortly.';
    case 'VALIDATION_FAILED':
      return 'The request could not be accepted.';
    default:
      return 'The request could not be completed.';
  }
}

function body(
  code: ErrorCode,
  message: string,
  correlationId: string,
  details?: readonly { path: string; message: string }[],
): ApiErrorBody {
  return details && details.length > 0
    ? { error: { code, message, correlationId, details } }
    : { error: { code, message, correlationId } };
}
