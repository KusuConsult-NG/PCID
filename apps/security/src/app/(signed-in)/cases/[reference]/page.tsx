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
import { callApi } from '@/lib/api';
import { can, readSession } from '@/lib/session';
import type { CaseFile } from '@/lib/types';
import { SUBJECT_ROLES, caseStatusTone } from '@/lib/vocabulary';

import { setWorkingCase } from '../actions';
import { addNote, assignOfficer, closeCase, linkSubject, updateCase } from './actions';

export const metadata: Metadata = { title: 'Case file' };

/**
 * The statuses this form offers, which are not all the statuses a case has.
 *
 * Case-bound access is permitted during OPEN, ACTIVE and PENDING_REVIEW only.
 * SUSPENDED is a real status and it is absent here on purpose: setting it would
 * close the file to the officer who set it, and because changing a case is
 * itself case-bound, nothing in the platform would let them set it back. A
 * one-way door is not something an interface should put a button on.
 *
 * CLOSED is absent for a different reason - it belongs to CASE_CLOSE and demands
 * a closure note, which is the form further down this page.
 */
const EDITABLE_STATUSES = [
  { value: 'OPEN', label: 'Open' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'PENDING_REVIEW', label: 'Pending review' },
];

/**
 * The case file.
 *
 * The linked subjects are the substance of the page, because linking somebody is
 * the act that opens their record — not the officer's role, not the agency.
 * Every link carries the justification that was written at the time, and the
 * page shows it, so a colleague reading the file later sees the reason the
 * record was opened rather than only that it was.
 */
