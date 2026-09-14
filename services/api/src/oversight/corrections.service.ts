import { Injectable } from '@nestjs/common';
import { fieldDefinition, selfServiceEditableFields } from '@pcid/contracts';

import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../common/correlation';
import { AppError } from '../common/errors';
import { WhereBuilder } from '../common/sql';
import { Database } from '../database/pool';
import type { QueryRunner } from '../database/pool';
import type { AuthenticatedActor } from '../iam/actor';
import { PolicyService } from '../policy/policy.service';

/**
 * Which stored column each correctable field path writes to.
 *
 * An approved correction has to actually change the record, and the set of
 * columns it may change is closed and written down here rather than derived from
 * the request. A field path that is not in this map cannot be applied, whatever
 * the catalogue says and whatever a reviewer approves - so a future catalogue
 * entry cannot silently become writable through the correction queue.
 */
const APPLICABLE_COLUMNS: Readonly<Record<string, string>> = Object.freeze({
  'citizen.givenName': 'given_name',
  'citizen.middleName': 'middle_name',
  'citizen.familyName': 'family_name',
  'citizen.dateOfBirth': 'date_of_birth',
  'citizen.sex': 'sex',
  'citizen.registeredAddress': 'residential_address',
  'citizen.lgaCode': 'lga_code',
  'citizen.wardCode': 'ward_code',
  'citizen.phonePrimary': 'phone_primary',
  'citizen.phoneSecondary': 'phone_secondary',
  'citizen.email': 'email',
});

/** Columns whose type needs a cast on the way in. */
const COLUMN_CASTS: Readonly<Record<string, string>> = Object.freeze({
  date_of_birth: '::date',
});

export type CorrectionDecision = 'APPROVE' | 'REJECT' | 'REQUEST_EVIDENCE';

interface CorrectionRow {
  id: string;
  reference: string;
  citizen_id: string;
  pcid: string;
  display_name: string;
  requested_by_type: string;
  field_path: string;
  current_value: string | null;
  requested_value: string;
  justification: string;
  evidence_reference: string | null;
  status: string;
  review_note: string | null;
  reviewed_at: Date | null;
  reviewer_name: string | null;
  created_at: Date;
  applied_at: Date | null;
}

/**
 * Correction requests, from the reviewer's side (§7, §66).
 *
 * A resident could already ask for something to be put right, and the request
 * was stored and shown back to them. Nothing could act on it: no role could
 * list the queue and no route could decide one, so `CORRECTION_REQUEST_REVIEW`
 * was an entitlement nobody could exercise. This is that side of it.
 *
 * Approving is not the same as changing. An approval applies the value in the
 * same transaction that records the decision, writes the audit event that names
 * the reviewer, and tells the resident it happened - because a register that
 * accepts a correction and then does not make it is worse than one that refuses.
 */
@Injectable()
export class CorrectionsService {
  constructor(
    private readonly db: Database,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
  ) {}

  async list(
    actor: AuthenticatedActor,
    options: { status?: string; subjectPcid?: string; limit: number; offset: number },
    context: RequestContext,
  ): Promise<{ total: number; requests: Record<string, unknown>[] }> {
    await this.policy.authorize({
      actor,
      action: 'CORRECTION_REQUEST_REVIEW',
      purpose: 'CORRECTION_REVIEW',
      resource: {
        type: 'CORRECTION_REQUEST',
        id: null,
        classification: 'INTERNAL',
        subjectPcid: options.subjectPcid ?? null,
      },
      context,
      auditDetail: { view: 'CORRECTION_QUEUE', status: options.status ?? 'ALL' },
    });

    const where = new WhereBuilder();
    if (options.status !== undefined) where.add('cr.status = ?', options.status);
    if (options.subjectPcid !== undefined) where.add('c.pcid = ?', options.subjectPcid);

    const rows = await this.db.query<CorrectionRow>(
      `SELECT cr.id, cr.reference, cr.citizen_id, c.pcid, c.display_name, cr.requested_by_type,
              cr.field_path, cr.current_value, cr.requested_value, cr.justification,
              cr.evidence_reference, cr.status, cr.review_note, cr.reviewed_at, cr.created_at,
              cr.applied_at, u.full_name AS reviewer_name
         FROM correction_request cr
         JOIN citizen c ON c.id = cr.citizen_id
         LEFT JOIN government_user u ON u.id = cr.reviewed_by_user_id
        ${where.sql}
        ORDER BY cr.created_at ASC
        LIMIT $${where.next()} OFFSET $${where.next(2)}`,
      where.withExtra(options.limit, options.offset),
    );
    const total = await this.db.queryOne<{ count: string }>(
      `SELECT count(*)::text AS count FROM correction_request cr
         JOIN citizen c ON c.id = cr.citizen_id ${where.sql}`,
      [...where.params],
    );

    return {
      total: Number(total?.count ?? 0),
      requests: rows.map((row) => this.present(row)),
    };
  }

