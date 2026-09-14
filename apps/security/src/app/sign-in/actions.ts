'use server';

import { sessionIdFromToken } from '@pcid/portal-kit/session';
import { redirect } from 'next/navigation';

import { callApi } from '@/lib/api';
import { clearSession, readSession, writeSession } from '@/lib/session';
import type { Me } from '@/lib/types';

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  mfaRequired: boolean;
  mustChangePassword: boolean;
  actor: { id: string; displayName: string; roles: string[]; agencyCode: string | null };
}

/**
 * Sign in.
 *
 * The portal tells the officer nothing about why a sign-in failed beyond "those
 * details are not correct". A directory of who investigates what is a useful
 * thing to have if you are working out who to phish, or who to threaten.
 */
export async function signIn(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (email === '' || password === '') redirect('/sign-in?error=missing');

  const result = await callApi<LoginResponse>('/api/v1/auth/login', {
    method: 'POST',
    body: { email, password },
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
    userId: login.actor.id,
    email,
    agencyName: null,
    agencyCode: login.actor.agencyCode,
    roles: login.actor.roles ?? [],
    // Nothing is entitled until the second factor is presented.
    actions: [],
    workingCase: null,
    mustChangePassword: login.mustChangePassword,
    pendingMfaSessionId: login.mfaRequired ? sessionIdFromToken(login.accessToken) : null,
    stepUpReturnTo: null,
  });

  if (login.mfaRequired) redirect('/sign-in/verify');
  if (login.mustChangePassword) redirect('/change-passphrase');
  redirect('/home');
}

/** Present the second factor and raise the session to AAL2. */
export async function verifySecondFactor(formData: FormData): Promise<void> {
  const code = String(formData.get('code') ?? '').trim();
  const session = await readSession();
  if (session === null || session.pendingMfaSessionId === null) redirect('/sign-in?error=expired');

  const result = await callApi<{ accessToken: string; expiresAt: string }>(
    '/api/v1/auth/mfa/verify',
    { method: 'POST', body: { sessionId: session.pendingMfaSessionId, code }, anonymous: true },
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

  await refreshEntitlements();
  if (session.mustChangePassword) redirect('/change-passphrase');
  redirect('/home');
}

/**
 * Re-read what this account may do, from the platform.
 *
 * Entitlements are read per request by the policy engine, so the copy the portal
 * holds for rendering is only ever a cache. It is refreshed whenever the session
 * changes, and it is never a decision: a menu item that should not be there is a
 * cosmetic defect, because the API refuses the call regardless.
 */
export async function refreshEntitlements(): Promise<void> {
  const session = await readSession();
  if (session === null) return;
  const me = await callApi<Me>('/api/v1/auth/me');
  if (!me.ok) return;
  await writeSession({
    ...session,
    displayName: me.data.displayName,
    email: me.data.email,
    userId: me.data.id,
    agencyName: me.data.agency.name,
    agencyCode: me.data.agency.code,
    roles: me.data.roles,
    actions: me.data.actions,
  });
}

export async function signOut(): Promise<void> {
  await callApi('/api/v1/auth/logout', { method: 'POST' });
  await clearSession();
  redirect('/sign-in?signed-out=1');
}
