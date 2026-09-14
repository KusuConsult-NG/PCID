'use server';

import { redirect } from 'next/navigation';

import { callApi } from '@/lib/api';

interface Registered {
  status: 'ISSUED' | 'DUPLICATE_REVIEW';
  reference: string;
  pcid?: string;
  candidates?: unknown[];
}

/**
 * Register a resident.
 *
 * A close match to somebody already registered stops this: no identifier is
 * issued and nothing is merged. The officer is told, and it goes to the
 * duplicate queue for a person to decide.
 */
export async function registerResident(formData: FormData): Promise<void> {
  const text = (key: string): string => String(formData.get(key) ?? '').trim();
  const optional = (key: string): string | null => (text(key) === '' ? null : text(key));

  const body = {
    givenName: text('givenName'),
    middleName: optional('middleName'),
    familyName: text('familyName'),
    sex: text('sex'),
    dateOfBirth: text('dateOfBirth'),
    phonePrimary: optional('phonePrimary'),
    phoneSecondary: optional('phoneSecondary'),
    email: optional('email'),
    residentialAddress: optional('residentialAddress'),
    lgaCode: optional('lgaCode'),
    wardCode: optional('wardCode'),
    // A NIN is accepted where an authoritative source supplied one and is never
    // required: the Plateau Citizen ID does not depend on it.
    nin: optional('nin'),
    channel: 'REGISTRATION_DESK',
  };

  if (body.givenName === '' || body.familyName === '' || body.dateOfBirth === '') {
    redirect('/register?error=missing');
  }

  const result = await callApi<Registered>('/api/v1/citizens', { method: 'POST', body });

  if (!result.ok) {
    const detail = result.error.details?.[0]?.message;
    redirect(
      `/register?error=failed${detail === undefined ? '' : `&detail=${encodeURIComponent(detail)}`}`,
    );
  }

  redirect(
    result.data.status === 'ISSUED'
      ? `/register?issued=${encodeURIComponent(result.data.pcid ?? '')}`
      : `/register?queued=${encodeURIComponent(result.data.reference)}`,
  );
}

/** Issue portal credentials to somebody standing at the desk. */
export async function issuePortalCredentials(formData: FormData): Promise<void> {
  const pcid = String(formData.get('pcid') ?? '').trim();
  const result = await callApi<{ pcid: string; temporaryPassword: string }>(
    `/api/v1/citizens/${encodeURIComponent(pcid)}/portal-account`,
    { method: 'POST' },
  );

  if (!result.ok) {
    redirect(
      `/register?error=${result.error.code === 'CONFLICT' ? 'account-exists' : 'account-failed'}`,
    );
  }
  redirect(
    `/register?issued=${encodeURIComponent(result.data.pcid)}&passphrase=${encodeURIComponent(result.data.temporaryPassword)}`,
  );
}
