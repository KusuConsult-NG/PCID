import { Badge, Empty, Notice, SubmitButton, TextArea } from '@pcid/portal-kit/components';
import { formatDateTime, sentenceCase } from '@pcid/portal-kit/format';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/chrome';
import { callApi, dataOr } from '@/lib/api';
import { can, readSession } from '@/lib/session';
import type { Alert } from '@/lib/types';
import { severityTone } from '@/lib/vocabulary';

import { reviewAlert } from './actions';

export const metadata: Metadata = { title: 'Alerts' };

/**
 * Detection events, and what was done about them.
 *
 * Every alert shows the explanation that produced it. That is not a nicety: an
 * officer asked to act on a machine's output who cannot see why it fired has
 * only two options, believe it or ignore it, and both are bad.
 *
 * Dismissing as a false positive is offered as plainly as acting. A queue whose
 * only exit is action produces action rather than judgement, and a detection
 * system nobody is allowed to disagree with stops being evidence of anything.
 */
export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string): string | undefined =>
    typeof params[key] === 'string' ? (params[key] as string) : undefined;
  const status = one('status') ?? 'OPEN';

  const session = await readSession();
  const mayReview = can(session, 'ALERT_REVIEW');

  const result = await callApi<{ total: number; alerts: Alert[] }>(
    `/api/v1/alerts?status=${encodeURIComponent(status)}&limit=25`,
  );
  const queue = dataOr(result, null);

  return (
    <>
      <PageHeader
        title="Alerts"
        lead="Things the platform noticed. Each one names an event, not a person."
      />

      {one('error') === undefined ? null : (
        <Notice tone="danger" title="That was not recorded" live>
          {one('error') === 'note'
            ? 'Say what you found. "Checked" is not a finding.'
            : one('error') === 'decided'
              ? 'That alert had already been closed.'
              : 'Please try again.'}
        </Notice>
      )}

      {one('reviewed') === undefined ? null : (
        <Notice tone="ok" title="Recorded" live>
          {one('reviewed') === 'DISMISSED_FALSE_POSITIVE'
            ? 'Dismissed as a false positive. That is a useful record: it is how the thresholds get better.'
            : 'Your review is on the record under your name.'}
        </Notice>
      )}

      <nav className="actions" aria-label="Filter by status" style={{ marginBottom: '1.25rem' }}>
        {['OPEN', 'ACTIONED', 'DISMISSED_FALSE_POSITIVE', 'CLOSED'].map((value) => (
          <Link
            key={value}
            className={`button ${value === status ? '' : 'button-secondary'}`}
            href={`/alerts?status=${value}`}
          >
            {sentenceCase(value)}
          </Link>
        ))}
      </nav>

      {queue === null ? (
        <Notice tone="danger" title="The queue could not be loaded">
          Please try again shortly.
        </Notice>
      ) : queue.alerts.length === 0 ? (
        <section className="card">
          <Empty>Nothing here.</Empty>
        </section>
      ) : (
        <div className="stack">
          {queue.alerts.map((alert) => (
            <section
              className="card"
              key={alert.reference}
              aria-labelledby={`alert-${alert.reference}`}
            >
              <div className="card-header">
                <h2 id={`alert-${alert.reference}`}>{alert.title}</h2>
                <Badge tone={severityTone(alert.severity)}>{sentenceCase(alert.severity)}</Badge>
              </div>

              <p>{alert.summary}</p>

              <dl className="facts">
                <dt>Reference</dt>
                <dd className="mono">{alert.reference}</dd>
                <dt>Raised</dt>
                <dd>{formatDateTime(alert.raisedAt)}</dd>
                <dt>Kind</dt>
                <dd>{sentenceCase(alert.ruleKey)}</dd>
                {alert.agency === null ? null : (
                  <>
                    <dt>Agency</dt>
                    <dd>{alert.agency}</dd>
                  </>
                )}
                {alert.subjectPcid === null ? null : (
                  <>
                    <dt>Concerns the record</dt>
                    <dd>
                      <span className="mono">{alert.subjectPcid}</span>
                      <br />
                      <span className="muted small">
                        Opening it is a separate act under a stated purpose, and is recorded as one.
                      </span>
                    </dd>
                  </>
                )}
                {alert.confidence === null ? null : (
                  <>
                    <dt>Confidence</dt>
                    <dd>{alert.confidence}%</dd>
                  </>
                )}
                {alert.reviewedAt === null ? null : (
                  <>
                    <dt>Reviewed</dt>
                    <dd>
                      {formatDateTime(alert.reviewedAt)}
                      {alert.reviewedBy === null ? '' : ` by ${alert.reviewedBy}`}
                    </dd>
                    <dt>Finding</dt>
                    <dd>{alert.reviewNote ?? '—'}</dd>
                  </>
                )}
              </dl>

              <details>
                <summary>Why this was raised</summary>
                <dl className="facts" style={{ marginTop: '0.75rem' }}>
                  {Object.entries(alert.explanation).map(([key, value]) => (
                    <div key={key} style={{ display: 'contents' }}>
                      <dt>{sentenceCase(key.replace(/([a-z0-9])([A-Z])/g, '$1 $2'))}</dt>
                      <dd>{typeof value === 'string' ? value : JSON.stringify(value)}</dd>
                    </div>
                  ))}
                </dl>
              </details>

              {mayReview && (alert.status === 'OPEN' || alert.status === 'UNDER_REVIEW') ? (
                <form action={reviewAlert} noValidate style={{ marginTop: '1rem' }}>
                  <input type="hidden" name="reference" value={alert.reference} />
                  <TextArea
                    name="note"
                    id={`note-${alert.reference}`}
                    label="What you found"
                    hint="What you checked and what it turned out to be."
                    required
                    maxLength={2000}
                  />
                  <div className="actions">
                    <SubmitButton name="decision" value="ACTIONED" pendingLabel="Recording…">
                      Acted on it
                    </SubmitButton>
                    <SubmitButton
                      className="button button-secondary"
                      name="decision"
                      value="DISMISSED_FALSE_POSITIVE"
                      pendingLabel="Recording…"
                    >
                      False positive
                    </SubmitButton>
                    <SubmitButton
                      className="button button-quiet"
                      name="decision"
                      value="CLOSED"
                      pendingLabel="Recording…"
                    >
                      Close without action
                    </SubmitButton>
                  </div>
                </form>
              ) : null}
            </section>
          ))}
        </div>
      )}
    </>
  );
}
