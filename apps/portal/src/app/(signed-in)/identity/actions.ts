'use server';

import { redirect } from 'next/navigation';

import { callApi } from '@/lib/api';

export async function reportCredentialLost(formData: FormData): Promise<void> {
  const reason = String(formData.get('reason') ?? '').trim();
  if (reason.length < 5) redirect('/identity?error=reason');

  const result = await callApi('/api/v1/me/credential/report-lost', {
    method: 'POST',
    body: { reason },
  });
  redirect(result.ok ? '/identity?reported=1' : '/identity?error=failed');
}
