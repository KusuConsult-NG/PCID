import { Badge, Empty, Field, Notice, Select, SubmitButton } from '@pcid/portal-kit/components';
import { formatDateTime } from '@pcid/portal-kit/format';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/chrome';
import { ReportPosition } from '@/components/report-position';
import { callApi, dataOr } from '@/lib/api';
import { can, readSession } from '@/lib/session';
import type { ResponseUnit } from '@/lib/types';
import { UNIT_TYPES, unitStatusTone } from '@/lib/vocabulary';

import { registerUnit, reportPosition, setUnitService } from './actions';

export const metadata: Metadata = { title: 'Units' };

/** Statuses a fleet office sets. The rest belong to the job the unit is on. */
const OUT_ON_A_JOB = ['DISPATCHED', 'EN_ROUTE', 'ON_SCENE'];

export default async function UnitsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string): string | undefined =>
    typeof params[key] === 'string' && params[key] !== '' ? (params[key] as string) : undefined;

  const session = await readSession();
  const mayManage = can(session, 'RESPONSE_UNIT_MANAGE');
  const maySee = can(session, 'RESPONSE_UNIT_VIEW');
  const mayReport = can(session, 'DISPATCH_UPDATE');

  const result = maySee ? await callApi<ResponseUnit[]>('/api/v1/response-units') : null;
  const fleet = dataOr(result, []);

  return (
    <>
      <PageHeader
        title="Units"
        lead="The vehicles and crews, what each is doing, and where each last said it was."
      />

      {one('error') === undefined ? null : (
        <Notice tone="danger" title="That could not be done" live>
          {one('error') === 'code'
            ? 'Give the unit a code.'
            : one('error') === 'duplicate'
              ? 'A unit is already registered under that code.'
              : one('error') === 'onajob'
                ? (one('message') ??
                  'That unit is out on a job. Stand it down from the incident rather than from here.')
                : one('error') === 'position'
                  ? 'A position needs the unit and both coordinates.'
                  : (one('message') ?? 'Please try again.')}
        </Notice>
      )}
      {one('registered') === undefined ? null : (
        <Notice tone="ok" title={`${one('registered')} is registered`} live>
          Put it into service when it is crewed and ready.
        </Notice>
      )}
      {one('service') === undefined ? null : (
        <Notice
          tone="ok"
          title={one('service') === 'AVAILABLE' ? 'In service' : 'Out of service'}
          live
        >
          {one('service') === 'AVAILABLE'
            ? 'It will now appear to control as available to send.'
            : 'Control will not be offered it.'}
        </Notice>
      )}
      {one('position') === undefined ? null : (
        <Notice tone="ok" title={`${one('position')} reported its position`} live>
          Control can now offer it to the nearest call.
        </Notice>
      )}

      {!maySee ? (
        <Notice tone="warn" title="Your account does not see the fleet">
          Ask your agency administrator for the role your work needs.
        </Notice>
      ) : (
        <section className="card" aria-labelledby="fleet-heading">
          <div className="card-header">
            <h2 id="fleet-heading">
              {fleet.length} {fleet.length === 1 ? 'unit' : 'units'}
            </h2>
            <Badge tone="muted">
              {fleet.filter((unit) => unit.status === 'AVAILABLE').length} available
            </Badge>
          </div>

          {fleet.length === 0 ? (
            <Empty>Nothing is registered.</Empty>
          ) : (
            <div className="stack">
              {fleet.map((unit) => (
                <div className="card" key={unit.unitCode} style={{ boxShadow: 'none' }}>
                  <div className="unit" style={{ border: 0, padding: 0 }}>
                    <span className="code">{unit.unitCode}</span>
                    <span>{sentence(unit.type)}</span>
                    <Badge tone={unitStatusTone(unit.status)}>{sentence(unit.status)}</Badge>
                  </div>
                  <dl className="facts">
                    <dt>Based</dt>
                    <dd>{unit.homeLgaCode ?? '—'}</dd>
                    <dt>Can do</dt>
                    <dd>
                      {unit.capabilities.length === 0
                        ? '—'
                        : unit.capabilities.map(sentence).join(', ')}
                    </dd>
                    <dt>Contact</dt>
                    <dd className="mono">{unit.contactPhone ?? '—'}</dd>
                    <dt>Last said it was</dt>
                    <dd>
                      {unit.position === null ? (
                        'It has not reported a position'
                      ) : (
                        <>
                          {unit.position.latitude}, {unit.position.longitude}
                          <br />
                          <span className="muted small">
                            Reported by the unit, {formatDateTime(unit.position.reportedAt)}
                          </span>
                        </>
                      )}
                    </dd>
                  </dl>

                  {!mayManage ? null : OUT_ON_A_JOB.includes(unit.status) ? (
                    <p className="muted small" style={{ marginBottom: 0 }}>
                      Out on a job. A fleet screen cannot move it — stand it down from the incident,
                      where somebody knows whether it is true.
                    </p>
                  ) : (
                    <form action={setUnitService}>
                      <input type="hidden" name="unitCode" value={unit.unitCode} />
                      <div className="actions">
                        <SubmitButton
                          className="button button-secondary"
                          name="status"
                          value={unit.status === 'AVAILABLE' ? 'OFFLINE' : 'AVAILABLE'}
                          pendingLabel="Saving…"
                        >
                          {unit.status === 'AVAILABLE' ? 'Take out of service' : 'Put into service'}
                        </SubmitButton>
                      </div>
                    </form>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {!mayReport ? null : (
        <section className="card" id="position" aria-labelledby="position-heading">
          <div className="card-header">
            <h2 id="position-heading">Report where we are</h2>
          </div>
          <p>
            So control can send the nearest thing to the next call. This is the unit reporting about
            itself, and it is the only live position the platform holds — there is no citizen
            equivalent and nothing here is the beginning of one.
          </p>
          <form action={reportPosition} noValidate>
            <Field
              name="unitCode"
              id="position-unit"
              label="Which unit"
              defaultValue={session?.workingUnit ?? ''}
              required
              maxLength={32}
            />
            <ReportPosition />
            <Field name="latitude" id="position-lat" label="Latitude" maxLength={16} />
            <Field name="longitude" id="position-lon" label="Longitude" maxLength={16} />
            <div className="step-actions">
              <SubmitButton pendingLabel="Reporting…">Report our position</SubmitButton>
            </div>
          </form>
        </section>
      )}

      {!mayManage ? null : (
        <section className="card" id="register" aria-labelledby="register-heading">
          <div className="card-header">
            <h2 id="register-heading">Register a unit</h2>
          </div>
          <p>
            A unit is a vehicle and a crew. Nothing on this form is anybody&rsquo;s personal
            information, which is why an account that manages the fleet can hold no entitlement to
            the register at all and still do this work.
          </p>
          <form action={registerUnit} noValidate>
            <Field
              name="unitCode"
              label="Unit code"
              hint="How control will call it. For example AMB-JOS-01."
              required
              maxLength={32}
            />
            <Select name="type" label="What it is" options={UNIT_TYPES} required />
            <Field name="homeLgaCode" label="Based in which LGA" maxLength={16} />
            <Field name="homeWardCode" label="Ward code" maxLength={24} />
            <Field
              name="capabilities"
              label="What it can do"
              hint="Separated by commas — for example paramedic, defibrillator, extrication."
              maxLength={400}
            />
            <Field
              name="contactPhone"
              label="Crew telephone"
              type="tel"
              inputMode="tel"
              maxLength={32}
            />
            <Select
              name="status"
              label="In service now"
              options={[
                { value: 'OFFLINE', label: 'No — not yet crewed' },
                { value: 'AVAILABLE', label: 'Yes — crewed and ready' },
              ]}
              required
            />
            <div className="actions">
              <SubmitButton pendingLabel="Registering…">Register this unit</SubmitButton>
            </div>
          </form>
          <p className="muted small" style={{ marginBottom: 0 }}>
            There is no position field here. Where a unit is, is something the unit says — see{' '}
            {mayReport ? (
              <Link href="#position">Report where we are</Link>
            ) : (
              'the crew’s own screen'
            )}
            .
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
