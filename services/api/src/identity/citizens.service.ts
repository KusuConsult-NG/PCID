import { Inject, Injectable } from '@nestjs/common';
import type { Purpose } from '@pcid/contracts';
import type { PolicyResource } from '@pcid/policy';

import { AppError } from '../common/errors';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import type { RequestContext } from '../common/correlation';
import { project, withheld } from '../common/projection';
import { Database } from '../database/pool';
import { WhereBuilder } from '../common/sql';
import type { AuthenticatedActor } from '../iam/actor';
import { PolicyService } from '../policy/policy.service';
import {
  CITIZEN_COLUMNS,
  citizenFieldValues,
  type CitizenRow,
  type EmergencyContactRow,
  type LawEnforcementMarker,
} from './citizen.mapper';
import { PcidService } from './pcid.service';

export interface AccessReferences {
  readonly caseRef?: string | null;
  readonly incidentRef?: string | null;
  readonly breakGlassRef?: string | null;
}

export interface CitizenSearchCriteria {
  readonly pcid?: string;
  readonly name?: string;
  readonly phone?: string;
  readonly lgaCode?: string;
  readonly wardCode?: string;
  readonly dateOfBirth?: string;
  readonly limit: number;
  readonly offset: number;
}

export interface ProjectedRecord {
  readonly data: Record<string, unknown>;
  readonly restrictedFields: readonly string[];
}

/**
 * Reads of the citizen registry.
 *
 * Every method here follows the same shape: ask the policy service, then project
 * the stored row through the decision. There is no "internal" read path that
 * skips authorisation, and no method returns a row object directly.
 */
