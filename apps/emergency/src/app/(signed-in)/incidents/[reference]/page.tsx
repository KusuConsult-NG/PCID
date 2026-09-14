import {
  Badge,
  Empty,
  Field,
  Notice,
  Select,
  SubmitButton,
  TextArea,
} from '@pcid/portal-kit/components';
import { formatDateTime } from '@pcid/portal-kit/format';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/chrome';
import { KeepIncidentOffline } from '@/components/offline';
import { callApi, dataOr } from '@/lib/api';
import { can, readSession } from '@/lib/session';
import type { IncidentFile, ResponseUnit } from '@/lib/types';
import {
  OFFICER_ROLES,
  PERSON_ROLES,
  WORKING_STATUSES,
  distance,
  duration,
  incidentStatusTone,
  severityTone,
  unitStatusTone,
} from '@/lib/vocabulary';

import { setWorkingIncident } from '../actions';
import {
  attachOfficer,
  attachPerson,
  dispatchUnit,
  updateDispatch,
  updateIncidentStatus,
} from './actions';

export const metadata: Metadata = { title: 'Incident' };

const ACTIVE = ['REPORTED', 'VERIFIED', 'DISPATCHED', 'ON_SCENE', 'CONTAINED'];

/**
 * What a crew can press next, and nothing else.
 *
 * The platform validates the transition and refuses the rest, so offering every
 * step on every dispatch would be offering buttons that fail. A dispatch that is
 * finished or stood down has no next step at all.
 */
const NEXT_STEPS: Readonly<Record<string, readonly { value: string; label: string }[]>> = {
  ASSIGNED: [
    { value: 'ACKNOWLEDGED', label: 'Acknowledged' },
    { value: 'EN_ROUTE', label: 'On our way' },
    { value: 'STOOD_DOWN', label: 'Stood down' },
  ],
  ACKNOWLEDGED: [
    { value: 'EN_ROUTE', label: 'On our way' },
    { value: 'STOOD_DOWN', label: 'Stood down' },
  ],
  EN_ROUTE: [
    { value: 'ON_SCENE', label: 'Arrived' },
    { value: 'STOOD_DOWN', label: 'Stood down' },
  ],
  ON_SCENE: [
    { value: 'COMPLETED', label: 'Finished' },
    { value: 'STOOD_DOWN', label: 'Stood down' },
  ],
};

const MOVEABLE = Object.keys(NEXT_STEPS);

/**
 * One incident: what happened, who is on it, what has been sent, and when.
 *
 * The response times are shown because they are measured rather than typed —
 * they fall out of the dispatch timestamps — and because a crew that can see
 * them is a crew that can argue with them. A number nobody can see is a number
 * nobody corrects.
 */
