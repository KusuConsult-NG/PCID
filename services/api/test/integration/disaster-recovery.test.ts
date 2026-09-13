import { strict as assert } from 'node:assert';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { after, before, describe, test } from 'node:test';

import { Client } from 'pg';

import { ApiClient, bootstrapAdmin, createAgency, createUser, signIn } from './harness';
import type { TestContext } from './harness';
import { createTestContext } from './harness';

const run = promisify(execFile);

/**
 * Master system prompt §70 - DISASTER RECOVERY, and §85's "backups can be restored".
 *
 * A backup nobody has restored is a hope, not a control. This takes a real dump
 * of a populated database, restores it into a fresh one, and checks that the
 * registry, the audit trail and - critically - the tamper-evident hash chain all
 * survive the round trip intact.
 */
describe('§70 backup and restore', () => {
  let context: TestContext;
  let workDir: string;
  let pcid: string;
  let auditCount: number;

  before(async () => {
    context = await createTestContext('dr');
    workDir = await mkdtemp(join(tmpdir(), 'pcid-dr-'));

    const bootstrap = await bootstrapAdmin(context);
    const session = await signIn(
      context,
      bootstrap.email,
      bootstrap.password,
      bootstrap.totpSecret,
    );
    const registry = await createAgency(context, session.accessToken, {
      code: 'PLT-REGISTRY',
      name: 'Plateau State Citizen Registry',
      category: 'MDA',
      maxClassification: 'HIGHLY_RESTRICTED',
    });
    const registrar = await createUser(context, session.accessToken, {
      email: 'registrar@pcid.plateaustate.gov.ng',
      fullName: 'Registration Officer',
      agencyId: registry.id,
      roles: ['REGISTRATION_OFFICER'],
      clearance: 'HIGHLY_RESTRICTED',
    });
    const registrarClient = new ApiClient(
      context,
      (await signIn(context, registrar.email, registrar.password, registrar.totpSecret))
        .accessToken,
    );

    const created = await registrarClient
      .post('/api/v1/citizens', {
        givenName: 'Amina',
        familyName: 'Dung',
        sex: 'FEMALE',
        dateOfBirth: '1994-06-12',
        phonePrimary: '08030000001',
        lgaCode: 'PL-JNO',
        wardCode: 'PL-JNO-01',
        channel: 'REGISTRATION_DESK',
      })
      .expect(201);
    pcid = (created.body as { pcid: string }).pcid;

    // Generate some audited activity to restore.
    for (let i = 0; i < 5; i += 1) {
      await registrarClient.get(`/api/v1/citizens/${pcid}?purpose=SERVICE_DELIVERY`).expect(200);
    }

    const { Database } = await import('../../src/database/pool');
    const db = context.app.get(Database);
    const row = await db.queryOne<{ count: string }>(
      'SELECT count(*)::text AS count FROM audit_event',
    );
    auditCount = Number(row?.count ?? 0);
    assert.ok(auditCount > 5);
  });

  after(async () => {
    await context?.close();
    if (workDir !== undefined) await rm(workDir, { recursive: true, force: true });
  });

  test('a dump restores into a fresh database with the registry and audit trail intact', async () => {
    const dumpFile = join(workDir, 'pcid.dump');
    const restoredName = `pcid_restore_${randomBytes(4).toString('hex')}`;
    const adminUrl =
      process.env.TEST_ADMIN_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/postgres';

    // Custom format, which is what point-in-time restore tooling consumes.
    await run('pg_dump', [
      '--format=custom',
      '--no-owner',
      '--file',
      dumpFile,
      context.databaseUrl,
    ]);

    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${restoredName}`);
    await admin.end();

    const restoredUrl = adminUrl.replace(/\/[^/]+$/, `/${restoredName}`);
    try {
      await run('pg_restore', ['--no-owner', '--dbname', restoredUrl, dumpFile]);

      const restored = new Client({ connectionString: restoredUrl });
      await restored.connect();
      try {
        const citizen = await restored.query<{ pcid: string; display_name: string }>(
          'SELECT pcid, display_name FROM citizen WHERE pcid = $1',
          [pcid],
        );
        assert.equal(citizen.rows.length, 1, 'the citizen record survived the restore');
        assert.equal(citizen.rows[0]?.display_name, 'Amina Dung');

        const allocation = await restored.query(
          'SELECT pcid FROM pcid_allocation WHERE pcid = $1',
          [pcid],
        );
        assert.equal(
          allocation.rows.length,
          1,
          'the PCID allocation survived, so it can never be reissued',
        );

        const events = await restored.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM audit_event',
        );
        assert.equal(
          Number(events.rows[0]?.count ?? 0),
          auditCount,
          'every audit event survived the round trip',
        );

        // The whole point: the chain still verifies after a restore, so a
        // restored system can still prove its history was not altered.
        const problems = await restored.query('SELECT seq, id, problem FROM verify_audit_chain()');
        assert.deepEqual(problems.rows, [], 'the audit hash chain must verify after a restore');

        // And the append-only protections were restored with the schema, not lost.
        await assert.rejects(
          restored.query("UPDATE audit_event SET action = 'TAMPERED' WHERE seq = 1"),
          /append-only/,
          'the audit immutability trigger must exist in the restored database',
        );
        await assert.rejects(
          restored.query('DELETE FROM pcid_allocation WHERE pcid = $1', [pcid]),
          /permanent/,
        );

        // Migration bookkeeping came back, so the restored database is a known version.
        const migrations = await restored.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM schema_migration',
        );
        assert.ok(Number(migrations.rows[0]?.count ?? 0) >= 9);
      } finally {
        await restored.end();
      }
    } finally {
      const cleanup = new Client({ connectionString: adminUrl });
      await cleanup.connect();
      await cleanup.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1',
        [restoredName],
      );
      await cleanup.query(`DROP DATABASE IF EXISTS ${restoredName}`);
      await cleanup.end();
    }
  });

  test('a tampered restore is detected by the chain rather than passing silently', async () => {
    // Prove the verification is not vacuous: a row altered in a way that bypasses
    // the trigger (as a restore with triggers disabled could) is still caught.
    const adminUrl =
      process.env.TEST_ADMIN_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/postgres';
    const tamperedName = `pcid_tamper_${randomBytes(4).toString('hex')}`;
    const dumpFile = join(workDir, 'pcid-tamper.dump');

    await run('pg_dump', [
      '--format=custom',
      '--no-owner',
      '--file',
      dumpFile,
      context.databaseUrl,
    ]);
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${tamperedName}`);
    await admin.end();

    const tamperedUrl = adminUrl.replace(/\/[^/]+$/, `/${tamperedName}`);
    try {
      await run('pg_restore', ['--no-owner', '--dbname', tamperedUrl, dumpFile]);
      const client = new Client({ connectionString: tamperedUrl });
      await client.connect();
      try {
        const before = await client.query('SELECT seq, id, problem FROM verify_audit_chain()');
        assert.deepEqual(before.rows, [], 'the chain starts intact');

        // Someone with enough privilege drops the guard and edits history.
        await client.query('ALTER TABLE audit_event DISABLE TRIGGER audit_event_no_update');
        await client.query(
          "UPDATE audit_event SET purpose = 'STATISTICAL_ANALYSIS' WHERE seq = (SELECT min(seq) FROM audit_event)",
        );

        const after = await client.query<{ seq: string; problem: string }>(
          'SELECT seq, id, problem FROM verify_audit_chain()',
        );
        assert.ok(after.rows.length > 0, 'the alteration must be detected');
        assert.match(after.rows[0]?.problem ?? '', /does not match/);
      } finally {
        await client.end();
      }
    } finally {
      const cleanup = new Client({ connectionString: adminUrl });
      await cleanup.connect();
      await cleanup.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1',
        [tamperedName],
      );
      await cleanup.query(`DROP DATABASE IF EXISTS ${tamperedName}`);
      await cleanup.end();
    }
  });
});
