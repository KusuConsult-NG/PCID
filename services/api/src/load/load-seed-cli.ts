/**
 * Generate the volume a load run measures against, and the accounts that drive
 * it (§81).
 *
 *   npm run db:load-seed -- --citizens 250000 --incidents 40000 --cases 5000
 *
 * Writes a manifest holding the accounts it created and a sample of the
 * identifiers it wrote, which `npm run load:run` reads. The manifest contains
 * working credentials for synthetic accounts on a synthetic database: it is
 * excluded from version control and the file is written owner-readable only.
 *
 * `--remove` undoes it: every row this tool writes is marked, so the undo is
 * exact. PCID allocations are the exception and stay for ever, which is the
 * point of them.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { loadEnv } from '../config/env';
import { Database } from '../database/pool';
import { generateVolume, removeVolume } from './volume';

const DEFAULTS = {
  citizens: 100_000,
  incidents: 20_000,
  cases: 4_000,
  units: 200,
  audit: 100_000,
  accounts: 15,
  seed: 20260914,
  out: 'load-manifest.json',
};

function numeric(flag: string, fallback: number): number {
  const index = process.argv.indexOf(`--${flag}`);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`--${flag} needs a non-negative number.`);
  }
  return Math.floor(value);
}

function textual(flag: string, fallback: string): string {
  const index = process.argv.indexOf(`--${flag}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

async function main(): Promise<void> {
  const env = loadEnv();
  if (env.NODE_ENV === 'production') {
    throw new Error('Load volume must never be generated in production.');
  }
  const db = new Database(env);

  try {
    if (process.argv.includes('--remove')) {
      let lastRemoveReport = 0;
      const removed = await removeVolume(db, env, (stage, done) => {
        if (Date.now() - lastRemoveReport < 2_000) return;
        lastRemoveReport = Date.now();
        process.stdout.write(`  ${stage.padEnd(26)} ${String(done).padStart(9)} removed\n`);
      });
      const lines = Object.entries(removed).map(
        ([table, count]) => `  ${table.padEnd(26)} ${count}`,
      );
      process.stdout.write(`Removed the load dataset.\n${lines.join('\n')}\n`);
      return;
    }

    const options = {
      citizens: numeric('citizens', DEFAULTS.citizens),
      incidents: numeric('incidents', DEFAULTS.incidents),
      cases: numeric('cases', DEFAULTS.cases),
      auditEvents: numeric('audit', DEFAULTS.audit),
      units: numeric('units', DEFAULTS.units),
      accountsPerPersona: numeric('accounts', DEFAULTS.accounts),
      seed: numeric('seed', DEFAULTS.seed),
      force: process.argv.includes('--force'),
    };
    const out = resolve(textual('out', DEFAULTS.out));

    const started = Date.now();
    let lastReport = 0;
    const manifest = await generateVolume(db, env, options, (stage, done, total, elapsedMs) => {
      const finished = done === total;
      if (!finished && Date.now() - lastReport < 2_000) return;
      lastReport = Date.now();
      const rate = elapsedMs === 0 ? 0 : Math.round((done / elapsedMs) * 1000);
      process.stdout.write(
        `  ${stage.padEnd(10)} ${String(done).padStart(9)} / ${total}  ${rate}/s\n`,
      );
    });

    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    process.stdout.write(
      [
        '',
        `Load dataset ready in ${seconds}s (seed ${options.seed}).`,
        `  citizens      ${manifest.counts.citizens}`,
        `  incidents     ${manifest.counts.incidents}`,
        `  cases         ${manifest.counts.cases}`,
        `  audit events  ${manifest.counts.auditEvents}`,
        `  accounts      ${manifest.accounts.length}`,
        `  manifest      ${out}`,
        '',
        'Every row is marked LOAD_TEST and `--remove` takes it all out again.',
        '',
      ].join('\n'),
    );
  } finally {
    await db.onModuleDestroy();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
});
