import {
  Badge,
  Empty,
  Field,
  Notice,
  Select,
  SubmitButton,
  TextArea,
} from '@pcid/portal-kit/components';
import { fieldLabel, formatDateTime, sentenceCase } from '@pcid/portal-kit/format';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/chrome';
import { callApi } from '@/lib/api';
import { can, readSession } from '@/lib/session';
import type { MissingPersonFile } from '@/lib/types';
import { enquiryStatusTone } from '@/lib/vocabulary';

import {
  decideMatch,
  reportSighting,
  resolveEnquiry,
  reviewSighting,
  reviseEnquiry,
  runMatching,
} from './actions';

export const metadata: Metadata = { title: 'Missing-person enquiry' };

const SIGHTING_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'muted'> = {
  VERIFIED: 'ok',
  UNVERIFIED: 'warn',
  DISCOUNTED: 'muted',
};

/**
 * One enquiry.
 *
 * The candidate matches are the part that matters most and the part most easily
 * got wrong. The engine produces candidates with the factors that produced them
 * and a score; it never identifies anybody. The page says so in as many words,
 * shows the reasoning rather than only the number, and offers "not the same
 * person" as plainly as "the same person" — because a reviewer who is only
 * offered confirmation will confirm.
 */
export default async function EnquiryPage({
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
  const result = await callApi<MissingPersonFile>(
    `/api/v1/missing-persons/${encodeURIComponent(reference)}`,
  );

  if (!result.ok) {
    return (
      <>
        <PageHeader title="That enquiry is not open to you" />
        <Notice tone="danger" title="No such enquiry, or not one you may open">
          <p>{result.error.message}</p>
          <p className="small muted" style={{ marginBottom: 0 }}>
            Reference <span className="mono">{result.error.correlationId}</span>.
          </p>
        </Notice>
      </>
    );
  }

  const file = result.data;
  const resolved = file.resolution?.resolvedAt != null;

  return (
    <>
      <PageHeader
        title={file.fullName ?? file.caseReference}
        lead={file.circumstances ?? undefined}
      />

      {one('error') === undefined ? null : (
        <Notice tone="danger" title="That could not be done" live>
          {one('error') === 'sighting'
            ? 'Write out what was seen, where and when.'
            : one('error') === 'matchnote'
              ? 'Say what you checked. A confirmation with no reasoning is not a decision.'
              : one('error') === 'resolution'
                ? 'An outcome note is required. It is the answer the file exists to give.'
                : one('error') === 'nothing'
                  ? 'Nothing was changed.'
                  : (one('message') ?? 'Please try again.')}
        </Notice>
      )}
      {one('decided') === undefined ? null : (
        <Notice
          tone="ok"
          title={one('decided') === 'CONFIRMED' ? 'Match confirmed' : 'Candidate rejected'}
          live
        >
          Recorded under your name. A confirmed match is the only thing that ever sets an identity
          here, and the database refuses one without a named reviewer.
        </Notice>
      )}
      {one('sighted') === '1' ? (
        <Notice tone="ok" title="Sighting recorded" live>
          It is unverified until somebody checks it.
        </Notice>
      ) : null}
      {one('reviewed') === '1' ? (
        <Notice tone="ok" title="Sighting reviewed" live>
          Checking a sighting out and discounting one are both proper outcomes, and both are
          recorded against your name.
        </Notice>
      ) : null}
      {one('resolved') === '1' ? (
        <Notice tone="ok" title="Outcome recorded" live>
          The enquiry is closed.
        </Notice>
      ) : null}
      {one('revised') === '1' ? (
        <Notice tone="ok" title="Enquiry updated" live>
          Which fields changed is on the audit record.
        </Notice>
      ) : null}
      {one('matched') === '1' ? (
        <Notice tone="ok" title="The matching engine has run" live>
          What it produced is below. They are candidates, not identifications.
        </Notice>
      ) : null}

      <section className="card" aria-labelledby="enquiry-heading">
        <div className="card-header">
          <h2 id="enquiry-heading">
            <span className="mono">{file.caseReference}</span>
          </h2>
          <Badge tone={enquiryStatusTone(file.status)}>{sentenceCase(file.status)}</Badge>
        </div>
        <dl className="facts">
          <dt>Age</dt>
          <dd>{file.ageYears ?? '—'}</dd>
          <dt>Sex</dt>
          <dd>{file.sex === null || file.sex === undefined ? '—' : sentenceCase(file.sex)}</dd>
          <dt>Plateau Citizen ID</dt>
          <dd className="mono">{file.citizenPcid ?? 'Not known'}</dd>
          <dt>Appearance</dt>
          <dd>{file.physicalDescription ?? '—'}</dd>
          <dt>Clothing</dt>
          <dd>{file.clothingDescription ?? '—'}</dd>
          <dt>Distinctive</dt>
          <dd>{file.distinguishingFeatures ?? '—'}</dd>
          <dt>Last seen</dt>
          <dd>
            {file.lastSeen?.address ?? '—'}
            {file.lastSeen?.lgaCode == null ? '' : ` (${file.lastSeen.lgaCode})`}
          </dd>
          <dt>Reported by</dt>
          <dd>
            {file.reporter?.name ?? '—'}
            {file.reporter?.relationship == null ? '' : ` · ${file.reporter.relationship}`}
          </dd>
          <dt>Reported</dt>
          <dd>{formatDateTime(file.createdAt)}</dd>
          {resolved ? (
            <>
              <dt>Outcome</dt>
              <dd>{file.resolution?.note ?? '—'}</dd>
            </>
          ) : null}
        </dl>
        {file.restrictedFields.length === 0 ? null : (
          <p className="muted small" style={{ marginBottom: 0 }}>
            Withheld for this purpose: {file.restrictedFields.map(fieldLabel).join(', ')}.
          </p>
        )}
      </section>

      {resolved || !can(session, 'MISSING_PERSON_UPDATE') ? null : (
        <section className="card" id="revise" aria-labelledby="revise-heading">
          <div className="card-header">
            <h3 id="revise-heading">Revise the enquiry</h3>
          </div>
          <form action={reviseEnquiry} noValidate>
            <input type="hidden" name="reference" value={file.caseReference} />
            <Select
              name="status"
              id="revise-status"
              label="Status"
              options={[
                { value: '', label: 'Leave as it is' },
                { value: 'REPORTED', label: 'Reported' },
                { value: 'VERIFIED', label: 'Verified' },
                { value: 'ACTIVE', label: 'Active search' },
                { value: 'CANCELLED', label: 'Cancelled' },
              ]}
              defaultValue=""
            />
            <TextArea
              name="physicalDescription"
              id="revise-appearance"
              label="What they look like"
              defaultValue={file.physicalDescription ?? ''}
              maxLength={2000}
            />
            <TextArea
              name="clothingDescription"
              id="revise-clothing"
              label="What they were wearing"
              defaultValue={file.clothingDescription ?? ''}
              maxLength={2000}
            />
            <TextArea
              name="circumstances"
              id="revise-circumstances"
              label="What happened"
              defaultValue={file.circumstances ?? ''}
              maxLength={4000}
            />
            <p className="muted small">
              Recording the outcome is separate, and needs a note: that is the question the file
              exists to answer.
            </p>
            <div className="actions">
              <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
            </div>
          </form>
        </section>
      )}

      <section className="card" id="sightings" aria-labelledby="sightings-heading">
        <div className="card-header">
          <h2 id="sightings-heading">Sightings</h2>
          <Badge tone="muted">{file.sightings.length}</Badge>
        </div>
        <p className="muted small">
          A sighting is unverified until an officer checks it. Discounting one is a proper outcome —
          a file whose only exit is confirmation only ever grows.
        </p>

        {file.sightings.length === 0 ? (
          <Empty>Nothing reported.</Empty>
        ) : (
          <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {file.sightings.map((sighting) => (
              <li key={sighting.id} className="card" style={{ boxShadow: 'none' }}>
                <div className="card-header">
                  <h3 style={{ fontSize: 'var(--step-0)' }}>
                    {sighting.address ?? 'Location not given'}
                  </h3>
                  <Badge tone={SIGHTING_TONE[sighting.verificationStatus] ?? 'muted'}>
                    {sentenceCase(sighting.verificationStatus)}
                  </Badge>
                </div>
                <p>{sighting.description}</p>
                <p className="muted small">Reported {formatDateTime(sighting.reportedAt)}</p>
                {resolved ||
                sighting.verificationStatus !== 'UNVERIFIED' ||
                !can(session, 'MISSING_PERSON_UPDATE') ? null : (
                  <form action={reviewSighting}>
                    <input type="hidden" name="reference" value={file.caseReference} />
                    <input type="hidden" name="sightingId" value={sighting.id} />
                    <div className="actions">
                      <SubmitButton
                        name="verificationStatus"
                        value="VERIFIED"
                        pendingLabel="Recording…"
                      >
                        Checked out
                      </SubmitButton>
                      <SubmitButton
                        className="button button-secondary"
                        name="verificationStatus"
                        value="DISCOUNTED"
                        pendingLabel="Recording…"
                      >
                        Discounted
                      </SubmitButton>
                    </div>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}

        {resolved || !can(session, 'MISSING_PERSON_UPDATE') ? null : (
          <form action={reportSighting} noValidate style={{ marginTop: '1.25rem' }}>
            <input type="hidden" name="reference" value={file.caseReference} />
            <TextArea
              name="description"
              id="sighting-description"
              label="What was seen"
              required
              maxLength={2000}
            />
            <Field name="addressText" id="sighting-where" label="Where" maxLength={400} />
            <Field
              name="lgaCode"
              id="sighting-lga"
              label="Local Government Area code"
              maxLength={16}
            />
            <Field
              name="reporterName"
              id="sighting-reporter"
              label="Who reported it"
              maxLength={200}
            />
            <div className="actions">
              <SubmitButton pendingLabel="Recording…">Record this sighting</SubmitButton>
            </div>
          </form>
        )}
      </section>

      <section className="card" id="candidates" aria-labelledby="candidates-heading">
        <div className="card-header">
          <h2 id="candidates-heading">Candidate matches</h2>
          <Badge tone="muted">{file.candidateMatches.length}</Badge>
        </div>
        <Notice tone="warn" title="A candidate is not an identification">
          <p style={{ marginBottom: 0 }}>
            The engine compares this enquiry against the register of people found who cannot say who
            they are, and produces candidates with the factors that produced them. It identifies
            nobody. A person decides, by name, and the database refuses a confirmed match that has
            no named reviewer.
          </p>
        </Notice>

        {file.candidateMatches.length === 0 ? (
          <Empty>No candidates have been produced.</Empty>
        ) : (
          <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {file.candidateMatches.map((match) => (
              <li key={match.id} className="candidate">
                <div className="card-header">
                  <h3 style={{ fontSize: 'var(--step-0)' }}>
                    {match.unidentifiedPersonReference ?? match.candidateCitizenPcid ?? 'Candidate'}
                  </h3>
                  <span>
                    <span className="score">{Math.round(match.score)}</span>
                    <span className="muted small"> / 100 similarity</span>
                  </span>
                </div>
                <Badge
                  tone={
                    match.status === 'CONFIRMED'
                      ? 'ok'
                      : match.status === 'REJECTED'
                        ? 'muted'
                        : 'warn'
                  }
                >
                  {sentenceCase(match.status)}
                </Badge>

                <h4 style={{ marginTop: '0.75rem' }}>Why it was produced</h4>
                {match.factors.length === 0 ? (
                  <p className="muted">No factors recorded.</p>
                ) : (
                  <ul className="factors">
                    {match.factors.map((factor, index) => (
                      <li key={index}>
                        {factor.field === undefined
                          ? JSON.stringify(factor)
                          : `${fieldLabel(factor.field)}${factor.note === undefined ? '' : ` — ${factor.note}`}`}
                      </li>
                    ))}
                  </ul>
                )}

                {match.unidentifiedPersonReference == null ? null : (
                  <p style={{ marginTop: '0.75rem' }}>
                    <Link
                      href={`/unidentified-persons/${encodeURIComponent(match.unidentifiedPersonReference)}`}
                    >
                      Read the unidentified-person record
                    </Link>
                  </p>
                )}

                {match.status !== 'CANDIDATE' && match.status !== 'UNDER_REVIEW' ? null : can(
                    session,
                    'MATCH_CONFIRM',
                  ) ? (
                  <form action={decideMatch} noValidate style={{ marginTop: '0.75rem' }}>
                    <input type="hidden" name="reference" value={file.caseReference} />
                    <input type="hidden" name="matchId" value={match.id} />
                    <TextArea
                      name="note"
                      id={`match-note-${match.id}`}
                      label="What you checked"
                      hint="What you compared and how you satisfied yourself. This is the record of the decision."
                      required
                      maxLength={2000}
                    />
                    <div className="actions">
                      <SubmitButton name="decision" value="CONFIRMED" pendingLabel="Recording…">
                        The same person
                      </SubmitButton>
                      <SubmitButton
                        className="button button-secondary"
                        name="decision"
                        value="REJECTED"
                        pendingLabel="Recording…"
                      >
                        Not the same person
                      </SubmitButton>
                    </div>
                  </form>
                ) : (
                  <p className="muted small" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
                    Deciding a match is a supervisor&rsquo;s act.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}

        {resolved || !can(session, 'MATCH_RUN') ? null : (
          <form action={runMatching} style={{ marginTop: '1.25rem' }}>
            <input type="hidden" name="reference" value={file.caseReference} />
            <SubmitButton className="button button-secondary" pendingLabel="Running…">
              Run the matching engine
            </SubmitButton>
          </form>
        )}
      </section>

      {resolved || !can(session, 'MISSING_PERSON_RESOLVE') ? null : (
        <section className="card" id="resolve" aria-labelledby="resolve-heading">
          <div className="card-header">
            <h3 id="resolve-heading">Record the outcome</h3>
          </div>
          <p>
            How this ended is the question the file exists to answer, so it needs a note rather than
            only a status.
          </p>
          <form action={resolveEnquiry} noValidate>
            <input type="hidden" name="reference" value={file.caseReference} />
            <Select
              name="outcome"
              id="resolve-outcome"
              label="Outcome"
              options={[
                { value: 'LOCATED', label: 'Located' },
                { value: 'REUNITED', label: 'Reunited with family' },
                { value: 'CLOSED', label: 'Closed' },
                { value: 'CANCELLED', label: 'Cancelled — the report was withdrawn' },
              ]}
              required
            />
            <TextArea
              name="note"
              id="resolve-note"
              label="What happened"
              required
              maxLength={2000}
            />
            <div className="actions">
              <SubmitButton pendingLabel="Recording…">Record the outcome</SubmitButton>
            </div>
          </form>
        </section>
      )}
    </>
  );
}
