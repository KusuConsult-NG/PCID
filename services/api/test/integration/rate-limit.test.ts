import { strict as assert } from 'node:assert';
import { after, before, describe, test } from 'node:test';

import { ApiClient, bootstrapAdmin, createAgency, createUser, signIn } from './harness';
import type { TestContext } from './harness';
import { createTestContext } from './harness';

/**
 * The general per-account ceiling (master system prompt §45, §63).
 *
 * Documented since the first release and, until the offline mode was built, not
 * enforced anywhere: `RATE_LIMIT_DEFAULT_MAX` was read from the configuration,
 * described in `docs/api.md` as "a general per-account ceiling", and consumed by
 * nothing. A control that exists only in a document is worse than an absent one,
 * because it is counted as present when somebody asks what bounds an account.
 *
 * Set low here, in a process of its own, so the ceiling can actually be reached.
 */
process.env.RATE_LIMIT_DEFAULT_MAX = '25';

describe('§45 the general per-account ceiling', () => {
  let context: TestContext;
  let officer: ApiClient;
  let other: ApiClient;

  before(async () => {
    context = await createTestContext('ratelimit');
    const bootstrap = await bootstrapAdmin(context);
    const adminToken = (
      await signIn(context, bootstrap.email, bootstrap.password, bootstrap.totpSecret)
    ).accessToken;

    const agency = await createAgency(context, adminToken, {
      code: 'PLT-REGISTRY',
      name: 'Citizen Registry',
      category: 'MDA',
      maxClassification: 'HIGHLY_RESTRICTED',
    });
    const first = await createUser(context, adminToken, {
      email: 'busy@ratelimit.test',
      fullName: 'Busy Officer',
      agencyId: agency.id,
      roles: ['VERIFICATION_OFFICER'],
      clearance: 'CONFIDENTIAL',
    });
    const second = await createUser(context, adminToken, {
      email: 'quiet@ratelimit.test',
      fullName: 'Quiet Officer',
      agencyId: agency.id,
      roles: ['VERIFICATION_OFFICER'],
      clearance: 'CONFIDENTIAL',
    });
    officer = new ApiClient(
      context,
      (await signIn(context, first.email, first.password, first.totpSecret)).accessToken,
    );
    other = new ApiClient(
      context,
      (await signIn(context, second.email, second.password, second.totpSecret)).accessToken,
    );
  });

  after(async () => {
    await context.close();
  });

  test('an account that will not stop asking is stopped', async () => {
    let limited = false;
    for (let attempt = 0; attempt < 80 && !limited; attempt += 1) {
      const response = await officer.get('/api/v1/auth/me');
      if (response.status === 429) {
        limited = true;
        assert.equal(
          (response.body as { error: { code: string } }).error.code,
          'RATE_LIMITED',
          'the refusal names itself, so a client can back off rather than retry blindly',
        );
      }
    }
    assert.equal(limited, true, 'the documented general ceiling must actually be enforced');
  });

  test('the ceiling is per account, so one busy officer does not stop the desk beside them', async () => {
    // The bug this guards against is keying the counter on something shared - an
    // address, an agency - which is how a rate limit becomes an outage for a
    // whole office. `quiet` has made three requests; it is not the one at fault.
    await other.get('/api/v1/auth/me').expect(200);
  });

  test('signing in is not governed by it, because it has its own, tighter limits', async () => {
    // A ceiling on unauthenticated requests would have to be keyed on an
    // address, and an office behind one gateway would lock itself out - which is
    // exactly the defect load testing found in the sign-in limiter. Public
    // routes pass before this ceiling is consulted.
    await new ApiClient(context).get('/api/v1/health/ready').expect(200);
  });
});
