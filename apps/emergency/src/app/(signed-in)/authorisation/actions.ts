'use server';

import { redirect } from 'next/navigation';

import { callApi } from '@/lib/api';

/**
 * Break the glass.
 *
 * Temporary, minimal, logged and reviewable. It also needs a step-up, because a
 * tablet left unlocked in a vehicle is exactly the thing that must not be able
 * to do this.
 */
export async function initiateBreakGlass(formData: FormData): Promise<void> {
  const subjectPcid = String(formData.get('subjectPcid') ?? '')
    .trim()
    .toUpperCase();
  const incidentRef = String(formData.get('incidentRef') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  const gates = formData.getAll('gate').map((value) => String(value));

  if (gates.length === 0) redirect('/authorisation?error=gates#break-glass');
  if (reason.length < 20) redirect('/authorisation?error=reason#break-glass');

  const result = await callApi<{ reference: string; expiresAt: string }>('/api/v1/break-glass', {
    method: 'POST',
    body: {
      resourceType: 'CITIZEN',
      subjectPcid: subjectPcid === '' ? null : subjectPcid,
      incidentRef: incidentRef === '' ? null : incidentRef,
      gates,
      reason,
    },
  });

  if (!result.ok) {
    if (result.error.code === 'STEP_UP_REQUIRED') {
      redirect(`/step-up?return=${encodeURIComponent('/authorisation#break-glass')}`);
    }
    redirect(
      `/authorisation?error=failed&message=${encodeURIComponent(result.error.message)}#break-glass`,
    );
  }
  redirect(
    `/authorisation?granted=${encodeURIComponent(result.data.reference)}&expires=${encodeURIComponent(result.data.expiresAt)}&pcid=${encodeURIComponent(subjectPcid)}&incident=${encodeURIComponent(incidentRef)}#break-glass`,
  );
}

/** Record the mandatory post-event review of somebody's emergency access. */
export async function reviewBreakGlass(formData: FormData): Promise<void> {
  const reference = String(formData.get('reference') ?? '');
  const decision = String(formData.get('decision') ?? '');
  const note = String(formData.get('note') ?? '').trim();
  if (note.length < 5) redirect('/authorisation?error=note#reviews');

  const result = await callApi(`/api/v1/break-glass/${encodeURIComponent(reference)}/review`, {
    method: 'POST',
    body: { decision, note },
  });
  if (!result.ok) {
    redirect(
      `/authorisation?error=failed&message=${encodeURIComponent(result.error.message)}#reviews`,
    );
  }
  redirect('/authorisation?reviewed=1#reviews');
}
