import { Field, Notice, SubmitButton } from '@pcid/portal-kit/components';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { Masthead, SiteFooter } from '@/components/chrome';
import { readSession } from '@/lib/session';

import { changePassphrase } from './actions';

export const metadata: Metadata = { title: 'Choose your passphrase' };

const ERRORS: Record<string, string> = {
  mismatch: 'The two new passphrases do not match. Type the same one in both boxes.',
  current: 'Your current passphrase is not correct.',
  policy: 'That passphrase does not meet the requirements.',
  failed: 'The passphrase could not be changed. Please try again.',
};

export default async function ChangePassphrasePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await readSession();
  if (session === null) redirect('/sign-in');
  if (session.pendingMfaSessionId !== null) redirect('/sign-in/verify');

  const params = await searchParams;
  const errorKey = typeof params.error === 'string' ? params.error : undefined;
  const detail = typeof params.detail === 'string' ? params.detail : undefined;
  const forced = session.mustChangePassword;

  return (
    <>
      <Masthead />
      <main id="main">
        <div className="shell center-panel stack">
          <h1>{forced ? 'Choose your own passphrase' : 'Change your passphrase'}</h1>
          {forced ? (
            <p>
              Your account was set up with a passphrase an administrator chose and typed, so two
              people know it. Choose one only you know before you open a case file.
            </p>
          ) : null}

          {errorKey === undefined ? null : (
            <Notice tone="danger" title="That did not work" live>
              {`${ERRORS[errorKey] ?? ERRORS.failed}${detail === undefined ? '' : ` ${detail}`}`}
            </Notice>
          )}

          <section className="card">
            <form action={changePassphrase} noValidate>
              <Field
                name="currentPassword"
                label="Current passphrase"
                type="password"
                autoComplete="current-password"
                required
                maxLength={256}
              />
              <Field
                name="newPassword"
                label="New passphrase"
                type="password"
                hint="At least 14 characters, with capital and small letters and a number. Do not use your own name or your email address. A few unrelated words are easier to remember and harder to guess than a short complicated one."
                autoComplete="new-password"
                required
                maxLength={256}
              />
              <Field
                name="confirmPassword"
                label="Type the new passphrase again"
                type="password"
                autoComplete="new-password"
                required
                maxLength={256}
              />
              <div className="actions">
                <SubmitButton pendingLabel="Saving…">Save passphrase</SubmitButton>
              </div>
            </form>
          </section>

          <Notice title="What happens next">
            Changing your passphrase ends every other session for this account, including the one on
            the counter machine you may have left signed in.
          </Notice>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
