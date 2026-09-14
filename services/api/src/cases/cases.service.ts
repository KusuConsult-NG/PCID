import { Injectable } from '@nestjs/common';
import type { CaseStatus, CaseSubjectRole, CaseType, Classification } from '@pcid/contracts';
import { ACTIVE_CASE_STATUSES } from '@pcid/contracts';

import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { RequestContext } from '../common/correlation';
import { WhereBuilder } from '../common/sql';
import { Database } from '../database/pool';
import type { AuthenticatedActor } from '../iam/actor';
import { PolicyService } from '../policy/policy.service';

export interface CreateCaseInput {
  readonly type: CaseType;
  readonly title: string;
  readonly summary?: string | null;
  readonly classification?: Classification;
  readonly lgaCode?: string | null;
  readonly wardCode?: string | null;
  readonly incidentId?: string | null;
}

interface CaseRow {
  id: string;
  case_number: string;
  type: CaseType;
  title: string;
  summary: string | null;
  status: CaseStatus;
  classification: string;
  agency_id: string;
  lga_code: string | null;
  ward_code: string | null;
  opened_at: Date;
  closed_at: Date | null;
}

/**
 * Case management and case-based access (master system prompt §21, §22).
 *
 * The case is the unit of investigative authority. Creating the association
 * between a case and a citizen is a separate, justified, audited act - an
 * investigator searches, decides a person is relevant, records why, and only then
 * does the record open. That sequence is what makes "who looked at this person
 * and under what authority" answerable after the fact.
 */
@Injectable()
export class CasesService {
  constructor(
    private readonly db: Database,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
  ) {}

  async create(
    actor: AuthenticatedActor,
    input: CreateCaseInput,
    context: RequestContext,
  ): Promise<{ caseNumber: string; id: string; status: CaseStatus }> {
    const purpose =
      input.type === 'MISSING_PERSON' ? 'MISSING_PERSON_INVESTIGATION' : 'CRIMINAL_INVESTIGATION';
    await this.policy.authorize({
      actor,
      action: 'CASE_CREATE',
      purpose,
      resource: {
        type: 'CASE',
        id: null,
        classification: input.classification ?? 'LAW_ENFORCEMENT_RESTRICTED',
        subjectPcid: null,
        lgaCode: input.lgaCode ?? null,
        wardCode: input.wardCode ?? null,
      },
      context,
      auditDetail: { caseType: input.type },
    });

    if (actor.subject.agencyId === null) {
      throw AppError.denied('A case must belong to a registered agency.', 'actor has no agency');
    }
    const caseNumber = await this.policy.nextReference('CASE');

    return this.db.transaction(async (runner) => {
      const row = await runner.queryOne<{ id: string; status: CaseStatus }>(
        `INSERT INTO investigation_case (
           case_number, type, title, summary, status, classification, agency_id,
           lga_code, ward_code, incident_id, opened_by_user_id
         ) VALUES ($1,$2,$3,$4,'OPEN',$5,$6,$7,$8,$9,$10)
         RETURNING id, status`,
        [
          caseNumber,
          input.type,
          input.title,
          input.summary ?? null,
          input.classification ?? 'LAW_ENFORCEMENT_RESTRICTED',
          actor.subject.agencyId,
          input.lgaCode ?? null,
          input.wardCode ?? null,
          input.incidentId ?? null,
          actor.subject.userId,
        ],
      );
      if (row === null) throw new Error('case insert returned no row');

      // The officer who opens a case is assigned to it; without that they could
      // not act on the case they just created.
      await runner.query(
        `INSERT INTO case_assignment (case_id, user_id, role, assigned_by)
         VALUES ($1,$2,'INVESTIGATOR',$2)`,
        [row.id, actor.subject.userId],
      );
      await this.audit.record(
        {
          action: 'CASE_CREATE',
          outcome: 'PERMITTED',
          actorType: actor.subject.actorType,
          actorId: actor.subject.userId,
          actorDisplay: actor.displayName,
          agencyId: actor.subject.agencyId,
          agencyCode: actor.agencyCode,
          roles: actor.subject.roles,
          purpose,
          resourceType: 'CASE',
          resourceId: row.id,
          caseId: row.id,
          caseNumber,
          correlationId: context.correlationId,
          ipAddress: context.ipAddress,
          citizenVisibility: 'ACCESS_RESTRICTED_FROM_CITIZEN',
          restrictionBasis:
            'Case creation under an active investigation; disclosure is governed by the owning agency.',
          detail: { type: input.type, title: input.title },
        },
        runner,
      );
      return { caseNumber, id: row.id, status: row.status };
    });
  }

