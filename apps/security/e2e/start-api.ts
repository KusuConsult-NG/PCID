/**
 * Start the API for the end-to-end suite, against a database created fresh for
 * this run.
 *
 * The portal suite tests the whole stack, so it uses the real service and the
 * real migrations rather than a mock. Recreating the database each time is what
 * makes the run repeatable: the suite provisions its own resident and then
 * asserts on exactly what it provisioned.
 *
 * Playwright starts this as a `webServer` and stops it when the run ends.
 */
import { spawn, spawnSync } from 'node:child_process';

import { Client } from 'pg';

import {
  ADMIN_DATABASE_URL,
  API_DIRECTORY,
  API_PORT,
  DATABASE_NAME,
  DATABASE_URL,
  SECRET_ENCRYPTION_KEY,
  TOKEN_SIGNING_KEY,
  TYPESCRIPT_COMPILER,
} from './environment';

async function main(): Promise<void> {
  if (!/^[a-z_][a-z0-9_]*$/.test(DATABASE_NAME)) {
    throw new Error(`Refusing to use ${DATABASE_NAME} as a database name.`);
  }

  const admin = new Client({ connectionString: ADMIN_DATABASE_URL });
  await admin.connect();
  await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1', [
    DATABASE_NAME,
  ]);
  await admin.query(`DROP DATABASE IF EXISTS ${DATABASE_NAME}`);
  await admin.query(`CREATE DATABASE ${DATABASE_NAME}`);
  await admin.end();

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(API_PORT),
    LOG_LEVEL: 'error',
    DATABASE_URL,
    DATABASE_SSL: 'disable',
    TOKEN_SIGNING_KEY,
    SECRET_ENCRYPTION_KEY,
    ALLOW_SANDBOX_ADAPTERS: 'true',
    // A journey makes far more requests in a minute than a person does, so the
    // general per-account ceiling is raised for the suite. It is exercised
    // deliberately in `test/integration/rate-limit.test.ts`, at a level low
    // enough to reach in a test rather than incidentally here.
    RATE_LIMIT_DEFAULT_MAX: '10000',
    PLATFORM_BASE_URL: `http://127.0.0.1:${API_PORT}`,
    VERIFICATION_BASE_URL: `http://127.0.0.1:${API_PORT}/verify`,
  };

  // Compiled, not transpiled on the fly: esbuild does not emit
  // `design:paramtypes`, so a `tsx`-run Nest application comes up with nothing
  // injected into its guards. The suite runs the artefact that gets deployed.
  const built = spawnSync(process.execPath, [TYPESCRIPT_COMPILER, '-b'], {
    cwd: API_DIRECTORY,
    env: childEnv,
    stdio: 'inherit',
  });
  if (built.status !== 0) process.exit(built.status ?? 1);

  const migrated = spawnSync(process.execPath, ['dist/database/migrate-cli.js'], {
    cwd: API_DIRECTORY,
    env: childEnv,
    stdio: 'inherit',
  });
  if (migrated.status !== 0) process.exit(migrated.status ?? 1);

  const api = spawn(process.execPath, ['dist/main.js'], {
    cwd: API_DIRECTORY,
    env: childEnv,
    stdio: 'inherit',
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      api.kill(signal);
      process.exit(0);
    });
  }
  api.on('exit', (code) => process.exit(code ?? 0));
}

void main();
