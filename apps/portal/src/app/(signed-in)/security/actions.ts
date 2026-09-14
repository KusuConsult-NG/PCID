'use server';

import { redirect } from 'next/navigation';

import { callApi } from '@/lib/api';
import { readSession, writeSession } from '@/lib/session';

export async function beginAuthenticatorSetup(): Promise<void> {
  const result = await callApi<{
    secret: string;
    provisioningUri: string;
    recoveryCodes: string[];
  }>('/api/v1/me/mfa/enrol', { method: 'POST' });

  if (!result.ok) {
    redirect(`/security?error=${result.error.code === 'CONFLICT' ? 'already' : 'failed'}`);
  }

  const session = await readSession();
  if (session === null) redirect('/sign-in');
  await writeSession({ ...session, pendingEnrolment: result.data });
  redirect('/security#authenticator');
}

export async function confirmAuthenticator(formData: FormData): Promise<void> {
  const code = String(formData.get('code') ?? '').trim();
  const result = await callApi('/api/v1/me/mfa/confirm', { method: 'POST', body: { code } });

  if (!result.ok) {
    redirect('/security?error=code#authenticator');
  }

  const session = await readSession();
  if (session !== null) {
    // The secret has served its purpose; it should not linger in the cookie.
    await writeSession({ ...session, pendingEnrolment: null });
  }
  redirect('/security?authenticator=1');
}

export async function cancelAuthenticatorSetup(): Promise<void> {
  const session = await readSession();
  if (session !== null) await writeSession({ ...session, pendingEnrolment: null });
  redirect('/security');
}

export async function endSession(formData: FormData): Promise<void> {
  const id = String(formData.get('sessionId') ?? '');
  const result = await callApi<{ ended: boolean }>(`/api/v1/me/sessions/${id}`, {
    method: 'DELETE',
  });
  redirect(result.ok && result.data.ended ? '/security?ended=1' : '/security?error=failed');
}
