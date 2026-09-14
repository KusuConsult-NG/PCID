'use server';

import { redirect } from 'next/navigation';

import { callApi } from '@/lib/api';

/**
 * Put an abandoned message back on the queue.
 *
 * For after the gateway was fixed. It changes nothing about what will be sent:
 * what a message says was decided by its template when it was raised, and this
 * only makes it due again.
 */
export async function retryNotification(formData: FormData): Promise<void> {
  const id = String(formData.get('notificationId') ?? '');
  const note = String(formData.get('note') ?? '').trim();
  if (note.length < 5) redirect('/administration?error=note#delivery');

  const result = await callApi(`/api/v1/notifications/${encodeURIComponent(id)}/retry`, {
    method: 'POST',
    body: { note },
  });
  if (!result.ok) {
    redirect(
      `/administration?error=failed&message=${encodeURIComponent(result.error.message)}#delivery`,
    );
  }
  redirect('/administration?requeued=1#delivery');
}

/** Run a delivery sweep now, rather than waiting for the worker's next tick. */
export async function sweepNotifications(): Promise<void> {
  const result = await callApi<{ claimed: number; sent: number }>('/api/v1/notifications/sweep', {
    method: 'POST',
  });
  if (!result.ok) {
    redirect(
      `/administration?error=failed&message=${encodeURIComponent(result.error.message)}#delivery`,
    );
  }
  redirect(`/administration?swept=${result.data.sent}&claimed=${result.data.claimed}#delivery`);
}
