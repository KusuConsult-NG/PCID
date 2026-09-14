import { Badge, Empty, Field, Notice, SubmitButton } from '@pcid/portal-kit/components';
import { formatDateTime, sentenceCase } from '@pcid/portal-kit/format';
import type { Metadata } from 'next';

import { PageHeader } from '@/components/chrome';
import { callApi, dataOr } from '@/lib/api';
import { can, readSession } from '@/lib/session';
import type { AuditSearch, ChainVerification } from '@/lib/types';
import { actionLabel, outcomeLabel, purposeLabel } from '@/lib/vocabulary';

export const metadata: Metadata = { title: 'Audit trail' };

/**
 * The audit trail, and the proof that it has not been rewritten.
 *
 * Denials are as visible as permits — an attempt that was refused is exactly
 * what an oversight review needs to see, and a trail that records only successes
 * records the wrong half.
 *
 * The chain verification is on the same page rather than hidden in an
 * administrator's corner: the answer to "how do we know this log is honest" is
 * a button, and the right person to be able to press it is the one reading the
 * log.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string): string | undefined =>
    typeof params[key] === 'string' && params[key] !== '' ? (params[key] as string) : undefined;

  const session = await readSession();
  const mayVerify = can(session, 'AUDIT_VERIFY');

  const filters = new URLSearchParams({ limit: '50' });
  for (const key of ['subjectPcid', 'action', 'outcome', 'from', 'to'] as const) {
    const value = one(key);
    if (value !== undefined) filters.set(key, value);
  }

  const [events, chain] = await Promise.all([
    callApi<AuditSearch>(`/api/v1/audit/events?${filters.toString()}`),
    mayVerify && one('verify') === '1' ? callApi<ChainVerification>('/api/v1/audit/verify') : null,
  ]);

  const found = dataOr(events, null);

  return (
    <>
      <PageHeader
        title="Audit trail"
        lead="Every access to the register, permitted and refused, with the reason that was given and the fields that were released."
      />

      {chain === null ? null : !chain.ok ? (
        <Notice tone="danger" title="The chain could not be verified" live>
          {chain.error.message}
        </Notice>
      ) : chain.data.intact ? (
        <Notice tone="ok" title="The audit chain is intact" live>
          Every record still hashes to its predecessor, checked{' '}
          {formatDateTime(chain.data.checkedAt)}. Nothing has been altered or removed.
        </Notice>
      ) : (
        <Notice tone="danger" title="The audit chain is broken" live>
          <p>
            {chain.data.problems.length}{' '}
            {chain.data.problems.length === 1 ? 'record does' : 'records do'} not hash to their
            predecessor. This is a security incident: follow the incident response procedure and do
            not attempt to repair the table.
          </p>
          <pre className="mono small" style={{ overflowX: 'auto', marginBottom: 0 }}>
            {JSON.stringify(chain.data.problems, null, 2)}
          </pre>
        </Notice>
      )}

      <section className="card" aria-labelledby="filter-heading">
        <div className="card-header">
          <h2 id="filter-heading">Search the trail</h2>
        </div>
        <form method="get" noValidate>
          <Field
            name="subjectPcid"
            label="About one person"
            hint="A Plateau Citizen ID."
            defaultValue={one('subjectPcid') ?? ''}
            maxLength={20}
          />
          <Field
            name="action"
            label="Action"
            hint="For example CITIZEN_VIEW, or leave blank for everything."
            defaultValue={one('action') ?? ''}
            maxLength={64}
          />
          <Field
            name="outcome"
            label="Outcome"
            hint="PERMITTED or DENIED."
            defaultValue={one('outcome') ?? ''}
            maxLength={16}
          />
          <div className="actions">
            <SubmitButton pendingLabel="Searching…">Search</SubmitButton>
          </div>
        </form>
      </section>

      {mayVerify ? (
        <section className="card" aria-labelledby="verify-heading">
          <div className="card-header">
            <h2 id="verify-heading">Is this log honest?</h2>
          </div>
          <p>
            Each record carries a hash of the one before it, computed by the database rather than by
            the application. Re-checking the chain proves no record has been altered or removed.
          </p>
          <form method="get">
            <input type="hidden" name="verify" value="1" />
            <SubmitButton className="button button-secondary" pendingLabel="Checking…">
              Verify the chain
            </SubmitButton>
          </form>
        </section>
      ) : null}

      {found === null ? (
        <Notice tone="danger" title="The trail could not be searched">
          Please try again shortly.
        </Notice>
      ) : (
        <section className="card" aria-labelledby="events-heading">
          <div className="card-header">
            <h2 id="events-heading">
              {found.total} {found.total === 1 ? 'record' : 'records'}
            </h2>
          </div>
          {found.events.length === 0 ? (
            <Empty>Nothing matches that.</Empty>
          ) : (
            <div className="table-scroll">
              <table>
                <caption className="visually-hidden">
                  Audit records matching your search, most recent first
                </caption>
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Who</th>
                    <th scope="col">Did what</th>
                    <th scope="col">Why</th>
                    <th scope="col">About</th>
                    <th scope="col">Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {found.events.map((event) => (
                    <tr key={event.id}>
                      <td>{formatDateTime(event.occurredAt)}</td>
                      <td>
                        {event.actor.displayName ?? sentenceCase(event.actor.type)}
                        {event.actor.agencyCode === null ? null : (
                          <>
                            <br />
                            <span className="muted small">{event.actor.agencyCode}</span>
                          </>
                        )}
                      </td>
                      <td>
                        {actionLabel(event.action)}
                        {event.breakGlassUsed ? (
                          <>
                            {' '}
                            <Badge tone="danger">Break glass</Badge>
                          </>
                        ) : null}
                        {event.fieldsReleased.length === 0 ? null : (
                          <>
                            <br />
                            <span className="muted small">
                              {event.fieldsReleased.length} fields released
                            </span>
                          </>
                        )}
                      </td>
                      <td>{purposeLabel(event.purpose)}</td>
                      <td className="mono small">{event.subjectPcid ?? '—'}</td>
                      <td>
                        <Badge tone={event.outcome === 'PERMITTED' ? 'ok' : 'danger'}>
                          {outcomeLabel(event.outcome)}
                        </Badge>
                        {event.decisionReasons.length === 0 ? null : (
                          <>
                            <br />
                            <span className="muted small">
                              {event.decisionReasons[0]?.gate}: {event.decisionReasons[0]?.code}
                            </span>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}
