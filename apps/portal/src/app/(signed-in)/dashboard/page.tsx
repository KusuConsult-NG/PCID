import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/chrome';
import { Badge, Notice } from '@pcid/portal-kit/components';
import { callApi, dataOr } from '@/lib/api';
import { formatDateTime, sentenceCase } from '@pcid/portal-kit/format';
import { purposeLabel } from '@/lib/vocabulary';
import type {
  AccessHistory,
  CitizenRecord,
  EmergencyContact,
  Me,
  NotificationInbox,
} from '@/lib/types';

export const metadata: Metadata = { title: 'Home' };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  const [meResult, recordResult, contactsResult, accessResult, inboxResult] = await Promise.all([
    callApi<Me>('/api/v1/auth/me'),
    callApi<CitizenRecord>('/api/v1/me/record'),
    callApi<EmergencyContact[]>('/api/v1/me/emergency-contacts'),
    callApi<AccessHistory>('/api/v1/me/access-history?limit=3'),
    callApi<NotificationInbox>('/api/v1/me/notifications?limit=3'),
  ]);

  const me = dataOr(meResult, null);
  const record = dataOr(recordResult, null);
  const contacts = dataOr(contactsResult, []);
  const access = dataOr(accessResult, null);
  const inbox = dataOr(inboxResult, null);

  const identity = record?.cards.find((card) => card.key === 'IDENTITY');
  const identityItem = identity?.status === 'RELEASED' ? identity.items?.[0] : undefined;

  return (
    <>
      <PageHeader
        title={`Hello, ${firstName(me?.displayName ?? 'there')}`}
        lead="This is your own record. Only you and authorised government officers acting for a stated reason can see it."
      />

      {params['passphrase-changed'] === '1' ? (
        <Notice tone="ok" title="Your passphrase has been changed" live>
          You were signed out everywhere else.
        </Notice>
      ) : null}

      <div className="grid" style={{ marginTop: '1.25rem' }}>
        <section className="card" aria-labelledby="dash-id">
          <div className="card-header">
            <h2 id="dash-id">Your Plateau Citizen ID</h2>
          </div>
          {identityItem === undefined ? (
            <p className="muted">Your record could not be loaded just now.</p>
          ) : (
            <>
              <p className="mono" style={{ fontSize: 'var(--step-2)', marginBottom: '0.25rem' }}>
                {String(identityItem.pcid ?? '')}
              </p>
              <p className="muted small">
                {String(identityItem.displayName ?? '')} ·{' '}
                {statusLabel(String(identityItem.status ?? ''))}
              </p>
            </>
          )}
          <Link className="button button-secondary" href="/identity">
            Show my ID and QR code
          </Link>
        </section>

        <section className="card" aria-labelledby="dash-contacts">
          <div className="card-header">
            <h2 id="dash-contacts">Emergency contacts</h2>
            <Badge tone={contacts.length === 0 ? 'warn' : 'ok'}>
              {contacts.length === 0 ? 'None yet' : `${contacts.length} saved`}
            </Badge>
          </div>
          {contacts.length === 0 ? (
            <p>
              These are the people called if you are in an accident and cannot speak for yourself.
              Adding one takes a minute.
            </p>
          ) : (
            <p>
              {contacts
                .slice(0, 2)
                .map((contact) => `${contact.fullName} (${contact.relationship})`)
                .join(', ')}
              {contacts.length > 2 ? ` and ${contacts.length - 2} more` : ''}
            </p>
          )}
          <Link className="button button-secondary" href="/emergency-contacts">
            {contacts.length === 0 ? 'Add an emergency contact' : 'Manage contacts'}
          </Link>
        </section>

        <section className="card" aria-labelledby="dash-access">
          <div className="card-header">
            <h2 id="dash-access">Who has seen my record</h2>
          </div>
          {access === null || access.accesses.length === 0 ? (
            <p className="muted">No access to show yet.</p>
          ) : (
            <ul className="stack" style={{ paddingLeft: '1.1rem', margin: 0 }}>
              {access.accesses.map((entry) => (
                <li key={entry.reference}>
                  <strong>{entry.agency ?? 'You'}</strong> — {purposeLabel(entry.purpose)}
                  <br />
                  <span className="muted small">{formatDateTime(entry.occurredAt)}</span>
                </li>
              ))}
            </ul>
          )}
          <p style={{ marginTop: '1rem' }}>
            <Link className="button button-secondary" href="/access-history">
              See the full history
            </Link>
          </p>
        </section>

        <section className="card" aria-labelledby="dash-messages">
          <div className="card-header">
            <h2 id="dash-messages">Messages</h2>
            {inbox !== null && inbox.unread > 0 ? (
              <Badge tone="info">{inbox.unread} unread</Badge>
            ) : null}
          </div>
          {inbox === null || inbox.notifications.length === 0 ? (
            <p className="muted">Nothing new.</p>
          ) : (
            <ul className="stack" style={{ paddingLeft: '1.1rem', margin: 0 }}>
              {inbox.notifications.map((message) => (
                <li key={message.id}>
                  {message.subject ?? 'Message'}
                  <br />
                  <span className="muted small">{formatDateTime(message.receivedAt)}</span>
                </li>
              ))}
            </ul>
          )}
          <p style={{ marginTop: '1rem' }}>
            <Link className="button button-secondary" href="/notifications">
              Open messages
            </Link>
          </p>
        </section>
      </div>

      <section className="card" style={{ marginTop: '1.25rem' }} aria-labelledby="dash-emergency">
        <div className="card-header">
          <h2 id="dash-emergency">In an emergency</h2>
        </div>
        <p>
          If someone is in danger right now, call the emergency number. You can also raise it here,
          which sends it straight to the emergency service with your reference.
        </p>
        <div className="actions">
          <Link className="button button-danger" href="/report#emergency">
            Raise an emergency
          </Link>
          <Link className="button button-secondary" href="/report#missing-person">
            Report someone missing
          </Link>
        </div>
      </section>

      {me !== null && !me.mfaEnrolled ? (
        <Notice tone="warn" title="Add a second step to sign in">
          <p>
            An authenticator app makes this account much harder for anyone else to get into, even if
            they learn your passphrase. <Link href="/security">Set it up now</Link> — it takes about
            two minutes.
          </p>
        </Notice>
      ) : null}
    </>
  );
}

function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] ?? displayName;
}

function statusLabel(status: string): string {
  switch (status) {
    case 'ACTIVE':
      return 'Active';
    case 'PENDING_VERIFICATION':
      return 'Awaiting verification';
    case 'SUSPENDED':
      return 'Suspended';
    default:
      return sentenceCase(status);
  }
}
