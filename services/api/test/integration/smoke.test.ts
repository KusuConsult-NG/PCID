import { strict as assert } from 'node:assert';
import { after, before, describe, test } from 'node:test';

import { ApiClient, bootstrapAdmin, createAgency, createUser, signIn } from './harness';
import type { TestContext } from './harness';
import { createTestContext } from './harness';

describe('platform bootstrap and authentication', () => {
  let context: TestContext;
  let admin: Awaited<ReturnType<typeof bootstrapAdmin>>;
  let adminClient: ApiClient;

  before(async () => {
    context = await createTestContext('smoke');
    // Bootstrapping is idempotent by design, so it happens once here and the
    // credentials are shared: a second call would correctly decline to mint a
    // new authenticator. The session is shared too, because entitlements are
    // rebuilt from the database on every request rather than cached in the token.
    admin = await bootstrapAdmin(context);
    const session = await signIn(context, admin.email, admin.password, admin.totpSecret);
    adminClient = new ApiClient(context, session.accessToken);
  });
  after(async () => {
    await context?.close();
  });

  test('health endpoints answer before any data exists', async () => {
    const anonymous = new ApiClient(context);
    const live = await anonymous.get('/api/v1/health/live').expect(200);
    assert.equal((live.body as { status: string }).status, 'ok');
    const ready = await anonymous.get('/api/v1/health/ready').expect(200);
    assert.equal((ready.body as { status: string }).status, 'ready');
  });

  test('an unauthenticated request to a protected route is refused', async () => {
    const anonymous = new ApiClient(context);
    const response = await anonymous
      .get('/api/v1/citizens?purpose=SERVICE_DELIVERY&name=test')
      .expect(401);
    assert.equal((response.body as { error: { code: string } }).error.code, 'UNAUTHENTICATED');
  });

  test('every response carries a correlation id', async () => {
    const anonymous = new ApiClient(context);
    const response = await anonymous.get('/api/v1/health/live').expect(200);
    assert.ok(response.headers['x-correlation-id']);

    const supplied = await anonymous
      .get('/api/v1/health/live')
      .set('x-correlation-id', 'trace-abc-123')
      .expect(200);
    assert.equal(supplied.headers['x-correlation-id'], 'trace-abc-123');
  });

  test('the bootstrap administrator can sign in and step up, but holds no citizen data access', async () => {
    const me = await adminClient.get('/api/v1/auth/me').expect(200);
    const body = me.body as { roles: string[]; actions: string[]; authenticationLevel: string };
    assert.deepEqual(body.roles, ['PLATFORM_ADMINISTRATOR']);
    assert.equal(body.authenticationLevel, 'AAL2');
    for (const forbidden of [
      'CITIZEN_VIEW',
      'CITIZEN_SEARCH',
      'EMERGENCY_PROFILE_VIEW',
      'CASE_VIEW',
    ]) {
      assert.equal(
        body.actions.includes(forbidden),
        false,
        `the bootstrap administrator must not resolve ${forbidden}`,
      );
    }

    // And the API agrees: the route is refused, not merely hidden.
    await adminClient.get('/api/v1/citizens?purpose=SERVICE_DELIVERY&name=anyone').expect(404);
  });

  test('a wrong password is refused, and the message does not reveal whether the account exists', async () => {
    const anonymous = new ApiClient(context);
    const wrongPassword = await anonymous
      .post('/api/v1/auth/login', {
        email: 'platform.admin@pcid.plateaustate.gov.ng',
        password: 'not-the-password',
      })
      .expect(401);
    const noSuchAccount = await anonymous
      .post('/api/v1/auth/login', { email: 'nobody@example.gov.ng', password: 'not-the-password' })
      .expect(401);
    assert.equal(
      (wrongPassword.body as { error: { message: string } }).error.message,
      (noSuchAccount.body as { error: { message: string } }).error.message,
    );
  });

  test('a second factor is required before a step-up operation', async () => {
    const anonymous = new ApiClient(context);
    const login = await anonymous
      .post('/api/v1/auth/login', {
        email: 'platform.admin@pcid.plateaustate.gov.ng',
        password: 'Bootstrap-Passphrase-2026!',
      })
      .expect(201);
    const aal1 = new ApiClient(context, (login.body as { accessToken: string }).accessToken);

    const response = await aal1
      .post('/api/v1/agencies', {
        code: 'PLT-TEST',
        name: 'Test Agency',
        category: 'MDA',
        jurisdictionScope: 'STATE',
        jurisdictionLgaCodes: [],
        jurisdictionWardCodes: [],
        maxClassification: 'CONFIDENTIAL',
      })
      .expect(403);
    assert.equal((response.body as { error: { code: string } }).error.code, 'STEP_UP_REQUIRED');
  });

  test('a rotated refresh token cannot be reused, and reuse ends the session family', async () => {
    const anonymous = new ApiClient(context);
    const login = await anonymous
      .post('/api/v1/auth/login', {
        email: 'platform.admin@pcid.plateaustate.gov.ng',
        password: 'Bootstrap-Passphrase-2026!',
      })
      .expect(201);
    const original = (login.body as { refreshToken: string }).refreshToken;

    const rotated = await anonymous
      .post('/api/v1/auth/refresh', { refreshToken: original })
      .expect(201);
    const next = (rotated.body as { refreshToken: string }).refreshToken;
    assert.notEqual(next, original);

    await anonymous.post('/api/v1/auth/refresh', { refreshToken: original }).expect(401);
    // The replacement is revoked too, because the family was treated as compromised.
    await anonymous.post('/api/v1/auth/refresh', { refreshToken: next }).expect(401);
  });

  test('an agency is inert until it is activated and its agreement is signed', async () => {
    const created = await adminClient
      .post('/api/v1/agencies', {
        code: 'PLT-REV',
        name: 'Plateau State Internal Revenue Service',
        category: 'REVENUE',
        jurisdictionScope: 'STATE',
        jurisdictionLgaCodes: [],
        jurisdictionWardCodes: [],
        maxClassification: 'CONFIDENTIAL',
      })
      .expect(201);
    const agency = created.body as { id: string; status: string };
    assert.equal(agency.status, 'INACTIVE', 'a newly registered agency must grant nothing');

    const officer = await createUser(context, adminClient.currentToken as string, {
      email: 'revenue.officer@pcid.plateaustate.gov.ng',
      fullName: 'Revenue Officer',
      agencyId: agency.id,
      roles: ['MDA_OFFICER'],
      clearance: 'CONFIDENTIAL',
    });
    const officerSession = await signIn(
      context,
      officer.email,
      officer.password,
      officer.totpSecret,
    );
    const officerClient = new ApiClient(context, officerSession.accessToken);

    // The agency is not active, so nothing is available. The officer keeps one
    // session throughout: each step below proves the change takes effect on the
    // next request, without re-issuing a token.
    await officerClient
      .get('/api/v1/citizens?purpose=REVENUE_ADMINISTRATION&name=someone')
      .expect(404);

    await adminClient
      .patch(`/api/v1/agencies/${agency.id}/status`, { status: 'ACTIVE' })
      .expect(200);

    // Active, but still no data-sharing agreement in force.
    await officerClient
      .get('/api/v1/citizens?purpose=REVENUE_ADMINISTRATION&name=someone')
      .expect(404);

    await adminClient
      .patch(`/api/v1/agencies/${agency.id}/status`, { dataSharingAgreement: 'SIGNED' })
      .expect(200);

    await officerClient
      .get('/api/v1/citizens?purpose=REVENUE_ADMINISTRATION&name=someone')
      .expect(200);

    // And suspending the agency closes it again immediately.
    await adminClient
      .patch(`/api/v1/agencies/${agency.id}/status`, { status: 'SUSPENDED' })
      .expect(200);
    await officerClient
      .get('/api/v1/citizens?purpose=REVENUE_ADMINISTRATION&name=someone')
      .expect(404);
  });

  test('the law-enforcement compartment cannot be granted to an ineligible agency', async () => {
    const education = await createAgency(context, adminClient.currentToken as string, {
      code: 'PLT-EDU',
      name: 'Plateau State Ministry of Education',
      category: 'EDUCATION',
    });
    const response = await adminClient
      .post(`/api/v1/agencies/${education.id}/compartments/law-enforcement`, {
        legalBasis: 'An attempt to grant a compartment to an agency that is not eligible for it.',
      })
      .expect(403);
    assert.equal((response.body as { error: { code: string } }).error.code, 'ACCESS_DENIED');
  });
});
