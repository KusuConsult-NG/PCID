import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { Masthead, SiteFooter } from '@/components/chrome';
import { Field } from '@/components/fields';
import { Notice } from '@/components/feedback';
import { SubmitButton } from '@/components/form';
import { readSession } from '@/lib/session';

import { signIn } from './actions';

export const metadata: Metadata = { title: 'Sign in' };

const ERRORS: Record<string, { title: string; body: string }> = {
  credentials: {
    title: 'Those sign-in details are not correct',
    body: 'Check your Plateau Citizen ID or email address and your passphrase, then try again.',
  },
  missing: {
    title: 'Fill in both boxes',
    body: 'Enter your Plateau Citizen ID or email address, and your passphrase.',
  },
  locked: {
    title: 'This account is locked',
    body: 'Too many sign-in attempts have been made. Wait fifteen minutes, or visit a registration desk with your ID.',
  },
  throttled: {
    title: 'Too many attempts',
    body: 'Wait a few minutes before trying again.',
  },
  expired: {
    title: 'That took too long',
    body: 'Start again from here.',
  },
  unavailable: {
    title: 'The service is not responding',
    body: 'This is a problem at our end, not yours. Please try again shortly.',
  },
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await readSession();
  if (session !== null && session.pendingMfaSessionId === null) redirect('/dashboard');

  const params = await searchParams;
  const errorKey = typeof params.error === 'string' ? params.error : undefined;
  const error = errorKey === undefined ? undefined : ERRORS[errorKey];
  const signedOut = params['signed-out'] === '1';

  return (
    <>
      <Masthead />
      <main id="main">
        <div className="shell center-panel stack">
          <h1>Sign in</h1>

          {signedOut ? (
            <Notice tone="ok" live>
              You have been signed out.
            </Notice>
          ) : null}

          {error === undefined ? null : (
            <Notice tone="danger" title={error.title} live>
              {error.body}
            </Notice>
          )}

          <section className="card">
            <form action={signIn} noValidate>
              <Field
                name="identifier"
                label="Plateau Citizen ID or email address"
                hint="Your ID looks like PL-4K7T9-QM2XB-7H. Capital letters and hyphens do not matter."
                autoComplete="username"
                required
                maxLength={320}
              />
              <Field
                name="password"
                label="Passphrase"
                type="password"
                autoComplete="current-password"
                required
                maxLength={256}
              />
              <div className="actions">
                <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
              </div>
            </form>
          </section>

          <Notice title="No sign-in details yet?">
            <p>
              Portal details are handed over in person at a registration desk, after your identity
              has been checked. There is deliberately no way to sign yourself up: it would let
              anyone who knows a Plateau Citizen ID claim that record.
            </p>
          </Notice>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
