import { strict as assert } from 'node:assert';
import { after, before, describe, test } from 'node:test';

import { ApiClient, bootstrapAdmin, createAgency, createUser, signIn } from './harness';
import type { TestContext } from './harness';
import { createTestContext } from './harness';

/**
 * The command map (master system prompt §16, §35).
 *
 * The claims worth checking are as much about what is absent from the picture
 * as what is on it: an incident with no coordinate is not placed at a guess,
 * there is no layer that could show a person, and an account holding one layer
 * and not the other gets the one it holds rather than an error.
 */
describe('the command map', () => {
  let context: TestContext;
  let adminToken: string;
  let dispatcher: ApiClient;
  let fleet: ApiClient;
  let registrar: ApiClient;

  let located: string;
  let unlocated: string;

  before(async () => {
    context = await createTestContext('cmdmap');
    const bootstrap = await bootstrapAdmin(context);
    adminToken = (await signIn(context, bootstrap.email, bootstrap.password, bootstrap.totpSecret))
      .accessToken;

    const ems = await createAgency(context, adminToken, {
      code: 'PLT-EMS',
      name: 'Plateau State Emergency Management Agency',
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
      email: 'control@cmdmap.test',
      fullName: 'Emergency Control',
      agencyId: ems.id,
      roles: ['DISPATCHER', 'INCIDENT_OFFICER'],
      clearance: 'HIGHLY_RESTRICTED',
    });
    const fleetUser = await createUser(context, adminToken, {
      email: 'fleet@cmdmap.test',
      fullName: 'Fleet Office',
      agencyId: ems.id,
      roles: ['SECURITY_ADMINISTRATOR'],
      clearance: 'INTERNAL',
    });
    const registrarUser = await createUser(context, adminToken, {
      email: 'registrar@cmdmap.test',
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
    fleet = await session(fleetUser);
    registrar = await session(registrarUser);

    await fleet
      .post('/api/v1/response-units', {
        unitCode: 'AMB-JOS-01',
        type: 'AMBULANCE',
        homeLgaCode: 'PL-JNO',
        status: 'AVAILABLE',
      })
      .expect(201);

    const withPosition = await dispatcher
      .post('/api/v1/incidents', {
        type: 'ROAD_ACCIDENT',
        severity: 'CRITICAL',
        description: 'Collision on the Zaria Road.',
        addressText: 'Zaria Road, Jos',
        lgaCode: 'PL-JNO',
        latitude: 9.9285,
        longitude: 8.8921,
      })
      .expect(201);
    located = (withPosition.body as { incidentNumber: string }).incidentNumber;

    const byAddress = await dispatcher
      .post('/api/v1/incidents', {
        type: 'FIRE',
        severity: 'HIGH',
        description: 'Market stall fire; caller could not give a location.',
        addressText: 'Terminus market',
        lgaCode: 'PL-JNO',
      })
      .expect(201);
    unlocated = (byAddress.body as { incidentNumber: string }).incidentNumber;
  });

  after(async () => {
    await context.close();
  });

  test('the picture opens on everything happening, with air around it', async () => {
    const response = await dispatcher.get('/api/v1/map/situation').expect(200);
    const body = response.body as {
      extent: { north: number; south: number; east: number; west: number } | null;
      incidents: { incidentNumber: string; position: { latitude: number } }[];
      layers: string[];
    };

    assert.ok(body.extent, 'a view is computed from what is on the picture');
    assert.ok(body.extent.north > 9.9285, 'the northernmost pin is not on the edge');
    assert.deepEqual([...body.layers].sort(), ['INCIDENTS', 'UNITS']);
    assert.ok(body.incidents.some((entry) => entry.incidentNumber === located));
  });

  test('an incident with no coordinate is listed, never placed', async () => {
    const response = await dispatcher.get('/api/v1/map/situation').expect(200);
    const body = response.body as {
      incidents: { incidentNumber: string }[];
      withoutPosition: { incidentNumber: string; reason: string; address: string | null }[];
    };

    // A map that put this at the centre of its LGA would be inventing precision,
    // and somebody would send a unit to the pin.
    assert.ok(
      !body.incidents.some((entry) => entry.incidentNumber === unlocated),
      'it is not on the picture',
    );
    const listed = body.withoutPosition.find((entry) => entry.incidentNumber === unlocated);
    assert.ok(listed, 'it is beside the picture instead');
    assert.equal(listed.reason, 'NO_COORDINATE_REPORTED');
    assert.equal(listed.address, 'Terminus market', 'with what is actually known about where');
  });

  test('every coordinate carries how it was obtained', async () => {
    const response = await dispatcher.get('/api/v1/map/situation').expect(200);
    const body = response.body as {
      incidents: { position: { source: string | null } }[];
    };
    // Provenance travels with every coordinate (§16). On a map it decides how
    // much a pin should be trusted.
    assert.ok(body.incidents.every((entry) => entry.position.source !== null));
  });

  test('a view bounds the picture, and an empty part of the state is empty', async () => {
    const near = await dispatcher
      .get('/api/v1/map/situation?north=9.95&south=9.90&east=8.92&west=8.85')
      .expect(200);
    assert.ok(
      (near.body as { incidents: unknown[] }).incidents.length > 0,
      'the incident is inside this view',
    );

    const elsewhere = await dispatcher
      .get('/api/v1/map/situation?north=6.5&south=6.4&east=3.5&west=3.4')
      .expect(200);
    assert.equal(
      (elsewhere.body as { incidents: unknown[] }).incidents.length,
      0,
      'Lagos is not in Plateau State',
    );
  });

  test('half a view is refused rather than silently completed', async () => {
    // Defaulting the missing side would show somebody a picture they did not ask
    // for and believe they had bounded.
    await dispatcher.get('/api/v1/map/situation?north=9.95&south=9.90').expect(400);
  });

  test('a request for half the planet is refused', async () => {
    await dispatcher.get('/api/v1/map/situation?north=40&south=0&east=40&west=0').expect(400);
  });

  test('an account holding one layer gets that layer, not an error', async () => {
    // A fleet office holds RESPONSE_UNIT_VIEW and no INCIDENT_VIEW. The map is a
    // composition, so a refused layer is an absent layer.
    const response = await fleet.get('/api/v1/map/situation').expect(200);
    const body = response.body as {
      layers: string[];
      incidents: unknown[];
      units: unknown[];
      withoutPosition: unknown[];
    };

    assert.deepEqual(body.layers, ['UNITS']);
    assert.equal(body.incidents.length, 0);
    assert.equal(
      body.withoutPosition.length,
      0,
      'and it is told nothing about incidents at all, not even that some exist',
    );
  });

  test('an account holding no layer is refused, and told nothing', async () => {
    await registrar.get('/api/v1/map/situation').expect(404);
  });

  test('there is no layer that could show a person', async () => {
    const response = await dispatcher.get('/api/v1/map/situation').expect(200);
    const serialised = JSON.stringify(response.body);

    // The only live positions the platform holds are units', reported by the
    // unit about itself. Nothing on this picture is a person, and nothing in
    // the response is a PCID.
    assert.doesNotMatch(serialised, /PL-[A-Z0-9]{5}-/);
    assert.doesNotMatch(serialised, /"pcid"|"citizen"/i);
    assert.deepEqual(Object.keys(response.body as object).sort(), [
      'extent',
      'incidents',
      'layers',
      'units',
      'withoutPosition',
    ]);
  });

  test('a closed incident leaves the picture', async () => {
    await dispatcher
      .patch(`/api/v1/incidents/${located}/status`, { status: 'RESOLVED', note: 'Cleared.' })
      .expect(200);

    const response = await dispatcher.get('/api/v1/map/situation').expect(200);
    const body = response.body as { incidents: { incidentNumber: string }[] };
    assert.ok(
      !body.incidents.some((entry) => entry.incidentNumber === located),
      'a command map shows what is live, and this is not',
    );
  });

  test('the nearest unit search still answers when the fleet is far away', async () => {
    // The search is bounded by a box so the database can use an index. A box
    // that excluded everything must fall back to the whole fleet rather than
    // telling a control room there is nothing to send.
    // The position is reported by the crew, not by the fleet office: a fleet
    // office registers vehicles and holds no DISPATCH_UPDATE at all.
    await dispatcher
      .post('/api/v1/response-units/AMB-JOS-01/position', { latitude: 9.9, longitude: 8.86 })
      .expect(201);

    const far = await dispatcher
      .post('/api/v1/incidents', {
        type: 'RESCUE_OPERATION',
        severity: 'CRITICAL',
        description: 'Stranded climber, far outside the state.',
        latitude: 4.0,
        longitude: 4.0,
      })
      .expect(201);
    const reference = (far.body as { incidentNumber: string }).incidentNumber;

    const units = await dispatcher
      .get(`/api/v1/response-units?nearIncident=${reference}`)
      .expect(200);
    assert.ok(
      (units.body as unknown[]).length > 0,
      'a slow answer beats a wrong one when somebody is waiting for an ambulance',
    );
  });
});
