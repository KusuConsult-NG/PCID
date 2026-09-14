'use server';

import { redirect } from 'next/navigation';

import { callApi } from '@/lib/api';
import { readSession, writeSession } from '@/lib/session';

/** Put a vehicle or crew on the platform. Fleet administration, not citizen data. */
export async function registerUnit(formData: FormData): Promise<void> {
  const text = (key: string): string => String(formData.get(key) ?? '').trim();
  const unitCode = text('unitCode').toUpperCase();
  if (unitCode === '') redirect('/units?error=code#register');

  const result = await callApi<{ unitCode: string }>('/api/v1/response-units', {
    method: 'POST',
    body: {
      unitCode,
      type: text('type') === '' ? 'EMERGENCY_VEHICLE' : text('type'),
      homeLgaCode: text('homeLgaCode') === '' ? null : text('homeLgaCode'),
      homeWardCode: text('homeWardCode') === '' ? null : text('homeWardCode'),
      capabilities: text('capabilities')
        .split(',')
        .map((entry) => entry.trim().toUpperCase().replace(/\s+/g, '_'))
        .filter((entry) => entry !== ''),
      contactPhone: text('contactPhone') === '' ? null : text('contactPhone'),
      status: text('status') === 'AVAILABLE' ? 'AVAILABLE' : 'OFFLINE',
    },
  });

  if (!result.ok) {
    redirect(
      `/units?error=${result.error.code === 'CONFLICT' ? 'duplicate' : 'failed'}&message=${encodeURIComponent(result.error.message)}#register`,
    );
  }
  redirect(`/units?registered=${encodeURIComponent(result.data.unitCode)}`);
}

/** Put a unit into service, or take it out. Nothing operational is set here. */
export async function setUnitService(formData: FormData): Promise<void> {
  const unitCode = String(formData.get('unitCode') ?? '');
  const status = String(formData.get('status') ?? '');

  const result = await callApi(`/api/v1/response-units/${encodeURIComponent(unitCode)}`, {
    method: 'PATCH',
    body: { status },
  });
  if (!result.ok) {
    redirect(
      `/units?error=${result.error.code === 'CONFLICT' ? 'onajob' : 'failed'}&message=${encodeURIComponent(result.error.message)}`,
    );
  }
  redirect(`/units?service=${encodeURIComponent(status)}`);
}

/**
 * A unit reporting where it is.
 *
 * The only live position the platform holds, reported by the unit about itself.
 * The browser asks the crew first, and a refusal changes nothing except that
 * control keeps the last position it had.
 */
export async function reportPosition(formData: FormData): Promise<void> {
  const unitCode = String(formData.get('unitCode') ?? '')
    .trim()
    .toUpperCase();
  const latitude = String(formData.get('latitude') ?? '').trim();
  const longitude = String(formData.get('longitude') ?? '').trim();

  if (unitCode === '' || latitude === '' || longitude === '') {
    redirect('/units?error=position#position');
  }

  const result = await callApi(`/api/v1/response-units/${encodeURIComponent(unitCode)}/position`, {
    method: 'POST',
    body: { latitude: Number(latitude), longitude: Number(longitude) },
  });
  if (!result.ok) {
    redirect(`/units?error=failed&message=${encodeURIComponent(result.error.message)}#position`);
  }

  const session = await readSession();
  if (session !== null) await writeSession({ ...session, workingUnit: unitCode });
  redirect(`/units?position=${encodeURIComponent(unitCode)}#position`);
}
