import { strict as assert } from 'node:assert';
import { after, before, describe, test } from 'node:test';

import { ApiClient, bootstrapAdmin, createAgency, createUser, signIn } from './harness';
import type { CreatedUser, TestContext } from './harness';
import { createTestContext } from './harness';

/**
 * Master system prompt §85 - FINAL SYSTEM ACCEPTANCE TEST.
 *
 * One continuous scenario, in order, against the real application: a resident is
 * registered, government bodies use the record under their own authority, an
 * emergency runs its course, an investigation runs its course, and every step is
 * accounted for afterwards.
 *
 * The tests share state deliberately - this is a narrative, and each step depends
 * on the last, exactly as the acceptance criteria describe it.
 */
describe('§85 final system acceptance', () => {
  let context: TestContext;
  let admin: ApiClient;

  // The cast, and what the scenario produces as it goes.
  let revenueAgencyId: string;
  let policeAgencyId: string;
  let emsAgencyId: string;
  let registryAgencyId: string;
  let landsAgencyId: string;

  let registrar: CreatedUser;
  let registrarClient: ApiClient;
  let mdaOfficerClient: ApiClient;
  let investigator: CreatedUser;
  let investigatorClient: ApiClient;
  let supervisorClient: ApiClient;
  let dispatcherClient: ApiClient;
  let responder: CreatedUser;
  let responderClient: ApiClient;
  let missingPersonOfficerClient: ApiClient;
  let auditorClient: ApiClient;
  let citizenClient: ApiClient;

  let pcid: string;
  let caseNumber: string;
  let incidentNumber: string;
  let missingPersonReference: string;
  let unidentifiedPersonId: string;

  before(async () => {
    context = await createTestContext('acceptance');
    const bootstrap = await bootstrapAdmin(context);
    const session = await signIn(
      context,
      bootstrap.email,
      bootstrap.password,
      bootstrap.totpSecret,
    );
    admin = new ApiClient(context, session.accessToken);
    const token = session.accessToken;

    registryAgencyId = (
      await createAgency(context, token, {
        code: 'PLT-REGISTRY',
        name: 'Plateau State Citizen Registry',
        category: 'MDA',
        maxClassification: 'HIGHLY_RESTRICTED',
      })
    ).id;
    revenueAgencyId = (
      await createAgency(context, token, {
        code: 'PLT-REVENUE',
        name: 'Plateau State Internal Revenue Service',
        category: 'REVENUE',
        maxClassification: 'CONFIDENTIAL',
      })
    ).id;
    landsAgencyId = (
      await createAgency(context, token, {
        code: 'PLT-LANDS',
        name: 'Plateau State Lands Registry',
        category: 'LANDS',
        maxClassification: 'CONFIDENTIAL',
      })
    ).id;
    policeAgencyId = (
      await createAgency(context, token, {
        code: 'PLT-POLICE',
        name: 'Plateau State Police Command',
        category: 'SECURITY',
        maxClassification: 'LAW_ENFORCEMENT_RESTRICTED',
        lawEnforcementCompartment: true,
      })
    ).id;
    emsAgencyId = (
      await createAgency(context, token, {
        code: 'PLT-EMS',
        name: 'Plateau State Emergency Management Agency',
        category: 'EMERGENCY',
        maxClassification: 'HIGHLY_RESTRICTED',
      })
    ).id;

    registrar = await createUser(context, token, {
      email: 'registrar@pcid.plateaustate.gov.ng',
      fullName: 'Registration Officer',
      agencyId: registryAgencyId,
      roles: ['REGISTRATION_OFFICER'],
      clearance: 'HIGHLY_RESTRICTED',
    });
    const mdaOfficer = await createUser(context, token, {
      email: 'revenue.desk@pcid.plateaustate.gov.ng',
      fullName: 'Revenue Desk Officer',
      agencyId: revenueAgencyId,
      roles: ['MDA_OFFICER'],
      clearance: 'CONFIDENTIAL',
    });
    investigator = await createUser(context, token, {
      email: 'investigator@pcid.plateaustate.gov.ng',
      fullName: 'Detective Investigator',
      agencyId: policeAgencyId,
      roles: ['INVESTIGATOR'],
      clearance: 'LAW_ENFORCEMENT_RESTRICTED',
    });
    const supervisor = await createUser(context, token, {
      email: 'supervisor@pcid.plateaustate.gov.ng',
      fullName: 'Case Supervisor',
      agencyId: policeAgencyId,
      // Also an investigator, which is common in practice and lets the scenario
      // prove that holding both actions still does not permit self-approval.
      roles: ['SUPERVISOR', 'INVESTIGATOR'],
      clearance: 'LAW_ENFORCEMENT_RESTRICTED',
    });
    const dispatcher = await createUser(context, token, {
      email: 'dispatcher@pcid.plateaustate.gov.ng',
      fullName: 'Emergency Dispatcher',
      agencyId: emsAgencyId,
      roles: ['DISPATCHER', 'INCIDENT_OFFICER'],
      clearance: 'HIGHLY_RESTRICTED',
    });
    responder = await createUser(context, token, {
      email: 'responder@pcid.plateaustate.gov.ng',
      fullName: 'Field Responder',
      agencyId: emsAgencyId,
      roles: ['EMERGENCY_RESPONDER'],
      clearance: 'HIGHLY_RESTRICTED',
    });
    const missingPersonOfficer = await createUser(context, token, {
      email: 'mp.officer@pcid.plateaustate.gov.ng',
      fullName: 'Missing Persons Officer',
      agencyId: policeAgencyId,
      roles: ['MISSING_PERSON_OFFICER'],
      clearance: 'LAW_ENFORCEMENT_RESTRICTED',
    });
    const auditor = await createUser(context, token, {
      email: 'auditor@pcid.plateaustate.gov.ng',
      fullName: 'Platform Auditor',
      agencyId: registryAgencyId,
      roles: ['AUDITOR', 'DATA_PROTECTION_OFFICER'],
      clearance: 'HIGHLY_RESTRICTED',
    });

    registrarClient = new ApiClient(
      context,
      (await signIn(context, registrar.email, registrar.password, registrar.totpSecret))
        .accessToken,
    );
    mdaOfficerClient = new ApiClient(
      context,
      (await signIn(context, mdaOfficer.email, mdaOfficer.password, mdaOfficer.totpSecret))
        .accessToken,
    );
    investigatorClient = new ApiClient(
      context,
      (await signIn(context, investigator.email, investigator.password, investigator.totpSecret))
        .accessToken,
    );
    supervisorClient = new ApiClient(
      context,
      (await signIn(context, supervisor.email, supervisor.password, supervisor.totpSecret))
        .accessToken,
    );
    dispatcherClient = new ApiClient(
      context,
      (await signIn(context, dispatcher.email, dispatcher.password, dispatcher.totpSecret))
        .accessToken,
    );
    responderClient = new ApiClient(
      context,
      (await signIn(context, responder.email, responder.password, responder.totpSecret))
        .accessToken,
    );
    missingPersonOfficerClient = new ApiClient(
      context,
      (
        await signIn(
          context,
          missingPersonOfficer.email,
          missingPersonOfficer.password,
          missingPersonOfficer.totpSecret,
        )
      ).accessToken,
    );
    auditorClient = new ApiClient(
      context,
      (await signIn(context, auditor.email, auditor.password, auditor.totpSecret)).accessToken,
    );

    // Response units for the emergency leg.
    const { Database } = await import('../../src/database/pool');
    const db = context.app.get(Database);
    await db.query(
      `INSERT INTO response_unit (unit_code, agency_id, type, status, home_lga_code, home_ward_code,
                                  latitude, longitude, location_reported_at, location_source, capabilities)
       VALUES ('AMB-JOS-01', $1, 'AMBULANCE', 'AVAILABLE', 'PL-JNO', 'PL-JNO-01',
               9.8965, 8.8583, now(), 'RESPONDER_OBSERVED', ARRAY['ADVANCED_LIFE_SUPPORT'])`,
      [emsAgencyId],
    );
  });

  after(async () => {
    await context?.close();
  });

  test('1. a citizen is registered and 2. a unique PCID is generated', async () => {
    const response = await registrarClient
      .post('/api/v1/citizens', {
        givenName: 'Amina',
        middleName: 'Ladi',
        familyName: 'Dung',
        sex: 'FEMALE',
        dateOfBirth: '1994-06-12',
        phonePrimary: '08030000001',
        email: 'amina.dung@example.ng',
        residentialAddress: '12 Rwang Pam Street, Jos',
        lgaCode: 'PL-JNO',
        wardCode: 'PL-JNO-01',
        channel: 'REGISTRATION_DESK',
      })
      .expect(201);

    const body = response.body as { status: string; pcid: string; reference: string };
    assert.equal(body.status, 'ISSUED');
    assert.match(
      body.pcid,
      /^PL-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{2}$/,
    );
    pcid = body.pcid;

    // A second registration of the same person is stopped for review, not merged.
    const duplicate = await registrarClient
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
    const duplicateBody = duplicate.body as {
      status: string;
      candidates: { score: number; factors: unknown[] }[];
    };
    assert.equal(duplicateBody.status, 'DUPLICATE_REVIEW');
    assert.ok(duplicateBody.candidates.length > 0);
    assert.ok((duplicateBody.candidates[0]?.factors.length ?? 0) > 0, 'the reviewer is told why');
  });

  test('3. the citizen can authenticate', async () => {
    const issued = await registrarClient
      .post(`/api/v1/citizens/${pcid}/portal-account`)
      .expect(201);
    const credentials = issued.body as { temporaryPassword: string };

    const anonymous = new ApiClient(context);
    const login = await anonymous
      .post('/api/v1/auth/citizen/login', {
        identifier: pcid,
        password: credentials.temporaryPassword,
      })
      .expect(201);
    citizenClient = new ApiClient(context, (login.body as { accessToken: string }).accessToken);

    const record = await citizenClient.get('/api/v1/me/record').expect(200);
    const cards = (record.body as { cards: { key: string; status: string }[] }).cards;
    const identity = cards.find((card) => card.key === 'IDENTITY');
    assert.equal(identity?.status, 'RELEASED');
  });

  test('4. an MDA can verify the citizen and 5. sees only authorised information', async () => {
    const verification = await mdaOfficerClient
      .post('/api/v1/verification/pcid', { pcid })
      .expect(201);
    const verified = verification.body as { valid: boolean; displayName: string };
    assert.equal(verified.valid, true);
    assert.equal(verified.displayName, 'Amina Ladi Dung');

    const view = await mdaOfficerClient
      .get(`/api/v1/citizens/${pcid}?purpose=SERVICE_DELIVERY`)
      .expect(200);
    const data = (view.body as { data: Record<string, unknown> }).data;
    assert.equal(data.displayName, 'Amina Ladi Dung');
    for (const forbidden of [
      'nin',
      'emergencyMedicalNotes',
      'bloodGroup',
      'lawEnforcementMarkers',
      'identityIntegrityFlags',
    ]) {
      assert.equal(
        data[forbidden],
        undefined,
        `a service-delivery view must not release ${forbidden}`,
      );
    }

    // The 360 view says plainly which cards are withheld rather than omitting them.
    const view360 = await mdaOfficerClient
      .get(`/api/v1/citizens/${pcid}/360?purpose=SERVICE_DELIVERY`)
      .expect(200);
    const cards = (view360.body as { cards: { key: string; status: string; reason?: string }[] })
      .cards;
    const publicSafety = cards.find((card) => card.key === 'PUBLIC_SAFETY');
    assert.equal(publicSafety?.status, 'RESTRICTED');
    assert.ok((publicSafety?.reason ?? '').length > 0);
    const caseCard = cards.find((card) => card.key === 'CASE_ASSOCIATIONS');
    assert.equal(caseCard?.status, 'RESTRICTED');
  });

  test('6-8. property, vehicle and revenue records are linked through the integration framework', async () => {
    for (const [agencyId, domain, systemName] of [
      [landsAgencyId, 'PROPERTY', 'Lands Registry Core'],
      [revenueAgencyId, 'REVENUE', 'Revenue Assessment System'],
      [policeAgencyId, 'VEHICLES', 'Vehicle Registration System'],
    ] as const) {
      const source = await admin
        .post('/api/v1/integrations', {
          agencyId,
          domain,
          systemName,
          adapterKey: `${domain.toLowerCase()}-sandbox`,
          mode: 'SANDBOX',
          config: { samplePcids: [pcid] },
        })
        .expect(201);
      const sourceId = (source.body as { id: string }).id;
      const result = await admin.post(`/api/v1/integrations/${sourceId}/sync`).expect(201);
      const synced = result.body as { status: string; written: number };
      assert.equal(synced.status, 'SUCCEEDED', `${domain} sync should succeed`);
      assert.ok(synced.written > 0, `${domain} sync should write records`);
    }

    // The citizen sees their own linked records; the source agency is named on each.
    const record = await citizenClient.get('/api/v1/me/record').expect(200);
    const cards = (
      record.body as {
        cards: { key: string; status: string; items?: Record<string, unknown>[] }[];
      }
    ).cards;
    for (const key of ['PROPERTY', 'VEHICLES', 'REVENUE']) {
      const card = cards.find((entry) => entry.key === key);
      assert.equal(card?.status, 'RELEASED', `${key} should be visible to the citizen`);
      assert.ok((card?.items?.length ?? 0) > 0, `${key} should have at least one linked record`);
      assert.ok(
        card?.items?.[0]?.sourceAgencyId,
        `${key} must name its authoritative source (§28)`,
      );
    }
  });

  test('9. an authorised security officer can create a case and 10. associate the citizen with it', async () => {
    const created = await investigatorClient
      .post('/api/v1/cases', {
        type: 'CRIMINAL_INVESTIGATION',
        title: 'Vehicle-related enquiry',
        summary: 'Enquiry opened following a reported incident.',
        lgaCode: 'PL-JNO',
      })
      .expect(201);
    caseNumber = (created.body as { caseNumber: string }).caseNumber;
    assert.match(caseNumber, /^CASE-\d{4}-\d{5}$/);

    // Before the association, the case authorises nothing about this person. The
    // investigator does hold the case, so they are told what is missing.
    const beforeLink = await investigatorClient
      .get(`/api/v1/citizens/${pcid}?purpose=CRIMINAL_INVESTIGATION&caseRef=${caseNumber}`)
      .expect(403);
    assert.equal((beforeLink.body as { error: { code: string } }).error.code, 'ACCESS_DENIED');
    assert.match(
      (beforeLink.body as { error: { message: string } }).error.message,
      /not associated with this case/i,
    );

    await investigatorClient
      .post(`/api/v1/cases/${caseNumber}/subjects`, {
        subjectType: 'CITIZEN',
        subjectId: pcid,
        subjectRole: 'SUBJECT_OF_INTEREST',
        justification: 'Named by a complainant as the registered keeper of the vehicle involved.',
      })
      .expect(201);

    const afterLink = await investigatorClient
      .get(`/api/v1/citizens/${pcid}?purpose=CRIMINAL_INVESTIGATION&caseRef=${caseNumber}`)
      .expect(200);
    const data = (afterLink.body as { data: Record<string, unknown>; restrictedFields: string[] })
      .data;
    assert.equal(data.displayName, 'Amina Ladi Dung');
    // Even now, approval-gated fields are still withheld.
    assert.equal(data.lawEnforcementMarkers, undefined);
    assert.ok(
      (afterLink.body as { restrictedFields: string[] }).restrictedFields.includes(
        'lawEnforcementMarkers',
      ),
    );
  });

  test('11. an emergency incident can be created and 12. a responder dispatched', async () => {
    const created = await dispatcherClient
      .post('/api/v1/incidents', {
        type: 'ROAD_ACCIDENT',
        severity: 'CRITICAL',
        description: 'Multi-vehicle collision with casualties reported on the Zaria Road.',
        addressText: 'Zaria Road, Jos',
        lgaCode: 'PL-JNO',
        wardCode: 'PL-JNO-01',
        latitude: 9.9,
        longitude: 8.86,
      })
      .expect(201);
    incidentNumber = (created.body as { incidentNumber: string }).incidentNumber;
    assert.match(incidentNumber, /^INC-\d{4}-\d{6}$/);

    const nearest = await dispatcherClient
      .get(`/api/v1/response-units?nearIncident=${incidentNumber}`)
      .expect(200);
    const units = nearest.body as { unitCode: string; distanceMetres: number | null }[];
    assert.ok(units.length > 0, 'an available unit should be offered');
    assert.equal(units[0]?.unitCode, 'AMB-JOS-01');
    assert.ok((units[0]?.distanceMetres ?? Infinity) < 5000, 'nearest unit should be close by');

    await dispatcherClient
      .post(`/api/v1/incidents/${incidentNumber}/dispatch`, { unitCode: 'AMB-JOS-01' })
      .expect(201);

    // The responder is put on the incident, which is what opens emergency access.
    const { Database } = await import('../../src/database/pool');
    const db = context.app.get(Database);
    const incident = await db.queryOne<{ id: string }>(
      'SELECT id FROM incident WHERE incident_number = $1',
      [incidentNumber],
    );
    await db.query(
      `INSERT INTO incident_officer (incident_id, user_id, role) VALUES ($1, $2, 'RESPONDER')`,
      [incident?.id, responder.id],
    );
  });

  test('13. the responder verifies a PCID and 14. receives only the minimum necessary information', async () => {
    const profile = await responderClient
      .get(`/api/v1/citizens/${pcid}/emergency-profile?incidentRef=${incidentNumber}`)
      .expect(200);
    const data = (profile.body as { data: Record<string, unknown> }).data;

    assert.equal(data.displayName, 'Amina Ladi Dung');
    assert.ok('approximateAge' in data, 'age is released instead of the exact date of birth');
    assert.ok('emergencyContacts' in data);
    for (const forbidden of [
      'dateOfBirth',
      'registeredAddress',
      'phonePrimary',
      'email',
      'nin',
      'lawEnforcementMarkers',
    ]) {
      assert.equal(data[forbidden], undefined, `a responder must not receive ${forbidden}`);
    }

    // The same responder has no route to the full record.
    await responderClient
      .get(`/api/v1/citizens/${pcid}?purpose=EMERGENCY_RESPONSE&incidentRef=${incidentNumber}`)
      .expect(404);
  });

  test('15. a missing-person case can be created and 16. an unidentified-person record recorded', async () => {
    const missing = await missingPersonOfficerClient
      .post('/api/v1/missing-persons', {
        fullName: 'Danjuma Pam',
        ageYears: 34,
        sex: 'MALE',
        distinguishingFeatures:
          'Scar above the left eyebrow and a healed fracture of the right wrist.',
        lastSeenAddress: 'Terminus Market, Jos',
        lastSeenLgaCode: 'PL-JNO',
        lastSeenWardCode: 'PL-JNO-01',
        lastSeenAt: new Date().toISOString(),
        circumstances: 'Did not return home after visiting the market.',
        reporterName: 'Family member',
        reporterPhone: '08030000009',
        reporterRelationship: 'Brother',
      })
      .expect(201);
    missingPersonReference = (missing.body as { caseReference: string }).caseReference;

    const unidentified = await dispatcherClient
      .post(`/api/v1/unidentified-persons?incidentRef=${incidentNumber}`, {
        condition: 'UNCONSCIOUS',
        estimatedAgeMin: 30,
        estimatedAgeMax: 40,
        apparentSex: 'MALE',
        distinguishingFeatures: 'Scar above the left eyebrow, healed fracture of the right wrist.',
        foundAddress: 'Zaria Road, Jos',
        foundLgaCode: 'PL-JNO',
        foundWardCode: 'PL-JNO-01',
      })
      .expect(201);
    unidentifiedPersonId = (unidentified.body as { id: string }).id;
    assert.ok(unidentifiedPersonId);
  });

  test('17. the matching system identifies candidates, and never identifies anyone by itself', async () => {
    const result = await missingPersonOfficerClient
      .post(`/api/v1/missing-persons/${missingPersonReference}/matches/run`)
      .expect(201);
    const candidates = (
      result.body as {
        candidates: { score: number; status: string; explanation: Record<string, unknown> }[];
      }
    ).candidates;

    assert.ok(candidates.length > 0, 'the engine should find the matching unidentified person');
    const best = candidates[0];
    assert.equal(best?.status, 'CANDIDATE', 'the engine may only ever produce candidates (§13)');
    assert.ok((best?.score ?? 0) >= 45);
    // §67: the alert explains itself.
    assert.ok(Array.isArray(best?.explanation.factorsConsidered));
    assert.ok(String(best?.explanation.note).includes('not an identification'));

    const view = await missingPersonOfficerClient
      .get(`/api/v1/missing-persons/${missingPersonReference}`)
      .expect(200);
    const stored = (view.body as { candidateMatches: { id: string; status: string }[] })
      .candidateMatches;
    assert.ok(stored.length > 0);
    assert.equal(stored[0]?.status, 'CANDIDATE');

    // The officer who ran the search cannot confirm the result themselves.
    await missingPersonOfficerClient
      .post(`/api/v1/matches/${stored[0]?.id}/review`, {
        decision: 'CONFIRMED',
        note: 'Attempting to confirm a match without the authority to do so.',
      })
      .expect(404);

    // A named supervisor confirms it; only then is anyone identified.
    const confirmed = await supervisorClient
      .post(`/api/v1/matches/${stored[0]?.id}/review`, {
        decision: 'CONFIRMED',
        note: 'Identified by the reporting brother at the hospital, who confirmed both features.',
      })
      .expect(201);
    assert.equal((confirmed.body as { status: string }).status, 'CONFIRMED');
  });

  test('18. a supervisor can approve restricted access', async () => {
    const requested = await investigatorClient
      .post('/api/v1/access-requests', {
        purpose: 'CRIMINAL_INVESTIGATION',
        resourceType: 'CITIZEN',
        subjectPcid: pcid,
        caseRef: caseNumber,
        requestedFields: ['citizen.lawEnforcementMarkers'],
        justification:
          'Needed to establish whether an active public-safety marker exists on this record for the enquiry.',
      })
      .expect(201);
    const reference = (requested.body as { reference: string; status: string }).reference;
    assert.equal((requested.body as { status: string }).status, 'PENDING_APPROVAL');

    // A supervisor who is also an investigator cannot approve their own request:
    // the refusal comes from the separation-of-duty control, not from lacking
    // the action.
    const ownRequest = await supervisorClient
      .post('/api/v1/access-requests', {
        purpose: 'CRIMINAL_INVESTIGATION',
        resourceType: 'CITIZEN',
        subjectPcid: pcid,
        caseRef: caseNumber,
        requestedFields: ['citizen.lawEnforcementMarkers'],
        justification: 'A supervising investigator requesting the same field on their own account.',
      })
      .expect(201);
    const ownReference = (ownRequest.body as { reference: string }).reference;
    const selfApproval = await supervisorClient
      .post(`/api/v1/access-requests/${ownReference}/decision`, {
        decision: 'APPROVED',
        note: 'Attempting to approve my own request.',
      })
      .expect(403);
    assert.equal((selfApproval.body as { error: { code: string } }).error.code, 'ACCESS_DENIED');
    assert.match(
      (selfApproval.body as { error: { message: string } }).error.message,
      /your own access request/i,
    );

    await supervisorClient
      .post(`/api/v1/access-requests/${reference}/decision`, {
        decision: 'APPROVED',
        approvedFields: ['citizen.lawEnforcementMarkers'],
        note: 'Approved for this case only; the enquiry is active and the field is proportionate.',
        ttlSeconds: 3600,
      })
      .expect(201);

    const afterApproval = await investigatorClient
      .get(`/api/v1/citizens/${pcid}?purpose=CRIMINAL_INVESTIGATION&caseRef=${caseNumber}`)
      .expect(200);
    const data = (afterApproval.body as { data: Record<string, unknown> }).data;
    assert.ok('lawEnforcementMarkers' in data, 'the approved field is now released');
  });

  test('19. a break-glass event can be initiated, and is bounded and reviewable', async () => {
    // A second incident led by another agency, so neither the responder nor
    // their service is attached to it: the grant has to do the work.
    const created = await dispatcherClient
      .post('/api/v1/incidents', {
        type: 'MEDICAL_EMERGENCY',
        severity: 'CRITICAL',
        description: 'Unresponsive casualty; identification needed to reach next of kin.',
        lgaCode: 'PL-JNO',
        wardCode: 'PL-JNO-01',
        leadAgencyId: policeAgencyId,
      })
      .expect(201);
    const secondIncident = (created.body as { incidentNumber: string }).incidentNumber;

    // Without an assignment there is no access, and the refusal does not confirm
    // that the incident exists.
    await responderClient
      .get(`/api/v1/citizens/${pcid}/emergency-profile?incidentRef=${secondIncident}`)
      .expect(404);

    const grant = await responderClient
      .post('/api/v1/break-glass', {
        resourceType: 'CITIZEN',
        subjectPcid: pcid,
        incidentRef: secondIncident,
        gates: ['INCIDENT_BINDING'],
        reason:
          'Casualty is unresponsive at the scene and next of kin must be reached before transfer.',
        ttlSeconds: 900,
      })
      .expect(201);
    const breakGlass = grant.body as { reference: string; expiresAt: string; reviewDueAt: string };
    assert.ok(new Date(breakGlass.expiresAt).getTime() - Date.now() <= 60 * 60 * 1000);
    assert.ok(breakGlass.reviewDueAt);

    const used = await responderClient
      .get(
        `/api/v1/citizens/${pcid}/emergency-profile?incidentRef=${secondIncident}&breakGlassRef=${breakGlass.reference}`,
      )
      .expect(200);
    assert.ok((used.body as { data: Record<string, unknown> }).data.emergencyContacts);

    // It lands in the review queue, and the officer who used it cannot clear it.
    const queue = await supervisorClient.get('/api/v1/break-glass/review-queue').expect(200);
    const entries = queue.body as { reference: string; timesUsed: number }[];
    const entry = entries.find((candidate) => candidate.reference === breakGlass.reference);
    assert.ok(entry, 'the grant must appear in the post-event review queue');
    assert.ok((entry?.timesUsed ?? 0) >= 1, 'the queue records that it was actually used');

    const selfReview = await responderClient
      .post(`/api/v1/break-glass/${breakGlass.reference}/review`, {
        decision: 'REVIEWED_JUSTIFIED',
        note: 'Attempting to review my own emergency access.',
      })
      .expect(404);
    assert.ok(
      selfReview.body,
      'a responder holds no review action, so the grant is not even visible',
    );

    await supervisorClient
      .post(`/api/v1/break-glass/${breakGlass.reference}/review`, {
        decision: 'REVIEWED_JUSTIFIED',
        note: 'Reviewed: the casualty was unresponsive and the use was proportionate.',
      })
      .expect(201);
  });

  test('20. every sensitive access is audited, and the chain verifies', async () => {
    const events = await auditorClient
      .get(`/api/v1/audit/events?subjectPcid=${pcid}&limit=100`)
      .expect(200);
    const body = events.body as {
      total: number;
      events: {
        action: string;
        outcome: string;
        purpose: string | null;
        breakGlassUsed: boolean;
        fieldsReleased: string[];
        citizenVisibility: string;
      }[];
    };

    assert.ok(body.total > 0);
    const actions = new Set(body.events.map((event) => event.action));
    for (const expected of [
      'CITIZEN_CREATE',
      'CITIZEN_VIEW',
      'EMERGENCY_PROFILE_VIEW',
      'LINK_RECORD',
    ]) {
      assert.ok(actions.has(expected), `the audit trail must contain ${expected}`);
    }
    assert.ok(
      body.events.some((event) => event.outcome === 'DENIED'),
      'refused attempts are audited as carefully as permitted ones',
    );
    assert.ok(
      body.events.some((event) => event.breakGlassUsed),
      'break-glass use is recorded as such',
    );
    assert.ok(
      body.events.some((event) => event.fieldsReleased.length > 0),
      'the audit records which fields were actually released',
    );

    const verification = await auditorClient.get('/api/v1/audit/verify').expect(200);
    const chain = verification.body as { intact: boolean; problems: unknown[] };
    assert.equal(chain.intact, true, 'the audit hash chain must be intact');
    assert.deepEqual(chain.problems, []);
  });

  test('21. the citizen can see permitted access history, and investigative access is withheld with a basis', async () => {
    const history = await citizenClient.get('/api/v1/me/access-history?limit=100').expect(200);
    const body = history.body as {
      total: number;
      note: string;
      accesses: { agency: string | null; purpose: string | null; action: string }[];
    };

    assert.ok(body.total > 0);
    assert.ok(
      body.accesses.some((entry) => entry.purpose === 'SERVICE_DELIVERY'),
      'the citizen sees the revenue service delivery access',
    );
    assert.equal(
      body.accesses.some((entry) => entry.purpose === 'CRIMINAL_INVESTIGATION'),
      false,
      'criminal investigation accesses are withheld from the citizen view, including the access requests raised about them',
    );
    assert.ok(
      body.note.includes('withheld'),
      'and the response says so rather than implying completeness',
    );

    // The Data Protection Officer can see what the citizen cannot, with the basis.
    const restricted = await auditorClient
      .get(
        `/api/v1/audit/events?subjectPcid=${pcid}&action=CITIZEN_VIEW&outcome=PERMITTED&limit=100`,
      )
      .expect(200);
    const withheld = (
      restricted.body as {
        events: { citizenVisibility: string; restrictionBasis: string | null }[];
      }
    ).events.filter((event) => event.citizenVisibility === 'ACCESS_RESTRICTED_FROM_CITIZEN');
    assert.ok(withheld.length > 0);
    assert.ok(
      (withheld[0]?.restrictionBasis ?? '').length > 20,
      'a restriction always states its basis',
    );
  });

  test('22. unauthorised users are blocked', async () => {
    // The revenue officer has no route to the investigation or the emergency data.
    await mdaOfficerClient.get(`/api/v1/cases/${caseNumber}`).expect(404);
    await mdaOfficerClient
      .get(`/api/v1/citizens/${pcid}/emergency-profile?incidentRef=${incidentNumber}`)
      .expect(404);
    await mdaOfficerClient
      .get(`/api/v1/citizens/${pcid}?purpose=CRIMINAL_INVESTIGATION&caseRef=${caseNumber}`)
      .expect(404);

    // The auditor reads logs, not the records behind them.
    await auditorClient.get(`/api/v1/citizens/${pcid}?purpose=SERVICE_DELIVERY`).expect(404);

    // The citizen cannot reach anyone else's record.
    await citizenClient
      .get('/api/v1/citizens/PL-ZZZZZ-YYYYY-XX?purpose=CITIZEN_SELF_SERVICE')
      .expect(400);
  });

  test('23. bulk extraction is prevented', async () => {
    // No role in the platform holds an export action at all.
    const me = await investigatorClient.get('/api/v1/auth/me').expect(200);
    assert.equal(
      (me.body as { actions: string[] }).actions.includes('CITIZEN_EXPORT'),
      false,
      'no seeded role grants a bulk export of the registry',
    );

    // Search is capped per account and answers 429 once the ceiling is reached.
    let limited = false;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await mdaOfficerClient.get(
        `/api/v1/citizens?purpose=SERVICE_DELIVERY&name=Dung&limit=100`,
      );
      if (response.status === 429) {
        limited = true;
        break;
      }
    }
    assert.equal(limited, true, 'repeated searching must be rate limited (§63)');

    // And the page size itself is bounded by the schema.
    await investigatorClient
      .get('/api/v1/citizens?purpose=CRIMINAL_INVESTIGATION&name=Dung&limit=5000')
      .expect(400);
  });

  test('24. the system remains functional when an integration fails', async () => {
    // A production data source pointed at an unreachable host.
    const source = await admin
      .post('/api/v1/integrations', {
        agencyId: landsAgencyId,
        domain: 'LANDS',
        systemName: 'Lands Registry Legacy',
        adapterKey: 'lands-production',
        mode: 'PRODUCTION',
        baseUrl: 'http://127.0.0.1:9/',
        config: { credentialEnvVar: 'TEST_LANDS_CREDENTIAL', timeoutMs: 250, maxRetries: 0 },
      })
      .expect(201);
    process.env.TEST_LANDS_CREDENTIAL = 'test-credential';

    const result = await admin
      .post(`/api/v1/integrations/${(source.body as { id: string }).id}/sync`)
      .expect(201);
    assert.equal((result.body as { status: string }).status, 'FAILED');

    // The platform keeps serving the last known good projection.
    const record = await citizenClient.get('/api/v1/me/record').expect(200);
    const property = (
      record.body as {
        cards: { key: string; status: string; items?: unknown[] }[];
      }
    ).cards.find((card) => card.key === 'PROPERTY');
    assert.equal(property?.status, 'RELEASED');
    assert.ok((property?.items?.length ?? 0) > 0);

    // And emergency response is entirely unaffected.
    await dispatcherClient.get(`/api/v1/incidents/${incidentNumber}`).expect(200);
    const health = await new ApiClient(context).get('/api/v1/health/ready').expect(200);
    assert.equal((health.body as { status: string }).status, 'ready');
  });

  test('25. the audit chain still verifies after the whole scenario', async () => {
    const verification = await auditorClient.get('/api/v1/audit/verify').expect(200);
    assert.equal((verification.body as { intact: boolean }).intact, true);
  });
});
