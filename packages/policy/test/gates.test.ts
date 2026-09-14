import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import { ACTION_PURPOSES, ACTION_RESOURCE_TYPES } from '../src/action-metadata';
import { evaluate, projectFields, restrictedFieldPaths } from '../src/engine';
import {
  NOW,
  approval,
  breakGlass,
  caseContext,
  incidentContext,
  request,
  resource,
  subject,
} from './fixtures';

describe('standing and authentication gates', () => {
  test('a suspended, locked or disabled account is refused before anything else', () => {
    for (const status of ['SUSPENDED', 'LOCKED', 'DISABLED'] as const) {
      const decision = evaluate(
        request({
          subject: subject(['MDA_OFFICER'], { accountStatus: status }),
          action: 'CITIZEN_VIEW',
          purpose: 'SERVICE_DELIVERY',
          resource: resource('CITIZEN'),
        }),
      );
      assert.equal(decision.effect, 'DENY');
      assert.equal(decision.reasons[0]?.gate, 'ACCOUNT_STANDING');
    }
  });

  test('an agency that is not active in the registry cannot act (§6)', () => {
    for (const status of ['SUSPENDED', 'INACTIVE'] as const) {
      const decision = evaluate(
        request({
          subject: subject(['MDA_OFFICER'], { agencyStatus: status }),
          action: 'CITIZEN_VIEW',
          purpose: 'SERVICE_DELIVERY',
          resource: resource('CITIZEN'),
        }),
      );
      assert.equal(decision.effect, 'DENY');
      assert.equal(decision.reasons[0]?.gate, 'AGENCY_STANDING');
    }
  });

  test('citizen information needs a data-sharing agreement in force (§6)', () => {
    for (const status of ['PENDING', 'EXPIRED', 'SUSPENDED', 'NONE'] as const) {
      const decision = evaluate(
        request({
          subject: subject(['MDA_OFFICER'], { dataSharingAgreement: status }),
          action: 'CITIZEN_VIEW',
          purpose: 'SERVICE_DELIVERY',
          resource: resource('CITIZEN'),
        }),
      );
      assert.equal(decision.effect, 'DENY');
      assert.equal(decision.reasons[0]?.gate, 'DATA_SHARING_AGREEMENT');
    }

    // Non-citizen work is unaffected by the agreement status.
    const operational = evaluate(
      request({
        subject: subject(['DISPATCHER'], { dataSharingAgreement: 'EXPIRED' }),
        action: 'RESPONSE_UNIT_VIEW',
        purpose: 'EMERGENCY_RESPONSE',
        resource: resource('RESPONSE_UNIT', { classification: 'INTERNAL', subjectPcid: null }),
      }),
    );
    assert.equal(operational.effect, 'PERMIT');
  });

  test('MFA is mandatory for government users (§42)', () => {
    const decision = evaluate(
      request({
        subject: subject(['MDA_OFFICER'], { mfaEnrolled: false }),
        action: 'CITIZEN_VIEW',
        purpose: 'SERVICE_DELIVERY',
        resource: resource('CITIZEN'),
      }),
    );
    assert.equal(decision.effect, 'DENY');
    assert.equal(decision.reasons[0]?.code, 'MFA_NOT_ENROLLED');
  });

  test('step-up actions require a freshly re-authenticated session', () => {
    const decision = evaluate(
      request({
        subject: subject(['SUPERVISOR'], { authenticationLevel: 'AAL1' }),
        action: 'ACCESS_REQUEST_APPROVE',
        purpose: 'CRIMINAL_INVESTIGATION',
        resource: resource('ACCESS_REQUEST', { classification: 'INTERNAL', subjectPcid: null }),
      }),
    );
    assert.equal(decision.effect, 'DENY');
    assert.equal(decision.reasons[0]?.code, 'STEP_UP_REQUIRED');
  });

  test('a service-to-service caller must be strongly authenticated', () => {
    const decision = evaluate(
      request({
        subject: subject(['MDA_OFFICER'], { actorType: 'API_CLIENT', authenticationLevel: 'AAL1' }),
        action: 'CITIZEN_VERIFY',
        purpose: 'IDENTITY_VERIFICATION',
        resource: resource('CITIZEN'),
      }),
    );
    assert.equal(decision.effect, 'DENY');
    assert.equal(decision.reasons[0]?.code, 'CLIENT_AUTH_INSUFFICIENT');
  });
});

