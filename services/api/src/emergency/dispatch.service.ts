import { Injectable } from '@nestjs/common';
import type { DispatchStatus, ResponseUnitStatus } from '@pcid/contracts';

import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { RequestContext } from '../common/correlation';
import { WhereBuilder } from '../common/sql';
import { Database } from '../database/pool';
import type { AuthenticatedActor } from '../iam/actor';
import { PolicyService } from '../policy/policy.service';
import { IncidentsService } from './incidents.service';

export interface ResponseUnitRow {
  id: string;
  unit_code: string;
  agency_id: string;
  type: string;
  status: ResponseUnitStatus;
  home_lga_code: string | null;
  home_ward_code: string | null;
  latitude: string | null;
  longitude: string | null;
  location_reported_at: Date | null;
  capabilities: string[];
  contact_phone: string | null;
  distance_metres?: string | null;
}

const DISPATCH_TRANSITIONS: Readonly<Record<DispatchStatus, readonly DispatchStatus[]>> =
  Object.freeze({
    ASSIGNED: ['ACKNOWLEDGED', 'EN_ROUTE', 'STOOD_DOWN'],
    ACKNOWLEDGED: ['EN_ROUTE', 'STOOD_DOWN'],
    EN_ROUTE: ['ON_SCENE', 'STOOD_DOWN'],
    ON_SCENE: ['COMPLETED', 'STOOD_DOWN'],
    COMPLETED: [],
    STOOD_DOWN: [],
  });

/**
 * The statuses fleet administration may set.
 *
 * A unit that is out on a job is moved by the dispatch workflow, which knows
 * what is actually happening to it.
 */
const ADMINISTRABLE_UNIT_STATUSES: readonly ResponseUnitStatus[] = Object.freeze([
  'AVAILABLE',
  'OFFLINE',
  'BUSY',
]);

const UNIT_STATUS_FOR_DISPATCH: Readonly<Record<DispatchStatus, ResponseUnitStatus>> =
  Object.freeze({
    ASSIGNED: 'DISPATCHED',
    ACKNOWLEDGED: 'DISPATCHED',
    EN_ROUTE: 'EN_ROUTE',
    ON_SCENE: 'ON_SCENE',
    COMPLETED: 'AVAILABLE',
    STOOD_DOWN: 'AVAILABLE',
  });

/**
 * Dispatch and response-unit management (master system prompt §36, §37).
 *
 * Unit positions here are *unit* positions, reported by the unit's own equipment,
 * and are the only live locations the platform holds. There is no citizen
 * equivalent and this service does not create one (§16, §64).
 *
 * Assigning a unit also assigns its agency to the incident, which is what opens
 * the incident-bound emergency access for the crew attending - and closing the
 * dispatch closes it again.
 */
@Injectable()
export class DispatchService {
  constructor(
    private readonly db: Database,
    private readonly policy: PolicyService,
    private readonly incidents: IncidentsService,
    private readonly audit: AuditService,
  ) {}

  async listUnits(
    actor: AuthenticatedActor,
    filters: {
      status?: ResponseUnitStatus;
      agencyId?: string;
      lgaCode?: string;
      nearIncident?: string;
    },
    context: RequestContext,
  ): Promise<Record<string, unknown>[]> {
    await this.policy.authorize({
      actor,
      action: 'RESPONSE_UNIT_VIEW',
      purpose: 'EMERGENCY_RESPONSE',
      resource: {
        type: 'RESPONSE_UNIT',
        id: null,
        classification: 'INTERNAL',
        subjectPcid: null,
        lgaCode: filters.lgaCode ?? null,
      },
      context,
    });

    const where = new WhereBuilder();
    if (filters.status !== undefined) where.add('ru.status = ?', filters.status);
    if (filters.agencyId !== undefined) where.add('ru.agency_id = ?', filters.agencyId);
    if (filters.lgaCode !== undefined) where.add('ru.home_lga_code = ?', filters.lgaCode);

    if (filters.nearIncident !== undefined) {
      const incident = await this.incidents.findByReference(filters.nearIncident);
      if (incident?.latitude != null && incident.longitude != null) {
        // Only units that could actually be sent, ordered by how far away they are.
        where.add('ru.status = ?', 'AVAILABLE');
        const latIndex = where.next();
        const lonIndex = where.next(2);
        const rows = await this.db.query<ResponseUnitRow>(
          `SELECT ru.*,
                  great_circle_metres(ru.latitude, ru.longitude, $${latIndex}::numeric, $${lonIndex}::numeric)
                    AS distance_metres
             FROM response_unit ru
             ${where.sql}
            ORDER BY distance_metres ASC NULLS LAST, ru.unit_code
            LIMIT 25`,
          where.withExtra(incident.latitude, incident.longitude),
        );
        return rows.map(toUnit);
      }
    }

    const rows = await this.db.query<ResponseUnitRow>(
      `SELECT ru.* FROM response_unit ru ${where.sql} ORDER BY ru.unit_code LIMIT 200`,
      where.params,
    );
    return rows.map(toUnit);
  }

