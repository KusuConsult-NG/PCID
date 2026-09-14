import { strict as assert } from 'node:assert';
import { after, before, describe, test } from 'node:test';

import { Client } from 'pg';

import { ApiClient, bootstrapAdmin, createAgency, createUser, signIn } from './harness';
import type { TestContext } from './harness';
import { createTestContext } from './harness';

/**
 * A small batch, set before the application boots.
 *
 * Node's test runner gives each file its own process, so this is local to this
 * suite. Five is small enough that the cap can be reached with a handful of
 * rows, which is what makes "there is more, and the next sweep takes it"
 * testable rather than asserted about a number nobody can reach.
 */
process.env.RETENTION_BATCH_SIZE = '5';

/**
 * Retention and erasure (master system prompt §21, §68).
 *
 * The schedules were written down and never applied. `docs/privacy.md` printed
 * the periods, the columns carried defaults, `location_retention_until` was
 * stamped on every incident - and nothing read any of it. A retention schedule
 * that nothing applies is not a weak control; it is a claim, made in writing to
 * a regulator, that the platform does something it does not do.
 *
 * What this file holds is the sweep's two halves. It must erase what is past its
 * period: that is the control. And it must erase *nothing else*: a sweep that
 * over-reaches destroys a citizen's record, a case file, or the accountability
 * trail that would show what happened - which is a worse failure than the one it
 * was written to fix. Both halves are asserted against real rows.
 */
