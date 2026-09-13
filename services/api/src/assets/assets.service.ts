import { Injectable } from '@nestjs/common';
import type { Purpose } from '@pcid/contracts';
import type { PolicyResource } from '@pcid/policy';

import { AppError } from '../common/errors';
import type { RequestContext } from '../common/correlation';
import { project, withheld } from '../common/projection';
import { WhereBuilder } from '../common/sql';
import { Database } from '../database/pool';
import type { AuthenticatedActor } from '../iam/actor';
import { PolicyService } from '../policy/policy.service';
import type { AccessReferences, ProjectedRecord } from '../identity/citizens.service';

interface ProvenanceColumns {
  source_agency_id: string;
  source_system: string;
  source_record_id: string;
  source_updated_at: Date | null;
  last_synced_at: Date;
  verification_status: string;
}

export interface RecordWithProvenance extends ProjectedRecord {
  readonly provenance: {
    readonly sourceAgencyId: string;
    readonly sourceSystem: string;
    readonly sourceRecordId: string;
    readonly sourceUpdatedAt: string | null;
    readonly lastSyncedAt: string;
    readonly verificationStatus: string;
    /** True when the projection is older than the freshness the domain expects. */
    readonly stale: boolean;
  };
}

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Reads of records owned by other agencies (master system prompt §14, §15, §28, §55).
 *
 * Served from the platform's local projection, never by calling the agency's API
 * inline - so a transport-authority outage degrades freshness rather than
 * availability. Every response carries its provenance and says plainly when the
 * projection is stale, because an officer acting on a vehicle alert needs to know
 * how old it is.
 */
@Injectable()
export class AssetsService {
  constructor(
    private readonly db: Database,
    private readonly policy: PolicyService,
  ) {}

  async searchVehicles(
    actor: AuthenticatedActor,
    purpose: Purpose,
    registrationNumber: string,
    references: AccessReferences,
    context: RequestContext,
  ): Promise<RecordWithProvenance[]> {
    const outcome = await this.policy.authorize({
      actor,
      action: 'VEHICLE_SEARCH',
      purpose,
      resource: { type: 'VEHICLE', id: null, classification: 'CONFIDENTIAL', subjectPcid: null },
      caseRef: references.caseRef ?? null,
      incidentRef: references.incidentRef ?? null,
      breakGlassRef: references.breakGlassRef ?? null,
      context,
      auditDetail: { queryKind: 'registrationNumber' },
    });

    const rows = await this.db.query<VehicleRow>(
      `SELECT * FROM vehicle WHERE upper(registration_number) = upper($1) LIMIT 10`,
      [registrationNumber],
    );
    return rows.map((row) => this.toResponse(outcome.decision, vehicleFieldValues(row), row));
  }

  async viewVehicle(
    actor: AuthenticatedActor,
    purpose: Purpose,
    vehicleId: string,
    references: AccessReferences,
    context: RequestContext,
  ): Promise<RecordWithProvenance> {
    const row = await this.db.queryOne<VehicleRow>('SELECT * FROM vehicle WHERE id = $1', [
      vehicleId,
    ]);
    const resource = await this.assetResource('VEHICLE', vehicleId, row?.owner_pcid ?? null, row);
    const outcome = await this.policy.authorize({
      actor,
      action: 'VEHICLE_VIEW',
      purpose,
      resource,
      caseRef: references.caseRef ?? null,
      incidentRef: references.incidentRef ?? null,
      breakGlassRef: references.breakGlassRef ?? null,
      context,
    });
    if (row === null) throw AppError.notFoundOrNotPermitted(`no vehicle ${vehicleId}`);
    return this.toResponse(outcome.decision, vehicleFieldValues(row), row);
  }