  async list(
    actor: AuthenticatedActor,
    filters: {
      status?: CaseStatus;
      type?: CaseType;
      mineOnly?: boolean;
      limit: number;
      offset: number;
    },
    context: RequestContext,
  ): Promise<{ cases: Record<string, unknown>[]; total: number }> {
    await this.policy.authorize({
      actor,
      action: 'CASE_VIEW',
      purpose: 'CRIMINAL_INVESTIGATION',
      resource: {
        type: 'CASE',
        id: null,
        classification: 'LAW_ENFORCEMENT_RESTRICTED',
        subjectPcid: null,
      },
      context,
    });

    // A case listing shows only cases the officer is assigned to. There is no
    // browse-all view, by design (§22).
    const where = new WhereBuilder().add(
      'EXISTS (SELECT 1 FROM case_assignment ca WHERE ca.case_id = ic.id AND ca.user_id = ? AND ca.released_at IS NULL)',
      actor.subject.userId,
    );
    if (filters.status !== undefined) where.add('ic.status = ?', filters.status);
    if (filters.type !== undefined) where.add('ic.type = ?', filters.type);

    const rows = await this.db.query<CaseRow>(
      `SELECT ic.id, ic.case_number, ic.type, ic.title, ic.summary, ic.status, ic.classification,
              ic.agency_id, ic.lga_code, ic.ward_code, ic.opened_at, ic.closed_at
         FROM investigation_case ic ${where.sql}
        ORDER BY ic.opened_at DESC LIMIT $${where.next()} OFFSET $${where.next(2)}`,
      where.withExtra(filters.limit, filters.offset),
    );
    const total = await this.db.queryOne<{ count: string }>(
      `SELECT count(*)::text AS count FROM investigation_case ic ${where.sql}`,
      where.params,
    );
    return { cases: rows.map(toCase), total: Number(total?.count ?? 0) };
  }

  async view(
    actor: AuthenticatedActor,
    reference: string,
    context: RequestContext,
  ): Promise<Record<string, unknown>> {
    const row = await this.findByReference(reference);
    await this.policy.authorize({
      actor,
      action: 'CASE_VIEW',
      purpose:
        row?.type === 'MISSING_PERSON' ? 'MISSING_PERSON_INVESTIGATION' : 'CRIMINAL_INVESTIGATION',
      resource: {
        type: 'CASE',
        id: row?.id ?? null,
        classification: (row?.classification ?? 'LAW_ENFORCEMENT_RESTRICTED') as Classification,
        subjectPcid: null,
        lgaCode: row?.lga_code ?? null,
        linkedCaseIds: row === null ? [] : [row.id],
      },
      caseRef: reference,
      context,
    });
    if (row === null) throw AppError.notFoundOrNotPermitted(`no case ${reference}`);

    const [subjects, assignments, notes] = await Promise.all([
      this.db.query<{
        subject_type: string;
        subject_id: string;
        subject_role: string;
        linked_at: Date;
        justification: string;
      }>(
        `SELECT subject_type, subject_id, subject_role, linked_at, justification
           FROM case_subject WHERE case_id = $1 AND unlinked_at IS NULL ORDER BY linked_at`,
        [row.id],
      ),
      this.db.query<{ full_name: string; role: string; assigned_at: Date }>(
        `SELECT u.full_name, ca.role, ca.assigned_at FROM case_assignment ca
           JOIN government_user u ON u.id = ca.user_id
          WHERE ca.case_id = $1 AND ca.released_at IS NULL ORDER BY ca.assigned_at`,
        [row.id],
      ),
      this.db.query<{ body: string; created_at: Date; full_name: string | null }>(
        `SELECT cn.body, cn.created_at, u.full_name FROM case_note cn
           LEFT JOIN government_user u ON u.id = cn.author_id
          WHERE cn.case_id = $1 ORDER BY cn.created_at DESC LIMIT 100`,
        [row.id],
      ),
    ]);

    return {
      ...toCase(row),
      subjects: subjects.map((subject) => ({
        type: subject.subject_type,
        id: subject.subject_id,
        role: subject.subject_role,
        linkedAt: subject.linked_at.toISOString(),
        justification: subject.justification,
      })),
      assignedOfficers: assignments.map((assignment) => ({
        name: assignment.full_name,
        role: assignment.role,
        assignedAt: assignment.assigned_at.toISOString(),
      })),
      notes: notes.map((note) => ({
        body: note.body,
        author: note.full_name,
        createdAt: note.created_at.toISOString(),
      })),
    };
  }