describe('§21 retention and erasure', () => {
  let context: TestContext;
  let db: Client;
  let adminToken: string;
  let dpo: ApiClient;
  let registrar: ApiClient;

  let incidentId: string;
  let freshIncidentId: string;
  let agedNotificationId: string;
  let freshNotificationId: string;
  let dpoPassword: string;

  const AGED = "now() - interval '400 days'";
  const FRESH = 'now()';

  before(async () => {
    context = await createTestContext('retention');
    const bootstrap = await bootstrapAdmin(context);
    adminToken = (await signIn(context, bootstrap.email, bootstrap.password, bootstrap.totpSecret))
      .accessToken;

    const oversight = await createAgency(context, adminToken, {
      code: 'PLT-DPO',
      name: 'Office of the Data Protection Officer',
      category: 'MDA',
      maxClassification: 'SENSITIVE',
    });
    const registry = await createAgency(context, adminToken, {
      code: 'PLT-REGISTRY',
      name: 'Citizen Registry',
      category: 'MDA',
      maxClassification: 'SENSITIVE',
    });

    const dpoUser = await createUser(context, adminToken, {
      email: 'dpo@retention.test',
      fullName: 'Data Protection Officer',
      agencyId: oversight.id,
      roles: ['DATA_PROTECTION_OFFICER'],
      clearance: 'SENSITIVE',
    });
    const registrarUser = await createUser(context, adminToken, {
      email: 'desk@retention.test',
      fullName: 'Registration Desk',
      agencyId: registry.id,
      roles: ['REGISTRATION_OFFICER'],
      clearance: 'SENSITIVE',
    });

    dpoPassword = dpoUser.password;
    dpo = new ApiClient(
      context,
      (await signIn(context, dpoUser.email, dpoUser.password, dpoUser.totpSecret)).accessToken,
    );
    registrar = new ApiClient(
      context,
      (await signIn(context, registrarUser.email, registrarUser.password, registrarUser.totpSecret))
        .accessToken,
    );

    db = new Client({ connectionString: context.databaseUrl });
    await db.connect();
    await seedRowsPastTheirPeriod();
  });

  after(async () => {
    await db.end();
    await context.close();
  });

  /**
   * Rows on both sides of every cutoff.
   *
   * Written straight to the database and back-dated, because the alternative is
   * a test that waits ninety days. Each policy gets something aged past its
   * period and something inside it, so every assertion below is really two: the
   * old one went, the new one stayed.
   */
  async function seedRowsPastTheirPeriod(): Promise<void> {
    // Two incidents. The aged one is past its stamped retention date; the fresh
    // one was created moments ago and has ninety days to run.
    const aged = await db.query<{ id: string }>(
      `INSERT INTO incident (incident_number, type, severity, status, description, address_text,
                             latitude, longitude, location_source, location_retention_until,
                             reporter_type, reported_at)
       VALUES ('INC-2025-000001', 'ROAD_ACCIDENT', 'HIGH', 'CLOSED',
               'Collision on the Jos-Bukuru road', '14 Ahmadu Bello Way, Jos',
               9.896527, 8.858331, 'INCIDENT_REPORT', ${AGED}, 'ANONYMOUS', ${AGED})
       RETURNING id`,
    );
    incidentId = aged.rows[0]!.id;

    const fresh = await db.query<{ id: string }>(
      `INSERT INTO incident (incident_number, type, severity, status, description, address_text,
                             latitude, longitude, location_source, location_retention_until,
                             reporter_type, reported_at)
       VALUES ('INC-2026-000002', 'FIRE', 'MEDIUM', 'RESOLVED', 'Kitchen fire, Rayfield',
               '2 Rayfield Road, Jos', 9.850000, 8.880000, 'INCIDENT_REPORT',
               now() + interval '90 days', 'ANONYMOUS', ${FRESH})
       RETURNING id`,
    );
    freshIncidentId = fresh.rows[0]!.id;

    const agedNotice = await db.query<{ id: string }>(
      `INSERT INTO notification (channel, recipient_type, recipient_id, recipient_address, subject,
                                 body, status, created_at, queued_at, delivered_at)
       VALUES ('SMS', 'CITIZEN', 'PL-TEST-00001-AA', '+2348030000001', 'Your record was accessed',
               'Plateau State Internal Revenue Service viewed your record on 3 March.',
               'DELIVERED', ${AGED}, ${AGED}, ${AGED})
       RETURNING id`,
    );
    agedNotificationId = agedNotice.rows[0]!.id;

    const freshNotice = await db.query<{ id: string }>(
      `INSERT INTO notification (channel, recipient_type, recipient_id, recipient_address, subject,
                                 body, status, created_at, queued_at, delivered_at)
       VALUES ('SMS', 'CITIZEN', 'PL-TEST-00002-BB', '+2348030000002', 'Your record was accessed',
               'Plateau State Ministry of Health viewed your record today.',
               'DELIVERED', ${FRESH}, ${FRESH}, ${FRESH})
       RETURNING id`,
    );
    freshNotificationId = freshNotice.rows[0]!.id;

    // Seven aged sign-in attempts against a batch of five: enough to prove the
    // cap is real and that a second sweep finishes the job.
    for (let index = 0; index < 7; index += 1) {
      await db.query(
        `INSERT INTO login_attempt (identifier, actor_type, succeeded, ip_address, attempted_at)
         VALUES ($1, 'GOVERNMENT_USER', false, '203.0.113.7', ${AGED})`,
        [`old-${index}@retention.test`],
      );
    }
    await db.query(
      `INSERT INTO login_attempt (identifier, actor_type, succeeded, ip_address, attempted_at)
       VALUES ('recent@retention.test', 'GOVERNMENT_USER', true, '203.0.113.8', ${FRESH})`,
    );

    await db.query(
      `INSERT INTO notification_delivery_attempt (notification_id, attempt, channel, outcome, attempted_at)
       VALUES ($1, 1, 'SMS', 'SENT', ${AGED})`,
      [agedNotificationId],
    );
    await db.query(
      `INSERT INTO notification_delivery_attempt (notification_id, attempt, channel, outcome, attempted_at)
       VALUES ($1, 1, 'SMS', 'SENT', ${FRESH})`,
      [freshNotificationId],
    );
  }

  const countOf = async (sql: string, params: unknown[] = []): Promise<number> => {
    const result = await db.query<{ count: string }>(sql, params);
    return Number(result.rows[0]?.count ?? 0);
  };

  test('the schedule says what is kept, for how long, and why', async () => {
    const response = await dpo.get('/api/v1/retention/schedule').expect(200);
    const body = response.body as {
      policies: {
        key: string;
        holds: string;
        disposition: string;
        retainDays: number | null;
        basis: string;
        due?: number;
      }[];
    };

    assert.ok(body.policies.length >= 10);
    for (const policy of body.policies) {
      assert.ok(policy.basis.length > 0, `${policy.key} must state why its period is that period`);
      assert.ok(policy.holds.length > 0);
      if (policy.disposition === 'KEEP') {
        assert.equal(policy.retainDays, null);
        // A policy that keeps has no backlog, and reporting one would be
        // nonsense: nothing is ever overdue.
        assert.equal(policy.due, undefined, `${policy.key} is kept and cannot be overdue`);
      } else {
        assert.ok((policy.retainDays ?? 0) > 0);
        assert.equal(typeof policy.due, 'number', `${policy.key} must report its backlog`);
      }
    }

    // The three that must never be swept, named rather than inferred.
    const kept = body.policies.filter((policy) => policy.disposition === 'KEEP').map((p) => p.key);
    for (const key of ['CITIZEN_IDENTITY_LONG_TERM', 'AUDIT_LONG_TERM', 'SECURITY_CASE_LEGAL']) {
      assert.ok(kept.includes(key), `${key} must be in the schedule as kept`);
    }
  });

  test('the backlog is visible before anything is erased', async () => {
    const response = await dpo.get('/api/v1/retention/schedule').expect(200);
    const body = response.body as { policies: { key: string; due?: number }[] };
    const due = new Map(body.policies.map((policy) => [policy.key, policy.due]));

    assert.equal(due.get('INCIDENT_STANDARD'), 1, 'one incident is past its retention date');
    assert.equal(due.get('NOTIFICATION_CONTENT'), 1);
    assert.equal(due.get('SIGN_IN_ATTEMPT_OPERATIONAL'), 7);
    assert.equal(due.get('NOTIFICATION_ATTEMPT_OPERATIONAL'), 1);
  });

  test('a dry run counts what would go and erases nothing', async () => {
    const before = await countOf('SELECT count(*)::text AS count FROM login_attempt');

    const response = await dpo.post('/api/v1/retention/runs', { dryRun: true }).expect(201);
    const body = response.body as {
      dryRun: boolean;
      rowsAffected: number;
      erasures: { policy: string; rowsAffected: number }[];
    };

    assert.equal(body.dryRun, true);
    assert.ok(body.rowsAffected > 0, 'a dry run still reports what it would have done');
    assert.equal(
      await countOf('SELECT count(*)::text AS count FROM login_attempt'),
      before,
      'a dry run must not erase a single row',
    );
    assert.equal(
      await countOf(
        'SELECT count(*)::text AS count FROM incident WHERE location_erased_at IS NOT NULL',
      ),
      0,
    );
  });

  test('the sweep erases what is past its period, and leaves what is not', async () => {
    await dpo.post('/api/v1/retention/runs', { dryRun: false }).expect(201);

    // The incident survives its location. Destroying the record of an emergency
    // because ninety days passed would be losing a public-safety record, not
    // honouring a retention schedule.
    const incidents = await db.query<{
      id: string;
      latitude: string | null;
      longitude: string | null;
      address_text: string | null;
      description: string;
      location_erased_at: Date | null;
      location_source: string;
    }>(
      `SELECT id, latitude, longitude, address_text, description, location_erased_at, location_source
         FROM incident ORDER BY reported_at`,
    );
    const agedIncident = incidents.rows.find((row) => row.id === incidentId);
    const keptIncident = incidents.rows.find((row) => row.id === freshIncidentId);

    assert.ok(agedIncident !== undefined && keptIncident !== undefined);
    assert.equal(agedIncident.latitude, null);
    assert.equal(agedIncident.longitude, null);
    assert.equal(agedIncident.address_text, null);
    assert.ok(agedIncident.location_erased_at !== null, 'the erasure leaves a dated mark');
    assert.equal(
      agedIncident.description,
      'Collision on the Jos-Bukuru road',
      'the incident itself is a public-safety record and is kept',
    );
    // How a coordinate was obtained is a fact about the platform's own conduct,
    // and an oversight review still needs it after the coordinate has gone.
    assert.equal(agedIncident.location_source, 'INCIDENT_REPORT');

    assert.equal(keptIncident.latitude, '9.850000');
    assert.equal(keptIncident.location_erased_at, null);

    // The notice survives its wording. A resident disputing a decision has to be
    // able to show they were never told; a blank row would read as "nothing was
    // ever sent", which is a different and wrong answer.
    const notices = await db.query<{
      id: string;
      subject: string | null;
      body: string;
      recipient_address: string | null;
      content_erased_at: Date | null;
      delivered_at: Date | null;
    }>(
      'SELECT id, subject, body, recipient_address, content_erased_at, delivered_at FROM notification',
    );
    const agedNotice = notices.rows.find((row) => row.id === agedNotificationId);
    const keptNotice = notices.rows.find((row) => row.id === freshNotificationId);

    assert.ok(agedNotice !== undefined && keptNotice !== undefined);
    assert.equal(agedNotice.subject, null);
    assert.equal(agedNotice.recipient_address, null);
    assert.match(agedNotice.body, /Erased under the retention schedule/);
    assert.ok(agedNotice.content_erased_at !== null);
    assert.ok(agedNotice.delivered_at !== null, 'that it was delivered, and when, is kept');

    assert.match(keptNotice.body, /Ministry of Health/);
    assert.equal(keptNotice.content_erased_at, null);

    // The recent sign-in attempt is inside its ninety days and stays.
    const remaining = await db.query<{ identifier: string }>(
      'SELECT identifier FROM login_attempt ORDER BY attempted_at DESC',
    );
    assert.ok(
      remaining.rows.some((row) => row.identifier === 'recent@retention.test'),
      'an attempt inside its period must survive the sweep',
    );

    assert.equal(
      await countOf(
        `SELECT count(*)::text AS count FROM notification_delivery_attempt
          WHERE notification_id = $1`,
        [freshNotificationId],
      ),
      1,
      'a recent delivery attempt is inside its period',
    );
    assert.equal(
      await countOf(
        `SELECT count(*)::text AS count FROM notification_delivery_attempt
          WHERE notification_id = $1`,
        [agedNotificationId],
      ),
      0,
    );
  });

  test('a rule stops at its batch, says so, and the next sweep continues', async () => {
    // Seven aged attempts, a batch of five: the first sweep took five and
    // reported more remaining. A sweep that silently erased 5,000 of 40,000 and
    // reported "5,000" would be read as "there were 5,000".
    const left = await countOf(
      "SELECT count(*)::text AS count FROM login_attempt WHERE identifier LIKE 'old-%'",
    );
    assert.equal(left, 2, 'the first sweep stopped at its batch of five');

    const response = await dpo.post('/api/v1/retention/runs', { dryRun: false }).expect(201);
    const body = response.body as { moreRemaining: boolean };
    assert.equal(
      await countOf(
        "SELECT count(*)::text AS count FROM login_attempt WHERE identifier LIKE 'old-%'",
      ),
      0,
      'the second sweep finished what the first could not',
    );
    assert.equal(body.moreRemaining, false, 'and now reports that there is no more to do');
  });

  test('nothing the sweep can reach holds a person, a case or an audit event', async () => {
    // The strongest form of this is enforced by the database: `pcid_app` holds
    // DELETE on the operational tables and nothing else, and `audit_event` has
    // three triggers refusing UPDATE, DELETE and TRUNCATE. This asserts the
    // outcome an oversight review would check.
    const erasures = await db.query<{ table_name: string }>(
      'SELECT DISTINCT table_name FROM retention_erasure',
    );
    const swept = erasures.rows.map((row) => row.table_name);
    for (const protectedTable of [
      'citizen',
      'pcid_allocation',
      'audit_event',
      'investigation_case',
      'government_user',
      'citizen_account',
    ]) {
      assert.ok(
        !swept.includes(protectedTable),
        `the sweep must never touch ${protectedTable}, and the ledger shows whether it did`,
      );
    }
  });

  test('the audit trail survives the sweep, and still proves it has not been altered', async () => {
    const verification = await dpo.get('/api/v1/audit/verify').expect(200);
    const body = verification.body as { intact: boolean; problems: unknown[] };
    assert.equal(body.intact, true, 'a retention sweep must not break the audit chain');
    assert.equal(body.problems.length, 0);

    // And the trail is not merely intact but complete: the sweep itself is in it.
    const events = await db.query<{ action: string; actor_type: string; detail: unknown }>(
      "SELECT action, actor_type, detail FROM audit_event WHERE action = 'RETENTION_RUN' ORDER BY seq",
    );
    assert.ok(events.rows.length >= 2, 'both the decision and the sweep are recorded');
    const detail = events.rows.at(-1)?.detail as { rowsAffected?: number; erasures?: unknown[] };
    assert.equal(typeof detail.rowsAffected, 'number');
    assert.ok(Array.isArray(detail.erasures));
    // Counts and cutoffs, never contents: an audit record that quoted the
    // erased body would keep the data the erasure removed.
    assert.ok(!JSON.stringify(detail).includes('Internal Revenue Service'));
  });

  test('the ledger records what each run did, and cannot be edited afterwards', async () => {
    const response = await dpo.get('/api/v1/retention/runs?limit=10').expect(200);
    const body = response.body as {
      total: number;
      runs: {
        reference: string;
        trigger: string;
        dryRun: boolean;
        status: string;
        rowsAffected: number;
        erasures: { policy: string; rowsAffected: number; capped: boolean }[];
      }[];
    };

    assert.ok(body.total >= 3, 'the dry run and both sweeps are all on the record');
    const live = body.runs.filter((run) => !run.dryRun);
    assert.ok(live.length >= 2);
    assert.ok(live.every((run) => run.status === 'COMPLETED'));
    assert.ok((live[0]?.erasures ?? []).length > 0);

    await assert.rejects(
      () => db.query('UPDATE retention_erasure SET rows_affected = 0'),
      /append-only/,
      'a record of erasures that could itself be edited would prove nothing',
    );
    await assert.rejects(() => db.query('DELETE FROM retention_erasure'), /append-only/);
  });

  test('the ledger holds counts and cutoffs, never what was erased', async () => {
    const columns = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'retention_erasure'`,
    );
    const names = columns.rows.map((row) => row.column_name).sort();
    // Deliberately no row identifiers. Recording which rows were erased would
    // keep a pointer to every erased subject for as long as the ledger is kept -
    // a longer retention than the data itself had.
    for (const forbidden of ['subject_pcid', 'row_ids', 'payload', 'contents', 'erased_values']) {
      assert.ok(!names.includes(forbidden), `the ledger must not hold ${forbidden}`);
    }
    assert.ok(names.includes('rows_affected'));
    assert.ok(names.includes('cutoff'));
  });

  test('only the officer answerable for it may see the schedule or run it', async () => {
    // A registration officer holds no retention action. Reading the schedule is
    // refused as well as running it: the schedule is a map of what the platform
    // holds and for how long, which is not a counter clerk's business.
    //
    // The refusal is the platform's opaque 404, not a 403, and that is the house
    // rule rather than an accident: 403 is reserved for refusals reachable only
    // by somebody who already holds the case or incident, where naming what is
    // missing lets them put it right and leaks nothing. Everything else answers
    // without confirming that the surface is there. The precise reason is in the
    // audit record, which is where an oversight review reads it.
    await registrar.get('/api/v1/retention/schedule').expect(404);
    await registrar.get('/api/v1/retention/runs').expect(404);
    const refused = await registrar.post('/api/v1/retention/runs', { dryRun: false }).expect(404);
    const body = refused.body as { error: { code: string } };
    assert.equal(body.error.code, 'NOT_FOUND_OR_NOT_PERMITTED');

    // And the refusal is in the trail, like every other refusal.
    const denied = await db.query<{ outcome: string }>(
      `SELECT outcome FROM audit_event
        WHERE action IN ('RETENTION_VIEW','RETENTION_RUN') AND outcome = 'DENIED'`,
    );
    assert.ok(denied.rows.length >= 1, 'a refused retention request is audited like any other');
  });

  test('running the sweep needs a freshly re-authenticated session', async () => {
    // Erasure is the least reversible thing this platform does. A session that
    // was second-factored this morning is not the same assurance as one
    // second-factored a moment ago.
    const aal1 = await signInWithoutStepUp();
    const response = await new ApiClient(context, aal1)
      .post('/api/v1/retention/runs', { dryRun: false })
      .expect(403);
    const body = response.body as { error: { code: string } };
    assert.equal(body.error.code, 'STEP_UP_REQUIRED');
  });

  test('the nightly sweep runs as the platform, with no person behind it', async () => {
    // The scheduled path is not the same code as the button, and it is the one
    // that will actually run every night. Two things could only fail here: the
    // ledger's CHECK that a SCHEDULED run carries no actor, and an audit row
    // written as SYSTEM rather than as a signed-in officer.
    const { RetentionWorker } = await import('../../src/retention/retention.worker');
    const { runScheduledSweep } = await import('../../src/retention/retention.scheduler');
    const { AuditService } = await import('../../src/audit/audit.service');
    const { Database } = await import('../../src/database/pool');

    const database = context.app.get(Database);
    const worker = context.app.get(RetentionWorker);
    await runScheduledSweep(worker, new AuditService(database));

    const run = await db.query<{ trigger: string; actor_type: string; actor_id: string | null }>(
      `SELECT trigger, actor_type, actor_id FROM retention_run
        WHERE trigger = 'SCHEDULED' ORDER BY started_at DESC LIMIT 1`,
    );
    assert.equal(run.rows.length, 1);
    assert.equal(run.rows[0]?.actor_type, 'SYSTEM');
    assert.equal(
      run.rows[0]?.actor_id,
      null,
      'a scheduled sweep must not borrow the identity of whoever deployed the worker',
    );

    // And it did not break the chain, which is the property that matters most
    // about anything running unattended at three in the morning.
    const verification = await dpo.get('/api/v1/audit/verify').expect(200);
    assert.equal((verification.body as { intact: boolean }).intact, true);
  });

  async function signInWithoutStepUp(): Promise<string> {
    const response = await new ApiClient(context)
      .post('/api/v1/auth/login', { email: 'dpo@retention.test', password: dpoPassword })
      .expect(201);
    return (response.body as { accessToken: string }).accessToken;
  }
});
