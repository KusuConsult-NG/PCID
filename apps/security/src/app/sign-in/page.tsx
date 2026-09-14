import { Field, Notice, SubmitButton } from '@pcid/portal-kit/components';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { Masthead, SiteFooter } from '@/components/chrome';
import { readSession } from '@/lib/session';

import { signIn } from './actions';

export const metadata: Metadata = { title: 'Sign in' };

const ERRORS: Record<string, { title: string; body: string }> = {
  credentials: {
    title: 'Those sign-in details are not correct',
    body: 'Check your work email address and your passphrase, then try again.',
  },
  missing: { title: 'Fill in both boxes', body: 'Your email address and your passphrase.' },
  locked: {
    title: 'This account is locked',
    body: 'Too many attempts have been made. Contact your agency administrator.',
  },
  throttled: { title: 'Too many attempts', body: 'Wait a few minutes before trying again.' },
  expired: { title: 'Your session has ended', body: 'Sign in again to continue.' },
  unavailable: {
    title: 'The platform is not responding',
    body: 'This is a problem at our end. Please try again shortly.',
  },
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await readSession();
  if (session !== null && session.pendingMfaSessionId === null) redirect('/home');

  const params = await searchParams;
  const errorKey = typeof params.error === 'string' ? params.error : undefined;
  const error = errorKey === undefined ? undefined : ERRORS[errorKey];

  return (
    <>
      <Masthead />
      <main id="main">
        <div className="shell center-panel stack">
          <h1>Sign in</h1>

          {params['signed-out'] === '1' ? (
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
                name="email"
                label="Work email address"
                type="email"
                inputMode="email"
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

          <Notice title="Before you sign in">
            <p>
              A record opens to you because you are assigned to an open case and the person has been
              linked to it in writing. Not because of your rank, and not because of your agency.
            </p>
            <p style={{ marginBottom: 0 }}>
              Every step is recorded against your name and cannot afterwards be altered or deleted
              by anyone, including you. Nobody from the platform team will ever ask you for your
              passphrase or for a code from your authenticator.
            </p>
          </Notice>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
