import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { Masthead, SiteFooter } from '@/components/chrome';
import { Field } from '@/components/fields';
import { Notice } from '@/components/feedback';
import { SubmitButton } from '@/components/form';
import { readSession } from '@/lib/session';

import { verifySecondFactor } from '../actions';

export const metadata: Metadata = { title: 'Confirm it is you' };

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await readSession();
  if (session === null) redirect('/sign-in');
  if (session.pendingMfaSessionId === null) redirect('/dashboard');

  const params = await searchParams;
  const error = typeof params.error === 'string' ? params.error : undefined;

  return (
    <>
      <Masthead />
      <main id="main">
        <div className="shell center-panel stack">
          <h1>Confirm it is you</h1>
          <p>
            Open your authenticator app and enter the six-digit code it is showing for the Plateau
            Citizen Portal.
          </p>

          {error === 'code' ? (
            <Notice tone="danger" title="That code is not correct" live>
              Codes change every thirty seconds. Wait for the next one and enter it.
            </Notice>
          ) : null}
          {error === 'throttled' ? (
            <Notice tone="danger" title="Too many attempts" live>
              Wait a few minutes before trying again.
            </Notice>
          ) : null}

          <section className="card">
            <form action={verifySecondFactor} noValidate>
              <Field
                name="code"
                label="Six-digit code"
                hint="Or one of your recovery codes if you cannot reach your authenticator."
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                maxLength={19}
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
