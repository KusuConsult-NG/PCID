import { Injectable } from '@nestjs/common';
import type {
  Action,
  AuditActorType,
  AuditCitizenVisibility,
  AuditOutcome,
  Purpose,
  ResourceType,
} from '@pcid/contracts';
import type { PolicyDecision } from '@pcid/policy';

import { AppError } from '../common/errors';
import { logger } from '../common/logger';
import { Database } from '../database/pool';
import type { QueryRunner } from '../database/pool';

export interface AuditWrite {
  readonly action: Action | string;
  readonly outcome: AuditOutcome;
  readonly actorType: AuditActorType;
  readonly actorId?: string | null;
  readonly actorDisplay?: string | null;
  readonly agencyId?: string | null;
  readonly agencyCode?: string | null;
  readonly roles?: readonly string[];
  readonly purpose?: Purpose | null;
  readonly resourceType: ResourceType | string;
  readonly resourceId?: string | null;
  readonly subjectPcid?: string | null;
  readonly caseId?: string | null;
  readonly caseNumber?: string | null;
  readonly incidentId?: string | null;
  readonly incidentNumber?: string | null;
  readonly fieldsReleased?: readonly string[];
  readonly fieldsWithheld?: readonly { field: string; gate: string; code: string }[];
  readonly decisionReasons?: readonly { gate: string; code: string; message: string }[];
  readonly breakGlassUsed?: boolean;
  readonly breakGlassId?: string | null;
  readonly approvalsUsed?: readonly string[];
  readonly citizenVisibility?: AuditCitizenVisibility;
  readonly restrictionBasis?: string | null;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
  readonly deviceFingerprint?: string | null;
  readonly correlationId: string;
  readonly detail?: Record<string, unknown>;
}

/**
 * Decide whether an event appears in the citizen's own access history (§26).
 *
 * A caller may state this explicitly. When it does not, the purpose decides, and
 * an access made under a criminal investigation is withheld with a stated basis -
 * so a module that simply forgets cannot tip off the subject of an investigation.
 * Withholding is never silent: the basis travels into the record for the Data
 * Protection Officer to review.
 */
export function resolveCitizenVisibility(event: {
  readonly purpose?: Purpose | null;
  readonly citizenVisibility?: AuditCitizenVisibility;
  readonly restrictionBasis?: string | null;
}): { visibility: AuditCitizenVisibility; restrictionBasis: string | null } {
  const implied: AuditCitizenVisibility =
    event.purpose === 'CRIMINAL_INVESTIGATION'
      ? 'ACCESS_RESTRICTED_FROM_CITIZEN'
      : 'ACCESS_VISIBLE_TO_CITIZEN';
  const visibility = event.citizenVisibility ?? implied;
  if (visibility === 'ACCESS_VISIBLE_TO_CITIZEN') {
    return { visibility, restrictionBasis: null };
  }
  return {
    visibility,
    restrictionBasis:
      event.restrictionBasis ??
      'Access made under an active criminal investigation; disclosure to the data subject is ' +
        'deferred pending case closure and review by the Data Protection Officer.',
  };
}

export interface AuditEventRow {
  seq: string;
  id: string;
  occurred_at: Date;
  action: string;
  outcome: string;
  actor_type: string;
  actor_id: string | null;
  actor_display: string | null;
  agency_id: string | null;
  agency_code: string | null;
  purpose: string | null;
  resource_type: string;
  resource_id: string | null;
  subject_pcid: string | null;
  case_number: string | null;
  incident_number: string | null;
  fields_released: string[];
  fields_withheld: unknown;
  decision_reasons: unknown;
  break_glass_used: boolean;
  citizen_visibility: string;
  restriction_basis: string | null;
  correlation_id: string;
  detail: Record<string, unknown>;
}

/**
 * The audit trail (master system prompt §25, §26).
 *
 * Two properties this service is responsible for:
 *
 *  1. **No unaudited access.** A failure to write the audit record fails the
 *     request. The platform would rather refuse a lookup than perform one it
 *     cannot account for, so `record` throws rather than logging and continuing.
 *
 *  2. **Correct attribution.** Denials are audited as carefully as permits - an
 *     attempt that was refused is exactly what an oversight review needs to see.
 *
 * The hash chain that makes the record tamper-evident is computed by the database
 * on insert, so the application cannot choose its own predecessor.
 */
@Injectable()
export class AuditService {
  constructor(private readonly db: Database) {}

  async record(event: AuditWrite, runner?: QueryRunner): Promise<string> {
    const target = runner ?? this.db;
    const { visibility, restrictionBasis } = resolveCitizenVisibility(event);

    try {
      const row = await target.queryOne<{ id: string }>(
        `INSERT INTO audit_event (
           action, outcome, actor_type, actor_id, actor_display, agency_id, agency_code, roles,
           purpose, resource_type, resource_id, subject_pcid, case_id, case_number,
           incident_id, incident_number, fields_released, fields_withheld, decision_reasons,
           break_glass_used, break_glass_id, approvals_used, citizen_visibility, restriction_basis,
           ip_address, user_agent, device_fingerprint, correlation_id, detail, prev_hash, hash
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19::jsonb,
           $20,$21,$22,$23,$24,$25,$26,$27,$28,$29::jsonb,'','' )
         RETURNING id`,
        [
          event.action,
          event.outcome,
          event.actorType,
          event.actorId ?? null,
          event.actorDisplay ?? null,
          event.agencyId ?? null,
          event.agencyCode ?? null,
          event.roles ?? [],
          event.purpose ?? null,
          event.resourceType,
          event.resourceId ?? null,
          event.subjectPcid ?? null,
          event.caseId ?? null,
          event.caseNumber ?? null,
          event.incidentId ?? null,
          event.incidentNumber ?? null,
          event.fieldsReleased ?? [],
          JSON.stringify(event.fieldsWithheld ?? []),
          JSON.stringify(event.decisionReasons ?? []),
          event.breakGlassUsed ?? false,
          event.breakGlassId ?? null,
          event.approvalsUsed ?? [],
          visibility,
          restrictionBasis,
          event.ipAddress ?? null,
          event.userAgent ?? null,
          event.deviceFingerprint ?? null,
          event.correlationId,
          JSON.stringify(event.detail ?? {}),
        ],
      );
      if (row === null) throw new Error('audit insert returned no row');
      return row.id;
    } catch (error) {
      logger.error('audit_write_failed', {
        correlationId: event.correlationId,
        action: String(event.action),
        message: (error as Error).message,
      });
      throw new AppError('INTERNAL_ERROR', 'The request could not be completed.', {
        internalReason: `audit write failed: ${(error as Error).message}`,
        cause: error,
      });
    }
  }

