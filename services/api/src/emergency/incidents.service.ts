import { Injectable } from '@nestjs/common';
import type {
  IncidentSeverity,
  IncidentStatus,
  IncidentType,
  LocationSource,
} from '@pcid/contracts';
import { ACTIVE_INCIDENT_STATUSES } from '@pcid/contracts';

import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { RequestContext } from '../common/correlation';
import { WhereBuilder } from '../common/sql';
import { Database } from '../database/pool';
import type { QueryRunner } from '../database/pool';
import type { AuthenticatedActor } from '../iam/actor';
import { PolicyService } from '../policy/policy.service';

export interface CreateIncidentInput {
  readonly type: IncidentType;
  readonly severity: IncidentSeverity;
  readonly description: string;
  readonly addressText?: string | null;
  readonly lgaCode?: string | null;
  readonly wardCode?: string | null;
  readonly latitude?: number | null;
  readonly longitude?: number | null;
  readonly locationSource?: LocationSource;
  readonly reporterContact?: string | null;
  readonly leadAgencyId?: string | null;
}

/**
 * Incident management and the emergency response workflow
 * (master system prompt §8, §9, §37).
 *
 * An incident is the unit that authorises emergency access to citizen
 * information: the incident-binding gate refuses a responder who is not attached
 * to an active one. Closing an incident therefore closes the access it granted,
 * with no separate revocation step to forget.
 *
 * Location handling follows §16 strictly. Every coordinate stored here is an
 * observation about an *event*, carries the provenance of how it was obtained,
 * and is given a retention date. The platform has no capability to locate a
 * person, and nothing in this service creates one.
 */
@Injectable()
export class IncidentsService {
  /** Emergency location material is short-lived unless a case needs it (§69). */
  private static readonly LOCATION_RETENTION_DAYS = 90;

  constructor(
    private readonly db: Database,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
  ) {}

  async create(
    actor: AuthenticatedActor,
    input: CreateIncidentInput,
    context: RequestContext,
  ): Promise<{ incidentNumber: string; id: string; status: IncidentStatus }> {
    await this.policy.authorize({
      actor,
      action: 'INCIDENT_CREATE',
      purpose:
        actor.subject.actorType === 'CITIZEN' ? 'CITIZEN_SELF_SERVICE' : 'EMERGENCY_RESPONSE',
      resource: {
        type: 'INCIDENT',
        id: null,
        classification: 'CONFIDENTIAL',
        subjectPcid: null,
        lgaCode: input.lgaCode ?? null,
        wardCode: input.wardCode ?? null,
      },
      context,
      auditDetail: { incidentType: input.type, severity: input.severity },
    });

    const incidentNumber = await this.policy.nextReference('INCIDENT', 'INC');
    const isCitizen = actor.subject.actorType === 'CITIZEN';

    return this.db.transaction(async (runner) => {
      const row = await runner.queryOne<{ id: string; status: IncidentStatus }>(
        `INSERT INTO incident (
           incident_number, type, severity, status, description, address_text, lga_code, ward_code,
           latitude, longitude, location_source, location_retention_until,
           reporter_type, reporter_citizen_pcid, reporter_user_id, reporter_contact, lead_agency_id
         ) VALUES ($1,$2,$3,'REPORTED',$4,$5,$6,$7,$8,$9,$10,
                   now() + make_interval(days => $11), $12,$13,$14,$15,$16)
         RETURNING id, status`,
        [
          incidentNumber,
          input.type,
          input.severity,
          input.description,
          input.addressText ?? null,
          input.lgaCode ?? null,
          input.wardCode ?? null,
          input.latitude ?? null,
          input.longitude ?? null,
          input.locationSource ?? (isCitizen ? 'CALLER_SUPPLIED' : 'INCIDENT_REPORT'),
          IncidentsService.LOCATION_RETENTION_DAYS,
          isCitizen ? 'CITIZEN' : 'GOVERNMENT_USER',
          isCitizen ? actor.subject.subjectPcid : null,
          isCitizen ? null : actor.subject.userId,
          input.reporterContact ?? null,
          input.leadAgencyId ?? (isCitizen ? null : actor.subject.agencyId),
        ],
      );
      if (row === null) throw new Error('incident insert returned no row');

      const leadAgency = input.leadAgencyId ?? (isCitizen ? null : actor.subject.agencyId);
      if (leadAgency !== null) {
        await runner.query(
          `INSERT INTO incident_agency (incident_id, agency_id, role) VALUES ($1, $2, 'LEAD')
           ON CONFLICT DO NOTHING`,
          [row.id, leadAgency],
        );
      }
      if (!isCitizen) {
        await runner.query(
          `INSERT INTO incident_officer (incident_id, user_id, role) VALUES ($1, $2, 'REPORTING')
           ON CONFLICT DO NOTHING`,
          [row.id, actor.subject.userId],
        );
      }
      await this.appendTimeline(
        runner,
        row.id,
        'CREATED',
        'Incident reported.',
        {
          severity: input.severity,
          type: input.type,
        },
        actor,
      );

      await this.audit.record(
        {
          action: 'INCIDENT_CREATE',
          outcome: 'PERMITTED',
          actorType: actor.subject.actorType,
          actorId: actor.subject.userId,
          actorDisplay: actor.displayName,
          agencyId: actor.subject.agencyId,
          agencyCode: actor.agencyCode,
          roles: actor.subject.roles,
          purpose: isCitizen ? 'CITIZEN_SELF_SERVICE' : 'EMERGENCY_RESPONSE',
          resourceType: 'INCIDENT',
          resourceId: row.id,
          incidentId: row.id,
          incidentNumber,
          subjectPcid: isCitizen ? actor.subject.subjectPcid : null,
          correlationId: context.correlationId,
          ipAddress: context.ipAddress,
          detail: { type: input.type, severity: input.severity },
        },
        runner,
      );

      return { incidentNumber, id: row.id, status: row.status };
    });
  }

