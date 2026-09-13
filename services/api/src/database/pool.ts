import { readFileSync } from 'node:fs';

import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import type { PoolClient, QueryResultRow } from 'pg';

import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

export interface QueryRunner {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<T[]>;
  queryOne<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<T | null>;
}

function sslConfig(env: Env): false | { rejectUnauthorized: boolean; ca?: string } {
  if (env.DATABASE_SSL === 'disable') return false;
  if (env.DATABASE_SSL === 'require') return { rejectUnauthorized: false };
  const ca = env.DATABASE_CA_CERT ? readFileSync(env.DATABASE_CA_CERT, 'utf8') : undefined;
  return ca === undefined ? { rejectUnauthorized: true } : { rejectUnauthorized: true, ca };
}

/**
 * The only path to the database.
 *
 * Nothing outside the API service ever receives a database credential (§44).
 * Every statement is parameterised - the helpers take a template and an argument
 * array, and no call site concatenates a value into SQL.
 */
@Injectable()
export class Database implements QueryRunner, OnModuleDestroy {
  private readonly pool: Pool;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: env.DATABASE_POOL_MAX,
      statement_timeout: env.DATABASE_STATEMENT_TIMEOUT_MS,
      idle_in_transaction_session_timeout: env.DATABASE_STATEMENT_TIMEOUT_MS * 2,
      application_name: 'pcid-api',
      ssl: sslConfig(env),
    });
    // A pool-level error must not take the process down; the pool replaces the
    // connection and the next request succeeds.
    this.pool.on('error', (error) => {
      console.error(
        JSON.stringify({ level: 'error', event: 'pg_pool_error', message: error.message }),
      );
    });
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<T[]> {
    const result = await this.pool.query<T>(text, values as unknown[]);
    return result.rows;
  }

  async queryOne<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<T | null> {
    const rows = await this.query<T>(text, values);
    return rows[0] ?? null;
  }

  /**
   * Run a unit of work in a single transaction. The callback receives a runner
   * bound to the transaction's connection; anything it throws rolls the whole
   * unit back, which is how a registration that fails duplicate review leaves no
   * partial citizen record behind.
   */
  async transaction<T>(work: (runner: QueryRunner) => Promise<T>): Promise<T> {
    const client: PoolClient = await this.pool.connect();
    const runner: QueryRunner = {
      query: async <R extends QueryResultRow = QueryResultRow>(
        text: string,
        values: readonly unknown[] = [],
      ): Promise<R[]> => (await client.query<R>(text, values as unknown[])).rows,
      queryOne: async <R extends QueryResultRow = QueryResultRow>(
        text: string,
        values: readonly unknown[] = [],
      ): Promise<R | null> => (await client.query<R>(text, values as unknown[])).rows[0] ?? null,
    };
    try {
      await client.query('BEGIN');
      const result = await work(runner);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async healthy(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
