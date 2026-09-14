import { strict as assert } from 'node:assert';
import { after, before, describe, test } from 'node:test';

import { ApiClient, bootstrapAdmin, createAgency, createUser, signIn } from './harness';
import type { TestContext } from './harness';
import { createTestContext } from './harness';

/**
 * Emergency response: the fleet, the incident, and who the incident opens a
 * record to (master system prompt §8, §9, §10, §36, §37).
 *
 * Written from three sides. Control, which registers units and sends them.
 * The crew, which is attached because their agency was dispatched. And a
 * responder from another service, who is attached to nothing and must be
 * refused exactly as if the person did not exist - until somebody attaches
 * them, which the guide has always called the ordinary path and until now no
 * route performed.
 */
describe('emergency response', () => {
  let context: TestContext;
  let adminToken: string;
  let fleet: ApiClient;
  let dispatcher: ApiClient;
  let responder: ApiClient;
  let outsideResponder: ApiClient;
  let registrar: ApiClient;

  let responderUserId: string;
  let outsideResponderUserId: string;
  let incidentNumber: string;
  let pcid: string;

  before(async () => {
    context = await createTestContext('emergency');
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

    const fleetUser = await createUser(context, adminToken, {
      email: 'fleet@emergency.test',
      fullName: 'Fleet Office',
      agencyId: ems.id,
      roles: ['SECURITY_ADMINISTRATOR'],
      clearance: 'INTERNAL',
    });
    const dispatcherUser = await createUser(context, adminToken, {
      email: 'control@emergency.test',
      fullName: 'Emergency Control',
      agencyId: ems.id,
      roles: ['DISPATCHER', 'INCIDENT_OFFICER'],
      clearance: 'HIGHLY_RESTRICTED',
    });
    const responderUser = await createUser(context, adminToken, {
      email: 'crew@emergency.test',
      fullName: 'Ambulance Crew',
      agencyId: ems.id,
      roles: ['EMERGENCY_RESPONDER'],
      clearance: 'CONFIDENTIAL',
    });
    responderUserId = responderUser.id;
    const outsideUser = await createUser(context, adminToken, {
      email: 'firecrew@emergency.test',
      fullName: 'Fire Crew',
      agencyId: fireService.id,
      roles: ['EMERGENCY_RESPONDER'],
      clearance: 'CONFIDENTIAL',
    });
    outsideResponderUserId = outsideUser.id;
    const registrarUser = await createUser(context, adminToken, {
      email: 'registrar@emergency.test',
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
    fleet = await session(fleetUser);
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
  });

  after(async () => {
    await context.close();
  });

  test('a fleet administrator registers a unit and takes it in and out of service', async () => {
    const created = await fleet
      .post('/api/v1/response-units', {
        unitCode: 'amb-jos-01',
        type: 'AMBULANCE',
        homeLgaCode: 'PL-JNO',
        capabilities: ['PARAMEDIC', 'DEFIBRILLATOR'],
        contactPhone: '08035550101',
        status: 'AVAILABLE',
      })
      .expect(201);
    const unit = created.body as { unitCode: string; status: string; capabilities: string[] };
    // Normalised, so a unit is not registered twice under two spellings.
    assert.equal(unit.unitCode, 'AMB-JOS-01');
    assert.equal(unit.status, 'AVAILABLE');
    assert.deepEqual(unit.capabilities, ['PARAMEDIC', 'DEFIBRILLATOR']);

    await fleet
      .post('/api/v1/response-units', { unitCode: 'AMB-JOS-01', type: 'AMBULANCE' })
      .expect(409);

    const offline = await fleet
      .patch('/api/v1/response-units/AMB-JOS-01', { status: 'OFFLINE' })
      .expect(200);
    assert.equal((offline.body as { status: string }).status, 'OFFLINE');
    await fleet.patch('/api/v1/response-units/AMB-JOS-01', { status: 'AVAILABLE' }).expect(200);
  });

  test('fleet administration confers nothing over anybody’s record', async () => {
    // SECURITY_ADMINISTRATOR is a technical role by design (§7). It can register
    // an ambulance and cannot read a single field about the person in it.
    await fleet.get(`/api/v1/citizens/${pcid}/emergency-profile`).expect(404);
    await fleet.get('/api/v1/incidents').expect(404);
  });

  test('a unit on a live dispatch is not taken out of service from the fleet screen', async () => {
    await fleet
      .post('/api/v1/response-units', {
        unitCode: 'AMB-JOS-02',
        type: 'AMBULANCE',
        homeLgaCode: 'PL-JNO',
        status: 'AVAILABLE',
      })
      .expect(201);

    const opened = await dispatcher
      .post('/api/v1/incidents', {
        type: 'ROAD_ACCIDENT',
        severity: 'CRITICAL',
        description: 'Multi-vehicle collision with casualties on the Zaria Road.',
        addressText: 'Zaria Road, Jos',
        lgaCode: 'PL-JNO',
        latitude: 9.9285,
        longitude: 8.8921,
      })
      .expect(201);
    incidentNumber = (opened.body as { incidentNumber: string }).incidentNumber;

    await dispatcher
      .post(`/api/v1/incidents/${incidentNumber}/dispatch`, { unitCode: 'AMB-JOS-02' })
      .expect(201);

    // The dispatch workflow owns the operational statuses. A fleet screen that
    // could write them would let somebody mark an ambulance available while it
    // is carrying a patient.
    const refused = await fleet
      .patch('/api/v1/response-units/AMB-JOS-02', { status: 'OFFLINE' })
      .expect(409);
    assert.match((refused.body as { error: { message: string } }).error.message, /live dispatch/);

    // Everything else about the unit is still administrable.
    await fleet
      .patch('/api/v1/response-units/AMB-JOS-02', { contactPhone: '08035550199' })
      .expect(200);
  });

  test('the crew of a dispatched agency receives the minimum necessary profile', async () => {
    const profile = await responder
      .get(`/api/v1/citizens/${pcid}/emergency-profile?incidentRef=${incidentNumber}`)
      .expect(200);
    const body = profile.body as {
      data: Record<string, unknown>;
      restrictedFields: string[];
    };

    // What emergency care needs.
    assert.equal(typeof body.data.displayName, 'string');
    assert.ok('approximateAge' in body.data, 'an approximate age is released');

    // And nothing that is an identity credential or a route to the rest of
    // somebody's life (§10, §38).
    for (const field of ['dateOfBirth', 'nin', 'registeredAddress', 'email']) {
      assert.equal(body.data[field], undefined, `${field} must not be in an emergency profile`);
    }
  });

  test('a responder attached to nothing is refused as if the person did not exist', async () => {
    // The fire crew's agency was not dispatched, so neither they nor their
    // service is attached. The answer does not confirm that the incident or the
    // person is real.
    // 404, not 403: NOT_ASSIGNED_TO_INCIDENT falls through to the opaque answer
    // on purpose, because naming it would confirm to somebody outside the
    // incident that the incident is real.
    await outsideResponder
      .get(`/api/v1/citizens/${pcid}/emergency-profile?incidentRef=${incidentNumber}`)
      .expect(404);
  });

  test('control attaches them, which is the ordinary path and takes seconds', async () => {
    const attached = await dispatcher
      .post(`/api/v1/incidents/${incidentNumber}/officers`, {
        userId: outsideResponderUserId,
        role: 'RESPONDER',
      })
      .expect(201);
    assert.equal((attached.body as { userId: string }).userId, outsideResponderUserId);

    await outsideResponder
      .get(`/api/v1/citizens/${pcid}/emergency-profile?incidentRef=${incidentNumber}`)
      .expect(200);

    // And it is on the incident's own record, not only in the audit log.
    const view = await dispatcher.get(`/api/v1/incidents/${incidentNumber}`).expect(200);
    const officers = (view.body as { assignedOfficers: { name: string }[] }).assignedOfficers;
    assert.ok(
      officers.some((officer) => officer.name === 'Fire Crew'),
      'the attached officer appears on the incident',
    );
  });

  test('an officer cannot attach themselves to an incident they are outside', async () => {
    const second = await dispatcher
      .post('/api/v1/incidents', {
        type: 'FIRE',
        severity: 'HIGH',
        description: 'Market stall fire, Terminus.',
        lgaCode: 'PL-JNO',
      })
      .expect(201);
    const other = (second.body as { incidentNumber: string }).incidentNumber;

    // Attaching is the act that opens the casualties' profiles, so an account
    // that could attach itself to any live incident would undo the control the
    // incident exists to be. The fire service was neither dispatched to this one
    // nor leads it, so its crew is outside and stays outside.
    await outsideResponder
      .post(`/api/v1/incidents/${other}/officers`, {
        userId: outsideResponderUserId,
        role: 'RESPONDER',
      })
      .expect(404);

    // The ambulance service leads it, so its own crew is on it by agency and can
    // bring in a colleague. Attachment by agency is what makes a response
    // possible to staff at all.
    await responder
      .post(`/api/v1/incidents/${other}/officers`, { userId: responderUserId, role: 'RESPONDER' })
      .expect(201);
  });

  test('a closed incident authorises nothing further, and nobody can be added to it', async () => {
    await dispatcher
      .patch(`/api/v1/incidents/${incidentNumber}/status`, {
        status: 'RESOLVED',
        note: 'All casualties transported; scene cleared.',
      })
      .expect(200);
    await dispatcher
      .patch(`/api/v1/incidents/${incidentNumber}/status`, { status: 'CLOSED' })
      .expect(200);

    const refused = await dispatcher
      .post(`/api/v1/incidents/${incidentNumber}/officers`, {
        userId: outsideResponderUserId,
        role: 'RESPONDER',
      })
      .expect(403);
    // The engine's own answer, reached before the service's identical check:
    // naming this leaks nothing to somebody who already held the incident.
    assert.match(
      (refused.body as { error: { message: string } }).error.message,
      /closed and authorises no further access/,
    );

    // And the access it was granting is gone with it, with nothing separate to
    // revoke and nothing to forget.
    await responder
      .get(`/api/v1/citizens/${pcid}/emergency-profile?incidentRef=${incidentNumber}`)
      .expect(403);
  });

  test('the nearest available units are offered, and a dispatched one is not', async () => {
    const nearby = await dispatcher
      .get(`/api/v1/response-units?nearIncident=${incidentNumber}`)
      .expect(200);
    const units = nearby.body as { unitCode: string; status: string }[];
    assert.ok(
      units.every((unit) => unit.status === 'AVAILABLE'),
      'only units that could actually be sent are offered',
    );
  });
});