  /**
   * Associate a subject with a case. This is the act that opens a citizen record
   * to the officers on the case, so it demands a justification and is audited as
   * a first-class event (§22, §25 LINK_RECORD).
   */
  async linkSubject(
    actor: AuthenticatedActor,
    reference: string,
    input: {
      subjectType: 'CITIZEN' | 'VEHICLE' | 'PROPERTY' | 'BUSINESS';
      subjectId: string;
      subjectRole: CaseSubjectRole;
      justification: string;
    },
    context: RequestContext,
  ): Promise<{ caseNumber: string; subjectId: string }> {
    const row = await this.findByReference(reference);
    await this.policy.authorize({
      actor,
      action: 'CASE_LINK_SUBJECT',
      purpose:
        row?.type === 'MISSING_PERSON' ? 'MISSING_PERSON_INVESTIGATION' : 'CRIMINAL_INVESTIGATION',
      resource: {
        type: 'CASE',
        id: row?.id ?? null,
        classification: (row?.classification ?? 'LAW_ENFORCEMENT_RESTRICTED') as Classification,
        subjectPcid: input.subjectType === 'CITIZEN' ? input.subjectId : null,
        lgaCode: row?.lga_code ?? null,
      },
      caseRef: reference,
      context,
      auditDetail: { subjectType: input.subjectType, subjectRole: input.subjectRole },
    });
    if (row === null) throw AppError.notFoundOrNotPermitted(`no case ${reference}`);
    if (!ACTIVE_CASE_STATUSES.includes(row.status)) {
      throw AppError.conflict(`Case ${row.case_number} is ${row.status.toLowerCase()}.`);
    }

    await this.db.query(
      `INSERT INTO case_subject (case_id, subject_type, subject_id, subject_role, linked_by_user_id, justification)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (case_id, subject_type, subject_id)
       DO UPDATE SET unlinked_at = NULL, subject_role = EXCLUDED.subject_role,
                     justification = EXCLUDED.justification, linked_at = now(),
                     linked_by_user_id = EXCLUDED.linked_by_user_id`,
      [
        row.id,
        input.subjectType,
        input.subjectId,
        input.subjectRole,
        actor.subject.userId,
        input.justification,
      ],
    );

    await this.audit.record({
      action: 'LINK_RECORD',
      outcome: 'PERMITTED',
      actorType: actor.subject.actorType,
      actorId: actor.subject.userId,
      actorDisplay: actor.displayName,
      agencyId: actor.subject.agencyId,
      agencyCode: actor.agencyCode,
      roles: actor.subject.roles,
      purpose:
        row.type === 'MISSING_PERSON' ? 'MISSING_PERSON_INVESTIGATION' : 'CRIMINAL_INVESTIGATION',
      resourceType: 'CASE',
      resourceId: row.id,
      caseId: row.id,
      caseNumber: row.case_number,
      subjectPcid: input.subjectType === 'CITIZEN' ? input.subjectId : null,
      correlationId: context.correlationId,
      ipAddress: context.ipAddress,
      citizenVisibility: 'ACCESS_RESTRICTED_FROM_CITIZEN',
      restrictionBasis:
        'Association recorded under an active investigation; disclosure is deferred pending case closure.',
      detail: {
        subjectType: input.subjectType,
        subjectRole: input.subjectRole,
        justification: input.justification,
      },
    });

    return { caseNumber: row.case_number, subjectId: input.subjectId };
  }

