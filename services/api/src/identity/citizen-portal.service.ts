import { Injectable } from '@nestjs/common';
import { selfServiceEditableFields } from '@pcid/contracts';

import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { RequestContext } from '../common/correlation';
import { Database } from '../database/pool';
import type { AuthenticatedActor } from '../iam/actor';
import { PolicyService } from '../policy/policy.service';

/**
 * Citizen self-service (master system prompt §17, §18, §26, §58).
 *
 * Three things a resident can do here that matter for trust: manage who should be
 * contacted in an emergency, see who in government looked at their record, and
 * ask for something wrong to be corrected.
 *
 * Emergency contacts are the citizen's own to manage; every change records who
 * made it, so a contact quietly altered by an officer is visible as such (§18).
 */
@Injectable()
export class CitizenPortalService {
  constructor(
    private readonly db: Database,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
  ) {}

  private async ownCitizenId(actor: AuthenticatedActor): Promise<{ id: string; pcid: string }> {
    const pcid = actor.subject.subjectPcid;
    if (actor.subject.actorType !== 'CITIZEN' || pcid === null || pcid === undefined) {
      throw AppError.denied(
        'This endpoint is for citizen accounts.',
        'non-citizen actor on portal route',
      );
    }
    const row = await this.db.queryOne<{ id: string }>('SELECT id FROM citizen WHERE pcid = $1', [
      pcid,
    ]);
    if (row === null)
      throw AppError.notFoundOrNotPermitted('citizen account has no registry record');
    return { id: row.id, pcid };
  }

  async listEmergencyContacts(
    actor: AuthenticatedActor,
    context: RequestContext,
  ): Promise<Record<string, unknown>[]> {
    const { id, pcid } = await this.ownCitizenId(actor);
    await this.policy.authorize({
      actor,
      action: 'CITIZEN_VIEW',
      purpose: 'CITIZEN_SELF_SERVICE',
      resource: { type: 'CITIZEN', id, classification: 'CONFIDENTIAL', subjectPcid: pcid },
      context,
    });
    const rows = await this.db.query<{
      id: string;
      full_name: string;
      relationship: string;
      phone_primary: string;
      phone_secondary: string | null;
      priority: number;
      verification_status: string;
      last_changed_by_type: string;
    }>(
      `SELECT id, full_name, relationship, phone_primary, phone_secondary, priority,
              verification_status, last_changed_by_type
         FROM emergency_contact WHERE citizen_id = $1 ORDER BY priority, created_at`,
      [id],
    );
    return rows.map((row) => ({
      id: row.id,
      fullName: row.full_name,
      relationship: row.relationship,
      phonePrimary: row.phone_primary,
      phoneSecondary: row.phone_secondary,
      priority: row.priority,
      verificationStatus: row.verification_status,
      lastChangedBy: row.last_changed_by_type,
    }));
  }

  async addEmergencyContact(
    actor: AuthenticatedActor,
    input: {
      fullName: string;
      relationship: string;
      phonePrimary: string;
      phoneSecondary?: string | null;
      priority: number;
    },
    context: RequestContext,
  ): Promise<{ id: string }> {
    const { id, pcid } = await this.ownCitizenId(actor);
    await this.policy.authorize({
      actor,
      action: 'CITIZEN_UPDATE',
      purpose: 'CITIZEN_SELF_SERVICE',
      resource: {
        type: 'CITIZEN',
        id,
        classification: 'CONFIDENTIAL',
        subjectPcid: pcid,
        requestedFields: ['citizen.emergencyContacts'],
      },
      context,
    });

    const row = await this.db.queryOne<{ id: string }>(
      `INSERT INTO emergency_contact (
         citizen_id, full_name, relationship, phone_primary, phone_secondary, priority,
         last_changed_by_type, last_changed_by_id
       ) VALUES ($1,$2,$3,$4,$5,$6,'CITIZEN',$7)
       RETURNING id`,
      [
        id,
        input.fullName,
        input.relationship,
        input.phonePrimary,
        input.phoneSecondary ?? null,
        input.priority,
        actor.subject.userId,
      ],
    );
    if (row === null) throw new Error('emergency contact insert returned no row');

    await this.audit.record({
      action: 'UPDATE_CITIZEN',
      outcome: 'PERMITTED',
      actorType: 'CITIZEN',
      actorId: actor.subject.userId,
      actorDisplay: actor.displayName,
      purpose: 'CITIZEN_SELF_SERVICE',
      resourceType: 'CITIZEN',
      resourceId: id,
      subjectPcid: pcid,
      fieldsReleased: ['citizen.emergencyContacts'],
      correlationId: context.correlationId,
      ipAddress: context.ipAddress,
      detail: { change: 'EMERGENCY_CONTACT_ADDED' },
    });
    return { id: row.id };
  }

