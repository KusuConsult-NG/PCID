import { setTimeout as delay } from 'node:timers/promises';

import type { AdapterMode, DataDomain } from '@pcid/contracts';
import type { ZodSchema } from 'zod';

import { logger } from '../../common/logger';
import { IntegrationUnavailableError } from '../adapter';
import type { AdapterHealth, IntegrationAdapter, LookupQuery, SourceRecord } from '../adapter';

export interface HttpSourceConfig {
  readonly key: string;
  readonly domain: DataDomain;
  readonly sourceAgencyId: string;
  readonly sourceSystem: string;
  readonly baseUrl: string;
  readonly lookupPath: string;
  readonly changedSincePath: string;
  readonly healthPath: string;
  /** Bearer credential, supplied by the deployment's secrets manager. */
  readonly credential: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly recordsPointer: string;
}

/**
 * The production adapter: one implementation, configured per agency.
 *
 * It is deliberately strict about what it accepts back. Every response is parsed
 * against the schema the integration declares, and a response that does not match
 * is treated as an outage rather than being written into the registry - a
 * misconfigured or compromised upstream must not be able to inject fields into
 * the platform's projection of a citizen's records.
 */
export class HttpSourceAdapter<T> implements IntegrationAdapter<T> {
  readonly mode: AdapterMode = 'PRODUCTION';

  constructor(
    private readonly config: HttpSourceConfig,
    private readonly recordSchema: ZodSchema<T>,
    private readonly mapProvenance: (record: T) => SourceRecord<T>['provenance'],
  ) {}

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
    const params = new URLSearchParams();
    if (query.key !== undefined) params.set('key', query.key);
    if (query.subjectPcid !== undefined) params.set('pcid', query.subjectPcid);
    params.set('limit', String(query.limit ?? 50));
    return this.request(`${this.config.lookupPath}?${params.toString()}`);
  }

  async changedSince(watermark: Date | null, limit: number): Promise<readonly SourceRecord<T>[]> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (watermark !== null) params.set('since', watermark.toISOString());
    return this.request(`${this.config.changedSincePath}?${params.toString()}`);
  }

  async health(): Promise<AdapterHealth> {
    try {
      const response = await this.fetchWithTimeout(
        new URL(this.config.healthPath, this.config.baseUrl).toString(),
      );
      return {
        healthy: response.ok,
        checkedAt: new Date().toISOString(),
        detail: response.ok ? undefined : `status ${response.status}`,
      };
    } catch (error) {
      return {
        healthy: false,
        checkedAt: new Date().toISOString(),
        detail: (error as Error).message,
      };
    }
  }

  private async request(path: string): Promise<readonly SourceRecord<T>[]> {
    const url = new URL(path, this.config.baseUrl).toString();
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      if (attempt > 0) await delay(2 ** attempt * 100);
      try {
        const response = await this.fetchWithTimeout(url);
        if (response.status >= 500) {
          lastError = new Error(`upstream returned ${response.status}`);
          continue;
        }
        if (!response.ok) {
          throw new IntegrationUnavailableError(
            this.config.key,
            `Source system rejected the request with status ${response.status}.`,
          );
        }
        const body: unknown = await response.json();
        const records = extractArray(body, this.config.recordsPointer);
        return records.map((record) => {
          const parsed = this.recordSchema.safeParse(record);
          if (!parsed.success) {
            throw new IntegrationUnavailableError(
              this.config.key,
              `Source system returned a record that does not match the agreed schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
            );
          }
          return { data: parsed.data, provenance: this.mapProvenance(parsed.data) };
        });
      } catch (error) {
        if (error instanceof IntegrationUnavailableError) throw error;
        lastError = error;
      }
    }
    logger.warn('integration_unavailable', {
      adapter: this.config.key,
      message: (lastError as Error | undefined)?.message,
    });
    throw new IntegrationUnavailableError(
      this.config.key,
      'The source system could not be reached.',
      lastError,
    );
  }

  private async fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      return await fetch(url, {
        headers: {
          authorization: `Bearer ${this.config.credential}`,
          accept: 'application/json',
          'user-agent': 'pcid-integration/1',
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

function extractArray(body: unknown, pointer: string): unknown[] {
  let current: unknown = body;
  for (const segment of pointer.split('.').filter((part) => part.length > 0)) {
    if (typeof current !== 'object' || current === null) return [];
    current = (current as Record<string, unknown>)[segment];
  }
  return Array.isArray(current) ? current : [];
}
