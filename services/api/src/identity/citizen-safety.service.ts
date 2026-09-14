import { Injectable } from '@nestjs/common';
import type { IncidentType } from '@pcid/contracts';

import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { RequestContext } from '../common/correlation';
import { Database } from '../database/pool';
import { IncidentsService } from '../emergency/incidents.service';
import type { AuthenticatedActor } from '../iam/actor';
import { PolicyService } from '../policy/policy.service';

export interface EmergencyRequestInput {
  readonly type: IncidentType;
  readonly description: string;
  readonly latitude?: number | null;
  readonly longitude?: number | null;
  readonly contactPhone?: string | null;
}

export interface CitizenReportInput {
  readonly description: string;
  /** For an unauthorised-access report, the reference shown in the access history. */
  readonly accessReference?: string | null;
}

/**
 * Citizen safety features (master system prompt §17).
 *
 * Two things a resident can do here that the rest of the platform is built
 * around: raise an emergency, and challenge how their own record has been used.
 *
 * A report becomes an alert for an officer to review. Alerts describe events,
 * never people (§31, §65) — a resident reporting that they do not recognise an
 * access is reporting an event, not accusing an officer, and the wording of the
 * record reflects that.
 */
@Injectable()
export class CitizenSafetyService {
  constructor(
    private readonly db: Database,
    private readonly policy: PolicyService,
    private readonly incidents: IncidentsService,
    private readonly audit: AuditService,
  ) {}

  private ownRecord(actor: AuthenticatedActor): string {
    const pcid = actor.subject.subjectPcid;
    if (actor.subject.actorType !== 'CITIZEN' || pcid === null || pcid === undefined) {
      throw AppError.denied(
        'This endpoint is for citizen accounts.',
        'non-citizen actor on portal route',
      );
    }
    return pcid;
  }

  /**
   * Raise an emergency from the portal. The coordinates, if the resident chooses
   * to share them, are recorded as CALLER_SUPPLIED and carry a retention date:
   * they describe where this emergency is, and the platform keeps no standing
   * record of where anybody is (§16).
   */
  async raiseEmergency(
    actor: AuthenticatedActor,
    input: EmergencyRequestInput,
    context: RequestContext,
  ): Promise<{ incidentNumber: string; status: string; message: string }> {
    const pcid = this.ownRecord(actor);
    const citizen = await this.db.queryOne<{
      lga_code: string | null;
      ward_code: string | null;
      residential_address: string | null;
      phone_primary: string | null;
    }>(
      'SELECT lga_code, ward_code, residential_address, phone_primary FROM citizen WHERE pcid = $1',
      [pcid],
    );

    const created = await this.incidents.create(
      actor,
      {
        type: input.type,
        severity: 'CRITICAL',
        description: input.description,
        // Without shared coordinates, the registered address is the best starting
        // point a dispatcher has. It is a government record, not an observation.
        addressText: input.latitude == null ? (citizen?.residential_address ?? null) : null,
        lgaCode: citizen?.lga_code ?? null,
        wardCode: citizen?.ward_code ?? null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        locationSource: input.latitude == null ? 'REGISTERED_ADDRESS' : 'CALLER_SUPPLIED',
        reporterContact: input.contactPhone ?? citizen?.phone_primary ?? null,
      },
      context,
    );

    return {
      incidentNumber: created.incidentNumber,
      status: created.status,
      message:
        'Your report has been received and passed to the emergency service. Keep this reference and stay reachable on the number given.',
    };
  }

  async reportIdentityFraud(
    actor: AuthenticatedActor,
    input: CitizenReportInput,
    context: RequestContext,
  ): Promise<{ reference: string; message: string }> {
    return this.raiseCitizenReport(
      actor,
      {
        ruleKey: 'CITIZEN_REPORTED_IDENTITY_FRAUD',
        category: 'IDENTITY_INTEGRITY',
        severity: 'HIGH',
        title: 'Identity Integrity Alert',
        summary:
          'A resident reports that their identity may have been used by someone else. Review the registry record and recent activity against it.',
        description: input.description,
        accessReference: input.accessReference ?? null,
        message:
          'Your report has been sent to the registry team for review. You will be contacted using the details on your record.',
      },
      context,
    );
  }

  async reportUnauthorisedAccess(
    actor: AuthenticatedActor,
    input: CitizenReportInput,
    context: RequestContext,
  ): Promise<{ reference: string; message: string }> {
    return this.raiseCitizenReport(
      actor,
      {
        ruleKey: 'CITIZEN_REPORTED_UNAUTHORISED_ACCESS',
        category: 'SECURITY',
        severity: 'HIGH',
        title: 'Reported access a resident does not recognise',
        summary:
          'A resident does not recognise an access shown in their own history. Review the audit record and the stated purpose against the officer’s assigned work.',
        description: input.description,
        accessReference: input.accessReference ?? null,
        message:
          'Your report has been sent to the Data Protection Officer. The access record cannot be altered or deleted, so it will still be there when they review it.',
      },
      context,
    );
  }

