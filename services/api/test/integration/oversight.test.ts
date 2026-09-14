import { strict as assert } from 'node:assert';
import { after, before, describe, test } from 'node:test';

import { ApiClient, bootstrapAdmin, createAgency, createUser, signIn } from './harness';
import type { TestContext } from './harness';
import { createTestContext } from './harness';

/**
 * The oversight surface: duplicate review, correction review and alerts
 * (master system prompt §7, §32, §51, §66, §67).
 *
 * Every one of these actions was granted to a seeded role before this suite
 * existed, and none of them had a route. The tests are therefore written to
 * assert the thing that was actually missing: that the queue can be found, that
 * a decision changes the record, and that the decision is attributed.
 */
describe('oversight queues', () => {
  let context: TestContext;
  let adminToken: string;
  let registrarClient: ApiClient;
  let dpoClient: ApiClient;
  let mdaClient: ApiClient;
  let registrarUserId: string;

  let pcid: string;
  let citizen: ApiClient;

  before(async () => {
    context = await createTestContext('oversight');
    const bootstrap = await bootstrapAdmin(context);
    const session = await signIn(
      context,
      bootstrap.email,
      bootstrap.password,
      bootstrap.totpSecret,
    );
    adminToken = session.accessToken;

    const registry = await createAgency(context, adminToken, {
      code: 'PLT-REGISTRY',
      name: 'Citizen Registry',
      category: 'MDA',
      maxClassification: 'HIGHLY_RESTRICTED',
    });
    const ministry = await createAgency(context, adminToken, {
      code: 'PLT-HEALTH',
      name: 'Ministry of Health',
      category: 'MDA',
      maxClassification: 'CONFIDENTIAL',
    });

    const registrar = await createUser(context, adminToken, {
      email: 'registrar@oversight.test',
      fullName: 'Registration Desk',
      agencyId: registry.id,
      roles: ['REGISTRATION_OFFICER'],
      clearance: 'HIGHLY_RESTRICTED',
    });
    registrarUserId = registrar.id;
    const dpo = await createUser(context, adminToken, {
      email: 'dpo@oversight.test',
      fullName: 'Data Protection Office',
      agencyId: registry.id,
      roles: ['DATA_PROTECTION_OFFICER', 'AUDITOR'],
      clearance: 'HIGHLY_RESTRICTED',
    });
    const mda = await createUser(context, adminToken, {
      email: 'counter@oversight.test',
      fullName: 'Service Counter',
      agencyId: ministry.id,
      roles: ['MDA_OFFICER'],
      clearance: 'CONFIDENTIAL',
    });

    registrarClient = new ApiClient(
      context,
      (await signIn(context, registrar.email, registrar.password, registrar.totpSecret))
        .accessToken,
    );
    dpoClient = new ApiClient(
      context,
      (await signIn(context, dpo.email, dpo.password, dpo.totpSecret)).accessToken,
    );
    mdaClient = new ApiClient(
      context,
      (await signIn(context, mda.email, mda.password, mda.totpSecret)).accessToken,
    );

    const registered = await registrarClient
      .post('/api/v1/citizens', {
        givenName: 'Ladi',
        middleName: 'Naanret',
        familyName: 'Gyang',
        sex: 'FEMALE',
        dateOfBirth: '1991-03-04',
        phonePrimary: '08031110001',
        email: 'ladi.gyang@example.ng',
        residentialAddress: '4 Yakubu Gowon Way, Jos',
        lgaCode: 'PL-JNO',
        wardCode: 'PL-JNO-01',
        channel: 'REGISTRATION_DESK',
      })
      .expect(201);
    pcid = (registered.body as { pcid: string }).pcid;

    const account = await registrarClient
      .post(`/api/v1/citizens/${pcid}/portal-account`)
      .expect(201);
    const { temporaryPassword } = account.body as { temporaryPassword: string };
    const login = await new ApiClient(context)
      .post('/api/v1/auth/citizen/login', { identifier: pcid, password: temporaryPassword })
      .expect(201);
    citizen = new ApiClient(context, (login.body as { accessToken: string }).accessToken);
  });

  after(async () => {
    await context.close();
  });

  test('a queued duplicate can be found, not only decided', async () => {
    // The same person, presented a second time at a different desk.
    const again = await registrarClient
      .post('/api/v1/citizens', {
        givenName: 'Ladi',
        familyName: 'Gyang',
        sex: 'FEMALE',
        dateOfBirth: '1991-03-04',
        phonePrimary: '08031110001',
        residentialAddress: '4 Yakubu Gowon Way, Jos',
        lgaCode: 'PL-JNO',
        wardCode: 'PL-JNO-01',
        channel: 'REGISTRATION_DESK',
      })
      .expect(201);
    assert.equal((again.body as { status: string }).status, 'DUPLICATE_REVIEW');

    const queue = await registrarClient.get('/api/v1/citizens/duplicates').expect(200);
    const body = queue.body as {
      total: number;
      candidates: {
        id: string;
        score: number;
        matchedAttributes: unknown[];
        existingPerson: Record<string, unknown>;
        applicant: Record<string, unknown>;
      }[];
    };

    assert.ok(body.total > 0, 'the queue lists the candidate that stopped the registration');
    const candidate = body.candidates[0];
    assert.ok(candidate);
    assert.equal(candidate.existingPerson.pcid, pcid);
    // Both people described the same way, so a reviewer can actually compare them.
    assert.equal(candidate.applicant.familyName, 'Gyang');
    assert.equal(candidate.applicant.dateOfBirth, '1991-03-04');
    // And the reasoning, not just a number.
    assert.ok(Array.isArray(candidate.matchedAttributes) && candidate.matchedAttributes.length > 0);
    assert.ok(candidate.score > 0);

    // The applicant has no identifier, because nothing was issued.
    assert.equal(candidate.applicant.pcid, undefined);
  });

  test('the duplicate queue is not open to an officer without the review action', async () => {
    // Answered the same way as a queue that does not exist. That is the
    // platform's rule everywhere: a denial must never become an oracle, and the
    // precise reason is kept on the audit row for oversight instead.
    const refused = await mdaClient.get('/api/v1/citizens/duplicates').expect(404);
    assert.equal(
      (refused.body as { error: { code: string } }).error.code,
      'NOT_FOUND_OR_NOT_PERMITTED',
    );
  });

  test('an approved correction changes the record and says who changed it', async () => {
    const submitted = await citizen
      .post('/api/v1/me/correction-requests', {
        fieldPath: 'citizen.phonePrimary',
        requestedValue: '08031119999',
        justification: 'I changed network and the old number no longer reaches me.',
      })
      .expect(201);
    const reference = (submitted.body as { reference: string }).reference;

    const queue = await dpoClient.get('/api/v1/correction-requests?status=SUBMITTED').expect(200);
    const queued = (queue.body as { requests: { reference: string; applicable: boolean }[] })
      .requests;
    const item = queued.find((entry) => entry.reference === reference);
    assert.ok(item, 'the request a resident raised appears in the reviewer queue');
    assert.equal(item.applicable, true);

    const decided = await dpoClient
      .post(`/api/v1/correction-requests/${reference}/decision`, {
        decision: 'APPROVE',
        note: 'Confirmed against the number on file at the desk.',
      })
      .expect(201);
    const outcome = decided.body as { status: string; applied: boolean; decidedBy: string };
    assert.equal(outcome.status, 'APPLIED');
    assert.equal(outcome.applied, true);
    assert.equal(outcome.decidedBy, 'Data Protection Office');

    // The register actually changed.
    const record = await citizen.get('/api/v1/me/record').expect(200);
    const contact = (
      record.body as { cards: { key: string; items?: Record<string, unknown>[] }[] }
    ).cards.find((card) => card.key === 'CONTACT');
    assert.equal(contact?.items?.[0]?.phonePrimary, '08031119999');

    // And the resident can see that it did, in their own history.
    const history = await citizen.get('/api/v1/me/access-history?limit=100').expect(200);
    const accesses = (history.body as { accesses: { action: string; agency: string | null }[] })
      .accesses;
    assert.ok(accesses.some((entry) => entry.action === 'CORRECTION_REQUEST_REVIEW'));

    // With a message, rather than leaving them to check.
    const inbox = await citizen.get('/api/v1/me/notifications').expect(200);
    const messages = (inbox.body as { notifications: { subject: string | null }[] }).notifications;
    assert.ok(messages.some((message) => message.subject?.includes(reference)));
  });

  test('a correction is only ever applied to a field the resident owns', async () => {
    // Queue a request for a field outside the self-service set by writing it the
    // way an officer-raised request would arrive, then try to approve it.
    const { Database } = await import('../../src/database/pool');
    const db = context.app.get(Database);
    await db.query(
      `INSERT INTO correction_request (reference, citizen_id, requested_by_type, requested_by_id,
                                       field_path, requested_value, justification, status)
       SELECT 'CR-9999-00001', id, 'GOVERNMENT_USER', $2, 'citizen.verificationLevel',
              'BIOMETRIC_VERIFIED', 'Attempting to raise assurance without evidence.', 'SUBMITTED'
         FROM citizen WHERE pcid = $1`,
      [pcid, registrarUserId],
    );

    const refused = await dpoClient
      .post('/api/v1/correction-requests/CR-9999-00001/decision', {
        decision: 'APPROVE',
        note: 'Approving to prove the guard holds.',
      })
      .expect(400);
    assert.equal((refused.body as { error: { code: string } }).error.code, 'VALIDATION_FAILED');

    const record = await citizen.get('/api/v1/me/record').expect(200);
    const identity = (
      record.body as { cards: { key: string; items?: Record<string, unknown>[] }[] }
    ).cards.find((card) => card.key === 'IDENTITY');
    assert.equal(
      identity?.items?.[0]?.verificationLevel,
      'SELF_ASSERTED',
      'the assurance level is unchanged',
    );
  });

  test('a rejected correction changes nothing and is recorded as a rejection', async () => {
    const submitted = await citizen
      .post('/api/v1/me/correction-requests', {
        fieldPath: 'citizen.familyName',
        requestedValue: 'Danjuma',
        justification: 'I would prefer a different surname on the register.',
      })
      .expect(201);
    const reference = (submitted.body as { reference: string }).reference;

    const decided = await dpoClient
      .post(`/api/v1/correction-requests/${reference}/decision`, {
        decision: 'REJECT',
        note: 'A change of name needs a court document or a marriage certificate.',
      })
      .expect(201);
    assert.equal((decided.body as { status: string }).status, 'REJECTED');
    assert.equal((decided.body as { applied: boolean }).applied, false);

    const record = await citizen.get('/api/v1/me/record').expect(200);
    const identity = (
      record.body as { cards: { key: string; items?: Record<string, unknown>[] }[] }
    ).cards.find((card) => card.key === 'IDENTITY');
    assert.ok(String(identity?.items?.[0]?.displayName ?? '').includes('Gyang'));

    // Deciding twice is refused rather than silently re-run.
    await dpoClient
      .post(`/api/v1/correction-requests/${reference}/decision`, {
        decision: 'APPROVE',
        note: 'Trying again after a rejection.',
      })
      .expect(409);
  });

  test('an officer without the review action cannot see or decide corrections', async () => {
    await mdaClient.get('/api/v1/correction-requests').expect(404);
  });

  test('alerts the platform raised can be read, with the reasoning that produced them', async () => {
    // The duplicate registration above raised an identity-integrity alert.
    const queue = await dpoClient.get('/api/v1/alerts?status=OPEN').expect(200);
    const body = queue.body as {
      total: number;
      alerts: {
        reference: string;
        ruleKey: string;
        severity: string;
        explanation: Record<string, unknown>;
        subjectPcid: string | null;
      }[];
    };
    assert.ok(body.total > 0, 'an alert that nobody can list is not detection');

    const alert = body.alerts.find((entry) => entry.ruleKey === 'DUPLICATE_IDENTITY_ATTRIBUTES');
    assert.ok(alert, 'the duplicate registration raised an identity-integrity alert');
    // "Why am I seeing this?" is answerable by the person asked to act on it.
    assert.ok(Object.keys(alert.explanation).length > 0);

    const one = await dpoClient.get(`/api/v1/alerts/${alert.reference}`).expect(200);
    assert.equal((one.body as { reference: string }).reference, alert.reference);
  });

  test('reviewing an alert records the outcome, including a dismissal', async () => {
    const queue = await dpoClient.get('/api/v1/alerts?status=OPEN').expect(200);
    const alert = (queue.body as { alerts: { reference: string }[] }).alerts[0];
    assert.ok(alert);

    const reviewed = await dpoClient
      .post(`/api/v1/alerts/${alert.reference}/review`, {
        decision: 'DISMISSED_FALSE_POSITIVE',
        note: 'Two different people who share a name and a birthday. Confirmed at the desk.',
      })
      .expect(201);
    assert.equal((reviewed.body as { status: string }).status, 'DISMISSED_FALSE_POSITIVE');
    assert.equal((reviewed.body as { reviewedBy: string }).reviewedBy, 'Data Protection Office');

    // It leaves the open queue rather than being decided twice.
    await dpoClient
      .post(`/api/v1/alerts/${alert.reference}/review`, {
        decision: 'ACTIONED',
        note: 'Attempting to review a closed alert.',
      })
      .expect(409);
  });

  test('an alert review is not disclosed to the person it concerns', async () => {
    const history = await citizen.get('/api/v1/me/access-history?limit=100').expect(200);
    const accesses = (history.body as { accesses: { action: string }[] }).accesses;
    assert.equal(
      accesses.some((entry) => entry.action === 'ALERT_REVIEW'),
      false,
      'telling the subject which detections fired would tell them the thresholds',
    );
  });

  test('an ordinary officer can neither list nor review alerts', async () => {
    await mdaClient.get('/api/v1/alerts').expect(404);
    await mdaClient
      .post('/api/v1/alerts/ALERT-0000-00000/review', {
        decision: 'CLOSED',
        note: 'Attempting to close an alert without the action.',
      })
      .expect(404);
  });

  test('an administrator can review the accounts they administer, and sees no citizen data', async () => {
    const directory = await new ApiClient(context, adminToken).get('/api/v1/users').expect(200);
    const body = directory.body as {
      total: number;
      users: { email: string; roles: string[]; authenticatorConfirmed: boolean; agency: string }[];
    };
    assert.ok(body.total >= 3);

    const registrar = body.users.find((user) => user.email === 'registrar@oversight.test');
    assert.ok(registrar);
    assert.deepEqual(registrar.roles, ['REGISTRATION_OFFICER']);
    assert.equal(registrar.authenticatorConfirmed, true);
    assert.equal(registrar.agency, 'Citizen Registry');

    // §7: administering the platform is not an entitlement to the register.
    const serialised = JSON.stringify(body);
    assert.equal(serialised.includes(pcid), false);
    assert.equal(serialised.includes('Gyang'), false);
  });

  test('an agency administrator sees their own agency only', async () => {
    const ministryAdmin = await createUser(context, adminToken, {
      email: 'admin@health.oversight.test',
      fullName: 'Health Administration',
      agencyId: (
        await new ApiClient(context, adminToken).get('/api/v1/agencies').expect(200)
      ).body.find((agency: { code: string }) => agency.code === 'PLT-HEALTH').id,
      roles: ['AGENCY_ADMINISTRATOR'],
    });
    const client = new ApiClient(
      context,
      (await signIn(context, ministryAdmin.email, ministryAdmin.password, ministryAdmin.totpSecret))
        .accessToken,
    );

    // Asking for another agency's users does not produce them.
    const listed = await client
      .get('/api/v1/users?agencyId=00000000-0000-0000-0000-000000000000')
      .expect(200);
    const agencies = new Set(
      (listed.body as { users: { agency: string }[] }).users.map((user) => user.agency),
    );
    assert.deepEqual([...agencies], ['Ministry of Health']);
  });
});