describe('access window gate', () => {
  const window = {
    daysOfWeek: [1, 2, 3, 4, 5],
    startHour: 8,
    endHour: 18,
    timezone: 'Africa/Lagos',
  };

  test('an account inside its shift is permitted', () => {
    // NOW is Wednesday 10:00 UTC, which is 11:00 in Lagos.
    const decision = evaluate(
      request({
        subject: subject(['MDA_OFFICER'], { accessWindow: window }),
        action: 'CITIZEN_VIEW',
        purpose: 'SERVICE_DELIVERY',
        resource: resource('CITIZEN'),
      }),
    );
    assert.equal(decision.effect, 'PERMIT');
  });

  test('an account outside its shift is refused', () => {
    const decision = evaluate({
      ...request({
        subject: subject(['MDA_OFFICER'], { accessWindow: window }),
        action: 'CITIZEN_VIEW',
        purpose: 'SERVICE_DELIVERY',
        resource: resource('CITIZEN'),
      }),
      now: new Date('2026-03-04T22:00:00.000Z'), // 23:00 Lagos
    });
    assert.equal(decision.effect, 'DENY');
    assert.equal(decision.reasons[0]?.code, 'OUTSIDE_ACCESS_WINDOW');
  });

  test('a weekend is refused for a weekday window', () => {
    const decision = evaluate({
      ...request({
        subject: subject(['MDA_OFFICER'], { accessWindow: window }),
        action: 'CITIZEN_VIEW',
        purpose: 'SERVICE_DELIVERY',
        resource: resource('CITIZEN'),
      }),
      now: new Date('2026-03-07T10:00:00.000Z'), // Saturday
    });
    assert.equal(decision.effect, 'DENY');
    assert.equal(decision.reasons[0]?.code, 'OUTSIDE_ACCESS_WINDOW');
  });

  test('a window crossing midnight is handled', () => {
    const nightShift = {
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      startHour: 20,
      endHour: 6,
      timezone: 'Africa/Lagos',
    };
    const inside = evaluate({
      ...request({
        subject: subject(['DISPATCHER'], { accessWindow: nightShift }),
        action: 'INCIDENT_VIEW',
        purpose: 'EMERGENCY_RESPONSE',
        resource: resource('INCIDENT', { classification: 'INTERNAL', subjectPcid: null }),
        // Opening one incident is incident-bound like anything else, so the
        // dispatcher is on it. The subject of this test is the window.
        incidentContext: incidentContext({ assignedUserIds: ['usr-001'] }),
      }),
      now: new Date('2026-03-04T01:00:00.000Z'), // 02:00 Lagos
    });
    assert.equal(inside.effect, 'PERMIT');
  });
});

