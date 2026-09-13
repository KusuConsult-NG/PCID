import { Injectable } from '@nestjs/common';
import type { Action, Purpose } from '@pcid/contracts';
import type { PolicyDecision } from '@pcid/policy';

import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { RequestContext } from '../common/correlation';
import { project, withheld } from '../common/projection';
import { Database } from '../database/pool';
import type { AuthenticatedActor } from '../iam/actor';
import { PolicyService } from '../policy/policy.service';
import {
  AssetsService,
  businessFieldValues,
  licenceFieldValues,
  propertyFieldValues,
  revenueFieldValues,
  vehicleFieldValues,
} from '../assets/assets.service';
import { CitizensService } from './citizens.service';
import type { AccessReferences } from './citizens.service';
import { citizenFieldValues } from './citizen.mapper';
import { PcidService } from './pcid.service';

export type CardKey =
  | 'IDENTITY'
  | 'CONTACT'
  | 'ADDRESS'
  | 'EMERGENCY'
  | 'PROPERTY'
  | 'VEHICLES'
  | 'BUSINESS'
  | 'LICENCES'
  | 'REVENUE'
  | 'GOVERNMENT_SERVICES'
  | 'PUBLIC_SAFETY'
  | 'CASE_ASSOCIATIONS';

export type Card =
  | {
      readonly key: CardKey;
      readonly title: string;
      readonly status: 'RELEASED';
      readonly items: readonly Record<string, unknown>[];
      readonly restrictedFields: readonly string[];
    }
  | {
      readonly key: CardKey;
      readonly title: string;
      readonly status: 'RESTRICTED';
      /** Operator-facing explanation of what is missing, never the data itself. */
      readonly reason: string;
    };

export interface Citizen360 {
  readonly pcid: string;
  readonly purpose: Purpose;
  readonly cards: readonly Card[];
  readonly generatedAt: string;
}

const CARD_TITLES: Record<CardKey, string> = {
  IDENTITY: 'Identity',
  CONTACT: 'Contact',
  ADDRESS: 'Address',
  EMERGENCY: 'Emergency',
  PROPERTY: 'Property',
  VEHICLES: 'Vehicles',
  BUSINESS: 'Business',
  LICENCES: 'Licences',
  REVENUE: 'Revenue',
  GOVERNMENT_SERVICES: 'Government services',
  PUBLIC_SAFETY: 'Public safety',
  CASE_ASSOCIATIONS: 'Case associations',
};

/**
 * The Citizen 360 view (master system prompt §29, §30).
 *
 * Assembled card by card, each one authorised independently. A card the caller
 * may not see comes back as RESTRICTED with a reason - the interface says
 * "Restricted information" rather than silently omitting it, which is what stops
 * an officer from mistaking an absent card for an absent record.
 *
 * "360" describes the *shape* of the view, not its contents: for most callers
 * most cards are restricted, and that is the intended outcome.
 */
@Injectable()
export class Citizen360Service {
  constructor(
    private readonly db: Database,
    private readonly policy: PolicyService,
    private readonly citizens: CitizensService,
    private readonly assets: AssetsService,
    private readonly audit: AuditService,
    private readonly pcid: PcidService,
  ) {}

