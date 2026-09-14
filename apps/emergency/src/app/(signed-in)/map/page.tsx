import { Badge, Empty, Notice } from '@pcid/portal-kit/components';
import { formatDateTime } from '@pcid/portal-kit/format';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/chrome';
import { callApi } from '@/lib/api';
import { confidence, plotFor } from '@/lib/plot';
import type { SituationView } from '@/lib/types';
import { incidentStatusTone, severityTone, unitStatusTone } from '@/lib/vocabulary';

export const metadata: Metadata = { title: 'Map' };

const SEVERITY_WORD: Record<string, string> = {
  CRITICAL: 'Life at risk now',
  HIGH: 'Serious',
  MEDIUM: 'Needs attending',
  LOW: 'No immediate danger',
};

/**
 * The command picture (§16, §35).
 *
 * Three things about it that are decisions rather than limitations.
 *
 * **There is no basemap, and there will not be one from a tile provider.** Every
 * tile a browser fetches tells the provider which rectangle of Plateau State
 * somebody in a control room is looking at, several times a minute. Over a shift
 * that is a description of where the state's emergencies are, delivered to a
 * company under no obligation to anybody here. The portal's content-security
 * policy forbids every external origin, so this is enforced rather than
 * intended. What is drawn instead is what the platform actually holds: the
 * positions, a graticule, and a scale bar.
 *
 * **Nothing on it is inferred.** An incident reported by address has no
 * coordinate, and it is listed beside the picture rather than placed at the
 * centre of its local government. A pin that was guessed at is a pin somebody
 * sends a unit to.
 *
 * **The table is not a fallback.** A scatter of marks is unreadable to a screen
 * reader and to anybody who cannot tell one colour from another, so everything
 * on the picture is also below it, in order of urgency, with the severity in
 * words.
 */
