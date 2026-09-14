'use server';

import { redirect } from 'next/navigation';

import { callApi } from '@/lib/api';

/** Ask for fields the engine withheld, with a reason an approver can weigh. */
export async function requestAccess(formData: FormData): Promise<void> {
  const pcid = String(formData.get('pcid') ?? '');
  const purpose = String(formData.get('purpose') ?? '');
  const fields = String(formData.get('requestedFields') ?? '')
    .split(/[,\s]+/)
    .map((field) => field.trim())
    .filter((field) => field !== '');
  const justification = String(formData.get('justification') ?? '').trim();

  const back = `/person/${encodeURIComponent(pcid)}?purpose=${encodeURIComponent(purpose)}`;
  if (fields.length === 0 || justification.length < 10) redirect(`${back}&error=request`);

  const result = await callApi<{ reference: string; status: string; message: string }>(
    '/api/v1/access-requests',
    {
      method: 'POST',
      body: {
        purpose,
        resourceType: 'CITIZEN',
        subjectPcid: pcid,
        requestedFields: fields,
        justification,
      },
    },
  );

  redirect(
    result.ok
      ? `${back}&requested=${encodeURIComponent(result.data.reference)}&outcome=${encodeURIComponent(result.data.status)}`
      : `${back}&error=request-failed`,
  );
}

/** Raise a correction on somebody else's behalf, from the counter. */
export async function raiseCorrection(formData: FormData): Promise<void> {
  const pcid = String(formData.get('pcid') ?? '');
  const purpose = String(formData.get('purpose') ?? '');
  const fieldPath = String(formData.get('fieldPath') ?? '');
  const requestedValue = String(formData.get('requestedValue') ?? '').trim();
  const justification = String(formData.get('justification') ?? '').trim();

  const back = `/person/${encodeURIComponent(pcid)}?purpose=${encodeURIComponent(purpose)}`;
  if (requestedValue === '' || justification.length < 5) redirect(`${back}&error=correction`);

  const result = await callApi<{ reference: string }>(
    `/api/v1/citizens/${encodeURIComponent(pcid)}/correction-requests`,
    { method: 'POST', body: { fieldPath, requestedValue, justification } },
  );

  redirect(
    result.ok
      ? `${back}&corrected=${encodeURIComponent(result.data.reference)}`
      : `${back}&error=correction-failed`,
  );
}
