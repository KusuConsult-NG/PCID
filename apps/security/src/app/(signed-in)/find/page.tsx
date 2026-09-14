import { Empty, Field, Notice, Select, SubmitButton } from '@pcid/portal-kit/components';
import { formatDate } from '@pcid/portal-kit/format';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/chrome';
import { callApi } from '@/lib/api';
import { can, readSession } from '@/lib/session';
import type { SearchResult } from '@/lib/types';
import { INVESTIGATION_PURPOSES, purposeLabel } from '@/lib/vocabulary';

export const metadata: Metadata = { title: 'Find a person' };

/**
 * Search, under a purpose and a case.
 *
 * A search here is not a way into a record. It returns a deliberately thin
 * projection — enough to confirm which Plateau Citizen ID belongs to the person
 * you mean — and the only thing you can do with a result is link them to a case,
 * which is a separate, justified, audited act.
 *
 * That sequence is the whole point. It removes the pattern where an officer
 * learns what they want from a results list and never formally opens anything.
 */
export default async function FindPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string): string | undefined =>
    typeof params[key] === 'string' && params[key] !== '' ? (params[key] as string) : undefined;

  const session = await readSession();
  const permitted = can(session, 'CITIZEN_SEARCH');

  const purpose = one('purpose') ?? 'CRIMINAL_INVESTIGATION';
  const caseRef = one('caseRef') ?? session?.workingCase?.reference;
  const criteria = {
    pcid: one('pcid'),
    name: one('name'),
    phone: one('phone'),
    dateOfBirth: one('dateOfBirth'),
  };
  const searched = Object.values(criteria).some((value) => value !== undefined);

  const query = new URLSearchParams({ purpose });
  if (caseRef !== undefined) query.set('caseRef', caseRef);
  for (const [key, value] of Object.entries(criteria)) {
    if (value !== undefined) query.set(key, value);
  }

  const result = searched
    ? await callApi<SearchResult>(`/api/v1/citizens?${query.toString()}`)
    : null;

  return (
    <>
      <PageHeader
        title="Find a person"
        lead="Enough to confirm which identifier belongs to the person you mean. Opening their record is a separate act, and needs a case."
      />

      {!permitted ? (
        <Notice tone="warn" title="Your account cannot search the register">
          Ask your agency administrator for the role your work needs.
        </Notice>
      ) : null}

      {session?.workingCase == null ? (
        <Notice tone="warn" title="You are not working under a case">
          <p style={{ marginBottom: 0 }}>
            A search for an investigative purpose is refused without one.{' '}
            <Link href="/cases">Choose a case</Link> you are assigned to, or give its number below.
          </p>
        </Notice>
      ) : null}

      <section className="card" aria-labelledby="search-heading">
        <div className="card-header">
          <h2 id="search-heading">Search</h2>
        </div>
        <form method="get" noValidate>
          <Select
            name="purpose"
            label="Why you are looking"
            options={[...INVESTIGATION_PURPOSES]}
            defaultValue={purpose}
            required
          />
          <Field
            name="caseRef"
            label="Under which case"
            hint="The case number you are assigned to. Recorded with the search."
            defaultValue={caseRef ?? ''}
            maxLength={64}
          />
          <Field
            name="pcid"
            label="Plateau Citizen ID"
            defaultValue={criteria.pcid ?? ''}
            maxLength={20}
          />
          <Field name="name" label="Name" defaultValue={criteria.name ?? ''} maxLength={120} />
          <Field
            name="phone"
            label="Phone number"
            type="tel"
            inputMode="tel"
            defaultValue={criteria.phone ?? ''}
            maxLength={24}
          />
          <Field
            name="dateOfBirth"
            label="Date of birth"
            hint="Year-month-day, for example 1994-06-12."
            defaultValue={criteria.dateOfBirth ?? ''}
            maxLength={10}
          />
          <div className="actions">
            <SubmitButton pendingLabel="Searching…">Search</SubmitButton>
          </div>
        </form>
      </section>

      {result === null ? null : !result.ok ? (
        <Notice
          tone="danger"
          title={
            result.error.code === 'CASE_REFERENCE_REQUIRED'
              ? 'This search needs a case'
              : result.error.code === 'RATE_LIMITED'
                ? 'Too many searches'
                : result.error.code === 'VALIDATION_FAILED'
                  ? 'Too many people match'
                  : 'That search could not be run'
          }
          live
        >
          <p style={{ marginBottom: 0 }}>{result.error.message}</p>
        </Notice>
      ) : (
        <section className="card" aria-labelledby="results-heading">
          <div className="card-header">
            <h2 id="results-heading">
              {result.data.total} {result.data.total === 1 ? 'match' : 'matches'}
            </h2>
          </div>
          <p className="muted small">
            Searched for {purposeLabel(purpose)}
            {caseRef === undefined ? '' : ` under ${caseRef}`}. This search is recorded, and an
            unusual volume of searching raises a security alert for review.
          </p>

          {result.data.results.length === 0 ? (
            <Empty>Nobody on the register matches that.</Empty>
          ) : (
            <div className="table-scroll">
              <table>
                <caption className="visually-hidden">People matching your search</caption>
                <thead>
                  <tr>
                    <th scope="col">Plateau Citizen ID</th>
                    <th scope="col">Name</th>
                    <th scope="col">Born</th>
                    <th scope="col">Area</th>
                    <th scope="col">
                      <span className="visually-hidden">Next</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.results.map((match) => {
                    const pcid = String(match.data.pcid ?? '');
                    return (
                      <tr key={pcid}>
                        <td className="mono">{pcid}</td>
                        <td>{String(match.data.displayName ?? '—')}</td>
                        <td>
                          {match.data.dateOfBirth === undefined
                            ? `about ${String(match.data.approximateAge ?? '—')}`
                            : formatDate(String(match.data.dateOfBirth))}
                        </td>
                        <td>{String(match.data.lgaCode ?? '—')}</td>
                        <td>
                          {caseRef === undefined ? (
                            <span className="muted small">Choose a case first</span>
                          ) : (
                            <Link
                              className="button button-secondary"
                              href={`/cases/${encodeURIComponent(caseRef)}#subjects`}
                            >
                              Link to {caseRef}
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <Notice title="Why you cannot open a record from here">
        <p style={{ marginBottom: 0 }}>
          A search tells you which identifier you want. Opening the record is a separate act that
          requires the person to be linked to an active case you are on, with a written reason. That
          is what makes &ldquo;who looked at this person, and under what authority&rdquo; answerable
          afterwards.
        </p>
      </Notice>
    </>
  );
}
