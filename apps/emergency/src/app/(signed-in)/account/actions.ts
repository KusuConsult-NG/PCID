'use server';

import { redirect } from 'next/navigation';

import { callApi } from '@/lib/api';
import { readSession, writeSession } from '@/lib/session';

/** End a session you do not recognise, or the terminal you left in a vehicle. */
export async function endSession(formData: FormData): Promise<void> {
  const sessionId = String(formData.get('sessionId') ?? '');
  const result = await callApi<{ ended: boolean }>(
    `/api/v1/users/me/sessions/${encodeURIComponent(sessionId)}`,
    { method: 'DELETE' },
  );
  redirect(result.ok && result.data.ended ? '/account?ended=1' : '/account?error=failed');
}

/**
 * Come off the incident, and off the unit.
 *
 * Neither authorises anything, so clearing them removes nothing. It is here
 * because a crew going off shift should be able to say so, and because an
 * incident reference left in the banner for a job that finished last night is a
 * small lie the interface keeps telling.
 */
export async function endShift(): Promise<void> {
  const session = await readSession();
  if (session === null) redirect('/sign-in');
  await writeSession({ ...session, workingIncident: null, workingUnit: null });
  redirect('/account?cleared=1');
}
