'use server';

import { redirect } from 'next/navigation';

import { callApi } from '@/lib/api';

const back = (reference: string, query = ''): string =>
  `/missing-persons/${encodeURIComponent(reference)}${query}`;

export async function reviseEnquiry(formData: FormData): Promise<void> {
  const reference = String(formData.get('reference') ?? '');
  const text = (key: string): string => String(formData.get(key) ?? '').trim();

  const body: Record<string, unknown> = {};
  const status = text('status');
  if (status !== '') body.status = status;
  for (const key of ['physicalDescription', 'clothingDescription', 'circumstances'] as const) {
    const value = text(key);
    if (value !== '') body[key] = value;
  }
  if (Object.keys(body).length === 0) redirect(back(reference, '?error=nothing#revise'));

  const result = await callApi(`/api/v1/missing-persons/${encodeURIComponent(reference)}`, {
    method: 'PATCH',
    body,
  });
  redirect(
    back(
      reference,
      result.ok
        ? '?revised=1#revise'
        : `?error=failed&message=${encodeURIComponent(result.error.message)}#revise`,
    ),
  );
}

/**
 * Record a sighting.
 *
 * It arrives unverified and stays that way until an officer says otherwise. An
 * unverified sighting that reads as a fact sends a search team to the wrong
 * ward.
 */
export async function reportSighting(formData: FormData): Promise<void> {
  const reference = String(formData.get('reference') ?? '');
  const description = String(formData.get('description') ?? '').trim();
  const addressText = String(formData.get('addressText') ?? '').trim();
  const lgaCode = String(formData.get('lgaCode') ?? '').trim();
  const reporterName = String(formData.get('reporterName') ?? '').trim();

  if (description.length < 5) redirect(back(reference, '?error=sighting#sightings'));

  const result = await callApi(
    `/api/v1/missing-persons/${encodeURIComponent(reference)}/sightings`,
    {
      method: 'POST',
      body: {
        description,
        addressText: addressText === '' ? null : addressText,
        lgaCode: lgaCode === '' ? null : lgaCode,
        reporterName: reporterName === '' ? null : reporterName,
      },
    },
  );
  redirect(back(reference, result.ok ? '?sighted=1#sightings' : '?error=failed#sightings'));
}

export async function reviewSighting(formData: FormData): Promise<void> {
  const reference = String(formData.get('reference') ?? '');
  const sightingId = String(formData.get('sightingId') ?? '');
  const verificationStatus = String(formData.get('verificationStatus') ?? '');

  const result = await callApi(`/api/v1/sightings/${encodeURIComponent(sightingId)}/verification`, {
    method: 'POST',
    body: { verificationStatus },
  });
  redirect(back(reference, result.ok ? '?reviewed=1#sightings' : '?error=failed#sightings'));
}

/** Ask the engine for candidates. It produces candidates and never a verdict. */
export async function runMatching(formData: FormData): Promise<void> {
  const reference = String(formData.get('reference') ?? '');
  const result = await callApi(
    `/api/v1/missing-persons/${encodeURIComponent(reference)}/matches/run`,
    { method: 'POST' },
  );
  redirect(back(reference, result.ok ? '?matched=1#candidates' : '?error=failed#candidates'));
}

/**
 * Decide a candidate.
 *
 * A person decides, never a score. The database refuses a confirmed match with
 * no named reviewer, so this is the only way one is ever made.
 */
export async function decideMatch(formData: FormData): Promise<void> {
  const reference = String(formData.get('reference') ?? '');
  const matchId = String(formData.get('matchId') ?? '');
  const decision = String(formData.get('decision') ?? '');
  const note = String(formData.get('note') ?? '').trim();

  if (note.length < 5) redirect(back(reference, '?error=matchnote#candidates'));

  const result = await callApi(`/api/v1/matches/${encodeURIComponent(matchId)}/review`, {
    method: 'POST',
    body: { decision, note },
  });
  redirect(
    back(
      reference,
      result.ok
        ? `?decided=${encodeURIComponent(decision)}#candidates`
        : `?error=failed&message=${encodeURIComponent(result.error.message)}#candidates`,
    ),
  );
}

export async function resolveEnquiry(formData: FormData): Promise<void> {
  const reference = String(formData.get('reference') ?? '');
  const outcome = String(formData.get('outcome') ?? '');
  const note = String(formData.get('note') ?? '').trim();
  if (note.length < 5) redirect(back(reference, '?error=resolution#resolve'));

  const result = await callApi(`/api/v1/missing-persons/${encodeURIComponent(reference)}/resolve`, {
    method: 'POST',
    body: { status: outcome, note },
  });
  redirect(
    back(
      reference,
      result.ok
        ? '?resolved=1'
        : `?error=failed&message=${encodeURIComponent(result.error.message)}#resolve`,
    ),
  );
}
