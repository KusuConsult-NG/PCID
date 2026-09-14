import {
  Badge,
  Empty,
  Notice,
  SubmitButton,
  TableScroll,
  TextArea,
} from '@pcid/portal-kit/components';
import { formatDateTime, sentenceCase } from '@pcid/portal-kit/format';
import type { Metadata } from 'next';

import { PageHeader } from '@/components/chrome';
import { callApi, dataOr } from '@/lib/api';
import { can, readSession } from '@/lib/session';
import type { Agency, DataSource, GovernmentUser, NotificationQueue } from '@/lib/types';

import { retryNotification, sweepNotifications } from './actions';

export const metadata: Metadata = { title: 'Administration' };

/**
 * Administration, which is emphatically not access to the register (§7).
 *
 * Everything on this page is about agencies, accounts and data sources. None of
 * it is about a person on the register, and holding an administrator role
 * confers no entitlement to citizen data — the policy engine never widens a data
 * decision because the caller is an administrator.
 */
export default async function AdministrationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string): string | undefined =>
    typeof params[key] === 'string' && params[key] !== '' ? (params[key] as string) : undefined;

  const session = await readSession();

  const [agencies, users, sources, queue] = await Promise.all([
    can(session, 'ADMIN_AGENCY_MANAGE') ? callApi<Agency[]>('/api/v1/agencies') : null,
    can(session, 'ADMIN_USER_MANAGE')
      ? callApi<{ total: number; users: GovernmentUser[] }>('/api/v1/users?limit=100')
      : null,
    can(session, 'ADMIN_INTEGRATION_MANAGE') ? callApi<DataSource[]>('/api/v1/integrations') : null,
    // Delivery is administration, not access: this returns counts and causes,
    // and no message body, subject or recipient.
    can(session, 'ADMIN_SYSTEM_MANAGE')
      ? callApi<NotificationQueue>('/api/v1/notifications/queue')
      : null,
  ]);

  return (
    <>
      <PageHeader
        title="Administration"
        lead="Agencies, accounts and the agency systems the platform draws projections from."
      />

      <Notice title="Administration is not access">
        <p style={{ marginBottom: 0 }}>
          Nothing on this page is a citizen record, and holding an administrator role gives you no
          entitlement to one. That separation is enforced by the policy engine, not by this
          interface.
        </p>
      </Notice>

      {agencies === null ? null : (
        <section className="card" aria-labelledby="agencies-heading">
          <div className="card-header">
            <h2 id="agencies-heading">Government Agency Registry</h2>
          </div>
          <p className="muted small">
            An agency reaches citizen data only while it is active <em>and</em> its data-sharing
            agreement is in force. The expiry is evaluated on every request, so a lapse stops access
            at once rather than overnight.
          </p>
          <Table
            rows={dataOr(agencies, [])}
            empty="No agencies are registered."
            caption="Agencies in the Government Agency Registry"
            columns={[
              { header: 'Code', render: (agency) => <span className="mono">{agency.code}</span> },
              { header: 'Name', render: (agency) => agency.name },
              { header: 'Category', render: (agency) => sentenceCase(agency.category) },
              {
                header: 'Status',
                render: (agency) => (
                  <Badge tone={agency.status === 'ACTIVE' ? 'ok' : 'warn'}>
                    {sentenceCase(agency.status)}
                  </Badge>
                ),
              },
              {
                header: 'Agreement',
                render: (agency) => (
                  <Badge tone={agency.dataSharingAgreement === 'SIGNED' ? 'ok' : 'danger'}>
                    {sentenceCase(agency.dataSharingAgreement)}
                  </Badge>
                ),
              },
              { header: 'Ceiling', render: (agency) => sentenceCase(agency.maxClassification) },
              {
                header: 'Compartments',
                render: (agency) =>
                  agency.compartments.length === 0
                    ? '—'
                    : agency.compartments.map(sentenceCase).join(', '),
              },
            ]}
          />
        </section>
      )}

      {users === null ? null : (
        <section className="card" aria-labelledby="users-heading">
          <div className="card-header">
            <h2 id="users-heading">Accounts</h2>
            <Badge tone="muted">{dataOr(users, { total: 0 }).total} total</Badge>
          </div>
          <p className="muted small">
            An account that never confirmed an authenticator cannot reach citizen data at all — the
            policy engine refuses a government user who is not enrolled. An account nobody has
            signed into for months is the one to ask about.
          </p>
          <Table
            rows={dataOr(users, { users: [] }).users}
            empty="No accounts."
            caption="Government accounts you administer"
            columns={[
              { header: 'Name', render: (user) => user.fullName },
              { header: 'Email', render: (user) => <span className="small">{user.email}</span> },
              { header: 'Agency', render: (user) => user.agency },
              { header: 'Roles', render: (user) => user.roles.join(', ') || '—' },
              {
                header: 'Status',
                render: (user) => (
                  <Badge tone={user.status === 'ACTIVE' ? 'ok' : 'warn'}>
                    {sentenceCase(user.status)}
                  </Badge>
                ),
              },
              {
                header: 'Authenticator',
                render: (user) => (
                  <Badge tone={user.authenticatorConfirmed ? 'ok' : 'danger'}>
                    {user.authenticatorConfirmed ? 'Confirmed' : 'Not set up'}
                  </Badge>
                ),
              },
              {
                header: 'Last signed in',
                render: (user) =>
                  user.lastSignedInAt === null ? 'Never' : formatDateTime(user.lastSignedInAt),
              },
            ]}
          />
        </section>
      )}

      {sources === null ? null : (
        <section className="card" aria-labelledby="sources-heading">
          <div className="card-header">
            <h2 id="sources-heading">Agency data sources</h2>
          </div>
          <p className="muted small">
            The platform holds a projection of each of these and never writes back: the agency
            remains responsible for its own records. What matters here is freshness — a stale
            projection shown as current is worse than no projection.
          </p>
          <Table
            rows={dataOr(sources, [])}
            empty="No data sources are registered."
            caption="Agency systems the platform projects from"
            columns={[
              { header: 'System', render: (source) => source.systemName },
              { header: 'Agency', render: (source) => source.agencyCode ?? '—' },
              { header: 'Domain', render: (source) => sentenceCase(source.domain) },
              {
                header: 'Mode',
                render: (source) => (
                  <Badge tone={source.mode === 'SANDBOX' ? 'warn' : 'ok'}>
                    {sentenceCase(source.mode)}
                  </Badge>
                ),
              },
              {
                header: 'Last sync',
                render: (source) =>
                  source.lastSync.finishedAt === null
                    ? 'Never'
                    : `${sentenceCase(source.lastSync.status ?? 'unknown')} · ${formatDateTime(source.lastSync.finishedAt)}`,
              },
              {
                header: 'Last error',
                render: (source) =>
                  source.lastError === null ? (
                    '—'
                  ) : (
                    <span className="small">{source.lastError}</span>
                  ),
              },
            ]}
          />
        </section>
      )}

      {queue === null ? null : (
        <section className="card" id="delivery" aria-labelledby="delivery-heading">
          <div className="card-header">
            <h2 id="delivery-heading">Message delivery</h2>
            <Badge tone={dataOr(queue, { abandoned: [] }).abandoned.length === 0 ? 'ok' : 'danger'}>
              {dataOr(queue, { abandoned: [] }).abandoned.length} abandoned
            </Badge>
          </div>

          {one('error') === undefined ? null : (
            <Notice tone="danger" title="That could not be done" live>
              {one('error') === 'note'
                ? 'Say why you are putting it back. The next person reading this queue needs the sentence.'
                : (one('message') ?? 'Please try again.')}
            </Notice>
          )}
          {one('requeued') === '1' ? (
            <Notice tone="ok" title="Back on the queue" live>
              Nothing about what it says has changed — that was decided when the message was raised.
            </Notice>
          ) : null}
          {one('swept') === undefined ? null : (
            <Notice tone="ok" title={`${one('swept')} sent`} live>
              {one('claimed')} taken from the queue.
            </Notice>
          )}

          <p>
            What is waiting, what is failing and what has been given up on. This screen shows no
            message body, no subject and no recipient: a delivery queue does not need to read
            anybody&rsquo;s post, and a screen that showed it would be a second copy of every inbox
            with none of the controls on the first.
          </p>

          <Table
            rows={dataOr(queue, { counts: [] }).counts}
            caption="Queued messages by channel and status"
            empty="Nothing has been queued."
            columns={[
              { header: 'Channel', render: (row) => sentenceCase(row.channel) },
              {
                header: 'Status',
                render: (row) => (
                  <Badge tone={statusTone(row.status)}>{sentenceCase(row.status)}</Badge>
                ),
              },
              { header: 'Messages', render: (row) => row.count },
            ]}
          />

          <dl className="facts">
            <dt>Oldest still waiting</dt>
            <dd>
              {dataOr(queue, { oldestWaitingAt: null }).oldestWaitingAt === null
                ? 'Nothing is waiting.'
                : formatDateTime(dataOr(queue, { oldestWaitingAt: null }).oldestWaitingAt)}
            </dd>
          </dl>

          <form action={sweepNotifications}>
            <div className="actions">
              <SubmitButton className="button button-secondary" pendingLabel="Sending…">
                Run a delivery sweep now
              </SubmitButton>
            </div>
          </form>

          <h3>Failures in the last 24 hours</h3>
          <Table
            rows={dataOr(queue, { failuresLast24Hours: [] }).failuresLast24Hours}
            caption="Delivery failures grouped by cause"
            empty="Nothing has failed."
            columns={[
              { header: 'Channel', render: (row) => sentenceCase(row.channel) },
              { header: 'What the gateway said', render: (row) => row.detail ?? '—' },
              { header: 'Times', render: (row) => row.count },
            ]}
          />

          <h3>Given up on</h3>
          <p className="muted small">
            Five attempts with backoff, then the platform stops. A queue that retries for ever is a
            queue whose depth means nothing, and an operator who cannot tell a backlog from a
            permanently broken number stops looking at either.
          </p>
          {dataOr(queue, { abandoned: [] }).abandoned.length === 0 ? (
            <Empty>Nothing has been abandoned.</Empty>
          ) : (
            <div className="stack">
              {dataOr(queue, { abandoned: [] }).abandoned.map((entry) => (
                <div className="card" key={entry.id} style={{ boxShadow: 'none' }}>
                  <div className="card-header">
                    <h4>{sentenceCase(entry.template)}</h4>
                    <Badge tone="danger">
                      {sentenceCase(entry.channel)} · {entry.attempts} attempts
                    </Badge>
                  </div>
                  <dl className="facts">
                    <dt>Raised</dt>
                    <dd>{formatDateTime(entry.queuedAt)}</dd>
                    <dt>Last error</dt>
                    <dd>{entry.lastError ?? '—'}</dd>
                  </dl>
                  <form action={retryNotification} noValidate>
                    <input type="hidden" name="notificationId" value={entry.id} />
                    <TextArea
                      name="note"
                      id={`retry-note-${entry.id}`}
                      label="Why you are putting it back"
                      hint="What was fixed. The next person reading this queue needs the sentence."
                      required
                      maxLength={500}
                    />
                    <div className="actions">
                      <SubmitButton pendingLabel="Requeueing…">
                        Put it back on the queue
                      </SubmitButton>
                    </div>
                  </form>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {agencies === null && users === null && sources === null && queue === null ? (
        <section className="card">
          <Empty>Your account holds no administration entitlements.</Empty>
        </section>
      ) : null}
    </>
  );
}

function statusTone(status: string): 'ok' | 'warn' | 'danger' | 'info' | 'muted' {
  switch (status) {
    case 'SENT':
    case 'DELIVERED':
      return 'ok';
    case 'QUEUED':
    case 'SENDING':
      return 'info';
    case 'FAILED':
      return 'danger';
    default:
      return 'muted';
  }
}

function Table<T>({
  rows,
  columns,
  caption,
  empty,
}: {
  rows: readonly T[];
  columns: readonly { header: string; render: (row: T) => React.ReactNode }[];
  caption: string;
  empty: string;
}) {
  if (rows.length === 0) return <Empty>{empty}</Empty>;
  return (
    <TableScroll label={caption}>
      <table>
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th scope="col" key={column.header}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map((column) => (
                <td key={column.header}>{column.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}
