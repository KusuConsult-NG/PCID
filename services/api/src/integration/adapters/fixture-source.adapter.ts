import type { AdapterMode, DataDomain } from '@pcid/contracts';

import type { AdapterHealth, IntegrationAdapter, LookupQuery, SourceRecord } from '../adapter';

export interface FixtureSourceConfig<T> {
  readonly key: string;
  readonly domain: DataDomain;
  readonly sourceAgencyId: string;
  readonly sourceSystem: string;
  readonly records: readonly SourceRecord<T>[];
  /** How a lookup key is derived from a fixture record. */
  readonly keyOf: (record: T) => string | null;
  /** How the PCID a record belongs to is derived. */
  readonly subjectOf: (record: T) => string | null;
}

/**
 * The development sandbox adapter (master system prompt §77, §78).
 *
 * Backed by declared fixtures and marked SANDBOX in every provenance record it
 * produces, so sandbox-sourced data is visibly distinguishable in the database
 * from real agency data. It refuses to construct when NODE_ENV is production:
 * fixture data must not be reachable from a production process at all, rather
 * than merely being switched off by configuration.
 */
export class FixtureSourceAdapter<T> implements IntegrationAdapter<T> {
  readonly mode: AdapterMode = 'SANDBOX';

  constructor(
    private readonly config: FixtureSourceConfig<T>,
    environment: string = process.env.NODE_ENV ?? 'development',
  ) {
    if (environment === 'production') {
      throw new Error(
        `Sandbox adapter ${config.key} cannot be constructed in production. ` +
          'Configure a production adapter for this data source.',
      );
    }
  }

  get key(): string {
    return this.config.key;
  }
  get domain(): DataDomain {
    return this.config.domain;
  }
  get sourceAgencyId(): string {
    return this.config.sourceAgencyId;
  }
  get sourceSystem(): string {
    return this.config.sourceSystem;
  }

  async lookup(query: LookupQuery): Promise<readonly SourceRecord<T>[]> {
    const limit = query.limit ?? 50;
    return this.config.records
      .filter((record) => {
        if (query.key !== undefined) {
          return this.config.keyOf(record.data)?.toUpperCase() === query.key.toUpperCase();
        }
        if (query.subjectPcid !== undefined) {
          return this.config.subjectOf(record.data) === query.subjectPcid;
        }
        return true;
      })
      .slice(0, limit);
  }

  async changedSince(watermark: Date | null, limit: number): Promise<readonly SourceRecord<T>[]> {
    return this.config.records
      .filter((record) => {
        if (watermark === null) return true;
        const updatedAt = record.provenance.sourceUpdatedAt;
        return updatedAt === null || Date.parse(updatedAt) > watermark.getTime();
      })
      .slice(0, limit);
  }

  async health(): Promise<AdapterHealth> {
    return { healthy: true, checkedAt: new Date().toISOString(), detail: 'sandbox fixtures' };
  }
}
