'use server';

import { redirect } from 'next/navigation';

import { callApi } from '@/lib/api';
import { clearSession, readSession, writeSession } from '@/lib/session';

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  mfaRequired: boolean;
  mustChangePassword: boolean;
  actor: { id: string; displayName: string };
}

/**
 * Sign in.
 *
 * The portal never tells the browser why a sign-in failed beyond "those details
 * are not correct", mirroring the platform: the page must not become a way to
 * find out which Plateau Citizen IDs exist.
 */
export async function signIn(formData: FormData): Promise<void> {
  const identifier = String(formData.get('identifier') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (identifier === '' || password === '') {
    redirect('/sign-in?error=missing');
  }

  const result = await callApi<LoginResponse>('/api/v1/auth/citizen/login', {
    method: 'POST',
    body: { identifier, password },
    anonymous: true,
  });

  if (!result.ok) {
    const code =
      result.error.code === 'ACCOUNT_LOCKED'
        ? 'locked'
        : result.error.code === 'RATE_LIMITED'
          ? 'throttled'
          : result.error.code === 'SERVICE_UNAVAILABLE'
            ? 'unavailable'
            : 'credentials';
    redirect(`/sign-in?error=${code}`);
  }

  const login = result.data;
  await writeSession({
    accessToken: login.accessToken,
    refreshToken: login.refreshToken,
    accessTokenExpiresAt: Math.floor(new Date(login.expiresAt).getTime() / 1000),
    displayName: login.actor.displayName,
    pcid: null,
    // Until the second factor is presented, the session is good for nothing but
    // presenting it.
    pendingMfaSessionId: login.mfaRequired ? sessionIdFromToken(login.accessToken) : null,
    mustChangePassword: login.mustChangePassword,
  });

  if (login.mfaRequired) redirect('/sign-in/verify');
  if (login.mustChangePassword) redirect('/change-passphrase');
  redirect('/dashboard');
}

/** Present the second factor and raise the session. */
export async function verifySecondFactor(formData: FormData): Promise<void> {
  const code = String(formData.get('code') ?? '').trim();
  const session = await readSession();
  if (session === null || session.pendingMfaSessionId === null) {
    redirect('/sign-in?error=expired');
  }

  const result = await callApi<{ accessToken: string; expiresAt: string }>(
    '/api/v1/auth/mfa/verify',
    {
      method: 'POST',
      body: { sessionId: session.pendingMfaSessionId, code },
      anonymous: true,
    },
  );

  if (!result.ok) {
    redirect(
      `/sign-in/verify?error=${result.error.code === 'RATE_LIMITED' ? 'throttled' : 'code'}`,
    );
  }

  await writeSession({
    ...session,
    accessToken: result.data.accessToken,
    accessTokenExpiresAt: Math.floor(new Date(result.data.expiresAt).getTime() / 1000),
    pendingMfaSessionId: null,
  });

  if (session.mustChangePassword) redirect('/change-passphrase');
  redirect('/dashboard');
}

export async function signOut(): Promise<void> {
  await callApi('/api/v1/auth/logout', { method: 'POST' });
  await clearSession();
  redirect('/sign-in?signed-out=1');
}

/**
 * Read the session id out of the access token.
 *
 * The token is opaque to the browser but not to the portal, which holds it
 * server-side; the second-factor endpoint is keyed by session id.
 */
function sessionIdFromToken(accessToken: string): string | null {
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
