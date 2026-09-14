'use server';

import { redirect } from 'next/navigation';

import { callApi } from '@/lib/api';

/**
 * Decide whether two records are the same person.
 *
 * Only a person can do this (§51). Confirming a duplicate rejects the pending
 * registration; ruling them distinct lets it proceed and a Plateau Citizen ID is
 * issued. Neither merges anything.
 */
export async function decideDuplicate(formData: FormData): Promise<void> {
  const candidateId = String(formData.get('candidateId') ?? '');
  const decision = String(formData.get('decision') ?? '');
  const note = String(formData.get('note') ?? '').trim();

  if (note.length < 5) redirect('/duplicates?error=note');
  if (decision !== 'CONFIRMED_DUPLICATE' && decision !== 'DISTINCT_PERSON') {
    redirect('/duplicates?error=decision');
  }

  const result = await callApi<{ status: string; issuedPcid: string | null }>(
    `/api/v1/citizens/duplicates/${encodeURIComponent(candidateId)}/review`,
    { method: 'POST', body: { decision, note } },
  );

  if (!result.ok) redirect('/duplicates?error=failed');
  redirect(
    result.data.issuedPcid === null
      ? `/duplicates?decided=${decision}`
      : `/duplicates?decided=${decision}&issued=${encodeURIComponent(result.data.issuedPcid)}`,
  );
}