  async searchProperties(
    actor: AuthenticatedActor,
    purpose: Purpose,
    criteria: { propertyId?: string; address?: string; lgaCode?: string },
    references: AccessReferences,
    context: RequestContext,
  ): Promise<RecordWithProvenance[]> {
    const outcome = await this.policy.authorize({
      actor,
      action: 'PROPERTY_SEARCH',
      purpose,
      resource: {
        type: 'PROPERTY',
        id: null,
        classification: 'CONFIDENTIAL',
        subjectPcid: null,
        lgaCode: criteria.lgaCode ?? null,
      },
      caseRef: references.caseRef ?? null,
      incidentRef: references.incidentRef ?? null,
      breakGlassRef: references.breakGlassRef ?? null,
      context,
    });

    const where = new WhereBuilder();
    if (criteria.propertyId !== undefined) where.add('property_id = ?', criteria.propertyId);
    if (criteria.address !== undefined) where.add('address ILIKE ?', `%${criteria.address}%`);
    if (criteria.lgaCode !== undefined) where.add('lga_code = ?', criteria.lgaCode);
    if (where.params.length === 0) {
      throw AppError.validation('Supply a property identifier, address or LGA.');
    }

    const rows = await this.db.query<PropertyRow>(
      `SELECT * FROM property ${where.sql} ORDER BY address LIMIT 25`,
      where.params,
    );
    return rows.map((row) => this.toResponse(outcome.decision, propertyFieldValues(row), row));
  }

  async viewProperty(
    actor: AuthenticatedActor,
    purpose: Purpose,
    propertyId: string,
    references: AccessReferences,
    context: RequestContext,
  ): Promise<RecordWithProvenance> {
    const row = await this.db.queryOne<PropertyRow>('SELECT * FROM property WHERE id = $1', [
      propertyId,
    ]);
    const resource = await this.assetResource('PROPERTY', propertyId, row?.owner_pcid ?? null, row);
    const outcome = await this.policy.authorize({
      actor,
      action: 'PROPERTY_VIEW',
      purpose,
      resource,
      caseRef: references.caseRef ?? null,
      incidentRef: references.incidentRef ?? null,
      breakGlassRef: references.breakGlassRef ?? null,
      context,
    });
    if (row === null) throw AppError.notFoundOrNotPermitted(`no property ${propertyId}`);
    return this.toResponse(outcome.decision, propertyFieldValues(row), row);
  }

  /** Records linked to one PCID, used by the Citizen 360 cards. */
  async vehiclesForCitizen(pcid: string): Promise<VehicleRow[]> {
    return this.db.query<VehicleRow>(
      'SELECT * FROM vehicle WHERE owner_pcid = $1 ORDER BY registration_number',
      [pcid],
    );
  }
  async propertiesForCitizen(pcid: string): Promise<PropertyRow[]> {
    return this.db.query<PropertyRow>(
      'SELECT * FROM property WHERE owner_pcid = $1 ORDER BY address',
      [pcid],
    );
  }
  async businessesForCitizen(pcid: string): Promise<BusinessRow[]> {
    return this.db.query<BusinessRow>(
      'SELECT * FROM business WHERE proprietor_pcid = $1 ORDER BY name',
      [pcid],
    );
  }
  async licencesForCitizen(pcid: string): Promise<LicenceRow[]> {
    return this.db.query<LicenceRow>(
      'SELECT * FROM licence WHERE holder_pcid = $1 ORDER BY valid_to DESC NULLS LAST',
      [pcid],
    );
  }
  async revenueForCitizen(pcid: string): Promise<RevenueRow[]> {
    return this.db.query<RevenueRow>('SELECT * FROM revenue_profile WHERE citizen_pcid = $1', [
      pcid,
    ]);
  }

  private async assetResource(
    type: PolicyResource['type'],
    id: string,
    ownerPcid: string | null,
    row:
      | (ProvenanceColumns & {
          classification: string;
          lga_code?: string | null;
          ward_code?: string | null;
        })
      | null,
  ): Promise<PolicyResource> {
    const links =
      ownerPcid === null
        ? { caseIds: [] as string[] }
        : await this.db
            .query<{ case_id: string }>(
              `SELECT case_id FROM case_subject
                WHERE subject_type = $1 AND subject_id = $2 AND unlinked_at IS NULL`,
              [type, id],
            )
            .then((rows) => ({ caseIds: rows.map((entry) => entry.case_id) }));
    return {
      type,
      id,
      classification: (row?.classification ?? 'CONFIDENTIAL') as PolicyResource['classification'],
      ownerAgencyId: row?.source_agency_id ?? null,
      subjectPcid: ownerPcid,
      lgaCode: row?.lga_code ?? null,
      wardCode: row?.ward_code ?? null,
      linkedCaseIds: links.caseIds,
      linkedIncidentIds: [],
    };
  }

