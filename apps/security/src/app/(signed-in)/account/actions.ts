'use server';

import { redirect } from 'next/navigation';

import { callApi } from '@/lib/api';
import { readSession, writeSession } from '@/lib/session';

/** End a session you do not recognise, or the vehicle terminal you walked away from. */
export async function endSession(formData: FormData): Promise<void> {
  const sessionId = String(formData.get('sessionId') ?? '');
  const result = await callApi<{ ended: boolean }>(
    `/api/v1/users/me/sessions/${encodeURIComponent(sessionId)}`,
    { method: 'DELETE' },
  );
  redirect(result.ok && result.data.ended ? '/account?ended=1' : '/account?error=failed');
}

/**
 * Put the working case down.
 *
 * It authorises nothing, so clearing it removes nothing. It is here because an
 * officer finishing with a case should be able to say so, and because a
 * reference left in the banner for a case you closed last week is a small lie
 * the interface keeps telling.
 */
export async function clearWorkingCase(): Promise<void> {
  const session = await readSession();
  if (session === null) redirect('/sign-in');
  await writeSession({ ...session, workingCase: null });
  redirect('/account?cleared=1');
}
