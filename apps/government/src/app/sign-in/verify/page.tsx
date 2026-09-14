import { Field, Notice, SubmitButton } from '@pcid/portal-kit/components';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { Masthead, SiteFooter } from '@/components/chrome';
import { readSession } from '@/lib/session';

import { verifySecondFactor } from '../actions';

export const metadata: Metadata = { title: 'Enter your code' };

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await readSession();
  if (session === null) redirect('/sign-in');
  if (session.pendingMfaSessionId === null) redirect('/home');

  const params = await searchParams;
  const error = typeof params.error === 'string' ? params.error : undefined;

  return (
    <>
      <Masthead />
      <main id="main">
        <div className="shell center-panel stack">
          <h1>Enter the code from your authenticator</h1>
          <p>
            Signed in as {session.email}. Your passphrase alone does not open this account — that is
            the point of the second step.
          </p>

          {error === undefined ? null : (
            <Notice
              tone="danger"
              title={error === 'throttled' ? 'Too many attempts' : 'That code was not accepted'}
              live
            >
              {error === 'throttled'
                ? 'Wait a moment before trying again.'
                : 'Codes change every thirty seconds. Check your authenticator app and enter the current one.'}
            </Notice>
          )}

          <section className="card">
            <form action={verifySecondFactor} noValidate>
              <Field
                name="code"
                label="Six-digit code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                maxLength={16}
              />
              <div className="actions">
                <SubmitButton pendingLabel="Checking…">Continue</SubmitButton>
              </div>
            </form>
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