export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string): string | undefined =>
    typeof params[key] === 'string' && params[key] !== '' ? (params[key] as string) : undefined;

  const view = ['north', 'south', 'east', 'west'].every((corner) => one(corner) !== undefined)
    ? `?north=${one('north')}&south=${one('south')}&east=${one('east')}&west=${one('west')}`
    : '';

  const result = await callApi<SituationView>(`/api/v1/map/situation${view}`);

  if (!result.ok) {
    return (
      <>
        <PageHeader title="The command picture is not open to you" />
        <Notice tone="danger" title="No layer of this map is available to this account">
          <p>{result.error.message}</p>
          <p className="small muted" style={{ marginBottom: 0 }}>
            The map is composed of layers, each authorised on its own: incidents for an account that
            may see incidents, the fleet for one that may see the fleet. An account holding neither
            is told nothing at all, including whether there is anything to see. Reference{' '}
            <span className="mono">{result.error.correlationId}</span>.
          </p>
        </Notice>
      </>
    );
  }

  const situation = result.data;
  const extent = situation.extent;
  const plot = extent === null ? null : plotFor(extent);
  const incidents = [...situation.incidents].sort(byUrgency);

  return (
    <>
      <PageHeader
        title="Map"
        lead="Where the live incidents are, and where the units last said they were."
      />

      <div className="tiles">
        <div className="tile">
          <span className="count">{situation.incidents.length}</span>
          Incidents on the picture
        </div>
        <div className="tile">
          <span className="count">{situation.units.length}</span>
          Units reporting a position
        </div>
        <div className="tile">
          <span className="count">{situation.withoutPosition.length}</span>
          Live, with no coordinate
        </div>
      </div>

      {situation.layers.includes('INCIDENTS') ? null : (
        <Notice tone="warn" title="This picture has no incidents on it">
          <p style={{ marginBottom: 0 }}>
            Your account may see the fleet and not the incidents, so what is drawn below is the
            units and nothing else. That is not an empty state: it is a layer you do not hold.
          </p>
        </Notice>
      )}

      <section className="card" aria-labelledby="picture-heading">
        <div className="card-header">
          <h2 id="picture-heading">The picture</h2>
          {extent === null ? null : (
            <Badge tone="muted">
              {extent.south.toFixed(2)}–{extent.north.toFixed(2)}°N, {extent.west.toFixed(2)}–
              {extent.east.toFixed(2)}°E
            </Badge>
          )}
        </div>

        {plot === null || extent === null ? (
          <Empty>
            Nothing on the picture. Either nothing is live, or nothing that is live has reported a
            position.
          </Empty>
        ) : (
          <div className="plot">
            <svg
              viewBox={`0 0 ${plot.width} ${plot.height}`}
              role="img"
              aria-labelledby="plot-title plot-description"
              preserveAspectRatio="xMidYMid meet"
            >
              <title id="plot-title">
                {`Positions of ${situation.incidents.length} live incidents and ${situation.units.length} response units`}
              </title>
              <desc id="plot-description">
                A plot of reported positions with no background map. Everything shown here is listed
                in the tables below, in order of urgency.
              </desc>

              <rect x="0" y="0" width={plot.width} height={plot.height} className="plot-ground" />

              {/* A graticule, so the picture has a sense of scale even before the bar. */}
              {graticule(extent).map((line) => (
                <g key={`${line.orientation}-${line.value}`}>
                  {line.orientation === 'latitude' ? (
                    <line
                      x1="0"
                      x2={plot.width}
                      y1={plot.place({ latitude: line.value, longitude: extent.west })?.y ?? 0}
                      y2={plot.place({ latitude: line.value, longitude: extent.west })?.y ?? 0}
                      className="plot-grid"
                    />
                  ) : (
                    <line
                      y1="0"
                      y2={plot.height}
                      x1={plot.place({ latitude: extent.south, longitude: line.value })?.x ?? 0}
                      x2={plot.place({ latitude: extent.south, longitude: line.value })?.x ?? 0}
                      className="plot-grid"
                    />
                  )}
                </g>
              ))}

              {situation.units.map((unit) => {
                const at = plot.place(unit.position);
                if (at === null) return null;
                return (
                  <g
                    key={unit.unitCode}
                    className={`plot-unit plot-unit-${unit.status.toLowerCase()}`}
                  >
                    {/* A square for a unit, a circle for an incident: the shapes
                        differ so the picture reads without colour. */}
                    <rect x={at.x - 9} y={at.y - 9} width="18" height="18" rx="3" />
                    <text x={at.x + 14} y={at.y + 5}>
                      {unit.unitCode}
                    </text>
                  </g>
                );
              })}

              {incidents.map((incident) => {
                const at = plot.place(incident.position);
                if (at === null) return null;
                return (
                  <g
                    key={incident.incidentNumber}
                    className={`plot-incident plot-${incident.severity.toLowerCase()}`}
                  >
                    {incident.awaitingDispatch ? (
                      <circle cx={at.x} cy={at.y} r="20" className="plot-halo" />
                    ) : null}
                    <circle cx={at.x} cy={at.y} r={incident.severity === 'CRITICAL' ? 13 : 10} />
                    <text x={at.x + 18} y={at.y + 5}>
                      {incident.incidentNumber.replace(/^INC-\d{4}-/, '')}
                    </text>
                  </g>
                );
              })}

              <g className="plot-scale">
                <line
                  x1="24"
                  x2={24 + plot.scaleBar.width}
                  y1={plot.height - 28}
                  y2={plot.height - 28}
                />
                <line x1="24" x2="24" y1={plot.height - 34} y2={plot.height - 22} />
                <line
                  x1={24 + plot.scaleBar.width}
                  x2={24 + plot.scaleBar.width}
                  y1={plot.height - 34}
                  y2={plot.height - 22}
                />
                <text x="24" y={plot.height - 40}>
                  {plot.scaleBar.kilometres} km
                </text>
              </g>
            </svg>
          </div>
        )}

        <p className="muted small" style={{ marginBottom: 0 }}>
          There is no background map here, and there will not be one from a tile provider. Every
          tile a browser fetched would tell that provider which rectangle of Plateau State a control
          room is looking at, several times a minute — which over a shift is a description of where
          the state&rsquo;s emergencies are, given to a company under no obligation to anybody here.
        </p>
      </section>

      <section className="card" aria-labelledby="incidents-heading">
        <div className="card-header">
          <h2 id="incidents-heading">Everything on the picture</h2>
          <Badge tone="muted">Most urgent first</Badge>
        </div>
        <p className="muted small">
          This is not a fallback. A scatter of marks is unreadable to a screen reader and to anybody
          who cannot tell one colour from another, so everything on the picture is here as well.
        </p>

        {incidents.length === 0 ? (
          <Empty>No incident on the picture.</Empty>
        ) : (
          <div className="table-scroll">
            <table>
              <caption className="visually-hidden">Live incidents with a reported position</caption>
              <thead>
                <tr>
                  <th scope="col">Incident</th>
                  <th scope="col">What happened</th>
                  <th scope="col">Severity</th>
                  <th scope="col">Position</th>
                  <th scope="col">Sent</th>
                </tr>
              </thead>
              <tbody>
                {incidents.map((incident) => (
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
                        {incident.address ?? incident.lgaCode ?? 'Location not given'} · reported{' '}
                        {formatDateTime(incident.reportedAt)}
                      </span>
                    </td>
                    <td>
                      <Badge tone={severityTone(incident.severity)}>
                        {SEVERITY_WORD[incident.severity] ?? incident.severity}
                      </Badge>{' '}
                      <Badge tone={incidentStatusTone(incident.status)}>
                        {sentence(incident.status)}
                      </Badge>
                    </td>
                    <td>
                      <span className="mono small">
                        {incident.position.latitude.toFixed(4)},{' '}
                        {incident.position.longitude.toFixed(4)}
                      </span>
                      <br />
                      <span className="muted small">{confidence(incident.position)}</span>
                    </td>
                    <td>
                      {incident.awaitingDispatch ? (
                        <Badge tone="danger">Nothing sent</Badge>
                      ) : (
                        `${incident.unitsSent} ${incident.unitsSent === 1 ? 'unit' : 'units'}`
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {situation.withoutPosition.length === 0 ? null : (
        <section className="card" aria-labelledby="unplaced-heading">
          <div className="card-header">
            <h2 id="unplaced-heading">Live, and not on the picture</h2>
            <Badge tone="warn">{situation.withoutPosition.length}</Badge>
          </div>
          <p>
            These were reported by address or by description, and nobody gave a coordinate. They are
            here rather than on the map because placing them would mean choosing a point, and a
            point somebody chose is a point a crew drives to.
          </p>
          <div className="table-scroll">
            <table>
              <caption className="visually-hidden">
                Live incidents with no reported position
              </caption>
              <thead>
                <tr>
                  <th scope="col">Incident</th>
                  <th scope="col">What happened</th>
                  <th scope="col">Severity</th>
                  <th scope="col">Where, as given</th>
                </tr>
              </thead>
              <tbody>
                {situation.withoutPosition.map((incident) => (
                  <tr key={incident.incidentNumber}>
                    <td className="mono">
                      <Link href={`/incidents/${encodeURIComponent(incident.incidentNumber)}`}>
                        {incident.incidentNumber}
                      </Link>
                    </td>
                    <td>{incident.description}</td>
                    <td>
                      <Badge tone={severityTone(incident.severity)}>
                        {SEVERITY_WORD[incident.severity] ?? incident.severity}
                      </Badge>
                    </td>
                    <td>{incident.address ?? incident.lgaCode ?? 'Not given'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!situation.layers.includes('UNITS') ? null : (
        <section className="card" aria-labelledby="units-heading">
          <div className="card-header">
            <h2 id="units-heading">Units on the picture</h2>
            <Badge tone="muted">{situation.units.length}</Badge>
          </div>
          {situation.units.length === 0 ? (
            <Empty>
              No unit has reported a position. Control can only send the nearest thing to a call if
              the crews say where they are.
            </Empty>
          ) : (
            <div className="table-scroll">
              <table>
                <caption className="visually-hidden">
                  Response units with a reported position
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Unit</th>
                    <th scope="col">What it is</th>
                    <th scope="col">Status</th>
                    <th scope="col">Last said it was</th>
                  </tr>
                </thead>
                <tbody>
                  {situation.units.map((unit) => (
                    <tr key={unit.unitCode}>
                      <td className="mono">{unit.unitCode}</td>
                      <td>{sentence(unit.type)}</td>
                      <td>
                        <Badge tone={unitStatusTone(unit.status)}>{sentence(unit.status)}</Badge>
                      </td>
                      <td>
                        <span className="mono small">
                          {unit.position.latitude.toFixed(4)}, {unit.position.longitude.toFixed(4)}
                        </span>
                        <br />
                        <span className="muted small">
                          {unit.position.reportedAt == null
                            ? 'Time not recorded'
                            : formatDateTime(unit.position.reportedAt)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <Notice title="There is no layer here that could show a person">
        <p style={{ marginBottom: 0 }}>
          The only live positions the platform holds are units&rsquo;, reported by the unit about
          itself. An incident&rsquo;s coordinate is an observation about an event, stored with how
          it was obtained and with a date it is deleted. Nothing in the platform can locate a
          person, and nothing on this page is the beginning of it.
        </p>
      </Notice>
    </>
  );
}

const URGENCY: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

function byUrgency(
  a: { severity: string; awaitingDispatch: boolean; reportedAt: string },
  b: { severity: string; awaitingDispatch: boolean; reportedAt: string },
): number {
  const bySeverity = (URGENCY[a.severity] ?? 9) - (URGENCY[b.severity] ?? 9);
  if (bySeverity !== 0) return bySeverity;
  if (a.awaitingDispatch !== b.awaitingDispatch) return a.awaitingDispatch ? -1 : 1;
  return a.reportedAt.localeCompare(b.reportedAt);
}

/**
 * Where to draw the grid lines.
 *
 * A round number of degrees, at whatever interval gives four or five lines. The
 * graticule is not decoration: without it the picture has no orientation at all,
 * and a controller cannot say whether two pins are a street apart or a district.
 */
function graticule(extent: {
  north: number;
  south: number;
  east: number;
  west: number;
}): { orientation: 'latitude' | 'longitude'; value: number }[] {
  const lines: { orientation: 'latitude' | 'longitude'; value: number }[] = [];
  for (const [orientation, from, to] of [
    ['latitude', extent.south, extent.north],
    ['longitude', extent.west, extent.east],
  ] as const) {
    const step = niceStep(to - from);
    for (let value = Math.ceil(from / step) * step; value <= to; value += step) {
      lines.push({ orientation, value: Number(value.toFixed(6)) });
    }
  }
  return lines;
}

function niceStep(span: number): number {
  const target = span / 4;
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(target, 1e-6)));
  for (const step of [1, 2, 5, 10]) {
    if (target <= step * magnitude) return step * magnitude;
  }
  return 10 * magnitude;
}

function sentence(value: string): string {
  const words = value.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