  async build(
    actor: AuthenticatedActor,
    pcidInput: string,
    purpose: Purpose,
    references: AccessReferences,
    context: RequestContext,
  ): Promise<Citizen360> {
    const pcid = this.pcid.parse(pcidInput);
    const [row, links] = await Promise.all([
      this.citizens.findRow(pcid),
      this.citizens.loadLinks(pcid),
    ]);

    const citizenResource = {
      type: 'CITIZEN' as const,
      id: row?.id ?? null,
      classification: (row?.classification ?? 'CONFIDENTIAL') as 'CONFIDENTIAL',
      subjectPcid: pcid,
      lgaCode: row?.lga_code ?? null,
      wardCode: row?.ward_code ?? null,
      linkedCaseIds: links.caseIds,
      linkedIncidentIds: links.incidentIds,
    };

    // The identity card gates the whole view: a caller who may not see who this
    // is has no business seeing what they own.
    const identityDecision = await this.policy.evaluateOnly({
      actor,
      action: 'CITIZEN_VIEW',
      purpose,
      resource: citizenResource,
      caseRef: references.caseRef ?? null,
      incidentRef: references.incidentRef ?? null,
      breakGlassRef: references.breakGlassRef ?? null,
      context,
    });

    if (identityDecision.effect === 'DENY' || row === null) {
      await this.audit.recordDecision(
        {
          action: 'CITIZEN_VIEW',
          actorType: actor.subject.actorType,
          actorId: actor.subject.userId,
          actorDisplay: actor.displayName,
          agencyId: actor.subject.agencyId,
          agencyCode: actor.agencyCode,
          roles: actor.subject.roles,
          purpose,
          resourceType: 'CITIZEN',
          resourceId: row?.id ?? null,
          subjectPcid: pcid,
          correlationId: context.correlationId,
          ipAddress: context.ipAddress,
          detail: { view: 'CITIZEN_360' },
        },
        identityDecision,
      );
      throw AppError.notFoundOrNotPermitted(
        identityDecision.reasons[0]?.code ?? `no citizen record for ${pcid}`,
      );
    }

    const contacts = await this.db.query<{
      id: string;
      full_name: string;
      relationship: string;
      phone_primary: string;
      phone_secondary: string | null;
      priority: number;
      verification_status: string;
    }>(
      `SELECT id, full_name, relationship, phone_primary, phone_secondary, priority, verification_status
         FROM emergency_contact WHERE citizen_id = $1 ORDER BY priority`,
      [row.id],
    );

    const citizenValues = citizenFieldValues(row, { emergencyContacts: contacts });
    const cards: Card[] = [];

    cards.push(
      cardFromDecision('IDENTITY', identityDecision, [
        project(
          identityDecision,
          pick(citizenValues, [
            'citizen.pcid',
            'citizen.displayName',
            'citizen.givenName',
            'citizen.middleName',
            'citizen.familyName',
            'citizen.sex',
            'citizen.dateOfBirth',
            'citizen.approximateAge',
            'citizen.photographUri',
            'citizen.status',
            'citizen.verificationLevel',
            'citizen.nin',
          ]),
        ),
      ]),
    );
    cards.push(
      cardFromDecision('CONTACT', identityDecision, [
        project(
          identityDecision,
          pick(citizenValues, ['citizen.phonePrimary', 'citizen.phoneSecondary', 'citizen.email']),
        ),
      ]),
    );
    cards.push(
      cardFromDecision('ADDRESS', identityDecision, [
        project(
          identityDecision,
          pick(citizenValues, ['citizen.registeredAddress', 'citizen.lgaCode', 'citizen.wardCode']),
        ),
      ]),
    );
    cards.push(
      cardFromDecision('EMERGENCY', identityDecision, [
        project(
          identityDecision,
          pick(citizenValues, [
            'citizen.emergencyContacts',
            'citizen.bloodGroup',
            'citizen.emergencyMedicalNotes',
          ]),
        ),
      ]),
    );

    cards.push(
      await this.linkedCard(
        'PROPERTY',
        'PROPERTY_VIEW',
        'PROPERTY',
        actor,
        purpose,
        references,
        context,
        pcid,
        async () => (await this.assets.propertiesForCitizen(pcid)).map(propertyFieldValues),
      ),
    );
    cards.push(
      await this.linkedCard(
        'VEHICLES',
        'VEHICLE_VIEW',
        'VEHICLE',
        actor,
        purpose,
        references,
        context,
        pcid,
        async () => (await this.assets.vehiclesForCitizen(pcid)).map(vehicleFieldValues),
      ),
    );
    cards.push(
      await this.linkedCard(
        'BUSINESS',
        'BUSINESS_VIEW',
        'BUSINESS',
        actor,
        purpose,
        references,
        context,
        pcid,
        async () => (await this.assets.businessesForCitizen(pcid)).map(businessFieldValues),
      ),
    );
    cards.push(
      await this.linkedCard(
        'LICENCES',
        'LICENCE_VIEW',
        'LICENCE',
        actor,
        purpose,
        references,
        context,
        pcid,
        async () => (await this.assets.licencesForCitizen(pcid)).map(licenceFieldValues),
      ),
    );
    cards.push(
      await this.linkedCard(
        'REVENUE',
        'REVENUE_VIEW',
        'REVENUE_PROFILE',
        actor,
        purpose,
        references,
        context,
        pcid,
        async () => (await this.assets.revenueForCitizen(pcid)).map(revenueFieldValues),
      ),
    );

    cards.push(await this.programmesCard(actor, purpose, references, context, pcid));
    cards.push(
      await this.publicSafetyCard(actor, purpose, references, context, pcid, citizenResource),
    );
    cards.push(
      await this.caseAssociationsCard(actor, purpose, references, context, pcid, links.caseIds),
    );

    await this.audit.recordDecision(
      {
        action: 'CITIZEN_VIEW',
        actorType: actor.subject.actorType,
        actorId: actor.subject.userId,
        actorDisplay: actor.displayName,
        agencyId: actor.subject.agencyId,
        agencyCode: actor.agencyCode,
        roles: actor.subject.roles,
        purpose,
        resourceType: 'CITIZEN',
        resourceId: row.id,
        subjectPcid: pcid,
        correlationId: context.correlationId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        deviceFingerprint: context.deviceFingerprint,
        detail: {
          view: 'CITIZEN_360',
          cardsReleased: cards.filter((card) => card.status === 'RELEASED').map((card) => card.key),
          cardsRestricted: cards
            .filter((card) => card.status === 'RESTRICTED')
            .map((card) => card.key),
        },
      },
      identityDecision,
    );

    return { pcid, purpose, cards, generatedAt: new Date().toISOString() };
  }

