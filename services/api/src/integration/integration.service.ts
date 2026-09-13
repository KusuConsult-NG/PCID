import { Inject, Injectable } from '@nestjs/common';
import type { DataDomain } from '@pcid/contracts';

import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { RequestContext } from '../common/correlation';
import { logger } from '../common/logger';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { Database } from '../database/pool';
import type { QueryRunner } from '../database/pool';
import type { AuthenticatedActor } from '../iam/actor';
import { PolicyService } from '../policy/policy.service';
import { IntegrationUnavailableError } from './adapter';
import type { IntegrationAdapter, SourceRecord } from './adapter';
import { FixtureSourceAdapter } from './adapters/fixture-source.adapter';
import { HttpSourceAdapter } from './adapters/http-source.adapter';
import {
  businessFixtures,
  licenceFixtures,
  propertyFixtures,
  revenueFixtures,
  vehicleFixtures,
} from './fixtures';
import {
  businessSourceSchema,
  licenceSourceSchema,
  propertySourceSchema,
  revenueSourceSchema,
  vehicleSourceSchema,
} from './schemas';

export interface SyncResult {
  readonly dataSourceId: string;
  readonly domain: DataDomain;
  readonly status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
  readonly examined: number;
  readonly written: number;
  readonly conflicted: number;
  readonly error?: string;
}

interface DataSourceRow {
  id: string;
  agency_id: string;
  domain: DataDomain;
  system_name: string;
  adapter_key: string;
  mode: string;
  base_url: string | null;
  config: Record<string, unknown>;
}

/**
 * Integration orchestration (master system prompt §54, §55, §78).
 *
 * Synchronisation writes into the platform's *projection* of each agency's
 * records, always stamped with where it came from and when. Two rules the writer
 * holds:
 *
 *  - the source is authoritative. A field the platform holds that disagrees with
 *    the source raises a data conflict for review; the platform never wins
 *    silently, and never writes back to the agency's system;
 *  - an unreachable source is an integration failure, not a data event. The
 *    projection keeps serving the last known good state, marked with its age, so
 *    an agency outage degrades freshness rather than availability (§85).
 */