export default async function CasePage({
  params,
  searchParams,
}: {
  params: Promise<{ reference: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { reference } = await params;
  const query = await searchParams;
  const one = (key: string): string | undefined =>
    typeof query[key] === 'string' && query[key] !== '' ? (query[key] as string) : undefined;

  const session = await readSession();
  const result = await callApi<CaseFile>(`/api/v1/cases/${encodeURIComponent(reference)}`);

  if (!result.ok) {
    // ACCESS_DENIED is the platform naming what is missing, which it does only
    // where saying so leaks nothing - a case you hold that has been closed, a
    // record not linked to it. NOT_FOUND_OR_NOT_PERMITTED is the opaque answer,
    // and the portal must not dress it up as anything more specific.
    const named = result.error.code === 'ACCESS_DENIED';
    return (
      <>
        <PageHeader
          title={named ? 'That case authorises nothing now' : 'That case is not open to you'}
        />
        <Notice tone="danger" title={named ? 'Closed' : 'No such case, or not one you are on'}>
          <p>{result.error.message}</p>
          <p className="small muted" style={{ marginBottom: 0 }}>
            {named
              ? 'Closing a case ends the access it was granting, including to the file itself. What ' +
                'happened on it is on the audit record, which nothing removes.'
              : 'The platform answers the same way for a case that does not exist and one you are ' +
                'not assigned to, so that guessing a case number never confirms that the case is ' +
                'real.'}{' '}
            Reference <span className="mono">{result.error.correlationId}</span>.
          </p>
        </Notice>
        <p style={{ marginTop: '1.25rem' }}>
          <Link className="button button-secondary" href="/cases">
            Back to your cases
          </Link>
        </p>
      </>
    );
  }

  const file = result.data;
  const closed = file.status === 'CLOSED' || file.status === 'ARCHIVED';
  const working = session?.workingCase?.reference === file.caseNumber;

  return (
    <>
      <PageHeader title={file.title} lead={file.summary ?? undefined} />

      {one('error') === undefined ? null : (
        <Notice tone="danger" title="That could not be done" live>
          {one('error') === 'link'
            ? 'Give the Plateau Citizen ID and say, in at least ten characters, why this person is relevant to the case.'
            : one('error') === 'note'
              ? 'Write the note out.'
              : one('error') === 'closure'
                ? 'A closure note is required. It is the record of how the case ended.'
                : (one('message') ?? 'Please try again.')}
        </Notice>
      )}
      {one('opened') === '1' ? (
        <Notice tone="ok" title="Case opened" live>
          You are assigned to it. Nobody&rsquo;s record is reachable until you link them and say
          why.
        </Notice>
      ) : null}
      {one('linked') === '1' ? (
        <Notice tone="ok" title="Linked to the case" live>
          Their record is now open to the officers on this case, under a criminal-investigation
          purpose. That access is withheld from the person&rsquo;s own history with a stated legal
          basis, and the Data Protection Officer can see it.
        </Notice>
      ) : null}
      {one('noted') === '1' ? (
        <Notice tone="ok" title="Note added" live>
          It carries your name and the time, and cannot be edited or removed.
        </Notice>
      ) : null}
      {one('assigned') === '1' ? (
        <Notice tone="ok" title="Officer assigned" live>
          They can now reach this case and the records linked to it.
        </Notice>
      ) : null}
      {one('updated') === '1' ? (
        <Notice tone="ok" title="Case updated" live>
          The previous values are on the audit record.
        </Notice>
      ) : null}

      <section className="card" id="details" aria-labelledby="details-heading">
        <div className="card-header">
          <h2 id="details-heading">
            <span className="mono">{file.caseNumber}</span>
          </h2>
          <Badge tone={caseStatusTone(file.status)}>{sentenceCase(file.status)}</Badge>
        </div>
        <dl className="facts">
          <dt>Type</dt>
          <dd>{sentenceCase(file.type)}</dd>
          <dt>Classification</dt>
          <dd>{sentenceCase(file.classification)}</dd>
          <dt>Opened</dt>
          <dd>{formatDateTime(file.openedAt)}</dd>
          {file.closedAt === null ? null : (
            <>
              <dt>Closed</dt>
              <dd>{formatDateTime(file.closedAt)}</dd>
            </>
          )}
          <dt>Area</dt>
          <dd>{file.lgaCode ?? '—'}</dd>
        </dl>

        {closed ? null : (
          <form action={setWorkingCase} style={{ marginTop: '1rem' }}>
            <input type="hidden" name="reference" value={working ? '' : file.caseNumber} />
            <input type="hidden" name="title" value={file.title} />
            <input type="hidden" name="return" value={`/cases/${file.caseNumber}`} />
            <SubmitButton className="button button-secondary">
              {working ? 'Stop working under this case' : 'Work under this case'}
            </SubmitButton>
          </form>
        )}
      </section>

      {closed || !can(session, 'CASE_UPDATE') ? null : (
        <section className="card" aria-labelledby="edit-heading">
          <div className="card-header">
            <h3 id="edit-heading">Correct or advance this case</h3>
          </div>
          <form action={updateCase} noValidate>
            <input type="hidden" name="reference" value={file.caseNumber} />
            <Field
              name="title"
              id="edit-title"
              label="Title"
              defaultValue={file.title}
              maxLength={200}
            />
            <TextArea
              name="summary"
              id="edit-summary"
              label="Summary"
              defaultValue={file.summary ?? ''}
              maxLength={4000}
            />
            <Select
              name="status"
              id="edit-status"
              label="Status"
              options={EDITABLE_STATUSES}
              defaultValue={file.status}
            />
            <p className="muted small">
              Closing a case is not here. It belongs to a supervisor and demands a closure note.
              Suspending one is not here either: a suspended case authorises no access, including
              the access needed to set it back, so the platform offers no way out of it.
            </p>
            <div className="actions">
              <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
            </div>
          </form>
        </section>
      )}

      <section className="card" id="subjects" aria-labelledby="subjects-heading">
        <div className="card-header">
          <h2 id="subjects-heading">People and records linked to this case</h2>
          <Badge tone="muted">{file.subjects.length}</Badge>
        </div>
        <p className="muted small">
          Linking somebody is what opens their record to the officers on this case. It is not a
          bookmark: the reason you write here is the reason an oversight review will read.
        </p>

        {file.subjects.length === 0 ? (
          <Empty>Nobody is linked to this case.</Empty>
        ) : (
          <div className="table-scroll">
            <table>
              <caption className="visually-hidden">Subjects linked to this case</caption>
              <thead>
                <tr>
                  <th scope="col">Who or what</th>
                  <th scope="col">As</th>
                  <th scope="col">Linked</th>
                  <th scope="col">Reason given</th>
                  <th scope="col">
                    <span className="visually-hidden">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {file.subjects.map((subject) => (
                  <tr key={`${subject.type}-${subject.id}`}>
                    <td className="mono">{subject.id}</td>
                    <td>{sentenceCase(subject.role)}</td>
                    <td>{formatDateTime(subject.linkedAt)}</td>
                    <td>{subject.justification}</td>
                    <td>
                      {subject.type === 'CITIZEN' && !closed ? (
                        <Link
                          className="button button-secondary"
                          href={`/person/${encodeURIComponent(subject.id)}?case=${encodeURIComponent(file.caseNumber)}`}
                        >
                          Open record
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {closed || !can(session, 'CASE_LINK_SUBJECT') ? null : (
          <form action={linkSubject} noValidate style={{ marginTop: '1.25rem' }}>
            <input type="hidden" name="reference" value={file.caseNumber} />
            <Field
              name="subjectId"
              id="link-subject"
              label="Plateau Citizen ID"
              hint="Find it with the search if you do not have it."
              required
              maxLength={20}
            />
            <Select
              name="subjectRole"
              id="link-role"
              label="What are they to this case"
              options={SUBJECT_ROLES}
              required
            />
            <TextArea
              name="justification"
              id="link-justification"
              label="Why this person is relevant"
              hint="At least ten characters. This is recorded and cannot be changed afterwards."
              required
              maxLength={2000}
            />
            <div className="actions">
              <SubmitButton pendingLabel="Linking…">Link to this case</SubmitButton>
            </div>
          </form>
        )}
      </section>

      <section className="card" id="officers" aria-labelledby="officers-heading">
        <div className="card-header">
          <h2 id="officers-heading">Officers on this case</h2>
        </div>
        {file.assignedOfficers.length === 0 ? (
          <Empty>Nobody is assigned.</Empty>
        ) : (
          <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {file.assignedOfficers.map((officer) => (
              <li key={`${officer.name}-${officer.assignedAt}`}>
                {officer.name} <Badge tone="muted">{sentenceCase(officer.role)}</Badge>
                <br />
                <span className="muted small">Assigned {formatDateTime(officer.assignedAt)}</span>
              </li>
            ))}
          </ul>
        )}

        {closed || !can(session, 'CASE_ASSIGN') ? null : (
          <form action={assignOfficer} noValidate style={{ marginTop: '1.25rem' }}>
            <input type="hidden" name="reference" value={file.caseNumber} />
            <Field
              name="userId"
              id="assign-user"
              label="Officer account id"
              hint="From the administration directory."
              required
              maxLength={64}
            />
            <Select
              name="role"
              id="assign-role"
              label="On the case as"
              options={[
                { value: 'INVESTIGATOR', label: 'Investigator' },
                { value: 'SUPERVISOR', label: 'Supervisor' },
                { value: 'ANALYST', label: 'Analyst' },
                { value: 'OBSERVER', label: 'Observer' },
              ]}
              required
            />
            <div className="actions">
              <SubmitButton pendingLabel="Assigning…">Assign to this case</SubmitButton>
            </div>
          </form>
        )}
      </section>

      <section className="card" id="notes" aria-labelledby="notes-heading">
        <div className="card-header">
          <h2 id="notes-heading">Case notes</h2>
          <Badge tone="muted">{file.notes.length}</Badge>
        </div>
        <p className="muted small">
          Append-only. A note carries its author and its time, and nothing edits or removes one — a
          case file somebody can quietly rewrite is not a case file.
        </p>

        {file.notes.length === 0 ? (
          <Empty>No notes yet.</Empty>
        ) : (
          <ul className="timeline">
            {file.notes.map((note) => (
              <li key={`${note.createdAt}-${note.author ?? ''}`}>
                {note.body}
                <span className="muted small">
                  {note.author ?? 'Unknown officer'} · {formatDateTime(note.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {closed || !can(session, 'CASE_UPDATE') ? null : (
          <form action={addNote} noValidate style={{ marginTop: '1.25rem' }}>
            <input type="hidden" name="reference" value={file.caseNumber} />
            <TextArea
              name="body"
              id="note-body"
              label="Add a note"
              hint="What you did, what you found, and when."
              required
              maxLength={8000}
            />
            <div className="actions">
              <SubmitButton pendingLabel="Adding…">Add to the file</SubmitButton>
            </div>
          </form>
        )}
      </section>

      {closed || !can(session, 'CASE_CLOSE') ? null : (
        <section className="card" aria-labelledby="close-heading">
          <div className="card-header">
            <h3 id="close-heading">Close this case</h3>
          </div>
          <p>
            Closing it ends the access it was granting: the records linked to it stop being
            reachable through it. An officer cannot close a case they are not assigned to.
          </p>
          <form action={closeCase} noValidate>
            <input type="hidden" name="reference" value={file.caseNumber} />
            <TextArea
              name="closureNote"
              id="closure-note"
              label="How this case ended"
              required
              maxLength={4000}
            />
            <div className="actions">
              <SubmitButton className="button button-danger" pendingLabel="Closing…">
                Close this case
              </SubmitButton>
            </div>
          </form>
        </section>
      )}
    </>
  );
}
