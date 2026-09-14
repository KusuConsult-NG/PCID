import { Badge, Empty, Notice } from '@pcid/portal-kit/components';
import { formatDateTime, sentenceCase } from '@pcid/portal-kit/format';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/chrome';
import { callApi, dataOr } from '@/lib/api';
import { can, readSession } from '@/lib/session';
import type { SecuritySession } from '@/lib/session';
import type { BreakGlassGrant, CaseSummary, MissingPerson } from '@/lib/types';
import { actionLabel, caseStatusTone, enquiryStatusTone } from '@/lib/vocabulary';

export const metadata: Metadata = { title: 'Home' };

/**
 * What this officer is working on.
 *
 * The case list is already scoped to the cases this account is assigned to — the
 * service filters by assignment rather than by agency — so this page shows the
 * officer their own work and not the command's.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const session = (await readSession()) as SecuritySession;

  const [cases, enquiries, grants] = await Promise.all([
    can(session, 'CASE_VIEW')
      ? callApi<{ cases: CaseSummary[]; total: number }>('/api/v1/cases?limit=10')
      : null,
    can(session, 'MISSING_PERSON_VIEW')
      ? callApi<{ records: MissingPerson[]; total: number }>(
          '/api/v1/missing-persons?openOnly=true&limit=5',
        )
      : null,
    can(session, 'BREAK_GLASS_REVIEW')
      ? callApi<BreakGlassGrant[]>('/api/v1/break-glass/review-queue')
      : null,
  ]);

  const myCases = dataOr(cases, { cases: [], total: 0 });
  const openEnquiries = dataOr(enquiries, { records: [], total: 0 });
  const dueReviews = dataOr(grants, []);

  return (
    <>
      <PageHeader
        title={`Good day, ${firstName(session.displayName)}`}
        lead={session.agencyName === null ? undefined : `Signed in for ${session.agencyName}.`}
      />

      {params['passphrase-changed'] === '1' ? (
        <Notice tone="ok" title="Your passphrase has been changed" live>
          Every other session for this account has ended.
        </Notice>
      ) : null}

      {dueReviews.length === 0 ? null : (
        <Notice
          tone="warn"
          title={`${dueReviews.length} break-glass review${dueReviews.length === 1 ? '' : 's'} due`}
        >
          <p style={{ marginBottom: 0 }}>
            Emergency access creates a review obligation the moment it is used, due within 24 hours.{' '}
            <Link href="/authorisation#break-glass">Open the queue</Link>.
          </p>
        </Notice>
      )}

      {cases === null ? null : (
        <section className="card" style={{ marginTop: '1.25rem' }} aria-labelledby="cases-heading">
          <div className="card-header">
            <h2 id="cases-heading">Your cases</h2>
            <Badge tone="muted">{myCases.total} assigned</Badge>
          </div>
          <p className="muted small">
            Cases you are assigned to. Being in the agency is not the same as being on the case, and
            the platform turns on the assignment.
          </p>
          {myCases.cases.length === 0 ? (
            <Empty>You are not assigned to any case.</Empty>
          ) : (
            <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {myCases.cases.map((file) => (
                <li key={file.caseNumber}>
                  <Link href={`/cases/${encodeURIComponent(file.caseNumber)}`}>
                    <span className="mono">{file.caseNumber}</span> — {file.title}
                  </Link>{' '}
                  <Badge tone={caseStatusTone(file.status)}>{sentenceCase(file.status)}</Badge>
                  <br />
                  <span className="muted small">
                    {sentenceCase(file.type)} · opened {formatDateTime(file.openedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {can(session, 'CASE_CREATE') ? (
            <p style={{ marginTop: '1rem', marginBottom: 0 }}>
              <Link className="button button-secondary" href="/cases#open">
                Open a case
              </Link>
            </p>
          ) : null}
        </section>
      )}

      {enquiries === null ? null : (
        <section className="card" aria-labelledby="enquiries-heading">
          <div className="card-header">
            <h2 id="enquiries-heading">Open missing-person enquiries</h2>
            <Badge tone="muted">{openEnquiries.total} open</Badge>
          </div>
          {openEnquiries.records.length === 0 ? (
            <Empty>No open enquiries.</Empty>
          ) : (
            <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {openEnquiries.records.map((enquiry) => (
                <li key={enquiry.caseReference}>
                  <Link href={`/missing-persons/${encodeURIComponent(enquiry.caseReference)}`}>
                    <span className="mono">{enquiry.caseReference}</span> —{' '}
                    {enquiry.fullName ?? 'Name withheld'}
                  </Link>{' '}
                  <Badge tone={enquiryStatusTone(enquiry.status)}>
                    {sentenceCase(enquiry.status)}
                  </Badge>
                  <br />
                  <span className="muted small">
                    Reported {formatDateTime(enquiry.createdAt)}
                    {enquiry.lastSeen?.lgaCode == null
                      ? ''
                      : ` · last seen ${enquiry.lastSeen.lgaCode}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="card" aria-labelledby="entitlements">
        <div className="card-header">
          <h2 id="entitlements">What this account can do</h2>
          <Badge tone="info">{session.roles.join(', ') || 'No roles'}</Badge>
        </div>
        <p>
          This is the list the policy engine itself reads. Most of it still depends on a case: the
          actions below say what you may do, not which records you may do it to.
        </p>
        <ul className="entitlements">
          {[...session.actions].sort().map((action) => (
            <li key={action}>
              <Badge tone="muted">{actionLabel(action)}</Badge>
            </li>
          ))}
        </ul>
      </section>

      <Notice title="How a record opens here">
        <ol style={{ marginBottom: 0, paddingLeft: '1.25rem' }}>
          <li>You are assigned to a case, and the case is active.</li>
          <li>You link the person to it, in writing, saying why they are relevant.</li>
          <li>
            Only then does their record open — and only the fields a criminal-investigation purpose
            justifies.
          </li>
        </ol>
      </Notice>
    </>
  );
}

function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] ?? displayName;
}
