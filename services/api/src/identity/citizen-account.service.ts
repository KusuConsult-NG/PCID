import { randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { RequestContext } from '../common/correlation';
import { Database } from '../database/pool';
import type { AuthenticatedActor } from '../iam/actor';
import { PolicyService } from '../policy/policy.service';
import { PasswordService } from '../security/password.service';
import { PcidService } from './pcid.service';

/**
 * Issuing citizen portal credentials (master system prompt §57, §58).
 *
 * Deliberately not self-service. A resident receives portal credentials from a
 * registration desk after their identity has been checked in person, because an
 * open self-enrolment endpoint on a state identity registry is an account
 * takeover route: anyone who knows a PCID could otherwise claim the record.
 *
 * The temporary passphrase is shown once to the issuing officer and must be
 * changed on first use.
 */
@Injectable()
export class CitizenAccountService {
  constructor(
    private readonly db: Database,
    private readonly policy: PolicyService,
    private readonly passwords: PasswordService,
    private readonly pcid: PcidService,
    private readonly audit: AuditService,
  ) {}

  async issuePortalCredentials(
    actor: AuthenticatedActor,
    pcidInput: string,
    context: RequestContext,
  ): Promise<{ pcid: string; temporaryPassword: string }> {
    const pcid = this.pcid.parse(pcidInput);
    const citizen = await this.db.queryOne<{
      id: string;
      email: string | null;
      phone_primary: string | null;
      lga_code: string | null;
      ward_code: string | null;
      classification: string;
    }>(
      'SELECT id, email, phone_primary, lga_code, ward_code, classification FROM citizen WHERE pcid = $1',
      [pcid],
    );

    await this.policy.authorize({
      actor,
      action: 'CITIZEN_UPDATE',
      purpose: 'SERVICE_DELIVERY',
      resource: {
        type: 'CITIZEN',
        id: citizen?.id ?? null,
        classification: (citizen?.classification ?? 'CONFIDENTIAL') as 'CONFIDENTIAL',
        subjectPcid: pcid,
        lgaCode: citizen?.lga_code ?? null,
        wardCode: citizen?.ward_code ?? null,
      },
      context,
      auditDetail: { change: 'PORTAL_CREDENTIALS_ISSUED' },
    });
    if (citizen === null) throw AppError.notFoundOrNotPermitted(`no citizen record for ${pcid}`);

    const existing = await this.db.queryOne<{ id: string }>(
      'SELECT id FROM citizen_account WHERE pcid = $1',
      [pcid],
    );
    if (existing !== null) {
      throw AppError.conflict('This resident already has portal credentials.');
    }

    const temporaryPassword = `Plateau-${randomBytes(6).toString('base64url')}-2026`;
    const stored = await this.passwords.hash(temporaryPassword);
    await this.db.query(
      `INSERT INTO citizen_account (pcid, email, phone, status, password_hash, password_algorithm,
                                    password_params, mfa_enrolled)
       VALUES ($1,$2,$3,'ACTIVE',$4,$5,$6::jsonb,false)`,
      [
        pcid,
        citizen.email,
        citizen.phone_primary,
        stored.hash,
        stored.algorithm,
        JSON.stringify(stored.params),
      ],
    );

    await this.audit.record({
      action: 'UPDATE_CITIZEN',
      outcome: 'PERMITTED',
      actorType: actor.subject.actorType,
      actorId: actor.subject.userId,
      actorDisplay: actor.displayName,
      agencyId: actor.subject.agencyId,
      agencyCode: actor.agencyCode,
      roles: actor.subject.roles,
      purpose: 'SERVICE_DELIVERY',
      resourceType: 'CITIZEN',
      resourceId: citizen.id,
      subjectPcid: pcid,
      correlationId: context.correlationId,
      ipAddress: context.ipAddress,
      detail: { change: 'PORTAL_CREDENTIALS_ISSUED' },
    });

    return { pcid, temporaryPassword };
  }
}