@Injectable()
export class CitizensService {
  constructor(
    private readonly db: Database,
    private readonly policy: PolicyService,
    private readonly pcid: PcidService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async search(
    actor: AuthenticatedActor,
    purpose: Purpose,
    criteria: CitizenSearchCriteria,
    references: AccessReferences,
    context: RequestContext,
  ): Promise<{ results: ProjectedRecord[]; total: number }> {
    if (
      criteria.pcid === undefined &&
      criteria.name === undefined &&
      criteria.phone === undefined &&
      criteria.dateOfBirth === undefined
    ) {
      throw AppError.validation('Supply at least one search term.', [
        { path: 'query', message: 'A PCID, name, phone number or date of birth is required.' },
      ]);
    }

    // Authorise the search itself before any row is read. The resource is the
    // registry as a whole, so no particular person is named at this stage.
    const outcome = await this.policy.authorize({
      actor,
      action: 'CITIZEN_SEARCH',
      purpose,
      resource: {
        type: 'CITIZEN',
        id: null,
        classification: 'CONFIDENTIAL',
        subjectPcid: null,
        lgaCode: criteria.lgaCode ?? null,
        wardCode: criteria.wardCode ?? null,
      },
      caseRef: references.caseRef ?? null,
      incidentRef: references.incidentRef ?? null,
      breakGlassRef: references.breakGlassRef ?? null,
      context,
      auditDetail: {
        criteriaUsed: Object.keys(criteria).filter(
          (key) =>
            key !== 'limit' &&
            key !== 'offset' &&
            criteria[key as keyof CitizenSearchCriteria] !== undefined,
        ),
      },
    });

    const where = new WhereBuilder().addRaw("status <> 'MERGED'");

    if (criteria.pcid !== undefined) where.add('pcid = ?', this.pcid.parse(criteria.pcid));
    if (criteria.phone !== undefined) {
      where.add('(phone_primary = ? OR phone_secondary = ?)', criteria.phone, criteria.phone);
    }
    let nameParameter: number | null = null;
    if (criteria.name !== undefined) {
      nameParameter = where.next();
      where.add('display_name % ?', criteria.name);
    }
    if (criteria.dateOfBirth !== undefined)
      where.add('date_of_birth = ?::date', criteria.dateOfBirth);
    if (criteria.lgaCode !== undefined) where.add('lga_code = ?', criteria.lgaCode);
    if (criteria.wardCode !== undefined) where.add('ward_code = ?', criteria.wardCode);

    // A jurisdiction-limited account never sees rows outside its area, even
    // before the per-record gate runs, so result counts stay honest.
    const jurisdiction = actor.subject.jurisdiction;
    if (jurisdiction.scope === 'LGA' && jurisdiction.lgaCodes.length > 0) {
      where.add('lga_code = ANY(?::text[])', jurisdiction.lgaCodes);
    } else if (jurisdiction.scope === 'WARD' && jurisdiction.wardCodes.length > 0) {
      where.add('ward_code = ANY(?::text[])', jurisdiction.wardCodes);
    }
    if (actor.subject.actorType === 'CITIZEN') {
      where.add('pcid = ?', actor.subject.subjectPcid);
    }

    // Count before reading, and count only as far as it matters.
    //
    // Counting every match cost as much as the search itself - 2.6 seconds
    // against a four-million-record register - and told the officer nothing they
    // could use. Stopping at the cap costs tens of milliseconds, because the
    // scan stops as soon as it has found that many.
    const totalRow = await this.db.queryOne<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM (SELECT 1 FROM citizen ${where.sql} LIMIT $${where.next()}) AS bounded`,
      where.withExtra(this.env.SEARCH_MAX_RESULTS + 1),
    );
    const counted = Number(totalRow?.count ?? 0);

    // A search that matches more people than anybody could look through is
    // refused rather than paged.
    //
    // Partly cost: ordering a quarter of a million people to show twenty is work
    // proportional to the register, and any officer could ask for it. Mostly
    // though it is the right answer. A surname against a statewide register is
    // not an identification, and paging through the result is browsing the
    // register - which is the thing this platform exists not to allow (§63). The
    // refusal says what to add, because the officer standing at the counter has
    // the person in front of them and can ask.
    if (counted > this.env.SEARCH_MAX_RESULTS) {
      throw AppError.validation(
        `More than ${this.env.SEARCH_MAX_RESULTS} people match that search. Add the date ` +
          'of birth or a telephone number, or search by Plateau Citizen ID.',
        [
          {
            path: 'query',
            // Only what actually narrows a register of four million. A Local
            // Government Area sounds like it would and does not: a name matches
            // a hundred thousand people and the largest LGA holds several
            // hundred thousand, so the two together are still far too many.
            message:
              'Add the date of birth or a telephone number, or search by Plateau Citizen ID.',
          },
        ],
      );
    }

    // Closest first, not alphabetically first.
    //
    // `ORDER BY display_name` had to sort every matching row before it could
    // return twenty, and there could be a quarter of a million of them. The
    // refusal above is what makes this cheap: there are at most a thousand rows
    // left to order by the time we get here, and sorting a thousand rows by
    // trigram distance costs nothing.
    //
    // A trigram index to answer the ordering from was tried and removed (0014).
    // It was chosen by the planner for a BitmapAnd against the date-of-birth
    // index, where it narrowed nothing and cost a second - on about one search
    // in twelve, unreproducibly, because which plan you get depends on the name
    // you typed.
    //
    // It is also the better answer. An officer searching "Amina Dung" wants the
    // closest matches, not the twenty whose names happen to begin with A.
    const ordering =
      nameParameter === null
        ? 'ORDER BY display_name'
        : `ORDER BY display_name <-> $${nameParameter}`;

    const rows = await this.db.query<CitizenRow>(
      `SELECT ${CITIZEN_COLUMNS} FROM citizen ${where.sql}
        ${ordering} LIMIT $${where.next()} OFFSET $${where.next(2)}`,
      where.withExtra(criteria.limit, criteria.offset),
    );

    return {
      results: rows.map((row) => ({
        data: project(outcome.decision, citizenFieldValues(row)),
        restrictedFields: withheld(outcome.decision),
      })),
      total: counted,
    };
  }

  async view(
    actor: AuthenticatedActor,
    pcidInput: string,
    purpose: Purpose,
    references: AccessReferences,
    context: RequestContext,
  ): Promise<ProjectedRecord> {
    const pcid = this.pcid.parse(pcidInput);
    const [row, links] = await Promise.all([this.findRow(pcid), this.loadLinks(pcid)]);
    const extras = await this.loadExtras(pcid, row?.id ?? null);

    // A record that does not exist and a record that is off limits produce the
    // same answer, but both are evaluated and audited.
    const resource = this.resourceFor(pcid, row, links);
    const outcome = await this.policy.authorize({
      actor,
      action: 'CITIZEN_VIEW',
      purpose,
      resource,
      caseRef: references.caseRef ?? null,
      incidentRef: references.incidentRef ?? null,
      breakGlassRef: references.breakGlassRef ?? null,
      context,
    });

    if (row === null) {
      throw AppError.notFoundOrNotPermitted(`no citizen record for ${pcid}`);
    }
    return {
      data: project(outcome.decision, citizenFieldValues(row, extras)),
      restrictedFields: withheld(outcome.decision),
    };
  }

  /**
   * The Minimum Necessary Emergency Profile (§10, §38). A responder identifying
   * a casualty receives this and nothing else - the projection is enforced by the
   * catalogue's emergency flags, not by the shape of this query.
   */
  async emergencyProfile(
    actor: AuthenticatedActor,
    pcidInput: string,
    references: AccessReferences,
    context: RequestContext,
  ): Promise<ProjectedRecord> {
    const pcid = this.pcid.parse(pcidInput);
    const [row, links] = await Promise.all([this.findRow(pcid), this.loadLinks(pcid)]);
    const extras = await this.loadExtras(pcid, row?.id ?? null);

    const outcome = await this.policy.authorize({
      actor,
      action: 'EMERGENCY_PROFILE_VIEW',
      purpose: 'EMERGENCY_RESPONSE',
      resource: this.resourceFor(pcid, row, links),
      incidentRef: references.incidentRef ?? null,
      breakGlassRef: references.breakGlassRef ?? null,
      context,
    });

    if (row === null) {
      throw AppError.notFoundOrNotPermitted(`no citizen record for ${pcid}`);
    }
    return {
      data: project(outcome.decision, citizenFieldValues(row, extras)),
      restrictedFields: withheld(outcome.decision),
    };
  }

  /**
   * Verification for service delivery (§46 /verification). Answers only whether
   * the presented identifier matches a live record and at what assurance level;
   * it deliberately returns no attributes beyond the name shown on the credential.
   */
  async verify(
    actor: AuthenticatedActor,
    pcidInput: string,
    context: RequestContext,
  ): Promise<{
    valid: boolean;
    status: string | null;
    verificationLevel: string | null;
    displayName: string | null;
  }> {
    const pcid = this.pcid.parse(pcidInput);
    const row = await this.findRow(pcid);

    const outcome = await this.policy.authorize({
      actor,
      action: 'CITIZEN_VERIFY',
      purpose: 'IDENTITY_VERIFICATION',
      resource: {
        ...this.resourceFor(pcid, row),
        requestedFields: ['citizen.displayName', 'citizen.status', 'citizen.verificationLevel'],
      },
      context,
      // Recorded so the resident's own history can say how their identity was
      // checked, rather than leaving it to be inferred.
      auditDetail: { method: 'TYPED_PCID' },
    });

    if (row === null || row.status === 'MERGED') {
      return { valid: false, status: null, verificationLevel: null, displayName: null };
    }
    const data = project(outcome.decision, citizenFieldValues(row));
    return {
      valid: row.status === 'ACTIVE',
      status: (data.status as string) ?? null,
      verificationLevel: (data.verificationLevel as string) ?? null,
      displayName: (data.displayName as string) ?? null,
    };
  }

  async findRow(pcid: string): Promise<CitizenRow | null> {
    return this.db.queryOne<CitizenRow>(`SELECT ${CITIZEN_COLUMNS} FROM citizen WHERE pcid = $1`, [
      pcid,
    ]);
  }

  /** Build the policy resource for a PCID, including the links that open it. */
  async resourceForPcid(pcid: string): Promise<PolicyResource> {
    const [row, links] = await Promise.all([this.findRow(pcid), this.loadLinks(pcid)]);
    return this.resourceFor(pcid, row, links);
  }

  private resourceFor(
    pcid: string,
    row: CitizenRow | null,
    links: { caseIds: readonly string[]; incidentIds: readonly string[] } = {
      caseIds: [],
      incidentIds: [],
    },
  ): PolicyResource {
    return {
      type: 'CITIZEN',
      id: row?.id ?? null,
      // An absent record is evaluated at the default registry classification so
      // that a probe for a non-existent PCID is refused on the same terms.
      classification: (row?.classification ?? 'CONFIDENTIAL') as PolicyResource['classification'],
      subjectPcid: pcid,
      lgaCode: row?.lga_code ?? null,
      wardCode: row?.ward_code ?? null,
      linkedCaseIds: links.caseIds,
      linkedIncidentIds: links.incidentIds,
    };
  }

  /** Case and incident associations that open a record to an assigned officer (§22). */
  async loadLinks(pcid: string): Promise<{ caseIds: string[]; incidentIds: string[] }> {
    const [cases, incidents] = await Promise.all([
      this.db.query<{ case_id: string }>(
        `SELECT case_id FROM case_subject
          WHERE subject_type = 'CITIZEN' AND subject_id = $1 AND unlinked_at IS NULL`,
        [pcid],
      ),
      this.db.query<{ incident_id: string }>(
        'SELECT incident_id FROM incident_person WHERE citizen_pcid = $1',
        [pcid],
      ),
    ]);
    return {
      caseIds: cases.map((row) => row.case_id),
      incidentIds: incidents.map((row) => row.incident_id),
    };
  }

  private async loadExtras(
    pcid: string,
    citizenId: string | null,
  ): Promise<{
    emergencyContacts: EmergencyContactRow[];
    identityIntegrityFlags: { reference: string; title: string; status: string }[];
    lawEnforcementMarkers: LawEnforcementMarker[];
  }> {
    if (citizenId === null) {
      return { emergencyContacts: [], identityIntegrityFlags: [], lawEnforcementMarkers: [] };
    }
    const [contacts, flags, missing] = await Promise.all([
      this.db.query<EmergencyContactRow>(
        `SELECT id, full_name, relationship, phone_primary, phone_secondary, priority, verification_status
           FROM emergency_contact WHERE citizen_id = $1 ORDER BY priority, created_at`,
        [citizenId],
      ),
      this.db.query<{ reference: string; title: string; status: string }>(
        `SELECT reference, title, status FROM alert
          WHERE subject_pcid = $1 AND category = 'IDENTITY_INTEGRITY' AND status IN ('OPEN','UNDER_REVIEW')
          ORDER BY created_at DESC`,
        [pcid],
      ),
      this.db.query<{ case_reference: string; status: string }>(
        `SELECT case_reference, status FROM missing_person
          WHERE citizen_pcid = $1 AND status IN ('REPORTED','VERIFIED','ACTIVE')`,
        [pcid],
      ),
    ]);
    return {
      emergencyContacts: contacts,
      identityIntegrityFlags: flags,
      lawEnforcementMarkers: missing.map((row) => ({
        kind: 'ACTIVE_MISSING_PERSON_CASE',
        reference: row.case_reference,
        status: row.status,
      })),
    };
  }
}