export default async function IncidentPage({
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
  const result = await callApi<IncidentFile>(`/api/v1/incidents/${encodeURIComponent(reference)}`);

  if (!result.ok) {
    // ACCESS_DENIED is the platform naming what is missing, which it does only
    // where saying so leaks nothing — an incident you were on that has closed.
    // NOT_FOUND_OR_NOT_PERMITTED is the opaque answer, and the portal must not
    // dress it up as anything more specific.
    const named = result.error.code === 'ACCESS_DENIED';
    return (
      <>
        <PageHeader
          title={named ? 'That is not something you can do' : 'That incident is not open to you'}
        />
        <Notice tone="danger" title={named ? 'Refused' : 'No such incident, or not one you are on'}>
          <p>{result.error.message}</p>
          <p className="small muted" style={{ marginBottom: 0 }}>
            {named
              ? 'The platform named what is missing because saying so to somebody who already ' +
                'holds the incident leaks nothing.'
              : 'The platform answers the same way for an incident that does not exist and one ' +
                'you are not attached to, so that guessing a number never confirms that the ' +
                'incident is real. If you are at the scene, ask control to attach you.'}{' '}
            Reference <span className="mono">{result.error.correlationId}</span>.
          </p>
        </Notice>
        <p style={{ marginTop: '1.25rem' }}>
          <Link className="button button-secondary" href="/incidents">
            Back to the board
          </Link>
        </p>
      </>
    );
  }

  const incident = result.data;
  const live = ACTIVE.includes(incident.status);
  // Resolved is not live — it authorises nothing — but it is not finished
  // either. An incident is resolved first and closed afterwards, and the act of
  // closing is the one thing a resolved incident still admits.
  const finishable = incident.status !== 'CLOSED' && incident.status !== 'CANCELLED';
  const attending = session?.workingIncident?.reference === incident.incidentNumber;

  const nearby =
    live && can(session, 'DISPATCH_CREATE')
      ? await callApi<ResponseUnit[]>(
          `/api/v1/response-units?nearIncident=${encodeURIComponent(incident.incidentNumber)}`,
        )
      : null;

  return (
    <>
      <PageHeader title={incident.description} lead={incident.address ?? undefined} />

      {one('error') === undefined ? null : (
        <Notice tone="danger" title="That could not be done" live>
          {one('error') === 'unit'
            ? 'Name the unit you are sending.'
            : one('error') === 'officer'
              ? 'Give the account id of the person to attach.'
              : one('error') === 'person'
                ? 'Give the Plateau Citizen ID of the person.'
                : (one('message') ?? 'Please try again.')}
        </Notice>
      )}
      {one('opened') === '1' ? (
        <Notice tone="ok" title="Incident opened" live>
          It is the authority for everything that follows. Send a unit, and its service is attached.
        </Notice>
      ) : null}
      {one('dispatched') === undefined ? null : (
        <Notice tone="ok" title={`${one('dispatched')} is on its way`} live>
          Its service is now attached to this incident, which is what opens the casualties&rsquo;
          details to the crew attending.
        </Notice>
      )}
      {one('moved') === undefined ? null : (
        <Notice tone="ok" title="Recorded" live>
          The response times below come from these timestamps. Nobody types them in.
        </Notice>
      )}
      {one('status') === undefined ? null : (
        <Notice tone="ok" title={`Incident set to ${sentence(one('status') as string)}`} live>
          The change and its time are on the incident&rsquo;s own record below.
        </Notice>
      )}

      {finishable ? null : (
        <Notice tone="info" title="This incident is over">
          <p>
            The access it was granting has ended with it: nobody can read the details of the people
            on it through this incident any more, and there was nothing separate to revoke.
          </p>
          <p style={{ marginBottom: 0 }}>
            What happened is still here, because it is an operational record rather than anybody
            &rsquo;s personal information — which is what a debrief, a complaint, or a question
            about the response times below is answered from.
          </p>
        </Notice>
      )}
      {one('attached') === '1' ? (
        <Notice tone="ok" title="Attached" live>
          They can now open the details of the people on this incident, and every read is recorded
          against their name.
        </Notice>
      ) : null}
      {one('person') === '1' ? (
        <Notice tone="ok" title="Recorded" live>
          Who they are, who identified them, and when.
        </Notice>
      ) : null}

      <section className="card" id="details" aria-labelledby="details-heading">
        <div className="card-header">
          <h2 id="details-heading">
            <span className="mono">{incident.incidentNumber}</span>
          </h2>
          <span>
            <Badge tone={severityTone(incident.severity)}>{sentence(incident.severity)}</Badge>{' '}
            <Badge tone={incidentStatusTone(incident.status)}>{sentence(incident.status)}</Badge>
          </span>
        </div>
        <dl className="facts">
          <dt>What happened</dt>
          <dd>{sentence(incident.type)}</dd>
          <dt>Where</dt>
          <dd>{incident.address ?? '—'}</dd>
          <dt>Area</dt>
          <dd>
            {incident.lgaCode ?? '—'}
            {incident.wardCode === null ? '' : ` · ${incident.wardCode}`}
          </dd>
          <dt>Reported</dt>
          <dd>{formatDateTime(incident.reportedAt)}</dd>
          {incident.location === null ? null : (
            <>
              <dt>Coordinates</dt>
              <dd>
                {incident.location.latitude}, {incident.location.longitude}
                <br />
                <span className="muted small">
                  {sentence(incident.location.source ?? 'UNKNOWN')} — provenance travels with every
                  coordinate, and this one has a deletion date.
                </span>
              </dd>
            </>
          )}
        </dl>

        <h3>Response times</h3>
        <dl className="times">
          <div>
            <dt>Call to dispatch</dt>
            <dd>{duration(incident.responseTimes.callToDispatchSeconds)}</dd>
          </div>
          <div>
            <dt>Dispatch to arrival</dt>
            <dd>{duration(incident.responseTimes.dispatchToArrivalSeconds)}</dd>
          </div>
          <div>
            <dt>Total response</dt>
            <dd>{duration(incident.responseTimes.totalResponseSeconds)}</dd>
          </div>
          <div>
            <dt>To resolution</dt>
            <dd>{duration(incident.responseTimes.resolutionSeconds)}</dd>
          </div>
        </dl>
        <p className="muted small">
          Measured from the dispatch timestamps, not entered by anybody. Analytics group these by
          unit type and service, never by individual responder: this measures capacity, not people.
        </p>

        {!live ? null : (
          <form action={setWorkingIncident} style={{ marginTop: '1rem' }}>
            <input
              type="hidden"
              name="reference"
              value={attending ? '' : incident.incidentNumber}
            />
            <input type="hidden" name="summary" value={incident.description} />
            <input type="hidden" name="return" value={`/incidents/${incident.incidentNumber}`} />
            <SubmitButton className="button button-secondary">
              {attending ? 'Stop attending this' : 'I am attending this'}
            </SubmitButton>
          </form>
        )}
      </section>

      {!live || !can(session, 'INCIDENT_UPDATE') ? null : (
        <section className="card" aria-labelledby="move-heading">
          <div className="card-header">
            <h3 id="move-heading">Move this incident on</h3>
          </div>
          <form action={updateIncidentStatus} noValidate>
            <input type="hidden" name="reference" value={incident.incidentNumber} />
            <Select
              name="status"
              id="move-status"
              label="Status"
              options={WORKING_STATUSES}
              defaultValue={incident.status}
              required
            />
            <TextArea name="note" id="move-note" label="Note" maxLength={2000} />
            <div className="actions">
              <SubmitButton pendingLabel="Recording…">Save</SubmitButton>
            </div>
          </form>
        </section>
      )}

      <section className="card" id="units" aria-labelledby="units-heading">
        <div className="card-header">
          <h2 id="units-heading">What has been sent</h2>
          <Badge tone={incident.responseUnits.length === 0 ? 'danger' : 'muted'}>
            {incident.responseUnits.length}
          </Badge>
        </div>
        {incident.responseUnits.length === 0 ? (
          <Empty>Nothing has been sent to this incident yet.</Empty>
        ) : (
          <div className="stack">
            {incident.responseUnits.map((unit) => (
              <div className="card" key={unit.dispatchId} style={{ boxShadow: 'none' }}>
                <div className="unit" style={{ border: 0, padding: 0 }}>
                  <span className="code">{unit.unitCode}</span>
                  <span>{sentence(unit.type)}</span>
                  <Badge tone={unitStatusTone(unit.status)}>{sentence(unit.status)}</Badge>
                  <span className="muted small">
                    Sent {formatDateTime(unit.dispatchedAt)}
                    {unit.arrivedAt === null ? '' : ` · arrived ${formatDateTime(unit.arrivedAt)}`}
                  </span>
                </div>

                {!live ||
                !can(session, 'DISPATCH_UPDATE') ||
                !MOVEABLE.includes(unit.status) ? null : (
                  <form action={updateDispatch} style={{ marginTop: '0.75rem' }}>
                    <input type="hidden" name="reference" value={incident.incidentNumber} />
                    <input type="hidden" name="dispatchId" value={unit.dispatchId} />
                    <div className="step-actions">
                      {(NEXT_STEPS[unit.status] ?? []).map((step) => (
                        <SubmitButton
                          key={step.value}
                          className="button button-secondary"
                          name="status"
                          value={step.value}
                          pendingLabel="Recording…"
                        >
                          {step.label}
                        </SubmitButton>
                      ))}
                    </div>
                  </form>
                )}
              </div>
            ))}
          </div>
        )}
        <p className="muted small">
          Press these as they happen. The timestamps behind them are the response times above, so
          pressing them late makes the service look slower than it was.
        </p>

        {nearby === null ? null : (
          <>
            <h3>Nearest available</h3>
            {dataOr(nearby, []).length === 0 ? (
              <Empty>
                Nothing is available to send. Every unit is out, off the run, or not in service.
              </Empty>
            ) : (
              <div className="stack">
                {dataOr(nearby, []).map((unit) => (
                  <form className="unit" action={dispatchUnit} key={unit.unitCode}>
                    <input type="hidden" name="reference" value={incident.incidentNumber} />
                    <input type="hidden" name="unitCode" value={unit.unitCode} />
                    <span className="code">{unit.unitCode}</span>
                    <span>
                      {sentence(unit.type)}
                      <br />
                      <span className="muted small">
                        {distance(unit.distanceMetres)}
                        {unit.capabilities.length === 0
                          ? ''
                          : ` · ${unit.capabilities.map(sentence).join(', ')}`}
                      </span>
                    </span>
                    <SubmitButton pendingLabel="Sending…">Send {unit.unitCode}</SubmitButton>
                  </form>
                ))}
              </div>
            )}
            <p className="muted small" style={{ marginBottom: 0 }}>
              Ordered by how far away each unit says it is. Only units that could actually be sent
              appear here.
            </p>
          </>
        )}
      </section>

      <section className="card" id="people" aria-labelledby="people-heading">
        <div className="card-header">
          <h2 id="people-heading">Who is on this incident</h2>
        </div>
        {incident.assignedOfficers.length === 0 ? (
          <Empty>Nobody is attached.</Empty>
        ) : (
          <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {incident.assignedOfficers.map((officer) => (
              <li key={`${officer.name}-${officer.role}`}>
                {officer.name} <Badge tone="muted">{sentence(officer.role)}</Badge>
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">
          A service is attached automatically when one of its units is sent. This list is the people
          attached by name — which is what control does for a crew from a service that has not been
          dispatched.
        </p>

        {/*
          Taking the casualties' profiles with you, for the stretch of road with
          no coverage (§56). Offered only while the incident is live and only to
          an account that holds the entitlement, because both are conditions the
          platform will apply anyway and a button that is always refused is worse
          than no button.
        */}
        <KeepIncidentOffline
          reference={incident.incidentNumber}
          canHold={live && can(session, 'OFFLINE_ACCESS')}
        />

        {!live || !can(session, 'INCIDENT_UPDATE') ? null : (
          <>
            <form action={attachOfficer} noValidate style={{ marginTop: '1.25rem' }}>
              <input type="hidden" name="reference" value={incident.incidentNumber} />
              <Field
                name="userId"
                id="attach-user"
                label="Account id of the person to attach"
                hint="From the directory. Attaching them opens the casualties’ details to them."
                required
                maxLength={64}
              />
              <Select
                name="role"
                id="attach-role"
                label="Attached as"
                options={OFFICER_ROLES}
                required
              />
              <div className="actions">
                <SubmitButton pendingLabel="Attaching…">Attach them</SubmitButton>
              </div>
            </form>

            <form action={attachPerson} noValidate style={{ marginTop: '1.25rem' }}>
              <input type="hidden" name="reference" value={incident.incidentNumber} />
              <Field
                name="citizenPcid"
                id="attach-pcid"
                label="Record who somebody at the scene is"
                hint="Their Plateau Citizen ID. This records the identification, with your name and the time."
                required
                maxLength={20}
              />
              <Select
                name="role"
                id="attach-person-role"
                label="They are the"
                options={PERSON_ROLES}
                required
              />
              <TextArea name="note" id="attach-person-note" label="Note" maxLength={1000} />
              <div className="actions">
                <SubmitButton pendingLabel="Recording…">Record this</SubmitButton>
              </div>
            </form>
          </>
        )}
      </section>

      <section className="card" aria-labelledby="timeline-heading">
        <div className="card-header">
          <h2 id="timeline-heading">What has happened</h2>
        </div>
        {incident.timeline.length === 0 ? (
          <Empty>Nothing recorded yet.</Empty>
        ) : (
          <ul className="timeline">
            {incident.timeline.map((entry, index) => (
              <li key={`${entry.occurredAt}-${index}`}>
                {entry.summary}
                <span className="muted small">{formatDateTime(entry.occurredAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!finishable || !can(session, 'INCIDENT_CLOSE') ? null : (
        <section className="card" aria-labelledby="close-heading">
          <div className="card-header">
            <h3 id="close-heading">Finish with this incident</h3>
          </div>
          <p>
            Resolving it records that the job is done and ends the access it was granting to the
            people on it. Closing it afterwards is the last act; there is nothing separate to revoke
            and nothing to forget.
          </p>
          <form action={updateIncidentStatus} noValidate>
            <input type="hidden" name="reference" value={incident.incidentNumber} />
            <TextArea
              name="note"
              id="close-note"
              label="How it ended"
              hint="What was done and what happened to the people involved."
              maxLength={2000}
            />
            <div className="step-actions">
              {!live ? null : (
                <SubmitButton name="status" value="RESOLVED" pendingLabel="Recording…">
                  Resolved
                </SubmitButton>
              )}
              <SubmitButton
                className="button button-danger"
                name="status"
                value="CLOSED"
                pendingLabel="Closing…"
              >
                Close it
              </SubmitButton>
            </div>
          </form>
        </section>
      )}
    </>
  );
}

function sentence(value: string): string {
  const words = value.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
