import { Badge, Empty, Notice } from '@pcid/portal-kit/components';
import { formatDateTime } from '@pcid/portal-kit/format';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/chrome';
import { callApi, dataOr } from '@/lib/api';
import { can, readSession } from '@/lib/session';
import type { BreakGlassGrant, IncidentSummary, ResponseUnit } from '@/lib/types';
import { incidentStatusTone, severityTone } from '@/lib/vocabulary';

export const metadata: Metadata = { title: 'Board' };

const SEVERITY_WORD: Record<string, string> = {
  CRITICAL: 'Life at risk now',
  HIGH: 'Serious',
  MEDIUM: 'Needs attending',
  LOW: 'No immediate danger',
};

/**
 * The board.
 *
 * Read across a control room and on a tablet in a vehicle, so it is a list of
 * rows rather than a grid of cards, the severity is said in words as well as
 * shown in colour, and the most urgent thing is at the top without anybody
 * having to sort it.
 */
export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const session = await readSession();

  const [live, units, reviews] = await Promise.all([
    can(session, 'INCIDENT_VIEW')
      ? callApi<{ incidents: IncidentSummary[]; total: number }>(
          '/api/v1/incidents?activeOnly=true&limit=25',
        )
      : null,
    can(session, 'RESPONSE_UNIT_VIEW') ? callApi<ResponseUnit[]>('/api/v1/response-units') : null,
    can(session, 'BREAK_GLASS_REVIEW')
      ? callApi<BreakGlassGrant[]>('/api/v1/break-glass/review-queue')
      : null,
  ]);

  const incidents = dataOr(live, { incidents: [], total: 0 }).incidents;
  const fleet = dataOr(units, []);
  const due = dataOr(reviews, []);
  const available = fleet.filter((unit) => unit.status === 'AVAILABLE');
  const outOnJobs = fleet.filter((unit) =>
    ['DISPATCHED', 'EN_ROUTE', 'ON_SCENE'].includes(unit.status),
  );
  const critical = incidents.filter((incident) => incident.severity === 'CRITICAL');
  const unresourced = incidents.filter((incident) => incident.firstDispatchedAt === null);

  return (
    <>
      <PageHeader
        title={`Good ${partOfDay()}, ${firstName(session?.displayName ?? '')}`}
        lead={session?.agencyName === null ? undefined : `On duty for ${session?.agencyName}.`}
      />

      {params['passphrase-changed'] === '1' ? (
        <Notice tone="ok" title="Your passphrase has been changed" live>
          Every other session for this account has ended.
        </Notice>
      ) : null}

      {due.length === 0 ? null : (
        <Notice
          tone="warn"
          title={`${due.length} break-glass review${due.length === 1 ? '' : 's'} due`}
        >
          <p style={{ marginBottom: 0 }}>
            Emergency access creates a review obligation the moment it is used, due within 24 hours.{' '}
            <Link href="/authorisation#reviews">Work the queue</Link>.
          </p>
        </Notice>
      )}

      {live === null ? null : (
        <div className="tiles">
          <div className="tile">
            <span className="count">{incidents.length}</span>
            Live incidents
          </div>
          <div className="tile">
            <span className="count">{critical.length}</span>
            Life at risk now
          </div>
          <div className="tile">
            <span className="count">{unresourced.length}</span>
            Nothing sent yet
          </div>
          {units === null ? null : (
            <div className="tile">
              <span className="count">{available.length}</span>
              Units available, {outOnJobs.length} out
            </div>
          )}
        </div>
      )}

      {live === null ? (
        <Notice tone="warn" title="Your account does not work incidents">
          <p style={{ marginBottom: 0 }}>
            That is not a fault. A fleet office manages vehicles and crews and holds no entitlement
            to anybody&rsquo;s record — see <Link href="/units">Units</Link>.
          </p>
        </Notice>
      ) : (
        <section className="card" aria-labelledby="board-heading">
          <div className="card-header">
            <h2 id="board-heading">Live now</h2>
            <Badge tone="muted">Most urgent first</Badge>
          </div>
          {incidents.length === 0 ? (
            <Empty>Nothing live. The board is clear.</Empty>
          ) : (
            <ul className="board">
              {[...incidents].sort(byUrgency).map((incident) => (
                <li
                  key={incident.incidentNumber}
                  className={
                    incident.severity === 'CRITICAL'
                      ? 'critical'
                      : incident.severity === 'HIGH'
                        ? 'high'
                        : ''
                  }
                >
                  <span className="headline">
                    <Link href={`/incidents/${encodeURIComponent(incident.incidentNumber)}`}>
                      {incident.description}
                    </Link>
                  </span>
                  <span>
                    <Badge tone={severityTone(incident.severity)}>
                      {SEVERITY_WORD[incident.severity] ?? incident.severity}
                    </Badge>{' '}
                    <Badge tone={incidentStatusTone(incident.status)}>
                      {incident.status === 'REPORTED' ? 'Nothing sent' : label(incident.status)}
                    </Badge>
                  </span>
                  <span className="where">
                    <span className="mono">{incident.incidentNumber}</span> ·{' '}
                    {incident.address ?? incident.lgaCode ?? 'Location not given'} · reported{' '}
                    {formatDateTime(incident.reportedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {units === null ? null : (
        <section className="card" aria-labelledby="available-heading">
          <div className="card-header">
            <h2 id="available-heading">Units available</h2>
            <Badge tone={available.length === 0 ? 'danger' : 'ok'}>{available.length}</Badge>
          </div>
          {available.length === 0 ? (
            <Empty>
              Nothing is available. Every unit is out, off the run, or has not been put into
              service.
            </Empty>
          ) : (
            <div className="stack">
              {available.slice(0, 8).map((unit) => (
                <div className="unit" key={unit.unitCode}>
                  <span className="code">{unit.unitCode}</span>
                  <span>{label(unit.type)}</span>
                  <span className="muted small">{unit.homeLgaCode ?? '—'}</span>
                </div>
              ))}
            </div>
          )}
          <p className="muted small" style={{ marginBottom: 0 }}>
            The only live positions the platform holds are units&rsquo; own, reported by the unit
            about itself. There is no citizen equivalent and nothing here creates one.
          </p>
        </section>
      )}
    </>
  );
}

const URGENCY: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

function byUrgency(a: IncidentSummary, b: IncidentSummary): number {
  const bySeverity = (URGENCY[a.severity] ?? 9) - (URGENCY[b.severity] ?? 9);
  if (bySeverity !== 0) return bySeverity;
  // Then whatever has had nothing sent to it, then oldest first: a call that has
  // been waiting is more urgent than one that just came in at the same severity.
  const aWaiting = a.firstDispatchedAt === null ? 0 : 1;
  const bWaiting = b.firstDispatchedAt === null ? 0 : 1;
  if (aWaiting !== bWaiting) return aWaiting - bWaiting;
  return a.reportedAt.localeCompare(b.reportedAt);
}

function label(value: string): string {
  const words = value.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function firstName(displayName: string): string {
  return displayName.split(/\s+/)[0] ?? 'there';
}

function partOfDay(): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-NG', { hour: 'numeric', hour12: false, timeZone: 'Africa/Lagos' })
      .format(new Date())
      .replace(/\D/g, ''),
  );
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}
