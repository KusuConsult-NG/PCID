import { randomBytes } from 'node:crypto';

import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Client } from 'pg';
import request from 'supertest';
import type { Response } from 'supertest';

const ADMIN_DATABASE_URL =
  process.env.TEST_ADMIN_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/postgres';

export interface TestContext {
  readonly app: INestApplication;
  readonly databaseName: string;
  readonly databaseUrl: string;
  close(): Promise<void>;
}

/**
 * Boot the real application against a throwaway database.
 *
 * The tests exercise the HTTP surface with the real policy engine, the real
 * audit chain and the real migrations. Nothing is stubbed: an authorisation test
 * that passes here passes against the deployed service for the same reason.
 */
export async function createTestContext(label: string): Promise<TestContext> {
  const databaseName = `pcid_test_${label}_${randomBytes(4).toString('hex')}`;
  const admin = new Client({ connectionString: ADMIN_DATABASE_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${databaseName}`);
  await admin.end();

  const databaseUrl = ADMIN_DATABASE_URL.replace(/\/[^/]+$/, `/${databaseName}`);

  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = databaseUrl;
  process.env.DATABASE_SSL = 'disable';
  process.env.TOKEN_SIGNING_KEY = randomBytes(32).toString('base64url');
  process.env.SECRET_ENCRYPTION_KEY = randomBytes(32).toString('base64url');
  process.env.LOG_LEVEL = 'error';
  process.env.ALLOW_SANDBOX_ADAPTERS = 'true';
  delete process.env.REDIS_URL;
  // Keep the search ceiling low enough that the abuse test is fast, but well
  // above what the other tests perform.
  process.env.RATE_LIMIT_SEARCH_MAX = '8';
  process.env.RATE_LIMIT_WINDOW_SECONDS = '60';

  const { migrate } = await import('../../src/database/migrator');
  const { findMigrationsDirectory } = await import('../../src/database/paths');
  await migrate(databaseUrl, findMigrationsDirectory(__dirname));

  const { AppModule } = await import('../../src/app.module');
  const { configureApp } = await import('../../src/configure-app');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  // The same hardening the deployed service applies, so the suite exercises the
  // real headers, body limits and proxy handling.
  configureApp(app);
  await app.init();

  const { Database } = await import('../../src/database/pool');
  const { seedReferenceData } = await import('../../src/database/seed');
  const db = app.get(Database);
  await db.transaction(async (runner) => {
    await seedReferenceData(runner);
  });

  return {
    app,
    databaseName,
    databaseUrl,
    async close(): Promise<void> {
      await app.close();
      const cleanup = new Client({ connectionString: ADMIN_DATABASE_URL });
      await cleanup.connect();
      await cleanup.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1',
        [databaseName],
      );
      await cleanup.query(`DROP DATABASE IF EXISTS ${databaseName}`);
      await cleanup.end();
    },
  };
}

export interface Session {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly sessionId: string;
  readonly userId: string;
  readonly roles: readonly string[];
}

export class ApiClient {
  constructor(
    private readonly context: TestContext,
    private token: string | null = null,
  ) {}

  withToken(token: string | null): ApiClient {
    return new ApiClient(this.context, token);
  }

  get currentToken(): string | null {
    return this.token;
  }

  setToken(token: string): void {
    this.token = token;
  }

  private apply(builder: request.Test): request.Test {
    return this.token === null ? builder : builder.set('authorization', `Bearer ${this.token}`);
  }

  get(path: string): request.Test {
    return this.apply(request(this.context.app.getHttpServer()).get(path));
  }
  post(path: string, body?: unknown): request.Test {
    const builder = request(this.context.app.getHttpServer()).post(path);
    return this.apply(body === undefined ? builder : builder.send(body as object));
  }
  patch(path: string, body?: unknown): request.Test {
    const builder = request(this.context.app.getHttpServer()).patch(path);
    return this.apply(body === undefined ? builder : builder.send(body as object));
  }
  delete(path: string): request.Test {
    return this.apply(request(this.context.app.getHttpServer()).delete(path));
  }
}

/** Sign in and step up to AAL2 using the account's own TOTP secret. */
export async function signIn(
  context: TestContext,
  email: string,
  password: string,
  totpSecret: string,
): Promise<Session> {
  const client = new ApiClient(context);
  const login: Response = await client.post('/api/v1/auth/login', { email, password }).expect(201);
  const body = login.body as {
    accessToken: string;
    refreshToken: string;
    actor: { id: string; roles: string[] };
  };
  const sessionId = decodeSessionId(body.accessToken);

  const mfa: Response = await client
    .post('/api/v1/auth/mfa/verify', { sessionId, code: await totpCode(totpSecret) })
    .expect(201);
  const mfaBody = mfa.body as { accessToken: string };

  return {
    accessToken: mfaBody.accessToken,
    refreshToken: body.refreshToken,
    sessionId,
    userId: body.actor.id,
    roles: body.actor.roles,
  };
}

/**
 * Counters already presented for a given secret, so the harness never replays a
 * code. The platform refuses a time step at or below the last one used - correct
 * behaviour that tests would otherwise trip over by running inside one 30-second
 * window. A code for the next step is still inside the server's acceptance
 * window, so this costs no wall-clock time; only a burst of more than two
 * sign-ins per secret has to wait for the boundary.
 */
const usedCounters = new Map<string, number>();

export async function totpCode(secret: string): Promise<string> {
  const { TotpService } = await import('../../src/security/totp.service');
  const totp = new TotpService();
  const step = TotpService.STEP_SECONDS;
  let counter = Math.floor(Date.now() / 1000 / step);
  const lastUsed = usedCounters.get(secret);

  if (lastUsed !== undefined && counter <= lastUsed) {
    if (lastUsed + 1 - counter <= TotpService.WINDOW) {
      counter = lastUsed + 1;
    } else {
      const waitMs = (lastUsed + 1) * step * 1000 - Date.now() + 1000;
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, waitMs)));
      counter = Math.floor(Date.now() / 1000 / step);
    }
  }
  usedCounters.set(secret, counter);
  return totp.generate(secret, counter * step);
}

export function decodeSessionId(accessToken: string): string {
  const payload = accessToken.split('.')[1] as string;
  return (JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sid: string }).sid;
}

/**
 * Create the first administrator. Mirrors what `npm run db:bootstrap` does in a
 * real deployment, so the tests start from the same place an operator does.
 */
export async function bootstrapAdmin(
  context: TestContext,
  password = 'Bootstrap-Passphrase-2026!',
): Promise<{
  email: string;
  password: string;
  totpSecret: string;
  agencyId: string;
  userId: string;
}> {
  const { Database } = await import('../../src/database/pool');
  const { bootstrapPlatformAdministrator } = await import('../../src/database/bootstrap');
  const { loadEnv } = await import('../../src/config/env');
  const db = context.app.get(Database);
  const env = loadEnv();
  const email = 'platform.admin@pcid.plateaustate.gov.ng';
  const result = await db.transaction((runner) =>
    bootstrapPlatformAdministrator(runner, env, {
      agencyCode: 'PLT-PLATFORM',
      agencyName: 'Plateau State PCID Platform Office',
      email,
      fullName: 'Platform Administrator',
      password,
    }),
  );
  if (result.totpSecret === null)
    throw new Error('bootstrap did not return an authenticator secret');
  return {
    email,
    password,
    totpSecret: result.totpSecret,
    agencyId: result.agencyId,
    userId: result.userId,
  };
}

export interface CreatedUser {
  readonly id: string;
  readonly email: string;
  readonly password: string;
  readonly totpSecret: string;
}

/**
 * Create a government user through the administration API and confirm their
 * authenticator, which is what makes the account usable.
 */
export async function createUser(
  context: TestContext,
  adminToken: string,
  input: {
    email: string;
    fullName: string;
    agencyId: string;
    roles: readonly string[];
    clearance?: string;
    jurisdictionScope?: 'STATE' | 'LGA' | 'WARD';
    jurisdictionLgaCodes?: readonly string[];
    jurisdictionWardCodes?: readonly string[];
  },
): Promise<CreatedUser> {
  // Random rather than templated: the password policy rejects anything containing
  // a word from the account's own name or email, which a template like
  // "Officer-..." for an account called "Revenue Officer" would trip.
  const password = `Zq7${randomBytes(12).toString('base64url')}Xm4`;
  const admin = new ApiClient(context, adminToken);
  const created: Response = await admin
    .post('/api/v1/users', {
      email: input.email,
      fullName: input.fullName,
      agencyId: input.agencyId,
      roles: [...input.roles],
      clearance: input.clearance ?? 'INTERNAL',
      jurisdictionScope: input.jurisdictionScope ?? 'STATE',
      jurisdictionLgaCodes: [...(input.jurisdictionLgaCodes ?? [])],
      jurisdictionWardCodes: [...(input.jurisdictionWardCodes ?? [])],
      temporaryPassword: password,
    })
    .expect(201);
  const body = created.body as { id: string; email: string; totpSecret: string };
  await confirmAuthenticator(context, body.id);
  return { id: body.id, email: body.email, password, totpSecret: body.totpSecret };
}

/**
 * Mark a freshly created account's authenticator confirmed.
 *
 * Test infrastructure only: it does directly what POST /users/me/mfa/confirm
 * does, so that building a cast of officers does not consume a time step for
 * every one of them. The real endpoint is exercised on its own in
 * authorization.test.ts.
 */
export async function confirmAuthenticator(context: TestContext, userId: string): Promise<void> {
  const { Database } = await import('../../src/database/pool');
  const db = context.app.get(Database);
  await db.transaction(async (runner) => {
    await runner.query(
      `UPDATE mfa_credential SET confirmed_at = now()
        WHERE user_id = $1 AND kind = 'TOTP' AND confirmed_at IS NULL`,
      [userId],
    );
    await runner.query('UPDATE government_user SET mfa_enrolled = true WHERE id = $1', [userId]);
  });
}

/** Register an agency and bring it into service with a signed agreement. */
export async function createAgency(
  context: TestContext,
  adminToken: string,
  input: {
    code: string;
    name: string;
    category: string;
    maxClassification?: string;
    lawEnforcementCompartment?: boolean;
    jurisdictionScope?: 'STATE' | 'LGA' | 'WARD';
    jurisdictionLgaCodes?: readonly string[];
  },
): Promise<{ id: string; code: string }> {
  const admin = new ApiClient(context, adminToken);
  const created: Response = await admin
    .post('/api/v1/agencies', {
      code: input.code,
      name: input.name,
      category: input.category,
      jurisdictionScope: input.jurisdictionScope ?? 'STATE',
      jurisdictionLgaCodes: [...(input.jurisdictionLgaCodes ?? [])],
      jurisdictionWardCodes: [],
      maxClassification: input.maxClassification ?? 'CONFIDENTIAL',
    })
    .expect(201);
  const agency = created.body as { id: string; code: string; status: string };

  await admin
    .patch(`/api/v1/agencies/${agency.id}/status`, {
      status: 'ACTIVE',
      dataSharingAgreement: 'SIGNED',
      apiIntegrationStatus: 'LIVE',
    })
    .expect(200);

  if (input.lawEnforcementCompartment === true) {
    await admin
      .post(`/api/v1/agencies/${agency.id}/compartments/law-enforcement`, {
        legalBasis:
          'Approved under the state data-sharing framework for authorised law-enforcement processing.',
      })
      .expect(201);
  }
  return { id: agency.id, code: agency.code };
}