describe('incident binding gate (§9, §10)', () => {
  // Attaching an officer to an incident is what opens the casualties' emergency
  // profiles to them. If the act of attaching were itself unbound, any account
  // holding INCIDENT_UPDATE could attach itself to any live incident in the
  // state and read everybody on it - which is the whole control, undone by the
  // one route that grants it.
  test('the incident record is bound to the incident, not only the data read', () => {
    const outsider = evaluate(
      request({
        subject: subject(['INCIDENT_OFFICER'], { userId: 'usr-outsider', agencyId: 'agy-fire' }),
        action: 'INCIDENT_UPDATE',
        purpose: 'EMERGENCY_RESPONSE',
        resource: resource('INCIDENT', { classification: 'CONFIDENTIAL', subjectPcid: null }),
        incidentContext: incidentContext({
          assignedUserIds: ['usr-control'],
          assignedAgencyIds: ['agy-ems'],
        }),
      }),
    );
    assert.equal(outsider.effect, 'DENY');
    assert.equal(outsider.reasons[0]?.code, 'NOT_ASSIGNED_TO_INCIDENT');
  });

  test('an officer whose agency was dispatched is on the incident', () => {
    const crew = evaluate(
      request({
        subject: subject(['INCIDENT_OFFICER'], { userId: 'usr-crew', agencyId: 'agy-ems' }),
        action: 'INCIDENT_UPDATE',
        purpose: 'EMERGENCY_RESPONSE',
        resource: resource('INCIDENT', { classification: 'CONFIDENTIAL', subjectPcid: null }),
        incidentContext: incidentContext({
          assignedUserIds: ['usr-control'],
          assignedAgencyIds: ['agy-ems'],
        }),
      }),
    );
    assert.equal(crew.effect, 'PERMIT');
  });

  test('an incident that is finished still admits being closed', () => {
    // An incident is resolved before it is closed, and resolved is not an active
    // status. Without this, every incident would stop one step short of closed.
    const closing = evaluate(
      request({
        subject: subject(['INCIDENT_OFFICER'], { userId: 'usr-control', agencyId: 'agy-ems' }),
        action: 'INCIDENT_CLOSE',
        purpose: 'EMERGENCY_RESPONSE',
        resource: resource('INCIDENT', { classification: 'CONFIDENTIAL', subjectPcid: null }),
        incidentContext: incidentContext({
          status: 'RESOLVED',
          assignedUserIds: ['usr-control'],
        }),
      }),
    );
    assert.equal(closing.effect, 'PERMIT');

    // And it is still bound: somebody outside cannot close it either.
    const outsider = evaluate(
      request({
        subject: subject(['INCIDENT_OFFICER'], { userId: 'usr-outsider', agencyId: 'agy-fire' }),
        action: 'INCIDENT_CLOSE',
        purpose: 'EMERGENCY_RESPONSE',
        resource: resource('INCIDENT', { classification: 'CONFIDENTIAL', subjectPcid: null }),
        incidentContext: incidentContext({
          status: 'RESOLVED',
          assignedUserIds: ['usr-control'],
          assignedAgencyIds: ['agy-ems'],
        }),
      }),
    );
    assert.equal(outsider.effect, 'DENY');
    assert.equal(outsider.reasons[0]?.code, 'NOT_ASSIGNED_TO_INCIDENT');
  });

  test('a closed incident authorises nothing further, but is still readable', () => {
    const changing = evaluate(
      request({
        subject: subject(['INCIDENT_OFFICER'], { userId: 'usr-control', agencyId: 'agy-ems' }),
        action: 'INCIDENT_UPDATE',
        purpose: 'EMERGENCY_RESPONSE',
        resource: resource('INCIDENT', { classification: 'CONFIDENTIAL', subjectPcid: null }),
        incidentContext: incidentContext({
          status: 'CLOSED',
          assignedUserIds: ['usr-control'],
        }),
      }),
    );
    assert.equal(changing.effect, 'DENY');
    assert.equal(changing.reasons[0]?.code, 'INCIDENT_NOT_ACTIVE');

    // The record itself is operational, not personal: what happened, which units
    // went, how long each step took. A service that cannot read back a job it
    // attended cannot debrief it or answer a complaint about it.
    const reading = evaluate(
      request({
        subject: subject(['INCIDENT_OFFICER'], { userId: 'usr-control', agencyId: 'agy-ems' }),
        action: 'INCIDENT_VIEW',
        purpose: 'EMERGENCY_RESPONSE',
        resource: resource('INCIDENT', { classification: 'CONFIDENTIAL', subjectPcid: null }),
        incidentContext: incidentContext({
          status: 'CLOSED',
          assignedUserIds: ['usr-control'],
        }),
      }),
    );
    assert.equal(reading.effect, 'PERMIT');

    // And the emergency profiles it authorised are a separate read, which stays
    // refused: that is the access closing was supposed to end.
    const profile = evaluate(
      request({
        subject: subject(['EMERGENCY_RESPONDER'], { userId: 'usr-crew', agencyId: 'agy-ems' }),
        action: 'EMERGENCY_PROFILE_VIEW',
        purpose: 'EMERGENCY_RESPONSE',
        resource: resource('CITIZEN'),
        incidentContext: incidentContext({
          status: 'CLOSED',
          assignedUserIds: ['usr-crew'],
        }),
      }),
    );
    assert.equal(profile.effect, 'DENY');
    assert.equal(profile.reasons[0]?.code, 'INCIDENT_NOT_ACTIVE');
  });

  test('sending your own unit is how an agency joins, so dispatch is not bound', () => {
    // Binding DISPATCH_CREATE would make a multi-agency response impossible to
    // start: the ambulance service could never answer a police-led incident.
    const dispatch = evaluate(
      request({
        subject: subject(['DISPATCHER'], { userId: 'usr-ems', agencyId: 'agy-ems' }),
        action: 'DISPATCH_CREATE',
        purpose: 'EMERGENCY_RESPONSE',
        resource: resource('DISPATCH', { classification: 'INTERNAL', subjectPcid: null }),
        incidentContext: incidentContext({
          assignedUserIds: ['usr-police'],
          assignedAgencyIds: ['agy-police'],
        }),
      }),
    );
    assert.equal(dispatch.effect, 'PERMIT');
  });

  test('a listing addresses no incident, so the gate does not demand one', () => {
    const listing = evaluate(
      request({
        subject: subject(['DISPATCHER'], { userId: 'usr-ems', agencyId: 'agy-ems' }),
        action: 'INCIDENT_VIEW',
        purpose: 'EMERGENCY_RESPONSE',
        resource: {
          ...resource('INCIDENT', { classification: 'CONFIDENTIAL', subjectPcid: null }),
          id: null,
        },
      }),
    );
    assert.equal(listing.effect, 'PERMIT');
  });
});

