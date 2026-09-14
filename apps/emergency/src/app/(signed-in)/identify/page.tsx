import { Field, Notice, SubmitButton } from '@pcid/portal-kit/components';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { PageHeader } from '@/components/chrome';
import { readSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Identify someone' };

/**
 * The one screen a crew uses with somebody in front of them.
 *
 * It asks for two things and nothing else: which incident, and the identifier on
 * the credential. Both fields are large, the identifier field tolerates how
 * people actually type under pressure, and the incident is filled in from the
 * one they said they were attending.
 */
export default async function IdentifyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string): string | undefined =>
    typeof params[key] === 'string' && params[key] !== '' ? (params[key] as string) : undefined;

  const session = await readSession();
  const attending = session?.workingIncident ?? null;

  async function open(formData: FormData): Promise<void> {
    'use server';
    // Typed under pressure: lower case, missing hyphens, a missing PL prefix.
    // The format excludes I, L, O and U precisely so this is safe to do, and the
    // platform checks the identifier before any lookup happens.
    const pcid = String(formData.get('pcid') ?? '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '');
    const incidentRef = String(formData.get('incidentRef') ?? '').trim();
    const breakGlassRef = String(formData.get('breakGlassRef') ?? '').trim();

    if (pcid === '') redirect('/identify?error=pcid');
    if (incidentRef === '') redirect('/identify?error=incident');

    const query = new URLSearchParams({ incident: incidentRef });
    if (breakGlassRef !== '') query.set('breakGlass', breakGlassRef);
    redirect(`/person/${encodeURIComponent(pcid)}?${query.toString()}`);
  }

  return (
    <>
      <PageHeader
        title="Identify someone"
        lead="Their credential, and the incident you are attending. You receive what emergency care needs and nothing else."
      />

      {one('error') === undefined ? null : (
        <Notice tone="danger" title="Two things are needed" live>
          {one('error') === 'pcid'
            ? 'Type the identifier from the credential.'
            : 'Name the incident you are attending. Every read here is made under one.'}
        </Notice>
      )}

      {attending === null ? (
        <Notice tone="warn" title="You have not said which incident you are on">
          <p style={{ marginBottom: 0 }}>
            You can type it below. If you open the incident from{' '}
            <Link href="/incidents">the board</Link> and press <em>I am attending this</em>, it will
            be filled in for you from then on.
          </p>
        </Notice>
      ) : null}

      <section className="card" aria-labelledby="identify-heading">
        <div className="card-header">
          <h2 id="identify-heading">Who is in front of you</h2>
        </div>
        <form action={open} noValidate>
          <Field
            name="pcid"
            label="Plateau Citizen ID"
            hint="From the credential. Lower case and missing hyphens are fine — the format has no I, L, O or U in it, so there is nothing to confuse."
            required
            maxLength={24}
          />
          <Field
            name="incidentRef"
            label="Incident you are attending"
            defaultValue={attending?.reference ?? ''}
            required
            maxLength={64}
          />
          <Field
            name="breakGlassRef"
            label="Break-glass reference"
            hint="Only if you had to break the glass because control could not attach you in time."
            maxLength={64}
          />
          <div className="step-actions">
            <SubmitButton pendingLabel="Opening…">Open the emergency profile</SubmitButton>
          </div>
        </form>
      </section>

      <Notice title="What you will receive, and what you will not">
        <p>
          Their name, approximate age, sex, photograph, area, emergency contacts, blood group and
          the conditions and allergies they chose to disclose for exactly this moment.
        </p>
        <p style={{ marginBottom: 0 }}>
          Not their date of birth, address, phone number, email, NIN, tax or property records, or
          anything about any case. Those are not withheld from you as a matter of trust; they are
          not what emergency care needs, and an emergency is not a reason to see somebody&rsquo;s
          whole life.
        </p>
      </Notice>
    </>
  );
}
