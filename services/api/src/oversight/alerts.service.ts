import { Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../common/correlation';
import { AppError } from '../common/errors';
import { WhereBuilder } from '../common/sql';
import { Database } from '../database/pool';
import type { AuthenticatedActor } from '../iam/actor';
import { PolicyService } from '../policy/policy.service';

export type AlertDecision = 'ACTIONED' | 'DISMISSED_FALSE_POSITIVE' | 'CLOSED';

interface AlertRow {
  id: string;
  reference: string;
  rule_key: string;
  category: string;
  severity: string;
  title: string;
  summary: string;
  explanation: Record<string, unknown>;
  confidence: string | null;
  subject_type: string | null;
  subject_id: string | null;
  subject_pcid: string | null;
  agency_name: string | null;
  status: string;
  review_note: string | null;
  reviewed_at: Date | null;
  reviewer_name: string | null;
  created_at: Date;
}

/**
 * The alert queue and its review (§32, §65, §67).
 *
 * Alerts were being raised from four places and read from none: `ALERT_VIEW`
 * and `ALERT_REVIEW` were granted to five roles with no route behind either, so
 * every alert the platform raised went nowhere. Detection that nobody can see is
 * not detection.
 *
 * Two things this deliberately does. It always returns the explanation - the
 * factors and the confidence that produced the alert - because "why am I seeing
 * this?" must be answerable by the person being asked to act on it. And it
 * carries the subject's identifier but never their record: an alert names an
 * event, and reading the person behind it is a separate, separately authorised
 * act under a stated purpose.
 */
@Injectable()
export class AlertsService {
  constructor(
    private readonly db: Database,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
  ) {}

  async list(
    actor: AuthenticatedActor,
    options: {
      status?: string;
      category?: string;
      severity?: string;
      limit: number;
      offset: number;
    },
    context: RequestContext,
  ): Promise<{ total: number; alerts: Record<string, unknown>[] }> {
    await this.policy.authorize({
      actor,
      action: 'ALERT_VIEW',
      purpose: 'AUDIT_REVIEW',
      resource: { type: 'ALERT', id: null, classification: 'SENSITIVE', subjectPcid: null },
      context,
      auditDetail: { view: 'ALERT_QUEUE', status: options.status ?? 'ALL' },
    });

    const where = new WhereBuilder();
    if (options.status !== undefined) where.add('a.status = ?', options.status);
    if (options.category !== undefined) where.add('a.category = ?', options.category);
    if (options.severity !== undefined) where.add('a.severity = ?', options.severity);

    const rows = await this.db.query<AlertRow>(
      `${this.selectClause} ${where.sql}
        ORDER BY CASE a.severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2
                                 WHEN 'LOW' THEN 3 ELSE 4 END,
                 a.created_at DESC
        LIMIT $${where.next()} OFFSET $${where.next(2)}`,
      where.withExtra(options.limit, options.offset),
    );
    const total = await this.db.queryOne<{ count: string }>(
      `SELECT count(*)::text AS count FROM alert a ${where.sql}`,
      [...where.params],
    );

    return { total: Number(total?.count ?? 0), alerts: rows.map((row) => this.present(row)) };
  }

  async get(
    actor: AuthenticatedActor,
    reference: string,
    context: RequestContext,
  ): Promise<Record<string, unknown>> {
    await this.policy.authorize({
      actor,
      action: 'ALERT_VIEW',
      purpose: 'AUDIT_REVIEW',
      resource: { type: 'ALERT', id: null, classification: 'SENSITIVE', subjectPcid: null },
      context,
      auditDetail: { reference },
    });
    const row = await this.db.queryOne<AlertRow>(`${this.selectClause} WHERE a.reference = $1`, [
      reference,
    ]);
    if (row === null) throw AppError.notFoundOrNotPermitted(`no alert ${reference}`);
    return this.present(row);
  }

  async review(
    actor: AuthenticatedActor,
    reference: string,
    decision: AlertDecision,
    note: string,
    context: RequestContext,
  ): Promise<Record<string, unknown>> {
    await this.policy.authorize({
      actor,
      action: 'ALERT_REVIEW',
      purpose: 'AUDIT_REVIEW',
      resource: { type: 'ALERT', id: null, classification: 'SENSITIVE', subjectPcid: null },
      context,
      auditDetail: { reference, decision },
    });

    return this.db.transaction(async (runner) => {
      const row = await runner.queryOne<AlertRow>(
        `${this.selectClause} WHERE a.reference = $1 FOR UPDATE OF a`,
        [reference],
      );
      if (row === null) throw AppError.notFoundOrNotPermitted(`no alert ${reference}`);
      if (row.status !== 'OPEN' && row.status !== 'UNDER_REVIEW') {
        throw AppError.conflict('That alert has already been closed.');
      }

      await runner.query(
        `UPDATE alert SET status = $2, reviewed_by_user_id = $3, reviewed_at = now(),
                          review_note = $4
          WHERE id = $1`,
        [row.id, decision, actor.subject.userId, note],
      );

      await this.audit.record(
        {
          action: 'ALERT_REVIEW',
          outcome: 'PERMITTED',
          actorType: actor.subject.actorType,
          actorId: actor.subject.userId,
          actorDisplay: actor.displayName,
          agencyId: actor.subject.agencyId,
          agencyCode: actor.agencyCode,
          roles: actor.subject.roles,
          purpose: 'AUDIT_REVIEW',
          resourceType: 'ALERT',
          resourceId: row.id,
          subjectPcid: row.subject_pcid,
          correlationId: context.correlationId,
          ipAddress: context.ipAddress,
          // A resident's own history should show that something they reported
          // was looked at; an alert raised about an investigation should not.
          citizenVisibility: row.rule_key.startsWith('CITIZEN_REPORTED_')
            ? 'ACCESS_VISIBLE_TO_CITIZEN'
            : 'ACCESS_RESTRICTED_FROM_CITIZEN',
          ...(row.rule_key.startsWith('CITIZEN_REPORTED_')
            ? {}
            : {
                restrictionBasis:
                  'Oversight review of a detection event; disclosing it would reveal the ' +
                  'platform’s monitoring thresholds to the behaviour being monitored.',
              }),
          detail: { reference: row.reference, ruleKey: row.rule_key, decision, note },
        },
        runner,
      );

      return {
        ...this.present(row),
        status: decision,
        reviewNote: note,
        reviewedBy: actor.displayName,
      };
    });
  }

  private readonly selectClause = `
    SELECT a.id, a.reference, a.rule_key, a.category, a.severity, a.title, a.summary,
           a.explanation, a.confidence, a.subject_type, a.subject_id, a.subject_pcid,
           a.status, a.review_note, a.reviewed_at, a.created_at,
           ag.name AS agency_name, u.full_name AS reviewer_name
      FROM alert a
      LEFT JOIN agency ag ON ag.id = a.agency_id
      LEFT JOIN government_user u ON u.id = a.reviewed_by_user_id`;

  private present(row: AlertRow): Record<string, unknown> {
    return {
      reference: row.reference,
      ruleKey: row.rule_key,
      category: row.category,
      severity: row.severity,
      title: row.title,
      summary: row.summary,
      // Always returned: an alert nobody can question is one nobody can correct.
      explanation: row.explanation,
      confidence: row.confidence === null ? null : Number(row.confidence),
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      // The identifier only. Opening the person behind it is a separate act
      // under a stated purpose, and is audited as one.
      subjectPcid: row.subject_pcid,
      agency: row.agency_name,
      status: row.status,
      raisedAt: row.created_at.toISOString(),
      reviewedAt: row.reviewed_at?.toISOString() ?? null,
      reviewedBy: row.reviewer_name,
      reviewNote: row.review_note,
    };
  }
}
