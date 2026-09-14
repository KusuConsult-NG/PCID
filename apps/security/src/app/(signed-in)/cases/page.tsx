import {
  Badge,
  Empty,
  Field,
  Notice,
  Select,
  SubmitButton,
  TextArea,
} from '@pcid/portal-kit/components';
import { formatDateTime, sentenceCase } from '@pcid/portal-kit/format';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/chrome';
import { callApi, dataOr } from '@/lib/api';
import { can, readSession } from '@/lib/session';
import type { CaseSummary, Me } from '@/lib/types';
import { CASE_TYPES, caseStatusTone } from '@/lib/vocabulary';

import { openCase, takeCaseOn } from './actions';

export const metadata: Metadata = { title: 'Cases' };

export default async function CasesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string): string | undefined =>
    typeof params[key] === 'string' && params[key] !== '' ? (params[key] as string) : undefined;

  const session = await readSession();
  const status = one('status');

  const mayAssign = can(session, 'CASE_ASSIGN');
  const [result, me] = await Promise.all([
    callApi<{ cases: CaseSummary[]; total: number }>(
      `/api/v1/cases?limit=50${status === undefined ? '' : `&status=${encodeURIComponent(status)}`}`,
    ),
    mayAssign ? callApi<Me>('/api/v1/auth/me') : null,
  ]);
  const listed = dataOr(result, null);
  const myUserId = dataOr(me, null)?.id ?? '';

  return (
    <>
      <PageHeader
        title="Cases"
        lead="The cases you are assigned to. Being in the agency is not the same as being on the case."
      />

      {one('error') === undefined ? null : (
        <Notice tone="danger" title="That could not be done" live>
          {one('error') === 'title'
            ? 'Give the case a title somebody else could recognise it by.'
            : one('error') === 'assign'
              ? 'Give both the case number and the account to put on it.'
              : (one('message') ?? 'Please try again.')}
        </Notice>
      )}

      {one('closed') === undefined ? null : (
        <Notice tone="ok" title={`${one('closed')} is closed`} live>
          <p>
            The records linked to it are no longer reachable through it — and neither is the file
            itself, which is why you are here rather than on it.
          </p>
          <p style={{ marginBottom: 0 }}>
            Nothing has been deleted. What was done on the case, by whom and under what reason, is
            on the audit record, where an oversight review reads it.
          </p>
        </Notice>
      )}

      <nav className="actions" aria-label="Filter by status" style={{ marginBottom: '1.25rem' }}>
        {['ACTIVE', 'OPEN', 'SUSPENDED', 'CLOSED'].map((value) => (
          <Link
            key={value}
            className={`button ${value === status ? '' : 'button-secondary'}`}
            href={`/cases?status=${value}`}
          >
            {sentenceCase(value)}
          </Link>
        ))}
        <Link className={`button ${status === undefined ? '' : 'button-secondary'}`} href="/cases">
          All
        </Link>
      </nav>

      {listed === null ? (
        <Notice tone="danger" title="Your cases could not be loaded">
          Please try again shortly.
        </Notice>
      ) : (
        <section className="card" aria-labelledby="cases-heading">
          <div className="card-header">
            <h2 id="cases-heading">
              {listed.total} {listed.total === 1 ? 'case' : 'cases'}
            </h2>
          </div>
          {listed.cases.length === 0 ? (
            <Empty>Nothing here.</Empty>
          ) : (
            <div className="table-scroll">
              <table>
                <caption className="visually-hidden">Cases you are assigned to</caption>
                <thead>
                  <tr>
                    <th scope="col">Case</th>
                    <th scope="col">Title</th>
                    <th scope="col">Type</th>
                    <th scope="col">Status</th>
                    <th scope="col">Opened</th>
                  </tr>
                </thead>
                <tbody>
                  {listed.cases.map((file) => (
                    <tr key={file.caseNumber}>
                      <td className="mono">
                        <Link href={`/cases/${encodeURIComponent(file.caseNumber)}`}>
                          {file.caseNumber}
                        </Link>
                      </td>
                      <td>{file.title}</td>
                      <td>{sentenceCase(file.type)}</td>
                      <td>
                        <Badge tone={caseStatusTone(file.status)}>
                          {sentenceCase(file.status)}
                        </Badge>
                      </td>
                      <td>{formatDateTime(file.openedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {can(session, 'CASE_CREATE') ? (
        <section className="card" id="open" aria-labelledby="open-heading">
          <div className="card-header">
            <h2 id="open-heading">Open a case</h2>
          </div>
          <p>
            You are assigned to a case you open. A case is what makes a record reachable at all, so
            opening one without a reason to is not a shortcut — it is the thing an oversight review
            will ask you about.
          </p>
          <form action={openCase} noValidate>
            <Select name="type" label="What kind of case" options={CASE_TYPES} required />
            <Field
              name="title"
              label="Title"
              hint="How a colleague would recognise it. Not a person's name on its own."
              required
              maxLength={200}
            />
            <TextArea name="summary" label="Summary" maxLength={4000} />
            <Field name="lgaCode" label="Local Government Area code" maxLength={16} />
            <div className="actions">
              <SubmitButton pendingLabel="Opening…">Open this case</SubmitButton>
            </div>
          </form>
        </section>
      ) : null}

      {mayAssign ? (
        <section className="card" id="take-on" aria-labelledby="take-on-heading">
          <div className="card-header">
            <h2 id="take-on-heading">Take a case on</h2>
          </div>
          <p>
            A case you are not yet assigned to does not appear in the list above, and its file is
            closed to you — that is §22 working, not a fault. Putting yourself or a colleague onto
            one is the exception the platform allows on agency authority, so that a case does not
            become unjoinable when the officer holding it leaves.
          </p>
          <p className="muted small">
            The engine still decides. The case must belong to your agency, it must be active, and it
            must not be classified above your clearance. Nothing about the case is disclosed by a
            refusal: an assignment onto a case that does not exist is refused in the same words as
            one onto a case that does.
          </p>
          <form action={takeCaseOn} noValidate>
            <Field
              name="reference"
              id="take-on-reference"
              label="Case number"
              hint="For example CASE-2026-00928."
              required
              maxLength={64}
            />
            <Field
              name="userId"
              id="take-on-user"
              label="Officer account id"
              hint="Yours is filled in. Change it to put a colleague on instead."
              defaultValue={myUserId}
              required
              maxLength={64}
            />
            <Select
              name="role"
              id="take-on-role"
              label="On the case as"
              options={[
                { value: 'SUPERVISOR', label: 'Supervisor' },
                { value: 'INVESTIGATOR', label: 'Investigator' },
                { value: 'ANALYST', label: 'Analyst' },
                { value: 'OBSERVER', label: 'Observer' },
              ]}
              required
            />
            <div className="actions">
              <SubmitButton pendingLabel="Assigning…">Assign to this case</SubmitButton>
            </div>
          </form>
        </section>
      ) : null}
    </>
  );
}
