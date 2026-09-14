'use server';

import { redirect } from 'next/navigation';

import { callApi } from '@/lib/api';

export async function markRead(formData: FormData): Promise<void> {
  const id = String(formData.get('notificationId') ?? '');
  await callApi(`/api/v1/me/notifications/${id}/read`, { method: 'POST' });
  redirect('/notifications');
}
