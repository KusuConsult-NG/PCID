import { Badge, Field, Notice, SubmitButton } from '@pcid/portal-kit/components';
import { sentenceCase } from '@pcid/portal-kit/format';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/chrome';
import { can, readSession } from '@/lib/session';

import { verifyPcid, verifyScannedCode } from './actions';

export const metadata: Metadata = { title: 'Verify an ID' };

const ERRORS: Record<string, string> = {
  missing: 'Enter the Plateau Citizen ID as it appears on the card.',
  format: 'That does not look like a Plateau Citizen ID. They read PL-4K7T9-QM2XB-7H.',
  code: 'Scan the square code again, or type the ID instead.',
  failed: 'The check could not be completed. Please try again.',
};

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string): string | undefined =>
    typeof params[key] === 'string' ? (params[key] as string) : undefined;

  const session = await readSession();
  const permitted = can(session, 'CITIZEN_VERIFY');

  const error = one('error');
  const checked = one('checked');
  const scanned = one('scanned') === '1';
  const valid = one('valid') === 'true';
  const name = one('name');

  return (
    <>
      <PageHeader
        title="Verify an ID"
        lead="Confirm that a Plateau Citizen ID somebody has presented is live, and that the name on it is theirs."
      />

      {!permitted ? (
        <Notice tone="warn" title="Your account cannot verify identities">
          Ask your agency administrator for the verification role.
        </Notice>
      ) : null}

      {error === undefined ? null : (
        <Notice tone="danger" title="That did not work" live>
          {ERRORS[error] ?? ERRORS.failed}
        </Notice>
      )}

      {checked === undefined && !scanned ? null : (
        <Notice
          tone={valid ? 'ok' : 'danger'}
          title={valid ? 'This ID is live' : 'This ID is not valid'}
          live
        >
          <dl className="facts" style={{ marginBottom: 0 }}>
            <dt>Name on the record</dt>
            <dd>{name ?? '—'}</dd>
            {checked === undefined ? null : (
              <>
                <dt>Plateau Citizen ID</dt>
                <dd className="mono">{checked}</dd>
              </>
            )}
            {one('status') === undefined ? null : (
              <>
                <dt>Record status</dt>
                <dd>{sentenceCase(one('status') as string)}</dd>
              </>
            )}
            {one('assurance') === undefined ? null : (
              <>
                <dt>Identity checked</dt>
                <dd>{sentenceCase(one('assurance') as string)}</dd>
              </>
            )}
            {one('reason') === undefined ? null : (
              <>
                <dt>Why not</dt>
                <dd>{sentenceCase(one('reason') as string)}</dd>
              </>
            )}
          </dl>
        </Notice>
      )}

      <div className="grid">
        <section className="card" aria-labelledby="typed-heading">
          <div className="card-header">
            <h2 id="typed-heading">Type the ID</h2>
          </div>
          <form action={verifyPcid} noValidate>
            <Field
              name="pcid"
              id="typed-pcid"
              label="Plateau Citizen ID"
              hint="As printed on the card. Capital letters and hyphens do not matter."
              required
              maxLength={20}
            />
            <div className="actions">
              <SubmitButton pendingLabel="Checking…">Check this ID</SubmitButton>
            </div>
          </form>
        </section>

        <section className="card" id="scanned" aria-labelledby="scanned-heading">
          <div className="card-header">
            <h2 id="scanned-heading">Scan the square code</h2>
          </div>
          <p className="muted small">
            The code carries a meaningless short token that expires within minutes, so a photograph
            of somebody&rsquo;s screen is of no use afterwards. Scan into the box below.
          </p>
          <form action={verifyScannedCode} noValidate>
            <Field
              name="code"
              id="scanned-code"
              label="Scanned code"
              hint="Your reader will type the whole address; that is fine."
              required
              maxLength={512}
            />
            <div className="actions">
              <SubmitButton pendingLabel="Checking…">Check this code</SubmitButton>
            </div>
          </form>
        </section>
      </div>

      <Notice title="What this does not tell you">
        <p>
          It answers whether the identifier is live and the name printed on it. Nothing else — not
          an address, not a date of birth, not a tax record.
        </p>
        <p style={{ marginBottom: 0 }}>
          If you need more than that to do your job, <Link href="/find">open the record</Link> and
          state why. <Badge tone="muted">That is a separate, recorded act.</Badge>
        </p>
      </Notice>
    </>
  );
}
