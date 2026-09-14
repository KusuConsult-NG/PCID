import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/chrome';
import { Notice } from '@/components/feedback';
import { Field, Select, TextArea } from '@/components/fields';
import { SubmitButton } from '@/components/form';

import {
  raiseEmergency,
  reportIdentityFraud,
  reportMissingPerson,
  reportUnauthorisedAccess,
} from './actions';
import { ShareLocation } from './share-location';

export const metadata: Metadata = { title: 'Report something' };

const EMERGENCY_TYPES = [
  { value: 'MEDICAL_EMERGENCY', label: 'Someone is hurt or unwell' },
  { value: 'FIRE', label: 'Fire' },
  { value: 'ROAD_ACCIDENT', label: 'Road accident' },
  { value: 'SECURITY_INCIDENT', label: 'Security incident' },
  { value: 'FLOOD', label: 'Flooding' },
  { value: 'BUILDING_COLLAPSE', label: 'Building collapse' },
  { value: 'RESCUE_OPERATION', label: 'Someone needs rescuing' },
  { value: 'OTHER', label: 'Something else' },
];

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string): string | undefined =>
    typeof params[key] === 'string' ? (params[key] as string) : undefined;

  const emergency = one('emergency');
  const missing = one('missing');
  const fraud = one('fraud');
  const access = one('access');
  const error = one('error');

  return (
    <>
      <PageHeader
        title="Report something"
        lead="Raise an emergency, report someone missing, or tell us about a problem with your record."
      />

      {error === undefined ? null : (
        <Notice tone="danger" title="That could not be sent" live>
          {error === 'description'
            ? 'Please describe what has happened in a little more detail.'
            : error === 'missing-person'
              ? 'A name and a description of the circumstances are needed.'
              : 'Please try again.'}
        </Notice>
      )}

      <section className="card" id="emergency" aria-labelledby="emergency-heading">
        <div className="card-header">
          <h2 id="emergency-heading">Raise an emergency</h2>
        </div>

        {emergency === undefined ? null : (
          <Notice tone="ok" title="Your report has gone to the emergency service" live>
            <p style={{ marginBottom: 0 }}>
              Your reference is <span className="mono">{emergency}</span>. Stay reachable on the
              number on your record.
            </p>
          </Notice>
        )}

        <Notice tone="warn" title="If someone is in immediate danger">
          <p style={{ marginBottom: 0 }}>
            Call the emergency number first. Use this when you can, not instead of calling.
          </p>
        </Notice>

        <form action={raiseEmergency} noValidate style={{ marginTop: '1.25rem' }}>
          <Select
            name="type"
            id="emergency-type"
            label="What is happening"
            options={EMERGENCY_TYPES}
            required
          />
          <TextArea
            name="description"
            id="emergency-description"
            label="Describe it"
            hint="Say what has happened, where, and how many people are affected."
            required
            maxLength={2000}
          />
          <ShareLocation />
          <div className="actions">
            <SubmitButton className="button button-danger" pendingLabel="Sending…">
              Send to the emergency service
            </SubmitButton>
          </div>
        </form>
      </section>

      <section className="card" id="missing-person" aria-labelledby="missing-heading">
        <div className="card-header">
          <h2 id="missing-heading">Report someone missing</h2>
        </div>

        {missing === undefined ? null : (
          <Notice tone="ok" title="Your report has been recorded" live>
            <p style={{ marginBottom: 0 }}>
              The reference is <span className="mono">{missing}</span>. An officer will be in touch.
            </p>
          </Notice>
        )}

        <p>
          Describe anything that would help someone recognise them — a scar, a healed injury, what
          they were wearing. Those details matter more than you might expect.
        </p>

        <form action={reportMissingPerson} noValidate>
          <Field name="fullName" label="Their full name" required maxLength={200} />
          <Field
            name="ageYears"
            label="Their age"
            type="number"
            inputMode="numeric"
            min={0}
            max={130}
          />
          <Field name="lastSeenAddress" label="Where they were last seen" maxLength={400} />
          <TextArea
            name="physicalDescription"
            label="What they look like"
            hint="Height, build, marks or scars, and what they were wearing."
            maxLength={2000}
          />
          <TextArea
            name="circumstances"
            label="What happened"
            hint="When you last saw them and anything unusual about it."
            required
            maxLength={4000}
          />
          <Field name="reporterRelationship" label="How you know them" maxLength={64} />
          <Field
            name="reporterPhone"
            label="Your phone number"
            type="tel"
            inputMode="tel"
            maxLength={24}
          />
          <div className="actions">
            <SubmitButton pendingLabel="Sending…">Send report</SubmitButton>
          </div>
        </form>
      </section>

      <section className="card" id="identity-fraud" aria-labelledby="fraud-heading">
        <div className="card-header">
          <h2 id="fraud-heading">Someone may be using my identity</h2>
        </div>

        {fraud === undefined ? null : (
          <Notice tone="ok" title="Your report has been sent to the registry team" live>
            <p style={{ marginBottom: 0 }}>
              The reference is <span className="mono">{fraud}</span>. You will be contacted using
              the details on your record.
            </p>
          </Notice>
        )}

        <form action={reportIdentityFraud} noValidate>
          <TextArea
            name="description"
            id="fraud-description"
            label="What has happened"
            hint="For example: someone collected a benefit in my name, or I was told a record already exists for me."
            required
            maxLength={4000}
          />
          <div className="actions">
            <SubmitButton pendingLabel="Sending…">Send report</SubmitButton>
          </div>
        </form>
      </section>

      <section className="card" id="unauthorised-access" aria-labelledby="access-heading">
        <div className="card-header">
          <h2 id="access-heading">I do not recognise who looked at my record</h2>
        </div>

        {access === undefined ? null : (
          <Notice tone="ok" title="Your report has been sent to the Data Protection Officer" live>
            <p style={{ marginBottom: 0 }}>
              The reference is <span className="mono">{access}</span>. The record of that access
              cannot be altered or deleted, so it will still be there when they review it.
            </p>
          </Notice>
        )}

        <p>
          Open <Link href="/access-history">Who has seen my record</Link>, find the entry, and copy
          its reference into the box below.
        </p>

        <form action={reportUnauthorisedAccess} noValidate>
          <Field
            name="accessReference"
            label="Reference of the access"
            hint="The code shown in the last column of your access history."
            maxLength={128}
          />
          <TextArea
            name="description"
            id="unauthorised-access-description"
            label="Why it does not look right"
            hint="For example: I have never had any dealings with that office."
            required
            maxLength={4000}
          />
          <div className="actions">
            <SubmitButton pendingLabel="Sending…">Send report</SubmitButton>
          </div>
        </form>
      </section>
    </>
  );
}
