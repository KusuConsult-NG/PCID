import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import { evaluate } from '../src/engine';
import {
  NOW,
  actionsForRoles,
  breakGlass,
  caseContext,
  incidentContext,
  request,
  resource,
  subject,
} from './fixtures';

/**
 * Master system prompt §75 - CRITICAL AUTHORIZATION TESTS.
 *
 * Each test below is one of the seven propositions the platform is required to
 * prove. They are written against the policy engine directly so that a regression
 * in any gate fails here first, before it can reach an HTTP route.
 */
describe('§75 critical authorization tests', () => {
  test('a revenue officer cannot access restricted health information', () => {
    const revenueOfficer = subject(['MDA_OFFICER'], {
      userId: 'usr-revenue',
      agencyId: 'agy-revenue',
      agencyCategory: 'REVENUE',
      agencyMaxClassification: 'CONFIDENTIAL',
      compartments: [],
      clearance: 'CONFIDENTIAL',
    });

    // Asking for the record at all, for a revenue purpose, must not surface
    // emergency medical material.
    const decision = evaluate(
      request({
        subject: revenueOfficer,
        action: 'CITIZEN_VIEW',
        purpose: 'REVENUE_ADMINISTRATION',
        resource: resource('CITIZEN', { classification: 'CONFIDENTIAL' }),
      }),
    );

    assert.equal(decision.effect, 'PERMIT', 'a revenue officer may still do revenue work');
    assert.equal(decision.allowedFields.includes('citizen.emergencyMedicalNotes'), false);
    assert.equal(decision.allowedFields.includes('citizen.bloodGroup'), false);
    assert.equal(decision.allowedFields.includes('citizen.lawEnforcementMarkers'), false);
    assert.equal(decision.allowedFields.includes('citizen.nin'), false);

    // Asking for the field explicitly is denied outright, not silently dropped.
    const explicit = evaluate(
      request({
        subject: revenueOfficer,
        action: 'CITIZEN_VIEW',
        purpose: 'REVENUE_ADMINISTRATION',
        resource: resource('CITIZEN', {
          classification: 'CONFIDENTIAL',
          requestedFields: ['citizen.emergencyMedicalNotes', 'citizen.bloodGroup'],
        }),
      }),
    );
    assert.equal(explicit.effect, 'DENY');
    assert.equal(explicit.reasons[0]?.code, 'NO_FIELDS_RELEASABLE');
    assert.deepEqual(
      explicit.withheldFields.map((withheld) => withheld.code).sort(),
      ['FIELD_NOT_RELEASABLE_FOR_PURPOSE', 'FIELD_NOT_RELEASABLE_FOR_PURPOSE'],
      'medical material is not catalogued for revenue work at all',
    );

    // The clearance ceiling denies the same fields independently of purpose: an
    // ambulance service colleague with the right purpose but a CONFIDENTIAL
    // ceiling still gets nothing.
    const lowClearanceResponder = evaluate(
      request({
        subject: subject(['EMERGENCY_RESPONDER'], {
          userId: 'usr-lowclear',
          agencyId: 'agy-ems',
          agencyCategory: 'EMERGENCY',
          agencyMaxClassification: 'CONFIDENTIAL',
          compartments: [],
          clearance: 'CONFIDENTIAL',
        }),
        action: 'EMERGENCY_PROFILE_VIEW',
        purpose: 'EMERGENCY_RESPONSE',
        resource: resource('CITIZEN', {
          classification: 'CONFIDENTIAL',
          requestedFields: ['citizen.emergencyMedicalNotes', 'citizen.bloodGroup'],
        }),
        incidentContext: incidentContext({ assignedUserIds: ['usr-lowclear'] }),
      }),
    );
    assert.equal(lowClearanceResponder.effect, 'DENY');
    assert.deepEqual(lowClearanceResponder.withheldFields.map((withheld) => withheld.code).sort(), [
      'FIELD_ABOVE_CLEARANCE',
      'FIELD_ABOVE_CLEARANCE',
    ]);

    // And switching to an emergency purpose does not help: the role does not
    // grant emergency work at all.
    const viaEmergencyPurpose = evaluate(
      request({
        subject: revenueOfficer,
        action: 'EMERGENCY_PROFILE_VIEW',
        purpose: 'EMERGENCY_RESPONSE',
        resource: resource('CITIZEN'),
      }),
    );
    assert.equal(viaEmergencyPurpose.effect, 'DENY');
    assert.equal(viaEmergencyPurpose.reasons[0]?.gate, 'RBAC');
  });

  test('an education officer cannot access security cases', () => {
    const educationOfficer = subject(['MDA_OFFICER'], {
      userId: 'usr-education',
      agencyId: 'agy-education',
      agencyCategory: 'EDUCATION',
      agencyMaxClassification: 'CONFIDENTIAL',
      compartments: [],
      clearance: 'CONFIDENTIAL',
    });

    const decision = evaluate(
      request({
        subject: educationOfficer,
        action: 'CASE_VIEW',
        purpose: 'CRIMINAL_INVESTIGATION',
        resource: resource('CASE', { classification: 'LAW_ENFORCEMENT_RESTRICTED' }),
        caseContext: caseContext({ assignedUserIds: ['usr-education'] }),
      }),
    );

    assert.equal(decision.effect, 'DENY');
    assert.equal(decision.reasons[0]?.gate, 'RBAC', 'no education role grants CASE_VIEW');

    // Even if an administrator mistakenly granted the action, the compartment and
    // clearance gates still hold the line.
    const withActionGranted = evaluate(
      request({
        subject: subject([], {
          ...{ userId: 'usr-education', agencyId: 'agy-education', agencyCategory: 'EDUCATION' },
          actions: ['CASE_VIEW'],
          agencyMaxClassification: 'CONFIDENTIAL',
          compartments: [],
          clearance: 'CONFIDENTIAL',
        }),
        action: 'CASE_VIEW',
        purpose: 'CRIMINAL_INVESTIGATION',
        resource: resource('CASE', { classification: 'LAW_ENFORCEMENT_RESTRICTED' }),
        caseContext: caseContext({ assignedUserIds: ['usr-education'] }),
      }),
    );
    assert.equal(withActionGranted.effect, 'DENY');
    assert.equal(
      withActionGranted.reasons[0]?.gate,
      'COMPARTMENT',
      'an education agency holds no law-enforcement compartment',
    );

    // And with the compartment stripped from the record, the ordered clearance
    // ceiling still denies it.
    const rankOnly = evaluate(
      request({
        subject: subject([], {
          userId: 'usr-education',
          agencyId: 'agy-education',
          agencyCategory: 'EDUCATION',
          actions: ['CASE_VIEW'],
          agencyMaxClassification: 'CONFIDENTIAL',
          compartments: [],
          clearance: 'CONFIDENTIAL',
        }),
        action: 'CASE_VIEW',
        purpose: 'CRIMINAL_INVESTIGATION',
        resource: resource('CASE', { classification: 'HIGHLY_RESTRICTED' }),
        caseContext: caseContext({ assignedUserIds: ['usr-education'] }),
      }),
    );
    assert.equal(rankOnly.effect, 'DENY');
    assert.equal(rankOnly.reasons[0]?.gate, 'CLASSIFICATION_RANK');
  });

  test('a security investigator cannot access an unrelated case', () => {
    const investigator = subject(['INVESTIGATOR'], { userId: 'usr-inv' });

    const unrelated = evaluate(
      request({
        subject: investigator,
        action: 'CITIZEN_VIEW',
        purpose: 'CRIMINAL_INVESTIGATION',
        resource: resource('CITIZEN', { linkedCaseIds: ['case-777'] }),
        caseContext: caseContext({
          caseId: 'case-777',
          caseNumber: 'CASE-2026-00777',
          assignedUserIds: ['usr-someone-else'],
          supervisorUserIds: ['usr-other-sup'],
        }),
      }),
    );
    assert.equal(unrelated.effect, 'DENY');
    assert.equal(unrelated.reasons[0]?.code, 'NOT_ASSIGNED_TO_CASE');

    // Assigned, but the record has not been associated with the case.
    const notLinked = evaluate(
      request({
        subject: investigator,
        action: 'CITIZEN_VIEW',
        purpose: 'CRIMINAL_INVESTIGATION',
        resource: resource('CITIZEN', { linkedCaseIds: [] }),
        caseContext: caseContext({ assignedUserIds: ['usr-inv'] }),
      }),
    );
    assert.equal(notLinked.effect, 'DENY');
    assert.equal(notLinked.reasons[0]?.code, 'RECORD_NOT_LINKED_TO_CASE');

    // No case reference at all.
    const noCase = evaluate(
      request({
        subject: investigator,
        action: 'CITIZEN_VIEW',
        purpose: 'CRIMINAL_INVESTIGATION',
        resource: resource('CITIZEN'),
      }),
    );
    assert.equal(noCase.effect, 'DENY');
    assert.equal(noCase.reasons[0]?.code, 'CASE_REFERENCE_REQUIRED');

    // Assigned and linked: permitted, and the access is withheld from the
    // citizen's own history under a stated legal basis.
    const permitted = evaluate(
      request({
        subject: investigator,
        action: 'CITIZEN_VIEW',
        purpose: 'CRIMINAL_INVESTIGATION',
        resource: resource('CITIZEN', { linkedCaseIds: ['case-001'] }),
        caseContext: caseContext({ assignedUserIds: ['usr-inv'] }),
      }),
    );
    assert.equal(permitted.effect, 'PERMIT');
    assert.equal(permitted.citizenVisibility, 'ACCESS_RESTRICTED_FROM_CITIZEN');
    assert.ok(
      permitted.obligations.some((obligation) => obligation.kind === 'RESTRICT_FROM_CITIZEN'),
    );
  });

  test('an emergency responder receives only emergency-authorised information', () => {
    const responder = subject(['EMERGENCY_RESPONDER'], {
      userId: 'usr-responder',
      agencyId: 'agy-ems',
      agencyCategory: 'EMERGENCY',
      agencyMaxClassification: 'HIGHLY_RESTRICTED',
      compartments: [],
      clearance: 'HIGHLY_RESTRICTED',
    });

    const decision = evaluate(
      request({
        subject: responder,
        action: 'EMERGENCY_PROFILE_VIEW',
        purpose: 'EMERGENCY_RESPONSE',
        resource: resource('CITIZEN', { classification: 'SENSITIVE' }),
        incidentContext: incidentContext({
          assignedUserIds: ['usr-responder'],
          assignedAgencyIds: ['agy-ems'],
        }),
      }),
    );

    assert.equal(decision.effect, 'PERMIT');
    assert.ok(
      decision.obligations.some((obligation) => obligation.kind === 'MINIMUM_NECESSARY_PROFILE'),
    );

    // Exactly the minimum necessary emergency profile, and nothing else.
    assert.deepEqual([...decision.allowedFields].sort(), [
      'citizen.approximateAge',
      'citizen.bloodGroup',
      'citizen.displayName',
      'citizen.emergencyContacts',
      'citizen.emergencyMedicalNotes',
      'citizen.lgaCode',
      'citizen.pcid',
      'citizen.photographUri',
      'citizen.sex',
    ]);
    for (const forbidden of [
      'citizen.dateOfBirth',
      'citizen.registeredAddress',
      'citizen.nin',
      'citizen.phonePrimary',
      'citizen.email',
      'citizen.lawEnforcementMarkers',
    ]) {
      assert.equal(
        decision.allowedFields.includes(forbidden),
        false,
        `responder must not see ${forbidden}`,
      );
    }

    // The responder has no route to the full record.
    const fullRecord = evaluate(
      request({
        subject: responder,
        action: 'CITIZEN_VIEW',
        purpose: 'EMERGENCY_RESPONSE',
        resource: resource('CITIZEN'),
        incidentContext: incidentContext({ assignedUserIds: ['usr-responder'] }),
      }),
    );
    assert.equal(fullRecord.effect, 'DENY');
    assert.equal(fullRecord.reasons[0]?.gate, 'RBAC');

    // And no access at all once the incident is closed.
    const closedIncident = evaluate(
      request({
        subject: responder,
        action: 'EMERGENCY_PROFILE_VIEW',
        purpose: 'EMERGENCY_RESPONSE',
        resource: resource('CITIZEN'),
        incidentContext: incidentContext({
          status: 'CLOSED',
          assignedUserIds: ['usr-responder'],
        }),
      }),
    );
    assert.equal(closedIncident.effect, 'DENY');
    assert.equal(closedIncident.reasons[0]?.code, 'INCIDENT_NOT_ACTIVE');
  });

  test('an administrator cannot automatically bypass data policies', () => {
    const platformAdmin = subject(['PLATFORM_ADMINISTRATOR'], {
      userId: 'usr-admin',
      agencyId: 'agy-platform',
      agencyCategory: 'MDA',
      agencyMaxClassification: 'LAW_ENFORCEMENT_RESTRICTED',
      compartments: ['LAW_ENFORCEMENT_RESTRICTED'],
      clearance: 'LAW_ENFORCEMENT_RESTRICTED',
    });

    for (const action of [
      'CITIZEN_VIEW',
      'CITIZEN_SEARCH',
      'EMERGENCY_PROFILE_VIEW',
      'CASE_VIEW',
    ] as const) {
      const decision = evaluate(
        request({
          subject: platformAdmin,
          action,
          purpose: action === 'CASE_VIEW' ? 'CRIMINAL_INVESTIGATION' : 'SERVICE_DELIVERY',
          resource: resource(action === 'CASE_VIEW' ? 'CASE' : 'CITIZEN'),
          caseContext: caseContext({ assignedUserIds: ['usr-admin'] }),
          incidentContext: incidentContext({ assignedUserIds: ['usr-admin'] }),
        }),
      );
      assert.equal(decision.effect, 'DENY', `administrator must not be able to ${action}`);
      assert.equal(decision.reasons[0]?.gate, 'RBAC');
    }

    // An administrator also cannot quietly widen their own entitlements.
    const selfEscalation = evaluate(
      request({
        subject: platformAdmin,
        action: 'ADMIN_ROLE_MANAGE',
        purpose: 'SYSTEM_ADMINISTRATION',
        resource: resource('GOVERNMENT_USER', { id: 'usr-admin', classification: 'INTERNAL' }),
      }),
    );
    assert.equal(selfEscalation.effect, 'DENY');
    assert.equal(selfEscalation.reasons[0]?.gate, 'SEPARATION_OF_DUTY');
  });

  test('a citizen cannot access another citizen', () => {
    const citizen = subject(['CITIZEN'], {
      userId: 'usr-citizen',
      actorType: 'CITIZEN',
      agencyId: null,
      agencyCategory: null,
      agencyStatus: null,
      dataSharingAgreement: null,
      agencyMaxClassification: 'HIGHLY_RESTRICTED',
      compartments: [],
      clearance: 'HIGHLY_RESTRICTED',
      subjectPcid: 'PL-AAAAA-BBBBB-CC',
    });

    const other = evaluate(
      request({
        subject: citizen,
        action: 'CITIZEN_VIEW',
        purpose: 'CITIZEN_SELF_SERVICE',
        resource: resource('CITIZEN', { subjectPcid: 'PL-ZZZZZ-YYYYY-XX' }),
      }),
    );
    assert.equal(other.effect, 'DENY');
    assert.equal(other.reasons[0]?.code, 'NOT_OWN_RECORD');

    const ownRecord = evaluate(
      request({
        subject: citizen,
        action: 'CITIZEN_VIEW',
        purpose: 'CITIZEN_SELF_SERVICE',
        resource: resource('CITIZEN', { subjectPcid: 'PL-AAAAA-BBBBB-CC' }),
      }),
    );
    assert.equal(ownRecord.effect, 'PERMIT');
    assert.equal(ownRecord.allowedFields.includes('citizen.lawEnforcementMarkers'), false);
    assert.equal(ownRecord.allowedFields.includes('citizen.identityIntegrityFlags'), false);
    assert.ok(ownRecord.allowedFields.includes('citizen.emergencyContacts'));

    // A citizen cannot borrow an investigative purpose to widen their reach.
    const borrowedPurpose = evaluate(
      request({
        subject: citizen,
        action: 'CITIZEN_VIEW',
        purpose: 'CRIMINAL_INVESTIGATION',
        resource: resource('CITIZEN', { subjectPcid: 'PL-ZZZZZ-YYYYY-XX' }),
      }),
    );
    assert.equal(borrowedPurpose.effect, 'DENY');
    assert.equal(borrowedPurpose.reasons[0]?.code, 'PURPOSE_NOT_AVAILABLE_TO_CITIZEN');
  });

  test('an MDA cannot modify another MDA’s source records without explicit authority', () => {
    // The lands registry owns the property record; a revenue officer holds no
    // update action for it, and the source-of-truth model (§28, §55) means the
    // platform has no write path into another agency's authoritative record.
    const revenueOfficer = subject(['MDA_OFFICER'], {
      userId: 'usr-revenue',
      agencyId: 'agy-revenue',
      agencyCategory: 'REVENUE',
      agencyMaxClassification: 'SENSITIVE',
      compartments: [],
      clearance: 'SENSITIVE',
    });

    const decision = evaluate(
      request({
        subject: revenueOfficer,
        action: 'CITIZEN_UPDATE',
        purpose: 'SERVICE_DELIVERY',
        resource: resource('PROPERTY', {
          ownerAgencyId: 'agy-lands',
          classification: 'CONFIDENTIAL',
        }),
      }),
    );
    assert.equal(decision.effect, 'DENY');
    assert.equal(decision.reasons[0]?.gate, 'RBAC');

    // A registration officer holds CITIZEN_UPDATE, but that action is scoped to
    // the citizen registry the platform itself owns - never to a linked record.
    const registrationOfficer = subject(['REGISTRATION_OFFICER'], {
      userId: 'usr-reg',
      agencyId: 'agy-registry',
      agencyCategory: 'MDA',
      agencyMaxClassification: 'SENSITIVE',
      compartments: [],
      clearance: 'SENSITIVE',
    });
    const propertyWrite = evaluate(
      request({
        subject: registrationOfficer,
        action: 'CITIZEN_UPDATE',
        purpose: 'CORRECTION_REVIEW',
        resource: resource('PROPERTY', {
          ownerAgencyId: 'agy-lands',
          classification: 'CONFIDENTIAL',
        }),
      }),
    );
    assert.equal(propertyWrite.effect, 'DENY');
    assert.equal(propertyWrite.reasons[0]?.gate, 'RESOURCE_TYPE');
    assert.equal(propertyWrite.reasons[0]?.code, 'ACTION_NOT_VALID_FOR_RESOURCE');

    // The platform exposes no write action for another agency's source record at
    // all: no action in the catalogue targets PROPERTY for a write.
    const landsOwnOfficer = subject(['REGISTRATION_OFFICER', 'MDA_OFFICER', 'INVESTIGATOR'], {
      userId: 'usr-lands',
      agencyId: 'agy-lands',
      agencyCategory: 'LANDS',
    });
    for (const write of ['CITIZEN_UPDATE', 'CITIZEN_CREATE'] as const) {
      const attempt = evaluate(
        request({
          subject: landsOwnOfficer,
          action: write,
          purpose: 'CORRECTION_REVIEW',
          resource: resource('PROPERTY', { ownerAgencyId: 'agy-lands' }),
        }),
      );
      assert.equal(attempt.effect, 'DENY', `${write} must not reach a PROPERTY record`);
    }
  });
});

