import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

import {
  RETENTION_POLICIES,
  RETENTION_POLICY_KEYS,
  enforceableRetentionPolicies,
  isRetentionPolicyKey,
  retentionPolicy,
} from '../src/retention';

const migration = readFileSync(
  fileURLToPath(new URL('../../../db/migrations/0016_retention_and_erasure.sql', import.meta.url)),
  'utf8',
);

/**
 * The retention catalogue is a promise made to a regulator.
 *
 * `docs/privacy.md` prints these periods, and for eleven phases nothing applied
 * them. What follows holds the catalogue to the properties that make it a
 * control rather than a claim: every entry says why, every period is a real
 * number, the schema agrees with it, and nothing in it can reach the audit
 * trail or the register.
 */
describe('the retention catalogue', () => {
  test('every policy states why its period is that period', () => {
    for (const policy of RETENTION_POLICIES) {
      assert.ok(
        policy.basis.length > 80,
        `${policy.key} needs a stated basis: a schedule whose durations have no reason cannot be ` +
          'defended, and cannot be revised by anyone who did not choose them',
      );
      assert.ok(policy.holds.length > 10, `${policy.key} must say what it covers`);
    }
  });

  test('a period is present exactly when something is disposed of', () => {
    for (const policy of RETENTION_POLICIES) {
      if (policy.disposition === 'KEEP') {
        assert.equal(policy.retainDays, null, `${policy.key} is kept and cannot have a period`);
      } else {
        assert.ok(
          typeof policy.retainDays === 'number' && policy.retainDays > 0,
          `${policy.key} disposes of data and must say after how long`,
        );
      }
    }
  });

  test('only a redaction names columns, and it must name at least one', () => {
    for (const policy of RETENTION_POLICIES) {
      if (policy.disposition === 'REDACT') {
        assert.ok(
          (policy.redacts ?? []).length > 0,
          `${policy.key} redacts, so it must say what it empties`,
        );
      } else {
        assert.equal(
          policy.redacts,
          undefined,
          `${policy.key} does not redact and must not name columns`,
        );
      }
    }
  });

  test('the identity register and the audit trail are kept, and the schedule says so', () => {
    // Not a style point. A retention schedule with no entry for the audit trail
    // reads as an omission; one that says KEEP, and why, is an answer. And a
    // future change that gave either of these a period would fail here before it
    // reached a database that would refuse it anyway.
    for (const key of ['CITIZEN_IDENTITY_LONG_TERM', 'AUDIT_LONG_TERM', 'SECURITY_CASE_LEGAL']) {
      assert.ok(isRetentionPolicyKey(key));
      assert.equal(retentionPolicy(key).disposition, 'KEEP', `${key} must never be swept`);
    }
  });

  test('the schema accepts exactly the policy keys the catalogue defines', () => {
    for (const [table, key] of [
      ['citizen', 'CITIZEN_IDENTITY_LONG_TERM'],
      ['incident', 'INCIDENT_STANDARD'],
      ['investigation_case', 'SECURITY_CASE_LEGAL'],
    ] as const) {
      assert.ok(
        migration.includes(`retention_policy IN ('${key}')`),
        `migration 0016 must constrain ${table}.retention_policy to ${key}`,
      );
      assert.ok(RETENTION_POLICY_KEYS.includes(key));
    }
  });

  test('the ledger records a disposition the catalogue can produce', () => {
    assert.ok(
      migration.includes("disposition IN ('DELETE','REDACT')"),
      'retention_erasure must accept the dispositions that actually erase, and only those',
    );
  });

  test('the ledger cannot be edited or deleted', () => {
    // A record of erasures that could itself be erased would prove nothing.
    assert.ok(migration.includes('retention_erasure_no_update'));
    assert.ok(migration.includes('retention_erasure_no_delete'));
  });

  test('the sweep is granted DELETE on no table holding a person, a case or an audit event', () => {
    const grant = /GRANT DELETE ON ([^;]+) TO pcid_app/.exec(migration);
    assert.ok(grant !== null, 'migration 0016 must state which tables the sweep may delete from');
    const tables = grant[1]
      .split(',')
      .map((name) => name.trim().replace(/\s+/g, ' '))
      .filter((name) => name.length > 0);
    for (const forbidden of ['citizen', 'audit_event', 'investigation_case', 'pcid_allocation']) {
      assert.ok(
        !tables.includes(forbidden),
        `the retention sweep must never hold DELETE on ${forbidden}`,
      );
    }
  });

  test('the policies the sweep acts on are the ones that dispose of something', () => {
    assert.deepEqual(
      enforceableRetentionPolicies().map((policy) => policy.key),
      RETENTION_POLICIES.filter((policy) => policy.disposition !== 'KEEP').map(
        (policy) => policy.key,
      ),
    );
  });

  test('an unknown policy is refused rather than given a default period', () => {
    // A sweep that met a policy it did not recognise and guessed would erase on
    // a schedule nobody wrote down.
    assert.throws(() => retentionPolicy('NOT_A_POLICY' as never), /unknown retention policy/);
    assert.equal(isRetentionPolicyKey('NOT_A_POLICY'), false);
  });
});
