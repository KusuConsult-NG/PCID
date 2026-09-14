import { Badge, Empty, Notice, Restricted } from '@pcid/portal-kit/components';
import { fieldLabel, formatDate, sentenceCase } from '@pcid/portal-kit/format';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/chrome';
import { callApi } from '@/lib/api';
import { readSession } from '@/lib/session';
import type { Card, CitizenRecord } from '@/lib/types';
import { purposeLabel } from '@/lib/vocabulary';

export const metadata: Metadata = { title: 'Citizen record' };

/**
 * A record, opened under a case.
 *
 * There is no way to reach this page without one. The case reference travels
 * with the request and the engine checks three things afresh: that the case is
 * active, that this officer is assigned to it, and that this person is linked to
 * it. Failing any of them answers exactly as it would for a person who does not
 * exist.
 *
 * A card the engine withheld is shown as withheld rather than omitted (§29). An
 * investigator who cannot tell "no property is registered to this person" from
 * "you may not see their property" will draw the wrong conclusion from a blank
 * page, and in an investigation that conclusion goes in a file.
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

  const session = await readSession();
  const caseRef = one('case') ?? session?.workingCase?.reference;
  const purpose = one('purpose') ?? 'CRIMINAL_INVESTIGATION';

  if (caseRef === undefined) {
    return (
      <>
        <PageHeader title="A record is opened under a case" />
        <Notice tone="warn" title="No case given">
          <p>
            This portal cannot open a record without one. That is not a setting: the policy engine
            refuses an investigative read that names no case.
          </p>
          <p style={{ marginBottom: 0 }}>
            <Link href="/cases">Choose a case you are assigned to</Link>, then link this person to
            it with a reason.
          </p>
        </Notice>
      </>
    );
  }

  const result = await callApi<CitizenRecord>(
    `/api/v1/citizens/${encodeURIComponent(pcid)}/360?purpose=${encodeURIComponent(purpose)}&caseRef=${encodeURIComponent(caseRef)}`,
  );

  if (!result.ok) {
    return (
      <>
        <PageHeader title="That record is not open to you" />
        <Notice
          tone="danger"
          title={
            result.error.code === 'CASE_REFERENCE_REQUIRED'
              ? 'This read needs a case'
              : 'No such record, or not one this case reaches'
          }
        >
          <p>{result.error.message}</p>
          <p className="small muted" style={{ marginBottom: 0 }}>
            The most common reason is that the person has not been linked to the case. The platform
            answers the same way whether the record does not exist, the case does not reach it, or
            you are not on the case — so a refusal never becomes a way of finding out. The precise
            reason is on the audit record. Reference{' '}
            <span className="mono">{result.error.correlationId}</span>.
          </p>
        </Notice>
        <p style={{ marginTop: '1.25rem' }}>
          <Link
            className="button button-secondary"
            href={`/cases/${encodeURIComponent(caseRef)}#subjects`}
          >
            Link this person to {caseRef}
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
          <strong>Opened under:</strong>{' '}
          <Link href={`/cases/${encodeURIComponent(caseRef)}`}>{caseRef}</Link> ·{' '}
          {purposeLabel(purpose)}
        </span>
        <span className="mono small">{pcid}</span>
        <span className="small muted">
          Recorded against {session?.displayName ?? 'you'}. Withheld from this person&rsquo;s own
          history under a stated legal basis, and visible to the Data Protection Officer.
        </span>
      </div>

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
        <Notice title={`${restrictedCards.length} withheld for this purpose`}>
          <p style={{ marginBottom: 0 }}>
            An investigation purpose does not release everything, and a case does not widen the
            classification ceiling or the compartment your agency holds. If your enquiry genuinely
            needs one of these, raise an access request from{' '}
            <Link href="/authorisation">Access and break glass</Link> — an approver sees what the
            engine concluded alongside your reason.
          </p>
        </Notice>
      )}
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
