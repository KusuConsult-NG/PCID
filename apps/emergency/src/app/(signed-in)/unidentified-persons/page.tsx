import {
  Badge,
  Empty,
  Field,
  Notice,
  Select,
  SubmitButton,
  TableScroll,
  TextArea,
} from '@pcid/portal-kit/components';
import { formatDateTime } from '@pcid/portal-kit/format';
import type { Metadata } from 'next';
import type { UnidentifiedPerson } from '@/lib/types';

import { PageHeader } from '@/components/chrome';
import { callApi, dataOr } from '@/lib/api';
import { can, readSession } from '@/lib/session';

import { recordUnidentifiedPerson } from './actions';

export const metadata: Metadata = { title: 'Somebody found' };

const CONDITIONS = [
  { value: 'UNKNOWN', label: 'Not known' },
  { value: 'CONSCIOUS', label: 'Conscious' },
  { value: 'UNCONSCIOUS', label: 'Unconscious' },
  { value: 'INJURED', label: 'Injured' },
  { value: 'DECEASED', label: 'Deceased' },
];

const SEXES = [
  { value: '', label: 'Not apparent' },
  { value: 'FEMALE', label: 'Apparently female' },
  { value: 'MALE', label: 'Apparently male' },
];

export default async function UnidentifiedPersonsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string): string | undefined =>
    typeof params[key] === 'string' && params[key] !== '' ? (params[key] as string) : undefined;

  const session = await readSession();
  const result = can(session, 'UNIDENTIFIED_PERSON_VIEW')
    ? await callApi<{ records: UnidentifiedPerson[]; total: number }>(
        '/api/v1/unidentified-persons?limit=25',
      )
    : null;
  const listed = dataOr(result, { records: [], total: 0 });

  return (
    <>
      <PageHeader
        title="Somebody found"
        lead="A person who cannot say who they are. Record what you can see; identifying them is somebody else's act, later."
      />

      {one('error') === undefined ? null : (
        <Notice tone="danger" title="That could not be recorded" live>
          {one('error') === 'description'
            ? 'Describe what you can actually see. It is the only thing matching has to work with.'
            : (one('message') ?? 'Please try again.')}
        </Notice>
      )}
      {one('recorded') === undefined ? null : (
        <Notice tone="ok" title={`Recorded as ${one('recorded')}`} live>
          It is now in the register, so a family searching for somebody can be matched against it.
          The matching engine produces candidates with their reasoning; a missing-persons supervisor
          decides, by name.
        </Notice>
      )}

      {result === null ? null : (
        <section className="card" aria-labelledby="register-heading">
          <div className="card-header">
            <h2 id="register-heading">Recently recorded</h2>
            <Badge tone="muted">{listed.total}</Badge>
          </div>
          {listed.records.length === 0 ? (
            <Empty>Nothing here.</Empty>
          ) : (
            <TableScroll label="Unidentified-person records">
              <table>
                <caption className="visually-hidden">Unidentified-person records</caption>
                <thead>
                  <tr>
                    <th scope="col">Reference</th>
                    <th scope="col">Condition</th>
                    <th scope="col">Found</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {listed.records.map((record) => (
                    <tr key={record.reference}>
                      <td className="mono">{record.reference}</td>
                      <td>{record.condition === undefined ? '—' : sentence(record.condition)}</td>
                      <td>
                        {record.found?.address ?? record.found?.lgaCode ?? '—'}
                        <br />
                        <span className="muted small">{formatDateTime(record.foundAt)}</span>
                      </td>
                      <td>
                        <Badge tone={record.status === 'IDENTIFIED' ? 'ok' : 'warn'}>
                          {sentence(record.status)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </section>
      )}

      {!can(session, 'UNIDENTIFIED_PERSON_CREATE') ? null : (
        <section className="card" id="record" aria-labelledby="record-heading">
          <div className="card-header">
            <h2 id="record-heading">Record somebody found</h2>
          </div>
          <p>
            Write what you can see, not what you infer. Distinguishing features carry the most
            weight when this is matched against open missing-person reports — a scar, a healed
            fracture, a tattoo — so describe them specifically.
          </p>
          <form action={recordUnidentifiedPerson} noValidate>
            <Field
              name="incidentRef"
              label="Incident you are attending"
              defaultValue={session?.workingIncident?.reference ?? ''}
              maxLength={64}
            />
            <Select name="condition" label="Condition when found" options={CONDITIONS} required />
            <Field
              name="estimatedAgeMin"
              label="Apparent age, from"
              type="number"
              min={0}
              max={130}
            />
            <Field
              name="estimatedAgeMax"
              label="Apparent age, to"
              type="number"
              min={0}
              max={130}
            />
            <Select name="apparentSex" label="Apparent sex" options={SEXES} defaultValue="" />
            <TextArea
              name="physicalDescription"
              label="What they look like"
              required
              maxLength={2000}
            />
            <TextArea name="clothingDescription" label="What they are wearing" maxLength={2000} />
            <TextArea
              name="distinguishingFeatures"
              label="Anything distinctive"
              hint="A scar, a healed fracture, a tattoo. Be specific: this is what matching works on."
              maxLength={2000}
            />
            <TextArea
              name="identityClues"
              label="Anything that might say who they are"
              hint="A bus ticket, a name inside a bag. Not a conclusion — the thing itself."
              maxLength={2000}
            />
            <Field name="foundAddress" label="Where they were found" maxLength={400} />
            <Field name="foundLgaCode" label="Local Government Area code" maxLength={16} />
            <Field name="foundWardCode" label="Ward code" maxLength={24} />
            <div className="step-actions">
              <SubmitButton pendingLabel="Recording…">Record this person</SubmitButton>
            </div>
          </form>
          <p className="muted small" style={{ marginBottom: 0 }}>
            There is no field here for who they are. An identity comes only from a missing-persons
            supervisor confirming a candidate match by name — a responder who could type an
            identifier into this record would be identifying somebody by assertion.
          </p>
          <p className="muted small" style={{ marginBottom: 0 }}>
            The platform stores no biometric data and performs no biometric matching. If your
            service holds fingerprints or similar under its own lawful authority, record the
            reference to them, not the material.
          </p>
        </section>
      )}
    </>
  );
}

function sentence(value: string): string {
  const words = value.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
