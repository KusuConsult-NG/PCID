import { Badge, Empty, Notice, SubmitButton, TextArea } from '@pcid/portal-kit/components';
import { fieldLabel, formatDateTime, sentenceCase } from '@pcid/portal-kit/format';
import type { Metadata } from 'next';

import { PageHeader } from '@/components/chrome';
import { callApi, dataOr } from '@/lib/api';
import { can, readSession } from '@/lib/session';
import type { AccessRequest } from '@/lib/types';
import { purposeLabel } from '@/lib/vocabulary';

import { decideAccessRequest, reviewBreakGlass } from './actions';

export const metadata: Metadata = { title: 'Access requests' };

interface BreakGlassGrant {
  readonly reference: string;
  readonly officer: string | null;
  readonly incidentNumber: string | null;
  readonly reason: string;
  readonly gates: readonly string[];
  readonly grantedAt: string;
  readonly expiresAt: string;
  readonly reviewDueAt: string;
  readonly accessCount: number;
  readonly status: string;
}

/**
 * Requests for fields the engine withheld, and the break-glass grants that must
 * be reviewed after the fact.
 *
 * The approver sees what the policy engine itself concluded alongside the
 * requester's account of why they need it. That is the whole point of storing
 * the evaluation verbatim: an approval queue where the only information is the
 * requester's own case trains people to approve.
 */
export default async function AccessRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string): string | undefined =>
    typeof params[key] === 'string' ? (params[key] as string) : undefined;

  const session = await readSession();
  const mayApprove = can(session, 'ACCESS_REQUEST_APPROVE');
  const mayReviewBreakGlass = can(session, 'BREAK_GLASS_REVIEW');

  const [mine, queue, grants] = await Promise.all([
    callApi<{ total: number; requests: AccessRequest[] }>('/api/v1/access-requests?limit=25'),
    mayApprove
      ? callApi<{ total: number; requests: AccessRequest[] }>(
          '/api/v1/access-requests?forApproval=true&limit=25',
        )
      : null,
    mayReviewBreakGlass ? callApi<BreakGlassGrant[]>('/api/v1/break-glass/review-queue') : null,
  ]);

  return (
    <>
      <PageHeader
        title="Access requests"
        lead="Fields the policy engine withheld, and the emergency access that has to be accounted for afterwards."
      />

      {one('error') === undefined ? null : (
        <Notice tone="danger" title="That was not recorded" live>
          {one('error') === 'note'
            ? 'Say why you decided as you did.'
            : one('error') === 'decided'
              ? 'That request had already been decided.'
              : (one('message') ?? 'Please try again.')}
        </Notice>
      )}

      {one('decided') === undefined ? null : (
        <Notice tone="ok" title={`Recorded as ${sentenceCase(one('decided') as string)}`} live>
          An approval is bounded to the fields named and expires; it is not a standing entitlement.
        </Notice>
      )}

      {one('reviewed') === undefined ? null : (
        <Notice tone="ok" title="Break-glass review recorded" live>
          The grant and your finding are on the audit record.
        </Notice>
      )}

      {queue === null ? null : (
        <section className="card" aria-labelledby="approval-heading">
          <div className="card-header">
            <h2 id="approval-heading">Awaiting your approval</h2>
          </div>
          <Queue
            requests={dataOr(queue, { requests: [] }).requests}
            empty="Nothing is waiting for your decision."
            decidable
          />
        </section>
      )}

      <section className="card" aria-labelledby="mine-heading">
        <div className="card-header">
          <h2 id="mine-heading">Your own requests</h2>
        </div>
        <Queue
          requests={dataOr(mine, { requests: [] }).requests}
          empty="You have not asked for access to anything."
          decidable={false}
        />
      </section>

      {grants === null ? null : (
        <section className="card" id="break-glass" aria-labelledby="break-glass-heading">
          <div className="card-header">
            <h2 id="break-glass-heading">Break-glass reviews due</h2>
          </div>
          <p>
            Emergency access is temporary, minimal and logged, and it creates this obligation the
            moment it is used. An officer cannot review their own.
          </p>
          {dataOr(grants, []).length === 0 ? (
            <Empty>No emergency access is awaiting review.</Empty>
          ) : (
            <div className="stack">
              {dataOr(grants, []).map((grant) => (
                <div className="card" key={grant.reference} style={{ boxShadow: 'none' }}>
                  <div className="card-header">
                    <h3>{grant.reference}</h3>
                    <Badge tone="warn">Review due {formatDateTime(grant.reviewDueAt)}</Badge>
                  </div>
                  <dl className="facts">
                    <dt>Officer</dt>
                    <dd>{grant.officer ?? '—'}</dd>
                    <dt>Reason given</dt>
                    <dd>{grant.reason}</dd>
                    <dt>What it stood in for</dt>
                    <dd>{grant.gates.map(sentenceCase).join(', ')}</dd>
                    <dt>Times relied on</dt>
                    <dd>{grant.accessCount}</dd>
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
                      required
                      maxLength={2000}
                    />
                    <div className="actions">
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

function Queue({
  requests,
  empty,
  decidable,
}: {
  requests: readonly AccessRequest[];
  empty: string;
  decidable: boolean;
}) {
  if (requests.length === 0) return <Empty>{empty}</Empty>;

  return (
    <div className="stack">
      {requests.map((request) => (
        <div className="card" key={request.reference} style={{ boxShadow: 'none' }}>
          <div className="card-header">
            <h3>{request.reference}</h3>
            <Badge
              tone={
                request.status === 'APPROVED'
                  ? 'ok'
                  : request.status === 'DENIED' || request.status === 'AUTO_DENIED'
                    ? 'danger'
                    : 'info'
              }
            >
              {sentenceCase(request.status)}
            </Badge>
          </div>
          <dl className="facts">
            {request.requestedBy === null ? null : (
              <>
                <dt>Asked by</dt>
                <dd>{request.requestedBy}</dd>
              </>
            )}
            <dt>Purpose stated</dt>
            <dd>{purposeLabel(request.purpose)}</dd>
            <dt>About</dt>
            <dd className="mono">{request.subjectPcid ?? '—'}</dd>
            <dt>Fields asked for</dt>
            <dd>{request.requestedFields.map(fieldLabel).join(', ')}</dd>
            <dt>Reason given</dt>
            <dd>{request.justification}</dd>
            <dt>Asked</dt>
            <dd>{formatDateTime(request.createdAt)}</dd>
          </dl>

          {decidable &&
          (request.status === 'SUBMITTED' || request.status === 'PENDING_APPROVAL') ? (
            <form action={decideAccessRequest} noValidate>
              <input type="hidden" name="reference" value={request.reference} />
              <TextArea
                name="note"
                id={`ar-note-${request.reference}`}
                label="Why you decided as you did"
                required
                maxLength={2000}
              />
              <div className="actions">
                <SubmitButton name="decision" value="APPROVED" pendingLabel="Recording…">
                  Approve
                </SubmitButton>
                <SubmitButton
                  className="button button-danger"
                  name="decision"
                  value="DENIED"
                  pendingLabel="Recording…"
                >
                  Deny
                </SubmitButton>
              </div>
            </form>
          ) : null}
        </div>
      ))}
    </div>
  );
}
