import { Badge, Empty, Field, Notice, SubmitButton, TextArea } from '@pcid/portal-kit/components';
import { formatDateTime } from '@pcid/portal-kit/format';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/chrome';
import { callApi, dataOr } from '@/lib/api';
import { can, readSession } from '@/lib/session';
import type { BreakGlassGrant } from '@/lib/types';
import { BREAK_GLASS_GATES } from '@/lib/vocabulary';

import { initiateBreakGlass, reviewBreakGlass } from './actions';

export const metadata: Metadata = { title: 'Break glass' };

/**
 * The exception, and the accounting it creates.
 *
 * This is the one portal whose readers genuinely reach for break glass, and the
 * page is written for the moment they do: somebody is in front of them, control
 * has not attached them, and waiting causes harm. The form is short, the reason
 * box is the largest thing on the page, and the review obligation is stated
 * before the button rather than after it.
 */
export default async function AuthorisationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string): string | undefined =>
    typeof params[key] === 'string' && params[key] !== '' ? (params[key] as string) : undefined;

  const session = await readSession();
  const mayBreak = can(session, 'BREAK_GLASS_INITIATE');
  const mayReview = can(session, 'BREAK_GLASS_REVIEW');

  const grants = mayReview
    ? await callApi<BreakGlassGrant[]>('/api/v1/break-glass/review-queue')
    : null;

  return (
    <>
      <PageHeader
        title="Break glass"
        lead="For when somebody is in front of you, the authority you need does not exist yet, and waiting causes harm."
      />

      {one('error') === undefined ? null : (
        <Notice tone="danger" title="That was not recorded" live>
          {one('error') === 'gates'
            ? 'Say which check you are asking to bypass.'
            : one('error') === 'reason'
              ? 'Write the emergency out. A reviewer has only what you put here, and "urgent" is not something anybody can assess.'
              : one('error') === 'note'
                ? 'Say what you found.'
                : (one('message') ?? 'Please try again.')}
        </Notice>
      )}

      {one('granted') === undefined ? null : (
        <Notice tone="warn" title={`Granted: ${one('granted')}`} live>
          <p>
            It expires{' '}
            {one('expires') === undefined
              ? 'within the hour'
              : formatDateTime(one('expires') as string)}
            . Your supervisors have already been told, and somebody other than you must review it
            within 24 hours.
          </p>
          {one('pcid') === undefined || one('pcid') === '' ? null : (
            <p style={{ marginBottom: 0 }}>
              <Link
                className="button"
                href={`/person/${encodeURIComponent(one('pcid') as string)}?incident=${encodeURIComponent(one('incident') ?? '')}&breakGlass=${encodeURIComponent(one('granted') as string)}`}
              >
                Open their emergency profile now
              </Link>
            </p>
          )}
        </Notice>
      )}

      {one('reviewed') === '1' ? (
        <Notice tone="ok" title="Review recorded" live>
          The grant and your finding are on the audit record.
        </Notice>
      ) : null}

      {!mayBreak ? (
        <section className="card" id="break-glass" aria-labelledby="bg-heading">
          <div className="card-header">
            <h2 id="bg-heading">Break glass</h2>
            <Badge tone="muted">Not held by this account</Badge>
          </div>
          <p>
            Emergency access is held by the response roles — incident officers and field responders
            — and not by this account. There is no button here because there is no entitlement
            behind it.
          </p>
          <p style={{ marginBottom: 0 }}>
            This is said plainly rather than left blank on purpose. If you need something you cannot
            reach and cannot wait, telephone control.
          </p>
        </section>
      ) : (
        <section className="card" id="break-glass" aria-labelledby="bg-heading">
          <div className="card-header">
            <h2 id="bg-heading">Break the glass</h2>
            <Badge tone="danger">Reviewed within 24 hours</Badge>
          </div>
          <p>
            First, ask control to attach you. That is the ordinary path, it takes seconds, and it
            leaves nobody with anything to account for.
          </p>
          <p>
            If there is no time: this lasts an hour at the outside, covers one person and one record
            type, tells your supervisors the moment you use it, and creates a review obligation that
            somebody other than you must discharge. It cannot give you a role you do not hold or
            take you past your clearance — an emergency is not a reason to see everything.
          </p>

          <form action={initiateBreakGlass} noValidate>
            <Field
              name="subjectPcid"
              id="bg-subject"
              label="Whose details you need"
              hint="The identifier from the credential."
              required
              maxLength={24}
            />
            <Field
              name="incidentRef"
              id="bg-incident"
              label="Which incident"
              defaultValue={session?.workingIncident?.reference ?? ''}
              maxLength={64}
            />

            <fieldset className="choices">
              <legend>Which check you are bypassing</legend>
              {BREAK_GLASS_GATES.map((gate) => (
                <label className="choice" key={gate.value} htmlFor={`gate-${gate.value}`}>
                  <input type="checkbox" id={`gate-${gate.value}`} name="gate" value={gate.value} />
                  <span>
                    {gate.label}
                    <span className="hint">{gate.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <TextArea
              name="reason"
              id="bg-reason"
              label="What is happening"
              hint="What you are facing, what you need, and why there is no time to ask. A reviewer reads this, and so does the person whose record it is."
              required
              maxLength={2000}
            />
            <div className="step-actions">
              <SubmitButton className="button button-danger" pendingLabel="Recording…">
                Break the glass
              </SubmitButton>
            </div>
          </form>
        </section>
      )}

      {grants === null ? null : (
        <section className="card" id="reviews" aria-labelledby="reviews-heading">
          <div className="card-header">
            <h2 id="reviews-heading">Reviews due</h2>
          </div>
          <p>
            Every grant is reviewed within 24 hours by somebody other than the officer who used it.
            This is the control that makes break glass acceptable; a queue that is not worked is not
            a control.
          </p>
          {dataOr(grants, []).length === 0 ? (
            <Empty>No emergency access is awaiting review.</Empty>
          ) : (
            <div className="stack">
              {dataOr(grants, []).map((grant) => (
                <div className="card" key={grant.reference} style={{ boxShadow: 'none' }}>
                  <div className="card-header">
                    <h3>{grant.reference}</h3>
                    <Badge tone="warn">Due {formatDateTime(grant.reviewDueAt)}</Badge>
                  </div>
                  <dl className="facts">
                    <dt>Officer</dt>
                    <dd>{grant.officer ?? '—'}</dd>
                    <dt>What they wrote</dt>
                    <dd>{grant.reason}</dd>
                    <dt>What it stood in for</dt>
                    <dd>{grant.gates.map(sentence).join(', ')}</dd>
                    <dt>Used</dt>
                    <dd>
                      {grant.accessCount === 0
                        ? 'Never relied on'
                        : `${grant.accessCount} ${grant.accessCount === 1 ? 'read' : 'reads'} under it`}
                    </dd>
                    {grant.incidentNumber === null ? null : (
                      <>
                        <dt>Incident</dt>
                        <dd className="mono">{grant.incidentNumber}</dd>
                      </>
                    )}
                  </dl>
                  <form action={reviewBreakGlass} noValidate>
                    <input type="hidden" name="reference" value={grant.reference} />
                    <TextArea
                      name="note"
                      id={`bg-note-${grant.reference}`}
                      label="Your finding"
                      hint="Was the emergency real, and was what they opened no more than it needed?"
                      required
                      maxLength={2000}
                    />
                    <div className="step-actions">
                      <SubmitButton
                        name="decision"
                        value="REVIEWED_JUSTIFIED"
                        pendingLabel="Recording…"
                      >
                        Justified
                      </SubmitButton>
                      <SubmitButton
                        className="button button-danger"
                        name="decision"
                        value="REVIEWED_UNJUSTIFIED"
                        pendingLabel="Recording…"
                      >
                        Not justified
                      </SubmitButton>
                    </div>
                  </form>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}

function sentence(value: string): string {
  const words = value.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
