import { Badge, Notice } from '@pcid/portal-kit/components';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/chrome';
import { callApi, dataOr } from '@/lib/api';
import { can, readSession } from '@/lib/session';
import type { GovernmentSession } from '@/lib/session';
import { actionLabel } from '@/lib/vocabulary';

export const metadata: Metadata = { title: 'Home' };

/**
 * What is waiting for this account, and what it may do.
 *
 * The queues are counted by asking for one row of each, so a desk that holds no
 * review responsibility is not shown an empty box implying it has one.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const session = (await readSession()) as GovernmentSession;

  const [duplicates, corrections, alerts, approvals, breakGlass] = await Promise.all([
    can(session, 'DUPLICATE_REVIEW')
      ? callApi<{ total: number }>('/api/v1/citizens/duplicates?limit=1')
      : null,
    can(session, 'CORRECTION_REQUEST_REVIEW')
      ? callApi<{ total: number }>('/api/v1/correction-requests?status=SUBMITTED&limit=1')
      : null,
    can(session, 'ALERT_VIEW')
      ? callApi<{ total: number }>('/api/v1/alerts?status=OPEN&limit=1')
      : null,
    can(session, 'ACCESS_REQUEST_APPROVE')
      ? callApi<{ total: number }>(
          '/api/v1/access-requests?forApproval=true&status=PENDING_APPROVAL&limit=1',
        )
      : null,
    can(session, 'BREAK_GLASS_REVIEW')
      ? callApi<unknown[]>('/api/v1/break-glass/review-queue')
      : null,
  ]);

  const queues = [
    {
      href: '/duplicates',
      label: 'Duplicate candidates',
      lead: 'Two records that may be the same person. Nothing is merged until you decide.',
      count: duplicates === null ? null : (dataOr(duplicates, { total: 0 }).total ?? 0),
    },
    {
      href: '/corrections',
      label: 'Correction requests',
      lead: 'Somebody has asked for a detail on their record to be put right.',
      count: corrections === null ? null : (dataOr(corrections, { total: 0 }).total ?? 0),
    },
    {
      href: '/alerts',
      label: 'Open alerts',
      lead: 'Detection events awaiting a decision, most serious first.',
      count: alerts === null ? null : (dataOr(alerts, { total: 0 }).total ?? 0),
    },
    {
      href: '/access-requests',
      label: 'Access awaiting your approval',
      lead: 'Requests from officers in your agency for fields that need an approval.',
      count: approvals === null ? null : (dataOr(approvals, { total: 0 }).total ?? 0),
    },
    {
      href: '/access-requests#break-glass',
      label: 'Break-glass reviews due',
      lead: 'Emergency access that must be reviewed within 24 hours of being used.',
      count: breakGlass === null ? null : dataOr(breakGlass, []).length,
    },
  ].filter((queue) => queue.count !== null);

  return (
    <>
      <PageHeader
        title={`Good day, ${firstName(session.displayName)}`}
        lead={
          session.agencyName === null
            ? undefined
            : `Signed in for ${session.agencyName}${session.agencyCode === null ? '' : ` (${session.agencyCode})`}.`
        }
      />

      {params['passphrase-changed'] === '1' ? (
        <Notice tone="ok" title="Your passphrase has been changed" live>
          Every other session for this account has ended.
        </Notice>
      ) : null}

      {queues.length > 0 ? (
        <section aria-labelledby="queues-heading" style={{ marginTop: '1.25rem' }}>
          <h2 id="queues-heading">Waiting for you</h2>
          <div className="queue-grid">
            {queues.map((queue) => (
              <div className="card" key={queue.href}>
                <p className="queue-count">{queue.count}</p>
                <h3>{queue.label}</h3>
                <p className="muted small">{queue.lead}</p>
                <Link className="button button-secondary" href={queue.href}>
                  Open
                </Link>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="card" style={{ marginTop: '1.25rem' }} aria-labelledby="entitlements">
        <div className="card-header">
          <h2 id="entitlements">What this account can do</h2>
          <Badge tone="info">{session.roles.join(', ') || 'No roles'}</Badge>
        </div>
        <p>
          This is the list the policy engine itself reads. If something you need is not here, your
          agency administrator adds the role — the platform will not make an exception for a
          particular record.
        </p>
        <ul className="entitlements">
          {[...session.actions].sort().map((action) => (
            <li key={action}>
              <Badge tone="muted">{actionLabel(action)}</Badge>
            </li>
          ))}
        </ul>
      </section>

      <Notice title="Before you open a record">
        <p style={{ marginBottom: 0 }}>
          You will be asked why. The reason you give is recorded, it decides which fields are
          released to you, and the person whose record it is can see it. &ldquo;Checking
          something&rdquo; is not a reason.
        </p>
      </Notice>
    </>
  );
}

function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] ?? displayName;
}
