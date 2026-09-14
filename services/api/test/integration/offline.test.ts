import { strict as assert } from 'node:assert';
import { after, before, describe, test } from 'node:test';

import { ApiClient, bootstrapAdmin, createAgency, createUser, signIn } from './harness';
import type { TestContext } from './harness';
import { createTestContext } from './harness';

/**
 * The controlled offline mode (master system prompt §56).
 *
 * §56 asks for six properties, and the reason they are tested together is that
 * any five of them without the sixth is a data breach waiting for a lost phone:
 * encrypted, expiring, device-bound, minimal, revocable, and never a copy of the
 * registry. The encryption happens in the browser and is exercised in the portal
 * suites; the other five are decided here, in the platform, and are what this
 * file holds.
 *
 * The shape of the argument: a bundle is not a new read. Every profile in one is
 * produced by the ordinary emergency-profile path, so what the tests check is
 * that the *same* refusals apply - not attached, not live, not registered - and
 * that permission to *keep* a release is asked separately from permission to
 * make it.
 */
describe('§56 controlled offline mode', () => {
  let context: TestContext;
  let adminToken: string;
  let dispatcher: ApiClient;
  let responder: ApiClient;
  let outsideResponder: ApiClient;
  let registrar: ApiClient;
  let citizen: ApiClient;

  let responderUserId: string;
  let incidentNumber: string;
  let pcid: string;
  let responderDeviceToken: string;
  let responderDeviceId: string;
  let responderPassword: string;
  let responderTotpSecret: string;

  before(async () => {
    context = await createTestContext('offline');
    const bootstrap = await bootstrapAdmin(context);
    adminToken = (await signIn(context, bootstrap.email, bootstrap.password, bootstrap.totpSecret))
      .accessToken;

    const ems = await createAgency(context, adminToken, {
      code: 'PLT-EMS',
      name: 'Plateau State Emergency Management Agency',
      category: 'EMERGENCY',
      maxClassification: 'HIGHLY_RESTRICTED',
    });
    const fireService = await createAgency(context, adminToken, {
      code: 'PLT-FIRE',
      name: 'Plateau State Fire Service',
      category: 'EMERGENCY',
      maxClassification: 'HIGHLY_RESTRICTED',
    });
    const registry = await createAgency(context, adminToken, {
      code: 'PLT-REGISTRY',
      name: 'Citizen Registry',
      category: 'MDA',
      maxClassification: 'HIGHLY_RESTRICTED',
    });

    const dispatcherUser = await createUser(context, adminToken, {
      email: 'control@offline.test',
      fullName: 'Emergency Control',
      agencyId: ems.id,
      roles: ['DISPATCHER', 'INCIDENT_OFFICER'],
      clearance: 'HIGHLY_RESTRICTED',
    });
    const responderUser = await createUser(context, adminToken, {
      email: 'crew@offline.test',
      fullName: 'Ambulance Crew',
      agencyId: ems.id,
      roles: ['EMERGENCY_RESPONDER'],
      // High enough to exercise a real release: blood group and disclosed
      // conditions are the fields that make an offline pack worth having.
      clearance: 'HIGHLY_RESTRICTED',
    });
    responderUserId = responderUser.id;
    responderPassword = responderUser.password;
    responderTotpSecret = responderUser.totpSecret;
    const outsideUser = await createUser(context, adminToken, {
      email: 'firecrew@offline.test',
      fullName: 'Fire Crew',
      agencyId: fireService.id,
      roles: ['EMERGENCY_RESPONDER'],
      clearance: 'HIGHLY_RESTRICTED',
    });
    const registrarUser = await createUser(context, adminToken, {
      email: 'registrar@offline.test',
      fullName: 'Registration Desk',
      agencyId: registry.id,
      roles: ['REGISTRATION_OFFICER'],
      clearance: 'HIGHLY_RESTRICTED',
    });

    const session = async (user: { email: string; password: string; totpSecret: string }) =>
      new ApiClient(
        context,
        (await signIn(context, user.email, user.password, user.totpSecret)).accessToken,
      );
    dispatcher = await session(dispatcherUser);
    responder = await session(responderUser);
    outsideResponder = await session(outsideUser);
    registrar = await session(registrarUser);

    const registered = await registrar
      .post('/api/v1/citizens', {
        givenName: 'Ngozi',
        familyName: 'Bala',
        sex: 'FEMALE',
        dateOfBirth: '1988-11-03',
        phonePrimary: '08034440002',
        residentialAddress: '14 Rukuba Road, Jos',
        lgaCode: 'PL-JNO',
        wardCode: 'PL-JNO-01',
        channel: 'REGISTRATION_DESK',
      })
      .expect(201);
    pcid = (registered.body as { pcid: string }).pcid;

    const portalAccount = await registrar
      .post(`/api/v1/citizens/${pcid}/portal-account`)
      .expect(201);
    const issued = portalAccount.body as { pcid: string; temporaryPassword: string };
    const login = await new ApiClient(context)
      .post('/api/v1/auth/citizen/login', {
        identifier: issued.pcid,
        password: issued.temporaryPassword,
      })
      .expect(201);
    citizen = new ApiClient(context, (login.body as { accessToken: string }).accessToken);

    const incident = await dispatcher
      .post('/api/v1/incidents', {
        type: 'ROAD_ACCIDENT',
        severity: 'CRITICAL',
        description: 'Multi-vehicle collision on the Zaria Road.',
        addressText: 'Zaria Road, Jos',
        lgaCode: 'PL-JNO',
      })
      .expect(201);
    incidentNumber = (incident.body as { incidentNumber: string }).incidentNumber;

    await dispatcher
      .post(`/api/v1/incidents/${incidentNumber}/officers`, {
        userId: responderUserId,
        role: 'RESPONDER',
      })
      .expect(201);
    await dispatcher
      .post(`/api/v1/incidents/${incidentNumber}/persons`, {
        citizenPcid: pcid,
        role: 'CASUALTY',
      })
      .expect(201);
  });

  after(async () => {
    await context.close();
  });

  test('nothing goes offline from a device that was never registered', async () => {
    const refused = await responder
      .get(`/api/v1/incidents/${incidentNumber}/offline-bundle`)
      .expect(400);
    const error = (refused.body as { error: { code: string; message: string } }).error;
    assert.equal(error.code, 'VALIDATION_FAILED');
    assert.match(error.message, /registered device/i);

    // Nor from a device secret that belongs to nobody.
    await responder
      .get(`/api/v1/incidents/${incidentNumber}/offline-bundle`)
      .set('x-device-token', 'not-a-registered-device')
      .expect(404);
  });

  test('a device is registered once and returns its secret once', async () => {
    const created = await responder
      .post('/api/v1/me/devices', { label: 'Ambulance tablet', platform: 'ANDROID' })
      .expect(201);
    const device = created.body as { deviceId: string; deviceToken: string; label: string };
    assert.equal(device.label, 'Ambulance tablet');
    assert.ok(device.deviceToken.length >= 32);
    responderDeviceToken = device.deviceToken;
    responderDeviceId = device.deviceId;

    const listed = await responder
      .get('/api/v1/me/devices')
      .set('x-device-token', responderDeviceToken)
      .expect(200);
    const devices = (listed.body as { devices: { id: string; current: boolean }[] }).devices;
    assert.equal(devices.length, 1);
    assert.equal(devices[0]?.id, responderDeviceId);
    assert.equal(devices[0]?.current, true, 'the device in use identifies itself in the list');

    // The secret is never handed back. A listing that returned it would make
    // every subsequent read of the list as sensitive as the registration.
    assert.equal(JSON.stringify(listed.body).includes(responderDeviceToken), false);
  });

  test('a responder attached to a live incident may take its people offline', async () => {
    const bundle = await responder
      .get(`/api/v1/incidents/${incidentNumber}/offline-bundle`)
      .set('x-device-token', responderDeviceToken)
      .expect(200);
    const body = bundle.body as {
      kind: string;
      deviceId: string;
      expiresAt: string;
      releaseId: string;
      records: { subject: string; data: Record<string, unknown>; restrictedFields: string[] }[];
    };

    assert.equal(body.kind, 'INCIDENT_PROFILES');
    assert.equal(body.deviceId, responderDeviceId);
    assert.equal(body.records.length, 1, 'exactly the people attached to the incident');
    assert.equal(body.records[0]?.subject, pcid);

    // It expires, and within the four hours §56 allows for a job.
    const lifetime = Date.parse(body.expiresAt) - Date.now();
    assert.ok(lifetime > 0 && lifetime <= 4 * 60 * 60 * 1000, `lifetime ${lifetime}ms`);

    // What it carries is the emergency profile, not the record: the fields the
    // catalogue releases under EMERGENCY_RESPONSE and no others. The withheld
    // ones travel with it, so a crew reading it offline can tell "not recorded"
    // from "not released to you".
    const data = body.records[0]?.data ?? {};
    assert.equal(typeof data.displayName, 'string');
    assert.ok('approximateAge' in data, 'an approximate age, never the date of birth');
    assert.ok(Array.isArray(body.records[0]?.restrictedFields));
    for (const never of ['nin', 'dateOfBirth', 'registeredAddress', 'phonePrimary']) {
      assert.equal(never in data, false, `${never} is never part of an emergency release`);
    }
  });

  test('every person in a bundle is audited as a read of that person', async () => {
    const auditor = await createUser(context, adminToken, {
      email: 'dpo@offline.test',
      fullName: 'Data Protection Office',
      agencyId: (
        await createAgency(context, adminToken, {
          code: 'PLT-DPO',
          name: 'Data Protection Office',
          category: 'MDA',
          maxClassification: 'HIGHLY_RESTRICTED',
        })
      ).id,
      roles: ['DATA_PROTECTION_OFFICER', 'AUDITOR'],
      clearance: 'HIGHLY_RESTRICTED',
    });
    const auditorClient = new ApiClient(
      context,
      (await signIn(context, auditor.email, auditor.password, auditor.totpSecret)).accessToken,
    );

    const events = await auditorClient
      .get(`/api/v1/audit/events?subjectPcid=${pcid}&limit=100`)
      .expect(200);
    const actions = (events.body as { events: { action: string; outcome: string }[] }).events.map(
      (event) => event.action,
    );
    // The release of the profile, and the separate decision to let it leave.
    assert.ok(
      actions.includes('EMERGENCY_PROFILE_VIEW'),
      'a bundled profile is audited as the read it is',
    );
    assert.ok(actions.includes('OFFLINE_ACCESS'), 'keeping it is audited as its own decision');
  });

  test('a responder attached to nothing is refused, and learns nothing about who is', async () => {
    const created = await outsideResponder
      .post('/api/v1/me/devices', { label: 'Fire appliance tablet', platform: 'ANDROID' })
      .expect(201);
    const token = (created.body as { deviceToken: string }).deviceToken;

    // The opaque answer, deliberately: naming "you are not assigned to it" would
    // confirm to an outsider that the incident exists and who is on it. This is
    // the same refusal the emergency profile itself gives, which is the point -
    // taking something offline is refused exactly where reading it is.
    const refused = await outsideResponder
      .get(`/api/v1/incidents/${incidentNumber}/offline-bundle`)
      .set('x-device-token', token)
      .expect(404);
    assert.equal(JSON.stringify(refused.body).includes(pcid), false);
  });

  test('a device may ask whether it may still hold what it holds', async () => {
    const bundle = await responder
      .get(`/api/v1/incidents/${incidentNumber}/offline-bundle`)
      .set('x-device-token', responderDeviceToken)
      .expect(200);
    const releaseId = (bundle.body as { releaseId: string }).releaseId;

    const standing = await responder
      .get(`/api/v1/me/offline-releases/${releaseId}`)
      .set('x-device-token', responderDeviceToken)
      .expect(200);
    assert.equal((standing.body as { valid: boolean }).valid, true);

    // A release this device never held answers the same way an expired one does:
    // stop holding it. A client that cannot tell the two apart still behaves.
    const unknown = await responder
      .get('/api/v1/me/offline-releases/00000000-0000-4000-8000-000000000000')
      .set('x-device-token', responderDeviceToken)
      .expect(200);
    assert.equal((unknown.body as { valid: boolean }).valid, false);
  });

  test('a closed incident authorises no bundle, though its record stays readable', async () => {
    const closing = await dispatcher
      .post('/api/v1/incidents', {
        type: 'FIRE',
        severity: 'MEDIUM',
        description: 'Bin fire, since dealt with.',
        lgaCode: 'PL-JNO',
      })
      .expect(201);
    const reference = (closing.body as { incidentNumber: string }).incidentNumber;
    await dispatcher
      .post(`/api/v1/incidents/${reference}/officers`, {
        userId: responderUserId,
        role: 'RESPONDER',
      })
      .expect(201);
    await dispatcher
      .patch(`/api/v1/incidents/${reference}/status`, { status: 'RESOLVED' })
      .expect(200);
    await dispatcher
      .patch(`/api/v1/incidents/${reference}/status`, {
        status: 'CLOSED',
        resolution: 'Extinguished.',
      })
      .expect(200);

    // Reading back a job that is over is allowed - a crew debriefs, and answers
    // complaints about it. Carrying its casualties' medical details away from it
    // is not, and that is the distinction the binding gate draws.
    await responder.get(`/api/v1/incidents/${reference}`).expect(200);
    const refused = await responder
      .get(`/api/v1/incidents/${reference}/offline-bundle`)
      .set('x-device-token', responderDeviceToken)
      .expect(403);
    assert.match(
      (refused.body as { error: { message: string } }).error.message,
      /closed|authorises no further access/i,
    );
  });

  test('signing a device out invalidates what it was holding', async () => {
    const bundle = await responder
      .get(`/api/v1/incidents/${incidentNumber}/offline-bundle`)
      .set('x-device-token', responderDeviceToken)
      .expect(200);
    const releaseId = (bundle.body as { releaseId: string }).releaseId;

    await responder
      .delete(`/api/v1/me/devices/${responderDeviceId}`)
      .set('x-device-token', responderDeviceToken)
      .send({ reason: 'LOST_OR_STOLEN' })
      .expect(200);

    // Signing the device out signs out the sessions opened on it, which is the
    // whole point of reporting a phone lost: one act, not two that can be done
    // by halves. The crew's browser is now unauthenticated.
    await responder
      .get(`/api/v1/me/offline-releases/${releaseId}`)
      .set('x-device-token', responderDeviceToken)
      .expect(401);

    // Signed in again on another device, the release the lost one held is over.
    const fresh = new ApiClient(
      context,
      (await signIn(context, 'crew@offline.test', responderPassword, responderTotpSecret))
        .accessToken,
    );
    const replacement = await fresh
      .post('/api/v1/me/devices', { label: 'Replacement tablet', platform: 'ANDROID' })
      .expect(201);
    const replacementToken = (replacement.body as { deviceToken: string }).deviceToken;

    const standing = await fresh
      .get(`/api/v1/me/offline-releases/${releaseId}`)
      .set('x-device-token', replacementToken)
      .expect(200);
    const body = standing.body as { valid: boolean };
    assert.equal(body.valid, false, 'a release belongs to the device it was made to');

    // And the lost device cannot be revoked twice, which is what stops a replay
    // looking like a second successful revocation in the audit trail.
    await fresh
      .delete(`/api/v1/me/devices/${responderDeviceId}`)
      .set('x-device-token', replacementToken)
      .send({ reason: 'USER_REQUEST' })
      .expect(404);

    responder = fresh;
    responderDeviceToken = replacementToken;
  });

  test('a resident carries their identifier and nothing else', async () => {
    const created = await citizen
      .post('/api/v1/me/devices', { label: 'My phone', platform: 'ANDROID' })
      .expect(201);
    const token = (created.body as { deviceToken: string }).deviceToken;

    const card = await citizen
      .get('/api/v1/me/offline-card')
      .set('x-device-token', token)
      .expect(200);
    const body = card.body as {
      kind: string;
      expiresAt: string;
      records: { data: Record<string, unknown> }[];
    };
    assert.equal(body.kind, 'CITIZEN_CARD');
    assert.equal(body.records.length, 1);

    // Two fields. Not the address, not the emergency contacts, not the date of
    // birth - those are read in the portal, online, where the access is decided
    // and logged.
    const fields = Object.keys(body.records[0]?.data ?? {}).sort();
    assert.deepEqual(fields, ['displayName', 'pcid']);
    assert.equal(body.records[0]?.data.pcid, pcid);

    const lifetime = Date.parse(body.expiresAt) - Date.now();
    assert.ok(lifetime > 0 && lifetime <= 24 * 60 * 60 * 1000, `lifetime ${lifetime}ms`);
  });

  test('a resident cannot ask for somebody else’s incident pack', async () => {
    const created = await citizen
      .post('/api/v1/me/devices', { label: 'Another phone', platform: 'IOS' })
      .expect(201);
    const token = (created.body as { deviceToken: string }).deviceToken;
    // Refused before anybody on the incident is named. A resident may assert an
    // emergency purpose to *report* an emergency and for nothing else, so the
    // gates that bind a responder to an incident are never reached.
    const refused = await citizen
      .get(`/api/v1/incidents/${incidentNumber}/offline-bundle`)
      .set('x-device-token', token)
      .expect(404);
    assert.equal(JSON.stringify(refused.body).includes(pcid), false);
  });

  test('one account cannot revoke another account’s device', async () => {
    const mine = await outsideResponder
      .post('/api/v1/me/devices', { label: 'Mine', platform: 'ANDROID' })
      .expect(201);
    const myDeviceId = (mine.body as { deviceId: string }).deviceId;

    await dispatcher
      .delete(`/api/v1/me/devices/${myDeviceId}`)
      .send({ reason: 'ADMINISTRATIVE' })
      .expect(404);
  });
});
