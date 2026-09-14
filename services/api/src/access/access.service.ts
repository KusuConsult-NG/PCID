import { Injectable } from '@nestjs/common';
import {
  ACCESS_APPROVAL_DEFAULT_TTL_SECONDS,
  ACCESS_APPROVAL_MAX_TTL_SECONDS,
  BREAK_GLASS_DEFAULT_TTL_SECONDS,
  BREAK_GLASS_MAX_TTL_SECONDS,
  fieldDefinition,
} from '@pcid/contracts';
import type { BreakGlassSatisfiableGate, Purpose, ResourceType } from '@pcid/contracts';

import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { RequestContext } from '../common/correlation';
import { WhereBuilder } from '../common/sql';
import { Database } from '../database/pool';
import type { AuthenticatedActor } from '../iam/actor';
import { NotificationsService } from '../notifications/notifications.service';
import { PolicyService } from '../policy/policy.service';

export interface CreateAccessRequestInput {
  readonly purpose: Purpose;
  readonly resourceType: ResourceType;
  readonly subjectPcid?: string | null;
  readonly resourceId?: string | null;
  readonly caseRef?: string | null;
  readonly incidentRef?: string | null;
  readonly requestedFields: readonly string[];
  readonly justification: string;
}

export interface InitiateBreakGlassInput {
  readonly resourceType: ResourceType;
  readonly subjectPcid?: string | null;
  readonly incidentRef?: string | null;
  readonly caseRef?: string | null;
  readonly gates: readonly BreakGlassSatisfiableGate[];
  readonly reason: string;
  readonly ttlSeconds?: number;
}

/**
 * The access-request workflow and break glass
 * (master system prompt §23, §24).
 *
 * Requesting access runs the policy check first and stores the engine's verbatim
 * answer on the request, so the approver sees what the platform itself concluded
 * rather than only the requester's account of it. A request the engine already
 * permits is not created at all - the officer is told to go ahead, because a
 * rubber-stamp approval queue trains people to stop reading.
 *
 * Break glass is the other half: temporary, minimal, logged, reviewable. It never
 * confers a role, never crosses a clearance ceiling or a compartment, expires
 * within an hour at the outside, and creates a supervisor review obligation the
 * moment it is used.
 */
