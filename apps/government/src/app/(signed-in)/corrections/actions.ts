'use server';

import { redirect } from 'next/navigation';

import { callApi } from '@/lib/api';

/**
 * Decide a correction request.
 *
 * Approving applies the value to the record. That is why this needs a freshly
 * re-authenticated session at the API: it changes the identity register.
 */
export async function decideCorrection(formData: FormData): Promise<void> {
  const reference = String(formData.get('reference') ?? '');
  const decision = String(formData.get('decision') ?? '');
  const note = String(formData.get('note') ?? '').trim();

  if (note.length < 5) redirect('/corrections?error=note');

  const result = await callApi<{ status: string; applied: boolean }>(
    `/api/v1/correction-requests/${encodeURIComponent(reference)}/decision`,
    { method: 'POST', body: { decision, note } },
  );

  if (!result.ok) {
    if (result.error.code === 'STEP_UP_REQUIRED') {
      redirect(`/step-up?return=${encodeURIComponent('/corrections')}`);
    }
    redirect(`/corrections?error=${result.error.code === 'CONFLICT' ? 'decided' : 'failed'}`);
  }
  redirect(`/corrections?decided=${encodeURIComponent(result.data.status)}`);
}