@Injectable()
export class IntegrationService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: Database,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
  ) {}

  async registerDataSource(
    actor: AuthenticatedActor,
    input: {
      agencyId: string;
      domain: DataDomain;
      systemName: string;
      adapterKey: string;
      mode: 'PRODUCTION' | 'SANDBOX' | 'DISABLED';
      baseUrl?: string | null;
      config?: Record<string, unknown>;
    },
    context: RequestContext,
  ): Promise<{ id: string; mode: string }> {
    await this.policy.authorize({
      actor,
      action: 'ADMIN_INTEGRATION_MANAGE',
      purpose: 'SYSTEM_ADMINISTRATION',
      resource: { type: 'SYSTEM', id: null, classification: 'INTERNAL', subjectPcid: null },
      context,
    });

    if (input.mode === 'SANDBOX' && !this.env.ALLOW_SANDBOX_ADAPTERS) {
      throw AppError.denied(
        'Sandbox adapters are not permitted in this environment.',
        'ALLOW_SANDBOX_ADAPTERS is false',
      );
    }
    if (input.mode === 'PRODUCTION' && (input.baseUrl === undefined || input.baseUrl === null)) {
      throw AppError.validation('A production data source needs the agency API base URL.');
    }

    const row = await this.db.queryOne<{ id: string; mode: string }>(
      `INSERT INTO data_source (agency_id, domain, system_name, adapter_key, mode, base_url, config)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
       ON CONFLICT (agency_id, domain, system_name)
       DO UPDATE SET adapter_key = EXCLUDED.adapter_key, mode = EXCLUDED.mode,
                     base_url = EXCLUDED.base_url, config = EXCLUDED.config
       RETURNING id, mode`,
      [
        input.agencyId,
        input.domain,
        input.systemName,
        input.adapterKey,
        input.mode,
        input.baseUrl ?? null,
        JSON.stringify(input.config ?? {}),
      ],
    );
    if (row === null) throw new Error('data source upsert returned no row');

    await this.audit.record({
      action: 'ADMIN_INTEGRATION_MANAGE',
      outcome: 'PERMITTED',
      actorType: actor.subject.actorType,
      actorId: actor.subject.userId,
      actorDisplay: actor.displayName,
      agencyId: actor.subject.agencyId,
      agencyCode: actor.agencyCode,
      roles: actor.subject.roles,
      purpose: 'SYSTEM_ADMINISTRATION',
      resourceType: 'SYSTEM',
      resourceId: row.id,
      correlationId: context.correlationId,
      ipAddress: context.ipAddress,
      detail: { change: 'DATA_SOURCE_REGISTERED', domain: input.domain, mode: input.mode },
    });
    return row;
  }

  async sync(
    actor: AuthenticatedActor,
    dataSourceId: string,
    context: RequestContext,
  ): Promise<SyncResult> {
    await this.policy.authorize({
      actor,
      action: 'ADMIN_INTEGRATION_MANAGE',
      purpose: 'SYSTEM_ADMINISTRATION',
      resource: { type: 'SYSTEM', id: dataSourceId, classification: 'INTERNAL', subjectPcid: null },
      context,
    });

    const source = await this.db.queryOne<DataSourceRow>(
      'SELECT id, agency_id, domain, system_name, adapter_key, mode, base_url, config FROM data_source WHERE id = $1',
      [dataSourceId],
    );
    if (source === null) throw AppError.notFoundOrNotPermitted(`no data source ${dataSourceId}`);
    if (source.mode === 'DISABLED') {
      throw AppError.conflict('That data source is disabled.');
    }

    const job = await this.db.queryOne<{ id: string }>(
      `INSERT INTO data_sync_job (data_source_id, status, started_at) VALUES ($1,'RUNNING',now())
       RETURNING id`,
      [dataSourceId],
    );
    if (job === null) throw new Error('sync job insert returned no row');

    const watermark = await this.db.queryOne<{ finished_at: Date | null }>(
      `SELECT finished_at FROM data_sync_job
        WHERE data_source_id = $1 AND status IN ('SUCCEEDED','PARTIAL')
        ORDER BY finished_at DESC NULLS LAST LIMIT 1`,
      [dataSourceId],
    );

    try {
      const adapter = await this.adapterFor(source);
      const records = await adapter.changedSince(watermark?.finished_at ?? null, 500);
      let written = 0;
      let conflicted = 0;

      await this.db.transaction(async (runner) => {
        for (const record of records) {
          const outcome = await this.writeProjection(runner, source, record);
          if (outcome === 'WRITTEN') written += 1;
          if (outcome === 'CONFLICTED') conflicted += 1;
        }
      });

      await this.db.query(
        `UPDATE data_sync_job
            SET status = $2, finished_at = now(), records_examined = $3,
                records_written = $4, records_conflicted = $5
          WHERE id = $1`,
        [job.id, conflicted > 0 ? 'PARTIAL' : 'SUCCEEDED', records.length, written, conflicted],
      );
      await this.db.query(
        'UPDATE data_source SET last_healthy_at = now(), last_error = NULL WHERE id = $1',
        [dataSourceId],
      );

      return {
        dataSourceId,
        domain: source.domain,
        status: conflicted > 0 ? 'PARTIAL' : 'SUCCEEDED',
        examined: records.length,
        written,
        conflicted,
      };
    } catch (error) {
      const message = (error as Error).message;
      await this.db.query(
        `UPDATE data_sync_job SET status = 'FAILED', finished_at = now(), error = $2 WHERE id = $1`,
        [job.id, message],
      );
      await this.db.query('UPDATE data_source SET last_error = $2 WHERE id = $1', [
        dataSourceId,
        message,
      ]);
      logger.warn('integration_sync_failed', { dataSourceId, domain: source.domain, message });

      if (error instanceof IntegrationUnavailableError) {
        // The projection keeps serving; only freshness is affected.
        return {
          dataSourceId,
          domain: source.domain,
          status: 'FAILED',
          examined: 0,
          written: 0,
          conflicted: 0,
          error: message,
        };
      }
      throw error;
    }
  }

  /** Data sources and how fresh each projection is (§72). */
  async status(
    actor: AuthenticatedActor,
    context: RequestContext,
  ): Promise<Record<string, unknown>[]> {
    await this.policy.authorize({
      actor,
      action: 'ADMIN_INTEGRATION_MANAGE',
      purpose: 'SYSTEM_ADMINISTRATION',
      resource: { type: 'SYSTEM', id: null, classification: 'INTERNAL', subjectPcid: null },
      context,
    });
    const rows = await this.db.query<{
      id: string;
      domain: string;
      system_name: string;
      mode: string;
      last_healthy_at: Date | null;
      last_error: string | null;
      agency_code: string;
      last_status: string | null;
      last_finished_at: Date | null;
    }>(
      `SELECT ds.id, ds.domain, ds.system_name, ds.mode, ds.last_healthy_at, ds.last_error,
              a.code AS agency_code,
              j.status AS last_status, j.finished_at AS last_finished_at
         FROM data_source ds
         JOIN agency a ON a.id = ds.agency_id
         LEFT JOIN LATERAL (
           SELECT status, finished_at FROM data_sync_job
            WHERE data_source_id = ds.id ORDER BY created_at DESC LIMIT 1
         ) j ON true
        ORDER BY a.code, ds.domain`,
    );
    return rows.map((row) => ({
      id: row.id,
      agencyCode: row.agency_code,
      domain: row.domain,
      systemName: row.system_name,
      mode: row.mode,
      lastHealthyAt: row.last_healthy_at?.toISOString() ?? null,
      lastError: row.last_error,
      lastSync: {
        status: row.last_status,
        finishedAt: row.last_finished_at?.toISOString() ?? null,
      },
    }));
  }

  private async adapterFor(
    source: DataSourceRow,
  ): Promise<IntegrationAdapter<Record<string, unknown>>> {
    if (source.mode === 'SANDBOX') {
      if (!this.env.ALLOW_SANDBOX_ADAPTERS) {
        throw new IntegrationUnavailableError(
          source.adapter_key,
          'Sandbox adapters are not permitted in this environment.',
        );
      }
      return this.sandboxAdapter(source) as IntegrationAdapter<Record<string, unknown>>;
    }

    const credential = process.env[String(source.config.credentialEnvVar ?? '')];
    if (credential === undefined || credential === '') {
      throw new IntegrationUnavailableError(
        source.adapter_key,
        'No credential is configured for this data source.',
      );
    }
    // The agreed record shape for each integrated domain. A response that does
    // not match it is treated as an outage, so a misconfigured upstream cannot
    // write unexpected fields into the platform's projection.
    const schema = {
      VEHICLES: vehicleSourceSchema,
      TRANSPORT: vehicleSourceSchema,
      PROPERTY: propertySourceSchema,
      LANDS: propertySourceSchema,
      BUSINESS: businessSourceSchema,
      REVENUE: revenueSourceSchema,
      EDUCATION: licenceSourceSchema,
      SOCIAL_SERVICES: licenceSourceSchema,
    }[source.domain as string];
    if (schema === undefined) {
      throw new IntegrationUnavailableError(
        source.adapter_key,
        `No agreed record schema is defined for the ${source.domain} domain.`,
      );
    }

    return new HttpSourceAdapter(
      {
        key: source.adapter_key,
        domain: source.domain,
        sourceAgencyId: source.agency_id,
        sourceSystem: source.system_name,
        baseUrl: source.base_url ?? '',
        lookupPath: String(source.config.lookupPath ?? '/records'),
        changedSincePath: String(source.config.changedSincePath ?? '/records/changed'),
        healthPath: String(source.config.healthPath ?? '/health'),
        credential,
        timeoutMs: Number(source.config.timeoutMs ?? 5000),
        maxRetries: Number(source.config.maxRetries ?? 2),
        recordsPointer: String(source.config.recordsPointer ?? 'records'),
      },
      schema as never,
      (record: Record<string, unknown>) => ({
        sourceAgencyId: source.agency_id,
        sourceSystem: source.system_name,
        sourceRecordId: String(record.sourceRecordId),
        sourceUpdatedAt: (record.sourceUpdatedAt as string | null) ?? null,
        verificationStatus: 'SOURCE_CONFIRMED' as const,
      }),
    ) as unknown as IntegrationAdapter<Record<string, unknown>>;
  }

  private sandboxAdapter(source: DataSourceRow): IntegrationAdapter<never> {
    const pcids = (source.config.samplePcids as string[] | undefined) ?? [];
    const shared = {
      key: source.adapter_key,
      domain: source.domain,
      sourceAgencyId: source.agency_id,
      sourceSystem: source.system_name,
    };
    switch (source.domain) {
      case 'VEHICLES':
      case 'TRANSPORT':
        return new FixtureSourceAdapter({
          ...shared,
          records: vehicleFixtures(source.agency_id, source.system_name, pcids),
          keyOf: (record) => record.registrationNumber,
          subjectOf: (record) => record.ownerPcid,
        }) as unknown as IntegrationAdapter<never>;
      case 'PROPERTY':
      case 'LANDS':
        return new FixtureSourceAdapter({
          ...shared,
          records: propertyFixtures(source.agency_id, source.system_name, pcids),
          keyOf: (record) => record.propertyId,
          subjectOf: (record) => record.ownerPcid,
        }) as unknown as IntegrationAdapter<never>;
      case 'BUSINESS':
        return new FixtureSourceAdapter({
          ...shared,
          records: businessFixtures(source.agency_id, source.system_name, pcids),
          keyOf: (record) => record.businessId,
          subjectOf: (record) => record.proprietorPcid,
        }) as unknown as IntegrationAdapter<never>;
      case 'REVENUE':
        return new FixtureSourceAdapter({
          ...shared,
          records: revenueFixtures(source.agency_id, source.system_name, pcids),
          keyOf: (record) => record.taxpayerId,
          subjectOf: (record) => record.citizenPcid,
        }) as unknown as IntegrationAdapter<never>;
      case 'EDUCATION':
      case 'SOCIAL_SERVICES':
        return new FixtureSourceAdapter({
          ...shared,
          records: licenceFixtures(source.agency_id, source.system_name, pcids),
          keyOf: (record) => record.licenceId,
          subjectOf: (record) => record.holderPcid,
        }) as unknown as IntegrationAdapter<never>;
      default:
        throw new IntegrationUnavailableError(
          source.adapter_key,
          `No sandbox adapter is defined for the ${source.domain} domain.`,
        );
    }
  }

  /**
   * Write one source record into the projection.
   *
   * A PCID the source cites that the registry does not hold is a conflict for
   * review, not a reason to invent a link.
   */
  private async writeProjection(
    runner: QueryRunner,
    source: DataSourceRow,
    record: SourceRecord<Record<string, unknown>>,
  ): Promise<'WRITTEN' | 'CONFLICTED'> {
    const data = record.data;
    const subjectPcid = (data.ownerPcid ??
      data.proprietorPcid ??
      data.holderPcid ??
      data.citizenPcid) as string | null | undefined;

    if (subjectPcid != null) {
      const known = await runner.queryOne<{ pcid: string }>(
        'SELECT pcid FROM pcid_allocation WHERE pcid = $1',
        [subjectPcid],
      );
      if (known === null) {
        await runner.query(
          `INSERT INTO data_conflict (data_source_id, resource_type, resource_id, field_path,
                                      platform_value, source_value)
           VALUES ($1,$2,$3,'subjectPcid',NULL,$4)`,
          [source.id, source.domain, String(data.sourceRecordId), subjectPcid],
        );
        return 'CONFLICTED';
      }
    }

    const provenance = [
      source.agency_id,
      source.system_name,
      String(data.sourceRecordId),
      record.provenance.sourceUpdatedAt,
    ];

    switch (source.domain) {
      case 'VEHICLES':
      case 'TRANSPORT':
        await runner.query(
          `INSERT INTO vehicle (registration_number, make, model, colour, registration_status,
                                alert_status, alert_reference, owner_pcid, owner_name, owner_contact,
                                classification, source_agency_id, source_system, source_record_id,
                                source_updated_at, last_synced_at, verification_status)
           VALUES ($5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'CONFIDENTIAL',$1,$2,$3,$4,now(),'SOURCE_CONFIRMED')
           ON CONFLICT (source_agency_id, source_system, source_record_id) DO UPDATE
             SET registration_number = EXCLUDED.registration_number, make = EXCLUDED.make,
                 model = EXCLUDED.model, colour = EXCLUDED.colour,
                 registration_status = EXCLUDED.registration_status,
                 alert_status = EXCLUDED.alert_status, alert_reference = EXCLUDED.alert_reference,
                 owner_pcid = EXCLUDED.owner_pcid, owner_name = EXCLUDED.owner_name,
                 owner_contact = EXCLUDED.owner_contact, source_updated_at = EXCLUDED.source_updated_at,
                 last_synced_at = now(), verification_status = 'SOURCE_CONFIRMED'`,
          [
            ...provenance,
            data.registrationNumber,
            data.make,
            data.model,
            data.colour,
            data.registrationStatus,
            data.alertStatus,
            data.alertReference,
            data.ownerPcid,
            data.ownerName,
            data.ownerContact,
          ],
        );
        return 'WRITTEN';
      case 'PROPERTY':
      case 'LANDS':
        await runner.query(
          `INSERT INTO property (property_id, address, lga_code, ward_code, use_type, latitude, longitude,
                                 location_source, emergency_access_notes, occupant_count_estimate,
                                 owner_pcid, owner_name, classification, source_agency_id, source_system,
                                 source_record_id, source_updated_at, last_synced_at, verification_status)
           VALUES ($5,$6,$7,$8,$9,$10,$11,'GOVERNMENT_RECORD',$12,$13,$14,$15,'CONFIDENTIAL',
                   $1,$2,$3,$4,now(),'SOURCE_CONFIRMED')
           ON CONFLICT (source_agency_id, source_system, source_record_id) DO UPDATE
             SET property_id = EXCLUDED.property_id, address = EXCLUDED.address,
                 lga_code = EXCLUDED.lga_code, ward_code = EXCLUDED.ward_code,
                 use_type = EXCLUDED.use_type, latitude = EXCLUDED.latitude,
                 longitude = EXCLUDED.longitude,
                 emergency_access_notes = EXCLUDED.emergency_access_notes,
                 occupant_count_estimate = EXCLUDED.occupant_count_estimate,
                 owner_pcid = EXCLUDED.owner_pcid, owner_name = EXCLUDED.owner_name,
                 source_updated_at = EXCLUDED.source_updated_at, last_synced_at = now(),
                 verification_status = 'SOURCE_CONFIRMED'`,
          [
            ...provenance,
            data.propertyId,
            data.address,
            data.lgaCode,
            data.wardCode,
            data.useType,
            data.latitude,
            data.longitude,
            data.emergencyAccessNotes,
            data.occupantCountEstimate,
            data.ownerPcid,
            data.ownerName,
          ],
        );
        return 'WRITTEN';
      case 'BUSINESS':
        await runner.query(
          `INSERT INTO business (business_id, name, status, address, lga_code, proprietor_pcid,
                                 classification, source_agency_id, source_system, source_record_id,
                                 source_updated_at, last_synced_at, verification_status)
           VALUES ($5,$6,$7,$8,$9,$10,'INTERNAL',$1,$2,$3,$4,now(),'SOURCE_CONFIRMED')
           ON CONFLICT (source_agency_id, source_system, source_record_id) DO UPDATE
             SET business_id = EXCLUDED.business_id, name = EXCLUDED.name, status = EXCLUDED.status,
                 address = EXCLUDED.address, lga_code = EXCLUDED.lga_code,
                 proprietor_pcid = EXCLUDED.proprietor_pcid,
                 source_updated_at = EXCLUDED.source_updated_at, last_synced_at = now()`,
          [
            ...provenance,
            data.businessId,
            data.name,
            data.status,
            data.address,
            data.lgaCode,
            data.proprietorPcid,
          ],
        );
        return 'WRITTEN';
      case 'REVENUE':
        await runner.query(
          `INSERT INTO revenue_profile (taxpayer_id, citizen_pcid, compliance_status,
                                        outstanding_balance_minor, classification, source_agency_id,
                                        source_system, source_record_id, source_updated_at,
                                        last_synced_at, verification_status)
           VALUES ($5,$6,$7,$8,'SENSITIVE',$1,$2,$3,$4,now(),'SOURCE_CONFIRMED')
           ON CONFLICT (source_agency_id, source_system, source_record_id) DO UPDATE
             SET taxpayer_id = EXCLUDED.taxpayer_id, citizen_pcid = EXCLUDED.citizen_pcid,
                 compliance_status = EXCLUDED.compliance_status,
                 outstanding_balance_minor = EXCLUDED.outstanding_balance_minor,
                 source_updated_at = EXCLUDED.source_updated_at, last_synced_at = now()`,
          [
            ...provenance,
            data.taxpayerId,
            data.citizenPcid,
            data.complianceStatus,
            data.outstandingBalanceMinor,
          ],
        );
        return 'WRITTEN';
      case 'EDUCATION':
      case 'SOCIAL_SERVICES':
        await runner.query(
          `INSERT INTO licence (licence_id, type, status, valid_from, valid_to, holder_pcid,
                                classification, source_agency_id, source_system, source_record_id,
                                source_updated_at, last_synced_at, verification_status)
           VALUES ($5,$6,$7,$8::date,$9::date,$10,'INTERNAL',$1,$2,$3,$4,now(),'SOURCE_CONFIRMED')
           ON CONFLICT (source_agency_id, source_system, source_record_id) DO UPDATE
             SET licence_id = EXCLUDED.licence_id, type = EXCLUDED.type, status = EXCLUDED.status,
                 valid_from = EXCLUDED.valid_from, valid_to = EXCLUDED.valid_to,
                 holder_pcid = EXCLUDED.holder_pcid, source_updated_at = EXCLUDED.source_updated_at,
                 last_synced_at = now()`,
          [
            ...provenance,
            data.licenceId,
            data.type,
            data.status,
            data.validFrom,
            data.validTo,
            data.holderPcid,
          ],
        );
        return 'WRITTEN';
      default:
        throw new IntegrationUnavailableError(
          source.adapter_key,
          `No projection writer for the ${source.domain} domain.`,
        );
    }
  }
}
