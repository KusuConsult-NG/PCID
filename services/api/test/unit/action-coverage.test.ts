import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { ACTIONS, ROLE_DEFINITIONS } from '@pcid/contracts';
import type { Action } from '@pcid/contracts';

import '../../src/common/openapi/routes-index';
import { registeredRoutes } from '../../src/common/openapi/registry';

/**
 * Every entitlement a role grants must be one somebody can exercise.
 *
 * An action granted by a seeded role with no route behind it is not harmless. It
 * reads, in the role definition and in `GET /auth/me`, as a capability the
 * account has - so an administrator assigns the role believing the work can be
 * done, and the officer finds there is nothing to click. Three of these
 * (`CORRECTION_REQUEST_REVIEW`, `ALERT_VIEW`, `ALERT_REVIEW`) survived four
 * phases unnoticed: the Data Protection Officer role promised oversight of
 * correction requests and alerts, and the platform offered no way to do either.
 *
 * So the coverage is asserted rather than reviewed. Routes declare the actions
 * they perform; this compares that against what the roles grant, in both
 * directions.
 */
describe('authorisation coverage', () => {
  const declared = new Set<Action>();
  for (const route of registeredRoutes()) {
    for (const action of route.actions ?? []) declared.add(action);
  }

  const granted = new Set<Action>();
  for (const role of ROLE_DEFINITIONS) {
    for (const action of role.actions) granted.add(action);
  }

  /**
   * Actions seeded ahead of the phase that implements them.
   *
   * These are deliberate, and each names the surface that will perform it. The
   * list is here rather than in a comment somewhere so that it can only shrink:
   * an entry that becomes reachable fails the test below, which is what stops it
   * quietly becoming permanent.
   */
  const AWAITING_A_SURFACE: Readonly<Record<string, string>> = Object.freeze({
    RELATIONSHIP_VIEW: 'household and relationship records',
    RESPONSE_UNIT_MANAGE: 'emergency response portal',
    IMPORT_RUN: 'bulk registration import',
    ADMIN_ROLE_MANAGE: 'role administration',
    ADMIN_REFERENCE_DATA_MANAGE: 'reference data administration',
    ADMIN_NOTIFICATION_RULE_MANAGE: 'notification rule administration',
    ADMIN_SYSTEM_MANAGE: 'platform settings administration',
  });

  test('every action a seeded role grants is performed by a documented route', () => {
    const unreachable = [...granted]
      .filter((action) => !declared.has(action))
      .filter((action) => AWAITING_A_SURFACE[action] === undefined)
      .sort();

    assert.deepEqual(
      unreachable,
      [],
      unreachable.length === 0
        ? ''
        : `granted by a role but performed by no route: ${unreachable.join(', ')}. ` +
            'Either build the route, or add the action to AWAITING_A_SURFACE naming what will.',
    );
  });

  test('nothing stays on the waiting list after it is built', () => {
    const stale = Object.keys(AWAITING_A_SURFACE)
      .filter((action) => declared.has(action as Action))
      .sort();

    assert.deepEqual(
      stale,
      [],
      `now reachable and should be removed from AWAITING_A_SURFACE: ${stale.join(', ')}`,
    );
  });

  test('the waiting list names only real actions', () => {
    const unknown = Object.keys(AWAITING_A_SURFACE)
      .filter((action) => !(ACTIONS as readonly string[]).includes(action))
      .sort();
    assert.deepEqual(unknown, [], `not actions at all: ${unknown.join(', ')}`);
  });

  test('a route never claims an action that does not exist', () => {
    const unknown = [...declared]
      .filter((action) => !(ACTIONS as readonly string[]).includes(action))
      .sort();
    assert.deepEqual(unknown, [], `routes claim unknown actions: ${unknown.join(', ')}`);
  });

  test('every route that reads citizen data declares what it needs', () => {
    // A route under /citizens, /me or /verification acts on the register. If it
    // declares no action, either it performs none - which for these paths would
    // be the bug - or somebody forgot, and the coverage test above goes blind.
    const undeclared = registeredRoutes()
      .filter((route) => /\/(citizens|verification)\b|^\/api\/v1\/me\//.test(route.path))
      .filter((route) => route.actions === undefined)
      .map((route) => `${route.method.toUpperCase()} ${route.path}`)
      .sort();

    assert.deepEqual(
      undeclared,
      [
        // Authentication and account security, which are not reads of the
        // register: the account is the caller, not the subject.
        'GET /api/v1/me/sessions',
        'DELETE /api/v1/me/sessions/:sessionId',
        'POST /api/v1/me/password',
        'POST /api/v1/me/mfa/enrol',
        'POST /api/v1/me/mfa/confirm',
      ].sort(),
    );
  });
});
