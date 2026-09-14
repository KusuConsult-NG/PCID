import { Badge, Empty, Notice, SubmitButton, TableScroll } from '@pcid/portal-kit/components';
import { formatDateTime } from '@pcid/portal-kit/format';
import type { Metadata } from 'next';

import { PageHeader } from '@/components/chrome';
import { callApi, dataOr } from '@/lib/api';
import { can, readSession } from '@/lib/session';
import type { RetentionRunView, RetentionSchedule } from '@/lib/types';

import { runRetentionSweep } from './actions';

export const metadata: Metadata = { title: 'Retention' };

/**
 * Always days, never "3 months" or "1 year".
 *
 * The same periods appear in the privacy notice, in the catalogue and in the
 * ledger, and they are stated in days everywhere. A page that rendered ninety
 * days as "3 months" would leave a Data Protection Officer comparing this screen
 * against a published notice doing arithmetic to check they match.
 */
function period(days: number | null): string {
  if (days === null) return 'Kept';
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

function outcome(disposition: string, redacts: readonly string[]): string {
  if (disposition === 'KEEP') return 'Nothing: this is kept.';
  if (disposition === 'DELETE') return 'The row is deleted.';
  return `The row stays; ${redacts.join(', ')} ${redacts.length === 1 ? 'is' : 'are'} emptied.`;
}

/**
 * The retention schedule, and whether it is actually being applied.
 *
 * Those are two different questions and the page answers both, side by side,
 * because for eleven phases this platform could answer only the first. The
 * periods were in the privacy notice, the columns carried them, and nothing
 * erased anything — so a schedule that read as a control was a claim.
 *
 * Three deliberate choices in the layout:
 *
 *  - **The basis is shown, not hidden behind a link.** A reader deciding whether
 *    ninety days is right needs the reason in front of them, or they will judge
 *    it by whether the number looks large.
 *  - **What is kept is on the same table as what is erased.** A schedule listing
 *    only the things that expire reads as though everything else was forgotten.
 *  - **Counting and erasing are two buttons, and counting comes first.** The
 *    destructive one is never the default and never a checkbox left as somebody
 *    else set it.
 */
export default async function RetentionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string): string | undefined =>
    typeof params[key] === 'string' && params[key] !== '' ? (params[key] as string) : undefined;

  const session = await readSession();
  const mayRun = can(session, 'RETENTION_RUN');

  const [scheduleResult, runsResult] = await Promise.all([
    callApi<RetentionSchedule>('/api/v1/retention/schedule'),
    callApi<{ total: number; runs: RetentionRunView[] }>('/api/v1/retention/runs?limit=10'),
  ]);
  const schedule = dataOr(scheduleResult, null);
  const history = dataOr(runsResult, null);

  const overdue =
    schedule === null
      ? 0
      : schedule.policies.reduce((total, policy) => total + (policy.due ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Retention"
        lead="What the platform keeps, for how long, why — and whether the schedule is being applied."
      />

      {one('error') === undefined ? null : (
        <Notice tone="danger" title="That did not run" live>
          {one('error') === 'stepup'
            ? 'Confirm your identity again before running the sweep. Erasure is the least reversible thing this platform does.'
            : 'The sweep could not be started. Nothing was erased.'}
        </Notice>
      )}

      {one('counted') === undefined ? null : (
        <Notice tone="info" title="Counted, and nothing was erased" live>
          {one('counted')} {one('counted') === '1' ? 'row is' : 'rows are'} past their period.
          {one('more') === '1'
            ? ' That is a full batch, so there are more: each run takes a batch and the next one continues.'
            : ''}
        </Notice>
      )}

      {one('erased') === undefined ? null : (
        <Notice tone="ok" title="The schedule was applied" live>
          {one('erased')} {one('erased') === '1' ? 'row was' : 'rows were'} erased, and what each
          policy took is on the record below.
          {one('more') === '1' ? ' A rule reached its batch, so there is more to do.' : ''}
        </Notice>
      )}

      {schedule === null ? (
        <Notice tone="danger" title="The schedule could not be loaded">
          Please try again shortly.
        </Notice>
      ) : (
        <>
          <section className="card" aria-labelledby="state">
            <div className="card-header">
              <h2 id="state">Is the schedule being kept?</h2>
              {schedule.lastRun === null ? (
                <Badge tone="danger">Never applied</Badge>
              ) : overdue === 0 ? (
                <Badge tone="ok">Up to date</Badge>
              ) : (
                <Badge tone="warn">{overdue} overdue</Badge>
              )}
            </div>

            {schedule.lastRun === null ? (
              <p>
                No sweep has ever run on this deployment. Every period below is a statement about
                what the platform does with personal data, and until a sweep runs it is a statement
                and nothing more.
              </p>
            ) : (
              <dl className="facts">
                <dt>Last run</dt>
                <dd>
                  {formatDateTime(schedule.lastRun.startedAt)}
                  {schedule.lastRun.orderedBy === null
                    ? ' — on the schedule'
                    : ` — ordered by ${schedule.lastRun.orderedBy}`}
                  {schedule.lastRun.dryRun ? ' (a count, nothing erased)' : ''}
                </dd>
                <dt>Outcome</dt>
                <dd>
                  {schedule.lastRun.status === 'COMPLETED'
                    ? `${schedule.lastRun.rowsAffected} rows`
                    : (schedule.lastRun.error ?? 'Failed')}
                </dd>
                <dt>Overdue now</dt>
                <dd>
                  {overdue === 0
                    ? 'Nothing is past its period.'
                    : `${overdue} rows across ${schedule.policies.filter((p) => (p.due ?? 0) > 0).length} policies.`}
                </dd>
              </dl>
            )}

            {mayRun ? (
              <form action={runRetentionSweep} noValidate style={{ marginTop: '1rem' }}>
                <div className="actions">
                  <SubmitButton name="mode" value="dry" pendingLabel="Counting…">
                    Count what is due
                  </SubmitButton>
                  <SubmitButton
                    className="button button-secondary"
                    name="mode"
                    value="erase"
                    pendingLabel="Applying…"
                  >
                    Apply the schedule now
                  </SubmitButton>
                </div>
                <p className="muted small" style={{ marginTop: '0.5rem' }}>
                  Applying the schedule cannot be undone. It erases only what is already past the
                  period below, a batch at a time, and every row it touches is counted on the
                  record. It never reaches a citizen record, a case file, or the audit trail.
                </p>
              </form>
            ) : null}
          </section>

          <section className="card" aria-labelledby="schedule">
            <div className="card-header">
              <h2 id="schedule">The schedule</h2>
            </div>
            <TableScroll label="The retention schedule">
              <table>
                <caption className="visually-hidden">
                  Every category of data the platform holds, its retention period, what happens when
                  the period ends, and how many rows are past it now.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">What is held</th>
                    <th scope="col">Kept for</th>
                    <th scope="col">Then</th>
                    <th scope="col">Overdue</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.policies.map((policy) => (
                    <tr key={policy.key}>
                      <th scope="row">
                        {policy.holds}
                        <br />
                        <span className="muted small">{policy.basis}</span>
                      </th>
                      <td>
                        {period(policy.retainDays)}
                        {policy.measuredFrom === null ? null : (
                          <>
                            <br />
                            <span className="muted small">from {policy.measuredFrom}</span>
                          </>
                        )}
                      </td>
                      <td>{outcome(policy.disposition, policy.redacts)}</td>
                      <td>
                        {policy.disposition === 'KEEP' ? (
                          <span className="muted">—</span>
                        ) : (policy.due ?? 0) === 0 ? (
                          'None'
                        ) : (
                          <strong>
                            {policy.dueIsAtLeast === true ? 'at least ' : ''}
                            {policy.due}
                          </strong>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </section>

          <section className="card" aria-labelledby="runs">
            <div className="card-header">
              <h2 id="runs">What has been erased</h2>
            </div>
            {history === null || history.runs.length === 0 ? (
              <Empty>No sweep has run yet.</Empty>
            ) : (
              <div className="stack">
                {history.runs.map((run) => (
                  <article key={run.reference} className="run">
                    <div className="card-header">
                      <h3>
                        <span className="mono">{run.reference}</span>
                      </h3>
                      <Badge
                        tone={run.status === 'FAILED' ? 'danger' : run.dryRun ? 'muted' : 'ok'}
                      >
                        {run.status === 'FAILED'
                          ? 'Failed'
                          : run.dryRun
                            ? 'Counted only'
                            : `${run.rowsAffected} erased`}
                      </Badge>
                    </div>
                    <p className="muted small">
                      {formatDateTime(run.startedAt)}
                      {run.orderedBy === null
                        ? ' — on the schedule'
                        : ` — ordered by ${run.orderedBy}`}
                      {run.moreRemaining ? ' — a rule reached its batch; more remains' : ''}
                    </p>
                    {run.error === null ? null : <p className="muted small">{run.error}</p>}
                    {run.erasures.filter((one) => one.rowsAffected > 0).length === 0 ? (
                      <p className="muted small">Nothing was past its period.</p>
                    ) : (
                      <ul>
                        {run.erasures
                          .filter((one) => one.rowsAffected > 0)
                          .map((one) => (
                            <li key={one.policy}>
                              {one.rowsAffected} {one.rowsAffected === 1 ? 'row' : 'rows'} —{' '}
                              {one.holds ?? one.policy}
                              {one.capped ? ' (a full batch; more remained)' : ''}
                            </li>
                          ))}
                      </ul>
                    )}
                  </article>
                ))}
              </div>
            )}
            <p className="muted small">
              Counts and cutoffs, never contents. A record of erasures that kept what was erased in
              order to prove the erasure would defeat it.
            </p>
          </section>
        </>
      )}
    </>
  );
}
