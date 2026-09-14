'use server';

import { redirect } from 'next/navigation';

import { callApi } from '@/lib/api';

/** Record what was done about an alert, including deciding it was nothing. */
export async function reviewAlert(formData: FormData): Promise<void> {
  const reference = String(formData.get('reference') ?? '');
  const decision = String(formData.get('decision') ?? '');
  const note = String(formData.get('note') ?? '').trim();

  if (note.length < 5) redirect('/alerts?error=note');

  const result = await callApi<{ status: string }>(
    `/api/v1/alerts/${encodeURIComponent(reference)}/review`,
    { method: 'POST', body: { decision, note } },
  );

  if (!result.ok) {
    redirect(`/alerts?error=${result.error.code === 'CONFLICT' ? 'decided' : 'failed'}`);
  }
  redirect(`/alerts?reviewed=${encodeURIComponent(result.data.status)}`);
}
