import { Inject, Injectable } from '@nestjs/common';
import type { Action, Purpose } from '@pcid/contracts';
import { SEARCH_ACTIONS, evaluate } from '@pcid/policy';
import type {
  AccessApproval,
  BreakGlassGrant,
  CaseContext,
  IncidentContext,
  PolicyDecision,
  PolicyResource,
} from '@pcid/policy';

import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { RequestContext } from '../common/correlation';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { Database } from '../database/pool';
import type { AuthenticatedActor } from '../iam/actor';
import { RateLimiter } from '../security/rate-limit';

export interface AuthorizationRequest {
  readonly actor: AuthenticatedActor;
  readonly action: Action;
  readonly purpose: Purpose;
  readonly resource: PolicyResource;
  /** Case number (CASE-2026-00928) or case id supplied by the caller. */
  readonly caseRef?: string | null;
  /** Incident number (INC-2026-000123) or incident id supplied by the caller. */
  readonly incidentRef?: string | null;
  /** Break-glass grant reference the caller is relying on. */
  readonly breakGlassRef?: string | null;
  readonly context: RequestContext;
  /** Extra detail for the audit record. Never citizen data. */
  readonly auditDetail?: Record<string, unknown>;
}

export interface AuthorizationOutcome {
  readonly decision: PolicyDecision;
  readonly caseContext: CaseContext | null;
  readonly incidentContext: IncidentContext | null;
  readonly breakGlass: BreakGlassGrant | null;
  readonly auditEventId: string;
}

/**
 * The policy enforcement point.
 *
 * Every route that touches a record goes through `authorize`. It gathers the
 * evidence the engine needs from the database, asks the engine (which decides
 * without I/O), writes the audit record for the outcome whether permitted or
 * denied, and discharges the obligations the decision carries.
 *
 * Two ordering choices matter here:
 *
 *  - the audit record is written *before* the caller is told the answer, so an
 *    access can never occur without its record existing;
 *  - a denial raises an error that does not distinguish "no such record" from
 *    "not for you", while the audit row keeps the precise reason.
 */
