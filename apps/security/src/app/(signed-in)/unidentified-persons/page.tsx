import {
  Badge,
  Empty,
  Field,
  Notice,
  Select,
  SubmitButton,
  TextArea,
} from '@pcid/portal-kit/components';
import { formatDateTime, sentenceCase } from '@pcid/portal-kit/format';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/chrome';
import { callApi, dataOr } from '@/lib/api';
import { can, readSession } from '@/lib/session';
import type { UnidentifiedPerson } from '@/lib/types';

import { recordUnidentifiedPerson } from './actions';

export const metadata: Metadata = { title: 'Unidentified persons' };

const CONDITIONS = [
  { value: 'UNKNOWN', label: 'Not known' },
  { value: 'CONSCIOUS', label: 'Conscious' },
  { value: 'UNCONSCIOUS', label: 'Unconscious' },
  { value: 'INJURED', label: 'Injured' },
  { value: 'DECEASED', label: 'Deceased' },
];

const SEXES = [
  { value: '', label: 'Not apparent' },
  { value: 'FEMALE', label: 'Apparently female' },
  { value: 'MALE', label: 'Apparently male' },
];

export default async function UnidentifiedPersonsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string): string | undefined =>
    typeof params[key] === 'string' && params[key] !== '' ? (params[key] as string) : undefined;

  const session = await readSession();
  const status = one('status') ?? 'UNIDENTIFIED';

  const result = await callApi<{ records: UnidentifiedPerson[]; total: number }>(
    `/api/v1/unidentified-persons?limit=50&status=${encodeURIComponent(status)}`,
  );
  const listed = dataOr(result, null);

  return (
    <>
      <PageHeader
        title="Unidentified persons"
        lead="People found who cannot say who they are. The register exists so that somebody looking for a missing relative can be matched against it."
      />

      {one('error') === undefined ? null : (
        <Notice tone="danger" title="That could not be recorded" live>
          {one('error') === 'description'
            ? 'Describe the person: it is what a family searching for them will read.'
            : (one('message') ?? 'Please try again.')}
        </Notice>
      )}

      <nav className="actions" aria-label="Filter by status" style={{ marginBottom: '1.25rem' }}>
        {['UNIDENTIFIED', 'UNDER_REVIEW', 'IDENTIFIED', 'CLOSED'].map((value) => (
          <Link
            key={value}
            className={`button ${value === status ? '' : 'button-secondary'}`}
            href={`/unidentified-persons?status=${value}`}
          >
            {sentenceCase(value)}
          </Link>
        ))}
      </nav>

      {listed === null ? (
        <Notice tone="danger" title="The register could not be loaded">
          Please try again shortly.
        </Notice>
      ) : (
        <section className="card" aria-labelledby="register-heading">
          <div className="card-header">
            <h2 id="register-heading">
              {listed.total} {listed.total === 1 ? 'record' : 'records'}
            </h2>
          </div>
          {listed.records.length === 0 ? (
            <Empty>Nothing here.</Empty>
          ) : (
            <div className="table-scroll">
              <table>
                <caption className="visually-hidden">Unidentified-person records</caption>
                <thead>
                  <tr>
                    <th scope="col">Reference</th>
                    <th scope="col">Apparent age</th>
                    <th scope="col">Condition</th>
                    <th scope="col">Found</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {listed.records.map((record) => (
                    <tr key={record.reference}>
                      <td className="mono">
                        <Link
                          href={`/unidentified-persons/${encodeURIComponent(record.reference)}`}
                        >
                          {record.reference}
                        </Link>
                      </td>
                      <td>
                        {record.estimatedAgeRange == null
                          ? '—'
                          : `${record.estimatedAgeRange.min ?? '?'}–${record.estimatedAgeRange.max ?? '?'}`}
                      </td>
                      <td>
                        {record.condition === undefined ? '—' : sentenceCase(record.condition)}
                      </td>
                      <td>
                        {record.found?.address ?? record.found?.lgaCode ?? '—'}
                        <br />
                        <span className="muted small">{formatDateTime(record.foundAt)}</span>
                      </td>
                      <td>
                        <Badge tone={record.status === 'IDENTIFIED' ? 'ok' : 'warn'}>
                          {sentenceCase(record.status)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {can(session, 'UNIDENTIFIED_PERSON_CREATE') ? (
        <section className="card" id="record" aria-labelledby="record-heading">
          <div className="card-header">
            <h2 id="record-heading">Record somebody found</h2>
          </div>
          <p>
            Write the description as a family searching for them would read it. The platform holds
            no biometric material and matches none: if another agency holds a reference, that is
            recorded as a reference and nothing more.
          </p>
          <form action={recordUnidentifiedPerson} noValidate>
            <Select name="condition" label="Condition when found" options={CONDITIONS} required />
            <Field
              name="estimatedAgeMin"
              label="Apparent age, from"
              type="number"
              min={0}
              max={130}
            />
            <Field
              name="estimatedAgeMax"
              label="Apparent age, to"
              type="number"
              min={0}
              max={130}
            />
            <Select name="apparentSex" label="Apparent sex" options={SEXES} defaultValue="" />
            <TextArea
              name="physicalDescription"
              label="What they look like"
              required
              maxLength={2000}
            />
            <TextArea name="clothingDescription" label="What they were wearing" maxLength={2000} />
            <TextArea name="distinguishingFeatures" label="Anything distinctive" maxLength={2000} />
            <TextArea
              name="identityClues"
              label="Anything that might say who they are"
              hint="A bus ticket, a name written inside a bag, a phone number on a slip of paper."
              maxLength={2000}
            />
            <Field name="foundAddress" label="Where they were found" maxLength={400} />
            <Field name="foundLgaCode" label="Local Government Area code" maxLength={16} />
            <div className="actions">
              <SubmitButton pendingLabel="Recording…">Record this person</SubmitButton>
            </div>
          </form>
        </section>
      ) : null}
    </>
  );
}