  async list(
    actor: AuthenticatedActor,
    filters: {
      status?: IncidentStatus;
      type?: IncidentType;
      lgaCode?: string;
      activeOnly?: boolean;
      limit: number;
      offset: number;
    },
    context: RequestContext,
  ): Promise<{ incidents: Record<string, unknown>[]; total: number }> {
    await this.policy.authorize({
      actor,
      action: 'INCIDENT_VIEW',
      purpose: 'EMERGENCY_RESPONSE',
      resource: {
        type: 'INCIDENT',
        id: null,
        classification: 'CONFIDENTIAL',
        subjectPcid: null,
        lgaCode: filters.lgaCode ?? null,
      },
      context,
    });

    const where = new WhereBuilder();
    if (filters.status !== undefined) where.add('status = ?', filters.status);
    if (filters.type !== undefined) where.add('type = ?', filters.type);
    if (filters.lgaCode !== undefined) where.add('lga_code = ?', filters.lgaCode);
    if (filters.activeOnly === true)
      where.add('status = ANY(?::text[])', [...ACTIVE_INCIDENT_STATUSES]);

    const jurisdiction = actor.subject.jurisdiction;
    if (jurisdiction.scope === 'LGA' && jurisdiction.lgaCodes.length > 0) {
      where.add('(lga_code IS NULL OR lga_code = ANY(?::text[]))', jurisdiction.lgaCodes);
    }

    const rows = await this.db.query<IncidentSummaryRow>(
      `SELECT id, incident_number, type, severity, status, description, address_text,
              lga_code, ward_code, latitude, longitude, location_source, reported_at,
              first_dispatched_at, first_arrival_at, resolved_at
         FROM incident ${where.sql}
        ORDER BY reported_at DESC LIMIT $${where.next()} OFFSET $${where.next(2)}`,
      where.withExtra(filters.limit, filters.offset),
    );
    const total = await this.db.queryOne<{ count: string }>(
      `SELECT count(*)::text AS count FROM incident ${where.sql}`,
      where.params,
    );
    return { incidents: rows.map(toIncidentSummary), total: Number(total?.count ?? 0) };
  }

