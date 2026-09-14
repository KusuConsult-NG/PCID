'use server';

import { redirect } from 'next/navigation';

import { callApi } from '@/lib/api';

function contactFrom(formData: FormData): {
  fullName: string;
  relationship: string;
  phonePrimary: string;
  phoneSecondary: string | null;
  priority: number;
} {
  const secondary = String(formData.get('phoneSecondary') ?? '').trim();
  return {
    fullName: String(formData.get('fullName') ?? '').trim(),
    relationship: String(formData.get('relationship') ?? '').trim(),
    phonePrimary: String(formData.get('phonePrimary') ?? '').trim(),
    phoneSecondary: secondary === '' ? null : secondary,
    priority: Number(formData.get('priority') ?? 1) || 1,
  };
}

export async function addContact(formData: FormData): Promise<void> {
  const contact = contactFrom(formData);
  if (contact.fullName === '' || contact.relationship === '' || contact.phonePrimary === '') {
    redirect('/emergency-contacts?error=missing');
  }
  const result = await callApi('/api/v1/me/emergency-contacts', { method: 'POST', body: contact });
  redirect(result.ok ? '/emergency-contacts?added=1' : '/emergency-contacts?error=failed');
}

export async function updateContact(formData: FormData): Promise<void> {
  const id = String(formData.get('contactId') ?? '');
  const contact = contactFrom(formData);
  const result = await callApi(`/api/v1/me/emergency-contacts/${id}`, {
    method: 'PATCH',
    body: contact,
  });
  redirect(result.ok ? '/emergency-contacts?updated=1' : '/emergency-contacts?error=failed');
}

export async function removeContact(formData: FormData): Promise<void> {
  const id = String(formData.get('contactId') ?? '');
  const result = await callApi(`/api/v1/me/emergency-contacts/${id}`, { method: 'DELETE' });
  redirect(result.ok ? '/emergency-contacts?removed=1' : '/emergency-contacts?error=failed');
}
