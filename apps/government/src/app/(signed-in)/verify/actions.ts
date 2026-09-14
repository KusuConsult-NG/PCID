'use server';

import { redirect } from 'next/navigation';

import { callApi } from '@/lib/api';

interface VerifyResult {
  valid: boolean;
  status: string | null;
  verificationLevel: string | null;
  displayName: string | null;
}

/**
 * Check a Plateau Citizen ID somebody has presented.
 *
 * The answer is deliberately thin: whether the identifier is live, at what
 * assurance, and the name printed on the credential. It is not a way to look
 * somebody up — opening the record is a separate act under a stated purpose.
 */
export async function verifyPcid(formData: FormData): Promise<void> {
  const pcid = String(formData.get('pcid') ?? '')
    .trim()
    .toUpperCase();
  if (pcid === '') redirect('/verify?error=missing');

  const result = await callApi<VerifyResult>('/api/v1/verification/pcid', {
    method: 'POST',
    body: { pcid },
  });

  if (!result.ok) {
    const code = result.error.code === 'VALIDATION_FAILED' ? 'format' : 'failed';
    redirect(`/verify?error=${code}`);
  }

  const query = new URLSearchParams({
    checked: pcid,
    valid: String(result.data.valid),
    ...(result.data.displayName === null ? {} : { name: result.data.displayName }),
    ...(result.data.status === null ? {} : { status: result.data.status }),
    ...(result.data.verificationLevel === null ? {} : { assurance: result.data.verificationLevel }),
  });
  redirect(`/verify?${query.toString()}`);
}

/** Resolve the opaque token from a scanned credential. */
export async function verifyScannedCode(formData: FormData): Promise<void> {
  const raw = String(formData.get('code') ?? '').trim();
  // Officers scan into the box with a reader, which types the whole URL.
  const token = raw.includes('/') ? (raw.split('/').pop() ?? '') : raw;
  if (token.length < 16) redirect('/verify?error=code#scanned');

  const result = await callApi<VerifyResult & { reason?: string }>(
    '/api/v1/verification/credential',
    { method: 'POST', body: { token } },
  );
  if (!result.ok) redirect('/verify?error=failed#scanned');

  const query = new URLSearchParams({
    scanned: '1',
    valid: String(result.data.valid),
    ...(result.data.displayName === null ? {} : { name: result.data.displayName }),
    ...(result.data.reason === undefined ? {} : { reason: result.data.reason }),
  });
  redirect(`/verify?${query.toString()}#scanned`);
}