  async view(
    actor: AuthenticatedActor,
    reference: string,
    context: RequestContext,
  ): Promise<Record<string, unknown>> {
    const row = await this.findByReference(reference);
    await this.policy.authorize({
      actor,
      action: 'INCIDENT_VIEW',
      purpose: 'EMERGENCY_RESPONSE',
      resource: {
        type: 'INCIDENT',
        id: row?.id ?? null,
        classification: 'CONFIDENTIAL',
        subjectPcid: null,
        lgaCode: row?.lga_code ?? null,
        wardCode: row?.ward_code ?? null,
      },
      incidentRef: reference,
      context,
    });
    if (row === null) throw AppError.notFoundOrNotPermitted(`no incident ${reference}`);

    const [timeline, dispatches, officers] = await Promise.all([
      this.db.query<{ occurred_at: Date; entry_type: string; summary: string; detail: unknown }>(
        'SELECT occurred_at, entry_type, summary, detail FROM incident_timeline WHERE incident_id = $1 ORDER BY occurred_at',
        [row.id],
      ),
      this.db.query<{
        id: string;
        unit_code: string;
        type: string;
        status: string;
        dispatched_at: Date;
        arrived_at: Date | null;
      }>(
        // The dispatch id travels with the unit, because moving a dispatch along
        // is addressed by id and a crew reading this page is the one who has to
        // do it. Without it the acknowledge-and-arrive steps are reachable only
        // by whoever kept the response to the original dispatch call.
        `SELECT d.id, ru.unit_code, ru.type, d.status, d.dispatched_at, d.arrived_at
           FROM dispatch d JOIN response_unit ru ON ru.id = d.response_unit_id
          WHERE d.incident_id = $1 ORDER BY d.dispatched_at`,
        [row.id],
      ),
      this.db.query<{ full_name: string; role: string }>(
        `SELECT u.full_name, io.role FROM incident_officer io
           JOIN government_user u ON u.id = io.user_id
          WHERE io.incident_id = $1 AND io.released_at IS NULL`,
        [row.id],
      ),
    ]);

    return {
      ...toIncidentSummary(row),
      timeline: timeline.map((entry) => ({
        occurredAt: entry.occurred_at.toISOString(),
        type: entry.entry_type,
        summary: entry.summary,
        detail: entry.detail,
      })),
      responseUnits: dispatches.map((entry) => ({
        dispatchId: entry.id,
        unitCode: entry.unit_code,
        type: entry.type,
        status: entry.status,
        dispatchedAt: entry.dispatched_at.toISOString(),
        arrivedAt: entry.arrived_at?.toISOString() ?? null,
      })),
      assignedOfficers: officers.map((entry) => ({ name: entry.full_name, role: entry.role })),
    };
  }

  async updateStatus(
    actor: AuthenticatedActor,
    reference: string,
    status: IncidentStatus,
    note: string | null,
    context: RequestContext,
  ): Promise<{ incidentNumber: string; status: IncidentStatus }> {
    const row = await this.findByReference(reference);
    const closing = status === 'CLOSED' || status === 'RESOLVED' || status === 'CANCELLED';
    await this.policy.authorize({
      actor,
      action: closing ? 'INCIDENT_CLOSE' : 'INCIDENT_UPDATE',
      purpose: 'EMERGENCY_RESPONSE',
      resource: {
        type: 'INCIDENT',
        id: row?.id ?? null,
        classification: 'CONFIDENTIAL',
        subjectPcid: null,
        lgaCode: row?.lga_code ?? null,
      },
      incidentRef: reference,
      context,
      auditDetail: { newStatus: status },
    });
    if (row === null) throw AppError.notFoundOrNotPermitted(`no incident ${reference}`);

    return this.db.transaction(async (runner) => {
      const updated = await runner.queryOne<{ incident_number: string; status: IncidentStatus }>(
        `UPDATE incident
            SET status = $2,
                verified_at = CASE WHEN $2 = 'VERIFIED' AND verified_at IS NULL THEN now() ELSE verified_at END,
                resolved_at = CASE WHEN $2 IN ('RESOLVED','CLOSED') AND resolved_at IS NULL THEN now() ELSE resolved_at END,
                closed_at = CASE WHEN $2 = 'CLOSED' THEN now() ELSE closed_at END,
                resolution = COALESCE($3, resolution)
          WHERE id = $1
          RETURNING incident_number, status`,
        [row.id, status, note],
      );
      if (updated === null) throw new Error('incident update returned no row');

      await this.appendTimeline(
        runner,
        row.id,
        'STATUS_CHANGED',
        `Status set to ${status}.`,
        { note },
        actor,
      );
      await this.audit.record(
        {
          action: closing ? 'INCIDENT_CLOSE' : 'INCIDENT_UPDATE',
          outcome: 'PERMITTED',
          actorType: actor.subject.actorType,
          actorId: actor.subject.userId,
          actorDisplay: actor.displayName,
          agencyId: actor.subject.agencyId,
          agencyCode: actor.agencyCode,
          roles: actor.subject.roles,
          purpose: 'EMERGENCY_RESPONSE',
          resourceType: 'INCIDENT',
          resourceId: row.id,
          incidentId: row.id,
          incidentNumber: updated.incident_number,
          correlationId: context.correlationId,
          ipAddress: context.ipAddress,
          detail: { status },
        },
        runner,
      );
      return { incidentNumber: updated.incident_number, status: updated.status };
    });
  }

