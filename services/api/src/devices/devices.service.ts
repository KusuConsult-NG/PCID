import { Injectable } from '@nestjs/common';
import type { DevicePlatform, DeviceRevocationReason } from '@pcid/contracts';

import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../common/correlation';
import { AppError } from '../common/errors';
import { Database } from '../database/pool';
import type { AuthenticatedActor } from '../iam/actor';
import { newOpaqueToken, opaqueTokenHash } from '../security/crypto.service';

export interface RegisteredDevice {
  readonly id: string;
  readonly label: string;
  readonly platform: DevicePlatform;
  readonly registeredAt: string;
  readonly lastSeenAt: string;
  readonly revokedAt: string | null;
  readonly revokedReason: DeviceRevocationReason | null;
  /** True when this is the device the current request came from. */
  readonly current: boolean;
}

interface DeviceRow {
  id: string;
  label: string;
  platform: string;
  registered_at: Date;
  last_seen_at: Date;
  revoked_at: Date | null;
  revoked_reason: string | null;
}

/**
 * The register of devices allowed to hold something offline (§56).
 *
 * A device is not an identity and cannot authenticate anything on its own: it is
 * presented alongside an ordinary authenticated session, and all it does is name
 * the thing that would be holding a bundle. That is deliberate. A device secret
 * that could stand in for a sign-in would be a credential lying in storage on a
 * phone, which is precisely the risk this table exists to bound.
 *
 * The person sees their own devices and can revoke any of them, which is the
 * control that matters when a phone is lost: it is the owner, not a help desk,
 * who knows first.
 */
