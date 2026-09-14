import { Injectable } from '@nestjs/common';
import type { IncidentSeverity, IncidentStatus } from '@pcid/contracts';
import { ACTIVE_INCIDENT_STATUSES } from '@pcid/contracts';

import { AppError } from '../common/errors';
import type { RequestContext } from '../common/correlation';
import { extentOf, isValidBox } from '../common/geography';
import type { BoundingBox } from '../common/geography';
import { Database } from '../database/pool';
import type { AuthenticatedActor } from '../iam/actor';
import { PolicyService } from '../policy/policy.service';

/** Codes the engine answers a refusal with. Anything else is a real failure. */
const REFUSALS: ReadonlySet<string> = new Set([
  'NOT_FOUND_OR_NOT_PERMITTED',
  'ACCESS_DENIED',
  'CASE_REFERENCE_REQUIRED',
  'INCIDENT_REFERENCE_REQUIRED',
  'APPROVAL_REQUIRED',
  'STEP_UP_REQUIRED',
  'MFA_REQUIRED',
]);

export interface SituationView {
  readonly extent: BoundingBox | null;
  readonly incidents: readonly Record<string, unknown>[];
  readonly units: readonly Record<string, unknown>[];
  /** Live incidents with no coordinate at all, which a map must not invent one for. */
  readonly withoutPosition: readonly Record<string, unknown>[];
  readonly layers: readonly string[];
}

/**
 * The command map's picture (master system prompt §16, §35).
 *
 * Three positions this takes, and they are the whole design.
 *
 * **It plots only what somebody reported.** An incident that was called in by
 * address has no coordinate, and it appears in a list beside the map rather
 * than at a guessed point. A command map that quietly placed it at the centre
 * of its LGA would be a map that invents precision, and somebody would send a
 * unit to the pin.
 *
 * **There is no citizen layer, and there is no function here that could take
 * one.** The only live positions the platform holds are units', reported by the
 * unit about itself. This service reads incidents and units and nothing else
 * (§16, §64).
 *
 * **Each layer is authorised separately.** A dispatcher sees incidents and the
 * fleet; an account holding only `RESPONSE_UNIT_VIEW` sees the fleet and no
 * incidents. The response says which layers it contains, so the map can say
 * what it is not showing rather than looking empty.
 */
@Injectable()
export class MapService {
  constructor(
    private readonly db: Database,
    private readonly policy: PolicyService,
  ) {}

  async situation(
    actor: AuthenticatedActor,
    box: BoundingBox | null,
    context: RequestContext,
  ): Promise<SituationView> {
    if (box !== null && !isValidBox(box)) {
      throw AppError.validation(
        'That is not a map view: a bounding box must be ordered, on the planet, and smaller than half of it.',
      );
    }

    const incidentsAllowed = await this.permits(actor, 'INCIDENT_VIEW', context);
    const unitsAllowed = await this.permits(actor, 'RESPONSE_UNIT_VIEW', context);
    if (!incidentsAllowed && !unitsAllowed) {
      throw AppError.notFoundOrNotPermitted('no map layer is available to this account');
    }

    const [incidents, units, withoutPosition] = await Promise.all([
      incidentsAllowed ? this.liveIncidents(actor, box) : Promise.resolve([]),
      unitsAllowed ? this.units(box) : Promise.resolve([]),
      incidentsAllowed ? this.liveIncidentsWithoutPosition(actor) : Promise.resolve([]),
    ]);

    const layers = [...(incidentsAllowed ? ['INCIDENTS'] : []), ...(unitsAllowed ? ['UNITS'] : [])];

    return {
      // The extent is computed from what is actually on the picture, so a map
      // opened with no view shows everything that is happening rather than a
      // rectangle somebody chose once.
      extent:
        box ??
        extentOf([
          ...incidents.map((entry) => entry.position as { latitude: number; longitude: number }),
          ...units.map((entry) => entry.position as { latitude: number; longitude: number }),
        ]),
      incidents,
      units,
      withoutPosition,
      layers,
    };
  }

  /**
   * Whether a layer is open to this account.
   *
   * Asked through `authorize`, not `evaluateOnly`, so both answers are audited:
   * "who looked at the command picture, and what was on it" has to be
   * answerable, and a refused layer is as much part of that answer as a
   * released one. A denial becomes an absent layer rather than a failed
   * request, because a map is a composition — an account entitled to the fleet
   * and not to incidents should see the fleet, not an error.
   *
   * Only an authorisation refusal is turned into `false`. Anything else - a
   * database error, a rate limit - is a real failure and is left to propagate,
   * so a broken layer never looks like an empty one.
   */
  private async permits(
    actor: AuthenticatedActor,
    action: 'INCIDENT_VIEW' | 'RESPONSE_UNIT_VIEW',
    context: RequestContext,
  ): Promise<boolean> {
    try {
      await this.policy.authorize({
        actor,
        action,
        purpose: 'EMERGENCY_RESPONSE',
        resource: {
          type: action === 'INCIDENT_VIEW' ? 'INCIDENT' : 'RESPONSE_UNIT',
          id: null,
          classification: action === 'INCIDENT_VIEW' ? 'CONFIDENTIAL' : 'INTERNAL',
          subjectPcid: null,
        },
        context,
        auditDetail: { surface: 'COMMAND_MAP' },
      });
      return true;
    } catch (error) {
      if (error instanceof AppError && REFUSALS.has(error.code)) return false;
      throw error;
    }
  }

