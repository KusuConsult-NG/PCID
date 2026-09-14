import { strict as assert } from 'node:assert';
import { after, before, describe, test } from 'node:test';

import { ApiClient, bootstrapAdmin, createAgency, createUser, signIn, totpCode } from './harness';
import type { CreatedUser, TestContext } from './harness';
import { createTestContext } from './harness';

/**
 * Master system prompt §74 - SECURITY TESTING, exercised against the running API.
 *
 * These are adversarial: each one attempts the attack and asserts it fails, so a
 * regression that reopens the hole fails the build rather than waiting for a
 * penetration test to find it.
 */
/**
 * A search that matches more people than anybody could look through is refused
 * rather than paged (§63). Production runs that ceiling at a thousand; here it is
 * two, so the control can be exercised against three registrations rather than a
 * statewide register. This suite runs in its own process, so the setting affects
 * nothing else.
 */
process.env.SEARCH_MAX_RESULTS = '2';

describe('§74 security tests', () => {
  let context: TestContext;
  let admin: ApiClient;
  let registrar: CreatedUser;
  let registrarClient: ApiClient;
  /** A second desk with an untouched search budget, for the ceiling test. */
  let secondDeskClient: ApiClient;
  let revenueClient: ApiClient;
  let revenueUser: CreatedUser;
  let investigatorClient: ApiClient;
  let pcid: string;
  let otherPcid: string;
  let citizenClient: ApiClient;
  let otherCitizenClient: ApiClient;

  before(async () => {
    context = await createTestContext('security');
    const bootstrap = await bootstrapAdmin(context);
    const session = await signIn(
      context,
      bootstrap.email,
      bootstrap.password,
      bootstrap.totpSecret,
    );
    admin = new ApiClient(context, session.accessToken);

    const registry = await createAgency(context, session.accessToken, {
      code: 'PLT-REGISTRY',
      name: 'Plateau State Citizen Registry',
      category: 'MDA',
      maxClassification: 'HIGHLY_RESTRICTED',
    });
    const revenue = await createAgency(context, session.accessToken, {
      code: 'PLT-REVENUE',
      name: 'Plateau State Internal Revenue Service',
      category: 'REVENUE',
      maxClassification: 'CONFIDENTIAL',
    });
    const police = await createAgency(context, session.accessToken, {
      code: 'PLT-POLICE',
      name: 'Plateau State Police Command',
      category: 'SECURITY',
      maxClassification: 'LAW_ENFORCEMENT_RESTRICTED',
      lawEnforcementCompartment: true,
    });

    registrar = await createUser(context, session.accessToken, {
      email: 'registrar@pcid.plateaustate.gov.ng',
      fullName: 'Registration Officer',
      agencyId: registry.id,
      roles: ['REGISTRATION_OFFICER'],
      clearance: 'HIGHLY_RESTRICTED',
    });
    const secondDesk = await createUser(context, session.accessToken, {
      email: 'second.desk@pcid.plateaustate.gov.ng',
      fullName: 'Counter Two',
      agencyId: registry.id,
      roles: ['REGISTRATION_OFFICER'],
      clearance: 'HIGHLY_RESTRICTED',
    });
    revenueUser = await createUser(context, session.accessToken, {
      email: 'revenue@pcid.plateaustate.gov.ng',
      fullName: 'Revenue Officer',
      agencyId: revenue.id,
      roles: ['MDA_OFFICER'],
      clearance: 'CONFIDENTIAL',
    });
    const investigator = await createUser(context, session.accessToken, {
      email: 'investigator@pcid.plateaustate.gov.ng',
      fullName: 'Investigator',
      agencyId: police.id,
      roles: ['INVESTIGATOR'],
      clearance: 'LAW_ENFORCEMENT_RESTRICTED',
    });

    registrarClient = new ApiClient(
      context,
      (await signIn(context, registrar.email, registrar.password, registrar.totpSecret))
        .accessToken,
    );
    secondDeskClient = new ApiClient(
      context,
      (await signIn(context, secondDesk.email, secondDesk.password, secondDesk.totpSecret))
        .accessToken,
    );
    revenueClient = new ApiClient(
      context,
      (await signIn(context, revenueUser.email, revenueUser.password, revenueUser.totpSecret))
        .accessToken,
    );
    investigatorClient = new ApiClient(
      context,
      (await signIn(context, investigator.email, investigator.password, investigator.totpSecret))
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

    const second = await registrarClient
      .post('/api/v1/citizens', {
        givenName: 'Bitrus',
        familyName: 'Gyang',
        sex: 'MALE',
        dateOfBirth: '1988-02-03',
        phonePrimary: '08030000002',
        lgaCode: 'PL-JSO',
        wardCode: 'PL-JSO-01',
        channel: 'REGISTRATION_DESK',
      })
      .expect(201);
    otherPcid = (second.body as { pcid: string }).pcid;

    for (const [target, holder] of [
      [pcid, 'first'],
      [otherPcid, 'second'],
    ] as const) {
      const issued = await registrarClient
        .post(`/api/v1/citizens/${target}/portal-account`)
        .expect(201);
      const login = await new ApiClient(context)
        .post('/api/v1/auth/citizen/login', {
          identifier: target,
          password: (issued.body as { temporaryPassword: string }).temporaryPassword,
        })
        .expect(201);
      const client = new ApiClient(context, (login.body as { accessToken: string }).accessToken);
      if (holder === 'first') citizenClient = client;
      else otherCitizenClient = client;
    }
  });

  after(async () => {
    await context?.close();
  });

  test('authentication bypass: no token, empty token, or a forged token', async () => {
    const anonymous = new ApiClient(context);
    await anonymous.get(`/api/v1/citizens/${pcid}?purpose=SERVICE_DELIVERY`).expect(401);

    for (const header of [
      '',
      'Bearer',
      'Bearer ',
      'Basic abcdef',
      'Bearer null',
      'Bearer undefined',
    ]) {
      const response = await anonymous
        .get(`/api/v1/citizens/${pcid}?purpose=SERVICE_DELIVERY`)
        .set('authorization', header);
      assert.equal(response.status, 401, `authorization: "${header}" must not authenticate`);
    }

    // An unsigned token claiming the "none" algorithm.
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: 'anyone',
        sid: 'anything',
        act: 'GOVERNMENT_USER',
        aal: 'AAL2',
        iss: 'pcid.plateaustate.gov.ng',
        aud: 'pcid-api',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        jti: 'forged',
      }),
    ).toString('base64url');
    await new ApiClient(context, `${header}.${payload}.`)
      .get(`/api/v1/citizens/${pcid}?purpose=SERVICE_DELIVERY`)
      .expect(401);
  });

  test('privilege escalation: a revoked role stops working on the next request', async () => {
    const { Database } = await import('../../src/database/pool');
    const db = context.app.get(Database);

    await revenueClient.get(`/api/v1/citizens/${pcid}?purpose=SERVICE_DELIVERY`).expect(200);
    await db.query(
      `DELETE FROM user_role WHERE user_id = $1
        AND role_id = (SELECT id FROM role WHERE name = 'MDA_OFFICER')`,
      [revenueUser.id],
    );
    await revenueClient.get(`/api/v1/citizens/${pcid}?purpose=SERVICE_DELIVERY`).expect(404);

    // Restore for the remaining tests.
    await db.query(
      `INSERT INTO user_role (user_id, role_id)
       SELECT $1, id FROM role WHERE name = 'MDA_OFFICER' ON CONFLICT DO NOTHING`,
      [revenueUser.id],
    );
    await revenueClient.get(`/api/v1/citizens/${pcid}?purpose=SERVICE_DELIVERY`).expect(200);
  });

  test('session revocation takes effect immediately', async () => {
    const session = await signIn(
      context,
      revenueUser.email,
      revenueUser.password,
      revenueUser.totpSecret,
    );
    const client = new ApiClient(context, session.accessToken);
    await client.get('/api/v1/auth/me').expect(200);
    await client.post('/api/v1/auth/logout').expect(201);
    await client.get('/api/v1/auth/me').expect(401);
  });

  test('IDOR: a citizen cannot reach another citizen by changing the identifier', async () => {
    await citizenClient.get('/api/v1/me/record').expect(200);
    await citizenClient
      .get(`/api/v1/citizens/${otherPcid}?purpose=CITIZEN_SELF_SERVICE`)
      .expect(404);
    await otherCitizenClient
      .get(`/api/v1/citizens/${pcid}?purpose=CITIZEN_SELF_SERVICE`)
      .expect(404);
    await citizenClient
      .get(`/api/v1/citizens/${otherPcid}/360?purpose=CITIZEN_SELF_SERVICE`)
      .expect(404);

    // Nor by asserting somebody else's purpose.
    await citizenClient
      .get(`/api/v1/citizens/${otherPcid}?purpose=CRIMINAL_INVESTIGATION`)
      .expect(404);
    await citizenClient.get(`/api/v1/citizens?purpose=SERVICE_DELIVERY&name=Gyang`).expect(404);
  });

  test('a citizen holds no registry search action at all', async () => {
    // A resident has exactly one record and reaches it through the portal. There
    // is no citizen-facing way to search the registry, for any purpose.
    const me = await citizenClient.get('/api/v1/auth/me').expect(200);
    const actions = (me.body as { actions: string[] }).actions;
    assert.equal(actions.includes('CITIZEN_SEARCH'), false);
    assert.equal(actions.includes('VEHICLE_SEARCH'), false);
    assert.equal(actions.includes('PROPERTY_SEARCH'), false);

    await citizenClient.get('/api/v1/citizens?purpose=CITIZEN_SELF_SERVICE&name=Dung').expect(404);
    await citizenClient
      .get(`/api/v1/citizens?purpose=CITIZEN_SELF_SERVICE&pcid=${pcid}`)
      .expect(404);

    // Their own record is still reachable the intended way.
    const own = await citizenClient.get('/api/v1/me/record').expect(200);
    const identity = (own.body as { cards: { key: string; status: string }[] }).cards.find(
      (card) => card.key === 'IDENTITY',
    );
    assert.equal(identity?.status, 'RELEASED');
  });

  test('SQL injection in every reachable string input is inert', async () => {
    const payloads = [
      "' OR '1'='1",
      "'; DROP TABLE citizen; --",
      "' UNION SELECT pcid, nin FROM citizen --",
      "\\'; DELETE FROM audit_event; --",
      "%' OR pcid IS NOT NULL --",
      "1' AND (SELECT count(*) FROM government_user) > 0 --",
    ];
    for (const payload of payloads) {
      const encoded = encodeURIComponent(payload);
      const byName = await registrarClient.get(
        `/api/v1/citizens?purpose=SERVICE_DELIVERY&name=${encoded}`,
      );
      assert.ok([200, 400].includes(byName.status), `name payload produced ${byName.status}`);
      if (byName.status === 200) {
        assert.equal(
          (byName.body as { total: number }).total,
          0,
          'an injection payload must match nothing, not everything',
        );
      }
      const byPhone = await registrarClient.get(
        `/api/v1/citizens?purpose=SERVICE_DELIVERY&phone=${encoded}`,
      );
      assert.ok([200, 400].includes(byPhone.status));
    }

    // The tables are all still there and the audit trail is intact.
    const { Database } = await import('../../src/database/pool');
    const db = context.app.get(Database);
    const citizens = await db.queryOne<{ count: string }>(
      'SELECT count(*)::text AS count FROM citizen',
    );
    assert.ok(Number(citizens?.count ?? 0) >= 2);
    const events = await db.queryOne<{ count: string }>(
      'SELECT count(*)::text AS count FROM audit_event',
    );
    assert.ok(Number(events?.count ?? 0) > 0);
  });

  test('the audit trail cannot be altered or deleted, even with database access', async () => {
    const { Database } = await import('../../src/database/pool');
    const db = context.app.get(Database);
    await assert.rejects(
      db.query("UPDATE audit_event SET action = 'TAMPERED' WHERE seq = 1"),
      /append-only/,
    );
    await assert.rejects(db.query('DELETE FROM audit_event WHERE seq = 1'), /append-only/);
    await assert.rejects(db.query('TRUNCATE audit_event'), /append-only/);

    const problems = await db.query('SELECT * FROM verify_audit_chain()');
    assert.deepEqual(problems, [], 'the chain must still verify');
  });

  test('concurrent writers cannot fork the audit chain', async () => {
    const { Database } = await import('../../src/database/pool');
    const db = context.app.get(Database);

    // One page of the government portal issues five authorised calls at once,
    // and the service runs behind a load balancer, so simultaneous audit writes
    // are the ordinary case. Before the chain trigger took a lock, two writers
    // read the same tail, wrote the same prev_hash, and the chain forked - which
    // verify_audit_chain() reports as tampering that never happened.
    const before = await db.queryOne<{ count: string }>(
      'SELECT count(*)::text AS count FROM audit_event',
    );

    await Promise.all(
      Array.from({ length: 24 }, (_, index) =>
        revenueClient
          .get(`/api/v1/citizens/${pcid}?purpose=SERVICE_DELIVERY`)
          .expect((response) => {
            assert.ok(response.status < 500, `concurrent read ${index} failed`);
          }),
      ),
    );

    const after = await db.queryOne<{ count: string }>(
      'SELECT count(*)::text AS count FROM audit_event',
    );
    assert.ok(
      Number(after?.count ?? 0) > Number(before?.count ?? 0) + 20,
      'the concurrent calls each wrote their own audit record',
    );

    const problems = await db.query('SELECT * FROM verify_audit_chain()');
    assert.deepEqual(problems, [], 'the chain is intact after concurrent writes');
  });

  test('a PCID allocation can never be deleted or recycled', async () => {
    const { Database } = await import('../../src/database/pool');
    const db = context.app.get(Database);
    await assert.rejects(
      db.query('DELETE FROM pcid_allocation WHERE pcid = $1', [pcid]),
      /permanent/,
    );
    await assert.rejects(
      db.query("UPDATE pcid_allocation SET channel = 'CHANGED' WHERE pcid = $1", [pcid]),
      /permanent/,
    );
  });

  test('mass extraction is bounded by page size, rate limit and the absence of an export action', async () => {
    await registrarClient
      .get('/api/v1/citizens?purpose=SERVICE_DELIVERY&name=Dung&limit=1000')
      .expect(400);
    await registrarClient
      .get('/api/v1/citizens?purpose=SERVICE_DELIVERY&name=Dung&offset=-1')
      .expect(400);

    const me = await registrarClient.get('/api/v1/auth/me').expect(200);
    assert.equal((me.body as { actions: string[] }).actions.includes('CITIZEN_EXPORT'), false);

    let limited = false;
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const response = await registrarClient.get(
        '/api/v1/citizens?purpose=SERVICE_DELIVERY&name=Dung',
      );
      if (response.status === 429) {
        limited = true;
        break;
      }
    }
    assert.equal(limited, true);
  });

  test('guessing a password gives no oracle, and the account locks behind it', async () => {
    const anonymous = new ApiClient(context);

    // Every wrong guess looks identical, whatever the account's state: a guesser
    // learns nothing about whether the account exists or has been locked.
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await anonymous.post('/api/v1/auth/login', {
        email: revenueUser.email,
        password: `wrong-password-${attempt}`,
      });
      statuses.push(response.status);
    }
    assert.deepEqual([...new Set(statuses)], [401], 'every wrong guess answers identically');

    const unknownAccount = await anonymous.post('/api/v1/auth/login', {
      email: 'nobody@pcid.plateaustate.gov.ng',
      password: 'wrong-password-0',
    });
    assert.equal(unknownAccount.status, 401, 'an unknown account answers the same way');

    // But the lock is real: the correct password no longer works either.
    const afterLock = await anonymous.post('/api/v1/auth/login', {
      email: revenueUser.email,
      password: revenueUser.password,
    });
    assert.ok(
      [423, 429].includes(afterLock.status),
      `expected the account to be locked or throttled, got ${afterLock.status}`,
    );
  });

  test('unknown and oversized input is rejected before it reaches a handler', async () => {
    // Unknown keys are stripped, not honoured.
    const response = await registrarClient
      .post('/api/v1/citizens', {
        givenName: 'Test',
        familyName: 'Person',
        sex: 'FEMALE',
        dateOfBirth: '2000-01-01',
        channel: 'REGISTRATION_DESK',
        status: 'ACTIVE',
        verificationLevel: 'BIOMETRIC_VERIFIED',
        classification: 'PUBLIC',
      })
      .expect(201);
    const issued = (response.body as { pcid?: string }).pcid;
    assert.ok(issued);

    const { Database } = await import('../../src/database/pool');
    const db = context.app.get(Database);
    const stored = await db.queryOne<{ verification_level: string; classification: string }>(
      'SELECT verification_level, classification FROM citizen WHERE pcid = $1',
      [issued],
    );
    assert.equal(
      stored?.verification_level,
      'SELF_ASSERTED',
      'a client cannot set its own assurance level',
    );
    assert.equal(stored?.classification, 'CONFIDENTIAL');

    // A malformed body is refused with a field-level explanation.
    const invalid = await registrarClient
      .post('/api/v1/citizens', {
        givenName: '',
        familyName: 'X',
        sex: 'OTHER',
        dateOfBirth: 'yesterday',
      })
      .expect(400);
    const error = (invalid.body as { error: { code: string; details?: unknown[] } }).error;
    assert.equal(error.code, 'VALIDATION_FAILED');
    assert.ok((error.details?.length ?? 0) > 0);
  });

  test('an error response never leaks internals', async () => {
    const response = await registrarClient
      .get('/api/v1/citizens/PL-00000-00000-00?purpose=SERVICE_DELIVERY')
      .expect(400);
    const serialised = JSON.stringify(response.body);
    for (const leak of [
      'SELECT',
      'postgres',
      'pg_',
      'node_modules',
      'at Object.',
      'password_hash',
    ]) {
      assert.equal(serialised.includes(leak), false, `the error body must not contain ${leak}`);
    }
  });

  test('security headers are set and the server does not advertise itself', async () => {
    const response = await new ApiClient(context).get('/api/v1/health/live').expect(200);
    assert.equal(response.headers['x-powered-by'], undefined);
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['x-frame-options'], 'SAMEORIGIN');
    assert.equal(response.headers['referrer-policy'], 'no-referrer');
    assert.ok(response.headers['content-security-policy']);
  });

  test('a second factor cannot be brute forced', async () => {
    const anonymous = new ApiClient(context);
    const login = await anonymous
      .post('/api/v1/auth/login', { email: registrar.email, password: registrar.password })
      .expect(201);
    const accessToken = (login.body as { accessToken: string }).accessToken;
    const sessionId = JSON.parse(
      Buffer.from(accessToken.split('.')[1] as string, 'base64url').toString('utf8'),
    ).sid as string;

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await anonymous.post('/api/v1/auth/mfa/verify', {
        sessionId,
        code: String(attempt).padStart(6, '0'),
      });
      statuses.push(response.status);
    }
    assert.ok(statuses.includes(429), 'repeated second-factor attempts must be throttled');

    // A correct code on a throttled session is still refused.
    const afterThrottle = await anonymous.post('/api/v1/auth/mfa/verify', {
      sessionId,
      code: await totpCode(registrar.totpSecret),
    });
    assert.equal(afterThrottle.status, 429);
  });

  test('an administrator cannot escalate their own entitlements', async () => {
    const me = await admin.get('/api/v1/auth/me').expect(200);
    const adminId = (me.body as { id: string }).id;

    // There is no endpoint to grant yourself a role, and the policy engine
    // refuses self-administration outright.
    const { PolicyService } = await import('../../src/policy/policy.service');
    const policy = context.app.get(PolicyService);
    const { ActorService } = await import('../../src/iam/actor.service');
    const actors = context.app.get(ActorService);
    const actor = await actors.loadGovernmentActor(adminId, 'ses-test', 'AAL2');
    assert.ok(actor);
    const decision = await policy.evaluateOnly({
      actor: actor!,
      action: 'ADMIN_ROLE_MANAGE',
      purpose: 'SYSTEM_ADMINISTRATION',
      resource: {
        type: 'GOVERNMENT_USER',
        id: adminId,
        classification: 'INTERNAL',
        subjectPcid: null,
      },
      context: {
        correlationId: 'test',
        ipAddress: null,
        userAgent: null,
        deviceFingerprint: null,
        deviceToken: null,
        startedAt: Date.now(),
      },
    });
    assert.equal(decision.effect, 'DENY');
    assert.equal(decision.reasons[0]?.gate, 'SEPARATION_OF_DUTY');
  });

  test('an investigator cannot read a record with no case, and the denial names what is missing', async () => {
    const response = await investigatorClient
      .get(`/api/v1/citizens/${pcid}?purpose=CRIMINAL_INVESTIGATION`)
      .expect(403);
    const error = (response.body as { error: { code: string; message: string } }).error;
    assert.equal(error.code, 'CASE_REFERENCE_REQUIRED');
    assert.match(error.message, /case/i);
  });

  test('a search that matches more people than the ceiling is refused, not paged', async () => {
    // Three people sharing a surname, against a ceiling of two. On the real
    // register the ceiling is a thousand and a surname matches two hundred
    // thousand; the arithmetic is the same and so is the answer.
    for (const [index, given] of ['Ladi', 'Nanle', 'Talatu'].entries()) {
      await secondDeskClient
        .post('/api/v1/citizens', {
          givenName: given,
          familyName: 'Choji',
          sex: 'FEMALE',
          dateOfBirth: `197${index}-03-0${index + 1}`,
          phonePrimary: `0803000091${index}`,
          lgaCode: 'PL-JNO',
          wardCode: 'PL-JNO-01',
          channel: 'REGISTRATION_DESK',
        })
        .expect(201);
    }

    const refused = await secondDeskClient
      .get('/api/v1/citizens?purpose=SERVICE_DELIVERY&name=Choji&limit=20')
      .expect(400);
    const error = (refused.body as { error: { code: string; message: string } }).error;
    assert.equal(error.code, 'VALIDATION_FAILED');
    // The refusal says what to add, because the officer has the person in front
    // of them and can ask. It must not say how many matched beyond the ceiling:
    // "more than two" is what the platform counted, and counting further is the
    // cost the ceiling exists to avoid.
    assert.match(error.message, /date of birth|telephone|Plateau Citizen ID/i);
    assert.doesNotMatch(error.message, /\b3 people\b/);

    // The same search with a date of birth beside it is answered, because it
    // identifies somebody rather than describing a lot of people.
    const answered = await secondDeskClient
      .get('/api/v1/citizens?purpose=SERVICE_DELIVERY&name=Choji&dateOfBirth=1970-03-01&limit=20')
      .expect(200);
    const found = answered.body as {
      total: number;
      results: { data: Record<string, unknown>; restrictedFields: string[] }[];
    };
    assert.equal(found.total, 1);
    assert.equal(found.results.length, 1);
    // Which fields come back is the field catalogue's business and is asserted
    // at length elsewhere. What matters here is that the same name identified one
    // person once a date of birth was beside it, instead of describing a crowd -
    // and that the row is still a projection through a decision, carrying what
    // was withheld as well as what was released.
    assert.ok(Array.isArray(found.results[0]?.restrictedFields));
  });
});