@Injectable()
export class DevicesService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /**
   * Register the device this request came from, or recognise it.
   *
   * The secret is generated here and returned once. The platform keeps a hash,
   * so a copy of the table is not a set of working device identities.
   */
  async register(
    actor: AuthenticatedActor,
    input: { label: string; platform: DevicePlatform },
    context: RequestContext,
  ): Promise<{ deviceId: string; deviceToken: string; label: string }> {
    const token = newOpaqueToken();
    const isCitizen = actor.subject.actorType === 'CITIZEN';

    const row = await this.db.queryOne<{ id: string }>(
      `INSERT INTO registered_device (
         actor_type, government_user_id, citizen_account_id, device_token_hash,
         label, platform, user_agent
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id`,
      [
        actor.subject.actorType,
        isCitizen ? null : actor.subject.userId,
        isCitizen ? actor.subject.userId : null,
        opaqueTokenHash(token),
        input.label,
        input.platform,
        context.userAgent,
      ],
    );
    if (row === null) throw new Error('device registration returned no row');

    // Bind the session that registered it, so ending the device ends the session
    // it was registered from rather than leaving a signed-in browser behind.
    await this.db.query(
      'UPDATE user_session SET registered_device_id = $2 WHERE id = $1 AND revoked_at IS NULL',
      [actor.sessionId, row.id],
    );

    await this.audit.record({
      action: 'OFFLINE_ACCESS',
      outcome: 'PERMITTED',
      actorType: actor.subject.actorType,
      actorId: actor.subject.userId,
      actorDisplay: actor.displayName,
      agencyId: actor.subject.agencyId,
      agencyCode: actor.agencyCode,
      roles: actor.subject.roles,
      resourceType: 'SYSTEM',
      resourceId: row.id,
      subjectPcid: actor.subject.subjectPcid ?? null,
      correlationId: context.correlationId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      deviceFingerprint: context.deviceFingerprint,
      detail: { change: 'DEVICE_REGISTERED', label: input.label, platform: input.platform },
    });

    return { deviceId: row.id, deviceToken: token, label: input.label };
  }

  async list(actor: AuthenticatedActor, context: RequestContext): Promise<RegisteredDevice[]> {
    const current = await this.currentDeviceId(actor, context);
    const rows = await this.db.query<DeviceRow>(
      `SELECT id, label, platform, registered_at, last_seen_at, revoked_at, revoked_reason
         FROM registered_device
        WHERE ${this.ownerClause(actor)}
        ORDER BY revoked_at NULLS FIRST, last_seen_at DESC`,
      [actor.subject.userId],
    );
    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      platform: row.platform as DevicePlatform,
      registeredAt: row.registered_at.toISOString(),
      lastSeenAt: row.last_seen_at.toISOString(),
      revokedAt: row.revoked_at?.toISOString() ?? null,
      revokedReason: (row.revoked_reason as DeviceRevocationReason | null) ?? null,
      current: row.id === current,
    }));
  }

  /**
   * End a device. The trigger on the table invalidates whatever it was holding,
   * and the sessions opened on it are revoked here.
   */
  async revoke(
    actor: AuthenticatedActor,
    deviceId: string,
    reason: DeviceRevocationReason,
    context: RequestContext,
  ): Promise<{ id: string; revokedAt: string }> {
    const revoked = await this.db.transaction(async (runner) => {
      const row = await runner.queryOne<{ id: string; revoked_at: Date; label: string }>(
        `UPDATE registered_device
            SET revoked_at = now(), revoked_reason = $3,
                revoked_by_user_id = CASE WHEN $4::boolean THEN NULL ELSE $2::uuid END
          WHERE id = $1 AND ${this.ownerClause(actor, 2)} AND revoked_at IS NULL
          RETURNING id, revoked_at, label`,
        [deviceId, actor.subject.userId, reason, actor.subject.actorType === 'CITIZEN'],
      );
      if (row === null) return null;
      await runner.query(
        `UPDATE user_session
            SET revoked_at = now(), revoked_reason = 'DEVICE_REVOKED'
          WHERE registered_device_id = $1 AND revoked_at IS NULL`,
        [row.id],
      );
      return row;
    });

    if (revoked === null) {
      throw AppError.notFoundOrNotPermitted(`no live device ${deviceId} for this account`);
    }

    await this.audit.record({
      action: 'OFFLINE_ACCESS',
      outcome: 'PERMITTED',
      actorType: actor.subject.actorType,
      actorId: actor.subject.userId,
      actorDisplay: actor.displayName,
      agencyId: actor.subject.agencyId,
      agencyCode: actor.agencyCode,
      roles: actor.subject.roles,
      resourceType: 'SYSTEM',
      resourceId: revoked.id,
      subjectPcid: actor.subject.subjectPcid ?? null,
      correlationId: context.correlationId,
      ipAddress: context.ipAddress,
      detail: { change: 'DEVICE_REVOKED', label: revoked.label, reason },
    });

    return { id: revoked.id, revokedAt: revoked.revoked_at.toISOString() };
  }

  /**
   * Resolve the device this request came from, refusing a revoked one.
   *
   * `null` means "no device presented", which is the ordinary case for a desktop
   * browser and is not an error. A *revoked* device is an error, and a specific
   * one, because the client is meant to act on it by erasing what it holds.
   */
  async requireLiveDevice(
    actor: AuthenticatedActor,
    context: RequestContext,
  ): Promise<{ id: string }> {
    const presented = context.deviceToken;
    if (presented === null || presented.trim() === '') {
      throw AppError.validation('This request must come from a registered device.', [
        { path: 'x-device-token', message: 'Register the device before taking anything offline.' },
      ]);
    }
    const row = await this.db.queryOne<{ id: string; revoked_at: Date | null }>(
      `SELECT id, revoked_at FROM registered_device
        WHERE device_token_hash = $2 AND ${this.ownerClause(actor)}`,
      [actor.subject.userId, opaqueTokenHash(presented)],
    );
    if (row === null) {
      throw AppError.notFoundOrNotPermitted(
        'the presented device is not registered to this account',
      );
    }
    if (row.revoked_at !== null) {
      throw new AppError(
        'ACCESS_DENIED',
        'This device has been signed out and may no longer hold anything. Erase what it holds.',
        { internalReason: `device ${row.id} was revoked at ${row.revoked_at.toISOString()}` },
      );
    }
    await this.db.query('UPDATE registered_device SET last_seen_at = now() WHERE id = $1', [
      row.id,
    ]);
    return { id: row.id };
  }

  private async currentDeviceId(
    actor: AuthenticatedActor,
    context: RequestContext,
  ): Promise<string | null> {
    const presented = context.deviceToken;
    if (presented === null || presented.trim() === '') return null;
    const row = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM registered_device
        WHERE device_token_hash = $2 AND ${this.ownerClause(actor)}`,
      [actor.subject.userId, opaqueTokenHash(presented)],
    );
    return row?.id ?? null;
  }

  /** Scopes every query to the caller's own devices. `$1` is the account id. */
  private ownerClause(actor: AuthenticatedActor, index = 1): string {
    return actor.subject.actorType === 'CITIZEN'
      ? `citizen_account_id = $${index}`
      : `government_user_id = $${index}`;
  }
}
