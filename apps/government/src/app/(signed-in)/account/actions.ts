'use server';

import { redirect } from 'next/navigation';

import { callApi } from '@/lib/api';

/** End a session you do not recognise, or the counter machine you left. */
export async function endSession(formData: FormData): Promise<void> {
  const sessionId = String(formData.get('sessionId') ?? '');
  const result = await callApi<{ ended: boolean }>(
    `/api/v1/users/me/sessions/${encodeURIComponent(sessionId)}`,
    { method: 'DELETE' },
  );
  redirect(result.ok && result.data.ended ? '/account?ended=1' : '/account?error=failed');
}
