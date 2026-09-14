import {
  Badge,
  Empty,
  Field,
  Notice,
  Select,
  SubmitButton,
  TextArea,
} from '@pcid/portal-kit/components';
import { fieldLabel, formatDateTime, sentenceCase } from '@pcid/portal-kit/format';
import type { Metadata } from 'next';

import { PageHeader } from '@/components/chrome';
import { callApi, dataOr } from '@/lib/api';
import { can, readSession } from '@/lib/session';
import type { AccessRequest, BreakGlassGrant } from '@/lib/types';
import {
  BREAK_GLASS_GATES,
  INVESTIGATION_PURPOSES,
  REQUESTABLE_FIELDS,
  accessRequestTone,
  purposeLabel,
} from '@/lib/vocabulary';

import {
  decideAccessRequest,
  initiateBreakGlass,
  raiseAccessRequest,
  reviewBreakGlass,
} from './actions';

export const metadata: Metadata = { title: 'Access and break glass' };

/**
 * The two ways past a refusal, and the accounting each of them creates.
 *
 * They are on one page because they are the same decision taken at different
 * speeds. An access request asks somebody; break-glass tells them afterwards.
 * An officer who cannot see both together will reach for the second when the
 * first would have done, and this page exists partly to make the ordinary route
 * the nearest one to hand.
 *
 * The approver sees the policy engine's own verbatim conclusion alongside the
 * requester's account of why they need it. That is why the evaluation is stored
 * on the request: an approval queue whose only information is the requester's
 * own case trains people to approve.
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
  const mayRequest = can(session, 'ACCESS_REQUEST_CREATE');
  const mayApprove = can(session, 'ACCESS_REQUEST_APPROVE');
  const mayBreakGlass = can(session, 'BREAK_GLASS_INITIATE');
  const mayReview = can(session, 'BREAK_GLASS_REVIEW');
  const workingCase = session?.workingCase ?? null;

  const [mine, queue, grants] = await Promise.all([
    callApi<{ total: number; requests: AccessRequest[] }>('/api/v1/access-requests?limit=25'),
    mayApprove
      ? callApi<{ total: number; requests: AccessRequest[] }>(
          '/api/v1/access-requests?forApproval=true&limit=25',
        )
      : null,
    mayReview ? callApi<BreakGlassGrant[]>('/api/v1/break-glass/review-queue') : null,
  ]);

  return (
    <>
      <PageHeader
        title="Access and break glass"
        lead="Asking for what the engine withheld, and accounting for the times you could not wait to ask."
      />

      {one('error') === undefined ? null : (
        <Notice tone="danger" title="That was not recorded" live>
          {one('error') === 'fields'
            ? 'Name at least one field you need.'
            : one('error') === 'justification'
              ? 'Say why you need it, in a sentence an approver can weigh.'
              : one('error') === 'gates'
                ? 'Say which check you are asking to bypass.'
                : one('error') === 'reason'
                  ? 'Break-glass needs a full account of the emergency, not a few words.'
                  : one('error') === 'note'
                    ? 'Say why you decided as you did.'
                    : one('error') === 'decided'
                      ? 'That request had already been decided.'
                      : (one('message') ?? 'Please try again.')}
        </Notice>
      )}

      {one('raised') === undefined ? null : (
        <Notice
          tone={one('outcome') === 'NOT_REQUIRED' ? 'ok' : 'info'}
          title={
            one('outcome') === 'NOT_REQUIRED'
              ? 'You already have those fields'
              : `Request ${one('raised')} is with an approver`
          }
          live
        >
          {one('outcome') === 'NOT_REQUIRED'
            ? 'Nothing was queued. Open the record and you will find them released.'
            : 'The approver sees what the policy engine concluded alongside your reason. You will be notified when it is decided.'}
        </Notice>
      )}

      {one('decided') === undefined ? null : (
        <Notice tone="ok" title={`Recorded as ${sentenceCase(one('decided') as string)}`} live>
          An approval is bounded to the fields named and expires; it is not a standing entitlement.
        </Notice>
      )}

      {one('granted') === undefined ? null : (
        <Notice tone="warn" title={`Emergency access granted: ${one('granted')}`} live>
          <p>
            It expires{' '}
            {one('expires') === undefined
              ? 'within the hour'
              : formatDateTime(one('expires') as string)}
            . Your supervisors have already been notified, and a review of this grant is now due
            within 24 hours.
          </p>
          <p style={{ marginBottom: 0 }}>
            Every record you open under it is counted and attributed to you.
          </p>
        </Notice>
      )}

      {one('reviewed') === undefined ? null : (
        <Notice tone="ok" title="Break-glass review recorded" live>
          The grant and your finding are on the audit record.
        </Notice>
      )}

      {!mayRequest ? null : (
        <section className="card" id="raise" aria-labelledby="raise-heading">
          <div className="card-header">
            <h2 id="raise-heading">Ask for a field that was withheld</h2>
          </div>
          <p>
            An investigation purpose does not release everything, and a case does not widen your
            agency&rsquo;s clearance ceiling or its compartment. Where your enquiry genuinely needs
            a field the engine held back, ask for it here.
          </p>
          <p className="small muted">
            The check runs before anything is queued. If the fields are already open to you, nothing
            is sent to an approver and you are told to go and read the record.
          </p>

          <form action={raiseAccessRequest} noValidate>
            <Select
              name="purpose"
              id="raise-purpose"
              label="Why you need it"
              options={[...INVESTIGATION_PURPOSES]}
              required
            />
            <Field
              name="subjectPcid"
              id="raise-subject"
              label="Whose record"
              hint="The PCID, as it appears on the record."
              required
            />
            <Field
              name="caseRef"
              id="raise-case"
              label="Case reference"
              hint="The case the enquiry belongs to."
              defaultValue={workingCase?.reference ?? ''}
            />

            <fieldset className="choices">
              <legend>What you need</legend>
              {REQUESTABLE_FIELDS.map((field) => (
                <label className="choice" key={field.value} htmlFor={`field-${field.value}`}>
                  <input
                    type="checkbox"
                    id={`field-${field.value}`}
                    name="field"
                    value={field.value}
                  />
                  <span>
                    {field.label}
                    <span className="hint">{field.value}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <Field
              name="otherFields"
              id="raise-other"
              label="Anything else"
              hint="Field names from the catalogue, separated by commas — for example citizen.bloodGroup."
            />
            <TextArea
              name="justification"
              id="raise-justification"
              label="Why the enquiry needs it"
              hint="What you are trying to establish, and why this field settles it. An approver has only what you write here."
              required
              maxLength={2000}
            />
            <div className="actions">
              <SubmitButton pendingLabel="Sending…">Request access</SubmitButton>
            </div>
          </form>
        </section>
      )}

      {queue === null ? null : (
        <section className="card" id="queue" aria-labelledby="queue-heading">
          <div className="card-header">
            <h2 id="queue-heading">Awaiting your approval</h2>
          </div>
          <p className="small muted">
            Approving needs the second factor again, and you cannot decide your own request — the
            API and a database constraint both refuse it.
          </p>
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

      {mayBreakGlass ? null : (
        <section className="card" id="break-glass" aria-labelledby="break-glass-heading">
          <div className="card-header">
            <h2 id="break-glass-heading">Break glass</h2>
            <Badge tone="muted">Not held by this account</Badge>
          </div>
          <p>
            Emergency access — reaching a record when somebody is in danger now and the ordinary
            route is too slow — is held by emergency-response roles, not by the investigative ones
            this account holds. There is no button here because there is no entitlement behind it.
          </p>
          <p style={{ marginBottom: 0 }}>
            This is said plainly rather than left blank on purpose. An officer who finds nothing and
            concludes the platform cannot do it will go and do something worse. If you need a record
            you cannot reach and cannot wait, telephone your supervisor or the emergency control
            room — an officer who holds it can break the glass and answer for it afterwards.
          </p>
        </section>
      )}

      {!mayBreakGlass ? null : (
        <section className="card" id="break-glass" aria-labelledby="break-glass-heading">
          <div className="card-header">
            <h2 id="break-glass-heading">Break the glass</h2>
            <Badge tone="danger">Accounted for afterwards</Badge>
          </div>
          <p>
            For the case where somebody is in danger now and the ordinary route is too slow. It is
            temporary, it is minimal, it notifies your supervisors the moment you use it, and it
            creates a review obligation due within 24 hours.
          </p>
          <p>
            It can stand in for a jurisdiction boundary, a case or incident assignment, or a field
            approval. It cannot give you a role you do not hold, it cannot lift your clearance
            ceiling, and it cannot put your agency inside the law-enforcement compartment. Those are
            not oversights: a check that emergency can lift is not a check.
          </p>

          <form action={initiateBreakGlass} noValidate>
            <Field
              name="subjectPcid"
              id="bg-subject"
              label="Whose record"
              hint="The PCID you need to reach."
              required
            />
            <Field
              name="caseRef"
              id="bg-case"
              label="Case reference"
              defaultValue={workingCase?.reference ?? ''}
            />
            <Field name="incidentRef" id="bg-incident" label="Incident number" />

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
              label="The emergency"
              hint="What is happening, what you need the record for, and why there is no time to ask. A reviewer reads this, and so does the person whose record it is, afterwards."
              required
              maxLength={2000}
            />
            <div className="actions">
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
            <h2 id="reviews-heading">Break-glass reviews due</h2>
          </div>
          <p>
            Emergency access creates this obligation the moment it is used. An officer cannot review
            their own, and an unreviewed grant does not quietly age out — it stays here.
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
                    <dt>Used</dt>
                    <dd>
                      {grant.accessCount === 0
                        ? 'Never relied on'
                        : `${grant.accessCount} ${grant.accessCount === 1 ? 'record' : 'records'} opened under it`}
                    </dd>
                    <dt>Granted</dt>
                    <dd>{formatDateTime(grant.grantedAt)}</dd>
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
                      hint="Was the emergency real, and was what the officer opened no more than it needed?"
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
            <Badge tone={accessRequestTone(request.status)}>{sentenceCase(request.status)}</Badge>
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
            {request.caseNumber === null ? null : (
              <>
                <dt>Case</dt>
                <dd className="mono">{request.caseNumber}</dd>
              </>
            )}
            <dt>Fields asked for</dt>
            <dd>{request.requestedFields.map(fieldLabel).join(', ')}</dd>
            {request.approvedFields === null || request.approvedFields.length === 0 ? null : (
              <>
                <dt>Fields approved</dt>
                <dd>{request.approvedFields.map(fieldLabel).join(', ')}</dd>
              </>
            )}
            <dt>Reason given</dt>
            <dd>{request.justification}</dd>
            <dt>Asked</dt>
            <dd>{formatDateTime(request.createdAt)}</dd>
            {request.expiresAt === null ? null : (
              <>
                <dt>Approval expires</dt>
                <dd>{formatDateTime(request.expiresAt)}</dd>
              </>
            )}
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
