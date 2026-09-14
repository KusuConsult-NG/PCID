import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

import {
  ACTIONS,
  DEVICE_PLATFORMS,
  DEVICE_REVOCATION_REASONS,
  OFFLINE_BUNDLE_KINDS,
  OFFLINE_BUNDLE_MAX_RECORDS,
  OFFLINE_BUNDLE_MAX_TTL_SECONDS,
  ROLE_DEFINITIONS,
  isDevicePlatform,
  offlineBundleTtlSeconds,
} from '../src/index';

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  resolve(here, '../../../db/migrations/0015_registered_devices_and_offline.sql'),
  'utf8',
);

/**
 * The controlled offline mode's bounds (master system prompt §56).
 *
 * These numbers are the difference between "a crew can read a casualty's blood
 * group in a tunnel" and "a copy of the register is on a phone in a ditch", and
 * they are asserted in three places on purpose: here, in the service that writes
 * the release, and in a `CHECK` constraint on the table. This file holds the
 * first two to the third, because a bound that only exists in the code that
 * happens to run is not a bound.
 */
describe('§56 offline bounds', () => {
  test('no bundle may outlive the ceiling the database enforces', () => {
    for (const kind of OFFLINE_BUNDLE_KINDS) {
      const ttl = offlineBundleTtlSeconds(kind);
      assert.ok(ttl > 0, `${kind} must expire`);
      assert.ok(
        ttl <= OFFLINE_BUNDLE_MAX_TTL_SECONDS,
        `${kind} lasts ${ttl}s, past the ${OFFLINE_BUNDLE_MAX_TTL_SECONDS}s ceiling`,
      );
    }
    // The ceiling in the contract and the interval in the constraint are the
    // same number said two ways. If somebody raises one, this fails.
    const hours = OFFLINE_BUNDLE_MAX_TTL_SECONDS / 3600;
    assert.match(
      migration,
      new RegExp(`expires_at <= released_at \\+ interval '${hours} hours'`),
      'the schema constraint must match OFFLINE_BUNDLE_MAX_TTL_SECONDS',
    );
  });

  test('an incident pack expires within a shift, and well inside the ceiling', () => {
    const pack = offlineBundleTtlSeconds('INCIDENT_PROFILES');
    assert.ok(pack <= 8 * 60 * 60, 'a pack must not outlast the shift that took it');
    assert.ok(pack < offlineBundleTtlSeconds('CITIZEN_CARD'), 'a casualty pack is the shorter one');
  });

  test('the record cap in the contract is the one the database will accept', () => {
    assert.match(
      migration,
      new RegExp(`record_count >= 0 AND record_count <= ${OFFLINE_BUNDLE_MAX_RECORDS}`),
      'the schema check must match OFFLINE_BUNDLE_MAX_RECORDS',
    );
    // Big enough for a bus crash, small enough that nobody could call it an
    // extract. The service refuses past it rather than truncating, because a
    // crew cannot tell a shortened list of casualties from a complete one.
    assert.ok(OFFLINE_BUNDLE_MAX_RECORDS >= 40 && OFFLINE_BUNDLE_MAX_RECORDS <= 100);
  });

  test('every vocabulary the platform stores is one the database allows', () => {
    for (const platform of DEVICE_PLATFORMS) {
      assert.ok(migration.includes(`'${platform}'`), `${platform} is not in the schema`);
    }
    for (const reason of DEVICE_REVOCATION_REASONS) {
      assert.ok(migration.includes(`'${reason}'`), `${reason} is not in the schema`);
    }
    for (const kind of OFFLINE_BUNDLE_KINDS) {
      assert.ok(migration.includes(`'${kind}'`), `${kind} is not in the schema`);
    }
  });

  test('holding something offline is its own entitlement, granted to two roles', () => {
    assert.ok((ACTIONS as readonly string[]).includes('OFFLINE_ACCESS'));

    const holders = ROLE_DEFINITIONS.filter((role) =>
      (role.actions as readonly string[]).includes('OFFLINE_ACCESS'),
    ).map((role) => role.name);

    // Keeping a release is a different question from making it, which is why it
    // is a separate action: an administrator can take it away from a role
    // without taking away the reads that role needs to do its job.
    assert.deepEqual(holders.sort(), ['CITIZEN', 'EMERGENCY_RESPONDER']);
  });

  test('a platform the client invents is not a platform', () => {
    assert.equal(isDevicePlatform('ANDROID'), true);
    assert.equal(isDevicePlatform('android'), false);
    assert.equal(isDevicePlatform('WEARABLE'), false);
    assert.equal(isDevicePlatform(null), false);
  });
});
