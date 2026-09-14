import { Badge, Empty, Notice, SubmitButton, TextArea } from '@pcid/portal-kit/components';
import { fieldLabel, formatDateTime, sentenceCase } from '@pcid/portal-kit/format';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/chrome';
import { callApi, dataOr } from '@/lib/api';
import type { CorrectionRequest } from '@/lib/types';

import { decideCorrection } from './actions';

export const metadata: Metadata = { title: 'Corrections' };

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'info' | 'muted'> = {
  SUBMITTED: 'info',
  UNDER_REVIEW: 'info',
  EVIDENCE_REQUIRED: 'warn',
  APPROVED: 'ok',
  APPLIED: 'ok',
  REJECTED: 'danger',
};

/**
 * What people have asked to have put right about their own records.
 *
 * Oldest first, deliberately: a queue worked newest-first leaves the oldest
 * complaint permanently last, which is how a correction process becomes a way of
 * not correcting things.
 */
export default async function CorrectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string): string | undefined =>
    typeof params[key] === 'string' ? (params[key] as string) : undefined;
  const status = one('status') ?? 'SUBMITTED';

  const result = await callApi<{ total: number; requests: CorrectionRequest[] }>(
    `/api/v1/correction-requests?status=${encodeURIComponent(status)}&limit=25`,
  );
  const queue = dataOr(result, null);

  return (
    <>
      <PageHeader
        title="Corrections"
        lead="Changes people have asked for to their own records. Approving one changes the register."
      />

      {one('error') === undefined ? null : (
        <Notice tone="danger" title="That decision was not recorded" live>
          {one('error') === 'note'
            ? 'Write down what you checked. The resident and any later reviewer see this note.'
            : one('error') === 'decided'
              ? 'That request had already been decided.'
              : 'Please try again.'}
        </Notice>
      )}

      {one('decided') === undefined ? null : (
        <Notice
          tone="ok"
          title={
            one('decided') === 'APPLIED'
              ? 'Approved, and the record has been changed'
              : one('decided') === 'REJECTED'
                ? 'Rejected'
                : 'Returned for evidence'
          }
          live
        >
          The resident has been told, and the decision is on the audit record under your name.
        </Notice>
      )}

      <nav className="actions" aria-label="Filter by status" style={{ marginBottom: '1.25rem' }}>
        {['SUBMITTED', 'EVIDENCE_REQUIRED', 'APPLIED', 'REJECTED'].map((value) => (
          <Link
            key={value}
            className={`button ${value === status ? '' : 'button-secondary'}`}
            href={`/corrections?status=${value}`}
          >
            {sentenceCase(value)}
          </Link>
        ))}
      </nav>

      {queue === null ? (
        <Notice tone="danger" title="The queue could not be loaded">
          Please try again shortly.
        </Notice>
      ) : queue.requests.length === 0 ? (
        <section className="card">
          <Empty>Nothing here.</Empty>
        </section>
      ) : (
        <div className="stack">
          {queue.requests.map((request) => (
            <section
              className="card"
              key={request.reference}
              aria-labelledby={`request-${request.reference}`}
            >
              <div className="card-header">
                <h2 id={`request-${request.reference}`}>{fieldLabel(request.fieldPath)}</h2>
                <Badge tone={STATUS_TONE[request.status] ?? 'muted'}>
                  {sentenceCase(request.status)}
                </Badge>
              </div>

              <dl className="facts">
                <dt>Whose record</dt>
                <dd>
                  {request.subjectName} <span className="mono small">{request.subjectPcid}</span>
                </dd>
                <dt>Raised by</dt>
                <dd>{request.raisedBy}</dd>
                <dt>Currently</dt>
                <dd>{request.currentValue ?? '—'}</dd>
                <dt>Asked to be</dt>
                <dd>
                  <strong>{request.requestedValue}</strong>
                </dd>
                <dt>Reason given</dt>
                <dd>{request.justification}</dd>
                {request.evidenceReference === null ? null : (
                  <>
                    <dt>Evidence</dt>
                    <dd className="mono">{request.evidenceReference}</dd>
                  </>
                )}
                <dt>Asked</dt>
                <dd>{formatDateTime(request.submittedAt)}</dd>
                {request.reviewedAt === null ? null : (
                  <>
                    <dt>Decided</dt>
                    <dd>
                      {formatDateTime(request.reviewedAt)}
                      {request.reviewedBy === null ? '' : ` by ${request.reviewedBy}`}
                    </dd>
                    <dt>Note</dt>
                    <dd>{request.reviewNote ?? '—'}</dd>
                  </>
                )}
              </dl>

              {request.status === 'APPLIED' || request.status === 'REJECTED' ? null : (
                <>
                  {request.applicable ? null : (
                    <Notice tone="warn" title="This one cannot be applied here">
                      That field is not one a resident may have changed through this queue. Reject
                      it, and say what the right route is.
                    </Notice>
                  )}
                  <form action={decideCorrection} noValidate style={{ marginTop: '1rem' }}>
                    <input type="hidden" name="reference" value={request.reference} />
                    <TextArea
                      name="note"
                      id={`note-${request.reference}`}
                      label="What you checked"
                      hint="The resident sees this, and so does anyone reviewing the decision later."
                      required
                      maxLength={2000}
                    />
                    <div className="actions">
                      <SubmitButton
                        name="decision"
                        value="APPROVE"
                        pendingLabel="Applying…"
                        className={request.applicable ? 'button' : 'button button-secondary'}
                      >
                        Approve and change the record
                      </SubmitButton>
                      <SubmitButton
                        className="button button-secondary"
                        name="decision"
                        value="REQUEST_EVIDENCE"
                        pendingLabel="Sending…"
                      >
                        Ask for evidence
                      </SubmitButton>
                      <SubmitButton
                        className="button button-danger"
                        name="decision"
                        value="REJECT"
                        pendingLabel="Recording…"
                      >
                        Reject
                      </SubmitButton>
                    </div>
                  </form>
                </>
              )}
            </section>
          ))}
        </div>
      )}

      <Notice title="Approving is not the same as agreeing">
        <p style={{ marginBottom: 0 }}>
          An approval writes the new value onto the identity register immediately. If you are not
          sure, ask for evidence — that is what the middle option is for.
        </p>
      </Notice>
    </>
  );
}