describe('§23 break-glass is bounded', () => {
  test('break glass can stand in for an incident assignment but not for a role', () => {
    const responder = subject(['EMERGENCY_RESPONDER'], {
      userId: 'usr-responder',
      agencyId: 'agy-ems',
      agencyCategory: 'EMERGENCY',
      agencyMaxClassification: 'HIGHLY_RESTRICTED',
      compartments: [],
      clearance: 'HIGHLY_RESTRICTED',
    });

    const withoutGrant = evaluate(
      request({
        subject: responder,
        action: 'EMERGENCY_PROFILE_VIEW',
        purpose: 'EMERGENCY_RESPONSE',
        resource: resource('CITIZEN'),
        incidentContext: incidentContext({
          assignedUserIds: ['someone-else'],
          assignedAgencyIds: ['agy-fire'],
        }),
      }),
    );
    assert.equal(withoutGrant.effect, 'DENY');
    assert.equal(withoutGrant.reasons[0]?.code, 'NOT_ASSIGNED_TO_INCIDENT');

    const withGrant = evaluate(
      request({
        subject: responder,
        action: 'EMERGENCY_PROFILE_VIEW',
        purpose: 'EMERGENCY_RESPONSE',
        resource: resource('CITIZEN'),
        incidentContext: incidentContext({
          assignedUserIds: ['someone-else'],
          assignedAgencyIds: ['agy-fire'],
        }),
        breakGlass: breakGlass({ userId: 'usr-responder', gates: ['INCIDENT_BINDING'] }),
      }),
    );
    assert.equal(withGrant.effect, 'PERMIT');
    assert.equal(withGrant.breakGlassUsed, true);
    assert.ok(withGrant.obligations.some((obligation) => obligation.kind === 'NOTIFY_SUPERVISOR'));
    assert.ok(withGrant.obligations.some((obligation) => obligation.kind === 'POST_EVENT_REVIEW'));
    assert.equal(withGrant.ttlSeconds, 0, 'break-glass decisions are never cached');

    // The same grant cannot buy an action the role does not hold.
    const roleEscalation = evaluate(
      request({
        subject: responder,
        action: 'CITIZEN_VIEW',
        purpose: 'EMERGENCY_RESPONSE',
        resource: resource('CITIZEN'),
        incidentContext: incidentContext({ assignedUserIds: ['usr-responder'] }),
        breakGlass: breakGlass({ userId: 'usr-responder' }),
      }),
    );
    assert.equal(roleEscalation.effect, 'DENY');
    assert.equal(roleEscalation.reasons[0]?.gate, 'RBAC');
  });

  test('break glass cannot cross the law-enforcement compartment or a clearance ceiling', () => {
    const responder = subject(['EMERGENCY_RESPONDER', 'INVESTIGATOR'], {
      userId: 'usr-responder',
      agencyId: 'agy-ems',
      agencyCategory: 'EMERGENCY',
      agencyMaxClassification: 'HIGHLY_RESTRICTED',
      compartments: [],
      clearance: 'HIGHLY_RESTRICTED',
    });

    const compartment = evaluate(
      request({
        subject: responder,
        action: 'CITIZEN_VIEW',
        purpose: 'CRIMINAL_INVESTIGATION',
        resource: resource('CITIZEN', {
          classification: 'LAW_ENFORCEMENT_RESTRICTED',
          linkedCaseIds: ['case-001'],
        }),
        caseContext: caseContext({ assignedUserIds: ['usr-responder'], agencyId: 'agy-ems' }),
        breakGlass: breakGlass({
          userId: 'usr-responder',
          gates: ['CASE_BINDING', 'JURISDICTION', 'FIELD_APPROVAL', 'INCIDENT_BINDING'],
        }),
      }),
    );
    assert.equal(compartment.effect, 'DENY');
    assert.equal(compartment.reasons[0]?.gate, 'COMPARTMENT');

    // The ordered clearance ceiling is likewise beyond reach of a grant.
    const rankCeiling = evaluate(
      request({
        subject: subject(['INVESTIGATOR'], {
          userId: 'usr-responder',
          agencyId: 'agy-police',
          agencyCategory: 'SECURITY',
          agencyMaxClassification: 'SENSITIVE',
          compartments: ['LAW_ENFORCEMENT_RESTRICTED'],
          clearance: 'SENSITIVE',
        }),
        action: 'CITIZEN_VIEW',
        purpose: 'CRIMINAL_INVESTIGATION',
        resource: resource('CITIZEN', {
          classification: 'HIGHLY_RESTRICTED',
          linkedCaseIds: ['case-001'],
        }),
        caseContext: caseContext({
          assignedUserIds: ['usr-responder'],
          classification: 'SENSITIVE',
        }),
        breakGlass: breakGlass({ userId: 'usr-responder' }),
      }),
    );
    assert.equal(rankCeiling.effect, 'DENY');
    assert.equal(rankCeiling.reasons[0]?.gate, 'CLASSIFICATION_RANK');
  });

  test('an expired, revoked, out-of-scope or over-long grant is not honoured', () => {
    const base = {
      subject: subject(['EMERGENCY_RESPONDER'], {
        userId: 'usr-responder',
        agencyId: 'agy-ems',
        agencyCategory: 'EMERGENCY' as const,
        agencyMaxClassification: 'HIGHLY_RESTRICTED' as const,
        compartments: [],
        clearance: 'HIGHLY_RESTRICTED' as const,
      }),
      action: 'EMERGENCY_PROFILE_VIEW' as const,
      purpose: 'EMERGENCY_RESPONSE' as const,
      resource: resource('CITIZEN'),
      incidentContext: incidentContext({
        assignedUserIds: ['someone-else'],
        assignedAgencyIds: ['agy-fire'],
      }),
    };

    const variants = [
      ['expired', breakGlass({ expiresAt: new Date(NOW.getTime() - 1000) })],
      ['revoked', breakGlass({ status: 'REVOKED' })],
      ['another user', breakGlass({ userId: 'usr-other' })],
      ['another person', breakGlass({ subjectPcid: 'PL-ZZZZZ-YYYYY-XX' })],
      ['another resource type', breakGlass({ resourceType: 'VEHICLE' })],
      ['gate not covered', breakGlass({ gates: ['JURISDICTION'] })],
      [
        'beyond the platform ceiling',
        breakGlass({ expiresAt: new Date(NOW.getTime() + 4 * 60 * 60 * 1000) }),
      ],
    ] as const;

    for (const [label, grant] of variants) {
      const decision = evaluate(request({ ...base, breakGlass: grant }));
      assert.equal(decision.effect, 'DENY', `grant that is ${label} must not be honoured`);
      assert.equal(decision.breakGlassUsed, false);
    }
  });
});

describe('§7 technical administration confers no data entitlement', () => {
  test('the engine reads only resolved actions, so admin roles add nothing', () => {
    const adminActions = actionsForRoles('PLATFORM_ADMINISTRATOR');
    for (const dataAction of [
      'CITIZEN_VIEW',
      'CITIZEN_SEARCH',
      'EMERGENCY_PROFILE_VIEW',
      'CASE_VIEW',
      'AUDIT_VIEW',
    ]) {
      assert.equal(
        adminActions.includes(dataAction as never),
        false,
        `PLATFORM_ADMINISTRATOR must not resolve ${dataAction}`,
      );
    }
  });
});
