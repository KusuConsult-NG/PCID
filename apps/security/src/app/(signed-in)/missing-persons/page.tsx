import {
  Badge,
  Empty,
  Field,
  Notice,
  Select,
  SubmitButton,
  TableScroll,
  TextArea,
} from '@pcid/portal-kit/components';
import { formatDateTime, sentenceCase } from '@pcid/portal-kit/format';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/chrome';
import { callApi, dataOr } from '@/lib/api';
import { can, readSession } from '@/lib/session';
import type { MissingPerson } from '@/lib/types';
import { enquiryStatusTone } from '@/lib/vocabulary';

import { reportMissingPerson } from './actions';

export const metadata: Metadata = { title: 'Missing persons' };

const SEXES = [
  { value: '', label: 'Not stated' },
  { value: 'FEMALE', label: 'Female' },
  { value: 'MALE', label: 'Male' },
];

export default async function MissingPersonsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string): string | undefined =>
    typeof params[key] === 'string' && params[key] !== '' ? (params[key] as string) : undefined;

  const session = await readSession();
  const openOnly = one('all') !== '1';

  const result = await callApi<{ records: MissingPerson[]; total: number }>(
    `/api/v1/missing-persons?limit=50${openOnly ? '&openOnly=true' : ''}`,
  );
  const listed = dataOr(result, null);

  return (
    <>
      <PageHeader
        title="Missing persons"
        lead="Open enquiries, and what is known about each. A record here is the investigative file for its own workflow — it needs no separate case number."
      />

      {one('error') === undefined ? null : (
        <Notice tone="danger" title="That could not be recorded" live>
          {one('error') === 'missing'
            ? 'A name and a description of the circumstances are needed.'
            : (one('message') ?? 'Please try again.')}
        </Notice>
      )}

      <nav className="actions" aria-label="Filter" style={{ marginBottom: '1.25rem' }}>
        <Link className={`button ${openOnly ? '' : 'button-secondary'}`} href="/missing-persons">
          Open enquiries
        </Link>
        <Link
          className={`button ${openOnly ? 'button-secondary' : ''}`}
          href="/missing-persons?all=1"
        >
          All, including resolved
        </Link>
      </nav>

      {listed === null ? (
        <Notice tone="danger" title="The register could not be loaded">
          Please try again shortly.
        </Notice>
      ) : (
        <section className="card" aria-labelledby="register-heading">
          <div className="card-header">
            <h2 id="register-heading">
              {listed.total} {listed.total === 1 ? 'enquiry' : 'enquiries'}
            </h2>
          </div>
          {listed.records.length === 0 ? (
            <Empty>Nothing here.</Empty>
          ) : (
            <TableScroll label="Missing-person enquiries">
              <table>
                <caption className="visually-hidden">Missing-person enquiries</caption>
                <thead>
                  <tr>
                    <th scope="col">Reference</th>
                    <th scope="col">Name</th>
                    <th scope="col">Age</th>
                    <th scope="col">Last seen</th>
                    <th scope="col">Status</th>
                    <th scope="col">Reported</th>
                  </tr>
                </thead>
                <tbody>
                  {listed.records.map((record) => (
                    <tr key={record.caseReference}>
                      <td className="mono">
                        <Link href={`/missing-persons/${encodeURIComponent(record.caseReference)}`}>
                          {record.caseReference}
                        </Link>
                      </td>
                      <td>{record.fullName ?? '—'}</td>
                      <td>{record.ageYears ?? '—'}</td>
                      <td>{record.lastSeen?.lgaCode ?? record.lastSeen?.address ?? '—'}</td>
                      <td>
                        <Badge tone={enquiryStatusTone(record.status)}>
                          {sentenceCase(record.status)}
                        </Badge>
                      </td>
                      <td>{formatDateTime(record.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </section>
      )}

      {can(session, 'MISSING_PERSON_CREATE') ? (
        <section className="card" id="report" aria-labelledby="report-heading">
          <div className="card-header">
            <h2 id="report-heading">Report a missing person</h2>
          </div>
          <p>
            Take what the family gives you now; you can revise it as the enquiry develops. The first
            description is rarely the last one.
          </p>
          <form action={reportMissingPerson} noValidate>
            <Field name="fullName" label="Their full name" required maxLength={200} />
            <Field
              name="ageYears"
              label="Age"
              type="number"
              inputMode="numeric"
              min={0}
              max={130}
            />
            <Select name="sex" label="Sex" options={SEXES} defaultValue="" />
            <Field
              name="citizenPcid"
              label="Plateau Citizen ID, if they have one"
              hint="Links the enquiry to the register. Leave blank if you do not know it."
              maxLength={20}
            />
            <TextArea
              name="circumstances"
              label="What happened"
              hint="When they were last seen, by whom, and what was unusual about it."
              required
              maxLength={4000}
            />
            <TextArea name="physicalDescription" label="What they look like" maxLength={2000} />
            <TextArea name="clothingDescription" label="What they were wearing" maxLength={2000} />
            <TextArea name="distinguishingFeatures" label="Anything distinctive" maxLength={2000} />
            <Field name="lastSeenAddress" label="Where they were last seen" maxLength={400} />
            <Field name="lastSeenLgaCode" label="Local Government Area code" maxLength={16} />
            <Field name="reporterName" label="Who reported it" maxLength={200} />
            <Field name="reporterRelationship" label="How they know them" maxLength={64} />
            <Field
              name="reporterPhone"
              label="Their phone number"
              type="tel"
              inputMode="tel"
              maxLength={24}
            />
            <div className="actions">
              <SubmitButton pendingLabel="Recording…">Record this enquiry</SubmitButton>
            </div>
          </form>
        </section>
      ) : null}
    </>
  );
}
