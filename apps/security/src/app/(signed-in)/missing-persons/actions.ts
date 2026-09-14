'use server';

import { redirect } from 'next/navigation';

import { callApi } from '@/lib/api';

export async function reportMissingPerson(formData: FormData): Promise<void> {
  const text = (key: string): string => String(formData.get(key) ?? '').trim();
  const optional = (key: string): string | null => (text(key) === '' ? null : text(key));

  const fullName = text('fullName');
  const circumstances = text('circumstances');
  if (fullName === '' || circumstances.length < 5)
    redirect('/missing-persons?error=missing#report');

  const ageRaw = text('ageYears');
  const result = await callApi<{ caseReference: string }>('/api/v1/missing-persons', {
    method: 'POST',
    body: {
      fullName,
      ageYears: ageRaw === '' ? null : Number(ageRaw),
      sex: optional('sex'),
      circumstances,
      physicalDescription: optional('physicalDescription'),
      clothingDescription: optional('clothingDescription'),
      distinguishingFeatures: optional('distinguishingFeatures'),
      lastSeenAddress: optional('lastSeenAddress'),
      lastSeenLgaCode: optional('lastSeenLgaCode'),
      citizenPcid: optional('citizenPcid'),
      reporterName: optional('reporterName'),
      reporterPhone: optional('reporterPhone'),
      reporterRelationship: optional('reporterRelationship'),
    },
  });

  if (!result.ok) {
    redirect(
      `/missing-persons?error=failed&message=${encodeURIComponent(result.error.message)}#report`,
    );
  }
  redirect(`/missing-persons/${encodeURIComponent(result.data.caseReference)}?reported=1`);
}
