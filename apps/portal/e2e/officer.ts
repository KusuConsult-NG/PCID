/**
 * Enough of an API client to let an officer act during a portal test.
 *
 * Several things the portal shows a resident - that their ID was checked at a
 * counter, that an office opened their record - only become true when a
 * government officer does something. Those tests drive the real API as a real
 * officer rather than writing rows behind the portal's back.
 *
 * The one-time-password arithmetic below is written out rather than imported
 * from the service under test: a second, independent implementation of RFC 6238
 * is a check on the first, where reusing it would only prove it agrees with
 * itself.
 */
import { createHmac } from 'node:crypto';

import type { APIRequestContext } from '@playwright/test';

import { API_BASE_URL } from './environment';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const character of input.replace(/=+$/, '').toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index === -1) throw new Error(`Not base32: ${character}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}

/** RFC 6238: SHA-1, a 30-second step, six digits. */
export function totpCode(
  secret: string,
  atSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const counter = Math.floor(atSeconds / 30);
  const message = Buffer.alloc(8);
  message.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  message.writeUInt32BE(counter >>> 0, 4);
  const digest = createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = (digest[digest.length - 1] as number) & 0x0f;
  const binary =
    (((digest[offset] as number) & 0x7f) << 24) |
    (((digest[offset + 1] as number) & 0xff) << 16) |
    (((digest[offset + 2] as number) & 0xff) << 8) |
    ((digest[offset + 3] as number) & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

export interface OfficerSession {
  readonly accessToken: string;
}

/**
 * Sign an officer in, both factors.
 *
 * Waits for the next time step when a code for this second has already been
 * presented: the platform refuses a replayed step, which is correct, and only
 * the test has to work around it.
 */
export async function signInOfficer(
  request: APIRequestContext,
  officer: { email: string; password: string; totpSecret: string },
): Promise<OfficerSession> {
  const login = await request.post(`${API_BASE_URL}/api/v1/auth/login`, {
    data: { email: officer.email, password: officer.password },
  });
  if (!login.ok()) throw new Error(`officer login failed: ${login.status()} ${await login.text()}`);
  const body = (await login.json()) as { accessToken: string };
  const sessionId = readSessionId(body.accessToken);

  const code = await freshCode(officer.totpSecret);
  const verified = await request.post(`${API_BASE_URL}/api/v1/auth/mfa/verify`, {
    data: { sessionId, code },
  });
  if (!verified.ok()) {
    throw new Error(`second factor failed: ${verified.status()} ${await verified.text()}`);
  }
  const mfa = (await verified.json()) as { accessToken: string };
  return { accessToken: mfa.accessToken };
}

export async function officerPost<T>(
  request: APIRequestContext,
  session: OfficerSession,
  path: string,
  body: unknown,
): Promise<T> {
  const response = await request.post(`${API_BASE_URL}${path}`, {
    data: body as Record<string, unknown>,
    headers: { authorization: `Bearer ${session.accessToken}` },
  });
  if (!response.ok()) {
    throw new Error(`${path} failed: ${response.status()} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

const used = new Map<string, number>();

async function freshCode(secret: string): Promise<string> {
  let step = Math.floor(Date.now() / 1000 / 30);
  const last = used.get(secret);
  if (last !== undefined && step <= last) {
    const waitMs = (last + 1) * 30 * 1000 - Date.now() + 1_000;
    await new Promise((settle) => setTimeout(settle, Math.max(0, waitMs)));
    step = Math.floor(Date.now() / 1000 / 30);
  }
  used.set(secret, step);
  return totpCode(secret, step * 30);
}

function readSessionId(accessToken: string): string {
  const payload = accessToken.split('.')[1] as string;
  return (JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sid: string }).sid;
}
