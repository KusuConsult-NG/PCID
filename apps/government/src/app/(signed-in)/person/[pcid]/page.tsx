import {
  Badge,
  Empty,
  Field,
  Notice,
  Restricted,
  Select,
  SubmitButton,
  TextArea,
} from '@pcid/portal-kit/components';
import { fieldLabel, formatDate, sentenceCase } from '@pcid/portal-kit/format';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/chrome';
import { callApi } from '@/lib/api';
import { can, readSession } from '@/lib/session';
import type { Card, CitizenRecord } from '@/lib/types';
import { SERVICE_PURPOSES, purposeLabel } from '@/lib/vocabulary';

import { raiseCorrection, requestAccess } from './actions';

export const metadata: Metadata = { title: 'Citizen record' };

const CORRECTABLE = [
  { value: 'citizen.givenName', label: 'Given name' },
  { value: 'citizen.middleName', label: 'Middle name' },
  { value: 'citizen.familyName', label: 'Family name' },
  { value: 'citizen.dateOfBirth', label: 'Date of birth' },
  { value: 'citizen.sex', label: 'Sex' },
  { value: 'citizen.registeredAddress', label: 'Registered address' },
  { value: 'citizen.lgaCode', label: 'Local Government Area' },
  { value: 'citizen.wardCode', label: 'Ward' },
  { value: 'citizen.phonePrimary', label: 'Phone number' },
  { value: 'citizen.phoneSecondary', label: 'Second phone number' },
  { value: 'citizen.email', label: 'Email address' },
];

/**
 * One person's record, card by card, under the purpose the officer stated.
 *
 * Two things are deliberate. The purpose is shown on the page for as long as the
 * record is open, because it is the thing that decided what is on screen and the
 * thing that was written down. And a card the engine withheld is *shown*,
 * marked restricted, rather than omitted (§29): an officer who cannot tell the
 * difference between "no property is registered to this person" and "you may not
 * see their property" will draw the wrong conclusion from a blank page.
 */
