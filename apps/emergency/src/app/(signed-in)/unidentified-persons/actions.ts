'use server';

import { redirect } from 'next/navigation';

import { callApi } from '@/lib/api';

/**
 * Record somebody found who cannot say who they are.
 *
 * Written for somebody standing over a person, so the form asks only what can
 * actually be observed. There is no field for who the person is: an identity
 * comes from a missing-persons officer confirming a candidate match by name,
 * never from a responder typing an identifier into this record.
 */
export async function recordUnidentifiedPerson(formData: FormData): Promise<void> {
  const text = (key: string): string => String(formData.get(key) ?? '').trim();
  const optional = (key: string): string | null => (text(key) === '' ? null : text(key));
  const number = (key: string): number | null => (text(key) === '' ? null : Number(text(key)));

  const physicalDescription = text('physicalDescription');
  if (physicalDescription.length < 5) redirect('/unidentified-persons?error=description#record');

  const incidentRef = text('incidentRef');
  const path =
    incidentRef === ''
      ? '/api/v1/unidentified-persons'
      : `/api/v1/unidentified-persons?incidentRef=${encodeURIComponent(incidentRef)}`;

  const result = await callApi<{ reference: string }>(path, {
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
      foundWardCode: optional('foundWardCode'),
    },
  });

  if (!result.ok) {
    redirect(
      `/unidentified-persons?error=failed&message=${encodeURIComponent(result.error.message)}#record`,
    );
  }
  redirect(`/unidentified-persons?recorded=${encodeURIComponent(result.data.reference)}`);
}
