import { strict as assert } from 'node:assert';
import { after, before, describe, test } from 'node:test';

import { ApiClient, bootstrapAdmin, createAgency, createUser, signIn, totpCode } from './harness';
import type { CreatedUser, TestContext } from './harness';
import { createTestContext } from './harness';

/**
 * The citizen portal surface (master system prompt §17, §39, §40, §57, §58).
 *
 * The tests are written from the resident's side: what they can do with their own
 * record, and - as carefully - what the portal will not let them or anybody else
 * do with it.
 */
describe('citizen portal', () => {
  let context: TestContext;
  let adminToken: string;
  let registrarClient: ApiClient;
  let verifierClient: ApiClient;
  let mdaClient: ApiClient;

  let pcid: string;
  let otherPcid: string;
  let temporaryPassword: string;
  let citizen: ApiClient;
  let otherCitizen: ApiClient;

  before(async () => {
    context = await createTestContext('portal');
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
    const revenue = await createAgency(context, adminToken, {
      code: 'PLT-REVENUE',
      name: 'Internal Revenue Service',
      category: 'REVENUE',
      maxClassification: 'CONFIDENTIAL',
    });
    await createAgency(context, adminToken, {
      code: 'PLT-EMS',
      name: 'Emergency Management Agency',
      category: 'EMERGENCY',
      maxClassification: 'HIGHLY_RESTRICTED',
    });

    const registrar: CreatedUser = await createUser(context, adminToken, {
      email: 'registrar@x.gov.ng',
      fullName: 'Registrar One',
      agencyId: registry.id,
      roles: ['REGISTRATION_OFFICER'],
      clearance: 'HIGHLY_RESTRICTED',
    });
    registrarClient = new ApiClient(
      context,
      (await signIn(context, registrar.email, registrar.password, registrar.totpSecret))
        .accessToken,
    );

    const verifier = await createUser(context, adminToken, {
      email: 'counter@x.gov.ng',
      fullName: 'Counter Two',
      agencyId: revenue.id,
      roles: ['VERIFICATION_OFFICER'],
      clearance: 'CONFIDENTIAL',
    });
    verifierClient = new ApiClient(
      context,
      (await signIn(context, verifier.email, verifier.password, verifier.totpSecret)).accessToken,
    );

    const mdaOfficer = await createUser(context, adminToken, {
      email: 'desk@x.gov.ng',
      fullName: 'Desk Three',
      agencyId: revenue.id,
      roles: ['REVENUE_OFFICER'],
      clearance: 'CONFIDENTIAL',
    });
    mdaClient = new ApiClient(
      context,
      (await signIn(context, mdaOfficer.email, mdaOfficer.password, mdaOfficer.totpSecret))
        .accessToken,
    );

    for (const [given, family, dob, phone] of [
      ['Amina', 'Dung', '1994-06-12', '08030000001'],
      ['Bitrus', 'Gyang', '1988-02-03', '08030000002'],
    ] as const) {
      const created = await registrarClient
        .post('/api/v1/citizens', {
          givenName: given,
          familyName: family,
          sex: given === 'Amina' ? 'FEMALE' : 'MALE',
          dateOfBirth: dob,
          phonePrimary: phone,
          email: `${given.toLowerCase()}@example.ng`,
          residentialAddress: '12 Rwang Pam Street, Jos',
          lgaCode: 'PL-JNO',
          wardCode: 'PL-JNO-01',
          channel: 'REGISTRATION_DESK',
        })
        .expect(201);
      const issued = (created.body as { pcid: string }).pcid;
      if (given === 'Amina') pcid = issued;
      else otherPcid = issued;
    }
  });

  after(async () => {
    await context?.close();
  });

  test('portal credentials are issued in person, not self-served', async () => {
    // There is no public sign-up route at all: an open one would let anyone who
    // knows a PCID claim the record.
    const { registeredRoutes } = await import('../../src/common/openapi/registry');
    const publicRoutes = registeredRoutes().filter((route) => route.public === true);
    for (const route of publicRoutes) {
      assert.ok(
        route.path.startsWith('/api/v1/auth/') || route.path.startsWith('/api/v1/health/'),
        `unexpected public route ${route.method.toUpperCase()} ${route.path}`,
      );
    }

    const issued = await registrarClient
      .post(`/api/v1/citizens/${pcid}/portal-account`)
      .expect(201);
    temporaryPassword = (issued.body as { temporaryPassword: string }).temporaryPassword;

    // Issuing twice is refused rather than quietly resetting somebody's account.
    await registrarClient.post(`/api/v1/citizens/${pcid}/portal-account`).expect(409);

    const otherIssued = await registrarClient
      .post(`/api/v1/citizens/${otherPcid}/portal-account`)
      .expect(201);
    const otherLogin = await new ApiClient(context)
      .post('/api/v1/auth/citizen/login', {
        identifier: otherPcid,
        password: (otherIssued.body as { temporaryPassword: string }).temporaryPassword,
      })
      .expect(201);
    otherCitizen = new ApiClient(context, (otherLogin.body as { accessToken: string }).accessToken);
  });

  test('a resident signs in and is told to change the issued passphrase', async () => {
    const login = await new ApiClient(context)
      .post('/api/v1/auth/citizen/login', { identifier: pcid, password: temporaryPassword })
      .expect(201);
    const body = login.body as { accessToken: string; mustChangePassword: boolean };
    assert.equal(body.mustChangePassword, true, 'the portal must prompt for a new passphrase');
    citizen = new ApiClient(context, body.accessToken);
  });

  test('changing the passphrase enforces the policy and ends every other session', async () => {
    // A second session, which the change should end.
    const second = await new ApiClient(context)
      .post('/api/v1/auth/citizen/login', { identifier: pcid, password: temporaryPassword })
      .expect(201);
    const secondClient = new ApiClient(
      context,
      (second.body as { accessToken: string }).accessToken,
    );
    await secondClient.get('/api/v1/me/record').expect(200);

    // The current passphrase must be right.
    await citizen
      .post('/api/v1/me/password', {
        currentPassword: 'not-the-current-one',
        newPassword: 'Zq7Tb2Lx8QwMk94',
      })
      .expect(401);

    // And the new one must meet the policy, including not containing the PCID.
    const weak = await citizen
      .post('/api/v1/me/password', {
        currentPassword: temporaryPassword,
        newPassword: 'password123456',
      })
      .expect(400);
    assert.equal((weak.body as { error: { code: string } }).error.code, 'VALIDATION_FAILED');

    const changed = await citizen
      .post('/api/v1/me/password', {
        currentPassword: temporaryPassword,
        newPassword: 'Zq7Tb2Lx8QwMk94',
      })
      .expect(201);
    assert.ok((changed.body as { otherSessionsEnded: number }).otherSessionsEnded >= 1);

    // The other session is gone; this one continues.
    await secondClient.get('/api/v1/me/record').expect(401);
    await citizen.get('/api/v1/me/record').expect(200);

    const again = await new ApiClient(context)
      .post('/api/v1/auth/citizen/login', { identifier: pcid, password: 'Zq7Tb2Lx8QwMk94' })
      .expect(201);
    assert.equal((again.body as { mustChangePassword: boolean }).mustChangePassword, false);
    citizen = new ApiClient(context, (again.body as { accessToken: string }).accessToken);
  });

  test('the digital credential carries an opaque, short-lived code and nothing else', async () => {
    const response = await citizen.get('/api/v1/me/credential').expect(200);
    const credential = response.body as {
      serial: string;
      status: string;
      usable: boolean;
      verificationUrl: string;
      verificationTokenExpiresAt: string;
    };

    assert.match(credential.serial, /^PLC-\d{4}-[0-9A-HJKMNP-TV-Z]{8}$/);
    assert.equal(credential.status, 'ACTIVE');
    assert.equal(credential.usable, true);

    // §39, §40: the QR discloses nothing by itself.
    const token = credential.verificationUrl.split('/').pop() as string;
    assert.ok(token.length >= 32);
    for (const secret of [pcid, 'Amina', 'Dung', '1994', '08030000001', 'FEMALE']) {
      assert.equal(
        credential.verificationUrl.includes(secret),
        false,
        `the verification URL must not contain ${secret}`,
      );
    }

    // The displayed code is short lived, so a photograph of someone else's screen
    // stops working.
    const ttlMs = new Date(credential.verificationTokenExpiresAt).getTime() - Date.now();
    assert.ok(ttlMs > 0 && ttlMs <= 15 * 60 * 1000, `token TTL was ${ttlMs}ms`);

    // Each view mints a fresh code.
    const again = await citizen.get('/api/v1/me/credential').expect(200);
    assert.notEqual(
      (again.body as { verificationUrl: string }).verificationUrl,
      credential.verificationUrl,
    );
  });

  test('an officer can verify a scanned code; an anonymous scan cannot', async () => {
    const credential = await citizen.get('/api/v1/me/credential').expect(200);
    const token = (credential.body as { verificationUrl: string }).verificationUrl
      .split('/')
      .pop() as string;

    // The token alone authorises nothing.
    await new ApiClient(context).post('/api/v1/verification/credential', { token }).expect(401);

    const verified = await verifierClient
      .post('/api/v1/verification/credential', { token })
      .expect(201);
    const body = verified.body as { valid: boolean; displayName: string; pcid: string | null };
    assert.equal(body.valid, true);
    assert.equal(body.displayName, 'Amina Dung');

    // An unrecognised code is refused without revealing anything.
    const unknown = await verifierClient
      .post('/api/v1/verification/credential', { token: 'a'.repeat(43) })
      .expect(201);
    assert.equal((unknown.body as { valid: boolean }).valid, false);
    assert.equal((unknown.body as { displayName: string | null }).displayName, null);

    // The verification appears in the resident's own history, naming the office
    // rather than quoting its internal code at them (§26).
    const history = await citizen.get('/api/v1/me/verification-history').expect(200);
    const entries = (history.body as { verifications: { agency: string; method: string }[] })
      .verifications;
    assert.ok(
      entries.some(
        (entry) => entry.agency === 'Internal Revenue Service' && entry.method === 'CREDENTIAL_QR',
      ),
    );
    assert.ok(!entries.some((entry) => entry.agency === 'PLT-REVENUE'));
  });

  test('reporting a credential lost revokes it and every code issued against it', async () => {
    const credential = await citizen.get('/api/v1/me/credential').expect(200);
    const token = (credential.body as { verificationUrl: string }).verificationUrl
      .split('/')
      .pop() as string;
    await verifierClient.post('/api/v1/verification/credential', { token }).expect(201);

    await citizen
      .post('/api/v1/me/credential/report-lost', {
        reason: 'My card was taken from my bag at the market.',
      })
      .expect(201);

    const afterRevocation = await verifierClient
      .post('/api/v1/verification/credential', { token })
      .expect(201);
    assert.equal((afterRevocation.body as { valid: boolean }).valid, false);

    // The identity behind it is untouched: a new credential is issued on next view.
    const replacement = await citizen.get('/api/v1/me/credential').expect(200);
    const replacementBody = replacement.body as { serial: string; status: string };
    assert.equal(replacementBody.status, 'ACTIVE');
    assert.notEqual(replacementBody.serial, (credential.body as { serial: string }).serial);

    // And the PCID itself still verifies, because a credential is not an identity.
    const byPcid = await verifierClient.post('/api/v1/verification/pcid', { pcid }).expect(201);
    assert.equal((byPcid.body as { valid: boolean }).valid, true);
  });

  test('emergency contacts can be added, corrected and removed, and authorship is recorded', async () => {
    const created = await citizen
      .post('/api/v1/me/emergency-contacts', {
        fullName: 'Danjuma Dung',
        relationship: 'Brother',
        phonePrimary: '08030000009',
        priority: 1,
      })
      .expect(201);
    const contactId = (created.body as { id: string }).id;

    const listed = await citizen.get('/api/v1/me/emergency-contacts').expect(200);
    const contacts = listed.body as {
      id: string;
      lastChangedBy: string;
      verificationStatus: string;
    }[];
    assert.equal(contacts.length, 1);
    assert.equal(contacts[0]?.lastChangedBy, 'CITIZEN');

    await citizen
      .patch(`/api/v1/me/emergency-contacts/${contactId}`, {
        fullName: 'Danjuma Dung',
        relationship: 'Brother',
        phonePrimary: '08030000010',
        priority: 1,
      })
      .expect(200);

    const afterUpdate = await citizen.get('/api/v1/me/emergency-contacts').expect(200);
    const updated = (afterUpdate.body as { phonePrimary: string; verificationStatus: string }[])[0];
    assert.equal(updated?.phonePrimary, '08030000010');
    assert.equal(
      updated?.verificationStatus,
      'UNVERIFIED',
      'a changed number is no longer a verified one',
    );

    // Another resident cannot touch it.
    await otherCitizen
      .patch(`/api/v1/me/emergency-contacts/${contactId}`, {
        fullName: 'Someone Else',
        relationship: 'Friend',
        phonePrimary: '08030000011',
        priority: 1,
      })
      .expect(200)
      .expect((response) => assert.equal((response.body as { updated: boolean }).updated, false));

    await citizen.delete(`/api/v1/me/emergency-contacts/${contactId}`).expect(200);
    const afterDelete = await citizen.get('/api/v1/me/emergency-contacts').expect(200);
    assert.deepEqual(afterDelete.body, []);
  });

  test('a resident can add an authenticator, and an interrupted enrolment changes nothing', async () => {
    const begun = await citizen.post('/api/v1/me/mfa/enrol').expect(201);
    const enrolment = begun.body as {
      secret: string;
      provisioningUri: string;
      recoveryCodes: string[];
    };
    assert.ok(enrolment.provisioningUri.startsWith('otpauth://totp/'));
    assert.equal(enrolment.recoveryCodes.length, 10);

    // Not in force until confirmed.
    const me = await citizen.get('/api/v1/auth/me').expect(200);
    assert.equal((me.body as { mfaEnrolled: boolean }).mfaEnrolled, false);

    await citizen.post('/api/v1/me/mfa/confirm', { code: '000000' }).expect(401);
    await citizen
      .post('/api/v1/me/mfa/confirm', { code: await totpCode(enrolment.secret) })
      .expect(201);

    const confirmed = await citizen.get('/api/v1/auth/me').expect(200);
    assert.equal((confirmed.body as { mfaEnrolled: boolean }).mfaEnrolled, true);
    await citizen.post('/api/v1/me/mfa/enrol').expect(409);
  });

  test('a resident can see where they are signed in and end a session they do not recognise', async () => {
    const extra = await new ApiClient(context)
      .post('/api/v1/auth/citizen/login', { identifier: pcid, password: 'Zq7Tb2Lx8QwMk94' })
      .set('user-agent', 'Mozilla/5.0 (Linux; Android 14) Chrome/120')
      .expect(201);
    const extraClient = new ApiClient(context, (extra.body as { accessToken: string }).accessToken);

    const sessions = await citizen.get('/api/v1/me/sessions').expect(200);
    const list = sessions.body as { id: string; current: boolean; device: string }[];
    assert.ok(list.length >= 2);
    assert.equal(list.filter((entry) => entry.current).length, 1);
    assert.ok(list.some((entry) => entry.device.includes('Android')));

    const target = list.find((entry) => !entry.current);
    await citizen.delete(`/api/v1/me/sessions/${target?.id}`).expect(200);
    await extraClient.get('/api/v1/me/record').expect(401);
    await citizen.get('/api/v1/me/record').expect(200);

    // One resident cannot end another's session.
    const victimSessions = await otherCitizen.get('/api/v1/me/sessions').expect(200);
    const victim = (victimSessions.body as { id: string }[])[0];
    const attempt = await citizen.delete(`/api/v1/me/sessions/${victim?.id}`).expect(200);
    assert.equal((attempt.body as { ended: boolean }).ended, false);
    await otherCitizen.get('/api/v1/me/record').expect(200);
  });

  test('a resident can raise an emergency, and location is shared only if they choose', async () => {
    const withoutLocation = await citizen
      .post('/api/v1/me/emergency', {
        type: 'MEDICAL_EMERGENCY',
        description: 'My father has collapsed at home and is not responding.',
      })
      .expect(201);
    const first = withoutLocation.body as { incidentNumber: string; message: string };
    assert.match(first.incidentNumber, /^INC-\d{4}-\d{6}$/);

    const withLocation = await citizen
      .post('/api/v1/me/emergency', {
        type: 'ROAD_ACCIDENT',
        description: 'A car has hit a motorcycle at the junction and someone is hurt.',
        latitude: 9.8965,
        longitude: 8.8583,
      })
      .expect(201);
    const second = (withLocation.body as { incidentNumber: string }).incidentNumber;

    const { Database } = await import('../../src/database/pool');
    const db = context.app.get(Database);
    const rows = await db.query<{
      incident_number: string;
      location_source: string;
      latitude: string | null;
      location_retention_until: Date | null;
      reporter_citizen_pcid: string | null;
    }>(
      `SELECT incident_number, location_source, latitude, location_retention_until, reporter_citizen_pcid
         FROM incident WHERE incident_number = ANY($1::text[])`,
      [[first.incidentNumber, second]],
    );

    const withheld = rows.find((row) => row.incident_number === first.incidentNumber);
    assert.equal(withheld?.latitude, null, 'no coordinates are invented when none were shared');
    assert.equal(withheld?.location_source, 'REGISTERED_ADDRESS');

    const shared = rows.find((row) => row.incident_number === second);
    assert.ok(shared?.latitude);
    assert.equal(
      shared?.location_source,
      'CALLER_SUPPLIED',
      'provenance always travels with a coordinate',
    );
    assert.ok(
      shared?.location_retention_until,
      'emergency location carries a retention date (§16, §69)',
    );
    assert.equal(shared?.reporter_citizen_pcid, pcid);
  });

  test('a resident can report identity fraud and an access they do not recognise', async () => {
    // Generate an access to challenge.
    await mdaClient.get(`/api/v1/citizens/${pcid}?purpose=REVENUE_ADMINISTRATION`).expect(200);
    const history = await citizen.get('/api/v1/me/access-history').expect(200);
    const accesses = (history.body as { accesses: { reference: string }[] }).accesses;
    assert.ok(accesses.length > 0);

    const fraud = await citizen
      .post('/api/v1/me/reports/identity-fraud', {
        description:
          'Someone used my name and date of birth to collect a benefit I never applied for.',
      })
      .expect(201);
    assert.match((fraud.body as { reference: string }).reference, /^ALERT-\d{4}-\d{5}$/);

    const unauthorised = await citizen
      .post('/api/v1/me/reports/unauthorised-access', {
        description: 'I do not recognise this access and I have had no dealings with that office.',
        accessReference: accesses[0]?.reference,
      })
      .expect(201);
    const reference = (unauthorised.body as { reference: string; message: string }).reference;
    assert.ok((unauthorised.body as { message: string }).message.includes('cannot be altered'));

    const { Database } = await import('../../src/database/pool');
    const db = context.app.get(Database);
    const alert = await db.queryOne<{
      title: string;
      rule_key: string;
      subject_pcid: string;
      explanation: { referencedAuditEventId: string | null; note: string };
    }>('SELECT title, rule_key, subject_pcid, explanation FROM alert WHERE reference = $1', [
      reference,
    ]);

    assert.equal(alert?.rule_key, 'CITIZEN_REPORTED_UNAUTHORISED_ACCESS');
    assert.equal(alert?.subject_pcid, pcid);
    // §31, §65: an alert describes an event, not a person.
    assert.ok(alert?.explanation.note.includes('not a finding about anyone'));
    assert.ok(
      alert?.explanation.referencedAuditEventId,
      'the quoted access is attached for the reviewer',
    );
  });

  test('notifications are per resident and cannot be read across accounts', async () => {
    const { Database } = await import('../../src/database/pool');
    const db = context.app.get(Database);
    await db.query(
      `INSERT INTO notification (channel, recipient_type, recipient_id, subject, body, classification)
       VALUES ('IN_APP', 'CITIZEN', $1, 'Your correction request was approved',
               'The address on your record has been updated.', 'INTERNAL')`,
      [pcid],
    );

    const inbox = await citizen.get('/api/v1/me/notifications').expect(200);
    const body = inbox.body as {
      total: number;
      unread: number;
      notifications: { id: string; read: boolean }[];
    };
    assert.equal(body.total, 1);
    assert.equal(body.unread, 1);

    const otherInbox = await otherCitizen.get('/api/v1/me/notifications').expect(200);
    assert.equal((otherInbox.body as { total: number }).total, 0);

    const notificationId = body.notifications[0]?.id as string;
    const crossAccount = await otherCitizen
      .post(`/api/v1/me/notifications/${notificationId}/read`)
      .expect(201);
    assert.equal((crossAccount.body as { read: boolean }).read, false);

    await citizen.post(`/api/v1/me/notifications/${notificationId}/read`).expect(201);
    const afterRead = await citizen.get('/api/v1/me/notifications').expect(200);
    assert.equal((afterRead.body as { unread: number }).unread, 0);
  });

  test('a government officer cannot use the citizen portal routes', async () => {
    for (const path of ['/api/v1/me/record', '/api/v1/me/credential', '/api/v1/me/sessions']) {
      const response = await mdaClient.get(path);
      assert.ok([403, 404].includes(response.status), `${path} answered ${response.status}`);
    }
    await mdaClient
      .post('/api/v1/me/emergency', { type: 'MEDICAL_EMERGENCY', description: 'Not a resident.' })
      .expect(403);
  });

  test('everything the resident did is in the audit trail, and the chain still verifies', async () => {
    const auditor = await createUser(context, adminToken, {
      email: 'dpo@x.gov.ng',
      fullName: 'Protection Four',
      agencyId: (await new ApiClient(context, adminToken).get('/api/v1/agencies').expect(200))
        .body[0].id,
      roles: ['DATA_PROTECTION_OFFICER'],
      clearance: 'HIGHLY_RESTRICTED',
    });
    const auditorClient = new ApiClient(
      context,
      (await signIn(context, auditor.email, auditor.password, auditor.totpSecret)).accessToken,
    );

    // Filtered by action rather than paged: the resident has generated enough
    // activity that the issuance would otherwise fall outside the first page.
    const events = await auditorClient
      .get(`/api/v1/audit/events?subjectPcid=${pcid}&action=UPDATE_CITIZEN&limit=100`)
      .expect(200);
    const detail = (
      events.body as { events: { action: string; detail: Record<string, unknown> }[] }
    ).events;
    const changes = detail
      .map((event) => event.detail?.change)
      .filter((change): change is string => typeof change === 'string');

    for (const expected of [
      'PORTAL_CREDENTIALS_ISSUED',
      'PASSWORD_CHANGED',
      'MFA_CONFIRMED',
      'CREDENTIAL_REVOKED',
      'EMERGENCY_CONTACT_ADDED',
      'EMERGENCY_CONTACT_UPDATED',
      'EMERGENCY_CONTACT_REMOVED',
    ]) {
      assert.ok(changes.includes(expected), `the audit trail must record ${expected}`);
    }

    const verification = await auditorClient.get('/api/v1/audit/verify').expect(200);
    assert.equal((verification.body as { intact: boolean }).intact, true);
  });
});
