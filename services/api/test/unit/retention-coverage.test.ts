import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { RETENTION_BATCH_LIMIT, RETENTION_POLICIES, retentionPolicy } from '@pcid/contracts';

import {
  RETENTION_RULES,
  RETENTION_TABLES,
  retentionCutoff,
  retentionRuleFor,
} from '../../src/retention/retention.rules';

/**
 * Every retention period must have something that applies it.
 *
 * This is the `action-coverage` test of the retention schedule, and it exists
 * for the same reason: `docs/privacy.md` printed a table of periods for eleven
 * phases, `citizen.retention_policy` carried a default, `location_retention_until`
 * was set on every incident - and no code read any of it. A policy with no rule
 * behind it is not a weaker control than a missing one; it is worse, because it
 * is counted as present by anyone who reads the schedule.
 *
 * So the correspondence is asserted in both directions, and a policy added to
 * the catalogue with nothing behind it fails the build.
 */
describe('retention coverage', () => {
  test('every policy that disposes of data has a rule that does it', () => {
    const implemented = new Set(RETENTION_RULES.map((rule) => rule.policy));
    const unapplied = RETENTION_POLICIES.filter((policy) => policy.disposition !== 'KEEP')
      .map((policy) => policy.key)
      .filter((key) => !implemented.has(key));

    assert.deepEqual(
      unapplied,
      [],
      'these policies state a period and nothing applies it, which is the defect this phase exists ' +
        'to fix. Add a rule in retention.rules.ts, or change the policy to KEEP and say why.',
    );
  });

  test('every rule names a policy the catalogue defines, and agrees with it', () => {
    for (const rule of RETENTION_RULES) {
      const policy = retentionPolicy(rule.policy);
      assert.notEqual(
        policy.disposition,
        'KEEP',
        `${rule.policy} is kept by the catalogue; no rule may erase it`,
      );
      assert.equal(
        rule.disposition,
        policy.disposition,
        `${rule.policy}: the rule and the catalogue disagree about what happens`,
      );
    }
  });

  test('one rule per policy: two would erase the same rows on two schedules', () => {
    const seen = new Set<string>();
    for (const rule of RETENTION_RULES) {
      assert.ok(!seen.has(rule.policy), `${rule.policy} has more than one rule`);
      seen.add(rule.policy);
    }
  });

  test('no rule touches the register, a case, or the audit trail', () => {
    // Belt and braces with the grants in migration 0016: the database refuses
    // these, and so does the build. The tables named here are the ones whose
    // erasure would be a data loss rather than a data-protection act.
    for (const forbidden of [
      'citizen',
      'pcid_allocation',
      'audit_event',
      'audit_chain_head',
      'investigation_case',
      'case_note',
      'case_document',
      'missing_person',
      'government_user',
      'citizen_account',
    ]) {
      assert.ok(
        !RETENTION_TABLES.includes(forbidden),
        `${forbidden} must never be on a retention sweep's list`,
      );
    }
  });

  test('every statement is bounded and parameterised', () => {
    for (const rule of RETENTION_RULES) {
      assert.ok(
        rule.erase.includes('$1'),
        `${rule.policy}: the cutoff must come from a parameter, not from the statement`,
      );
      assert.ok(
        rule.erase.includes('$2'),
        `${rule.policy}: the erasure must take a row limit - the first sweep on a deployment that ` +
          'has been collecting for a year meets a year of rows at once',
      );
      assert.ok(rule.due.includes('$1'), `${rule.policy}: the due count must take the cutoff`);
      assert.ok(
        /\bLIMIT\b/.test(rule.due),
        `${rule.policy}: the due count must be bounded, or the page that shows it will not load`,
      );
    }
  });

  test('an AGE cutoff is the period behind now, and a DUE_DATE cutoff is now', () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    for (const rule of RETENTION_RULES) {
      const cutoff = retentionCutoff(rule, now);
      if (rule.cutoff === 'DUE_DATE') {
        // The row carries its own date because the period was applied when it
        // was written. Subtracting the period again would keep it for twice as
        // long as the schedule says.
        assert.equal(cutoff.getTime(), now.getTime(), `${rule.policy} must compare against now`);
      } else {
        const days = retentionPolicy(rule.policy).retainDays ?? 0;
        assert.equal(
          cutoff.getTime(),
          now.getTime() - days * 86_400_000,
          `${rule.policy} must use exactly the catalogue's period`,
        );
      }
    }
  });

  test('the incident location rule reads the date on the row, not a computed one', () => {
    const rule = retentionRuleFor('INCIDENT_STANDARD');
    assert.equal(rule.cutoff, 'DUE_DATE');
    assert.ok(rule.erase.includes('location_retention_until'));
    // The incident survives its location. Erasing the record of an emergency
    // because ninety days passed would be destroying a public-safety record.
    assert.ok(!/DELETE\s+FROM\s+incident/i.test(rule.erase));
  });

  test('a batch cannot exceed the catalogue ceiling', () => {
    assert.ok(RETENTION_BATCH_LIMIT > 0 && RETENTION_BATCH_LIMIT <= 50_000);
  });
});
