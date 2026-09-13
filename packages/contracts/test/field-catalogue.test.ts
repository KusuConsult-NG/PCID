import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import {
  FIELD_CATALOGUE,
  emergencyProfileFields,
  fieldDefinition,
  fieldsForResource,
} from '../src/field-catalogue';
import { isPurpose } from '../src/purpose';
import { isClassification } from '../src/classification';
import { isResourceType } from '../src/resources';

describe('field catalogue (§27, §38)', () => {
  test('every entry is internally consistent', () => {
    for (const definition of FIELD_CATALOGUE) {
      assert.ok(isResourceType(definition.resourceType), `${definition.field}: resource type`);
      assert.ok(isClassification(definition.classification), `${definition.field}: classification`);
      assert.ok(
        definition.purposes.length > 0,
        `${definition.field}: must declare at least one purpose`,
      );
      for (const purpose of definition.purposes) {
        assert.ok(isPurpose(purpose), `${definition.field}: unknown purpose ${purpose}`);
      }
      assert.ok(definition.description.length > 10, `${definition.field}: needs a description`);
    }
  });

  test('field paths are unique', () => {
    const seen = new Set<string>();
    for (const definition of FIELD_CATALOGUE) {
      assert.equal(
        seen.has(definition.field),
        false,
        `duplicate catalogue entry ${definition.field}`,
      );
      seen.add(definition.field);
    }
  });

  test('the emergency profile is a strict subset of citizen fields and excludes exact date of birth', () => {
    const profile = emergencyProfileFields('CITIZEN');
    const all = fieldsForResource('CITIZEN').map((definition) => definition.field);
    assert.ok(profile.length > 0);
    assert.ok(profile.length < all.length, 'the emergency profile must not be the whole record');
    assert.equal(profile.includes('citizen.dateOfBirth'), false);
    assert.equal(profile.includes('citizen.nin'), false);
    assert.equal(profile.includes('citizen.registeredAddress'), false);
    assert.ok(profile.includes('citizen.emergencyContacts'));
    assert.ok(profile.includes('citizen.approximateAge'));
  });

  test('highly restricted medical fields are releasable only for emergency purposes', () => {
    for (const field of ['citizen.bloodGroup', 'citizen.emergencyMedicalNotes']) {
      const definition = fieldDefinition(field);
      assert.ok(definition, `${field} must exist`);
      assert.equal(definition!.classification, 'HIGHLY_RESTRICTED');
      assert.deepEqual([...definition!.purposes].sort(), [
        'DISASTER_RESPONSE',
        'EMERGENCY_IDENTIFICATION',
        'EMERGENCY_RESPONSE',
      ]);
    }
  });

  test('law-enforcement markers are compartmented and approval-gated', () => {
    const definition = fieldDefinition('citizen.lawEnforcementMarkers');
    assert.ok(definition);
    assert.equal(definition!.classification, 'LAW_ENFORCEMENT_RESTRICTED');
    assert.equal(definition!.requiresApproval, true);
    assert.equal(definition!.selfServiceVisible, undefined);
  });

  test('NIN is optional, highly restricted and never part of identification flows', () => {
    const definition = fieldDefinition('citizen.nin');
    assert.ok(definition);
    assert.equal(definition!.classification, 'HIGHLY_RESTRICTED');
    assert.equal(definition!.requiresApproval, true);
    assert.equal(definition!.purposes.includes('IDENTITY_VERIFICATION'), false);
    assert.equal(definition!.emergencyProfile, undefined);
  });

  test('every linked-record resource carries its source agency (§28, §55)', () => {
    for (const resourceType of [
      'VEHICLE',
      'PROPERTY',
      'BUSINESS',
      'LICENCE',
      'REVENUE_PROFILE',
    ] as const) {
      const fields = fieldsForResource(resourceType).map((definition) => definition.field);
      assert.ok(
        fields.some((field) => field.endsWith('.sourceAgencyId')),
        `${resourceType} must expose its authoritative source agency`,
      );
    }
  });
});
