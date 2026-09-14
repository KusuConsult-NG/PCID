'use server';

import { redirect } from 'next/navigation';

import { callApi } from '@/lib/api';
import { readSession, writeSession } from '@/lib/session';

/**
 * Re-authenticate mid-task.
 *
 * Breaking the glass requires a session that was proved a few minutes ago, not
 * one proved at the start of a shift and left open on a tablet in a vehicle.
 * This is that proof.
 */
export async function stepUp(formData: FormData): Promise<void> {
  const code = String(formData.get('code') ?? '').trim();
  const returnTo = String(formData.get('return') ?? '/home');
  const session = await readSession();
  if (session === null) redirect('/sign-in');

  const result = await callApi<{ accessToken: string; expiresAt: string }>(
    '/api/v1/auth/mfa/verify',
    {
      method: 'POST',
      body: { sessionId: sessionIdOf(session.accessToken), code },
      anonymous: true,
    },
  );

  if (!result.ok) {
    redirect(
      `/step-up?return=${encodeURIComponent(returnTo)}&error=${result.error.code === 'RATE_LIMITED' ? 'throttled' : 'code'}`,
    );
  }

  await writeSession({
    ...session,
    accessToken: result.data.accessToken,
    accessTokenExpiresAt: Math.floor(new Date(result.data.expiresAt).getTime() / 1000),
    stepUpReturnTo: null,
  });

  // Only ever back into this application.
  redirect(returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/home');
}

function sessionIdOf(accessToken: string): string | null {
  const payload = accessToken.split('.')[1];
  if (payload === undefined) return null;
  try {
    return (
      (JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sid?: string }).sid ??
      null
    );
  } catch {
    return null;
  }
}