describe('jurisdiction gate (§3)', () => {
  const lgaScoped = {
    scope: 'LGA' as const,
    lgaCodes: ['PL-JNO', 'PL-JSO'],
    wardCodes: [] as string[],
  };

  test('a record inside the jurisdiction is permitted', () => {
    const decision = evaluate(
      request({
        subject: subject(['MDA_OFFICER'], { jurisdiction: lgaScoped }),
        action: 'CITIZEN_VIEW',
        purpose: 'SERVICE_DELIVERY',
        resource: resource('CITIZEN', { lgaCode: 'PL-JSO' }),
      }),
    );
    assert.equal(decision.effect, 'PERMIT');
  });

  test('a record outside the jurisdiction is refused', () => {
    const decision = evaluate(
      request({
        subject: subject(['MDA_OFFICER'], { jurisdiction: lgaScoped }),
        action: 'CITIZEN_VIEW',
        purpose: 'SERVICE_DELIVERY',
        resource: resource('CITIZEN', { lgaCode: 'PL-WAS' }),
      }),
    );
    assert.equal(decision.effect, 'DENY');
    assert.equal(decision.reasons[0]?.code, 'OUTSIDE_JURISDICTION_LGA');
  });

  test('a ward-scoped account is held to its ward', () => {
    const decision = evaluate(
      request({
        subject: subject(['MDA_OFFICER'], {
          jurisdiction: { scope: 'WARD', lgaCodes: ['PL-JNO'], wardCodes: ['PL-JNO-02'] },
        }),
        action: 'CITIZEN_VIEW',
        purpose: 'SERVICE_DELIVERY',
        resource: resource('CITIZEN', { lgaCode: 'PL-JNO', wardCode: 'PL-JNO-01' }),
      }),
    );
    assert.equal(decision.effect, 'DENY');
    assert.equal(decision.reasons[0]?.code, 'OUTSIDE_JURISDICTION_WARD');
  });

  test('break glass can cross a jurisdiction boundary in an emergency, and says so', () => {
    const decision = evaluate(
      request({
        subject: subject(['INCIDENT_OFFICER'], {
          agencyCategory: 'EMERGENCY',
          jurisdiction: lgaScoped,
        }),
        action: 'EMERGENCY_PROFILE_VIEW',
        purpose: 'EMERGENCY_RESPONSE',
        resource: resource('CITIZEN', { lgaCode: 'PL-WAS', wardCode: 'PL-WAS-03' }),
        incidentContext: incidentContext({ assignedUserIds: ['usr-001'] }),
        breakGlass: breakGlass({ gates: ['JURISDICTION'] }),
      }),
    );
    assert.equal(decision.effect, 'PERMIT');
    assert.equal(decision.breakGlassUsed, true);
    const notification = decision.obligations.find(
      (obligation) => obligation.kind === 'NOTIFY_SUPERVISOR',
    );
    assert.ok(
      notification && 'reason' in notification && notification.reason.includes('JURISDICTION'),
    );
  });
});