  async updateEmergencyContact(
    actor: AuthenticatedActor,
    contactId: string,
    input: {
      fullName: string;
      relationship: string;
      phonePrimary: string;
      phoneSecondary?: string | null;
      priority: number;
    },
    context: RequestContext,
  ): Promise<{ updated: boolean }> {
    const { id, pcid } = await this.ownCitizenId(actor);
    await this.policy.authorize({
      actor,
      action: 'CITIZEN_UPDATE',
      purpose: 'CITIZEN_SELF_SERVICE',
      resource: {
        type: 'CITIZEN',
        id,
        classification: 'CONFIDENTIAL',
        subjectPcid: pcid,
        requestedFields: ['citizen.emergencyContacts'],
      },
      context,
    });

    // Changing a contact resets its verification: the number may now be someone
    // else's, and a contact nobody has confirmed should not look confirmed.
    const rows = await this.db.query<{ id: string }>(
      `UPDATE emergency_contact
          SET full_name = $3, relationship = $4, phone_primary = $5, phone_secondary = $6,
              priority = $7, verification_status = 'UNVERIFIED', verified_at = NULL,
              last_changed_by_type = 'CITIZEN', last_changed_by_id = $8
        WHERE id = $1 AND citizen_id = $2
        RETURNING id`,
      [
        contactId,
        id,
        input.fullName,
        input.relationship,
        input.phonePrimary,
        input.phoneSecondary ?? null,
        input.priority,
        actor.subject.userId,
      ],
    );

    await this.audit.record({
      action: 'UPDATE_CITIZEN',
      outcome: rows.length > 0 ? 'PERMITTED' : 'DENIED',
      actorType: 'CITIZEN',
      actorId: actor.subject.userId,
      actorDisplay: actor.displayName,
      purpose: 'CITIZEN_SELF_SERVICE',
      resourceType: 'CITIZEN',
      resourceId: id,
      subjectPcid: pcid,
      fieldsReleased: rows.length > 0 ? ['citizen.emergencyContacts'] : [],
      correlationId: context.correlationId,
      ipAddress: context.ipAddress,
      detail: { change: 'EMERGENCY_CONTACT_UPDATED', contactId },
    });
    return { updated: rows.length > 0 };
  }

  async removeEmergencyContact(
    actor: AuthenticatedActor,
    contactId: string,
    context: RequestContext,
  ): Promise<{ removed: boolean }> {
    const { id, pcid } = await this.ownCitizenId(actor);
    await this.policy.authorize({
      actor,
      action: 'CITIZEN_UPDATE',
      purpose: 'CITIZEN_SELF_SERVICE',
      resource: {
        type: 'CITIZEN',
        id,
        classification: 'CONFIDENTIAL',
        subjectPcid: pcid,
        requestedFields: ['citizen.emergencyContacts'],
      },
      context,
    });
    const rows = await this.db.query<{ id: string }>(
      'DELETE FROM emergency_contact WHERE id = $1 AND citizen_id = $2 RETURNING id',
      [contactId, id],
    );
    await this.audit.record({
      action: 'UPDATE_CITIZEN',
      outcome: rows.length > 0 ? 'PERMITTED' : 'DENIED',
      actorType: 'CITIZEN',
      actorId: actor.subject.userId,
      actorDisplay: actor.displayName,
      purpose: 'CITIZEN_SELF_SERVICE',
      resourceType: 'CITIZEN',
      resourceId: id,
      subjectPcid: pcid,
      correlationId: context.correlationId,
      ipAddress: context.ipAddress,
      detail: { change: 'EMERGENCY_CONTACT_REMOVED', contactId },
    });
    return { removed: rows.length > 0 };
  }