  private toResponse(
    decision: Parameters<typeof project>[0],
    values: Record<string, unknown>,
    row: ProvenanceColumns,
  ): RecordWithProvenance {
    return {
      data: project(decision, values),
      restrictedFields: withheld(decision),
      provenance: {
        sourceAgencyId: row.source_agency_id,
        sourceSystem: row.source_system,
        sourceRecordId: row.source_record_id,
        sourceUpdatedAt: row.source_updated_at?.toISOString() ?? null,
        lastSyncedAt: row.last_synced_at.toISOString(),
        verificationStatus: row.verification_status,
        stale: Date.now() - row.last_synced_at.getTime() > STALE_AFTER_MS,
      },
    };
  }
}

export interface VehicleRow extends ProvenanceColumns {
  id: string;
  registration_number: string;
  make: string | null;
  model: string | null;
  colour: string | null;
  registration_status: string;
  alert_status: string | null;
  owner_pcid: string | null;
  owner_name: string | null;
  owner_contact: string | null;
  classification: string;
}

export interface PropertyRow extends ProvenanceColumns {
  id: string;
  property_id: string;
  address: string;
  lga_code: string | null;
  ward_code: string | null;
  use_type: string;
  emergency_access_notes: string | null;
  occupant_count_estimate: number | null;
  owner_pcid: string | null;
  owner_name: string | null;
  classification: string;
}

export interface BusinessRow extends ProvenanceColumns {
  id: string;
  business_id: string;
  name: string;
  status: string;
  address: string | null;
  proprietor_pcid: string | null;
  classification: string;
}

export interface LicenceRow extends ProvenanceColumns {
  id: string;
  licence_id: string;
  type: string;
  status: string;
  valid_from: Date | null;
  valid_to: Date | null;
  holder_pcid: string | null;
  classification: string;
}

export interface RevenueRow extends ProvenanceColumns {
  id: string;
  taxpayer_id: string;
  citizen_pcid: string | null;
  compliance_status: string;
  outstanding_balance_minor: string;
  classification: string;
}

export function vehicleFieldValues(row: VehicleRow): Record<string, unknown> {
  return {
    'vehicle.registrationNumber': row.registration_number,
    'vehicle.make': row.make,
    'vehicle.model': row.model,
    'vehicle.colour': row.colour,
    'vehicle.registrationStatus': row.registration_status,
    'vehicle.alertStatus': row.alert_status,
    'vehicle.ownerPcid': row.owner_pcid,
    'vehicle.ownerName': row.owner_name,
    'vehicle.ownerContact': row.owner_contact,
    'vehicle.sourceAgencyId': row.source_agency_id,
  };
}

export function propertyFieldValues(row: PropertyRow): Record<string, unknown> {
  return {
    'property.propertyId': row.property_id,
    'property.address': row.address,
    'property.lgaCode': row.lga_code,
    'property.wardCode': row.ward_code,
    'property.useType': row.use_type,
    'property.emergencyAccessNotes': row.emergency_access_notes,
    'property.occupantCountEstimate': row.occupant_count_estimate,
    'property.ownerPcid': row.owner_pcid,
    'property.ownerName': row.owner_name,
    'property.sourceAgencyId': row.source_agency_id,
  };
}

export function businessFieldValues(row: BusinessRow): Record<string, unknown> {
  return {
    'business.businessId': row.business_id,
    'business.name': row.name,
    'business.status': row.status,
    'business.address': row.address,
    'business.proprietorPcid': row.proprietor_pcid,
    'business.sourceAgencyId': row.source_agency_id,
  };
}

export function licenceFieldValues(row: LicenceRow): Record<string, unknown> {
  return {
    'licence.licenceId': row.licence_id,
    'licence.type': row.type,
    'licence.status': row.status,
    'licence.validFrom': row.valid_from?.toISOString().slice(0, 10) ?? null,
    'licence.validTo': row.valid_to?.toISOString().slice(0, 10) ?? null,
    'licence.holderPcid': row.holder_pcid,
    'licence.sourceAgencyId': row.source_agency_id,
  };
}

export function revenueFieldValues(row: RevenueRow): Record<string, unknown> {
  return {
    'revenue.taxpayerId': row.taxpayer_id,
    'revenue.complianceStatus': row.compliance_status,
    'revenue.outstandingBalanceMinor': Number(row.outstanding_balance_minor),
    'revenue.sourceAgencyId': row.source_agency_id,
  };
}