describe('search projection (§62, §63)', () => {
  test('a search returns only thin identifying fields, never the record', () => {
    const decision = evaluate(
      request({
        subject: subject(['MDA_OFFICER']),
        action: 'CITIZEN_SEARCH',
        purpose: 'SERVICE_DELIVERY',
        resource: resource('CITIZEN'),
      }),
    );
    assert.equal(decision.effect, 'PERMIT');
    for (const sensitive of [
      'citizen.dateOfBirth',
      'citizen.phonePrimary',
      'citizen.email',
      'citizen.registeredAddress',
      'citizen.photographUri',
      'citizen.emergencyContacts',
    ]) {
      assert.equal(
        decision.allowedFields.includes(sensitive),
        false,
        `search must not return ${sensitive}`,
      );
    }
    assert.ok(decision.allowedFields.includes('citizen.displayName'));
    assert.ok(decision.allowedFields.includes('citizen.pcid'));
    assert.ok(
      decision.obligations.some((obligation) => obligation.kind === 'RATE_LIMIT_SENSITIVE'),
    );
  });
});

describe('approval-gated fields (§24)', () => {
  const investigator = subject(['INVESTIGATOR'], { userId: 'usr-inv' });
  const baseRequest = {
    subject: investigator,
    action: 'CITIZEN_VIEW' as const,
    purpose: 'CRIMINAL_INVESTIGATION' as const,
    resource: resource('CITIZEN', {
      linkedCaseIds: ['case-001'],
      requestedFields: ['citizen.displayName', 'citizen.lawEnforcementMarkers'],
    }),
    caseContext: caseContext({ assignedUserIds: ['usr-inv'] }),
  };

  test('an approval-gated field is withheld without an approval', () => {
    const decision = evaluate(request(baseRequest));
    assert.equal(decision.effect, 'PERMIT');
    assert.deepEqual(decision.allowedFields, ['citizen.displayName']);
    assert.deepEqual(decision.withheldFields, [
      {
        field: 'citizen.lawEnforcementMarkers',
        gate: 'FIELD_RELEASE',
        code: 'FIELD_REQUIRES_APPROVAL',
      },
    ]);
    assert.deepEqual(restrictedFieldPaths(decision), ['citizen.lawEnforcementMarkers']);
  });

  test('a matching approval releases exactly the approved field and is recorded', () => {
    const decision = evaluate(
      request({
        ...baseRequest,
        approvals: [
          approval({ userId: 'usr-inv', approvedFields: ['citizen.lawEnforcementMarkers'] }),
        ],
      }),
    );
    assert.equal(decision.effect, 'PERMIT');
    assert.deepEqual([...decision.allowedFields].sort(), [
      'citizen.displayName',
      'citizen.lawEnforcementMarkers',
    ]);
    assert.deepEqual(decision.approvalsUsed, ['ar-001']);
  });

  test('an approval for another person, purpose, user or expiry window does not apply', () => {
    const variants = [
      approval({ userId: 'usr-other', approvedFields: ['citizen.lawEnforcementMarkers'] }),
      approval({
        subjectPcid: 'PL-ZZZZZ-YYYYY-XX',
        approvedFields: ['citizen.lawEnforcementMarkers'],
      }),
      approval({
        purpose: 'MISSING_PERSON_INVESTIGATION',
        approvedFields: ['citizen.lawEnforcementMarkers'],
      }),
      approval({
        expiresAt: new Date(NOW.getTime() - 1000),
        approvedFields: ['citizen.lawEnforcementMarkers'],
      }),
      approval({ resourceType: 'VEHICLE', approvedFields: ['citizen.lawEnforcementMarkers'] }),
      approval({ approvedFields: ['citizen.nin'] }),
    ];
    for (const candidate of variants) {
      const decision = evaluate(request({ ...baseRequest, approvals: [candidate] }));
      assert.deepEqual(decision.allowedFields, ['citizen.displayName']);
      assert.deepEqual(decision.approvalsUsed, []);
    }
  });
});

