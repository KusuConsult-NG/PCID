import { Field, Notice, SubmitButton } from '@pcid/portal-kit/components';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { Masthead, SiteFooter } from '@/components/chrome';
import { readSession } from '@/lib/session';

import { stepUp } from './actions';

export const metadata: Metadata = { title: 'Confirm it is you' };

export default async function StepUpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await readSession();
  if (session === null) redirect('/sign-in');

  const params = await searchParams;
  const returnTo = typeof params.return === 'string' ? params.return : '/home';
  const error = typeof params.error === 'string' ? params.error : undefined;

  return (
    <>
      <Masthead />
      <main id="main">
        <div className="shell center-panel stack">
          <h1>Confirm it is you</h1>
          <p>
            What you are about to do reaches past an ordinary check, so the platform wants the
            second factor again — not the one you gave at the start of the shift.
          </p>

          {error === undefined ? null : (
            <Notice
              tone="danger"
              title={error === 'throttled' ? 'Too many attempts' : 'That code was not accepted'}
              live
            >
              {error === 'throttled'
                ? 'Wait a moment before trying again.'
                : 'Codes change every thirty seconds. Enter the one showing now.'}
            </Notice>
          )}

          <section className="card">
            <form action={stepUp} noValidate>
              <input type="hidden" name="return" value={returnTo} />
              <Field
                name="code"
                label="Six-digit code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                maxLength={16}
              />
              <div className="actions">
                <SubmitButton pendingLabel="Checking…">Confirm</SubmitButton>
              </div>
            </form>
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
