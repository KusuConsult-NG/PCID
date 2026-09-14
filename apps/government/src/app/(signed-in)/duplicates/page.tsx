import { Badge, Empty, Notice, SubmitButton, TextArea } from '@pcid/portal-kit/components';
import { fieldLabel, formatDate, formatDateTime, sentenceCase } from '@pcid/portal-kit/format';
import type { Metadata } from 'next';

import { PageHeader } from '@/components/chrome';
import { callApi, dataOr } from '@/lib/api';
import type { DuplicateCandidate } from '@/lib/types';

import { decideDuplicate } from './actions';

export const metadata: Metadata = { title: 'Duplicate review' };

/** The order a reviewer reads two people in. */
const COMPARED = [
  'displayName',
  'givenName',
  'middleName',
  'familyName',
  'sex',
  'dateOfBirth',
  'phonePrimary',
  'phoneSecondary',
  'email',
  'registeredAddress',
  'lgaCode',
  'wardCode',
] as const;

/**
 * Two people, side by side, and a decision that only a person can make.
 *
 * The platform stops a registration that closely matches an existing record and
 * queues it. Nothing merges, nothing is issued, and no score decides anything:
 * what the score does is order the queue. The fields that differ are marked, so
 * the reviewer's eye goes to the thing that actually distinguishes them.
 */
export default async function DuplicatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string): string | undefined =>
    typeof params[key] === 'string' ? (params[key] as string) : undefined;

  const result = await callApi<{ total: number; candidates: DuplicateCandidate[] }>(
    '/api/v1/citizens/duplicates?limit=25',
  );
  const queue = dataOr(result, null);

  return (
    <>
      <PageHeader
        title="Duplicate review"
        lead="Registrations the platform stopped because they closely match somebody already on the register."
      />

      {one('error') === undefined ? null : (
        <Notice tone="danger" title="That decision was not recorded" live>
          {one('error') === 'note'
            ? 'Write down what you checked and how you decided. A reviewer months from now has only this note.'
            : 'Please try again.'}
        </Notice>
      )}

      {one('decided') === undefined ? null : (
        <Notice
          tone="ok"
          title={
            one('decided') === 'CONFIRMED_DUPLICATE'
              ? 'Recorded as the same person'
              : 'Recorded as two different people'
          }
          live
        >
          {one('issued') === undefined
            ? 'The pending registration was rejected. No identifier was issued and nothing was merged.'
            : `A Plateau Citizen ID has been issued: ${one('issued')}.`}
        </Notice>
      )}

      {queue === null ? (
        <Notice tone="danger" title="The queue could not be loaded">
          Please try again shortly.
        </Notice>
      ) : queue.candidates.length === 0 ? (
        <section className="card">
          <Empty>Nothing is waiting for review.</Empty>
        </section>
      ) : (
        <div className="stack" style={{ marginTop: '1.25rem' }}>
          <p className="muted">
            {queue.total} {queue.total === 1 ? 'candidate' : 'candidates'} awaiting a decision.
          </p>

          {queue.candidates.map((candidate) => (
            <section
              className="card"
              key={candidate.id}
              aria-labelledby={`candidate-${candidate.id}`}
            >
              <div className="card-header">
                <h2 id={`candidate-${candidate.id}`}>
                  {String(candidate.applicant.displayName ?? 'A new application')}
                </h2>
                <span>
                  <span className="score">{Math.round(candidate.score)}</span>
                  <span className="muted small"> / 100 similarity</span>
                </span>
              </div>

              <p className="muted small">
                Raised {formatDateTime(candidate.raisedAt)}
                {candidate.registrationReference === null
                  ? ''
                  : ` · registration ${candidate.registrationReference}`}
              </p>

              <div className="comparison">
                <div>
                  <h3>At the desk</h3>
                  <Person person={candidate.applicant} other={candidate.existingPerson} />
                </div>
                <div>
                  <h3>Already on the register</h3>
                  <Person person={candidate.existingPerson} other={candidate.applicant} />
                </div>
              </div>

              <h3 style={{ marginTop: '1.25rem' }}>Why this was flagged</h3>
              {candidate.matchedAttributes.length === 0 ? (
                <p className="muted">No attributes recorded.</p>
              ) : (
                <ul>
                  {candidate.matchedAttributes.map((attribute, index) => (
                    <li key={index}>
                      {attribute.field === undefined
                        ? JSON.stringify(attribute)
                        : `${fieldLabel(attribute.field)}${attribute.note === undefined ? '' : ` — ${attribute.note}`}`}
                    </li>
                  ))}
                </ul>
              )}

              <form action={decideDuplicate} noValidate style={{ marginTop: '1.25rem' }}>
                <input type="hidden" name="candidateId" value={candidate.id} />
                <TextArea
                  name="note"
                  id={`note-${candidate.id}`}
                  label="What you checked, and how you decided"
                  hint="A reviewer months from now has only this note. Say what document you saw, or who you spoke to."
                  required
                  maxLength={2000}
                />
                <div className="actions">
                  <SubmitButton name="decision" value="DISTINCT_PERSON" pendingLabel="Recording…">
                    These are two different people
                  </SubmitButton>
                  <SubmitButton
                    className="button button-danger"
                    name="decision"
                    value="CONFIRMED_DUPLICATE"
                    pendingLabel="Recording…"
                  >
                    This is the same person
                  </SubmitButton>
                </div>
              </form>
            </section>
          ))}
        </div>
      )}

      <Notice title="What this decision does">
        <p>
          <strong>Two different people:</strong> the registration proceeds and a Plateau Citizen ID
          is issued once no candidate is left awaiting review.
        </p>
        <p style={{ marginBottom: 0 }}>
          <strong>The same person:</strong> the new registration is rejected. The existing record is
          untouched — nothing is merged, here or anywhere else in the platform.
        </p>
      </Notice>
    </>
  );
}

function Person({
  person,
  other,
}: {
  person: Record<string, unknown>;
  other: Record<string, unknown>;
}) {
  const shown = COMPARED.filter((key) => person[key] !== undefined || other[key] !== undefined);
  if (shown.length === 0) return <Empty>Nothing released for this review.</Empty>;

  return (
    <dl className="facts">
      {shown.map((key) => {
        const value = person[key];
        const differs = normalise(value) !== normalise(other[key]);
        return (
          <div key={key} style={{ display: 'contents' }}>
            <dt>{fieldLabel(key)}</dt>
            <dd className={differs ? 'differs' : undefined}>
              {value === undefined || value === null || value === ''
                ? '—'
                : key === 'dateOfBirth'
                  ? formatDate(String(value))
                  : typeof value === 'string' && /^[A-Z][A-Z_]+$/.test(value)
                    ? sentenceCase(value)
                    : String(value)}
              {differs ? <Badge tone="warn"> differs</Badge> : null}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function normalise(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}
