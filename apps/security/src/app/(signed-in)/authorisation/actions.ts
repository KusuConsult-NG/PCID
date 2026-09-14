'use server';

import { redirect } from 'next/navigation';

import { callApi } from '@/lib/api';

/**
 * Ask for fields the engine withheld.
 *
 * The platform runs the policy check itself before queueing anything, and
 * stores the engine's verbatim answer on the request. If the fields turn out to
 * be available already, nothing is queued and the officer is told to go and
 * read the record instead of waiting on an approver for something they could
 * have had.
 */
export async function raiseAccessRequest(formData: FormData): Promise<void> {
  const purpose = String(formData.get('purpose') ?? '');
  const subjectPcid = String(formData.get('subjectPcid') ?? '').trim();
  const caseRef = String(formData.get('caseRef') ?? '').trim();
  const justification = String(formData.get('justification') ?? '').trim();

  const fields = [
    ...formData.getAll('field').map((value) => String(value)),
    ...String(formData.get('otherFields') ?? '').split(/[,\s]+/),
  ]
    .map((field) => field.trim())
    .filter((field) => field !== '');

  if (fields.length === 0) redirect('/authorisation?error=fields#raise');
  if (justification.length < 10) redirect('/authorisation?error=justification#raise');

  const result = await callApi<{ reference: string; status: string; message?: string }>(
    '/api/v1/access-requests',
    {
      method: 'POST',
      body: {
        purpose,
        resourceType: 'CITIZEN',
        subjectPcid: subjectPcid === '' ? null : subjectPcid,
        caseRef: caseRef === '' ? null : caseRef,
        requestedFields: fields,
        justification,
      },
    },
  );

  if (!result.ok) {
    redirect(
      `/authorisation?error=failed&message=${encodeURIComponent(result.error.message)}#raise`,
    );
  }
  redirect(
    `/authorisation?raised=${encodeURIComponent(result.data.reference)}&outcome=${encodeURIComponent(result.data.status)}`,
  );
}

/**
 * Approve or deny somebody else's request.
 *
 * Needs a freshly re-authenticated session. Nobody decides their own: the API
 * and a database constraint both refuse it.
 */
export async function decideAccessRequest(formData: FormData): Promise<void> {
  const reference = String(formData.get('reference') ?? '');
  const decision = String(formData.get('decision') ?? '');
  const note = String(formData.get('note') ?? '').trim();
  if (note.length < 5) redirect('/authorisation?error=note#queue');

  const result = await callApi<{ status: string }>(
    `/api/v1/access-requests/${encodeURIComponent(reference)}/decision`,
    { method: 'POST', body: { decision, note } },
  );

  if (!result.ok) {
    if (result.error.code === 'STEP_UP_REQUIRED') {
      redirect(`/step-up?return=${encodeURIComponent('/authorisation')}`);
    }
    redirect(
      `/authorisation?error=${result.error.code === 'CONFLICT' ? 'decided' : 'failed'}&message=${encodeURIComponent(result.error.message)}#queue`,
    );
  }
  redirect(`/authorisation?decided=${encodeURIComponent(result.data.status)}#queue`);
}

/**
 * Break the glass.
 *
 * Temporary, minimal, logged and reviewable. It also needs a step-up, because
 * an unattended session is exactly the thing that must not be able to do this.
 */
export async function initiateBreakGlass(formData: FormData): Promise<void> {
  const subjectPcid = String(formData.get('subjectPcid') ?? '').trim();
  const caseRef = String(formData.get('caseRef') ?? '').trim();
  const incidentRef = String(formData.get('incidentRef') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  const gates = formData.getAll('gate').map((value) => String(value));

  if (gates.length === 0) redirect('/authorisation?error=gates#break-glass');
  if (reason.length < 20) redirect('/authorisation?error=reason#break-glass');

  const result = await callApi<{ reference: string; expiresAt: string; reviewDueAt: string }>(
    '/api/v1/break-glass',
    {
      method: 'POST',
      body: {
        resourceType: 'CITIZEN',
        subjectPcid: subjectPcid === '' ? null : subjectPcid,
        caseRef: caseRef === '' ? null : caseRef,
        incidentRef: incidentRef === '' ? null : incidentRef,
        gates,
        reason,
      },
    },
  );

  if (!result.ok) {
    if (result.error.code === 'STEP_UP_REQUIRED') {
      redirect(`/step-up?return=${encodeURIComponent('/authorisation#break-glass')}`);
    }
    redirect(
      `/authorisation?error=failed&message=${encodeURIComponent(result.error.message)}#break-glass`,
    );
  }
  redirect(
    `/authorisation?granted=${encodeURIComponent(result.data.reference)}&expires=${encodeURIComponent(result.data.expiresAt)}#break-glass`,
  );
}

/** Record the mandatory post-event review of somebody's emergency access. */
export async function reviewBreakGlass(formData: FormData): Promise<void> {
  const reference = String(formData.get('reference') ?? '');
  const decision = String(formData.get('decision') ?? '');
  const note = String(formData.get('note') ?? '').trim();
  if (note.length < 5) redirect('/authorisation?error=note#reviews');

  const result = await callApi<{ status: string }>(
    `/api/v1/break-glass/${encodeURIComponent(reference)}/review`,
    { method: 'POST', body: { decision, note } },
  );
  if (!result.ok) {
    redirect(
      `/authorisation?error=failed&message=${encodeURIComponent(result.error.message)}#reviews`,
    );
  }
  redirect('/authorisation?reviewed=1#reviews');
}
