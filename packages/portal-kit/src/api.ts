import { randomUUID } from 'node:crypto';

import { headers } from 'next/headers';

import type { PortalSessionBase, SessionStore } from './session';

export interface ApiError {
  readonly code: string;
  readonly message: string;
  readonly correlationId: string;
  readonly details?: readonly { path: string; message: string }[];
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError; status: number };

export interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  /** Send without a session. Only sign-in and the second factor use this. */
  readonly anonymous?: boolean;
  readonly token?: string;
}

export interface ApiClientConfig<T extends PortalSessionBase> {
  readonly baseUrl: () => string;
  readonly sessions: SessionStore<T>;
}

/**
 * A portal's only route to the platform.
 *
 * Runs on the server, takes the token from the encrypted session cookie, and
 * forwards the caller's own correlation id so a support request can be traced
 * from the page somebody was looking at through to the audit record.
 *
 * Access tokens are short-lived; when one is close to expiring this refreshes it
 * and rewrites the session cookie before sending, so nobody is signed out
 * mid-task by a fifteen-minute token.
 */
export function createApiClient<T extends PortalSessionBase>(config: ApiClientConfig<T>) {
  async function send<R>(
    path: string,
    options: RequestOptions,
    token: string | null,
    correlationId: string,
  ): Promise<ApiResult<R>> {
    const requestHeaders: Record<string, string> = {
      accept: 'application/json',
      'x-correlation-id': correlationId,
    };
    if (token !== null) requestHeaders.authorization = `Bearer ${token}`;
    if (options.body !== undefined) requestHeaders['content-type'] = 'application/json';

    // Forward the caller's address so the audit record and the platform's rate
    // limits see the person, not the portal.
    const forwarded = await callerAddress();
    if (forwarded !== null) requestHeaders['x-forwarded-for'] = forwarded;
    const userAgent = (await headers()).get('user-agent');
    if (userAgent !== null) requestHeaders['user-agent'] = userAgent;

    let response: Response;
    try {
      response = await fetch(`${config.baseUrl()}${path}`, {
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
    return { ok: true, data: parsed as R };
  }

  async function ensureFreshToken(session: T, correlationId: string): Promise<T | null> {
    // Refresh a little before expiry so a slow request does not cross the line.
    if (session.accessTokenExpiresAt - 30 > Math.floor(Date.now() / 1000)) return session;

    const refreshed = await send<{ accessToken: string; refreshToken: string; expiresAt: string }>(
      '/api/v1/auth/refresh',
      { method: 'POST', body: { refreshToken: session.refreshToken } },
      null,
      correlationId,
    );
    if (!refreshed.ok) return null;

    const next = {
      ...session,
      accessToken: refreshed.data.accessToken,
      refreshToken: refreshed.data.refreshToken,
      accessTokenExpiresAt: Math.floor(new Date(refreshed.data.expiresAt).getTime() / 1000),
    };
    await config.sessions.write(next);
    return next;
  }

  return async function callApi<R>(
    path: string,
    options: RequestOptions = {},
  ): Promise<ApiResult<R>> {
    const correlationId = await correlationIdFor();

    if (options.anonymous === true || options.token !== undefined) {
      return send<R>(path, options, options.token ?? null, correlationId);
    }

    const session = await config.sessions.read();
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

    // A 401 on a token we believed was live means the session was ended
    // elsewhere - a passphrase change, or somebody ending it from another
    // device. It is returned as it is: re-authenticating is the answer.
    return send<R>(path, options, fresh.accessToken, correlationId);
  };
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
