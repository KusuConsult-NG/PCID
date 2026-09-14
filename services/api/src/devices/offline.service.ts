import { Injectable } from '@nestjs/common';
import {
  OFFLINE_BUNDLE_MAX_RECORDS,
  offlineBundleTtlSeconds,
  type OfflineBundleKind,
} from '@pcid/contracts';

import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../common/correlation';
import { AppError } from '../common/errors';
import { Database } from '../database/pool';
import { CitizensService } from '../identity/citizens.service';
import type { AuthenticatedActor } from '../iam/actor';
import { IncidentsService } from '../emergency/incidents.service';
import { PolicyService } from '../policy/policy.service';
import { DevicesService } from './devices.service';

export interface OfflineBundle {
  readonly kind: OfflineBundleKind;
  readonly deviceId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  /** What the client must ask about when it next reaches the network. */
  readonly releaseId: string;
  readonly records: readonly OfflineRecord[];
  /** Shown to the holder, so they know what they are carrying and for how long. */
  readonly notice: string;
}

export interface OfflineRecord {
  readonly subject: string;
  readonly data: Record<string, unknown>;
  readonly restrictedFields: readonly string[];
}

/**
 * The controlled offline mode (master system prompt §56).
 *
 * The case is narrow and worth stating before the code: a crew at a roadside
 * with no signal still has to know whether the person in front of them is
 * diabetic, and a resident in a queue with no coverage still has to be able to
 * show their Plateau Citizen ID. Everything else in this platform is read
 * online, under a decision made at the moment of reading, and stays that way.
 *
 * What makes this safe is that a bundle is **not a new read**. Every record in
 * an incident pack is produced by the ordinary emergency-profile path, one
 * person at a time, each authorised by the policy engine and each written to the
 * audit trail exactly as if the responder had opened it on screen. The bundle
 * cannot therefore contain anything its holder could not have read anyway; what
 * `OFFLINE_ACCESS` adds is permission to keep it for a while, which is a
 * different question and is asked separately.
 *
 * Three things this deliberately does not do:
 *
 *  - It does not let a responder name the people. The pack covers exactly those
 *    already attached to the incident, so "take this person offline" is not an
 *    operation and the register cannot be walked one profile at a time.
 *  - It does not survive the incident. A pack is refused for an incident that is
 *    not live, by the same binding gate that refuses everything else about one.
 *  - It does not hold the payload server-side. The platform records that a
 *    release happened, to which device, covering how many people - and never the
 *    contents, which would put the same personal data in a second place under a
 *    second retention rule.
 */
