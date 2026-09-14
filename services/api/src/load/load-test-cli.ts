/**
 * Run a load profile against a running API and report what it measured (§81).
 *
 *   npm run load:run -- --users 40 --duration 120 --profile surge
 *
 * Exits non-zero when the run breaches the service budget, so this can stand in a
 * pipeline as a gate rather than as a number somebody reads and forgets.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { runLoad } from './driver';
import { breaches, formatSummary } from './metrics';
import type { Budget } from './metrics';
import { PROFILES, profileByName } from './scenarios';
import type { LoadManifest } from './volume';

/**
 * The budget (§76).
 *
 * A counter lookup that takes longer than a second makes a queue; a control-room
 * board that takes longer makes a dispatcher reload the page, which doubles the
 * load exactly when it can least afford it. The p99 allowance is deliberately not
 * a multiple of the p95: the tail is where a platform fails, and a generous tail
 * budget is a way of not noticing.
 */
const BUDGET: Budget = { maxErrorRate: 0.01, maxP95Ms: 800, maxP99Ms: 2_000 };

function numeric(flag: string, fallback: number): number {
  const index = process.argv.indexOf(`--${flag}`);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isFinite(value) || value < 0) throw new Error(`--${flag} needs a number.`);
  return value;
}

function textual(flag: string, fallback: string): string {
  const index = process.argv.indexOf(`--${flag}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

async function main(): Promise<void> {
  if (process.argv.includes('--profiles')) {
    process.stdout.write(
      `${PROFILES.map((profile) => `  ${profile.name.padEnd(10)} ${profile.description}`).join('\n')}\n`,
    );
    return;
  }

  const manifestPath = resolve(textual('manifest', 'load-manifest.json'));
  let manifest: LoadManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as LoadManifest;
  } catch {
    throw new Error(
      `No load manifest at ${manifestPath}. Run: npm run db:load-seed -- --out ${manifestPath}`,
    );
  }

  const options = {
    baseUrl: textual('base-url', process.env.PCID_API_URL ?? 'http://127.0.0.1:3000'),
    profile: profileByName(textual('profile', 'counter')),
    virtualUsers: Math.max(1, Math.floor(numeric('users', 20))),
    durationSeconds: Math.max(1, numeric('duration', 60)),
    warmupSeconds: numeric('warmup', 10),
    rampSeconds: numeric('ramp', 5),
    thinkMs: numeric('think', 0),
    seed: Math.floor(numeric('seed', manifest.seed)),
    timeoutMs: numeric('timeout', 30_000),
  };

  process.stdout.write(
    [
      '',
      `Profile        ${options.profile.name} — ${options.profile.description}`,
      `Target         ${options.baseUrl}`,
      `Dataset        ${manifest.counts.citizens} citizens, ${manifest.counts.incidents} incidents, ` +
        `${manifest.counts.cases} cases, ${manifest.counts.auditEvents} audit events`,
      '',
    ].join('\n'),
  );

  const summary = await runLoad(manifest, options, (message) =>
    process.stdout.write(`  ${message}\n`),
  );
  process.stdout.write(`\n${formatSummary(summary)}\n`);

  const out = textual('out', '');
  if (out !== '') {
    writeFileSync(resolve(out), `${JSON.stringify(summary, null, 2)}\n`);
    process.stdout.write(`Written to ${resolve(out)}\n`);
  }

  const failed = breaches(summary, BUDGET);
  if (failed.length === 0) {
    process.stdout.write(
      `Within budget: error rate <= ${(BUDGET.maxErrorRate * 100).toFixed(1)}%, ` +
        `p95 <= ${BUDGET.maxP95Ms}ms, p99 <= ${BUDGET.maxP99Ms}ms.\n`,
    );
    return;
  }
  for (const breach of failed) {
    process.stderr.write(
      `Budget breached: ${breach.measure} was ${breach.observed}, allowed ${breach.allowed}.\n`,
    );
  }
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
});