  private async liveIncidents(
    actor: AuthenticatedActor,
    box: BoundingBox | null,
  ): Promise<Record<string, unknown>[]> {
    const values: unknown[] = [[...ACTIVE_INCIDENT_STATUSES]];
    let bounds = '';
    if (box !== null) {
      // The bounding box goes in the WHERE clause rather than into a distance
      // computed over every row, so the index 0013 adds is usable. This is the
      // difference between a map that opens and one that times out at statewide
      // volumes.
      values.push(box.south, box.north, box.west, box.east);
      bounds = ` AND i.latitude BETWEEN $2 AND $3 AND i.longitude BETWEEN $4 AND $5`;
    }
    const jurisdiction = actor.subject.jurisdiction;
    if (jurisdiction.scope === 'LGA' && jurisdiction.lgaCodes.length > 0) {
      values.push(jurisdiction.lgaCodes);
      bounds += ` AND (i.lga_code IS NULL OR i.lga_code = ANY($${values.length}::text[]))`;
    }

    const rows = await this.db.query<IncidentPin>(
      `SELECT i.incident_number, i.type, i.severity, i.status, i.description,
              i.address_text, i.lga_code, i.latitude, i.longitude, i.location_source,
              i.reported_at, i.first_dispatched_at,
              (SELECT count(*) FROM dispatch d WHERE d.incident_id = i.id)::int AS units_sent
         FROM incident i
        WHERE i.status = ANY($1::text[])
          AND i.latitude IS NOT NULL AND i.longitude IS NOT NULL${bounds}
        ORDER BY CASE i.severity
                   WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
                 i.reported_at
        LIMIT 500`,
      values,
    );
    return rows.map(toIncidentPin);
  }

  private async liveIncidentsWithoutPosition(
    actor: AuthenticatedActor,
  ): Promise<Record<string, unknown>[]> {
    const values: unknown[] = [[...ACTIVE_INCIDENT_STATUSES]];
    let bounds = '';
    const jurisdiction = actor.subject.jurisdiction;
    if (jurisdiction.scope === 'LGA' && jurisdiction.lgaCodes.length > 0) {
      values.push(jurisdiction.lgaCodes);
      bounds = ` AND (i.lga_code IS NULL OR i.lga_code = ANY($2::text[]))`;
    }
    const rows = await this.db.query<{
      incident_number: string;
      severity: string;
      status: string;
      description: string;
      address_text: string | null;
      lga_code: string | null;
      reported_at: Date;
    }>(
      `SELECT i.incident_number, i.severity, i.status, i.description, i.address_text,
              i.lga_code, i.reported_at
         FROM incident i
        WHERE i.status = ANY($1::text[])
          AND (i.latitude IS NULL OR i.longitude IS NULL)${bounds}
        ORDER BY i.reported_at DESC
        LIMIT 100`,
      values,
    );
    return rows.map((row) => ({
      incidentNumber: row.incident_number,
      severity: row.severity,
      status: row.status,
      description: row.description,
      address: row.address_text,
      lgaCode: row.lga_code,
      reportedAt: row.reported_at.toISOString(),
      // Said explicitly, because the absence is the point: a map that placed
      // this somewhere would be making it up.
      reason: 'NO_COORDINATE_REPORTED',
    }));
  }

  private async units(box: BoundingBox | null): Promise<Record<string, unknown>[]> {
    const values: unknown[] = [];
    let bounds = '';
    if (box !== null) {
      values.push(box.south, box.north, box.west, box.east);
      bounds = ` AND ru.latitude BETWEEN $1 AND $2 AND ru.longitude BETWEEN $3 AND $4`;
    }
    const rows = await this.db.query<UnitPin>(
      `SELECT ru.unit_code, ru.type, ru.status, ru.home_lga_code,
              ru.latitude, ru.longitude, ru.location_reported_at
         FROM response_unit ru
        WHERE ru.latitude IS NOT NULL AND ru.longitude IS NOT NULL${bounds}
        ORDER BY ru.unit_code
        LIMIT 500`,
      values,
    );
    return rows.map(toUnitPin);
  }
}

interface IncidentPin {
  incident_number: string;
  type: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  description: string;
  address_text: string | null;
  lga_code: string | null;
  latitude: string;
  longitude: string;
  location_source: string | null;
  reported_at: Date;
  first_dispatched_at: Date | null;
  units_sent: number;
}

function toIncidentPin(row: IncidentPin): Record<string, unknown> {
  return {
    incidentNumber: row.incident_number,
    type: row.type,
    severity: row.severity,
    status: row.status,
    description: row.description,
    address: row.address_text,
    lgaCode: row.lga_code,
    position: {
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      // Provenance travels with every coordinate (§16). On a map it decides how
      // much a pin should be trusted: a caller-supplied point is a person
      // describing where they think they are.
      source: row.location_source,
    },
    reportedAt: row.reported_at.toISOString(),
    unitsSent: row.units_sent,
    awaitingDispatch: row.first_dispatched_at === null,
  };
}

interface UnitPin {
  unit_code: string;
  type: string;
  status: string;
  home_lga_code: string | null;
  latitude: string;
  longitude: string;
  location_reported_at: Date | null;
}

function toUnitPin(row: UnitPin): Record<string, unknown> {
  return {
    unitCode: row.unit_code,
    type: row.type,
    status: row.status,
    homeLgaCode: row.home_lga_code,
    position: {
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      source: 'RESPONDER_OBSERVED',
      reportedAt: row.location_reported_at?.toISOString() ?? null,
    },
  };
}