export default async function PersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ pcid: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { pcid } = await params;
  const query = await searchParams;
  const one = (key: string): string | undefined =>
    typeof query[key] === 'string' && query[key] !== '' ? (query[key] as string) : undefined;

  const purpose = one('purpose');
  const session = await readSession();

  if (purpose === undefined) {
    return (
      <>
        <PageHeader title="Why are you opening this record?" />
        <section className="card">
          <p>
            The reason is recorded against your name, shown to the person whose record it is, and
            used to decide which fields are released to you. It is not a formality.
          </p>
          <form method="get" noValidate>
            <Select
              name="purpose"
              label="Reason for opening this record"
              options={[...SERVICE_PURPOSES]}
              defaultValue="SERVICE_DELIVERY"
              required
            />
            <div className="actions">
              <SubmitButton>Open the record</SubmitButton>
            </div>
          </form>
        </section>
      </>
    );
  }

  const result = await callApi<CitizenRecord>(
    `/api/v1/citizens/${encodeURIComponent(pcid)}/360?purpose=${encodeURIComponent(purpose)}`,
  );

  if (!result.ok) {
    return (
      <>
        <PageHeader title="That record is not available to you" />
        <Notice
          tone="danger"
          title={
            result.error.code === 'NOT_FOUND_OR_NOT_PERMITTED'
              ? 'No such record, or not one you may open'
              : 'The record could not be opened'
          }
        >
          <p>{result.error.message}</p>
          <p className="small muted" style={{ marginBottom: 0 }}>
            The platform answers the same way for a record that does not exist and one you are not
            entitled to see, so that a refusal never becomes a way of finding out who is on the
            register. The precise reason is on the audit record. Reference{' '}
            <span className="mono">{result.error.correlationId}</span>.
          </p>
        </Notice>
        <p style={{ marginTop: '1.25rem' }}>
          <Link className="button button-secondary" href="/find">
            Back to search
          </Link>
        </p>
      </>
    );
  }

  const record = result.data;
  const identity = record.cards.find((card) => card.key === 'IDENTITY');
  const identityItem =
    identity !== undefined && identity.status === 'RELEASED' ? (identity.items?.[0] ?? {}) : {};
  const restrictedCards = record.cards.filter((card) => card.status === 'RESTRICTED');

  return (
    <>
      <PageHeader title={String(identityItem.displayName ?? pcid)} />

      <div className="purpose-banner">
        <span>
          <strong>Opened for:</strong> {purposeLabel(purpose)}
        </span>
        <span className="mono small">{pcid}</span>
        <span className="small muted">
          This access is recorded. {session?.displayName ?? 'You'} ·{' '}
          {session?.agencyName ?? 'your agency'}
        </span>
      </div>

      {one('error') === undefined ? null : (
        <Notice tone="danger" title="That could not be sent" live>
          {one('error') === 'request'
            ? 'Name at least one field and give a reason of at least ten characters.'
            : one('error') === 'correction'
              ? 'Enter the corrected value and say why it should change.'
              : 'Please try again.'}
        </Notice>
      )}

      {one('requested') === undefined ? null : (
        <Notice tone="ok" title="Your access request has been raised" live>
          <p style={{ marginBottom: 0 }}>
            Reference <span className="mono">{one('requested')}</span>.{' '}
            {one('outcome') === 'ALREADY_PERMITTED'
              ? 'In fact those fields are already available to you — reload the record.'
              : 'An approver in your agency will decide it. You will not be able to approve it yourself.'}
          </p>
        </Notice>
      )}

      {one('corrected') === undefined ? null : (
        <Notice tone="ok" title="The correction has been raised" live>
          <p style={{ marginBottom: 0 }}>
            Reference <span className="mono">{one('corrected')}</span>. It goes to the correction
            queue, and the resident has been told that it was raised.
          </p>
        </Notice>
      )}

      <div className="stack" style={{ marginTop: '1.25rem' }}>
        {record.cards.map((card) =>
          card.status === 'RESTRICTED' ? (
            <Restricted key={card.key} title={card.title} reason={card.reason} />
          ) : (
            <RecordCard key={card.key} card={card} />
          ),
        )}
      </div>

      {restrictedCards.length === 0 ? null : (
        <section className="card" aria-labelledby="request-heading">
          <div className="card-header">
            <h2 id="request-heading">Ask for something that was withheld</h2>
          </div>
          <p>
            {restrictedCards.length === 1 ? 'One card was' : `${restrictedCards.length} cards were`}{' '}
            withheld for this purpose. If your work genuinely needs one of them, ask — an approver
            sees what the engine concluded alongside your reason, and an approval is bounded to the
            fields named and expires.
          </p>
          <form action={requestAccess} noValidate>
            <input type="hidden" name="pcid" value={pcid} />
            <input type="hidden" name="purpose" value={purpose} />
            <Field
              name="requestedFields"
              id="request-fields"
              label="Which fields"
              hint="Catalogue paths, separated by spaces. For example: citizen.nin citizen.bloodGroup"
              required
              maxLength={500}
            />
            <TextArea
              name="justification"
              id="request-justification"
              label="Why you need them"
              hint="What you are doing, and why the fields released to you are not enough for it."
              required
              maxLength={2000}
            />
            <div className="actions">
              <SubmitButton pendingLabel="Sending…">Request access</SubmitButton>
            </div>
          </form>
        </section>
      )}

      {can(session, 'CORRECTION_REQUEST_CREATE') ? (
        <section className="card" aria-labelledby="correction-heading">
          <div className="card-header">
            <h2 id="correction-heading">Something here is wrong</h2>
          </div>
          <p>
            Raise it from the counter rather than sending the resident home to do it themselves. It
            goes to the correction queue and nothing changes until somebody decides it. The resident
            is told that you raised it.
          </p>
          <form action={raiseCorrection} noValidate>
            <input type="hidden" name="pcid" value={pcid} />
            <input type="hidden" name="purpose" value={purpose} />
            <Select
              name="fieldPath"
              id="correction-field"
              label="What is wrong"
              options={CORRECTABLE}
              required
            />
            <Field
              name="requestedValue"
              id="correction-value"
              label="What it should say"
              required
              maxLength={500}
            />
            <TextArea
              name="justification"
              id="correction-justification"
              label="Why it should change"
              hint="What the resident showed you, or how you know."
              required
              maxLength={2000}
            />
            <div className="actions">
              <SubmitButton pendingLabel="Sending…">Raise a correction</SubmitButton>
            </div>
          </form>
        </section>
      ) : null}
    </>
  );
}

function RecordCard({ card }: { card: Extract<Card, { status: 'RELEASED' }> }) {
  const items = (card.items ?? []).filter((item) => Object.keys(item).length > 0);
  const headingId = `card-${card.key.toLowerCase()}`;

  return (
    <section className="card" aria-labelledby={headingId}>
      <div className="card-header">
        <h2 id={headingId}>{card.title}</h2>
        {card.restrictedFields !== undefined && card.restrictedFields.length > 0 ? (
          <Badge tone="muted">{card.restrictedFields.length} withheld</Badge>
        ) : null}
      </div>

      {items.length === 0 ? (
        <Empty>Nothing recorded.</Empty>
      ) : (
        <div className="stack">
          {items.map((item, index) => (
            <dl className="facts" key={index}>
              {Object.entries(item)
                .filter(([key]) => key !== 'sourceAgencyId')
                .map(([key, value]) => (
                  <div key={key} style={{ display: 'contents' }}>
                    <dt>{fieldLabel(key)}</dt>
                    <dd>{renderValue(key, value)}</dd>
                  </div>
                ))}
            </dl>
          ))}
        </div>
      )}

      {card.restrictedFields !== undefined && card.restrictedFields.length > 0 ? (
        <p className="muted small" style={{ marginTop: '1rem', marginBottom: 0 }}>
          Withheld for this purpose: {card.restrictedFields.map(fieldLabel).join(', ')}.
        </p>
      ) : null}
    </section>
  );
}

function renderValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    if (key.toLowerCase().includes('minor')) {
      return `₦${(value / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
    }
    return String(value);
  }
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}(T|$)/.test(value)) return formatDate(value);
    if (/^[A-Z][A-Z_]+$/.test(value)) return sentenceCase(value);
    return value;
  }
  if (Array.isArray(value)) return value.length === 0 ? '—' : `${value.length} recorded`;
  return JSON.stringify(value);
}