describe('projection helper', () => {
  test('projectFields cannot return a field the decision did not release', () => {
    const decision = evaluate(
      request({
        subject: subject(['MDA_OFFICER']),
        action: 'CITIZEN_SEARCH',
        purpose: 'SERVICE_DELIVERY',
        resource: resource('CITIZEN'),
      }),
    );
    const stored = {
      pcid: 'PL-4K7T9-QM2XB-7H',
      displayName: 'A Resident',
      dateOfBirth: '1990-01-01',
      emergencyMedicalNotes: 'confidential clinical note',
      nin: '12345678901',
    };
    const projected = projectFields(stored, decision, 'citizen');
    assert.equal(projected.dateOfBirth, undefined);
    assert.equal(projected.emergencyMedicalNotes, undefined);
    assert.equal(projected.nin, undefined);
    assert.equal(projected.displayName, 'A Resident');
  });

  test('projectFields returns nothing at all for a denial', () => {
    const denied = evaluate(
      request({
        subject: subject(['ANALYST']),
        action: 'CITIZEN_VIEW',
        purpose: 'SERVICE_DELIVERY',
        resource: resource('CITIZEN'),
      }),
    );
    assert.equal(denied.effect, 'DENY');
    assert.deepEqual(projectFields({ displayName: 'A Resident' }, denied, 'citizen'), {});
  });
});

describe('action metadata completeness', () => {
  test('every action declares its purposes and its resource types', () => {
    const purposeKeys = Object.keys(ACTION_PURPOSES).sort();
    const resourceKeys = Object.keys(ACTION_RESOURCE_TYPES).sort();
    assert.deepEqual(purposeKeys, resourceKeys, 'the two action maps must stay in lockstep');
    for (const [action, purposes] of Object.entries(ACTION_PURPOSES)) {
      assert.ok(purposes.length > 0, `${action} must declare at least one lawful purpose`);
    }
    for (const [action, types] of Object.entries(ACTION_RESOURCE_TYPES)) {
      assert.ok(types.length > 0, `${action} must declare at least one resource type`);
    }
  });

  test('no action may be performed with no purpose declared by a caller', () => {
    // There is no wildcard purpose: an unknown purpose is always refused.
    const decision = evaluate(
      request({
        subject: subject(['MDA_OFFICER']),
        action: 'CITIZEN_VIEW',
        purpose: 'AUDIT_REVIEW',
        resource: resource('CITIZEN'),
      }),
    );
    assert.equal(decision.effect, 'DENY');
    assert.equal(decision.reasons[0]?.gate, 'PURPOSE');
  });
});
