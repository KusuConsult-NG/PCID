import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { cookies } from 'next/headers';

/**
 * A portal session, sealed into one cookie.
 *
 * The browser never receives an API token. The session lives in an encrypted,
 * http-only, same-site cookie that only the portal's server can read, and every
 * call to the platform happens server-side with the token taken out of it.
 *
 * That is the whole reason a portal is a server-rendered application rather than
 * a single-page app talking to the API directly: a token in JavaScript is a
 * token any injected script can take. It is shared between the portals rather
 * than written twice because this is the piece that must not drift - two copies
 * of a sealing routine is one copy that quietly stops being reviewed.
 */
export interface PortalSessionBase {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Seconds since the epoch at which the access token stops being accepted. */
  readonly accessTokenExpiresAt: number;
  readonly displayName: string;
  /** Set while a second factor is outstanding. Nothing else is reachable. */
  readonly pendingMfaSessionId: string | null;
}

export interface SessionConfig {
  readonly cookieName: string;
  /** At least 32 bytes, base64url encoded. Never the API's own keys. */
  readonly key: string;
  readonly ttlSeconds: number;
  /** False only for a local plain-HTTP development server. */
  readonly secure: boolean;
}

export interface SessionStore<T extends PortalSessionBase> {
  seal(session: T): string;
  open(sealed: string): T | null;
  read(): Promise<T | null>;
  write(session: T): Promise<void>;
  clear(): Promise<void>;
}

const VERSION = 'v1';

/**
 * Build a session store for one portal.
 *
 * The configuration is read through a function rather than passed by value so
 * that a build - which evaluates every module to collect route configuration -
 * does not need the runtime secret. A build machine should never hold one.
 */
export function createSessionStore<T extends PortalSessionBase>(
  config: () => SessionConfig,
): SessionStore<T> {
  const keyBytes = (): Buffer => {
    const material = Buffer.from(config().key, 'base64url');
    if (material.length < 32) {
      throw new Error('The portal session key must be at least 32 bytes, base64url encoded');
    }
    return material.subarray(0, 32);
  };

  const seal = (session: T): string => {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', keyBytes(), iv);
    const payload = Buffer.concat([cipher.update(JSON.stringify(session), 'utf8'), cipher.final()]);
    return [
      VERSION,
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      payload.toString('base64url'),
    ].join('.');
  };

  const open = (sealed: string): T | null => {
    const parts = sealed.split('.');
    if (parts.length !== 4 || parts[0] !== VERSION) return null;
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        keyBytes(),
        Buffer.from(parts[1] as string, 'base64url'),
      );
      decipher.setAuthTag(Buffer.from(parts[2] as string, 'base64url'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(parts[3] as string, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
      return JSON.parse(plaintext) as T;
    } catch {
      // A cookie that does not decrypt is a cookie from another key or a
      // tampered one. Either way it is not a session.
      return null;
    }
  };

  const cookieOptions = (maxAge: number): Record<string, unknown> => ({
    httpOnly: true,
    secure: config().secure,
    sameSite: 'strict' as const,
    path: '/',
    maxAge,
  });

  return {
    seal,
    open,
    async read(): Promise<T | null> {
      const sealed = (await cookies()).get(config().cookieName)?.value;
      return sealed === undefined ? null : open(sealed);
    },
    async write(session: T): Promise<void> {
      const store = await cookies();
      store.set(config().cookieName, seal(session), cookieOptions(config().ttlSeconds));
    },
    async clear(): Promise<void> {
      const store = await cookies();
      store.set(config().cookieName, '', cookieOptions(0));
    },
  };
}

/** Read the session id out of an access token, for the second-factor step. */
export function sessionIdFromToken(accessToken: string): string | null {
  const payload = accessToken.split('.')[1];
  if (payload === undefined) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      sid?: string;
    };
    return claims.sid ?? null;
  } catch {
    return null;
  }
}