  async assign(
    actor: AuthenticatedActor,
    reference: string,
    userId: string,
    role: 'INVESTIGATOR' | 'SUPERVISOR' | 'ANALYST' | 'OBSERVER',
    context: RequestContext,
  ): Promise<{ caseNumber: string; userId: string; role: string }> {
    const row = await this.findByReference(reference);
    await this.policy.authorize({
      actor,
      action: 'CASE_ASSIGN',
      purpose:
        row?.type === 'MISSING_PERSON' ? 'MISSING_PERSON_INVESTIGATION' : 'CRIMINAL_INVESTIGATION',
      resource: {
        type: 'CASE',
        id: row?.id ?? null,
        classification: (row?.classification ?? 'LAW_ENFORCEMENT_RESTRICTED') as Classification,
        subjectPcid: null,
      },
      caseRef: reference,
      context,
    });
    if (row === null) throw AppError.notFoundOrNotPermitted(`no case ${reference}`);

    await this.db.query(
      `INSERT INTO case_assignment (case_id, user_id, role, assigned_by)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (case_id, user_id) DO UPDATE SET role = EXCLUDED.role, released_at = NULL`,
      [row.id, userId, role, actor.subject.userId],
    );
    await this.audit.record({
      action: 'CASE_ASSIGN',
      outcome: 'PERMITTED',
      actorType: actor.subject.actorType,
      actorId: actor.subject.userId,
      actorDisplay: actor.displayName,
      agencyId: actor.subject.agencyId,
      agencyCode: actor.agencyCode,
      roles: actor.subject.roles,
      purpose: 'CRIMINAL_INVESTIGATION',
      resourceType: 'CASE',
      resourceId: row.id,
      caseId: row.id,
      caseNumber: row.case_number,
      correlationId: context.correlationId,
      ipAddress: context.ipAddress,
      citizenVisibility: 'ACCESS_RESTRICTED_FROM_CITIZEN',
      restrictionBasis: 'Case administration under an active investigation.',
      detail: { assignedUserId: userId, role },
    });
    return { caseNumber: row.case_number, userId, role };
  }