  /**
   * Register a response unit.
   *
   * Fleet administration, not citizen data: a unit is a vehicle and a crew. It
   * is authorised as RESPONSE_UNIT_MANAGE and nothing about it widens anybody's
   * access to a person - which is why it can be held by a technical
   * administrator role that deliberately carries no data entitlement at all.
   *
   * A unit belongs to the registering account's agency unless one is named
   * explicitly, and the platform does not let this route set a position: where
   * a unit is, is something the unit reports.
   */
  async createUnit(
    actor: AuthenticatedActor,
    input: {
      unitCode: string;
      agencyId?: string;
      type: string;
      homeLgaCode?: string | null;
      homeWardCode?: string | null;
      capabilities?: readonly string[];
      contactPhone?: string | null;
      status?: 'AVAILABLE' | 'OFFLINE';
    },
    context: RequestContext,
  ): Promise<Record<string, unknown>> {
    const agencyId = input.agencyId ?? actor.subject.agencyId;
    await this.policy.authorize({
      actor,
      action: 'RESPONSE_UNIT_MANAGE',
      purpose: 'SYSTEM_ADMINISTRATION',
      resource: {
        type: 'RESPONSE_UNIT',
        id: null,
        classification: 'INTERNAL',
        subjectPcid: null,
        lgaCode: input.homeLgaCode ?? null,
      },
      context,
      auditDetail: { unitCode: input.unitCode, unitType: input.type },
    });
    if (agencyId === null) {
      throw AppError.validation('This account has no agency, so it must name the owning agency.');
    }

    const unitCode = input.unitCode.toUpperCase();
    const existing = await this.db.queryOne<{ id: string }>(
      'SELECT id FROM response_unit WHERE unit_code = $1',
      [unitCode],
    );
    if (existing !== null) throw AppError.conflict(`Unit ${unitCode} is already registered.`);

    const row = await this.db.queryOne<ResponseUnitRow>(
      `INSERT INTO response_unit (unit_code, agency_id, type, status, home_lga_code, home_ward_code,
                                  capabilities, contact_phone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        unitCode,
        agencyId,
        input.type,
        input.status ?? 'OFFLINE',
        input.homeLgaCode ?? null,
        input.homeWardCode ?? null,
        input.capabilities ?? [],
        input.contactPhone ?? null,
      ],
    );
    if (row === null) throw new Error('response unit insert returned no row');

    await this.audit.record({
      action: 'RESPONSE_UNIT_MANAGE',
      outcome: 'PERMITTED',
      actorType: actor.subject.actorType,
      actorId: actor.subject.userId,
      actorDisplay: actor.displayName,
      agencyId: actor.subject.agencyId,
      agencyCode: actor.agencyCode,
      roles: actor.subject.roles,
      purpose: 'SYSTEM_ADMINISTRATION',
      resourceType: 'RESPONSE_UNIT',
      resourceId: row.id,
      correlationId: context.correlationId,
      ipAddress: context.ipAddress,
      detail: { change: 'REGISTERED', unitCode },
    });
    return toUnit(row);
  }

  /**
   * Change a unit.
   *
   * The operational statuses are not settable here. A unit is marked dispatched,
   * en route or on scene by the dispatch workflow, which knows whether it is
   * true; a fleet screen that could write them would let somebody mark an
   * ambulance available while it is carrying a patient. Only AVAILABLE and
   * OFFLINE - putting a unit into service and taking it out - are administration.
   */
  async updateUnit(
    actor: AuthenticatedActor,
    unitCode: string,
    input: {
      type?: string;
      homeLgaCode?: string | null;
      homeWardCode?: string | null;
      capabilities?: readonly string[];
      contactPhone?: string | null;
      status?: 'AVAILABLE' | 'OFFLINE';
    },
    context: RequestContext,
  ): Promise<Record<string, unknown>> {
    const current = await this.db.queryOne<ResponseUnitRow>(
      'SELECT * FROM response_unit WHERE unit_code = $1',
      [unitCode.toUpperCase()],
    );
    await this.policy.authorize({
      actor,
      action: 'RESPONSE_UNIT_MANAGE',
      purpose: 'SYSTEM_ADMINISTRATION',
      resource: {
        type: 'RESPONSE_UNIT',
        id: current?.id ?? null,
        classification: 'INTERNAL',
        subjectPcid: null,
        lgaCode: current?.home_lga_code ?? null,
      },
      context,
      auditDetail: { unitCode },
    });
    if (current === null) throw AppError.notFoundOrNotPermitted(`no response unit ${unitCode}`);

    if (input.status !== undefined && !ADMINISTRABLE_UNIT_STATUSES.includes(current.status)) {
      throw AppError.conflict(
        `Unit ${current.unit_code} is ${current.status.toLowerCase()} on a live dispatch; ` +
          'stand it down from the incident rather than from here.',
      );
    }

    const columns: string[] = [];
    const values: unknown[] = [current.id];
    const set = (column: string, value: unknown): void => {
      values.push(value);
      columns.push(`${column} = $${values.length}`);
    };
    if (input.type !== undefined) set('type', input.type);
    if (input.homeLgaCode !== undefined) set('home_lga_code', input.homeLgaCode);
    if (input.homeWardCode !== undefined) set('home_ward_code', input.homeWardCode);
    if (input.capabilities !== undefined) set('capabilities', input.capabilities);
    if (input.contactPhone !== undefined) set('contact_phone', input.contactPhone);
    if (input.status !== undefined) set('status', input.status);
    if (columns.length === 0) throw AppError.validation('Supply at least one field to update.');

    const row = await this.db.queryOne<ResponseUnitRow>(
      `UPDATE response_unit SET ${columns.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
      values,
    );
    if (row === null) throw new Error('response unit update returned no row');

    await this.audit.record({
      action: 'RESPONSE_UNIT_MANAGE',
      outcome: 'PERMITTED',
      actorType: actor.subject.actorType,
      actorId: actor.subject.userId,
      actorDisplay: actor.displayName,
      agencyId: actor.subject.agencyId,
      agencyCode: actor.agencyCode,
      roles: actor.subject.roles,
      purpose: 'SYSTEM_ADMINISTRATION',
      resourceType: 'RESPONSE_UNIT',
      resourceId: row.id,
      correlationId: context.correlationId,
      ipAddress: context.ipAddress,
      detail: { change: 'UPDATED', unitCode: row.unit_code, fields: Object.keys(input) },
    });
    return toUnit(row);
  }

  async dispatch(
    actor: AuthenticatedActor,
    incidentReference: string,
    unitCode: string,
    note: string | null,
    context: RequestContext,
  ): Promise<{
    dispatchId: string;
    incidentNumber: string;
    unitCode: string;
    status: DispatchStatus;
  }> {
    const incident = await this.incidents.findByReference(incidentReference);
    await this.policy.authorize({
      actor,
      action: 'DISPATCH_CREATE',
      purpose: 'EMERGENCY_RESPONSE',
      resource: {
        type: 'DISPATCH',
        id: null,
        classification: 'INTERNAL',
        subjectPcid: null,
        lgaCode: incident?.lga_code ?? null,
      },
      incidentRef: incidentReference,
      context,
      auditDetail: { unitCode },
    });
    if (incident === null)
      throw AppError.notFoundOrNotPermitted(`no incident ${incidentReference}`);

    return this.db.transaction(async (runner) => {
      const unit = await runner.queryOne<{
        id: string;
        agency_id: string;
        status: ResponseUnitStatus;
      }>('SELECT id, agency_id, status FROM response_unit WHERE unit_code = $1 FOR UPDATE', [
        unitCode,
      ]);
      if (unit === null) throw AppError.notFoundOrNotPermitted(`no response unit ${unitCode}`);
      if (unit.status !== 'AVAILABLE') {
        throw AppError.conflict(
          `Unit ${unitCode} is ${unit.status.toLowerCase()} and cannot be dispatched.`,
        );
      }

      const dispatch = await runner.queryOne<{ id: string; status: DispatchStatus }>(
        `INSERT INTO dispatch (incident_id, response_unit_id, status, dispatched_by_user_id, note)
         VALUES ($1,$2,'ASSIGNED',$3,$4)
         ON CONFLICT (incident_id, response_unit_id) DO NOTHING
         RETURNING id, status`,
        [incident.id, unit.id, actor.subject.userId, note],
      );
      if (dispatch === null) {
        throw AppError.conflict(
          `Unit ${unitCode} is already assigned to ${incident.incident_number}.`,
        );
      }

      await runner.query(`UPDATE response_unit SET status = 'DISPATCHED' WHERE id = $1`, [unit.id]);
      await runner.query(
        `INSERT INTO incident_agency (incident_id, agency_id, role) VALUES ($1,$2,'RESPONDING')
         ON CONFLICT DO NOTHING`,
        [incident.id, unit.agency_id],
      );
      await runner.query(
        `UPDATE incident
            SET status = CASE WHEN status = 'REPORTED' THEN 'DISPATCHED' WHEN status = 'VERIFIED' THEN 'DISPATCHED' ELSE status END,
                first_dispatched_at = COALESCE(first_dispatched_at, now())
          WHERE id = $1`,
        [incident.id],
      );
      await this.incidents.appendTimeline(
        runner,
        incident.id,
        'DISPATCHED',
        `Unit ${unitCode} dispatched.`,
        { unitCode, note },
        actor,
      );
      await this.audit.record(
        {
          action: 'DISPATCH_CREATE',
          outcome: 'PERMITTED',
          actorType: actor.subject.actorType,
          actorId: actor.subject.userId,
          actorDisplay: actor.displayName,
          agencyId: actor.subject.agencyId,
          agencyCode: actor.agencyCode,
          roles: actor.subject.roles,
          purpose: 'EMERGENCY_RESPONSE',
          resourceType: 'DISPATCH',
          resourceId: dispatch.id,
          incidentId: incident.id,
          incidentNumber: incident.incident_number,
          correlationId: context.correlationId,
          ipAddress: context.ipAddress,
          detail: { unitCode },
        },
        runner,
      );

      return {
        dispatchId: dispatch.id,
        incidentNumber: incident.incident_number,
        unitCode,
        status: dispatch.status,
      };
    });
  }

  async updateDispatch(
    actor: AuthenticatedActor,
    dispatchId: string,
    status: DispatchStatus,
    note: string | null,
    context: RequestContext,
  ): Promise<{ dispatchId: string; status: DispatchStatus }> {
    const current = await this.db.queryOne<{
      id: string;
      status: DispatchStatus;
      incident_id: string;
      response_unit_id: string;
      incident_number: string;
      lga_code: string | null;
    }>(
      `SELECT d.id, d.status, d.incident_id, d.response_unit_id, i.incident_number, i.lga_code
         FROM dispatch d JOIN incident i ON i.id = d.incident_id
        WHERE d.id = $1`,
      [dispatchId],
    );

    await this.policy.authorize({
      actor,
      action: 'DISPATCH_UPDATE',
      purpose: 'EMERGENCY_RESPONSE',
      resource: {
        type: 'DISPATCH',
        id: dispatchId,
        classification: 'INTERNAL',
        subjectPcid: null,
        lgaCode: current?.lga_code ?? null,
      },
      incidentRef: current?.incident_number ?? null,
      context,
      auditDetail: { newStatus: status },
    });
    if (current === null) throw AppError.notFoundOrNotPermitted(`no dispatch ${dispatchId}`);

    const permitted = DISPATCH_TRANSITIONS[current.status];
    if (!permitted.includes(status)) {
      throw AppError.conflict(
        `A dispatch that is ${current.status.toLowerCase()} cannot move to ${status.toLowerCase()}.`,
      );
    }

    return this.db.transaction(async (runner) => {
      await runner.query(
        `UPDATE dispatch
            SET status = $2,
                acknowledged_at = CASE WHEN $2 = 'ACKNOWLEDGED' THEN now() ELSE acknowledged_at END,
                en_route_at = CASE WHEN $2 = 'EN_ROUTE' THEN now() ELSE en_route_at END,
                arrived_at = CASE WHEN $2 = 'ON_SCENE' THEN now() ELSE arrived_at END,
                completed_at = CASE WHEN $2 IN ('COMPLETED','STOOD_DOWN') THEN now() ELSE completed_at END,
                stood_down_reason = CASE WHEN $2 = 'STOOD_DOWN' THEN $3 ELSE stood_down_reason END
          WHERE id = $1`,
        [dispatchId, status, note],
      );
      await runner.query('UPDATE response_unit SET status = $2 WHERE id = $1', [
        current.response_unit_id,
        UNIT_STATUS_FOR_DISPATCH[status],
      ]);
      if (status === 'ON_SCENE') {
        await runner.query(
          `UPDATE incident
              SET first_arrival_at = COALESCE(first_arrival_at, now()),
                  status = CASE WHEN status IN ('REPORTED','VERIFIED','DISPATCHED') THEN 'ON_SCENE' ELSE status END
            WHERE id = $1`,
          [current.incident_id],
        );
      }
      await this.incidents.appendTimeline(
        runner,
        current.incident_id,
        'DISPATCH_UPDATED',
        `Dispatch moved to ${status}.`,
        { dispatchId, note },
        actor,
      );
      await this.audit.record(
        {
          action: 'DISPATCH_UPDATE',
          outcome: 'PERMITTED',
          actorType: actor.subject.actorType,
          actorId: actor.subject.userId,
          actorDisplay: actor.displayName,
          agencyId: actor.subject.agencyId,
          agencyCode: actor.agencyCode,
          roles: actor.subject.roles,
          purpose: 'EMERGENCY_RESPONSE',
          resourceType: 'DISPATCH',
          resourceId: dispatchId,
          incidentId: current.incident_id,
          incidentNumber: current.incident_number,
          correlationId: context.correlationId,
          ipAddress: context.ipAddress,
          detail: { status },
        },
        runner,
      );
      return { dispatchId, status };
    });
  }

  /** A unit reporting its own operational position (§36). */
  async reportUnitPosition(
    actor: AuthenticatedActor,
    unitCode: string,
    position: { latitude: number; longitude: number },
    context: RequestContext,
  ): Promise<{ unitCode: string; reportedAt: string }> {
    await this.policy.authorize({
      actor,
      action: 'DISPATCH_UPDATE',
      purpose: 'EMERGENCY_RESPONSE',
      resource: { type: 'DISPATCH', id: unitCode, classification: 'INTERNAL', subjectPcid: null },
      context,
    });
    const row = await this.db.queryOne<{ location_reported_at: Date }>(
      `UPDATE response_unit
          SET latitude = $2, longitude = $3, location_reported_at = now(),
              location_source = 'RESPONDER_OBSERVED'
        WHERE unit_code = $1
        RETURNING location_reported_at`,
      [unitCode, position.latitude, position.longitude],
    );
    if (row === null) throw AppError.notFoundOrNotPermitted(`no response unit ${unitCode}`);
    return { unitCode, reportedAt: row.location_reported_at.toISOString() };
  }
}

function toUnit(row: ResponseUnitRow): Record<string, unknown> {
  return {
    unitCode: row.unit_code,
    agencyId: row.agency_id,
    type: row.type,
    status: row.status,
    homeLgaCode: row.home_lga_code,
    homeWardCode: row.home_ward_code,
    capabilities: row.capabilities,
    contactPhone: row.contact_phone,
    position:
      row.latitude !== null && row.longitude !== null
        ? {
            latitude: Number(row.latitude),
            longitude: Number(row.longitude),
            reportedAt: row.location_reported_at?.toISOString() ?? null,
            source: 'RESPONDER_OBSERVED',
          }
        : null,
    distanceMetres: row.distance_metres != null ? Math.round(Number(row.distance_metres)) : null,
  };
}
