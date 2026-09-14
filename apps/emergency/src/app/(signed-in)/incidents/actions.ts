'use server';

import { redirect } from 'next/navigation';

import { callApi } from '@/lib/api';
import { readSession, writeSession } from '@/lib/session';

/** Take a call. The incident is the authority for everything that follows. */
export async function reportIncident(formData: FormData): Promise<void> {
  const text = (key: string): string => String(formData.get(key) ?? '').trim();
  const description = text('description');
  if (description.length < 5) redirect('/incidents?error=description#report');

  const latitude = text('latitude');
  const longitude = text('longitude');

  const result = await callApi<{ incidentNumber: string }>('/api/v1/incidents', {
    method: 'POST',
    body: {
      type: text('type') === '' ? 'OTHER' : text('type'),
      severity: text('severity') === '' ? 'MEDIUM' : text('severity'),
      description,
      addressText: text('addressText') === '' ? null : text('addressText'),
      lgaCode: text('lgaCode') === '' ? null : text('lgaCode'),
      wardCode: text('wardCode') === '' ? null : text('wardCode'),
      latitude: latitude === '' ? null : Number(latitude),
      longitude: longitude === '' ? null : Number(longitude),
      reporterContact: text('reporterContact') === '' ? null : text('reporterContact'),
    },
  });

  if (!result.ok) {
    redirect(`/incidents?error=failed&message=${encodeURIComponent(result.error.message)}#report`);
  }
  redirect(`/incidents/${encodeURIComponent(result.data.incidentNumber)}?opened=1`);
}

/**
 * Say which incident you are attending.
 *
 * A convenience for the identify screen and nothing more: it is sent as the
 * incident reference on each request and the engine decides afresh every time.
 */
export async function setWorkingIncident(formData: FormData): Promise<void> {
  const reference = String(formData.get('reference') ?? '').trim();
  const summary = String(formData.get('summary') ?? '').trim();
  const back = String(formData.get('return') ?? '/incidents');

  const session = await readSession();
  if (session === null) redirect('/sign-in');

  await writeSession({
    ...session,
    workingIncident: reference === '' ? null : { reference, summary },
  });
  redirect(back.startsWith('/') && !back.startsWith('//') ? back : '/incidents');
}
