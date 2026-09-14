import type { Metadata } from 'next';

import { PageHeader } from '@/components/chrome';
import { Empty, Notice, Restricted } from '@/components/feedback';
import { callApi, dataOr } from '@/lib/api';
import { fieldLabel, formatDate, sentenceCase } from '@/lib/format';
import type { Card, CitizenRecord } from '@/lib/types';

export const metadata: Metadata = { title: 'My records' };

/** The cards that belong on this page, in the order a resident expects them. */
const SECTIONS = [
  { key: 'CONTACT', blurb: 'How government offices reach you.' },
  { key: 'ADDRESS', blurb: 'Where your record says you live.' },
  { key: 'PROPERTY', blurb: 'Held by the lands registry.' },
  { key: 'VEHICLES', blurb: 'Held by the transport authority.' },
  { key: 'BUSINESS', blurb: 'Held by the business register.' },
  { key: 'LICENCES', blurb: 'Permits and licences issued to you.' },
  { key: 'REVENUE', blurb: 'Held by the revenue service.' },
  { key: 'GOVERNMENT_SERVICES', blurb: 'Programmes you are enrolled in.' },
] as const;

export default async function RecordsPage() {
  const result = await callApi<CitizenRecord>('/api/v1/me/record');

  if (!result.ok) {
    return (
      <>
        <PageHeader title="My records" />
        <Notice tone="danger" title="Your records could not be loaded">
          This is a problem at our end. Please try again shortly.
        </Notice>
      </>
    );
  }

  const record = dataOr(result, null) as CitizenRecord;
  const byKey = new Map(record.cards.map((card) => [card.key, card]));

  return (
    <>
      <PageHeader
        title="My records"
        lead="Records other government offices hold about you, linked to your Plateau Citizen ID."
      />

      <Notice title="Who owns these records">
        <p>
          Each office remains responsible for its own records. This portal shows you what they hold
          and links it to your ID; it does not replace them. If something is wrong, ask for a
          correction and it goes to the office that owns it.
        </p>
      </Notice>

      <div className="stack" style={{ marginTop: '1.25rem' }}>
        {SECTIONS.map((section) => {
          const card = byKey.get(section.key);
          if (card === undefined) return null;
          if (card.status === 'RESTRICTED') {
            return <Restricted key={section.key} title={card.title} reason={card.reason} />;
          }
          return <RecordCard key={section.key} card={card} blurb={section.blurb} />;
        })}
      </div>
    </>
  );
}

function RecordCard({ card, blurb }: { card: Card; blurb: string }) {
  const items = (card.items ?? []).filter((item) => Object.keys(item).length > 0);
  const headingId = `records-${card.key.toLowerCase()}`;

  return (
    <section className="card" aria-labelledby={headingId}>
      <div className="card-header">
        <h2 id={headingId}>{card.title}</h2>
      </div>
      <p className="muted small">{blurb}</p>

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
          Some details are not shown here: {card.restrictedFields.map(fieldLabel).join(', ')}.
        </p>
      ) : null}
    </section>
  );
}

function renderValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    // Balances come back in kobo, because money should not be a float.
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
