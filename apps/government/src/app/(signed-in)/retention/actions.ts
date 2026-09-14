'use server';

import { redirect } from 'next/navigation';

import { callApi } from '@/lib/api';

/**
 * Apply the schedule, or count what applying it would take.
 *
 * `dryRun` is read from the button that was pressed rather than from a checkbox,
 * so the irreversible one cannot be reached by leaving a box in the state
 * somebody else left it in. The API defaults to a dry run for the same reason.
 */
export async function runRetentionSweep(formData: FormData): Promise<void> {
  const dryRun = String(formData.get('mode') ?? 'dry') !== 'erase';

  const result = await callApi<{ reference: string; rowsAffected: number; moreRemaining: boolean }>(
    '/api/v1/retention/runs',
    { method: 'POST', body: { dryRun } },
  );

  if (!result.ok) {
    redirect(`/retention?error=${result.error.code === 'STEP_UP_REQUIRED' ? 'stepup' : 'failed'}`);
  }

  const outcome = dryRun ? 'counted' : 'erased';
  redirect(
    `/retention?${outcome}=${result.data.rowsAffected}` +
      `&more=${result.data.moreRemaining ? '1' : '0'}`,
  );
}
