import { strict as assert } from 'node:assert';
import { after, before, describe, test } from 'node:test';

import { ApiClient, bootstrapAdmin, createAgency, createUser, signIn } from './harness';
import type { TestContext } from './harness';
import { createTestContext } from './harness';

/**
 * The security agency's own work: cases, missing persons and the register of
 * people found who cannot say who they are
 * (master system prompt §13, §14, §15, §22, §51).
 *
 * Written from the investigator's and the missing-person officer's side, and as
 * carefully from the side of what neither of them may do: identify somebody by
 * assertion, edit a closed case, or reach a record on a case they are not on.
 */
describe('security agency work', () => {
  let context: TestContext;
  let adminToken: string;
  let investigator: ApiClient;
  let otherInvestigator: ApiClient;
  let supervisor: ApiClient;
  let missingPersonOfficer: ApiClient;
  let registrar: ApiClient;

  let supervisorUserId: string;
  let caseNumber: string;
  let pcid: string;

  before(async () => {
    context = await createTestContext('secagency');
    const bootstrap = await bootstrapAdmin(context);
    adminToken = (await signIn(context, bootstrap.email, bootstrap.password, bootstrap.totpSecret))
      .accessToken;

    const police = await createAgency(context, adminToken, {
      code: 'PLT-POLICE',
      name: 'Plateau State Police Command',
      category: 'SECURITY',
      maxClassification: 'LAW_ENFORCEMENT_RESTRICTED',
      lawEnforcementCompartment: true,
    });
    const registry = await createAgency(context, adminToken, {
      code: 'PLT-REGISTRY',
      name: 'Citizen Registry',
      category: 'MDA',
      maxClassification: 'HIGHLY_RESTRICTED',
    });

    const investigatorUser = await createUser(context, adminToken, {
      email: 'investigator@secagency.test',
      fullName: 'Case Officer',
      agencyId: police.id,
      roles: ['INVESTIGATOR'],
      clearance: 'LAW_ENFORCEMENT_RESTRICTED',
    });
    const secondInvestigator = await createUser(context, adminToken, {
      email: 'colleague@secagency.test',
      fullName: 'Another Case Officer',
      agencyId: police.id,
      roles: ['INVESTIGATOR'],
      clearance: 'LAW_ENFORCEMENT_RESTRICTED',
    });
    const supervisorUser = await createUser(context, adminToken, {
      email: 'supervisor@secagency.test',
      fullName: 'Command Supervisor',
      agencyId: police.id,
      roles: ['SUPERVISOR'],
      clearance: 'LAW_ENFORCEMENT_RESTRICTED',
    });
    supervisorUserId = supervisorUser.id;
    const mpOfficer = await createUser(context, adminToken, {
      email: 'missing@secagency.test',
      fullName: 'Missing Persons Desk',
      agencyId: police.id,
      roles: ['MISSING_PERSON_OFFICER'],
      clearance: 'LAW_ENFORCEMENT_RESTRICTED',
    });
    const registrarUser = await createUser(context, adminToken, {
      email: 'registrar@secagency.test',
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
    investigator = await session(investigatorUser);
    otherInvestigator = await session(secondInvestigator);
    supervisor = await session(supervisorUser);
    missingPersonOfficer = await session(mpOfficer);
    registrar = await session(registrarUser);

    const registered = await registrar
      .post('/api/v1/citizens', {
        givenName: 'Danladi',
        familyName: 'Pam',
        sex: 'MALE',
        dateOfBirth: '1979-02-17',
        phonePrimary: '08034440001',
        residentialAddress: '9 Murtala Mohammed Way, Jos',
        lgaCode: 'PL-JNO',
        wardCode: 'PL-JNO-01',
        channel: 'REGISTRATION_DESK',
      })
      .expect(201);
    pcid = (registered.body as { pcid: string }).pcid;

    const opened = await investigator
      .post('/api/v1/cases', {
        type: 'CRIMINAL_INVESTIGATION',
        title: 'Warehouse breaking, Terminus',
        summary: 'Reported overnight.',
        lgaCode: 'PL-JNO',
      })
      .expect(201);
    caseNumber = (opened.body as { caseNumber: string }).caseNumber;
  });

  after(async () => {
    await context.close();
  });

  test('a case can be corrected and advanced by an officer on it', async () => {
    const updated = await investigator
      .patch(`/api/v1/cases/${caseNumber}`, {
        title: 'Warehouse burglary, Terminus market',
        status: 'ACTIVE',
      })
      .expect(200);
    const body = updated.body as { title: string; status: string };
    assert.equal(body.title, 'Warehouse burglary, Terminus market');
    assert.equal(body.status, 'ACTIVE');
  });

  test('an officer not on the case can neither read it nor change it', async () => {
    await otherInvestigator.get(`/api/v1/cases/${caseNumber}`).expect(404);
    await otherInvestigator
      .patch(`/api/v1/cases/${caseNumber}`, { title: 'Renamed by somebody else' })
      .expect(404);
  });

  test('a case note is written, attributed, and cannot be edited away', async () => {
    await investigator
      .post(`/api/v1/cases/${caseNumber}/notes`, {
        body: 'Attended the scene at 07:40. The rear shutter had been forced. Two witnesses named.',
      })
      .expect(201);

    const view = await investigator.get(`/api/v1/cases/${caseNumber}`).expect(200);
    const notes = (view.body as { notes: { body: string; author: string }[] }).notes;
    assert.equal(notes.length, 1);
    assert.equal(notes[0]?.author, 'Case Officer');
    assert.match(notes[0]?.body ?? '', /rear shutter/);

    // There is no route that edits or removes a note.
    await investigator.patch(`/api/v1/cases/${caseNumber}/notes`, { body: 'Changed' }).expect(404);
  });

  test('an investigator cannot close their own case; a supervisor on it can', async () => {
    const opened = await investigator
      .post('/api/v1/cases', { type: 'FRAUD', title: 'To be closed', lgaCode: 'PL-JNO' })
      .expect(201);
    const reference = (opened.body as { caseNumber: string }).caseNumber;

    // Opening a case does not confer the right to close it: CASE_CLOSE belongs
    // to a supervisor, so the officer who ran the enquiry is not the one who
    // decides it is finished.
    await investigator
      .post(`/api/v1/cases/${reference}/close`, { closureNote: 'Closing my own case.' })
      .expect(404);

    // And a supervisor has to be on the case, not merely in the agency.
    await supervisor
      .post(`/api/v1/cases/${reference}/close`, { closureNote: 'Closing a case I am not on.' })
      .expect(404);

    // Assigning is an agency-authority act, which is what breaks the deadlock.
    await supervisor
      .post(`/api/v1/cases/${reference}/assignments`, {
        userId: supervisorUserId,
        role: 'SUPERVISOR',
      })
      .expect(201);
    await supervisor
      .post(`/api/v1/cases/${reference}/close`, { closureNote: 'No offence made out.' })
      .expect(201);

    // The engine refuses before the service does: a closed case is not an active
    // one, and the binding gate says so. The officer is on the case, so naming
    // the reason leaks nothing and tells them what to do about it.
    const refused = await investigator
      .patch(`/api/v1/cases/${reference}`, { title: 'Reopened by editing' })
      .expect(403);
    const error = refused.body as { error: { code: string; message: string } };
    assert.equal(error.error.code, 'ACCESS_DENIED');
    assert.match(error.error.message, /not active|closed/i);
  });

  test('a missing-person record can be revised as the enquiry develops', async () => {
    const reported = await missingPersonOfficer
      .post('/api/v1/missing-persons', {
        fullName: 'Rahila Choji',
        ageYears: 16,
        sex: 'FEMALE',
        circumstances: 'Did not return from school.',
        lastSeenAddress: 'Rukuba Road, Jos',
        lastSeenLgaCode: 'PL-JNO',
      })
      .expect(201);
    const reference = (reported.body as { caseReference: string }).caseReference;

    const revised = await missingPersonOfficer
      .patch(`/api/v1/missing-persons/${reference}`, {
        status: 'ACTIVE',
        physicalDescription: 'About 1.6m, plaited hair, wearing a green school uniform.',
      })
      .expect(200);
    const body = revised.body as { status: string; physicalDescription: string };
    assert.equal(body.status, 'ACTIVE');
    assert.match(body.physicalDescription, /green school uniform/);

    // Resolving is a different entitlement and demands an outcome.
    const refused = await missingPersonOfficer
      .patch(`/api/v1/missing-persons/${reference}`, { status: 'LOCATED' })
      .expect(400);
    assert.equal((refused.body as { error: { code: string } }).error.code, 'VALIDATION_FAILED');
  });

  test('a sighting arrives unverified, and discounting it is an outcome', async () => {
    const reported = await missingPersonOfficer
      .post('/api/v1/missing-persons', {
        fullName: 'Yakubu Dalyop',
        ageYears: 71,
        sex: 'MALE',
        circumstances: 'Walked out of the family compound and did not return.',
        lastSeenLgaCode: 'PL-JSO',
      })
      .expect(201);
    const reference = (reported.body as { caseReference: string }).caseReference;

    const sighting = await missingPersonOfficer
      .post(`/api/v1/missing-persons/${reference}/sightings`, {
        description: 'A caller says an elderly man matching the description was at Bukuru market.',
        addressText: 'Bukuru market',
        lgaCode: 'PL-JSO',
        reporterName: 'Market trader',
      })
      .expect(201);
    const created = sighting.body as { id: string; verificationStatus: string };
    assert.equal(
      created.verificationStatus,
      'UNVERIFIED',
      'a sighting is not a fact until somebody checks it',
    );

    const view = await missingPersonOfficer.get(`/api/v1/missing-persons/${reference}`).expect(200);
    const sightings = (view.body as { sightings: { verificationStatus: string }[] }).sightings;
    assert.equal(sightings.length, 1);
    assert.equal(sightings[0]?.verificationStatus, 'UNVERIFIED');

    await missingPersonOfficer
      .post(`/api/v1/sightings/${created.id}/verification`, { verificationStatus: 'DISCOUNTED' })
      .expect(201);

    const after = await missingPersonOfficer
      .get(`/api/v1/missing-persons/${reference}`)
      .expect(200);
    const reviewed = (after.body as { sightings: { verificationStatus: string }[] }).sightings;
    assert.equal(reviewed[0]?.verificationStatus, 'DISCOUNTED');
  });

  test('the unidentified-person register can be read, which is the point of it', async () => {
    const recorded = await missingPersonOfficer
      .post('/api/v1/unidentified-persons', {
        condition: 'UNCONSCIOUS',
        estimatedAgeMin: 60,
        estimatedAgeMax: 75,
        apparentSex: 'MALE',
        physicalDescription: 'Elderly man, grey beard, no identification on him.',
        foundAddress: 'Bukuru junction',
        foundLgaCode: 'PL-JSO',
      })
      .expect(201);
    const reference = (recorded.body as { reference: string }).reference;

    const listed = await missingPersonOfficer.get('/api/v1/unidentified-persons').expect(200);
    const body = listed.body as { total: number; records: { reference: string }[] };
    assert.ok(body.total >= 1);
    assert.ok(body.records.some((record) => record.reference === reference));

    const viewed = await missingPersonOfficer
      .get(`/api/v1/unidentified-persons/${reference}`)
      .expect(200);
    const record = viewed.body as {
      status: string;
      physicalDescription: string;
      candidateMatches: unknown[];
    };
    assert.equal(record.status, 'UNIDENTIFIED');
    assert.match(record.physicalDescription, /grey beard/);
    assert.ok(Array.isArray(record.candidateMatches));
  });

  test('an unidentified-person record can be updated, but never identified by assertion', async () => {
    const recorded = await missingPersonOfficer
      .post('/api/v1/unidentified-persons', {
        condition: 'INJURED',
        physicalDescription: 'Young woman, scar above the left eyebrow.',
        foundLgaCode: 'PL-JNO',
      })
      .expect(201);
    const reference = (recorded.body as { reference: string }).reference;

    const updated = await missingPersonOfficer
      .patch(`/api/v1/unidentified-persons/${reference}`, {
        status: 'UNDER_REVIEW',
        identityClues: 'A bus ticket from Bauchi in a pocket.',
      })
      .expect(200);
    assert.equal((updated.body as { status: string }).status, 'UNDER_REVIEW');

    // There is no field on this route that sets who somebody is. Identity comes
    // only from confirming a candidate match, which a database constraint
    // refuses without a named human reviewer (§13).
    const refused = await missingPersonOfficer
      .patch(`/api/v1/unidentified-persons/${reference}`, { identifiedPcid: pcid })
      .expect(400);
    assert.equal((refused.body as { error: { code: string } }).error.code, 'VALIDATION_FAILED');

    const viewed = await missingPersonOfficer
      .get(`/api/v1/unidentified-persons/${reference}`)
      .expect(200);
    assert.equal(
      (viewed.body as { identifiedPcid?: string | null }).identifiedPcid ?? null,
      null,
      'nobody has been identified',
    );
  });

  test('an ordinary officer holds none of these actions', async () => {
    await registrar.get('/api/v1/unidentified-persons').expect(404);
    await registrar.patch(`/api/v1/cases/${caseNumber}`, { title: 'Not mine' }).expect(404);
  });
});
