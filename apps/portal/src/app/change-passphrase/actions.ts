'use server';

import { redirect } from 'next/navigation';

import { callApi } from '@/lib/api';
import { readSession, writeSession } from '@/lib/session';

export async function changePassphrase(formData: FormData): Promise<void> {
  const currentPassword = String(formData.get('currentPassword') ?? '');
  const newPassword = String(formData.get('newPassword') ?? '');
  const confirmPassword = String(formData.get('confirmPassword') ?? '');

  if (newPassword !== confirmPassword) {
    redirect('/change-passphrase?error=mismatch');
  }

  const result = await callApi<{ otherSessionsEnded: number }>('/api/v1/me/password', {
    method: 'POST',
    body: { currentPassword, newPassword },
  });

  if (!result.ok) {
    const code =
      result.error.code === 'UNAUTHENTICATED'
        ? 'current'
        : result.error.code === 'VALIDATION_FAILED'
          ? 'policy'
          : 'failed';
    const detail = result.error.details?.[0]?.message;
    redirect(
      `/change-passphrase?error=${code}${detail === undefined ? '' : `&detail=${encodeURIComponent(detail)}`}`,
    );
  }

  const session = await readSession();
  if (session !== null) {
    await writeSession({ ...session, mustChangePassword: false });
  }
  redirect('/dashboard?passphrase-changed=1');
}
