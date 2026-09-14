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
import Link from 'next/link';

import { PageHeader } from '@/components/chrome';
import { callApi, dataOr } from '@/lib/api';
import { can, readSession } from '@/lib/session';
import type { IncidentSummary } from '@/lib/types';
import { INCIDENT_TYPES, SEVERITIES, incidentStatusTone, severityTone } from '@/lib/vocabulary';

import { reportIncident } from './actions';

export const metadata: Metadata = { title: 'Incidents' };

export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string): string | undefined =>
    typeof params[key] === 'string' && params[key] !== '' ? (params[key] as string) : undefined;

  const session = await readSession();
  const showAll = one('all') === '1';

  const result = can(session, 'INCIDENT_VIEW')
    ? await callApi<{ incidents: IncidentSummary[]; total: number }>(
        `/api/v1/incidents?limit=50${showAll ? '' : '&activeOnly=true'}`,
      )
    : null;
  const listed = dataOr(result, null);

  return (
    <>
      <PageHeader
        title="Incidents"
        lead="Everything in your jurisdiction. Opening one needs you or your service to be on it."
      />

      {one('error') === undefined ? null : (
        <Notice tone="danger" title="That could not be recorded" live>
          {one('error') === 'description'
            ? 'Say what has happened, in a sentence a crew could act on.'
            : (one('message') ?? 'Please try again.')}
        </Notice>
      )}

      <nav className="actions" aria-label="Filter" style={{ marginBottom: '1.25rem' }}>
        <Link className={`button ${showAll ? 'button-secondary' : ''}`} href="/incidents">
          Live now
        </Link>
        <Link className={`button ${showAll ? '' : 'button-secondary'}`} href="/incidents?all=1">
          Everything, including closed
        </Link>
      </nav>

      {result === null ? (
        <Notice tone="warn" title="Your account does not work incidents">
          Ask your agency administrator for the role your work needs.
        </Notice>
      ) : listed === null ? (
        <Notice tone="danger" title="The board could not be loaded">
          Please try again shortly.
        </Notice>
      ) : (
        <section className="card" aria-labelledby="listing-heading">
          <div className="card-header">
            <h2 id="listing-heading">
              {listed.total} {listed.total === 1 ? 'incident' : 'incidents'}
            </h2>
          </div>
          {listed.incidents.length === 0 ? (
            <Empty>Nothing here.</Empty>
          ) : (
            <TableScroll label="Incidents">
              <table>
                <caption className="visually-hidden">Incidents</caption>
                <thead>
                  <tr>
                    <th scope="col">Incident</th>
                    <th scope="col">What happened</th>
                    <th scope="col">Severity</th>
                    <th scope="col">Status</th>
                    <th scope="col">Reported</th>
                  </tr>
                </thead>
                <tbody>
                  {listed.incidents.map((incident) => (
                    <tr key={incident.incidentNumber}>
                      <td className="mono">
                        <Link href={`/incidents/${encodeURIComponent(incident.incidentNumber)}`}>
                          {incident.incidentNumber}
                        </Link>
                      </td>
                      <td>
                        {incident.description}
                        <br />
                        <span className="muted small">
                          {incident.address ?? incident.lgaCode ?? 'Location not given'}
                        </span>
                      </td>
                      <td>
                        <Badge tone={severityTone(incident.severity)}>
                          {sentence(incident.severity)}
                        </Badge>
                      </td>
                      <td>
                        <Badge tone={incidentStatusTone(incident.status)}>
                          {sentence(incident.status)}
                        </Badge>
                      </td>
                      <td>{formatDateTime(incident.reportedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </section>
      )}

      {can(session, 'INCIDENT_CREATE') ? (
        <section className="card" id="report" aria-labelledby="report-heading">
          <div className="card-header">
            <h2 id="report-heading">Take a call</h2>
          </div>
          <p>
            Record it now and correct it as you learn more. An incident that exists is one a unit
            can be sent to; a perfect one that is still being typed is not.
          </p>
          <form action={reportIncident} noValidate>
            <Select name="type" label="What has happened" options={INCIDENT_TYPES} required />
            <Select
              name="severity"
              label="How serious"
              options={SEVERITIES}
              defaultValue="MEDIUM"
              required
            />
            <TextArea
              name="description"
              label="What the caller said"
              hint="What a crew arriving would need to know. Write what you were told, not what you infer."
              required
              maxLength={4000}
            />
            <Field name="addressText" label="Where" maxLength={400} />
            <Field name="lgaCode" label="Local Government Area code" maxLength={16} />
            <Field name="wardCode" label="Ward code" maxLength={24} />
            <Field
              name="latitude"
              label="Latitude"
              hint="If the caller gave one. It is stored as caller-supplied, with a retention date."
              maxLength={16}
            />
            <Field name="longitude" label="Longitude" maxLength={16} />
            <Field
              name="reporterContact"
              label="Caller's number"
              type="tel"
              inputMode="tel"
              maxLength={64}
            />
            <div className="actions">
              <SubmitButton pendingLabel="Recording…">Open this incident</SubmitButton>
            </div>
          </form>
          <p className="muted small" style={{ marginBottom: 0 }}>
            A coordinate here is an observation about an <em>event</em>, stored with how it was
            obtained and with a date it is deleted. The platform holds no way to locate a person,
            and this form does not create one.
          </p>
        </section>
      ) : null}
    </>
  );
}

function sentence(value: string): string {
  const words = value.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