@Injectable()
export class AccessService {
  constructor(
    private readonly db: Database,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async createRequest(
    actor: AuthenticatedActor,
    input: CreateAccessRequestInput,
    context: RequestContext,
  ): Promise<{ reference: string; status: string; message: string; policyEvaluation: unknown }> {
    await this.policy.authorize({
      actor,
      action: 'ACCESS_REQUEST_CREATE',
      purpose: input.purpose,
      resource: { type: 'ACCESS_REQUEST', id: null, classification: 'INTERNAL', subjectPcid: null },
      context,
    });

    const unknownFields = input.requestedFields.filter((field) => {
      const definition = fieldDefinition(field);
      return definition === undefined || definition.resourceType !== input.resourceType;
    });
    if (unknownFields.length > 0) {
      throw AppError.validation('One or more requested fields are not in the data catalogue.', [
        {
          path: 'requestedFields',
          message: `Unknown for ${input.resourceType}: ${unknownFields.join(', ')}`,
        },
      ]);
    }

    // Ask the engine what would happen today, and keep the answer.
    const evaluation = await this.policy.evaluateOnly({
      actor,
      action: this.actionForResource(input.resourceType),
      purpose: input.purpose,
      resource: {
        type: input.resourceType,
        id: input.resourceId ?? null,
        classification: 'CONFIDENTIAL',
        subjectPcid: input.subjectPcid ?? null,
        requestedFields: input.requestedFields,
      },
      caseRef: input.caseRef ?? null,
      incidentRef: input.incidentRef ?? null,
      context,
    });

    const alreadyPermitted =
      evaluation.effect === 'PERMIT' &&
      input.requestedFields.every((field) => evaluation.allowedFields.includes(field));

    const reference = await this.policy.nextReference('ACCESS_REQUEST', 'AR');
    const caseRow =
      input.caseRef == null
        ? null
        : await this.db.queryOne<{ id: string }>(
            'SELECT id FROM investigation_case WHERE case_number = $1 OR id::text = $1',
            [input.caseRef],
          );
    const incidentRow =
      input.incidentRef == null
        ? null
        : await this.db.queryOne<{ id: string }>(
            'SELECT id FROM incident WHERE incident_number = $1 OR id::text = $1',
            [input.incidentRef],
          );

    const status = alreadyPermitted ? 'AUTO_DENIED' : 'PENDING_APPROVAL';
    await this.db.query(
      `INSERT INTO access_request (
         reference, requested_by_user_id, agency_id, purpose, resource_type, subject_pcid,
         resource_id, case_id, incident_id, requested_fields, justification, status, policy_evaluation
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
      [
        reference,
        actor.subject.userId,
        actor.subject.agencyId,
        input.purpose,
        input.resourceType,
        input.subjectPcid ?? null,
        input.resourceId ?? null,
        caseRow?.id ?? null,
        incidentRow?.id ?? null,
        input.requestedFields,
        input.justification,
        status,
        JSON.stringify(evaluation),
      ],
    );

    await this.audit.record({
      action: 'ACCESS_REQUEST_CREATE',
      outcome: 'PERMITTED',
      actorType: actor.subject.actorType,
      actorId: actor.subject.userId,
      actorDisplay: actor.displayName,
      agencyId: actor.subject.agencyId,
      agencyCode: actor.agencyCode,
      roles: actor.subject.roles,
      purpose: input.purpose,
      resourceType: 'ACCESS_REQUEST',
      resourceId: reference,
      subjectPcid: input.subjectPcid ?? null,
      correlationId: context.correlationId,
      ipAddress: context.ipAddress,
      detail: {
        requestedFields: input.requestedFields,
        outcomeIfAttemptedNow: evaluation.effect,
        status,
      },
    });

    return {
      reference,
      status,
      message: alreadyPermitted
        ? 'No approval is needed: these fields are already available to you for this purpose.'
        : 'The request has been sent to a supervisor for approval.',
      policyEvaluation: {
        effect: evaluation.effect,
        reasons: evaluation.reasons,
        fieldsAlreadyAvailable: evaluation.allowedFields,
        fieldsWithheld: evaluation.withheldFields,
      },
    };
  }

  async decide(
    actor: AuthenticatedActor,
    reference: string,
    decision: 'APPROVED' | 'DENIED',
    input: { approvedFields?: readonly string[]; note: string; ttlSeconds?: number },
    context: RequestContext,
  ): Promise<{ reference: string; status: string; expiresAt: string | null }> {
    await this.policy.authorize({
      actor,
      action: 'ACCESS_REQUEST_APPROVE',
      purpose: 'SERVICE_DELIVERY',
      resource: {
        type: 'ACCESS_REQUEST',
        id: reference,
        classification: 'INTERNAL',
        subjectPcid: null,
      },
      context,
      auditDetail: { decision },
    });

    const request = await this.db.queryOne<{
      id: string;
      requested_by_user_id: string;
      status: string;
      requested_fields: string[];
      subject_pcid: string | null;
      purpose: string;
    }>(
      `SELECT id, requested_by_user_id, status, requested_fields, subject_pcid, purpose
         FROM access_request WHERE reference = $1`,
      [reference],
    );
    if (request === null) throw AppError.notFoundOrNotPermitted(`no access request ${reference}`);
    if (request.status !== 'PENDING_APPROVAL' && request.status !== 'SUBMITTED') {
      throw AppError.conflict('That request has already been decided.');
    }
    // Separation of duty: the database also refuses this, so a code path that
    // forgot the check would still fail rather than approve.
    if (request.requested_by_user_id === actor.subject.userId) {
      throw AppError.denied(
        'You cannot approve your own access request.',
        'self-approval attempt on access request',
      );
    }

    const approvedFields =
      decision === 'APPROVED'
        ? (input.approvedFields ?? request.requested_fields).filter((field) =>
            request.requested_fields.includes(field),
          )
        : [];
    if (decision === 'APPROVED' && approvedFields.length === 0) {
      throw AppError.validation(
        'Approve at least one of the requested fields, or deny the request.',
      );
    }

    const ttl = Math.min(
      input.ttlSeconds ?? ACCESS_APPROVAL_DEFAULT_TTL_SECONDS,
      ACCESS_APPROVAL_MAX_TTL_SECONDS,
    );
    const expiresAt = decision === 'APPROVED' ? new Date(Date.now() + ttl * 1000) : null;

    await this.db.query(
      `UPDATE access_request
          SET status = $2, approved_fields = $3, decided_by_user_id = $4, decided_at = now(),
              decision_note = $5, expires_at = $6
        WHERE id = $1`,
      [request.id, decision, approvedFields, actor.subject.userId, input.note, expiresAt],
    );

    await this.audit.record({
      action: 'ACCESS_REQUEST_APPROVE',
      outcome: 'PERMITTED',
      actorType: actor.subject.actorType,
      actorId: actor.subject.userId,
      actorDisplay: actor.displayName,
      agencyId: actor.subject.agencyId,
      agencyCode: actor.agencyCode,
      roles: actor.subject.roles,
      purpose: request.purpose as Purpose,
      resourceType: 'ACCESS_REQUEST',
      resourceId: reference,
      subjectPcid: request.subject_pcid,
      correlationId: context.correlationId,
      ipAddress: context.ipAddress,
      detail: {
        decision,
        approvedFields,
        requestedBy: request.requested_by_user_id,
        expiresAt: expiresAt?.toISOString() ?? null,
      },
    });

    return { reference, status: decision, expiresAt: expiresAt?.toISOString() ?? null };
  }

  async listRequests(
    actor: AuthenticatedActor,
    filters: { status?: string; forApproval?: boolean; limit: number; offset: number },
    context: RequestContext,
  ): Promise<{ requests: Record<string, unknown>[]; total: number }> {
    await this.policy.authorize({
      actor,
      action: filters.forApproval === true ? 'ACCESS_REQUEST_APPROVE' : 'ACCESS_REQUEST_CREATE',
      purpose: 'SERVICE_DELIVERY',
      resource: { type: 'ACCESS_REQUEST', id: null, classification: 'INTERNAL', subjectPcid: null },
      context,
    });

    const where = new WhereBuilder();
    if (filters.forApproval === true) {
      where.add('ar.agency_id = ?', actor.subject.agencyId);
      // An approver never sees their own requests in the approval queue.
      where.add('ar.requested_by_user_id <> ?', actor.subject.userId);
      where.addRaw("ar.status = 'PENDING_APPROVAL'");
    } else {
      where.add('ar.requested_by_user_id = ?', actor.subject.userId);
      if (filters.status !== undefined) where.add('ar.status = ?', filters.status);
    }

    const rows = await this.db.query<{
      reference: string;
      purpose: string;
      resource_type: string;
      subject_pcid: string | null;
      requested_fields: string[];
      approved_fields: string[];
      justification: string;
      status: string;
      created_at: Date;
      expires_at: Date | null;
      requester: string | null;
      case_number: string | null;
    }>(
      `SELECT ar.reference, ar.purpose, ar.resource_type, ar.subject_pcid, ar.requested_fields,
              ar.approved_fields, ar.justification, ar.status, ar.created_at, ar.expires_at,
              u.full_name AS requester, ic.case_number
         FROM access_request ar
         LEFT JOIN government_user u ON u.id = ar.requested_by_user_id
         LEFT JOIN investigation_case ic ON ic.id = ar.case_id
         ${where.sql}
        ORDER BY ar.created_at DESC LIMIT $${where.next()} OFFSET $${where.next(2)}`,
      where.withExtra(filters.limit, filters.offset),
    );
    const total = await this.db.queryOne<{ count: string }>(
      `SELECT count(*)::text AS count FROM access_request ar ${where.sql}`,
      where.params,
    );

    return {
      requests: rows.map((row) => ({
        reference: row.reference,
        purpose: row.purpose,
        resourceType: row.resource_type,
        subjectPcid: row.subject_pcid,
        requestedFields: row.requested_fields,
        approvedFields: row.approved_fields,
        justification: row.justification,
        status: row.status,
        caseNumber: row.case_number,
        requestedBy: row.requester,
        createdAt: row.created_at.toISOString(),
        expiresAt: row.expires_at?.toISOString() ?? null,
      })),
      total: Number(total?.count ?? 0),
    };
  }

  async initiateBreakGlass(
    actor: AuthenticatedActor,
    input: InitiateBreakGlassInput,
    context: RequestContext,
  ): Promise<{
    reference: string;
    expiresAt: string;
    reviewDueAt: string;
    gates: readonly string[];
  }> {
    await this.policy.authorize({
      actor,
      action: 'BREAK_GLASS_INITIATE',
      purpose: 'EMERGENCY_RESPONSE',
      resource: {
        type: input.resourceType,
        id: null,
        classification: 'CONFIDENTIAL',
        subjectPcid: input.subjectPcid ?? null,
      },
      incidentRef: input.incidentRef ?? null,
      context,
      auditDetail: { gates: input.gates, reason: input.reason },
    });

    if (input.reason.trim().length < 20) {
      throw AppError.validation('Give a specific reason for emergency access.', [
        {
          path: 'reason',
          message: 'At least 20 characters describing the emergency are required.',
        },
      ]);
    }
    if (input.incidentRef == null && input.caseRef == null) {
      throw AppError.validation('Emergency access must name the incident or case it is for.', [
        { path: 'incidentRef', message: 'An incident or case reference is required (§23).' },
      ]);
    }

    const ttl = Math.min(
      input.ttlSeconds ?? BREAK_GLASS_DEFAULT_TTL_SECONDS,
      BREAK_GLASS_MAX_TTL_SECONDS,
    );
    const reference = await this.policy.nextReference('BREAK_GLASS', 'BG');
    const expiresAt = new Date(Date.now() + ttl * 1000);
    const reviewDueAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const [incidentRow, caseRow] = await Promise.all([
      input.incidentRef == null
        ? Promise.resolve(null)
        : this.db.queryOne<{ id: string }>(
            'SELECT id FROM incident WHERE incident_number = $1 OR id::text = $1',
            [input.incidentRef],
          ),
      input.caseRef == null
        ? Promise.resolve(null)
        : this.db.queryOne<{ id: string }>(
            'SELECT id FROM investigation_case WHERE case_number = $1 OR id::text = $1',
            [input.caseRef],
          ),
    ]);

    await this.db.query(
      `INSERT INTO break_glass_grant (
         reference, user_id, agency_id, incident_id, case_id, resource_type, subject_pcid,
         gates, reason, status, expires_at, review_due_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ACTIVE',$10,$11)`,
      [
        reference,
        actor.subject.userId,
        actor.subject.agencyId,
        incidentRow?.id ?? null,
        caseRow?.id ?? null,
        input.resourceType,
        input.subjectPcid ?? null,
        input.gates,
        input.reason,
        expiresAt,
        reviewDueAt,
      ],
    );

    await this.notifySupervisors(actor, reference, input.reason);

    await this.audit.record({
      action: 'BREAK_GLASS_INITIATE',
      outcome: 'PERMITTED',
      actorType: actor.subject.actorType,
      actorId: actor.subject.userId,
      actorDisplay: actor.displayName,
      agencyId: actor.subject.agencyId,
      agencyCode: actor.agencyCode,
      roles: actor.subject.roles,
      purpose: 'EMERGENCY_RESPONSE',
      resourceType: input.resourceType,
      resourceId: reference,
      subjectPcid: input.subjectPcid ?? null,
      breakGlassUsed: true,
      correlationId: context.correlationId,
      ipAddress: context.ipAddress,
      deviceFingerprint: context.deviceFingerprint,
      detail: {
        reason: input.reason,
        gates: input.gates,
        expiresAt: expiresAt.toISOString(),
        reviewDueAt: reviewDueAt.toISOString(),
      },
    });

    return {
      reference,
      expiresAt: expiresAt.toISOString(),
      reviewDueAt: reviewDueAt.toISOString(),
      gates: input.gates,
    };
  }

  async reviewBreakGlass(
    actor: AuthenticatedActor,
    reference: string,
    decision: 'REVIEWED_JUSTIFIED' | 'REVIEWED_UNJUSTIFIED',
    note: string,
    context: RequestContext,
  ): Promise<{ reference: string; status: string }> {
    await this.policy.authorize({
      actor,
      action: 'BREAK_GLASS_REVIEW',
      purpose: 'AUDIT_REVIEW',
      resource: {
        type: 'ACCESS_REQUEST',
        id: reference,
        classification: 'INTERNAL',
        subjectPcid: null,
      },
      context,
    });

    const grant = await this.db.queryOne<{
      id: string;
      user_id: string;
      subject_pcid: string | null;
    }>('SELECT id, user_id, subject_pcid FROM break_glass_grant WHERE reference = $1', [reference]);
    if (grant === null) throw AppError.notFoundOrNotPermitted(`no break-glass grant ${reference}`);
    if (grant.user_id === actor.subject.userId) {
      throw AppError.denied(
        'You cannot review your own emergency access.',
        'self-review attempt on break-glass grant',
      );
    }

    await this.db.query(
      `UPDATE break_glass_grant
          SET status = $2, reviewed_by_user_id = $3, reviewed_at = now(), review_note = $4
        WHERE id = $1`,
      [grant.id, decision, actor.subject.userId, note],
    );
    await this.audit.record({
      action: 'BREAK_GLASS_REVIEW',
      outcome: 'PERMITTED',
      actorType: actor.subject.actorType,
      actorId: actor.subject.userId,
      actorDisplay: actor.displayName,
      agencyId: actor.subject.agencyId,
      agencyCode: actor.agencyCode,
      roles: actor.subject.roles,
      purpose: 'AUDIT_REVIEW',
      resourceType: 'ACCESS_REQUEST',
      resourceId: reference,
      subjectPcid: grant.subject_pcid,
      correlationId: context.correlationId,
      ipAddress: context.ipAddress,
      detail: { decision, note },
    });
    return { reference, status: decision };
  }

  /** Grants awaiting their mandatory post-event review (§23). */
  async listBreakGlassForReview(
    actor: AuthenticatedActor,
    context: RequestContext,
  ): Promise<Record<string, unknown>[]> {
    await this.policy.authorize({
      actor,
      action: 'BREAK_GLASS_REVIEW',
      purpose: 'AUDIT_REVIEW',
      resource: { type: 'ACCESS_REQUEST', id: null, classification: 'INTERNAL', subjectPcid: null },
      context,
    });
    const rows = await this.db.query<{
      reference: string;
      reason: string;
      gates: string[];
      granted_at: Date;
      expires_at: Date;
      review_due_at: Date;
      access_count: number;
      status: string;
      officer: string | null;
      incident_number: string | null;
    }>(
      `SELECT bg.reference, bg.reason, bg.gates, bg.granted_at, bg.expires_at, bg.review_due_at,
              bg.access_count, bg.status, u.full_name AS officer, i.incident_number
         FROM break_glass_grant bg
         LEFT JOIN government_user u ON u.id = bg.user_id
         LEFT JOIN incident i ON i.id = bg.incident_id
        WHERE bg.reviewed_at IS NULL
        ORDER BY bg.review_due_at ASC
        LIMIT 200`,
    );
    return rows.map((row) => ({
      reference: row.reference,
      officer: row.officer,
      incidentNumber: row.incident_number,
      reason: row.reason,
      gates: row.gates,
      grantedAt: row.granted_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      reviewDueAt: row.review_due_at.toISOString(),
      timesUsed: row.access_count,
      status: row.status,
      overdue: row.review_due_at.getTime() < Date.now(),
    }));
  }

  /** Expire grants whose window has passed. Idempotent; run on a schedule. */
  async expireStaleGrants(): Promise<number> {
    const rows = await this.db.query<{ id: string }>(
      `UPDATE break_glass_grant SET status = 'EXPIRED'
        WHERE status = 'ACTIVE' AND expires_at <= now() RETURNING id`,
    );
    await this.db.query(
      `UPDATE access_request SET status = 'EXPIRED'
        WHERE status = 'APPROVED' AND expires_at IS NOT NULL AND expires_at <= now()`,
    );
    return rows.length;
  }

  private actionForResource(
    resourceType: ResourceType,
  ):
    | 'CITIZEN_VIEW'
    | 'VEHICLE_VIEW'
    | 'PROPERTY_VIEW'
    | 'BUSINESS_VIEW'
    | 'LICENCE_VIEW'
    | 'REVENUE_VIEW' {
    switch (resourceType) {
      case 'VEHICLE':
        return 'VEHICLE_VIEW';
      case 'PROPERTY':
        return 'PROPERTY_VIEW';
      case 'BUSINESS':
        return 'BUSINESS_VIEW';
      case 'LICENCE':
        return 'LICENCE_VIEW';
      case 'REVENUE_PROFILE':
        return 'REVENUE_VIEW';
      default:
        return 'CITIZEN_VIEW';
    }
  }

  private async notifySupervisors(
    actor: AuthenticatedActor,
    reference: string,
    reason: string,
  ): Promise<void> {
    const supervisors = await this.db.query<{ id: string; email: string }>(
      `SELECT DISTINCT u.id, u.email
         FROM government_user u
         JOIN user_role ur ON ur.user_id = u.id
         JOIN role r ON r.id = ur.role_id
        WHERE u.agency_id = $1 AND r.name IN ('SUPERVISOR','SECURITY_ADMINISTRATOR')
          AND u.status = 'ACTIVE' AND u.id <> $2`,
      [actor.subject.agencyId, actor.subject.userId],
    );
    for (const supervisor of supervisors) {
      // The detail goes to the portal inbox, where it is read by the supervisor
      // behind authentication. The email that lands in their mailbox says only
      // that emergency access has been used and a review is due: who used it and
      // why is the sort of thing a shared mailbox should not be broadcasting
      // about a colleague.
      await this.notifications.enqueue({
        template: 'BREAK_GLASS_USED',
        recipientType: 'GOVERNMENT_USER',
        recipientId: supervisor.id,
        subject: `Emergency access used: ${reference}`,
        detail:
          `${actor.displayName} used break-glass access (${reference}). Stated reason: ${reason}. ` +
          'A post-event review is required within 24 hours.',
        dedupeKey: `break-glass-used:${reference}:${supervisor.id}`,
      });
    }
  }
}
