import { Badge, Empty, Notice, SubmitButton, TableScroll } from '@pcid/portal-kit/components';
import { formatDateTime, sentenceCase } from '@pcid/portal-kit/format';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/chrome';
import { callApi, dataOr } from '@/lib/api';
import { readSession } from '@/lib/session';
import type { Me } from '@/lib/types';
import { actionLabel } from '@/lib/vocabulary';

import { endSession } from './actions';

export const metadata: Metadata = { title: 'My account' };

interface Session {
  readonly id: string;
  readonly current: boolean;
  readonly signedInAt: string;
  readonly expiresAt: string;
  readonly ipAddress: string | null;
  readonly device: string;
}

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const session = await readSession();

  const [me, sessions] = await Promise.all([
    callApi<Me>('/api/v1/auth/me'),
    callApi<Session[]>('/api/v1/users/me/sessions'),
  ]);
  const account = dataOr(me, null);
  const open = dataOr(sessions, []);

  return (
    <>
      <PageHeader
        title="My account"
        lead="What this account is entitled to, and where it is currently signed in."
      />

      {params.ended === '1' ? (
        <Notice tone="ok" title="That session has ended" live>
          Whoever was using it is signed out.
        </Notice>
      ) : null}
      {params.error === 'failed' ? (
        <Notice tone="danger" title="That session could not be ended" live>
          It may already have expired. Reload the page.
        </Notice>
      ) : null}

      <section className="card" aria-labelledby="entitlement-heading">
        <div className="card-header">
          <h2 id="entitlement-heading">Entitlements</h2>
          <Badge tone={account?.mfaEnrolled === true ? 'ok' : 'danger'}>
            {account?.mfaEnrolled === true ? 'Authenticator confirmed' : 'No authenticator'}
          </Badge>
        </div>
        <dl className="facts">
          <dt>Name</dt>
          <dd>{account?.displayName ?? session?.displayName ?? '—'}</dd>
          <dt>Email</dt>
          <dd>{account?.email ?? '—'}</dd>
          <dt>Agency</dt>
          <dd>
            {account?.agency.name ?? '—'}
            {account?.agency.code === null ? '' : ` (${account?.agency.code})`}
          </dd>
          <dt>Agency standing</dt>
          <dd>
            {sentenceCase(account?.agency.status ?? 'unknown')} · agreement{' '}
            {sentenceCase(account?.agency.dataSharingAgreement ?? 'unknown')}
          </dd>
          <dt>Roles</dt>
          <dd>{account?.roles.join(', ') || '—'}</dd>
          <dt>Clearance ceiling</dt>
          <dd>{sentenceCase(account?.clearance ?? 'unknown')}</dd>
          <dt>Compartments</dt>
          <dd>
            {account === null || account.compartments.length === 0
              ? 'None'
              : account.compartments.map(sentenceCase).join(', ')}
          </dd>
          <dt>Jurisdiction</dt>
          <dd>
            {sentenceCase(account?.jurisdiction.scope ?? 'unknown')}
            {account !== null && account.jurisdiction.lgaCodes.length > 0
              ? ` · ${account.jurisdiction.lgaCodes.join(', ')}`
              : ''}
          </dd>
          <dt>Authentication</dt>
          <dd>{account?.authenticationLevel ?? '—'}</dd>
        </dl>

        <h3>What you can do</h3>
        <ul className="entitlements">
          {[...(account?.actions ?? [])].sort().map((action) => (
            <li key={action}>
              <Badge tone="muted">{actionLabel(action)}</Badge>
            </li>
          ))}
        </ul>
      </section>

      <section className="card" aria-labelledby="passphrase-heading">
        <div className="card-header">
          <h2 id="passphrase-heading">Passphrase</h2>
        </div>
        <p>
          Changing it ends every other session for this account, including any counter machine left
          signed in.
        </p>
        <Link className="button button-secondary" href="/change-passphrase">
          Change my passphrase
        </Link>
      </section>

      <section className="card" aria-labelledby="sessions-heading">
        <div className="card-header">
          <h2 id="sessions-heading">Where you are signed in</h2>
        </div>
        <p>
          If you do not recognise one of these, end it and change your passphrase. A shared office
          machine somebody walked away from is the ordinary case.
        </p>

        {open.length === 0 ? (
          <Empty>No other sessions.</Empty>
        ) : (
          <TableScroll label="Devices signed in to your account">
            <table>
              <caption className="visually-hidden">Devices signed in to your account</caption>
              <thead>
                <tr>
                  <th scope="col">Device</th>
                  <th scope="col">Signed in</th>
                  <th scope="col">Address</th>
                  <th scope="col">
                    <span className="visually-hidden">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {open.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      {entry.device}
                      {entry.current ? (
                        <>
                          {' '}
                          <Badge tone="ok">This device</Badge>
                        </>
                      ) : null}
                    </td>
                    <td>{formatDateTime(entry.signedInAt)}</td>
                    <td className="mono small">{entry.ipAddress ?? '—'}</td>
                    <td>
                      {entry.current ? null : (
                        <form action={endSession}>
                          <input type="hidden" name="sessionId" value={entry.id} />
                          <SubmitButton className="button button-quiet" pendingLabel="Ending…">
                            End this session
                          </SubmitButton>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </section>
    </>
  );
}
