import type { Metadata } from 'next';

import { PageHeader } from '@/components/chrome';
import { Badge, Empty, Notice } from '@pcid/portal-kit/components';
import { Field, Select, TextArea } from '@pcid/portal-kit/components';
import { SubmitButton } from '@pcid/portal-kit/components';
import { callApi, dataOr } from '@/lib/api';
import { fieldLabel, formatDateTime, sentenceCase } from '@pcid/portal-kit/format';
import type { CorrectionRequest } from '@/lib/types';

import { requestCorrection } from './actions';

export const metadata: Metadata = { title: 'Corrections' };

/**
 * What a resident may ask to have corrected. The platform decides this too — it
 * rejects anything outside the list — but offering a closed set is kinder than a
 * free-text box that is refused after the fact.
 */
const CORRECTABLE = [
  { value: 'citizen.givenName', label: 'Given name' },
  { value: 'citizen.middleName', label: 'Middle name' },
  { value: 'citizen.familyName', label: 'Family name' },
  { value: 'citizen.dateOfBirth', label: 'Date of birth' },
  { value: 'citizen.sex', label: 'Sex' },
  { value: 'citizen.registeredAddress', label: 'Registered address' },
  { value: 'citizen.lgaCode', label: 'Local Government Area' },
  { value: 'citizen.wardCode', label: 'Ward' },
  { value: 'citizen.phonePrimary', label: 'Phone number' },
  { value: 'citizen.phoneSecondary', label: 'Second phone number' },
  { value: 'citizen.email', label: 'Email address' },
];

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'info' | 'muted'> = {
  SUBMITTED: 'info',
  UNDER_REVIEW: 'info',
  EVIDENCE_REQUIRED: 'warn',
  APPROVED: 'ok',
  APPLIED: 'ok',
  REJECTED: 'danger',
};

export default async function CorrectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const submitted = typeof params.submitted === 'string' ? params.submitted : undefined;
  const error = typeof params.error === 'string' ? params.error : undefined;

  const requests = dataOr(await callApi<CorrectionRequest[]>('/api/v1/me/correction-requests'), []);

  return (
    <>
      <PageHeader
        title="Corrections"
        lead="If something on your record is wrong, ask for it to be put right."
      />

      {submitted === undefined ? null : (
        <Notice tone="ok" title="Your request has been sent" live>
          <p style={{ marginBottom: 0 }}>
            Keep this reference: <span className="mono">{submitted}</span>. You can follow it below.
          </p>
        </Notice>
      )}
      {error === undefined ? null : (
        <Notice tone="danger" title="That could not be sent" live>
          {error === 'missing'
            ? 'Fill in the new value and say why it should change.'
            : 'Please try again.'}
        </Notice>
      )}

      <section className="card" aria-labelledby="requests-heading">
        <div className="card-header">
          <h2 id="requests-heading">Your requests</h2>
        </div>
        {requests.length === 0 ? (
          <Empty>You have not asked for any corrections.</Empty>
        ) : (
          <div className="table-scroll">
            <table>
              <caption className="visually-hidden">Correction requests you have submitted</caption>
              <thead>
                <tr>
                  <th scope="col">Reference</th>
                  <th scope="col">What</th>
                  <th scope="col">Asked for</th>
                  <th scope="col">Sent</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => (
                  <tr key={request.reference}>
                    <td className="mono small">{request.reference}</td>
                    <td>{fieldLabel(request.fieldPath)}</td>
                    <td>{request.requestedValue}</td>
                    <td>{formatDateTime(request.submittedAt)}</td>
                    <td>
                      <Badge tone={STATUS_TONE[request.status] ?? 'muted'}>
                        {sentenceCase(request.status)}
                      </Badge>
                      {request.reviewNote === null ? null : (
                        <div className="muted small">{request.reviewNote}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="new-correction">
        <div className="card-header">
          <h2 id="new-correction">Ask for a correction</h2>
        </div>
        <p>
          A person reviews every request. Records held by other offices — your property, vehicles or
          tax — are corrected by that office, and your request is passed to them.
        </p>
        <form action={requestCorrection} noValidate>
          <Select name="fieldPath" label="What is wrong" options={CORRECTABLE} required />
          <Field name="requestedValue" label="What it should say" required maxLength={400} />
          <TextArea
            name="justification"
            label="Why it should change"
            hint="For example: I moved house in March and the registry still shows my old address."
            required
            maxLength={2000}
          />
          <Field
            name="evidenceReference"
            label="Reference of any document you can show"
            hint="If you have a tenancy agreement, a utility bill or a court order, give its reference. You will be told where to bring it."
            maxLength={200}
          />
          <div className="actions">
            <SubmitButton pendingLabel="Sending…">Send request</SubmitButton>
          </div>
        </form>
      </section>
    </>
  );
}
