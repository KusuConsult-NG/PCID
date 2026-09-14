'use server';

import { redirect } from 'next/navigation';

import { callApi } from '@/lib/api';

export async function recordUnidentifiedPerson(formData: FormData): Promise<void> {
  const text = (key: string): string => String(formData.get(key) ?? '').trim();
  const optional = (key: string): string | null => (text(key) === '' ? null : text(key));
  const number = (key: string): number | null => (text(key) === '' ? null : Number(text(key)));

  const physicalDescription = text('physicalDescription');
  if (physicalDescription.length < 5) redirect('/unidentified-persons?error=description#record');

  const result = await callApi<{ reference: string }>('/api/v1/unidentified-persons', {
    method: 'POST',
    body: {
      condition: text('condition') === '' ? 'UNKNOWN' : text('condition'),
      estimatedAgeMin: number('estimatedAgeMin'),
      estimatedAgeMax: number('estimatedAgeMax'),
      apparentSex: optional('apparentSex'),
      physicalDescription,
      clothingDescription: optional('clothingDescription'),
      distinguishingFeatures: optional('distinguishingFeatures'),
      identityClues: optional('identityClues'),
      foundAddress: optional('foundAddress'),
      foundLgaCode: optional('foundLgaCode'),
    },
  });

  if (!result.ok) {
    redirect(
      `/unidentified-persons?error=failed&message=${encodeURIComponent(result.error.message)}#record`,
    );
  }
  redirect(`/unidentified-persons/${encodeURIComponent(result.data.reference)}?recorded=1`);
}

export async function updateUnidentifiedPerson(formData: FormData): Promise<void> {
  const reference = String(formData.get('reference') ?? '');
  const text = (key: string): string => String(formData.get(key) ?? '').trim();

  const body: Record<string, unknown> = {};
  for (const key of [
    'status',
    'condition',
    'physicalDescription',
    'clothingDescription',
    'distinguishingFeatures',
    'identityClues',
  ] as const) {
    const value = text(key);
    if (value !== '') body[key] = value;
  }
  const back = `/unidentified-persons/${encodeURIComponent(reference)}`;
  if (Object.keys(body).length === 0) redirect(`${back}?error=nothing#revise`);

  const result = await callApi(`/api/v1/unidentified-persons/${encodeURIComponent(reference)}`, {
    method: 'PATCH',
    body,
  });
  redirect(
    result.ok
      ? `${back}?revised=1#revise`
      : `${back}?error=failed&message=${encodeURIComponent(result.error.message)}#revise`,
  );
}
