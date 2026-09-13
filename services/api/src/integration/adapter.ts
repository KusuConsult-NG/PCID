import type { AdapterMode, DataDomain, SourceProvenance } from '@pcid/contracts';

/** A record as the owning agency holds it, with the provenance §55 requires. */
export interface SourceRecord<T = Record<string, unknown>> {
  readonly data: T;
  readonly provenance: Omit<SourceProvenance, 'lastSyncedAt'>;
}

export interface AdapterHealth {
  readonly healthy: boolean;
  readonly checkedAt: string;
  readonly detail?: string;
}

export interface LookupQuery {
  /** Natural key in the source system, e.g. a vehicle registration number. */
  readonly key?: string;
  /** PCID whose linked records are wanted. */
  readonly subjectPcid?: string;
  readonly limit?: number;
}

/**
 * The contract every external government system is reached through
 * (master system prompt §54, §78).
 *
 * One interface, two kinds of implementation: a production adapter that talks to
 * the agency's real API under configuration, and a sandbox adapter backed by
 * fixtures for development and tests. No agency-specific behaviour leaks into the
 * core platform, and no system is hardcoded into it.
 *
 * Adapters are never on the read path of a citizen lookup. They populate the
 * platform's local projection through sync jobs, and a projection is what serves
 * requests - so an agency API being down slows synchronisation rather than taking
 * emergency response offline (§85).
 */
export interface IntegrationAdapter<T = Record<string, unknown>> {
  readonly key: string;
  readonly domain: DataDomain;
  readonly mode: AdapterMode;
  readonly sourceAgencyId: string;
  readonly sourceSystem: string;

  /** Fetch a bounded set of records for a targeted refresh. */
  lookup(query: LookupQuery): Promise<readonly SourceRecord<T>[]>;

  /** Records changed at the source since a watermark, for incremental sync. */
  changedSince(watermark: Date | null, limit: number): Promise<readonly SourceRecord<T>[]>;

  health(): Promise<AdapterHealth>;
}

export class IntegrationUnavailableError extends Error {
  constructor(
    readonly adapterKey: string,
    message: string,
    readonly sourceError?: unknown,
  ) {
    super(message);
    this.name = 'IntegrationUnavailableError';
  }
}
