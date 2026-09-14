'use server';

import { redirect } from 'next/navigation';

import { callApi } from '@/lib/api';

/**
 * Approve or deny a request for fields the engine withheld.
 *
 * Needs a freshly re-authenticated session, and nobody decides their own: the
 * API and a database constraint both refuse it.
 */
export async function decideAccessRequest(formData: FormData): Promise<void> {
  const reference = String(formData.get('reference') ?? '');
  const decision = String(formData.get('decision') ?? '');
  const note = String(formData.get('note') ?? '').trim();
  if (note.length < 5) redirect('/access-requests?error=note');

  const result = await callApi<{ status: string }>(
    `/api/v1/access-requests/${encodeURIComponent(reference)}/decision`,
    { method: 'POST', body: { decision, note } },
  );

  if (!result.ok) {
    if (result.error.code === 'STEP_UP_REQUIRED') {
      redirect(`/step-up?return=${encodeURIComponent('/access-requests')}`);
    }
    redirect(
      `/access-requests?error=${result.error.code === 'CONFLICT' ? 'decided' : 'failed'}&message=${encodeURIComponent(result.error.message)}`,
    );
  }
  redirect(`/access-requests?decided=${encodeURIComponent(result.data.status)}`);
}

/** Record the mandatory post-event review of a break-glass grant. */
export async function reviewBreakGlass(formData: FormData): Promise<void> {
  const reference = String(formData.get('reference') ?? '');
  const decision = String(formData.get('decision') ?? '');
  const note = String(formData.get('note') ?? '').trim();
  if (note.length < 5) redirect('/access-requests?error=note#break-glass');

  const result = await callApi<{ status: string }>(
    `/api/v1/break-glass/${encodeURIComponent(reference)}/review`,
    { method: 'POST', body: { decision, note } },
  );
  if (!result.ok) {
    redirect(
      `/access-requests?error=failed&message=${encodeURIComponent(result.error.message)}#break-glass`,
    );
  }
  redirect('/access-requests?reviewed=1#break-glass');
}
