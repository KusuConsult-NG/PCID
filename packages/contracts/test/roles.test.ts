import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import { ROLE_DEFINITIONS, SEEDED_ROLES, roleDefinition } from '../src/roles';
import { isAction } from '../src/actions';

describe('seeded roles (§7)', () => {
  test('every seeded role has a definition and every action is known', () => {
    for (const name of SEEDED_ROLES) {
      const definition = roleDefinition(name);
      assert.ok(definition.description.length > 10, `${name} needs a description`);
      assert.ok(definition.actions.length > 0, `${name} must grant at least one action`);
      for (const action of definition.actions) {
        assert.ok(isAction(action), `${name} grants unknown action ${action}`);
      }
    }
    assert.equal(ROLE_DEFINITIONS.length, SEEDED_ROLES.length);
  });

  test('the platform administrator is technical only and holds no citizen-data action', () => {
    const admin = roleDefinition('PLATFORM_ADMINISTRATOR');
    assert.equal(admin.technicalOnly, true);
    for (const forbidden of [
      'CITIZEN_VIEW',
      'CITIZEN_SEARCH',
      'CITIZEN_EXPORT',
      'EMERGENCY_PROFILE_VIEW',
      'CASE_VIEW',
      'VEHICLE_VIEW',
      'PROPERTY_VIEW',
    ] as const) {
      assert.equal(
        admin.actions.includes(forbidden),
        false,
        `PLATFORM_ADMINISTRATOR must not hold ${forbidden} (§7)`,
      );
    }
  });

  test('the auditor can read logs but not the citizen data behind them', () => {
    const auditor = roleDefinition('AUDITOR');
    assert.ok(auditor.actions.includes('AUDIT_VIEW'));
    assert.equal(auditor.actions.includes('CITIZEN_VIEW'), false);
    assert.equal(auditor.actions.includes('CITIZEN_SEARCH'), false);
  });

  test('the analyst holds only aggregate actions', () => {
    const analyst = roleDefinition('ANALYST');
    assert.deepEqual([...analyst.actions].sort(), ['ALERT_VIEW', 'ANALYTICS_VIEW']);
  });

  test('the emergency responder is limited to the emergency profile, not the full record', () => {
    const responder = roleDefinition('EMERGENCY_RESPONDER');
    assert.ok(responder.actions.includes('EMERGENCY_PROFILE_VIEW'));
    assert.equal(responder.actions.includes('CITIZEN_VIEW'), false);
    assert.equal(responder.actions.includes('CITIZEN_SEARCH'), false);
    assert.equal(responder.actions.includes('CASE_VIEW'), false);
  });

  test('no role grants an export action other than those explicitly reviewed', () => {
    const exporters = ROLE_DEFINITIONS.filter((role) => role.actions.includes('CITIZEN_EXPORT'));
    assert.deepEqual(
      exporters.map((role) => role.name),
      [],
    );
  });
});