  /**
   * Change what a case says about itself (§22).
   *
   * `CASE_UPDATE` was granted to INVESTIGATOR and MISSING_PERSON_OFFICER with no
   * route behind it, so a case could be opened and never corrected: a title
   * typed wrong at three in the morning stayed wrong, and a case could not be
   * moved from DRAFT to ACTIVE.
   *
   * Two things it deliberately will not do. It cannot close a case - that is
   * `CASE_CLOSE`, a separate entitlement held by a supervisor, and it demands a
   * closure note. And it cannot change the case's classification or its agency:
   * those decide who may reach the case at all, so moving them is an
   * administrative act and not an editorial one.
   */
  async update(
    actor: AuthenticatedActor,
    reference: string,
    changes: {
      title?: string;
      summary?: string | null;
      status?: 'DRAFT' | 'OPEN' | 'ACTIVE' | 'SUSPENDED' | 'PENDING_REVIEW';
      lgaCode?: string | null;
      wardCode?: string | null;
    },
    context: RequestContext,
  ): Promise<Record<string, unknown>> {
    const row = await this.findByReference(reference);
    await this.policy.authorize({
      actor,
      action: 'CASE_UPDATE',
      purpose:
        row?.type === 'MISSING_PERSON' ? 'MISSING_PERSON_INVESTIGATION' : 'CRIMINAL_INVESTIGATION',
      resource: {
        type: 'CASE',
        id: row?.id ?? null,
        classification: (row?.classification ?? 'LAW_ENFORCEMENT_RESTRICTED') as Classification,
        subjectPcid: null,
        lgaCode: row?.lga_code ?? null,
        linkedCaseIds: row === null ? [] : [row.id],
      },
      caseRef: reference,
      context,
    });
    if (row === null) throw AppError.notFoundOrNotPermitted(`no case ${reference}`);
    if (row.status === 'CLOSED' || row.status === 'ARCHIVED') {
      throw AppError.conflict('A closed case cannot be edited. Reopening one is a supervisor act.');
    }

    const set: string[] = [];
    const values: unknown[] = [row.id];
    const applied: Record<string, unknown> = {};
    const assign = (column: string, value: unknown, key: string): void => {
      values.push(value);
      set.push(`${column} = $${values.length}`);
      applied[key] = value;
    };
    if (changes.title !== undefined) assign('title', changes.title, 'title');
    if (changes.summary !== undefined) assign('summary', changes.summary, 'summary');
    if (changes.status !== undefined) assign('status', changes.status, 'status');
    if (changes.lgaCode !== undefined) assign('lga_code', changes.lgaCode, 'lgaCode');
    if (changes.wardCode !== undefined) assign('ward_code', changes.wardCode, 'wardCode');

    if (set.length === 0) {
      throw AppError.validation('Nothing to change.', [
        { path: 'body', message: 'Supply at least one field to update.' },
      ]);
    }

    const updated = await this.db.queryOne<CaseRow>(
      `UPDATE investigation_case SET ${set.join(', ')} WHERE id = $1
         RETURNING id, case_number, type, title, summary, status, classification, agency_id,
                   lga_code, ward_code, opened_at, closed_at`,
      values,
    );
    if (updated === null) throw new Error('case update returned no row');

    await this.audit.record({
      action: 'CASE_UPDATE',
      outcome: 'PERMITTED',
      actorType: actor.subject.actorType,
      actorId: actor.subject.userId,
      actorDisplay: actor.displayName,
      agencyId: actor.subject.agencyId,
      agencyCode: actor.agencyCode,
      roles: actor.subject.roles,
      purpose: 'CRIMINAL_INVESTIGATION',
      resourceType: 'CASE',
      resourceId: row.id,
      caseId: row.id,
      caseNumber: row.case_number,
      correlationId: context.correlationId,
      ipAddress: context.ipAddress,
      // What changed and what it was, so a later reader can see the case as it
      // stood when a decision was taken on it.
      detail: {
        changed: applied,
        previous: {
          ...(changes.title === undefined ? {} : { title: row.title }),
          ...(changes.summary === undefined ? {} : { summary: row.summary }),
          ...(changes.status === undefined ? {} : { status: row.status }),
          ...(changes.lgaCode === undefined ? {} : { lgaCode: row.lga_code }),
          ...(changes.wardCode === undefined ? {} : { wardCode: row.ward_code }),
        },
      },
    });
    return toCase(updated);
  }