  private async raiseCitizenReport(
    actor: AuthenticatedActor,
    report: {
      ruleKey: string;
      category: string;
      severity: string;
      title: string;
      summary: string;
      description: string;
      accessReference: string | null;
      message: string;
    },
    context: RequestContext,
  ): Promise<{ reference: string; message: string }> {
    const pcid = this.ownRecord(actor);
    await this.policy.authorize({
      actor,
      action: 'CORRECTION_REQUEST_CREATE',
      purpose: 'CITIZEN_SELF_SERVICE',
      resource: {
        type: 'CORRECTION_REQUEST',
        id: null,
        classification: 'INTERNAL',
        subjectPcid: pcid,
      },
      context,
      auditDetail: { report: report.ruleKey },
    });

    // If the resident quoted a reference from their access history, attach the
    // matching audit event so the reviewer starts from the right record.
    let referencedEvent: string | null = null;
    if (report.accessReference !== null && report.accessReference.trim() !== '') {
      const event = await this.db.queryOne<{ id: string }>(
        `SELECT id FROM audit_event
          WHERE correlation_id = $1 AND subject_pcid = $2
            AND citizen_visibility = 'ACCESS_VISIBLE_TO_CITIZEN'
          ORDER BY occurred_at DESC LIMIT 1`,
        [report.accessReference.trim(), pcid],
      );
      referencedEvent = event?.id ?? null;
    }

    const reference = await this.policy.nextReference('ALERT');
    await this.db.query(
      `INSERT INTO alert (
         reference, rule_key, category, severity, title, summary, explanation,
         subject_type, subject_id, subject_pcid, classification, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,'CITIZEN',$8,$8,'SENSITIVE','OPEN')`,
      [
        reference,
        report.ruleKey,
        report.category,
        report.severity,
        report.title,
        report.summary,
        JSON.stringify({
          reason: 'Raised by the resident from the citizen portal.',
          residentDescription: report.description,
          referencedAccessReference: report.accessReference,
          referencedAuditEventId: referencedEvent,
          note: 'This records what a resident reported. It is not a finding about anyone.',
        }),
        pcid,
      ],
    );

    await this.audit.record({
      action: 'CORRECTION_REQUEST_CREATE',
      outcome: 'PERMITTED',
      actorType: 'CITIZEN',
      actorId: actor.subject.userId,
      actorDisplay: actor.displayName,
      purpose: 'CITIZEN_SELF_SERVICE',
      resourceType: 'ALERT',
      resourceId: reference,
      subjectPcid: pcid,
      correlationId: context.correlationId,
      ipAddress: context.ipAddress,
      detail: { report: report.ruleKey, referencedAuditEventId: referencedEvent },
    });

    return { reference, message: report.message };
  }

  /** The resident's in-app notification inbox (§33, §58). */
  async listNotifications(
    actor: AuthenticatedActor,
    options: { limit: number; offset: number },
    context: RequestContext,
  ): Promise<{ total: number; unread: number; notifications: Record<string, unknown>[] }> {
    const pcid = this.ownRecord(actor);
    void context;
    const rows = await this.db.query<{
      id: string;
      subject: string | null;
      body: string;
      queued_at: Date;
      read_at: Date | null;
      incident_id: string | null;
      incident_number: string | null;
    }>(
      `SELECT n.id, n.subject, n.body, n.queued_at, n.read_at, n.incident_id, i.incident_number
         FROM notification n
         LEFT JOIN incident i ON i.id = n.incident_id
        WHERE n.recipient_type = 'CITIZEN' AND n.recipient_id = $1
          AND n.channel IN ('IN_APP', 'PUSH')
        ORDER BY n.queued_at DESC
        LIMIT $2 OFFSET $3`,
      [pcid, options.limit, options.offset],
    );
    const counts = await this.db.queryOne<{ total: string; unread: string }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE read_at IS NULL)::text AS unread
         FROM notification
        WHERE recipient_type = 'CITIZEN' AND recipient_id = $1 AND channel IN ('IN_APP','PUSH')`,
      [pcid],
    );
    return {
      total: Number(counts?.total ?? 0),
      unread: Number(counts?.unread ?? 0),
      notifications: rows.map((row) => ({
        id: row.id,
        subject: row.subject,
        body: row.body,
        receivedAt: row.queued_at.toISOString(),
        read: row.read_at !== null,
        incidentNumber: row.incident_number,
      })),
    };
  }

  async markNotificationRead(
    actor: AuthenticatedActor,
    notificationId: string,
  ): Promise<{ read: boolean }> {
    const pcid = this.ownRecord(actor);
    const rows = await this.db.query<{ id: string }>(
      `UPDATE notification SET read_at = now()
        WHERE id = $1 AND recipient_type = 'CITIZEN' AND recipient_id = $2 AND read_at IS NULL
        RETURNING id`,
      [notificationId, pcid],
    );
    return { read: rows.length > 0 };
  }
}
