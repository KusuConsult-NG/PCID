import { Badge, Empty, Notice, SubmitButton, TableScroll } from '@pcid/portal-kit/components';
import { formatDateTime, sentenceCase } from '@pcid/portal-kit/format';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/chrome';
import { callApi, dataOr } from '@/lib/api';
import { readSession } from '@/lib/session';
import type { Me } from '@/lib/types';
import { actionLabel } from '@/lib/vocabulary';

import { clearWorkingCase, endSession } from './actions';

export const metadata: Metadata = { title: 'My account' };

interface OpenSession {
  readonly id: string;
  readonly current: boolean;
  readonly signedInAt: string;
  readonly expiresAt: string;
  readonly ipAddress: string | null;
  readonly device: string;
}

/**
 * What this account is, and where it is signed in.
 *
 * The entitlement list is read from `/auth/me` rather than assembled here, so
 * what an officer is told they can do is the same list the policy engine reads
 * when it decides. The clearance ceiling and the compartments are shown plainly
 * for the same reason: an investigator who does not know their agency is outside
 * the law-enforcement compartment will read a withheld card as an empty one.
 */
export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const session = await readSession();

  const [me, openSessions] = await Promise.all([
    callApi<Me>('/api/v1/auth/me'),
    callApi<OpenSession[]>('/api/v1/users/me/sessions'),
  ]);
  const account = dataOr(me, null);
  const open = dataOr(openSessions, []);

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
      {params.cleared === '1' ? (
        <Notice tone="ok" title="Working case cleared" live>
          Nothing was revoked — it never granted anything. You will be asked which case each record
          is being opened under.
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
            {account?.agency.code == null ? '' : ` (${account.agency.code})`}
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

        <p className="small muted">
          A record classified above your ceiling, or held in a compartment your agency is outside
          of, is withheld whatever case you are on. A case decides <em>whether</em> you may reach a
          person at all; it does not widen <em>what</em> you may see of them.
        </p>

        <h3>What you can do</h3>
        <ul className="entitlements">
          {[...(account?.actions ?? [])].sort().map((action) => (
            <li key={action}>
              <Badge tone="muted">{actionLabel(action)}</Badge>
            </li>
          ))}
        </ul>
      </section>

      <section className="card" aria-labelledby="case-heading">
        <div className="card-header">
          <h2 id="case-heading">Working case</h2>
        </div>
        {session?.workingCase == null ? (
          <Empty>
            You are not working under a case. Choose one from <Link href="/cases">Cases</Link> and
            the search and record screens will stop asking you to type it.
          </Empty>
        ) : (
          <>
            <dl className="facts">
              <dt>Case</dt>
              <dd>
                <Link href={`/cases/${encodeURIComponent(session.workingCase.reference)}`}>
                  {session.workingCase.reference}
                </Link>
              </dd>
              <dt>Title</dt>
              <dd>{session.workingCase.title}</dd>
            </dl>
            <p className="small muted">
              This is typing saved and nothing else. It is sent as the case reference on each
              request, and the engine decides afresh every time: the case has to be active, you have
              to be assigned to it, and the person has to be linked to it.
            </p>
            <form action={clearWorkingCase}>
              <div className="actions">
                <SubmitButton className="button button-secondary" pendingLabel="Clearing…">
                  Put this case down
                </SubmitButton>
              </div>
            </form>
          </>
        )}
      </section>

      <section className="card" aria-labelledby="passphrase-heading">
        <div className="card-header">
          <h2 id="passphrase-heading">Passphrase</h2>
        </div>
        <p>
          Changing it ends every other session for this account, including any shared terminal left
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
          If you do not recognise one of these, end it and change your passphrase. Anything opened
          from a session under your name is attributed to you, so a terminal somebody else is
          holding is your problem before it is theirs.
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