  /**
   * Raise a correction on somebody's behalf, from a counter (§66).
   *
   * `CORRECTION_REQUEST_CREATE` was granted to MDA_OFFICER and REVENUE_OFFICER,
   * and the only route that performed it was the resident's own. So an officer
   * looking at a record with a wrong address could see the mistake, tell the
   * resident to go home and raise it themselves, and do nothing else.
   *
   * The officer's request is stored as theirs, with their agency, and goes to
   * the same queue under the same review. Nothing is applied here.
   */
  async createOnBehalf(
    actor: AuthenticatedActor,
    pcid: string,
    input: {
      fieldPath: string;
      requestedValue: string;
      justification: string;
      evidenceReference?: string | null;
    },
    context: RequestContext,
  ): Promise<{ reference: string; status: string }> {
    const citizen = await this.db.queryOne<{ id: string }>(
      'SELECT id FROM citizen WHERE pcid = $1',
      [pcid],
    );

    await this.policy.authorize({
      actor,
      action: 'CORRECTION_REQUEST_CREATE',
      purpose: 'CORRECTION_REVIEW',
      resource: {
        type: 'CORRECTION_REQUEST',
        id: citizen?.id ?? null,
        classification: 'INTERNAL',
        subjectPcid: pcid,
      },
      context,
      auditDetail: { fieldPath: input.fieldPath, onBehalfOf: pcid },
    });

    if (citizen === null) throw AppError.notFoundOrNotPermitted(`no citizen ${pcid}`);

    if (APPLICABLE_COLUMNS[input.fieldPath] === undefined) {
      throw AppError.validation('That field cannot be corrected through this queue.', [
        {
          path: 'fieldPath',
          message: `Correctable fields: ${Object.keys(APPLICABLE_COLUMNS).join(', ')}`,
        },
      ]);
    }

    const reference = await this.policy.nextReference('CORRECTION', 'COR');
    const current = await this.db.queryOne<{ value: string | null }>(
      `SELECT ${APPLICABLE_COLUMNS[input.fieldPath] as string}::text AS value
         FROM citizen WHERE id = $1`,
      [citizen.id],
    );
    await this.db.query(
      `INSERT INTO correction_request (
         reference, citizen_id, requested_by_type, requested_by_id, requesting_agency_id,
         field_path, current_value, requested_value, justification, evidence_reference, status
       ) VALUES ($1,$2,'GOVERNMENT_USER',$3,$4,$5,$6,$7,$8,$9,'SUBMITTED')`,
      [
        reference,
        citizen.id,
        actor.subject.userId,
        actor.subject.agencyId,
        input.fieldPath,
        current?.value ?? null,
        input.requestedValue,
        input.justification,
        input.evidenceReference ?? null,
      ],
    );

    await this.audit.record({
      action: 'CORRECTION_REQUEST_CREATE',
      outcome: 'PERMITTED',
      actorType: actor.subject.actorType,
      actorId: actor.subject.userId,
      actorDisplay: actor.displayName,
      agencyId: actor.subject.agencyId,
      agencyCode: actor.agencyCode,
      roles: actor.subject.roles,
      purpose: 'CORRECTION_REVIEW',
      resourceType: 'CORRECTION_REQUEST',
      resourceId: citizen.id,
      subjectPcid: pcid,
      correlationId: context.correlationId,
      ipAddress: context.ipAddress,
      detail: { reference, fieldPath: input.fieldPath, raisedOnBehalfOfResident: true },
    });

    // The resident is told that somebody asked for their record to be changed,
    // before it is changed, so a correction raised without their knowledge is
    // visible to them while it is still a request.
    await this.db.query(
      `INSERT INTO notification (channel, recipient_type, recipient_id, subject, body, classification)
       VALUES ('IN_APP','CITIZEN',$1,$2,$3,'INTERNAL')`,
      [
        pcid,
        `A government office has asked for a change to your record (${reference})`,
        `${actor.agencyName ?? 'A government office'} asked for ${input.fieldPath} to be changed. ` +
          'You will be told when it is decided. If you did not expect this, report it from the ' +
          '"Report something" page.',
      ],
    );

    return { reference, status: 'SUBMITTED' };
  }

