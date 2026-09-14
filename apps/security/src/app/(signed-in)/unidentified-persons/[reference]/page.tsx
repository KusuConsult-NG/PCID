import { Badge, Empty, Notice, Select, SubmitButton, TextArea } from '@pcid/portal-kit/components';
import { fieldLabel, formatDateTime, sentenceCase } from '@pcid/portal-kit/format';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/chrome';
import { callApi } from '@/lib/api';
import { can, readSession } from '@/lib/session';
import type { UnidentifiedPersonFile } from '@/lib/types';

import { updateUnidentifiedPerson } from '../actions';

export const metadata: Metadata = { title: 'Unidentified person' };

export default async function UnidentifiedPersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ reference: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { reference } = await params;
  const query = await searchParams;
  const one = (key: string): string | undefined =>
    typeof query[key] === 'string' && query[key] !== '' ? (query[key] as string) : undefined;

  const session = await readSession();
  const result = await callApi<UnidentifiedPersonFile>(
    `/api/v1/unidentified-persons/${encodeURIComponent(reference)}`,
  );

  if (!result.ok) {
    return (
      <>
        <PageHeader title="That record is not open to you" />
        <Notice tone="danger" title="No such record, or not one you may open">
          <p>{result.error.message}</p>
          <p className="small muted" style={{ marginBottom: 0 }}>
            Reference <span className="mono">{result.error.correlationId}</span>.
          </p>
        </Notice>
      </>
    );
  }

  const record = result.data;
  const settled = record.status === 'IDENTIFIED' || record.status === 'PROVISIONALLY_IDENTIFIED';

  return (
    <>
      <PageHeader
        title={record.reference}
        lead={record.physicalDescription ?? 'No description recorded.'}
      />

      {one('error') === undefined ? null : (
        <Notice tone="danger" title="That could not be done" live>
          {one('error') === 'nothing'
            ? 'Nothing was changed.'
            : (one('message') ?? 'Please try again.')}
        </Notice>
      )}
      {one('recorded') === '1' ? (
        <Notice tone="ok" title="Recorded" live>
          It is now in the register, so a family searching for somebody can be matched against it.
        </Notice>
      ) : null}
      {one('revised') === '1' ? (
        <Notice tone="ok" title="Record updated" live>
          Which fields changed is on the audit record.
        </Notice>
      ) : null}

      <section className="card" aria-labelledby="record-heading">
        <div className="card-header">
          <h2 id="record-heading">What is known</h2>
          <Badge tone={settled ? 'ok' : 'warn'}>{sentenceCase(record.status)}</Badge>
        </div>
        <dl className="facts">
          <dt>Condition when found</dt>
          <dd>{record.condition === undefined ? '—' : sentenceCase(record.condition)}</dd>
          <dt>Apparent age</dt>
          <dd>
            {record.estimatedAgeRange == null
              ? '—'
              : `${record.estimatedAgeRange.min ?? '?'} to ${record.estimatedAgeRange.max ?? '?'}`}
          </dd>
          <dt>Apparent sex</dt>
          <dd>{record.apparentSex == null ? 'Not apparent' : sentenceCase(record.apparentSex)}</dd>
          <dt>Clothing</dt>
          <dd>{record.clothingDescription ?? '—'}</dd>
          <dt>Distinctive</dt>
          <dd>{record.distinguishingFeatures ?? '—'}</dd>
          <dt>Anything suggesting who they are</dt>
          <dd>{record.identityClues ?? '—'}</dd>
          <dt>Found</dt>
          <dd>
            {record.found?.address ?? '—'}
            {record.found?.lgaCode == null ? '' : ` (${record.found.lgaCode})`}
            <br />
            <span className="muted small">{formatDateTime(record.foundAt)}</span>
          </dd>
          {record.biometricCustody == null ? null : (
            <>
              <dt>Biometric material</dt>
              <dd>
                Held by another agency under reference{' '}
                <span className="mono">{record.biometricCustody.reference}</span>.
                <br />
                <span className="muted small">
                  The platform stores none and matches none. This is a pointer, not material.
                </span>
              </dd>
            </>
          )}
          {record.identifiedPcid == null ? null : (
            <>
              <dt>Identified as</dt>
              <dd className="mono">{record.identifiedPcid}</dd>
            </>
          )}
        </dl>
        {record.restrictedFields.length === 0 ? null : (
          <p className="muted small" style={{ marginBottom: 0 }}>
            Withheld for this purpose: {record.restrictedFields.map(fieldLabel).join(', ')}.
          </p>
        )}
      </section>

      <section className="card" aria-labelledby="candidates-heading">
        <div className="card-header">
          <h2 id="candidates-heading">Enquiries this might answer</h2>
          <Badge tone="muted">{record.candidateMatches.length}</Badge>
        </div>
        <p className="muted small">
          Candidates produced by the matching engine, with the factors that produced them. Deciding
          one is done from the missing-person enquiry, by a person, by name.
        </p>
        {record.candidateMatches.length === 0 ? (
          <Empty>No enquiry has been matched against this record.</Empty>
        ) : (
          <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {record.candidateMatches.map((match) => (
              <li key={match.id} className="candidate">
                <div className="card-header">
                  <h3 style={{ fontSize: 'var(--step-0)' }}>
                    <Link
                      href={`/missing-persons/${encodeURIComponent(match.missingPersonReference ?? '')}`}
                    >
                      {match.missingPersonReference}
                    </Link>{' '}
                    — {match.missingPersonName}
                  </h3>
                  <span>
                    <span className="score">{Math.round(match.score)}</span>
                    <span className="muted small"> / 100</span>
                  </span>
                </div>
                <Badge tone={match.status === 'CONFIRMED' ? 'ok' : 'warn'}>
                  {sentenceCase(match.status)}
                </Badge>
                {match.note === undefined ? null : (
                  <p className="muted small" style={{ marginBottom: 0 }}>
                    {match.note}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {settled || !can(session, 'UNIDENTIFIED_PERSON_UPDATE') ? null : (
        <section className="card" id="revise" aria-labelledby="revise-heading">
          <div className="card-header">
            <h3 id="revise-heading">Add what you have learned</h3>
          </div>
          <p>
            There is no field here that says who somebody is. An identity comes only from confirming
            a candidate match on the enquiry — an officer who could type an identifier into this
            record would be identifying somebody by assertion.
          </p>
          <form action={updateUnidentifiedPerson} noValidate>
            <input type="hidden" name="reference" value={record.reference} />
            <Select
              name="status"
              id="revise-status"
              label="Status"
              options={[
                { value: '', label: 'Leave as it is' },
                { value: 'UNIDENTIFIED', label: 'Still unidentified' },
                { value: 'UNDER_REVIEW', label: 'Under review' },
                { value: 'CLOSED', label: 'Closed' },
              ]}
              defaultValue=""
            />
            <TextArea
              name="physicalDescription"
              id="revise-appearance"
              label="What they look like"
              defaultValue={record.physicalDescription ?? ''}
              maxLength={2000}
            />
            <TextArea
              name="identityClues"
              id="revise-clues"
              label="Anything suggesting who they are"
              defaultValue={record.identityClues ?? ''}
              maxLength={2000}
            />
            <div className="actions">
              <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
            </div>
          </form>
        </section>
      )}
    </>
  );
}
