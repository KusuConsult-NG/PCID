import { Empty, Field, Notice, Select, SubmitButton } from '@pcid/portal-kit/components';
import { formatDate } from '@pcid/portal-kit/format';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/chrome';
import { callApi } from '@/lib/api';
import { can, readSession } from '@/lib/session';
import type { SearchResult } from '@/lib/types';
import { SERVICE_PURPOSES, purposeLabel } from '@/lib/vocabulary';

export const metadata: Metadata = { title: 'Find a person' };

/**
 * Search, under a stated purpose.
 *
 * The purpose is a required field of the form, not a setting somewhere: the
 * platform refuses a search without one, and the officer should see that the
 * reason is part of the act rather than a preference they set once and forgot.
 *
 * What comes back is deliberately thin — enough to confirm you have the right
 * person, and nothing more. Opening the record is the next, separate act.
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

  const purpose = one('purpose');
  const criteria = {
    pcid: one('pcid'),
    name: one('name'),
    phone: one('phone'),
    dateOfBirth: one('dateOfBirth'),
  };
  const searched =
    purpose !== undefined && Object.values(criteria).some((value) => value !== undefined);

  const query = new URLSearchParams();
  if (searched) {
    query.set('purpose', purpose);
    for (const [key, value] of Object.entries(criteria)) {
      if (value !== undefined) query.set(key, value);
    }
  }

  const result = searched
    ? await callApi<SearchResult>(`/api/v1/citizens?${query.toString()}`)
    : null;

  return (
    <>
      <PageHeader
        title="Find a person"
        lead="Search the register under a stated purpose. Results are deliberately thin — enough to confirm you have the right person."
      />

      {!permitted ? (
        <Notice tone="warn" title="Your account cannot search the register">
          Ask your agency administrator for the role your work needs.
        </Notice>
      ) : null}

      <section className="card" aria-labelledby="search-heading">
        <div className="card-header">
          <h2 id="search-heading">Search</h2>
        </div>
        <form method="get" noValidate>
          <Select
            name="purpose"
            label="Why are you looking this person up"
            hint="Recorded against your name, shown to the person whose record it is, and used to decide which fields are released to you."
            options={[...SERVICE_PURPOSES]}
            defaultValue={purpose ?? 'SERVICE_DELIVERY'}
            required
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
            result.error.code === 'RATE_LIMITED'
              ? 'Too many searches'
              : result.error.code === 'VALIDATION_FAILED'
                ? 'Too many people match'
                : 'That search could not be run'
          }
          live
        >
          {result.error.message}
        </Notice>
      ) : (
        <section className="card" aria-labelledby="results-heading">
          <div className="card-header">
            <h2 id="results-heading">
              {result.data.total} {result.data.total === 1 ? 'match' : 'matches'}
            </h2>
          </div>
          <p className="muted small">
            Searched for {purposeLabel(purpose ?? null)}. This search is recorded.
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
                    <th scope="col">Local Government Area</th>
                    <th scope="col">
                      <span className="visually-hidden">Open</span>
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
                          <Link
                            className="button button-secondary"
                            href={`/person/${encodeURIComponent(pcid)}?purpose=${encodeURIComponent(purpose ?? '')}`}
                          >
                            Open record
                          </Link>
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

      <Notice title="Searching is itself recorded">
        <p style={{ marginBottom: 0 }}>
          An unusual volume of searching raises a security alert for review. That is not aimed at
          you — it is what makes it possible to say that nobody is browsing the register, which is
          what residents are entitled to be told.
        </p>
      </Notice>
    </>
  );
}
