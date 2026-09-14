'use server';

import { redirect } from 'next/navigation';

import { callApi } from '@/lib/api';
import { readSession, writeSession } from '@/lib/session';

/** Open a case. The officer who opens one is assigned to it. */
export async function openCase(formData: FormData): Promise<void> {
  const title = String(formData.get('title') ?? '').trim();
  const type = String(formData.get('type') ?? 'CRIMINAL_INVESTIGATION');
  const summary = String(formData.get('summary') ?? '').trim();
  const lgaCode = String(formData.get('lgaCode') ?? '').trim();

  if (title.length < 3) redirect('/cases?error=title#open');

  const result = await callApi<{ caseNumber: string }>('/api/v1/cases', {
    method: 'POST',
    body: {
      type,
      title,
      summary: summary === '' ? null : summary,
      lgaCode: lgaCode === '' ? null : lgaCode,
    },
  });

  if (!result.ok)
    redirect(`/cases?error=failed&message=${encodeURIComponent(result.error.message)}#open`);
  redirect(`/cases/${encodeURIComponent(result.data.caseNumber)}?opened=1`);
}

/**
 * Set the case this officer is working under.
 *
 * A convenience for the search and record screens, and nothing more: it is sent
 * as the case reference on each request and the engine decides afresh every
 * time.
 */
export async function setWorkingCase(formData: FormData): Promise<void> {
  const reference = String(formData.get('reference') ?? '').trim();
  const title = String(formData.get('title') ?? '').trim();
  const back = String(formData.get('return') ?? '/cases');

  const session = await readSession();
  if (session === null) redirect('/sign-in');

  await writeSession({
    ...session,
    workingCase: reference === '' ? null : { reference, title },
  });
  redirect(back.startsWith('/') && !back.startsWith('//') ? back : '/cases');
}

/**
 * Put an officer onto a case by its number, without opening it first.
 *
 * This exists because of a deadlock the case file page cannot resolve on its
 * own. Assigning is the one case action the policy engine deliberately does not
 * require the actor to already be assigned for - the gate says so in as many
 * words, because otherwise a case becomes unjoinable the moment its original
 * officer leaves - but the assignment form lives inside the case file, and
 * reading a case file *does* require the assignment. A supervisor asked to take
 * over a colleague's case could not reach the form that would let them.
 *
 * So the form is here as well, on the list, where it needs nothing but the case
 * number. The engine still decides: the case must belong to your agency, it
 * must be active, and it must not be classified above your clearance.
 */
export async function takeCaseOn(formData: FormData): Promise<void> {
  const reference = String(formData.get('reference') ?? '').trim();
  const userId = String(formData.get('userId') ?? '').trim();
  const role = String(formData.get('role') ?? 'SUPERVISOR');

  if (reference === '' || userId === '') redirect('/cases?error=assign#take-on');

  const result = await callApi(`/api/v1/cases/${encodeURIComponent(reference)}/assignments`, {
    method: 'POST',
    body: { userId, role },
  });

  if (!result.ok) {
    redirect(`/cases?error=failed&message=${encodeURIComponent(result.error.message)}#take-on`);
  }
  redirect(`/cases/${encodeURIComponent(reference)}?assigned=1#officers`);
}
