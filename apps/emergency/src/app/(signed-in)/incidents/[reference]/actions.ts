'use server';

import { redirect } from 'next/navigation';

import { callApi } from '@/lib/api';

const back = (reference: string, query = ''): string =>
  `/incidents/${encodeURIComponent(reference)}${query}`;

/** Send a unit. This also attaches its service, which is how a crew gets access. */
export async function dispatchUnit(formData: FormData): Promise<void> {
  const reference = String(formData.get('reference') ?? '');
  const unitCode = String(formData.get('unitCode') ?? '').trim();
  const note = String(formData.get('note') ?? '').trim();
  if (unitCode === '') redirect(back(reference, '?error=unit#units'));

  const result = await callApi(`/api/v1/incidents/${encodeURIComponent(reference)}/dispatch`, {
    method: 'POST',
    body: { unitCode, note: note === '' ? null : note },
  });
  if (!result.ok) {
    redirect(
      back(reference, `?error=failed&message=${encodeURIComponent(result.error.message)}#units`),
    );
  }
  redirect(back(reference, `?dispatched=${encodeURIComponent(unitCode)}#units`));
}

/** Move a dispatch along as the job runs. The timestamps are the response times. */
export async function updateDispatch(formData: FormData): Promise<void> {
  const reference = String(formData.get('reference') ?? '');
  const dispatchId = String(formData.get('dispatchId') ?? '');
  const status = String(formData.get('status') ?? '');
  const note = String(formData.get('note') ?? '').trim();

  const result = await callApi(`/api/v1/dispatches/${encodeURIComponent(dispatchId)}`, {
    method: 'PATCH',
    body: { status, note: note === '' ? null : note },
  });
  if (!result.ok) {
    redirect(
      back(reference, `?error=failed&message=${encodeURIComponent(result.error.message)}#units`),
    );
  }
  redirect(back(reference, `?moved=${encodeURIComponent(status)}#units`));
}

/** Move the incident itself. */
export async function updateIncidentStatus(formData: FormData): Promise<void> {
  const reference = String(formData.get('reference') ?? '');
  const status = String(formData.get('status') ?? '');
  const note = String(formData.get('note') ?? '').trim();

  const result = await callApi(`/api/v1/incidents/${encodeURIComponent(reference)}/status`, {
    method: 'PATCH',
    body: { status, note: note === '' ? null : note },
  });
  if (!result.ok) {
    redirect(
      back(reference, `?error=failed&message=${encodeURIComponent(result.error.message)}#details`),
    );
  }

  redirect(back(reference, `?status=${encodeURIComponent(status)}#details`));
}

/**
 * Attach an officer.
 *
 * The ordinary answer to "I am not attached": control does this, and it takes
 * seconds. It is also the act that opens the casualties' details to them, which
 * is why the platform requires the person doing it to be on the incident too.
 */
export async function attachOfficer(formData: FormData): Promise<void> {
  const reference = String(formData.get('reference') ?? '');
  const userId = String(formData.get('userId') ?? '').trim();
  const role = String(formData.get('role') ?? 'RESPONDER');
  if (userId === '') redirect(back(reference, '?error=officer#people'));

  const result = await callApi(`/api/v1/incidents/${encodeURIComponent(reference)}/officers`, {
    method: 'POST',
    body: { userId, role },
  });
  if (!result.ok) {
    redirect(
      back(reference, `?error=failed&message=${encodeURIComponent(result.error.message)}#people`),
    );
  }
  redirect(back(reference, '?attached=1#people'));
}

/** Record who somebody at the scene is. This is what an identification records. */
export async function attachPerson(formData: FormData): Promise<void> {
  const reference = String(formData.get('reference') ?? '');
  const citizenPcid = String(formData.get('citizenPcid') ?? '')
    .trim()
    .toUpperCase();
  const role = String(formData.get('role') ?? 'CASUALTY');
  const note = String(formData.get('note') ?? '').trim();
  if (citizenPcid === '') redirect(back(reference, '?error=person#people'));

  const result = await callApi(`/api/v1/incidents/${encodeURIComponent(reference)}/persons`, {
    method: 'POST',
    body: { citizenPcid, role, note: note === '' ? null : note },
  });
  if (!result.ok) {
    redirect(
      back(reference, `?error=failed&message=${encodeURIComponent(result.error.message)}#people`),
    );
  }
  redirect(back(reference, '?person=1#people'));
}