@Injectable()
export class OfflineService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
    private readonly devices: DevicesService,
    private readonly policy: PolicyService,
    private readonly citizens: CitizensService,
    private readonly incidents: IncidentsService,
  ) {}

  /**
   * A resident's own card: the identifier and the name printed on it.
   *
   * Deliberately not the record. A resident who wants their address or their
   * emergency contacts reads them in the portal, online, where the access is
   * decided and logged. What goes on the phone is the thing they have to show
   * somebody when there is no coverage, and nothing else.
   */
  async citizenCard(actor: AuthenticatedActor, context: RequestContext): Promise<OfflineBundle> {
    const pcid = actor.subject.subjectPcid ?? null;
    if (pcid === null) {
      throw AppError.notFoundOrNotPermitted('the account is not linked to a registry record');
    }
    const device = await this.devices.requireLiveDevice(actor, context);

    const decision = await this.policy.authorize({
      actor,
      action: 'OFFLINE_ACCESS',
      purpose: 'CITIZEN_SELF_SERVICE',
      resource: {
        type: 'CITIZEN',
        id: null,
        classification: 'CONFIDENTIAL',
        subjectPcid: pcid,
        requestedFields: ['citizen.pcid', 'citizen.displayName'],
      },
      context,
      auditDetail: { offline: 'CITIZEN_CARD', deviceId: device.id },
    });

    // Taken from an authorised read rather than assembled here, so the card
    // carries what the catalogue released and not what this method assumed.
    // Keys are the short form every other response uses.
    const record = await this.citizens.view(actor, pcid, 'CITIZEN_SELF_SERVICE', {}, context);
    const card: OfflineRecord = {
      subject: pcid,
      data: {
        pcid: record.data.pcid ?? pcid,
        displayName: record.data.displayName ?? actor.displayName,
      },
      restrictedFields: [],
    };

    return this.release({
      kind: 'CITIZEN_CARD',
      deviceId: device.id,
      incidentId: null,
      subjectPcid: pcid,
      records: [card],
      auditEventId: decision.auditEventId,
      notice:
        'Your Plateau Citizen ID, kept on this device so you can show it where there is no ' +
        'coverage. Nothing else about you is held here, and it is erased when it expires or ' +
        'when you sign this device out.',
    });
  }

  /**
   * The pack for one incident: the people already attached to it, each through
   * the ordinary emergency-profile release.
   */
  async incidentProfiles(
    actor: AuthenticatedActor,
    reference: string,
    context: RequestContext,
  ): Promise<OfflineBundle> {
    const device = await this.devices.requireLiveDevice(actor, context);
    const incident = await this.incidents.findByReference(reference);

    // Authorised against the incident before anybody is named, so a responder
    // who is not attached to it is refused without learning who is on it.
    const decision = await this.policy.authorize({
      actor,
      action: 'OFFLINE_ACCESS',
      purpose: 'EMERGENCY_RESPONSE',
      resource: {
        type: 'INCIDENT',
        id: incident?.id ?? null,
        classification: 'CONFIDENTIAL',
        subjectPcid: null,
        lgaCode: incident?.lga_code ?? null,
      },
      incidentRef: reference,
      context,
      auditDetail: { offline: 'INCIDENT_PROFILES', deviceId: device.id },
    });
    if (incident === null) {
      throw AppError.notFoundOrNotPermitted(`no incident ${reference}`);
    }

    const people = await this.db.query<{ citizen_pcid: string }>(
      `SELECT DISTINCT citizen_pcid FROM incident_person
        WHERE incident_id = $1 AND citizen_pcid IS NOT NULL
        ORDER BY citizen_pcid`,
      [incident.id],
    );
    if (people.length > OFFLINE_BUNDLE_MAX_RECORDS) {
      // Refused rather than truncated. A crew cannot tell a shortened list of
      // casualties from a complete one, and a list they trust that is missing
      // somebody is worse than no list at all.
      throw AppError.validation(
        `Incident ${reference} has more people attached than a device may hold ` +
          `(${people.length}, limit ${OFFLINE_BUNDLE_MAX_RECORDS}).`,
        [
          {
            path: 'incident',
            message: 'Work from the control room for an incident of this size.',
          },
        ],
      );
    }

    // One authorised, audited release per person, through the same path a
    // responder's screen uses. Nothing here composes a projection of its own.
    const expiresAt = new Date(Date.now() + offlineBundleTtlSeconds('INCIDENT_PROFILES') * 1000);
    const records: OfflineRecord[] = [];
    for (const person of people) {
      const profile = await this.citizens.emergencyProfile(
        actor,
        person.citizen_pcid,
        { incidentRef: reference },
        context,
      );
      records.push({
        subject: person.citizen_pcid,
        data: profile.data,
        restrictedFields: profile.restrictedFields,
      });

      // A second row, against the person rather than the incident.
      //
      // The decision above is recorded against the incident, which is what an
      // oversight review of the *incident* needs. It is not what the person
      // needs: their own access history (§26) should say not only that their
      // emergency profile was read, but that it was carried away on a device and
      // until when. A history that omits that is answering a narrower question
      // than the one a resident is asking.
      await this.audit.record({
        action: 'OFFLINE_ACCESS',
        outcome: 'PERMITTED',
        actorType: actor.subject.actorType,
        actorId: actor.subject.userId,
        actorDisplay: actor.displayName,
        agencyId: actor.subject.agencyId,
        agencyCode: actor.agencyCode,
        roles: actor.subject.roles,
        purpose: 'EMERGENCY_RESPONSE',
        resourceType: 'CITIZEN',
        subjectPcid: person.citizen_pcid,
        incidentId: incident.id,
        incidentNumber: incident.incident_number,
        fieldsReleased: Object.keys(profile.data),
        correlationId: context.correlationId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        deviceFingerprint: context.deviceFingerprint,
        detail: {
          offline: 'INCIDENT_PROFILES',
          deviceId: device.id,
          expiresAt: expiresAt.toISOString(),
        },
      });
    }

    return this.release({
      kind: 'INCIDENT_PROFILES',
      deviceId: device.id,
      incidentId: incident.id,
      subjectPcid: null,
      records,
      auditEventId: decision.auditEventId,
      expiresAt,
      notice:
        `The people attached to incident ${reference}, held on this device for this job only. ` +
        'It expires on its own, and signing this device out erases it.',
    });
  }

  /** What the client asks on reconnecting: may I still hold this? */
  async releaseStanding(
    actor: AuthenticatedActor,
    releaseId: string,
    context: RequestContext,
  ): Promise<{ id: string; valid: boolean; expiresAt: string; reason: string | null }> {
    const device = await this.devices.requireLiveDevice(actor, context);
    const row = await this.db.queryOne<{
      id: string;
      expires_at: Date;
      invalidated_at: Date | null;
    }>(
      `SELECT id, expires_at, invalidated_at FROM offline_release
        WHERE id = $1 AND device_id = $2`,
      [releaseId, device.id],
    );
    if (row === null) {
      // Unknown to this device: the honest answer is "stop holding it".
      return {
        id: releaseId,
        valid: false,
        expiresAt: new Date(0).toISOString(),
        reason: 'UNKNOWN',
      };
    }
    const expired = row.expires_at.getTime() <= Date.now();
    const invalidated = row.invalidated_at !== null;
    return {
      id: row.id,
      valid: !expired && !invalidated,
      expiresAt: row.expires_at.toISOString(),
      reason: invalidated ? 'REVOKED' : expired ? 'EXPIRED' : null,
    };
  }

  private async release(input: {
    kind: OfflineBundleKind;
    deviceId: string;
    incidentId: string | null;
    subjectPcid: string | null;
    records: readonly OfflineRecord[];
    auditEventId: string | null;
    notice: string;
    /** Passed in where a caller has already told somebody when it expires. */
    expiresAt?: Date;
  }): Promise<OfflineBundle> {
    const issuedAt = new Date();
    const expiresAt =
      input.expiresAt ?? new Date(issuedAt.getTime() + offlineBundleTtlSeconds(input.kind) * 1000);

    const row = await this.db.queryOne<{ id: string }>(
      `INSERT INTO offline_release (
         device_id, kind, incident_id, subject_pcid, record_count, audit_event_id, expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id`,
      [
        input.deviceId,
        input.kind,
        input.incidentId,
        input.subjectPcid,
        input.records.length,
        input.auditEventId,
        expiresAt,
      ],
    );
    if (row === null) throw new Error('offline release insert returned no row');

    return {
      kind: input.kind,
      deviceId: input.deviceId,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      releaseId: row.id,
      records: input.records,
      notice: input.notice,
    };
  }
}
