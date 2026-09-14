/**
 * Measure the two things a request-level load run cannot (§81):
 *
 *   npm run load:probe -- --chain 2000 --concurrency 16
 *
 *  - the rate the audit hash chain sustains, which is the platform's ceiling on
 *    audited operations and does not improve by adding API instances;
 *  - the access path every hot query takes at the seeded volume, because a plan
 *    that reaches its rows through an index still does at four million and a
 *    sequential scan does not.
 *
 * Writes rows to the audit trail, on purpose: they are ordinary chained records
 * carrying `probe: audit-chain`, and they are exactly what the measurement is of.
 * It refuses to run in production for that reason.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadEnv } from '../config/env';
import { Database } from '../database/pool';
import { explainAll, formatBytes, hotQueries, measureAuditChain, tableSizes } from './probes';

/** How many links at the end of the chain the probe verifies after writing. */
const VERIFY_TAIL = 50_000;

function numeric(flag: string, fallback: number): number {
  const index = process.argv.indexOf(`--${flag}`);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${flag} needs a positive number.`);
  return Math.floor(value);
}

async function main(): Promise<void> {
  const env = loadEnv();
  if (env.NODE_ENV === 'production') {
    throw new Error('The load probe writes audit rows and must never run in production.');
  }
  const db = new Database(env);

  try {
    const sample = await db.queryOne<{
      pcid: string;
      display_name: string;
      given_name: string;
      family_name: string;
      date_of_birth: Date;
      phone_primary: string | null;
      lga_code: string | null;
    }>(
      `SELECT pcid, display_name, given_name, family_name, date_of_birth, phone_primary, lga_code
         FROM citizen TABLESAMPLE SYSTEM (0.01) LIMIT 1`,
    );
    if (sample === null) {
      throw new Error('The registry is empty. Run npm run db:load-seed first.');
    }
    const officer = await db.queryOne<{ id: string }>(
      `SELECT ca.user_id AS id FROM case_assignment ca LIMIT 1`,
    );

    process.stdout.write('\nTable sizes\n');
    const sizes = await tableSizes(db);
    for (const size of sizes) {
      process.stdout.write(
        `  ${size.table.padEnd(30)} ${String(size.rows).padStart(12)} rows  ` +
          `${formatBytes(size.totalBytes).padStart(10)} total  ` +
          `${formatBytes(size.indexBytes).padStart(10)} indexes\n`,
      );
    }

    process.stdout.write('\nQuery plans at this volume\n');
    const plans = await explainAll(
      db,
      hotQueries({
        pcid: sample.pcid,
        displayName: sample.display_name,
        givenName: sample.given_name,
        familyName: sample.family_name,
        dateOfBirth: sample.date_of_birth.toISOString().slice(0, 10),
        phone: sample.phone_primary,
        lgaCode: sample.lga_code ?? 'PL-JNO',
        userId: officer?.id ?? null,
      }),
    );
    for (const plan of plans) {
      // Both, not one or the other: a hash join whose build side is an index
      // scan and whose probe side is a sequential scan is an ordinary plan, and
      // reporting only the scan would read as an alarm it is not.
      const path = [
        plan.indexes.length > 0 ? `index ${plan.indexes.join(', ')}` : '',
        plan.sequentialScans.length > 0 ? `SEQ SCAN ${plan.sequentialScans.join(', ')}` : '',
      ]
        .filter((part) => part !== '')
        .join(' + ');
      process.stdout.write(
        `  ${plan.name.padEnd(38)} ${`${plan.executionMs}ms`.padStart(10)}  ` +
          `${String(plan.rows).padStart(8)} rows  ${path === '' ? plan.topNode : path}\n`,
      );
    }

    const chainInserts = numeric('chain', 1_000);
    const concurrency = numeric('concurrency', 16);
    process.stdout.write(
      `\nAudit chain, ${chainInserts} chained inserts across ${concurrency} connections\n`,
    );
    const serial = await measureAuditChain(db, 1, Math.max(100, Math.floor(chainInserts / 4)));
    const concurrent = await measureAuditChain(db, concurrency, chainInserts);
    for (const [label, measurement] of [
      ['one connection', serial],
      [`${concurrency} connections`, concurrent],
    ] as const) {
      process.stdout.write(
        `  ${label.padEnd(20)} ${measurement.insertsPerSecond.toFixed(1).padStart(9)} inserts/s   ` +
          `p50 ${measurement.p50Ms}ms  p95 ${measurement.p95Ms}ms  p99 ${measurement.p99Ms}ms  ` +
          `max ${measurement.maxMs}ms\n`,
      );
    }
    process.stdout.write(
      '  The chain is a single serialisation point for the whole platform: the concurrent\n' +
        '  figure is the ceiling on audited operations per second, however many API\n' +
        '  instances are running.\n',
    );

    // Verify the tail rather than the whole chain.
    //
    // `verify_audit_chain()` with no arguments walks every link, and at three
    // million records that exceeds the statement timeout - which is a finding
    // about the operational procedure, not about the chain: verification at
    // scale is a ranged job, and `docs/operations` says so. What matters here is
    // that the links this probe just forged are sound.
    const head = await db.queryOne<{ next_seq: string }>(
      'SELECT next_seq::text FROM audit_chain_head',
    );
    const to = Number(head?.next_seq ?? 1) - 1;
    const from = Math.max(1, to - VERIFY_TAIL);
    const verification = Date.now();
    const broken = await db.query<{ seq: string }>('SELECT * FROM verify_audit_chain($1, $2)', [
      from,
      to,
    ]);
    process.stdout.write(
      `\nChain verification over links ${from}-${to}: ` +
        `${broken.length === 0 ? 'intact' : `${broken.length} broken links`}` +
        ` (${((Date.now() - verification) / 1000).toFixed(1)}s)\n\n`,
    );

    const outIndex = process.argv.indexOf('--out');
    if (outIndex !== -1 && process.argv[outIndex + 1] !== undefined) {
      const out = resolve(process.argv[outIndex + 1] as string);
      writeFileSync(
        out,
        `${JSON.stringify({ sizes, plans, chain: { serial, concurrent } }, null, 2)}\n`,
      );
      process.stdout.write(`Written to ${out}\n`);
    }
    if (broken.length > 0) process.exitCode = 1;
  } finally {
    await db.onModuleDestroy();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
});