  private async linkedCard(
    key: CardKey,
    action: Action,
    resourceType: 'PROPERTY' | 'VEHICLE' | 'BUSINESS' | 'LICENCE' | 'REVENUE_PROFILE',
    actor: AuthenticatedActor,
    purpose: Purpose,
    references: AccessReferences,
    context: RequestContext,
    pcid: string,
    load: () => Promise<Record<string, unknown>[]>,
  ): Promise<Card> {
    const linkedCaseIds = await this.db
      .query<{ case_id: string }>(
        `SELECT case_id FROM case_subject
          WHERE subject_type = 'CITIZEN' AND subject_id = $1 AND unlinked_at IS NULL`,
        [pcid],
      )
      .then((rows) => rows.map((row) => row.case_id));

    const decision = await this.policy.evaluateOnly({
      actor,
      action,
      purpose,
      resource: {
        type: resourceType,
        id: null,
        classification: 'CONFIDENTIAL',
        subjectPcid: pcid,
        linkedCaseIds,
      },
      caseRef: references.caseRef ?? null,
      incidentRef: references.incidentRef ?? null,
      breakGlassRef: references.breakGlassRef ?? null,
      context,
    });
    if (decision.effect === 'DENY') return restricted(key, decision);
    const values = await load();
    return cardFromDecision(
      key,
      decision,
      values.map((value) => project(decision, value)),
    );
  }

  private async programmesCard(
    actor: AuthenticatedActor,
    purpose: Purpose,
    references: AccessReferences,
    context: RequestContext,
    pcid: string,
  ): Promise<Card> {
    const decision = await this.policy.evaluateOnly({
      actor,
      action: 'PROGRAMME_VIEW',
      purpose,
      resource: {
        type: 'GOVERNMENT_PROGRAMME',
        id: null,
        classification: 'CONFIDENTIAL',
        subjectPcid: pcid,
      },
      caseRef: references.caseRef ?? null,
      incidentRef: references.incidentRef ?? null,
      context,
    });
    if (decision.effect === 'DENY') return restricted('GOVERNMENT_SERVICES', decision);
    const rows = await this.db.query<{ name: string; status: string; enrolled_at: Date }>(
      `SELECT gp.name, pe.status, pe.enrolled_at
         FROM programme_enrolment pe JOIN government_programme gp ON gp.id = pe.programme_id
        WHERE pe.citizen_pcid = $1 ORDER BY pe.enrolled_at DESC`,
      [pcid],
    );
    return {
      key: 'GOVERNMENT_SERVICES',
      title: CARD_TITLES.GOVERNMENT_SERVICES,
      status: 'RELEASED',
      items: rows.map((row) => ({
        name: row.name,
        status: row.status,
        enrolledAt: row.enrolled_at.toISOString(),
      })),
      restrictedFields: [],
    };
  }

