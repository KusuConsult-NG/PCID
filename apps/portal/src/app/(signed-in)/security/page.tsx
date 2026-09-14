import type { Metadata } from 'next';
import Link from 'next/link';
import QRCode from 'qrcode';

import { PageHeader } from '@/components/chrome';
import { Badge, Empty, Notice } from '@pcid/portal-kit/components';
import { Field } from '@pcid/portal-kit/components';
import { SubmitButton } from '@pcid/portal-kit/components';
import { callApi, dataOr } from '@/lib/api';
import { formatDateTime } from '@pcid/portal-kit/format';
import { readSession } from '@/lib/session';
import type { Me, PortalSessionRow } from '@/lib/types';

import {
  beginAuthenticatorSetup,
  cancelAuthenticatorSetup,
  confirmAuthenticator,
  endSession,
} from './actions';

export const metadata: Metadata = { title: 'Security' };

const ERRORS: Record<string, string> = {
  code: 'That code is not correct. Codes change every thirty seconds — wait for the next one.',
  already: 'This account already has an authenticator.',
  failed: 'That did not work. Please try again.',
};

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const errorKey = typeof params.error === 'string' ? params.error : undefined;

  const [session, meResult, sessionsResult] = await Promise.all([
    readSession(),
    callApi<Me>('/api/v1/auth/me'),
    callApi<PortalSessionRow[]>('/api/v1/me/sessions'),
  ]);

  const me = dataOr(meResult, null);
  const sessions = dataOr(sessionsResult, []);
  const pending = session?.pendingEnrolment ?? null;

  const enrolmentQr =
    pending === null
      ? null
      : await QRCode.toString(pending.provisioningUri, {
          type: 'svg',
          errorCorrectionLevel: 'M',
          margin: 0,
        });

  return (
    <>
      <PageHeader
        title="Security"
        lead="How this account is protected, and where it is signed in."
      />

      {params.authenticator === '1' ? (
        <Notice tone="ok" title="Your authenticator is set up" live>
          You will be asked for a code from it each time you sign in.
        </Notice>
      ) : null}
      {params.ended === '1' ? (
        <Notice tone="ok" title="That session has ended" live>
          Whoever was using it will have to sign in again.
        </Notice>
      ) : null}
      {errorKey === undefined ? null : (
        <Notice tone="danger" title="That did not work" live>
          {ERRORS[errorKey] ?? ERRORS.failed}
        </Notice>
      )}

      <section className="card" aria-labelledby="passphrase-heading">
        <div className="card-header">
          <h2 id="passphrase-heading">Passphrase</h2>
        </div>
        <p>
          Use a long passphrase you have not used anywhere else. Changing it signs you out
          everywhere else, which is how you take the account back if someone else has been using it.
        </p>
        <Link className="button button-secondary" href="/change-passphrase">
          Change my passphrase
        </Link>
      </section>

      <section className="card" id="authenticator" aria-labelledby="authenticator-heading">
        <div className="card-header">
          <h2 id="authenticator-heading">Second step when signing in</h2>
          <Badge tone={me?.mfaEnrolled === true ? 'ok' : 'warn'}>
            {me?.mfaEnrolled === true ? 'Set up' : 'Not set up'}
          </Badge>
        </div>

        {me?.mfaEnrolled === true ? (
          <p>
            You are asked for a code from your authenticator app each time you sign in. Even
            somebody who learns your passphrase cannot get in without your phone.
          </p>
        ) : pending === null ? (
          <>
            <p>
              An authenticator app on your phone shows a six-digit code that changes every thirty
              seconds. Adding one makes this account much harder for anyone else to open.
            </p>
            <form action={beginAuthenticatorSetup}>
              <SubmitButton pendingLabel="Setting up…">Set up an authenticator</SubmitButton>
            </form>
          </>
        ) : (
          <div className="stack">
            <ol className="stack" style={{ paddingLeft: '1.25rem' }}>
              <li>Open your authenticator app and choose to add an account.</li>
              <li>
                Scan this square code. If you cannot scan, type the key underneath it instead.
              </li>
              <li>Enter the six-digit code the app then shows.</li>
            </ol>

            <div className="qr-panel">
              <div
                className="qr-frame"
                role="img"
                aria-label="Square code to scan with your authenticator app"
                dangerouslySetInnerHTML={{ __html: enrolmentQr ?? '' }}
              />
              <div>
                <p className="small muted">If you cannot scan it, type this key into the app:</p>
                <p className="mono" style={{ overflowWrap: 'anywhere' }}>
                  {pending.secret}
                </p>
              </div>
            </div>

            <Notice tone="warn" title="Write these recovery codes down now">
              <p>
                If you lose your phone, one of these gets you back in. Each works once. They are not
                shown again.
              </p>
              <ul className="mono" style={{ columns: 2, marginBottom: 0 }}>
                {pending.recoveryCodes.map((code) => (
                  <li key={code}>{code}</li>
                ))}
              </ul>
            </Notice>

            <form action={confirmAuthenticator} noValidate>
              <Field
                name="code"
                label="Six-digit code from the app"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                maxLength={6}
              />
              <div className="actions">
                <SubmitButton pendingLabel="Confirming…">Confirm</SubmitButton>
              </div>
            </form>

            <form action={cancelAuthenticatorSetup}>
              <SubmitButton className="button button-quiet">Cancel this setup</SubmitButton>
            </form>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="sessions-heading">
        <div className="card-header">
          <h2 id="sessions-heading">Where you are signed in</h2>
        </div>
        <p>If you do not recognise one of these, end it and change your passphrase.</p>

        {sessions.length === 0 ? (
          <Empty>No other sessions.</Empty>
        ) : (
          <div className="table-scroll">
            <table>
              <caption className="visually-hidden">
                Devices currently signed in to your account
              </caption>
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
                {sessions.map((entry) => (
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
          </div>
        )}
      </section>

      <Notice title="What we will never do">
        <p style={{ marginBottom: 0 }}>
          Nobody from the government will ever ask you for your passphrase or a code from your
          authenticator — not by phone, not by message, not at a counter. If someone does, it is not
          us. <Link href="/report#identity-fraud">Report it</Link>.
        </p>
      </Notice>
    </>
  );
}
