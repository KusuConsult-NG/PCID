import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/chrome';
import { Empty, Notice, TableScroll } from '@pcid/portal-kit/components';
import { callApi, dataOr } from '@/lib/api';
import { formatDateTime } from '@pcid/portal-kit/format';
import { actionLabel, purposeLabel } from '@/lib/vocabulary';
import type { AccessHistory } from '@/lib/types';

export const metadata: Metadata = { title: 'Who has seen my record' };

const PAGE_SIZE = 25;

export default async function AccessHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(typeof params.page === 'string' ? params.page : '1') || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const result = await callApi<AccessHistory>(
    `/api/v1/me/access-history?limit=${PAGE_SIZE}&offset=${offset}`,
  );
  const history = dataOr(result, null);
  const pageCount = history === null ? 1 : Math.max(1, Math.ceil(history.total / PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="Who has seen my record"
        lead="Every time a government officer opens your record, it is written down and cannot be erased."
      />

      {history === null ? (
        <Notice tone="danger" title="This could not be loaded">
          Please try again shortly.
        </Notice>
      ) : (
        <>
          <Notice title="About this list">
            <p>{history.note}</p>
            <p style={{ marginBottom: 0 }}>
              If you do not recognise an access,{' '}
              <Link href="/report#unauthorised-access">report it</Link> and quote the reference
              beside it.
            </p>
          </Notice>

          <section
            className="card"
            style={{ marginTop: '1.25rem' }}
            aria-labelledby="history-heading"
          >
            <div className="card-header">
              <h2 id="history-heading">
                {history.total} {history.total === 1 ? 'access' : 'accesses'}
              </h2>
            </div>

            {history.accesses.length === 0 ? (
              <Empty>Nobody has opened your record yet.</Empty>
            ) : (
              <TableScroll label="Government offices that have opened your record, most recent first">
                <table>
                  <caption className="visually-hidden">
                    Government offices that have opened your record, most recent first
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">When</th>
                      <th scope="col">Office</th>
                      <th scope="col">Why</th>
                      <th scope="col">What they did</th>
                      <th scope="col">Reference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.accesses.map((entry) => (
                      <tr key={entry.reference}>
                        <td>{formatDateTime(entry.occurredAt)}</td>
                        <td>{entry.agency ?? 'You'}</td>
                        <td>{purposeLabel(entry.purpose)}</td>
                        <td>{actionLabel(entry.action)}</td>
                        <td className="mono small">{entry.reference}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )}

            {pageCount > 1 ? (
              <nav className="actions" style={{ marginTop: '1.25rem' }} aria-label="History pages">
                {page > 1 ? (
                  <Link
                    className="button button-secondary"
                    href={`/access-history?page=${page - 1}`}
                  >
                    Previous
                  </Link>
                ) : null}
                <span className="muted small">
                  Page {page} of {pageCount}
                </span>
                {page < pageCount ? (
                  <Link
                    className="button button-secondary"
                    href={`/access-history?page=${page + 1}`}
                  >
                    Next
                  </Link>
                ) : null}
              </nav>
            ) : null}
          </section>
        </>
      )}
    </>
  );
}
