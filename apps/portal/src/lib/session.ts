import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { cookies } from 'next/headers';

import { SESSION_COOKIE, env } from './env';

/**
 * The portal session.
 *
 * The browser never receives an API token. The session lives in one encrypted,
 * httpOnly, same-site cookie that only the portal's server can read, and every
 * call to the platform happens server-side with the token taken out of it.
 *
 * That is the whole reason the portal exists as a server-rendered application
 * rather than a single-page app talking to the API directly: a token in
 * JavaScript is a token any injected script can take.
 */
export interface PortalSession {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Seconds since the epoch at which the access token stops being accepted. */
  readonly accessTokenExpiresAt: number;
  readonly displayName: string;
  readonly pcid: string | null;
  /** Set while a second factor is outstanding. Nothing else is reachable. */
  readonly pendingMfaSessionId: string | null;
  readonly mustChangePassword: boolean;
  /**
   * Authenticator enrolment in progress.
   *
   * The secret and recovery codes are shown once and must survive the round trip
   * between "set this up" and "here is the code from my app". They live here
   * rather than in a page URL or a hidden field because this cookie is
   * encrypted, httpOnly and never leaves the server — the browser holds the
   * ciphertext and nothing else.
   */
  readonly pendingEnrolment?: {
    readonly secret: string;
    readonly provisioningUri: string;
    readonly recoveryCodes: readonly string[];
  } | null;
}

const VERSION = 'v1';

function key(): Buffer {
  const material = Buffer.from(env.sessionKey, 'base64url');
  if (material.length < 32) {
    throw new Error('PORTAL_SESSION_KEY must be at least 32 bytes, base64url encoded');
  }
  return material.subarray(0, 32);
}

export function sealSession(session: PortalSession): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const payload = Buffer.concat([cipher.update(JSON.stringify(session), 'utf8'), cipher.final()]);
  return [
    VERSION,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    payload.toString('base64url'),
  ].join('.');
}

export function openSession(sealed: string): PortalSession | null {
  const parts = sealed.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key(),
      Buffer.from(parts[1] as string, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(parts[2] as string, 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(parts[3] as string, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(plaintext) as PortalSession;
  } catch {
    // A cookie that does not decrypt is a cookie from another key or a tampered
    // one. Either way it is not a session.
    return null;
  }
}

export async function readSession(): Promise<PortalSession | null> {
  const store = await cookies();
  const sealed = store.get(SESSION_COOKIE)?.value;
  return sealed === undefined ? null : openSession(sealed);
}

export async function writeSession(session: PortalSession): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, sealSession(session), {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'strict',
    path: '/',
    maxAge: env.sessionTtlSeconds,
  });
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  });
}
