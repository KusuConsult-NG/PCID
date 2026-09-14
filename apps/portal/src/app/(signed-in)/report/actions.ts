'use server';

import { redirect } from 'next/navigation';

import { callApi } from '@/lib/api';

export async function raiseEmergency(formData: FormData): Promise<void> {
  const description = String(formData.get('description') ?? '').trim();
  const type = String(formData.get('type') ?? 'MEDICAL_EMERGENCY');
  const shareLocation = formData.get('shareLocation') === 'on';
  const latitude = Number(formData.get('latitude') ?? '');
  const longitude = Number(formData.get('longitude') ?? '');

  if (description.length < 5) redirect('/report?error=description#emergency');

  const body: Record<string, unknown> = { type, description };
  // Coordinates are sent only when the resident asked to share them and the
  // browser actually produced them.
  if (shareLocation && Number.isFinite(latitude) && Number.isFinite(longitude)) {
    body.latitude = latitude;
    body.longitude = longitude;
  }

  const result = await callApi<{ incidentNumber: string }>('/api/v1/me/emergency', {
    method: 'POST',
    body,
  });

  redirect(
    result.ok
      ? `/report?emergency=${encodeURIComponent(result.data.incidentNumber)}`
      : '/report?error=failed#emergency',
  );
}

export async function reportMissingPerson(formData: FormData): Promise<void> {
  const fullName = String(formData.get('fullName') ?? '').trim();
  const circumstances = String(formData.get('circumstances') ?? '').trim();
  const lastSeenAddress = String(formData.get('lastSeenAddress') ?? '').trim();
  const description = String(formData.get('physicalDescription') ?? '').trim();
  const ageRaw = String(formData.get('ageYears') ?? '').trim();
  const phone = String(formData.get('reporterPhone') ?? '').trim();
  const relationship = String(formData.get('reporterRelationship') ?? '').trim();

  if (fullName === '' || circumstances.length < 5) {
    redirect('/report?error=missing-person#missing-person');
  }

  const result = await callApi<{ caseReference: string }>('/api/v1/missing-persons', {
    method: 'POST',
    body: {
      fullName,
      ageYears: ageRaw === '' ? null : Number(ageRaw),
      circumstances,
      lastSeenAddress: lastSeenAddress === '' ? null : lastSeenAddress,
      physicalDescription: description === '' ? null : description,
      reporterPhone: phone === '' ? null : phone,
      reporterRelationship: relationship === '' ? null : relationship,
    },
  });

  redirect(
    result.ok
      ? `/report?missing=${encodeURIComponent(result.data.caseReference)}`
      : '/report?error=failed#missing-person',
  );
}

export async function reportIdentityFraud(formData: FormData): Promise<void> {
  const description = String(formData.get('description') ?? '').trim();
  if (description.length < 10) redirect('/report?error=description#identity-fraud');

  const result = await callApi<{ reference: string }>('/api/v1/me/reports/identity-fraud', {
    method: 'POST',
    body: { description },
  });
  redirect(
    result.ok
      ? `/report?fraud=${encodeURIComponent(result.data.reference)}`
      : '/report?error=failed#identity-fraud',
  );
}

export async function reportUnauthorisedAccess(formData: FormData): Promise<void> {
  const description = String(formData.get('description') ?? '').trim();
  const accessReference = String(formData.get('accessReference') ?? '').trim();
  if (description.length < 10) redirect('/report?error=description#unauthorised-access');

  const result = await callApi<{ reference: string }>('/api/v1/me/reports/unauthorised-access', {
    method: 'POST',
    body: { description, accessReference: accessReference === '' ? null : accessReference },
  });
  redirect(
    result.ok
      ? `/report?access=${encodeURIComponent(result.data.reference)}`
      : '/report?error=failed#unauthorised-access',
  );
}
