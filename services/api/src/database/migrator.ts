import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { Client } from 'pg';

export interface MigrationFile {
  readonly version: string;
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

export interface MigrationResult {
  readonly applied: readonly string[];
  readonly alreadyApplied: readonly string[];
}

const FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export function readMigrations(directory: string): readonly MigrationFile[] {
  const files = readdirSync(directory)
    .filter((file) => FILE_PATTERN.test(file))
    .sort();
  return files.map((file) => {
    const match = FILE_PATTERN.exec(file);
    if (!match) throw new Error(`Unreachable: ${file}`);
    const sql = readFileSync(join(directory, file), 'utf8');
    return {
      version: match[1] as string,
      name: match[2] as string,
      sql,
      checksum: createHash('sha256').update(sql, 'utf8').digest('hex'),
    };
  });
}

/**
 * Version-controlled schema migration (master system prompt §79).
 *
 * Each file is applied exactly once, inside its own transaction, and its checksum
 * is recorded. Editing a file that has already been applied is refused: the fix
 * for a shipped migration is a new migration, never an edit, because an edited
 * migration silently diverges between environments.
 */
export async function migrate(
  connectionString: string,
  directory: string,
  log: (message: string) => void = () => undefined,
): Promise<MigrationResult> {
  const migrations = readMigrations(directory);
  const client = new Client({ connectionString, application_name: 'pcid-migrator' });
  await client.connect();
  const applied: string[] = [];
  const alreadyApplied: string[] = [];
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migration (
        version     text PRIMARY KEY,
        name        text NOT NULL,
        checksum    text NOT NULL,
        applied_at  timestamptz NOT NULL DEFAULT now(),
        duration_ms integer NOT NULL
      )
    `);
    // Serialise concurrent migrators: a second instance waits rather than racing.
    await client.query('SELECT pg_advisory_lock(hashtext($1))', ['pcid_schema_migration']);

    const existing = await client.query<{ version: string; name: string; checksum: string }>(
      'SELECT version, name, checksum FROM schema_migration',
    );
    const byVersion = new Map(existing.rows.map((row) => [row.version, row]));

    for (const migration of migrations) {
      const previous = byVersion.get(migration.version);
      if (previous) {
        if (previous.checksum !== migration.checksum) {
          throw new Error(
            `Migration ${migration.version}_${migration.name} has changed since it was applied ` +
              `(recorded ${previous.checksum.slice(0, 12)}, found ${migration.checksum.slice(0, 12)}). ` +
              'Applied migrations are immutable: add a new migration instead.',
          );
        }
        alreadyApplied.push(`${migration.version}_${migration.name}`);
        continue;
      }
      const startedAt = Date.now();
      try {
        await client.query('BEGIN');
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO schema_migration (version, name, checksum, duration_ms) VALUES ($1, $2, $3, $4)',
          [migration.version, migration.name, migration.checksum, Date.now() - startedAt],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new Error(
          `Migration ${migration.version}_${migration.name} failed: ${(error as Error).message}`,
          { cause: error },
        );
      }
      applied.push(`${migration.version}_${migration.name}`);
      log(`applied ${migration.version}_${migration.name} in ${Date.now() - startedAt}ms`);
    }
    return { applied, alreadyApplied };
  } finally {
    await client
      .query('SELECT pg_advisory_unlock(hashtext($1))', ['pcid_schema_migration'])
      .catch(() => undefined);
    await client.end();
  }
}