  /** Who in government looked at this person's record, and why (§26). */
  async accessHistory(
    actor: AuthenticatedActor,
    options: { limit: number; offset: number },
    context: RequestContext,
  ): Promise<Record<string, unknown>> {
    const { id, pcid } = await this.ownCitizenId(actor);
    await this.policy.authorize({
      actor,
      action: 'AUDIT_VIEW',
      purpose: 'CITIZEN_SELF_SERVICE',
      resource: { type: 'AUDIT_EVENT', id, classification: 'INTERNAL', subjectPcid: pcid },
      context,
    });
    const result = await this.audit.citizenAccessHistory(pcid, options);
    return {
      total: result.total,
      note:
        'Some accesses made under an active investigation are withheld from this list under a ' +
        'recorded legal basis, and are visible to the Data Protection Officer.',
      accesses: result.rows.map((row) => ({
        occurredAt: row.occurred_at.toISOString(),
        agency: row.agency_name ?? row.agency_code,
        purpose: row.purpose,
        action: row.action,
        reference: row.correlation_id,
      })),
    };
  }

  async createCorrectionRequest(
    actor: AuthenticatedActor,
    input: {
      fieldPath: string;
      requestedValue: string;
      justification: string;
      evidenceReference?: string | null;
    },
    context: RequestContext,
  ): Promise<{ reference: string; status: string }> {
    const { id, pcid } = await this.ownCitizenId(actor);
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
    });

    const editable = selfServiceEditableFields('CITIZEN');
    const correctable = [
      ...editable,
      'citizen.givenName',
      'citizen.middleName',
      'citizen.familyName',
      'citizen.dateOfBirth',
      'citizen.registeredAddress',
      'citizen.lgaCode',
      'citizen.wardCode',
      'citizen.sex',
    ];
    if (!correctable.includes(input.fieldPath)) {
      throw AppError.validation('That field cannot be corrected through the citizen portal.', [
        { path: 'fieldPath', message: `Correctable fields: ${correctable.join(', ')}` },
      ]);
    }

    const reference = await this.policy.nextReference('CORRECTION', 'COR');
    await this.db.query(
      `INSERT INTO correction_request (
         reference, citizen_id, requested_by_type, requested_by_id, field_path,
         requested_value, justification, evidence_reference, status
       ) VALUES ($1,$2,'CITIZEN',$3,$4,$5,$6,$7,'SUBMITTED')`,
      [
        reference,
        id,
        actor.subject.userId,
        input.fieldPath,
        input.requestedValue,
        input.justification,
        input.evidenceReference ?? null,
      ],
    );
    await this.audit.record({
      action: 'CORRECTION_REQUEST_CREATE',
      outcome: 'PERMITTED',
      actorType: 'CITIZEN',
      actorId: actor.subject.userId,
      actorDisplay: actor.displayName,
      purpose: 'CITIZEN_SELF_SERVICE',
      resourceType: 'CORRECTION_REQUEST',
      resourceId: reference,
      subjectPcid: pcid,
      correlationId: context.correlationId,
      ipAddress: context.ipAddress,
      detail: { fieldPath: input.fieldPath },
    });
    return { reference, status: 'SUBMITTED' };
  }

  async listCorrectionRequests(
    actor: AuthenticatedActor,
    context: RequestContext,
  ): Promise<Record<string, unknown>[]> {
    const { id, pcid } = await this.ownCitizenId(actor);
    await this.policy.authorize({
      actor,
      action: 'CITIZEN_VIEW',
      purpose: 'CITIZEN_SELF_SERVICE',
      resource: { type: 'CITIZEN', id, classification: 'CONFIDENTIAL', subjectPcid: pcid },
      context,
    });
    const rows = await this.db.query<{
      reference: string;
      field_path: string;
      requested_value: string;
      status: string;
      created_at: Date;
      review_note: string | null;
    }>(
      `SELECT reference, field_path, requested_value, status, created_at, review_note
         FROM correction_request WHERE citizen_id = $1 ORDER BY created_at DESC`,
      [id],
    );
    return rows.map((row) => ({
      reference: row.reference,
      fieldPath: row.field_path,
      requestedValue: row.requested_value,
      status: row.status,
      submittedAt: row.created_at.toISOString(),
      reviewNote: row.review_note,
    }));
  }
}