  /**
   * Add a note to a case.
   *
   * Notes were read by the case view and written by nothing, so the record of an
   * investigator's reasoning had no way in. A note is append-only by intent: it
   * carries its author and its time, and there is no route that edits or removes
   * one, because a case file somebody can quietly rewrite is not a case file.
   */
  async addNote(
    actor: AuthenticatedActor,
    reference: string,
    body: string,
    context: RequestContext,
  ): Promise<{ caseNumber: string; createdAt: string; author: string }> {
    const row = await this.findByReference(reference);
    await this.policy.authorize({
      actor,
      action: 'CASE_UPDATE',
      purpose:
        row?.type === 'MISSING_PERSON' ? 'MISSING_PERSON_INVESTIGATION' : 'CRIMINAL_INVESTIGATION',
      resource: {
        type: 'CASE',
        id: row?.id ?? null,
        classification: (row?.classification ?? 'LAW_ENFORCEMENT_RESTRICTED') as Classification,
        subjectPcid: null,
        lgaCode: row?.lga_code ?? null,
        linkedCaseIds: row === null ? [] : [row.id],
      },
      caseRef: reference,
      context,
      auditDetail: { change: 'CASE_NOTE_ADDED' },
    });
    if (row === null) throw AppError.notFoundOrNotPermitted(`no case ${reference}`);

    const note = await this.db.queryOne<{ created_at: Date }>(
      `INSERT INTO case_note (case_id, author_id, body, classification)
       VALUES ($1, $2, $3, $4) RETURNING created_at`,
      [row.id, actor.subject.userId, body, row.classification],
    );
    if (note === null) throw new Error('case note insert returned no row');

    await this.audit.record({
      action: 'CASE_UPDATE',
      outcome: 'PERMITTED',
      actorType: actor.subject.actorType,
      actorId: actor.subject.userId,
      actorDisplay: actor.displayName,
      agencyId: actor.subject.agencyId,
      agencyCode: actor.agencyCode,
      roles: actor.subject.roles,
      purpose: 'CRIMINAL_INVESTIGATION',
      resourceType: 'CASE',
      resourceId: row.id,
      caseId: row.id,
      caseNumber: row.case_number,
      correlationId: context.correlationId,
      ipAddress: context.ipAddress,
      // The note's length, not its text: the audit trail records that an access
      // or a change happened, and is not a second copy of the case file.
      detail: { change: 'CASE_NOTE_ADDED', characters: body.length },
    });

    return {
      caseNumber: row.case_number,
      createdAt: note.created_at.toISOString(),
      author: actor.displayName,
    };
  }

  async close(
    actor: AuthenticatedActor,
    reference: string,
    closureNote: string,
    context: RequestContext,
  ): Promise<{ caseNumber: string; status: CaseStatus }> {
    const row = await this.findByReference(reference);
    await this.policy.authorize({
      actor,
      action: 'CASE_CLOSE',
      purpose:
        row?.type === 'MISSING_PERSON' ? 'MISSING_PERSON_INVESTIGATION' : 'CRIMINAL_INVESTIGATION',
      resource: {
        type: 'CASE',
        id: row?.id ?? null,
        classification: (row?.classification ?? 'LAW_ENFORCEMENT_RESTRICTED') as Classification,
        subjectPcid: null,
      },
      caseRef: reference,
      context,
    });
    if (row === null) throw AppError.notFoundOrNotPermitted(`no case ${reference}`);

    const updated = await this.db.queryOne<{ case_number: string; status: CaseStatus }>(
      `UPDATE investigation_case
          SET status = 'CLOSED', closed_at = now(), closed_by_user_id = $2, closure_note = $3
        WHERE id = $1 RETURNING case_number, status`,
      [row.id, actor.subject.userId, closureNote],
    );
    if (updated === null) throw new Error('case close returned no row');

    await this.audit.record({
      action: 'CASE_CLOSE',
      outcome: 'PERMITTED',
      actorType: actor.subject.actorType,
      actorId: actor.subject.userId,
      actorDisplay: actor.displayName,
      agencyId: actor.subject.agencyId,
      agencyCode: actor.agencyCode,
      roles: actor.subject.roles,
      purpose: 'CRIMINAL_INVESTIGATION',
      resourceType: 'CASE',
      resourceId: row.id,
      caseId: row.id,
      caseNumber: updated.case_number,
      correlationId: context.correlationId,
      ipAddress: context.ipAddress,
      detail: { closureNote },
    });
    return { caseNumber: updated.case_number, status: updated.status };
  }

  async findByReference(reference: string): Promise<CaseRow | null> {
    return this.db.queryOne<CaseRow>(
      `SELECT id, case_number, type, title, summary, status, classification, agency_id,
              lga_code, ward_code, opened_at, closed_at
         FROM investigation_case WHERE case_number = $1 OR id::text = $1`,
      [reference],
    );
  }
}

function toCase(row: CaseRow): Record<string, unknown> {
  return {
    id: row.id,
    caseNumber: row.case_number,
    type: row.type,
    title: row.title,
    summary: row.summary,
    status: row.status,
    classification: row.classification,
    agencyId: row.agency_id,
    lgaCode: row.lga_code,
    wardCode: row.ward_code,
    openedAt: row.opened_at.toISOString(),
    closedAt: row.closed_at?.toISOString() ?? null,
  };
}
