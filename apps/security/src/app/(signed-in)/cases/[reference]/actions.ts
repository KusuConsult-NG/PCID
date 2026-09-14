'use server';

import { redirect } from 'next/navigation';

import { callApi } from '@/lib/api';

const back = (reference: string, query = ''): string =>
  `/cases/${encodeURIComponent(reference)}${query}`;

export async function addNote(formData: FormData): Promise<void> {
  const reference = String(formData.get('reference') ?? '');
  const body = String(formData.get('body') ?? '').trim();
  if (body.length < 3) redirect(back(reference, '?error=note#notes'));

  const result = await callApi(`/api/v1/cases/${encodeURIComponent(reference)}/notes`, {
    method: 'POST',
    body: { body },
  });
  redirect(back(reference, result.ok ? '?noted=1#notes' : '?error=failed#notes'));
}

export async function updateCase(formData: FormData): Promise<void> {
  const reference = String(formData.get('reference') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  const summary = String(formData.get('summary') ?? '').trim();
  const status = String(formData.get('status') ?? '');

  const result = await callApi(`/api/v1/cases/${encodeURIComponent(reference)}`, {
    method: 'PATCH',
    body: {
      ...(title === '' ? {} : { title }),
      summary: summary === '' ? null : summary,
      ...(status === '' ? {} : { status }),
    },
  });

  if (!result.ok) {
    redirect(
      back(reference, `?error=failed&message=${encodeURIComponent(result.error.message)}#details`),
    );
  }
  redirect(back(reference, '?updated=1#details'));
}

/**
 * Link somebody to the case.
 *
 * This is the act that opens their record to the officers on it (§22), so it
 * demands a justification in writing and is audited as a first-class event. It
 * is not a bookmark.
 */
export async function linkSubject(formData: FormData): Promise<void> {
  const reference = String(formData.get('reference') ?? '');
  const subjectId = String(formData.get('subjectId') ?? '')
    .trim()
    .toUpperCase();
  const subjectRole = String(formData.get('subjectRole') ?? 'SUBJECT_OF_INTEREST');
  const justification = String(formData.get('justification') ?? '').trim();

  if (subjectId === '' || justification.length < 10) {
    redirect(back(reference, '?error=link#subjects'));
  }

  const result = await callApi(`/api/v1/cases/${encodeURIComponent(reference)}/subjects`, {
    method: 'POST',
    body: { subjectType: 'CITIZEN', subjectId, subjectRole, justification },
  });

  if (!result.ok) {
    redirect(
      back(reference, `?error=failed&message=${encodeURIComponent(result.error.message)}#subjects`),
    );
  }
  redirect(back(reference, '?linked=1#subjects'));
}

export async function assignOfficer(formData: FormData): Promise<void> {
  const reference = String(formData.get('reference') ?? '');
  const userId = String(formData.get('userId') ?? '').trim();
  const role = String(formData.get('role') ?? 'INVESTIGATOR');

  const result = await callApi(`/api/v1/cases/${encodeURIComponent(reference)}/assignments`, {
    method: 'POST',
    body: { userId, role },
  });

  if (!result.ok) {
    redirect(
      back(reference, `?error=failed&message=${encodeURIComponent(result.error.message)}#officers`),
    );
  }
  redirect(back(reference, '?assigned=1#officers'));
}

export async function closeCase(formData: FormData): Promise<void> {
  const reference = String(formData.get('reference') ?? '');
  const closureNote = String(formData.get('closureNote') ?? '').trim();
  if (closureNote.length < 5) redirect(back(reference, '?error=closure#details'));

  const result = await callApi(`/api/v1/cases/${encodeURIComponent(reference)}/close`, {
    method: 'POST',
    body: { closureNote },
  });

  if (!result.ok) {
    redirect(
      back(reference, `?error=failed&message=${encodeURIComponent(result.error.message)}#details`),
    );
  }
  // Not back to the file: a closed case authorises no access, and that includes
  // reading the file. Sending the officer there would show them a refusal for
  // the thing they had just successfully done.
  redirect(`/cases?closed=${encodeURIComponent(reference)}`);
}