  async decide(
    actor: AuthenticatedActor,
    reference: string,
    decision: CorrectionDecision,
    note: string,
    context: RequestContext,
  ): Promise<Record<string, unknown>> {
    const existing = await this.db.queryOne<{ pcid: string; citizen_id: string }>(
      `SELECT c.pcid, cr.citizen_id FROM correction_request cr
         JOIN citizen c ON c.id = cr.citizen_id
        WHERE cr.reference = $1`,
      [reference],
    );

    await this.policy.authorize({
      actor,
      action: 'CORRECTION_REQUEST_REVIEW',
      purpose: 'CORRECTION_REVIEW',
      resource: {
        type: 'CORRECTION_REQUEST',
        id: existing?.citizen_id ?? null,
        classification: 'INTERNAL',
        subjectPcid: existing?.pcid ?? null,
      },
      context,
      auditDetail: { decision, reference },
    });

    // Authorised first, so a request that does not exist and one this account
    // may not touch are indistinguishable - and both are audited.
    if (existing === null)
      throw AppError.notFoundOrNotPermitted(`no correction request ${reference}`);

    return this.db.transaction(async (runner) => {
      const row = await runner.queryOne<CorrectionRow>(
        `SELECT cr.id, cr.reference, cr.citizen_id, c.pcid, c.display_name, cr.requested_by_type,
                cr.field_path, cr.current_value, cr.requested_value, cr.justification,
                cr.evidence_reference, cr.status, cr.review_note, cr.reviewed_at, cr.created_at,
                cr.applied_at, NULL::text AS reviewer_name
           FROM correction_request cr
           JOIN citizen c ON c.id = cr.citizen_id
          WHERE cr.reference = $1
          FOR UPDATE OF cr`,
        [reference],
      );
      if (row === null) throw AppError.notFoundOrNotPermitted(`no correction request ${reference}`);
      if (row.status === 'APPLIED' || row.status === 'REJECTED') {
        throw AppError.conflict('That request has already been decided.');
      }

      const applied = decision === 'APPROVE' ? await this.apply(runner, row, actor) : false;
      const status =
        decision === 'APPROVE'
          ? 'APPLIED'
          : decision === 'REJECT'
            ? 'REJECTED'
            : 'EVIDENCE_REQUIRED';

      await runner.query(
        `UPDATE correction_request
            SET status = $2, reviewed_by_user_id = $3, reviewed_at = now(), review_note = $4,
                applied_at = CASE WHEN $5 THEN now() ELSE applied_at END
          WHERE id = $1`,
        [row.id, status, actor.subject.userId, note, applied],
      );

      await this.audit.record(
        {
          action: 'CORRECTION_REQUEST_REVIEW',
          outcome: 'PERMITTED',
          actorType: actor.subject.actorType,
          actorId: actor.subject.userId,
          actorDisplay: actor.displayName,
          agencyId: actor.subject.agencyId,
          agencyCode: actor.agencyCode,
          roles: actor.subject.roles,
          purpose: 'CORRECTION_REVIEW',
          resourceType: 'CORRECTION_REQUEST',
          resourceId: row.id,
          subjectPcid: row.pcid,
          correlationId: context.correlationId,
          ipAddress: context.ipAddress,
          // What changed, so the resident's own access history can show it and an
          // oversight review can see the before and the after.
          detail: {
            reference: row.reference,
            decision,
            fieldPath: row.field_path,
            previousValue: row.current_value,
            newValue: applied ? row.requested_value : null,
            applied,
            note,
          },
        },
        runner,
      );

      await runner.query(
        `INSERT INTO notification (channel, recipient_type, recipient_id, subject, body, classification)
         VALUES ('IN_APP','CITIZEN',$1,$2,$3,'INTERNAL')`,
        [
          row.pcid,
          `Your correction request ${row.reference} has been ${status === 'APPLIED' ? 'applied' : status === 'REJECTED' ? 'rejected' : 'returned for evidence'}`,
          note,
        ],
      );

      return { ...this.present({ ...row, status }), applied, decidedBy: actor.displayName };
    });
  }

