import { Field, Notice, Select, SubmitButton } from '@pcid/portal-kit/components';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/chrome';
import { can, readSession } from '@/lib/session';

import { issuePortalCredentials, registerResident } from './actions';

export const metadata: Metadata = { title: 'Register a resident' };

const SEXES = [
  { value: 'FEMALE', label: 'Female' },
  { value: 'MALE', label: 'Male' },
  { value: 'UNSPECIFIED', label: 'Not stated' },
];

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string): string | undefined =>
    typeof params[key] === 'string' ? (params[key] as string) : undefined;

  const session = await readSession();
  const permitted = can(session, 'CITIZEN_CREATE');
  const issued = one('issued');
  const passphrase = one('passphrase');

  return (
    <>
      <PageHeader
        title="Register a resident"
        lead="Issue a Plateau Citizen ID to somebody at the desk, after you have checked who they are."
      />

      {!permitted ? (
        <Notice tone="warn" title="Your account cannot register residents">
          Ask your agency administrator for the registration role.
        </Notice>
      ) : null}

      {one('error') === undefined ? null : (
        <Notice tone="danger" title="That could not be done" live>
          {one('error') === 'missing'
            ? 'A given name, a family name and a date of birth are needed.'
            : one('error') === 'account-exists'
              ? 'That person already has portal credentials. A replacement is issued from their record, not here.'
              : (one('detail') ?? 'Please check the details and try again.')}
        </Notice>
      )}

      {one('queued') === undefined ? null : (
        <Notice tone="warn" title="This registration has been stopped for review" live>
          <p>
            The details closely match somebody already on the register. Nothing has been issued and
            nothing has been merged — a person decides.
          </p>
          <p style={{ marginBottom: 0 }}>
            Reference <span className="mono">{one('queued')}</span>.{' '}
            <Link href="/duplicates">Open the duplicate queue</Link>.
          </p>
        </Notice>
      )}

      {issued === undefined ? null : (
        <Notice tone="ok" title="Registered" live>
          <p>
            Plateau Citizen ID <span className="mono">{issued}</span>. It is theirs for life and
            will never be reused for anybody else.
          </p>
          {passphrase === undefined ? (
            <form action={issuePortalCredentials}>
              <input type="hidden" name="pcid" value={issued} />
              <SubmitButton pendingLabel="Issuing…">Issue portal credentials</SubmitButton>
            </form>
          ) : (
            <>
              <p>
                <strong>Portal passphrase, shown once:</strong>{' '}
                <span className="mono">{passphrase}</span>
              </p>
              <p style={{ marginBottom: 0 }}>
                Write it down for them and hand it over. The portal will make them choose their own
                before it shows them anything — which is what stops you and them sharing a secret.
              </p>
            </>
          )}
        </Notice>
      )}

      <section className="card" aria-labelledby="register-heading">
        <div className="card-header">
          <h2 id="register-heading">The person&rsquo;s details</h2>
        </div>
        <form action={registerResident} noValidate>
          <Field name="givenName" label="Given name" required maxLength={100} />
          <Field name="middleName" label="Middle name" maxLength={100} />
          <Field name="familyName" label="Family name" required maxLength={100} />
          <Select name="sex" label="Sex" options={SEXES} defaultValue="UNSPECIFIED" required />
          <Field
            name="dateOfBirth"
            label="Date of birth"
            hint="Year-month-day, for example 1994-06-12."
            required
            maxLength={10}
          />
          <Field
            name="phonePrimary"
            label="Phone number"
            type="tel"
            inputMode="tel"
            maxLength={24}
          />
          <Field
            name="phoneSecondary"
            label="Another number"
            type="tel"
            inputMode="tel"
            maxLength={24}
          />
          <Field
            name="email"
            label="Email address"
            type="email"
            inputMode="email"
            maxLength={320}
          />
          <Field name="residentialAddress" label="Residential address" maxLength={400} />
          <Field name="lgaCode" label="Local Government Area code" maxLength={16} />
          <Field name="wardCode" label="Ward code" maxLength={24} />
          <Field
            name="nin"
            label="National Identification Number"
            hint="Only if an authoritative document in front of you carries one. It is never required: a Plateau Citizen ID does not depend on a NIN."
            maxLength={32}
          />
          <div className="actions">
            <SubmitButton pendingLabel="Registering…">Register this person</SubmitButton>
          </div>
        </form>
      </section>

      <Notice title="Before you register somebody">
        <p style={{ marginBottom: 0 }}>
          Check who they are first. An identifier issued to the wrong person is not a clerical error
          — it is a second identity, and unpicking it is far harder than the extra minute.
        </p>
      </Notice>
    </>
  );
}
