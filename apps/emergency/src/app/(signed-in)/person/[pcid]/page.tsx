import { Badge, Empty, Notice } from '@pcid/portal-kit/components';
import { fieldLabel } from '@pcid/portal-kit/format';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/chrome';
import { callApi } from '@/lib/api';
import { readSession } from '@/lib/session';
import type { EmergencyProfile } from '@/lib/types';

export const metadata: Metadata = { title: 'Emergency profile' };

/**
 * The Minimum Necessary Emergency Profile (§10, §38).
 *
 * The order on this page is clinical, not alphabetical: what you need to keep
 * somebody alive is at the top, who to telephone is next, and the identifying
 * details are last. A screen that made a responder scroll past a postcode to
 * find a blood group would be a worse screen even if it released exactly the
 * same fields.
 *
 * What was withheld is named rather than omitted (§29). A responder who cannot
 * tell "no allergies are recorded" from "you may not see their allergies" will
 * act on the first when the truth is the second.
 */

/** What emergency care needs, in the order it needs it. */
const CLINICAL = ['bloodGroup', 'emergencyMedicalNotes'];
const IDENTIFYING = ['displayName', 'approximateAge', 'sex', 'photographUri', 'lgaCode', 'pcid'];

export default async function EmergencyProfilePage({
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
  const incidentRef = one('incident') ?? session?.workingIncident?.reference;
  const breakGlassRef = one('breakGlass');

  if (incidentRef === undefined) {
    return (
      <>
        <PageHeader title="An emergency profile is read under an incident" />
        <Notice tone="warn" title="No incident given">
          <p>
            This portal cannot open anybody&rsquo;s details without one. That is not a setting: the
            policy engine refuses an emergency read that names no incident.
          </p>
          <p style={{ marginBottom: 0 }}>
            <Link href="/identify">Go back and name the incident</Link> you are attending.
          </p>
        </Notice>
      </>
    );
  }

  const search = new URLSearchParams({ incidentRef });
  if (breakGlassRef !== undefined) search.set('breakGlassRef', breakGlassRef);
  const result = await callApi<EmergencyProfile>(
    `/api/v1/citizens/${encodeURIComponent(pcid)}/emergency-profile?${search.toString()}`,
  );

  if (!result.ok) {
    const named = result.error.code === 'ACCESS_DENIED';
    return (
      <>
        <PageHeader title="Those details are not open to you" />
        <Notice
          tone="danger"
          title={
            result.error.code === 'INCIDENT_REFERENCE_REQUIRED'
              ? 'This read needs an incident'
              : named
                ? 'That incident is over'
                : 'No such record, or not one this incident reaches'
          }
        >
          <p>{result.error.message}</p>
          <p className="small muted" style={{ marginBottom: 0 }}>
            The platform answers the same way whether the record does not exist, the incident does
            not exist, or you are not attached to it — so a refusal never becomes a way of finding
            out. Reference <span className="mono">{result.error.correlationId}</span>.
          </p>
        </Notice>
        <Notice tone="warn" title="If somebody is in front of you and waiting causes harm">
          <p style={{ marginBottom: 0 }}>
            Ask control to attach you — that is the ordinary path and it takes seconds. If there is
            no time, <Link href="/authorisation#break-glass">break the glass</Link>: it lasts an
            hour at most, your supervisors are told at once, and somebody other than you reviews it
            within 24 hours.
          </p>
        </Notice>
      </>
    );
  }

  const profile = result.data;
  const data = profile.data;
  const withheld = profile.restrictedFields;
  const contacts = Array.isArray(data.emergencyContacts) ? data.emergencyContacts : [];

  return (
    <>
      <PageHeader title={String(data.displayName ?? pcid)} />

      <div className="incident-banner">
        <span>
          <strong>Read under:</strong>{' '}
          <Link href={`/incidents/${encodeURIComponent(incidentRef)}`}>{incidentRef}</Link>
        </span>
        <span className="mono small">{pcid}</span>
        {breakGlassRef === undefined ? null : (
          <Badge tone="danger">Break glass {breakGlassRef} — reviewed within 24 hours</Badge>
        )}
        <span className="small muted">
          Recorded against {session?.displayName ?? 'you'}, and visible to this person in their own
          access history.
        </span>
      </div>

      <section className="card" aria-labelledby="clinical-heading">
        <div className="card-header">
          <h2 id="clinical-heading">What care needs</h2>
        </div>
        <Facts data={data} fields={CLINICAL} withheld={withheld} />
      </section>

      <section className="card" aria-labelledby="contacts-heading">
        <div className="card-header">
          <h2 id="contacts-heading">Who to call</h2>
          <Badge tone="muted">{contacts.length}</Badge>
        </div>
        {withheld.some((field) => field.endsWith('emergencyContacts')) ? (
          <p className="restricted-body">
            Restricted information. Their emergency contacts were not released for this read.
          </p>
        ) : contacts.length === 0 ? (
          <Empty>
            Nobody is recorded. That means nobody was added, not that somebody was hidden.
          </Empty>
        ) : (
          <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {contacts.map((contact, index) => (
              <li key={index}>
                <strong>{String(asRecord(contact).fullName ?? 'Contact')}</strong>
                {asRecord(contact).relationship === undefined
                  ? null
                  : ` — ${String(asRecord(contact).relationship)}`}
                <br />
                <span className="mono">
                  {String(asRecord(contact).phonePrimary ?? asRecord(contact).phone ?? '—')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" aria-labelledby="identity-heading">
        <div className="card-header">
          <h2 id="identity-heading">Confirming it is them</h2>
        </div>
        <Facts data={data} fields={IDENTIFYING} withheld={withheld} />
      </section>

      <Notice title="This is the whole of it">
        <p style={{ marginBottom: 0 }}>
          There is no more to open from here. Their date of birth, address, telephone number, NIN,
          tax and property records and any case they appear in are not part of an emergency profile
          and no screen in this portal reaches them. If your enquiry has stopped being an emergency,
          it needs a different authority.
        </p>
      </Notice>

      {withheld.length === 0 ? null : (
        <p className="muted small">
          Withheld for this read: {withheld.map(fieldLabel).join(', ')}.
        </p>
      )}
    </>
  );
}

function Facts({
  data,
  fields,
  withheld,
}: {
  data: Record<string, unknown>;
  fields: readonly string[];
  withheld: readonly string[];
}) {
  const isWithheld = (field: string): boolean =>
    withheld.some((entry) => entry === field || entry.endsWith(`.${field}`));

  const rows = fields.filter((field) => field in data || isWithheld(field));
  if (rows.length === 0) return <Empty>Nothing recorded.</Empty>;

  return (
    <dl className="facts">
      {rows.map((field) => (
        <div key={field} style={{ display: 'contents' }}>
          <dt>{fieldLabel(field)}</dt>
          <dd>
            {isWithheld(field) ? (
              <span className="restricted-body">Restricted information.</span>
            ) : (
              render(data[field])
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function render(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Nothing recorded';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    if (/^[A-Z][A-Z_]+$/.test(value)) {
      const words = value.replace(/_/g, ' ').toLowerCase();
      return words.charAt(0).toUpperCase() + words.slice(1);
    }
    return value;
  }
  if (Array.isArray(value)) return value.length === 0 ? 'Nothing recorded' : `${value.length}`;
  return JSON.stringify(value);
}