@Injectable()
export class PolicyService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: Database,
    private readonly audit: AuditService,
    private readonly limiter: RateLimiter,
  ) {}

  async authorize(request: AuthorizationRequest): Promise<AuthorizationOutcome> {
    const { actor, action, purpose, resource, context } = request;

    if (SEARCH_ACTIONS.has(action)) {
      await this.enforceSearchLimits(actor, action, context);
    }

    const [caseContext, incidentContext, breakGlass, approvals] = await Promise.all([
      this.loadCase(request.caseRef ?? null),
      this.loadIncident(request.incidentRef ?? null),
      this.loadBreakGlass(actor.subject.userId, request.breakGlassRef ?? null),
      this.loadApprovals(actor.subject.userId, purpose, resource),
    ]);

    const decision = evaluate({
      subject: actor.subject,
      action,
      purpose,
      resource,
      caseContext,
      incidentContext,
      breakGlass,
      approvals,
      now: new Date(),
    });

    const auditEventId = await this.audit.recordDecision(
      {
        action,
        actorType: actor.subject.actorType,
        actorId: actor.subject.userId,
        actorDisplay: actor.displayName,
        agencyId: actor.subject.agencyId,
        agencyCode: actor.agencyCode,
        roles: actor.subject.roles,
        purpose,
        resourceType: resource.type,
        resourceId: resource.id,
        subjectPcid: resource.subjectPcid ?? null,
        caseId: caseContext?.caseId ?? null,
        caseNumber: caseContext?.caseNumber ?? null,
        incidentId: incidentContext?.incidentId ?? null,
        incidentNumber: incidentContext?.incidentNumber ?? null,
        breakGlassId: decision.breakGlassUsed ? (breakGlass?.grantId ?? null) : null,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        deviceFingerprint: context.deviceFingerprint,
        correlationId: context.correlationId,
        detail: request.auditDetail ?? {},
      },
      decision,
    );

    if (decision.effect === 'DENY') {
      throw this.denialError(decision);
    }

    await this.dischargeObligations(request, decision, breakGlass, auditEventId);

    return { decision, caseContext, incidentContext, breakGlass, auditEventId };
  }

  /**
   * Evaluate without enforcing. Used by the Citizen 360 view, which asks about
   * many cards at once and renders "Restricted information" for the ones that
   * come back denied rather than failing the whole page (§29).
   */
  async evaluateOnly(request: AuthorizationRequest): Promise<PolicyDecision> {
    const [caseContext, incidentContext, breakGlass, approvals] = await Promise.all([
      this.loadCase(request.caseRef ?? null),
      this.loadIncident(request.incidentRef ?? null),
      this.loadBreakGlass(request.actor.subject.userId, request.breakGlassRef ?? null),
      this.loadApprovals(request.actor.subject.userId, request.purpose, request.resource),
    ]);
    return evaluate({
      subject: request.actor.subject,
      action: request.action,
      purpose: request.purpose,
      resource: request.resource,
      caseContext,
      incidentContext,
      breakGlass,
      approvals,
      now: new Date(),
    });
  }

  private denialError(decision: PolicyDecision): AppError {
    const reason = decision.reasons[0];
    const internal = reason ? `${reason.gate}:${reason.code}` : 'DENIED';
    switch (reason?.code) {
      case 'CASE_REFERENCE_REQUIRED':
        return new AppError('CASE_REFERENCE_REQUIRED', reason.message, {
          internalReason: internal,
        });
      case 'INCIDENT_REFERENCE_REQUIRED':
        return new AppError('INCIDENT_REFERENCE_REQUIRED', reason.message, {
          internalReason: internal,
        });
      case 'STEP_UP_REQUIRED':
        return new AppError('STEP_UP_REQUIRED', reason.message, { internalReason: internal });
      case 'MFA_NOT_ENROLLED':
        return new AppError('MFA_REQUIRED', reason.message, { internalReason: internal });
      case 'FIELD_REQUIRES_APPROVAL':
        return new AppError('APPROVAL_REQUIRED', reason.message, { internalReason: internal });
      case 'RECORD_NOT_LINKED_TO_CASE':
      case 'CASE_NOT_ACTIVE':
      case 'INCIDENT_NOT_ACTIVE':
      case 'OUTSIDE_JURISDICTION_LGA':
      case 'OUTSIDE_JURISDICTION_WARD':
        // Reachable only by someone who already holds the case or incident, so
        // telling them what is missing leaks nothing and lets them put it right.
        return AppError.denied(reason.message, internal);
      // NOT_ASSIGNED_TO_CASE and NOT_ASSIGNED_TO_INCIDENT deliberately fall
      // through to the opaque answer below: naming them would confirm to an
      // officer outside the case that the case exists.
      default:
        // Anything else is answered without revealing whether the record exists.
        return AppError.notFoundOrNotPermitted(internal);
    }
  }

  private async dischargeObligations(
    request: AuthorizationRequest,
    decision: PolicyDecision,
    breakGlass: BreakGlassGrant | null,
    auditEventId: string,
  ): Promise<void> {
    for (const obligation of decision.obligations) {
      if (obligation.kind === 'NOTIFY_SUPERVISOR' && breakGlass !== null) {
        await this.db.query(
          'UPDATE break_glass_grant SET access_count = access_count + 1 WHERE id = $1',
          [breakGlass.grantId],
        );
        await this.raiseBreakGlassAlert(request, breakGlass, obligation.reason, auditEventId);
      }
    }
  }

  private async raiseBreakGlassAlert(
    request: AuthorizationRequest,
    breakGlass: BreakGlassGrant,
    reason: string,
    auditEventId: string,
  ): Promise<void> {
    const reference = await this.nextReference('ALERT');
    await this.db.query(
      `INSERT INTO alert (
         reference, rule_key, category, severity, title, summary, explanation,
         subject_type, subject_id, subject_pcid, agency_id, classification, status
       ) VALUES ($1,'BREAK_GLASS_INITIATED','SECURITY','HIGH',$2,$3,$4::jsonb,$5,$6,$7,$8,'SENSITIVE','OPEN')`,
      [
        reference,
        'Break-glass access used',
        `Emergency access was relied upon under grant ${breakGlass.grantId}. A supervisor review is required.`,
        JSON.stringify({
          reason,
          auditEventId,
          grantReference: breakGlass.grantId,
          expiresAt: breakGlass.expiresAt.toISOString(),
          gates: breakGlass.gates,
        }),
        request.resource.type,
        request.resource.id,
        request.resource.subjectPcid ?? null,
        request.actor.subject.agencyId,
      ],
    );
  }

  /**
   * Search-abuse prevention (§63). Two limits apply: a hard per-minute ceiling
   * that refuses the request, and a slower rolling threshold that raises a
   * security alert for review without blocking legitimate bulk work.
   */
  private async enforceSearchLimits(
    actor: AuthenticatedActor,
    action: Action,
    context: RequestContext,
  ): Promise<void> {
    const hard = await this.limiter.consume(
      `search:${actor.subject.userId}:${action}`,
      this.env.RATE_LIMIT_SEARCH_MAX,
      this.env.RATE_LIMIT_WINDOW_SECONDS,
      { failClosed: true },
    );
    if (!hard.allowed) {
      await this.audit.record({
        action,
        outcome: 'DENIED',
        actorType: actor.subject.actorType,
        actorId: actor.subject.userId,
        actorDisplay: actor.displayName,
        agencyId: actor.subject.agencyId,
        agencyCode: actor.agencyCode,
        roles: actor.subject.roles,
        resourceType: 'CITIZEN',
        correlationId: context.correlationId,
        ipAddress: context.ipAddress,
        decisionReasons: [
          {
            gate: 'RBAC',
            code: 'SEARCH_RATE_LIMIT',
            message: 'The per-minute search ceiling for this account was exceeded.',
          },
        ],
      });
      throw new AppError('RATE_LIMITED', 'Too many searches. Wait a moment and try again.');
    }

    const rolling = await this.limiter.consume(
      `search-volume:${actor.subject.userId}`,
      Number.MAX_SAFE_INTEGER,
      this.env.SEARCH_VOLUME_WINDOW_SECONDS,
    );
    if (rolling.count === this.env.SEARCH_VOLUME_ALERT_THRESHOLD) {
      const reference = await this.nextReference('ALERT');
      await this.db.query(
        `INSERT INTO alert (
           reference, rule_key, category, severity, title, summary, explanation,
           subject_type, subject_id, agency_id, classification, status
         ) VALUES ($1,'UNUSUAL_SEARCH_VOLUME','SECURITY','MEDIUM',$2,$3,$4::jsonb,
                   'GOVERNMENT_USER',$5,$6,'INTERNAL','OPEN')`,
        [
          reference,
          'Unusual search volume',
          'An account performed an unusually large number of citizen searches in a short period. Review whether the activity matches assigned work.',
          JSON.stringify({
            factorsConsidered: ['search count in rolling window', 'configured threshold'],
            observedCount: rolling.count,
            threshold: this.env.SEARCH_VOLUME_ALERT_THRESHOLD,
            windowSeconds: this.env.SEARCH_VOLUME_WINDOW_SECONDS,
            note: 'This describes account activity, not the person searched for.',
          }),
          actor.subject.userId,
          actor.subject.agencyId,
        ],
      );
    }
  }

  private async loadCase(reference: string | null): Promise<CaseContext | null> {
    if (reference === null || reference.trim() === '') return null;
    const row = await this.db.queryOne<{
      id: string;
      case_number: string;
      type: string;
      status: string;
      classification: string;
      agency_id: string;
    }>(
      `SELECT id, case_number, type, status, classification, agency_id
         FROM investigation_case
        WHERE case_number = $1 OR (id::text = $1)`,
      [reference],
    );
    if (row === null) return null;

    const assignments = await this.db.query<{ user_id: string; role: string }>(
      `SELECT user_id, role FROM case_assignment
        WHERE case_id = $1 AND released_at IS NULL`,
      [row.id],
    );
    return {
      caseId: row.id,
      caseNumber: row.case_number,
      caseType: row.type as CaseContext['caseType'],
      status: row.status as CaseContext['status'],
      classification: row.classification as CaseContext['classification'],
      agencyId: row.agency_id,
      assignedUserIds: assignments
        .filter((assignment) => assignment.role !== 'SUPERVISOR')
        .map((assignment) => assignment.user_id),
      supervisorUserIds: assignments
        .filter((assignment) => assignment.role === 'SUPERVISOR')
        .map((assignment) => assignment.user_id),
    };
  }

  private async loadIncident(reference: string | null): Promise<IncidentContext | null> {
    if (reference === null || reference.trim() === '') return null;
    const row = await this.db.queryOne<{
      id: string;
      incident_number: string;
      status: string;
      lga_code: string | null;
      ward_code: string | null;
    }>(
      `SELECT id, incident_number, status, lga_code, ward_code
         FROM incident WHERE incident_number = $1 OR (id::text = $1)`,
      [reference],
    );
    if (row === null) return null;

    const [agencies, officers] = await Promise.all([
      this.db.query<{ agency_id: string }>(
        'SELECT agency_id FROM incident_agency WHERE incident_id = $1',
        [row.id],
      ),
      this.db.query<{ user_id: string }>(
        'SELECT user_id FROM incident_officer WHERE incident_id = $1 AND released_at IS NULL',
        [row.id],
      ),
    ]);
    return {
      incidentId: row.id,
      incidentNumber: row.incident_number,
      status: row.status as IncidentContext['status'],
      assignedAgencyIds: agencies.map((agency) => agency.agency_id),
      assignedUserIds: officers.map((officer) => officer.user_id),
      lgaCode: row.lga_code,
      wardCode: row.ward_code,
    };
  }

  private async loadBreakGlass(
    userId: string,
    reference: string | null,
  ): Promise<BreakGlassGrant | null> {
    if (reference === null || reference.trim() === '') return null;
    const row = await this.db.queryOne<{
      id: string;
      user_id: string;
      status: string;
      expires_at: Date;
      resource_type: string;
      subject_pcid: string | null;
      incident_id: string | null;
      case_id: string | null;
      gates: string[];
    }>(
      `SELECT id, user_id, status, expires_at, resource_type, subject_pcid, incident_id, case_id, gates
         FROM break_glass_grant
        WHERE (reference = $1 OR id::text = $1) AND user_id = $2`,
      [reference, userId],
    );
    if (row === null) return null;
    return {
      grantId: row.id,
      userId: row.user_id,
      status: row.status as BreakGlassGrant['status'],
      expiresAt: row.expires_at,
      resourceType: row.resource_type as BreakGlassGrant['resourceType'],
      subjectPcid: row.subject_pcid,
      incidentId: row.incident_id,
      caseId: row.case_id,
      gates: row.gates as BreakGlassGrant['gates'],
    };
  }

  private async loadApprovals(
    userId: string,
    purpose: Purpose,
    resource: PolicyResource,
  ): Promise<readonly AccessApproval[]> {
    const rows = await this.db.query<{
      id: string;
      requested_by_user_id: string;
      expires_at: Date;
      resource_type: string;
      subject_pcid: string | null;
      case_id: string | null;
      purpose: string;
      approved_fields: string[];
      reference: string;
    }>(
      `SELECT id, reference, requested_by_user_id, expires_at, resource_type, subject_pcid,
              case_id, purpose, approved_fields
         FROM access_request
        WHERE requested_by_user_id = $1
          AND status = 'APPROVED'
          AND expires_at > now()
          AND revoked_at IS NULL
          AND resource_type = $2
          AND purpose = $3
          AND (subject_pcid IS NULL OR subject_pcid = $4)`,
      [userId, resource.type, purpose, resource.subjectPcid ?? null],
    );
    return rows.map((row) => ({
      accessRequestId: row.reference,
      userId: row.requested_by_user_id,
      status: 'APPROVED' as const,
      expiresAt: row.expires_at,
      resourceType: row.resource_type as AccessApproval['resourceType'],
      subjectPcid: row.subject_pcid,
      caseId: row.case_id,
      purpose: row.purpose as Purpose,
      approvedFields: row.approved_fields,
    }));
  }

  async nextReference(scope: string, prefix = scope): Promise<string> {
    const year = new Date().getUTCFullYear().toString();
    const row = await this.db.queryOne<{ next_reference: string }>(
      'SELECT next_reference($1, $2) AS next_reference',
      [scope, year],
    );
    const value = Number(row?.next_reference ?? 1);
    const width = scope === 'INCIDENT' ? 6 : 5;
    return `${prefix}-${year}-${String(value).padStart(width, '0')}`;
  }
}
