'use server';

import { redirect } from 'next/navigation';

import { callApi } from '@/lib/api';

export async function requestCorrection(formData: FormData): Promise<void> {
  const fieldPath = String(formData.get('fieldPath') ?? '');
  const requestedValue = String(formData.get('requestedValue') ?? '').trim();
  const justification = String(formData.get('justification') ?? '').trim();
  const evidence = String(formData.get('evidenceReference') ?? '').trim();

  if (requestedValue === '' || justification.length < 5) {
    redirect('/corrections?error=missing');
  }

  const result = await callApi<{ reference: string }>('/api/v1/me/correction-requests', {
    method: 'POST',
    body: {
      fieldPath,
      requestedValue,
      justification,
      evidenceReference: evidence === '' ? null : evidence,
    },
  });

  redirect(
    result.ok
      ? `/corrections?submitted=${encodeURIComponent(result.data.reference)}`
      : '/corrections?error=failed',
  );
}