  private async publicSafetyCard(
    actor: AuthenticatedActor,
    purpose: Purpose,
    references: AccessReferences,
    context: RequestContext,
    pcid: string,
    citizenResource: { linkedCaseIds: readonly string[]; linkedIncidentIds: readonly string[] },
  ): Promise<Card> {
    const decision = await this.policy.evaluateOnly({
      actor,
      action: 'MISSING_PERSON_VIEW',
      purpose,
      resource: {
        type: 'MISSING_PERSON',
        id: null,
        classification: 'SENSITIVE',
        subjectPcid: pcid,
        linkedCaseIds: citizenResource.linkedCaseIds,
        linkedIncidentIds: citizenResource.linkedIncidentIds,
      },
      caseRef: references.caseRef ?? null,
      incidentRef: references.incidentRef ?? null,
      breakGlassRef: references.breakGlassRef ?? null,
      context,
    });
    if (decision.effect === 'DENY') return restricted('PUBLIC_SAFETY', decision);
    const rows = await this.db.query<{ case_reference: string; status: string; created_at: Date }>(
      `SELECT case_reference, status, created_at FROM missing_person WHERE citizen_pcid = $1
        ORDER BY created_at DESC`,
      [pcid],
    );
    return {
      key: 'PUBLIC_SAFETY',
      title: CARD_TITLES.PUBLIC_SAFETY,
      status: 'RELEASED',
      items: rows.map((row) => ({
        kind: 'MISSING_PERSON_CASE',
        reference: row.case_reference,
        status: row.status,
        openedAt: row.created_at.toISOString(),
      })),
      restrictedFields: [],
    };
  }

  private async caseAssociationsCard(
    actor: AuthenticatedActor,
    purpose: Purpose,
    references: AccessReferences,
    context: RequestContext,
    pcid: string,
    linkedCaseIds: readonly string[],
  ): Promise<Card> {
    const decision = await this.policy.evaluateOnly({
      actor,
      action: 'CASE_VIEW',
      purpose,
      resource: {
        type: 'CASE',
        id: null,
        classification: 'LAW_ENFORCEMENT_RESTRICTED',
        subjectPcid: pcid,
        linkedCaseIds,
      },
      caseRef: references.caseRef ?? null,
      context,
    });
    if (decision.effect === 'DENY') return restricted('CASE_ASSOCIATIONS', decision);

    // Only cases this officer is actually assigned to are listed, even now.
    const rows = await this.db.query<{ case_number: string; type: string; status: string }>(
      `SELECT ic.case_number, ic.type, ic.status
         FROM case_subject cs
         JOIN investigation_case ic ON ic.id = cs.case_id
         JOIN case_assignment ca ON ca.case_id = ic.id AND ca.user_id = $2 AND ca.released_at IS NULL
        WHERE cs.subject_type = 'CITIZEN' AND cs.subject_id = $1 AND cs.unlinked_at IS NULL
        ORDER BY ic.opened_at DESC`,
      [pcid, actor.subject.userId],
    );
    return {
      key: 'CASE_ASSOCIATIONS',
      title: CARD_TITLES.CASE_ASSOCIATIONS,
      status: 'RELEASED',
      items: rows.map((row) => ({
        caseNumber: row.case_number,
        type: row.type,
        status: row.status,
      })),
      restrictedFields: [],
    };
  }
}

function pick(values: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const field of fields) {
    if (field in values) output[field] = values[field];
  }
  return output;
}

function cardFromDecision(
  key: CardKey,
  decision: PolicyDecision,
  items: readonly Record<string, unknown>[],
): Card {
  if (decision.effect === 'DENY') return restricted(key, decision);
  const populated = items.filter((item) => Object.keys(item).length > 0);
  return {
    key,
    title: CARD_TITLES[key],
    status: 'RELEASED',
    items: populated,
    restrictedFields: withheld(decision),
  };
}

function restricted(key: CardKey, decision: PolicyDecision): Card {
  return {
    key,
    title: CARD_TITLES[key],
    status: 'RESTRICTED',
    reason: decision.reasons[0]?.message ?? 'Restricted information.',
  };
}