  /** Attach a person to an incident, which is what an identification records (§10). */
  async attachPerson(
    actor: AuthenticatedActor,
    reference: string,
    input: {
      citizenPcid?: string | null;
      unidentifiedPersonId?: string | null;
      role: string;
      note?: string | null;
    },
    context: RequestContext,
  ): Promise<{ id: string }> {
    const row = await this.findByReference(reference);
    await this.policy.authorize({
      actor,
      action: 'INCIDENT_UPDATE',
      purpose: 'EMERGENCY_RESPONSE',
      resource: {
        type: 'INCIDENT',
        id: row?.id ?? null,
        classification: 'CONFIDENTIAL',
        subjectPcid: input.citizenPcid ?? null,
        lgaCode: row?.lga_code ?? null,
      },
      incidentRef: reference,
      context,
    });
    if (row === null) throw AppError.notFoundOrNotPermitted(`no incident ${reference}`);

    const inserted = await this.db.queryOne<{ id: string }>(
      `INSERT INTO incident_person (incident_id, citizen_pcid, unidentified_person_id, role, note,
                                    identified_at, identified_by_user_id)
       VALUES ($1,$2,$3,$4,$5, CASE WHEN $2::text IS NOT NULL THEN now() END, $6)
       RETURNING id`,
      [
        row.id,
        input.citizenPcid ?? null,
        input.unidentifiedPersonId ?? null,
        input.role,
        input.note ?? null,
        actor.subject.userId,
      ],
    );
    if (inserted === null) throw new Error('incident_person insert returned no row');

    await this.audit.record({
      action: 'LINK_RECORD',
      outcome: 'PERMITTED',
      actorType: actor.subject.actorType,
      actorId: actor.subject.userId,
      actorDisplay: actor.displayName,
      agencyId: actor.subject.agencyId,
      agencyCode: actor.agencyCode,
      roles: actor.subject.roles,
      purpose: 'EMERGENCY_RESPONSE',
      resourceType: 'INCIDENT',
      resourceId: row.id,
      incidentId: row.id,
      incidentNumber: row.incident_number,
      subjectPcid: input.citizenPcid ?? null,
      correlationId: context.correlationId,
      ipAddress: context.ipAddress,
      detail: { role: input.role },
    });
    return { id: inserted.id };
  }

  /**
   * Put an officer on an incident.
   *
   * The emergency guide calls this "the normal path" for a responder who is not
   * attached - ask control, it takes seconds - and until now there was no route
   * that did it. Attachment by agency happens automatically when a unit is
   * dispatched; this is the individual case: a paramedic from another service,
   * an incident officer taking a handover, a commander joining a major incident.
   *
   * It is deliberately not itself incident-bound in the way a data read is: the
   * engine authorises it as INCIDENT_UPDATE against the incident, so an officer
   * already on it, or one whose agency is, can bring somebody in. That is the
   * same reasoning as case assignment - an incident nobody can be added to is an
   * incident that stalls when its officer goes off shift.
   */
  async attachOfficer(
    actor: AuthenticatedActor,
    reference: string,
    userId: string,
    role: string,
    context: RequestContext,
  ): Promise<{ incidentNumber: string; userId: string; role: string }> {
    const row = await this.findByReference(reference);
    await this.policy.authorize({
      actor,
      action: 'INCIDENT_UPDATE',
      purpose: 'EMERGENCY_RESPONSE',
      resource: {
        type: 'INCIDENT',
        id: row?.id ?? null,
        classification: 'CONFIDENTIAL',
        subjectPcid: null,
        lgaCode: row?.lga_code ?? null,
      },
      incidentRef: reference,
      context,
      auditDetail: { attachedUserId: userId, role },
    });
    if (row === null) throw AppError.notFoundOrNotPermitted(`no incident ${reference}`);
    if (!ACTIVE_INCIDENT_STATUSES.includes(row.status)) {
      throw AppError.conflict(
        `Incident ${row.incident_number} is ${row.status.toLowerCase()} and authorises no further access.`,
      );
    }

    return this.db.transaction(async (runner) => {
      const officer = await runner.queryOne<{ full_name: string }>(
        'SELECT full_name FROM government_user WHERE id = $1 AND status = $2',
        [userId, 'ACTIVE'],
      );
      // The same opaque answer as everywhere else: an account that does not
      // exist and one that is suspended must not be distinguishable from here.
      if (officer === null) throw AppError.notFoundOrNotPermitted(`no active user ${userId}`);

      await runner.query(
        `INSERT INTO incident_officer (incident_id, user_id, role, assigned_by)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (incident_id, user_id)
         DO UPDATE SET role = EXCLUDED.role, released_at = NULL, assigned_at = now(),
                       assigned_by = EXCLUDED.assigned_by`,
        [row.id, userId, role, actor.subject.userId],
      );
      await this.appendTimeline(
        runner,
        row.id,
        'OFFICER_ATTACHED',
        `${officer.full_name} attached as ${role.toLowerCase().replace(/_/g, ' ')}.`,
        { role },
        actor,
      );
      await this.audit.record(
        {
          action: 'INCIDENT_UPDATE',
          outcome: 'PERMITTED',
          actorType: actor.subject.actorType,
          actorId: actor.subject.userId,
          actorDisplay: actor.displayName,
          agencyId: actor.subject.agencyId,
          agencyCode: actor.agencyCode,
          roles: actor.subject.roles,
          purpose: 'EMERGENCY_RESPONSE',
          resourceType: 'INCIDENT',
          resourceId: row.id,
          incidentId: row.id,
          incidentNumber: row.incident_number,
          correlationId: context.correlationId,
          ipAddress: context.ipAddress,
          // The officer attached, and what as. Never anything about a casualty.
          detail: { attachedUserId: userId, role },
        },
        runner,
      );
      return { incidentNumber: row.incident_number, userId, role };
    });
  }

