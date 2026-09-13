import { strict as assert } from 'node:assert';
import { after, before, describe, test } from 'node:test';

import { ApiClient, bootstrapAdmin, createAgency, createUser, signIn, totpCode } from './harness';
import type { CreatedUser, TestContext } from './harness';
import { createTestContext } from './harness';

/**
 * Master system prompt §75 - CRITICAL AUTHORIZATION TESTS, proven through the API.
 *
 * The policy engine has its own exhaustive suite. This one proves the same seven
 * propositions end to end over HTTP, so a route that forgets to consult the
 * engine - or consults it with the wrong resource - is caught here.
 */
describe('§75 critical authorization tests, over HTTP', () => {
  let context: TestContext;
  let adminToken: string;

  let registrarClient: ApiClient;
  let revenueClient: ApiClient;
  let educationClient: ApiClient;
  let healthClient: ApiClient;
  let investigatorClient: ApiClient;
  let otherInvestigatorClient: ApiClient;
  let supervisorClient: ApiClient;
  let responderClient: ApiClient;
  let responder: CreatedUser;
  let adminClient: ApiClient;
  let citizenAClient: ApiClient;
  let citizenBClient: ApiClient;
  let landsClient: ApiClient;

  let pcidA: string;
  let pcidB: string;
  let caseNumber: string;
  let incidentNumber: string;
  let propertyId: string;

  before(async () => {
    context = await createTestContext('authz');
    const bootstrap = await bootstrapAdmin(context);
    const session = await signIn(
      context,
      bootstrap.email,
      bootstrap.password,
      bootstrap.totpSecret,
    );
    adminToken = session.accessToken;
    adminClient = new ApiClient(context, adminToken);

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
    const education = await createAgency(context, adminToken, {
      code: 'PLT-EDU',
      name: 'Ministry of Education',
      category: 'EDUCATION',
      maxClassification: 'CONFIDENTIAL',
    });
    const health = await createAgency(context, adminToken, {
      code: 'PLT-HEALTH',
      name: 'Ministry of Health',
      category: 'HEALTH',
      maxClassification: 'HIGHLY_RESTRICTED',
    });
    const police = await createAgency(context, adminToken, {
      code: 'PLT-POLICE',
      name: 'Police Command',
      category: 'SECURITY',
      maxClassification: 'LAW_ENFORCEMENT_RESTRICTED',
      lawEnforcementCompartment: true,
    });
    const ems = await createAgency(context, adminToken, {
      code: 'PLT-EMS',
      name: 'Emergency Management Agency',
      category: 'EMERGENCY',
      maxClassification: 'HIGHLY_RESTRICTED',
    });
    const lands = await createAgency(context, adminToken, {
      code: 'PLT-LANDS',
      name: 'Lands Registry',
      category: 'LANDS',
      maxClassification: 'CONFIDENTIAL',
    });

    const make = async (
      email: string,
      fullName: string,
      agencyId: string,
      roles: string[],
      clearance: string,
    ): Promise<{ user: CreatedUser; client: ApiClient }> => {
      const user = await createUser(context, adminToken, {
        email,
        fullName,
        agencyId,
        roles,
        clearance,
      });
      const signed = await signIn(context, user.email, user.password, user.totpSecret);
      return { user, client: new ApiClient(context, signed.accessToken) };
    };

    registrarClient = (
      await make(
        'reg@x.gov.ng',
        'Registrar One',
        registry.id,
        ['REGISTRATION_OFFICER'],
        'HIGHLY_RESTRICTED',
      )
    ).client;
    educationClient = (
      await make('edu@x.gov.ng', 'Desk Three', education.id, ['MDA_OFFICER'], 'CONFIDENTIAL')
    ).client;
    healthClient = (
      await make('hea@x.gov.ng', 'Desk Four', health.id, ['MDA_OFFICER'], 'HIGHLY_RESTRICTED')
    ).client;
    investigatorClient = (
      await make(
        'inv@x.gov.ng',
        'Detective Five',
        police.id,
        ['INVESTIGATOR'],
        'LAW_ENFORCEMENT_RESTRICTED',
      )
    ).client;
    otherInvestigatorClient = (
      await make(
        'inv2@x.gov.ng',
        'Detective Six',
        police.id,
        ['INVESTIGATOR'],
        'LAW_ENFORCEMENT_RESTRICTED',
      )
    ).client;
    supervisorClient = (
      await make(
        'sup@x.gov.ng',
        'Command Eleven',
        police.id,
        ['SUPERVISOR'],
        'LAW_ENFORCEMENT_RESTRICTED',
      )
    ).client;
    landsClient = (
      await make('lan@x.gov.ng', 'Desk Seven', lands.id, ['MDA_OFFICER'], 'CONFIDENTIAL')
    ).client;
    // A revenue desk holds the separate revenue role, which a ministry desk does not.
    revenueClient = (
      await make('rev2@x.gov.ng', 'Desk Ten', revenue.id, ['REVENUE_OFFICER'], 'CONFIDENTIAL')
    ).client;
    const responderPair = await make(
      'res@x.gov.ng',
      'Field Eight',
      ems.id,
      ['EMERGENCY_RESPONDER'],
      'HIGHLY_RESTRICTED',
    );
    responder = responderPair.user;
    responderClient = responderPair.client;
    const dispatcher = await make(
      'dis@x.gov.ng',
      'Control Nine',
      ems.id,
      ['DISPATCHER', 'INCIDENT_OFFICER'],
      'HIGHLY_RESTRICTED',
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
          lgaCode: 'PL-JNO',
          wardCode: 'PL-JNO-01',
          channel: 'REGISTRATION_DESK',
        })
        .expect(201);
      const issued = (created.body as { pcid: string }).pcid;
      if (given === 'Amina') pcidA = issued;
      else pcidB = issued;
    }

    // Medical details the citizen has disclosed for emergency care only.
    const { Database } = await import('../../src/database/pool');
    const db = context.app.get(Database);
    await db.query(
      `UPDATE citizen SET blood_group = 'O+', emergency_medical_notes = 'Severe penicillin allergy.'
        WHERE pcid = $1`,
      [pcidA],
    );

    // Portal accounts for both residents.
    for (const target of [pcidA, pcidB]) {
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
      if (target === pcidA) citizenAClient = client;
      else citizenBClient = client;
    }

    // A case, an incident, and a property owned by another agency.
    const investigation = await investigatorClient
      .post('/api/v1/cases', {
        type: 'CRIMINAL_INVESTIGATION',
        title: 'Enquiry',
        lgaCode: 'PL-JNO',
      })
      .expect(201);
    caseNumber = (investigation.body as { caseNumber: string }).caseNumber;
    await investigatorClient
      .post(`/api/v1/cases/${caseNumber}/subjects`, {
        subjectType: 'CITIZEN',
        subjectId: pcidA,
        subjectRole: 'SUBJECT_OF_INTEREST',
        justification: 'Named in the complaint that opened this enquiry.',
      })
      .expect(201);

    const incident = await dispatcher.client
      .post('/api/v1/incidents', {
        type: 'ROAD_ACCIDENT',
        severity: 'CRITICAL',
        description: 'Collision with casualties.',
        lgaCode: 'PL-JNO',
        wardCode: 'PL-JNO-01',
      })
      .expect(201);
    incidentNumber = (incident.body as { incidentNumber: string }).incidentNumber;
    await db.query(
      `INSERT INTO incident_officer (incident_id, user_id, role)
       SELECT id, $2, 'RESPONDER' FROM incident WHERE incident_number = $1`,
      [incidentNumber, responder.id],
    );

    const source = await adminClient
      .post('/api/v1/integrations', {
        agencyId: lands.id,
        domain: 'LANDS',
        systemName: 'Lands Core',
        adapterKey: 'lands-sandbox',
        mode: 'SANDBOX',
        config: { samplePcids: [pcidA] },
      })
      .expect(201);
    await adminClient
      .post(`/api/v1/integrations/${(source.body as { id: string }).id}/sync`)
      .expect(201);
    const property = await db.queryOne<{ id: string }>(
      'SELECT id FROM property WHERE owner_pcid = $1 LIMIT 1',
      [pcidA],
    );
    propertyId = property?.id ?? '';
  });

  after(async () => {
    await context?.close();
  });

  test('1. a revenue officer cannot access restricted health information', async () => {
    const view = await revenueClient
      .get(`/api/v1/citizens/${pcidA}?purpose=REVENUE_ADMINISTRATION`)
      .expect(200);
    const data = (view.body as { data: Record<string, unknown> }).data;
    assert.equal(data.emergencyMedicalNotes, undefined);
    assert.equal(data.bloodGroup, undefined);

    // Even a health ministry officer with the clearance gets nothing for a
    // service-delivery purpose: the fields are catalogued for emergency care only.
    const healthView = await healthClient
      .get(`/api/v1/citizens/${pcidA}?purpose=SERVICE_DELIVERY`)
      .expect(200);
    const healthData = (healthView.body as { data: Record<string, unknown> }).data;
    assert.equal(healthData.emergencyMedicalNotes, undefined);
    assert.equal(healthData.bloodGroup, undefined);

    // Asking for an emergency purpose without the role is refused outright.
    await revenueClient
      .get(`/api/v1/citizens/${pcidA}/emergency-profile?incidentRef=${incidentNumber}`)
      .expect(404);
  });

  test('2. an education officer cannot access security cases', async () => {
    await educationClient.get(`/api/v1/cases/${caseNumber}`).expect(404);
    await educationClient.get('/api/v1/cases').expect(404);
    await educationClient
      .get(`/api/v1/citizens/${pcidA}?purpose=CRIMINAL_INVESTIGATION&caseRef=${caseNumber}`)
      .expect(404);

    // Nor the law-enforcement compartment on a linked record.
    const vehicleQuery = await educationClient.get(
      '/api/v1/vehicles?purpose=CRIMINAL_INVESTIGATION&registrationNumber=PLT-100-SBX',
    );
    assert.equal(vehicleQuery.status, 404);

    // And a ministry desk holds no route to a tax record, whatever the purpose.
    const revenueAttempt = await educationClient.get('/api/v1/auth/me').expect(200);
    assert.equal(
      (revenueAttempt.body as { actions: string[] }).actions.includes('REVENUE_VIEW'),
      false,
      'REVENUE_VIEW belongs to the revenue role, not to every ministry desk',
    );
  });

  test('3. a security investigator cannot access an unrelated case', async () => {
    // A second investigator in the same agency, not assigned to the case.
    await otherInvestigatorClient.get(`/api/v1/cases/${caseNumber}`).expect(404);
    await otherInvestigatorClient
      .get(`/api/v1/citizens/${pcidA}?purpose=CRIMINAL_INVESTIGATION&caseRef=${caseNumber}`)
      .expect(404);

    // The assigned investigator can, but only for the person actually linked.
    await investigatorClient
      .get(`/api/v1/citizens/${pcidA}?purpose=CRIMINAL_INVESTIGATION&caseRef=${caseNumber}`)
      .expect(200);
    const unlinked = await investigatorClient
      .get(`/api/v1/citizens/${pcidB}?purpose=CRIMINAL_INVESTIGATION&caseRef=${caseNumber}`)
      .expect(403);
    assert.match(
      (unlinked.body as { error: { message: string } }).error.message,
      /not associated with this case/i,
    );

    // Closing a case is a supervisor's act, not the investigator's own.
    await investigatorClient
      .post(`/api/v1/cases/${caseNumber}/close`, {
        closureNote: 'Attempting to close my own enquiry.',
      })
      .expect(404);

    // A supervisor must be assigned to the case to act on it, like anyone else.
    await supervisorClient
      .post(`/api/v1/cases/${caseNumber}/close`, {
        closureNote: 'Closing a case I am not assigned to.',
      })
      .expect(404);

    // A supervisor in the owning agency can take the case on: managing the
    // agency's own caseload is administration, and releases nothing by itself.
    const supervisorId = (await supervisorClient.get('/api/v1/auth/me').expect(200)).body
      .id as string;
    await supervisorClient
      .post(`/api/v1/cases/${caseNumber}/assignments`, { userId: supervisorId, role: 'SUPERVISOR' })
      .expect(201);

    // An investigator still cannot assign anyone: they hold no assignment action.
    await investigatorClient
      .post(`/api/v1/cases/${caseNumber}/assignments`, { userId: supervisorId, role: 'SUPERVISOR' })
      .expect(404);

    // And closing the case closes the access it authorised.
    await supervisorClient
      .post(`/api/v1/cases/${caseNumber}/close`, {
        closureNote: 'Enquiry concluded with no further action.',
      })
      .expect(201);
    const afterClose = await investigatorClient
      .get(`/api/v1/citizens/${pcidA}?purpose=CRIMINAL_INVESTIGATION&caseRef=${caseNumber}`)
      .expect(403);
    assert.match((afterClose.body as { error: { message: string } }).error.message, /closed/i);
  });

  test('4. an emergency responder receives only emergency-authorised information', async () => {
    const profile = await responderClient
      .get(`/api/v1/citizens/${pcidA}/emergency-profile?incidentRef=${incidentNumber}`)
      .expect(200);
    const data = (profile.body as { data: Record<string, unknown> }).data;

    assert.equal(data.bloodGroup, 'O+', 'blood group is released for emergency care');
    assert.equal(data.emergencyMedicalNotes, 'Severe penicillin allergy.');
    assert.ok('approximateAge' in data);
    for (const forbidden of ['dateOfBirth', 'registeredAddress', 'phonePrimary', 'email', 'nin']) {
      assert.equal(data[forbidden], undefined, `a responder must not receive ${forbidden}`);
    }

    await responderClient
      .get(`/api/v1/citizens/${pcidA}?purpose=EMERGENCY_RESPONSE&incidentRef=${incidentNumber}`)
      .expect(404);
    await responderClient.get(`/api/v1/cases/${caseNumber}`).expect(404);
    await responderClient.get('/api/v1/citizens?purpose=EMERGENCY_RESPONSE&name=Dung').expect(404);

    // Closing the incident closes the access.
    await new ApiClient(context, adminToken); // no-op, keeps the admin token referenced
    const { Database } = await import('../../src/database/pool');
    const db = context.app.get(Database);
    await db.query(
      "UPDATE incident SET status = 'CLOSED', closed_at = now() WHERE incident_number = $1",
      [incidentNumber],
    );
    const afterClose = await responderClient
      .get(`/api/v1/citizens/${pcidA}/emergency-profile?incidentRef=${incidentNumber}`)
      .expect(403);
    assert.match((afterClose.body as { error: { message: string } }).error.message, /closed/i);
  });

  test('5. an administrator cannot automatically bypass data policies', async () => {
    for (const path of [
      `/api/v1/citizens/${pcidA}?purpose=SERVICE_DELIVERY`,
      `/api/v1/citizens/${pcidA}/360?purpose=SERVICE_DELIVERY`,
      `/api/v1/citizens/${pcidA}/emergency-profile?incidentRef=${incidentNumber}`,
      '/api/v1/citizens?purpose=SERVICE_DELIVERY&name=Dung',
      `/api/v1/cases/${caseNumber}`,
      '/api/v1/missing-persons',
    ]) {
      const response = await adminClient.get(path);
      assert.equal(response.status, 404, `the platform administrator must not reach ${path}`);
    }

    // They administer the platform, and that is all.
    await adminClient.get('/api/v1/agencies').expect(200);
    await adminClient.get('/api/v1/integrations').expect(200);
  });

  test('6. a citizen cannot access another citizen', async () => {
    await citizenAClient.get('/api/v1/me/record').expect(200);
    await citizenAClient.get(`/api/v1/citizens/${pcidB}?purpose=CITIZEN_SELF_SERVICE`).expect(404);
    await citizenBClient.get(`/api/v1/citizens/${pcidA}?purpose=CITIZEN_SELF_SERVICE`).expect(404);
    await citizenAClient
      .get(`/api/v1/citizens/${pcidB}/360?purpose=CITIZEN_SELF_SERVICE`)
      .expect(404);
    await citizenAClient
      .get(`/api/v1/citizens/${pcidB}/emergency-profile?incidentRef=${incidentNumber}`)
      .expect(404);

    // A citizen's own access history is their own.
    const history = await citizenAClient.get('/api/v1/me/access-history').expect(200);
    assert.ok((history.body as { total: number }).total > 0);
  });

  test('7. an MDA cannot modify another MDA’s source records without explicit authority', async () => {
    // The lands registry owns the property record. No write path exists for it -
    // for the revenue service, for the lands service itself, or for anyone.
    const { registeredRoutes } = await import('../../src/common/openapi/registry');
    const propertyWrites = registeredRoutes().filter(
      (route) => route.path.includes('/properties') && route.method !== 'get',
    );
    assert.deepEqual(
      propertyWrites,
      [],
      'the API exposes no write endpoint for a linked property record',
    );

    const vehicleWrites = registeredRoutes().filter(
      (route) => route.path.includes('/vehicles') && route.method !== 'get',
    );
    assert.deepEqual(vehicleWrites, []);

    // Reading it names the owning agency, so provenance is never in doubt.
    const view = await landsClient
      .get(`/api/v1/properties/${propertyId}?purpose=SERVICE_DELIVERY`)
      .expect(200);
    const body = view.body as {
      data: Record<string, unknown>;
      provenance: { sourceAgencyId: string; sourceSystem: string; stale: boolean };
    };
    assert.ok(body.provenance.sourceAgencyId);
    assert.equal(body.provenance.sourceSystem, 'Lands Core');
    assert.equal(body.data.sourceAgencyId, body.provenance.sourceAgencyId);

    // A correction flows to the owning agency as a request, never as a write.
    const correction = await citizenAClient
      .post('/api/v1/me/correction-requests', {
        fieldPath: 'citizen.registeredAddress',
        requestedValue: '14 Rwang Pam Street, Jos',
        justification: 'I moved house last month and the registry still shows the old address.',
      })
      .expect(201);
    assert.equal((correction.body as { status: string }).status, 'SUBMITTED');
  });

  test('the authenticator confirmation endpoint works, and an unconfirmed account cannot reach citizen data', async () => {
    const created = await adminClient
      .post('/api/v1/users', {
        email: 'unconfirmed@x.gov.ng',
        fullName: 'Pending Ten',
        agencyId: (await adminClient.get('/api/v1/agencies').expect(200)).body[0].id,
        roles: ['MDA_OFFICER'],
        clearance: 'CONFIDENTIAL',
        jurisdictionScope: 'STATE',
        jurisdictionLgaCodes: [],
        jurisdictionWardCodes: [],
        temporaryPassword: 'Zq7Mk94Tb2Lx8Qw',
      })
      .expect(201);
    const enrolment = created.body as { totpSecret: string };

    const login = await new ApiClient(context)
      .post('/api/v1/auth/login', { email: 'unconfirmed@x.gov.ng', password: 'Zq7Mk94Tb2Lx8Qw' })
      .expect(201);
    const pending = new ApiClient(context, (login.body as { accessToken: string }).accessToken);

    // Signed in, but MFA is not enrolled, so citizen data is closed.
    const blocked = await pending
      .get(`/api/v1/citizens/${pcidA}?purpose=SERVICE_DELIVERY`)
      .expect(401);
    assert.equal((blocked.body as { error: { code: string } }).error.code, 'MFA_REQUIRED');

    await pending
      .post('/api/v1/users/me/mfa/confirm', { code: await totpCode(enrolment.totpSecret) })
      .expect(201);

    const confirmed = await signIn(
      context,
      'unconfirmed@x.gov.ng',
      'Zq7Mk94Tb2Lx8Qw',
      enrolment.totpSecret,
    );
    await new ApiClient(context, confirmed.accessToken)
      .get(`/api/v1/citizens/${pcidA}?purpose=SERVICE_DELIVERY`)
      .expect(200);
  });
});