  /** Convenience: record the outcome of a policy decision. */
  async recordDecision(
    base: Omit<
      AuditWrite,
      | 'outcome'
      | 'fieldsReleased'
      | 'fieldsWithheld'
      | 'decisionReasons'
      | 'breakGlassUsed'
      | 'approvalsUsed'
      | 'citizenVisibility'
      | 'restrictionBasis'
    >,
    decision: PolicyDecision,
    runner?: QueryRunner,
  ): Promise<string> {
    const restriction = decision.obligations.find(
      (obligation) => obligation.kind === 'RESTRICT_FROM_CITIZEN',
    );
    return this.record(
      {
        ...base,
        outcome: decision.effect === 'PERMIT' ? 'PERMITTED' : 'DENIED',
        fieldsReleased: decision.allowedFields,
        fieldsWithheld: decision.withheldFields,
        decisionReasons: decision.reasons,
        breakGlassUsed: decision.breakGlassUsed,
        approvalsUsed: decision.approvalsUsed,
        citizenVisibility: decision.citizenVisibility,
        restrictionBasis:
          restriction && 'legalBasis' in restriction ? restriction.legalBasis : null,
      },
      runner,
    );
  }

  /**
   * The citizen's own access history (§26). Only events marked visible are
   * returned; a restricted event is not listed and its existence is not implied.
   */
  async citizenAccessHistory(
    pcid: string,
    options: { limit: number; offset: number },
  ): Promise<{ rows: AuditEventRow[]; total: number }> {
    const rows = await this.db.query<AuditEventRow>(
      `SELECT seq, id, occurred_at, action, outcome, actor_type, actor_display,
              agency_id, agency_code, purpose, resource_type, citizen_visibility,
              correlation_id
         FROM audit_event
        WHERE subject_pcid = $1
          AND citizen_visibility = 'ACCESS_VISIBLE_TO_CITIZEN'
          AND outcome = 'PERMITTED'
        ORDER BY occurred_at DESC
        LIMIT $2 OFFSET $3`,
      [pcid, options.limit, options.offset],
    );
    const total = await this.db.queryOne<{ count: string }>(
      `SELECT count(*)::text AS count FROM audit_event
        WHERE subject_pcid = $1
          AND citizen_visibility = 'ACCESS_VISIBLE_TO_CITIZEN'
          AND outcome = 'PERMITTED'`,
      [pcid],
    );
    return { rows, total: Number(total?.count ?? 0) };
  }

  async search(filters: {
    actorId?: string | null;
    agencyId?: string | null;
    subjectPcid?: string | null;
    action?: string | null;
    outcome?: string | null;
    from?: string | null;
    to?: string | null;
    breakGlassOnly?: boolean;
    limit: number;
    offset: number;
  }): Promise<{ rows: AuditEventRow[]; total: number }> {
    const clauses: string[] = [];
    const values: unknown[] = [];
    const add = (sql: string, value: unknown): void => {
      values.push(value);
      clauses.push(sql.replace('$?', `$${values.length}`));
    };
    if (filters.actorId) add('actor_id = $?', filters.actorId);
    if (filters.agencyId) add('agency_id = $?', filters.agencyId);
    if (filters.subjectPcid) add('subject_pcid = $?', filters.subjectPcid);
    if (filters.action) add('action = $?', filters.action);
    if (filters.outcome) add('outcome = $?', filters.outcome);
    if (filters.from) add('occurred_at >= $?', filters.from);
    if (filters.to) add('occurred_at <= $?', filters.to);
    if (filters.breakGlassOnly === true) clauses.push('break_glass_used');

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = await this.db.query<AuditEventRow>(
      `SELECT seq, id, occurred_at, action, outcome, actor_type, actor_id, actor_display,
              agency_id, agency_code, purpose, resource_type, resource_id, subject_pcid,
              case_number, incident_number, fields_released, fields_withheld, decision_reasons,
              break_glass_used, citizen_visibility, restriction_basis, correlation_id, detail
         FROM audit_event ${where}
        ORDER BY seq DESC
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, filters.limit, filters.offset],
    );
    const total = await this.db.queryOne<{ count: string }>(
      `SELECT count(*)::text AS count FROM audit_event ${where}`,
      values,
    );
    return { rows, total: Number(total?.count ?? 0) };
  }

  /** Walk the hash chain and report any break (§25). */
  async verifyChain(from = 1, to?: number): Promise<{ intact: boolean; problems: unknown[] }> {
    const problems = await this.db.query(
      'SELECT seq, id, problem FROM verify_audit_chain($1, $2)',
      [from, to ?? null],
    );
    return { intact: problems.length === 0, problems };
  }
}