  /**
   * Write the approved value onto the record.
   *
   * Refuses anything outside the closed column map, and refuses a field the
   * catalogue does not mark as the resident's to correct. Both checks are here
   * rather than at the edge because this is the last point before the register
   * changes, and it is the one that must not be bypassable.
   */
  private async apply(
    runner: QueryRunner,
    row: CorrectionRow,
    actor: AuthenticatedActor,
  ): Promise<boolean> {
    const column = APPLICABLE_COLUMNS[row.field_path];
    if (column === undefined) {
      throw AppError.validation('That field cannot be corrected through this queue.', [
        { path: 'fieldPath', message: `${row.field_path} is not an applicable correction` },
      ]);
    }
    if (fieldDefinition(row.field_path) === undefined) {
      throw AppError.validation('That field is not in the data catalogue.', [
        { path: 'fieldPath', message: row.field_path },
      ]);
    }
    if (!selfServiceEditableFields('CITIZEN').includes(row.field_path)) {
      throw AppError.validation('That field is not one a resident may ask to have changed.', [
        { path: 'fieldPath', message: row.field_path },
      ]);
    }

    const cast = COLUMN_CASTS[column] ?? '';
    await runner.query(`UPDATE citizen SET ${column} = $2${cast} WHERE id = $1`, [
      row.citizen_id,
      row.requested_value,
    ]);
    // The display name is derived, so a name change has to rebuild it rather
    // than leaving the record internally inconsistent.
    if (column === 'given_name' || column === 'middle_name' || column === 'family_name') {
      await runner.query(
        `UPDATE citizen
            SET display_name = trim(regexp_replace(
                  concat_ws(' ', given_name, middle_name, family_name), '\\s+', ' ', 'g'))
          WHERE id = $1`,
        [row.citizen_id],
      );
    }
    await runner.query(
      `INSERT INTO identity_verification (citizen_id, level_before, level_after, evidence_type,
                                          evidence_reference, verified_by_user_id, note)
       SELECT id, verification_level, verification_level, 'CORRECTION_REQUEST', $2, $3, $4
         FROM citizen WHERE id = $1`,
      [
        row.citizen_id,
        row.evidence_reference ?? row.reference,
        actor.subject.userId,
        `Applied correction to ${row.field_path}.`,
      ],
    );
    return true;
  }

  private present(row: CorrectionRow): Record<string, unknown> {
    return {
      reference: row.reference,
      subjectPcid: row.pcid,
      subjectName: row.display_name,
      raisedBy: row.requested_by_type === 'CITIZEN' ? 'The resident' : 'A government officer',
      fieldPath: row.field_path,
      currentValue: row.current_value,
      requestedValue: row.requested_value,
      justification: row.justification,
      evidenceReference: row.evidence_reference,
      status: row.status,
      submittedAt: row.created_at.toISOString(),
      reviewedAt: row.reviewed_at?.toISOString() ?? null,
      reviewedBy: row.reviewer_name,
      reviewNote: row.review_note,
      appliedAt: row.applied_at?.toISOString() ?? null,
      applicable: APPLICABLE_COLUMNS[row.field_path] !== undefined,
    };
  }
}
