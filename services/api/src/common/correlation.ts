import { randomUUID } from 'node:crypto';

import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export const CORRELATION_HEADER = 'x-correlation-id';

export interface RequestContext {
  correlationId: string;
  ipAddress: string | null;
  userAgent: string | null;
  deviceFingerprint: string | null;
  startedAt: number;
}

declare module 'express-serve-static-core' {
  interface Request {
    pcidContext?: RequestContext;
  }
}

const SAFE_CORRELATION = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Attaches a correlation id to every request and echoes it on every response.
 * The id appears in the audit record, the operator log and the client error body,
 * so a citizen complaint, a log line and an audit row can be tied together
 * without searching by personal data.
 */
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const supplied = request.header(CORRELATION_HEADER);
    const correlationId =
      supplied !== undefined && SAFE_CORRELATION.test(supplied) ? supplied : randomUUID();
    request.pcidContext = {
      correlationId,
      ipAddress: extractIp(request),
      userAgent: request.header('user-agent') ?? null,
      deviceFingerprint: request.header('x-device-id') ?? null,
      startedAt: Date.now(),
    };
    response.setHeader(CORRELATION_HEADER, correlationId);
    next();
  }
}

function extractIp(request: Request): string | null {
  // `trust proxy` is configured at bootstrap, so request.ip already reflects the
  // gateway's X-Forwarded-For when the platform runs behind one.
  const ip = request.ip ?? request.socket.remoteAddress ?? null;
  if (ip === null) return null;
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

export function contextOf(request: Request): RequestContext {
  return (
    request.pcidContext ?? {
      correlationId: randomUUID(),
      ipAddress: null,
      userAgent: null,
      deviceFingerprint: null,
      startedAt: Date.now(),
    }
  );
}