  async findByReference(reference: string): Promise<IncidentRow | null> {
    return this.db.queryOne<IncidentRow>(
      `SELECT id, incident_number, type, severity, status, description, address_text,
              lga_code, ward_code, latitude, longitude, location_source, reported_at,
              first_dispatched_at, first_arrival_at, resolved_at
         FROM incident WHERE incident_number = $1 OR id::text = $1`,
      [reference],
    );
  }

  async appendTimeline(
    runner: QueryRunner,
    incidentId: string,
    entryType: string,
    summary: string,
    detail: Record<string, unknown>,
    actor: AuthenticatedActor,
  ): Promise<void> {
    await runner.query(
      `INSERT INTO incident_timeline (incident_id, entry_type, summary, detail, actor_type, actor_id)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6)`,
      [
        incidentId,
        entryType,
        summary,
        JSON.stringify(detail),
        actor.subject.actorType,
        actor.subject.userId,
      ],
    );
  }
}

export interface IncidentRow {
  id: string;
  incident_number: string;
  type: string;
  severity: string;
  status: IncidentStatus;
  description: string;
  address_text: string | null;
  lga_code: string | null;
  ward_code: string | null;
  latitude: string | null;
  longitude: string | null;
  location_source: string;
  reported_at: Date;
  first_dispatched_at: Date | null;
  first_arrival_at: Date | null;
  resolved_at: Date | null;
}
type IncidentSummaryRow = IncidentRow;

function toIncidentSummary(row: IncidentRow): Record<string, unknown> {
  return {
    id: row.id,
    incidentNumber: row.incident_number,
    type: row.type,
    severity: row.severity,
    status: row.status,
    description: row.description,
    address: row.address_text,
    lgaCode: row.lga_code,
    wardCode: row.ward_code,
    location:
      row.latitude !== null && row.longitude !== null
        ? {
            latitude: Number(row.latitude),
            longitude: Number(row.longitude),
            // Provenance always travels with a coordinate (§16).
            source: row.location_source,
          }
        : null,
    reportedAt: row.reported_at.toISOString(),
    firstDispatchedAt: row.first_dispatched_at?.toISOString() ?? null,
    firstArrivalAt: row.first_arrival_at?.toISOString() ?? null,
    resolvedAt: row.resolved_at?.toISOString() ?? null,
    responseTimes: {
      callToDispatchSeconds: seconds(row.reported_at, row.first_dispatched_at),
      dispatchToArrivalSeconds: seconds(row.first_dispatched_at, row.first_arrival_at),
      totalResponseSeconds: seconds(row.reported_at, row.first_arrival_at),
      resolutionSeconds: seconds(row.reported_at, row.resolved_at),
    },
  };
}

function seconds(from: Date | null, to: Date | null): number | null {
  if (from === null || to === null) return null;
  return Math.round((to.getTime() - from.getTime()) / 1000);
}
