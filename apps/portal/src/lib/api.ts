import { randomUUID } from 'node:crypto';

import { headers } from 'next/headers';

import { env } from './env';
import { readSession, writeSession } from './session';
import type { PortalSession } from './session';

export interface ApiError {
  readonly code: string;
  readonly message: string;
  readonly correlationId: string;
  readonly details?: readonly { path: string; message: string }[];
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError; status: number };

interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  /** Send without a session. Only sign-in and second-factor use this. */
  readonly anonymous?: boolean;
  readonly token?: string;
}

/**
 * The portal's only route to the platform.
 *
 * Runs on the server, takes the token from the encrypted session cookie, and
 * forwards the resident's own correlation id so a support request can be traced
 * from a page the resident was looking at through to the audit record.
 *
 * Access tokens are short-lived; when one has expired this refreshes it and
 * rewrites the session cookie before retrying, so the resident is not signed out
 * mid-task by a fifteen-minute token.
 */
export async function callApi<T>(
  path: string,
  options: RequestOptions = {},
): Promise<ApiResult<T>> {
  const correlationId = await correlationIdFor();

  if (options.anonymous === true || options.token !== undefined) {
    return send<T>(path, options, options.token ?? null, correlationId);
  }

  const session = await readSession();
  if (session === null) {
    return {
      ok: false,
      status: 401,
      error: { code: 'UNAUTHENTICATED', message: 'Please sign in again.', correlationId },
    };
  }

  const fresh = await ensureFreshToken(session, correlationId);
  if (fresh === null) {
    return {
      ok: false,
      status: 401,
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Your session has ended. Please sign in again.',
        correlationId,
      },
    };
  }

  const result = await send<T>(path, options, fresh.accessToken, correlationId);
  if (result.ok || result.status !== 401) return result;

  // A 401 on a token we believed was live means the session was ended elsewhere
  // — a passphrase change, or the resident ending it from another device.
  return result;
}

async function send<T>(
  path: string,
  options: RequestOptions,
  token: string | null,
  correlationId: string,
): Promise<ApiResult<T>> {
  const requestHeaders: Record<string, string> = {
    accept: 'application/json',
    'x-correlation-id': correlationId,
  };
  if (token !== null) requestHeaders.authorization = `Bearer ${token}`;
  if (options.body !== undefined) requestHeaders['content-type'] = 'application/json';

  // Forward the resident's address so the audit record and the platform's rate
  // limits see the person, not the portal.
  const forwarded = await callerAddress();
  if (forwarded !== null) requestHeaders['x-forwarded-for'] = forwarded;
  const userAgent = (await headers()).get('user-agent');
  if (userAgent !== null) requestHeaders['user-agent'] = userAgent;

  let response: Response;
  try {
    response = await fetch(`${env.apiBaseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers: requestHeaders,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: 'no-store',
      redirect: 'manual',
    });
  } catch {
    return {
      ok: false,
      status: 503,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'The service is not responding. Please try again in a moment.',
        correlationId,
      },
    };
  }

  const text = await response.text();
  const parsed: unknown = text === '' ? null : safeJson(text);

  if (!response.ok) {
    const body = parsed as { error?: ApiError } | null;
    return {
      ok: false,
      status: response.status,
      error: body?.error ?? {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong. Please try again.',
        correlationId,
      },
    };
  }
  return { ok: true, data: parsed as T };
}

async function ensureFreshToken(
  session: PortalSession,
  correlationId: string,
): Promise<PortalSession | null> {
  // Refresh a little before expiry so a slow request does not cross the line.
  if (session.accessTokenExpiresAt - 30 > Math.floor(Date.now() / 1000)) return session;

  const refreshed = await send<{
    accessToken: string;
    refreshToken: string;
    expiresAt: string;
  }>(
    '/api/v1/auth/refresh',
    { method: 'POST', body: { refreshToken: session.refreshToken } },
    null,
    correlationId,
  );

  if (!refreshed.ok) return null;

  const next: PortalSession = {
    ...session,
    accessToken: refreshed.data.accessToken,
    refreshToken: refreshed.data.refreshToken,
    accessTokenExpiresAt: Math.floor(new Date(refreshed.data.expiresAt).getTime() / 1000),
  };
  await writeSession(next);
  return next;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function correlationIdFor(): Promise<string> {
  const incoming = (await headers()).get('x-correlation-id');
  return incoming !== null && /^[A-Za-z0-9._-]{1,128}$/.test(incoming) ? incoming : randomUUID();
}

async function callerAddress(): Promise<string | null> {
  const store = await headers();
  const forwarded = store.get('x-forwarded-for');
  if (forwarded !== null && forwarded.trim() !== '') return forwarded.split(',')[0]?.trim() ?? null;
  return store.get('x-real-ip');
}

/** Unwrap a result for a page, treating any failure as "nothing to show". */
export function dataOr<T, F>(result: ApiResult<T>, fallback: F): T | F {
  return result.ok ? result.data : fallback;
}
