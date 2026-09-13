import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import {
  CLASSIFICATIONS,
  classificationRank,
  highestClassification,
  isCompartmented,
  lowestClassification,
  rankDominates,
} from '../src/classification';

describe('data classification (§27)', () => {
  test('ranks are strictly increasing in declaration order', () => {
    for (let i = 1; i < CLASSIFICATIONS.length; i += 1) {
      const previous = classificationRank(CLASSIFICATIONS[i - 1]!);
      const current = classificationRank(CLASSIFICATIONS[i]!);
      assert.ok(current > previous, `${CLASSIFICATIONS[i]} must outrank ${CLASSIFICATIONS[i - 1]}`);
    }
  });

  test('dominance is reflexive and ordered', () => {
    assert.equal(rankDominates('SENSITIVE', 'SENSITIVE'), true);
    assert.equal(rankDominates('SENSITIVE', 'CONFIDENTIAL'), true);
    assert.equal(rankDominates('CONFIDENTIAL', 'SENSITIVE'), false);
    assert.equal(rankDominates('PUBLIC', 'INTERNAL'), false);
  });

  test('law-enforcement material is a compartment, not merely a high rank', () => {
    assert.equal(isCompartmented('LAW_ENFORCEMENT_RESTRICTED'), true);
    assert.equal(isCompartmented('HIGHLY_RESTRICTED'), false);
  });

  test('aggregation helpers pick the correct extreme', () => {
    assert.equal(highestClassification(['PUBLIC', 'SENSITIVE', 'INTERNAL']), 'SENSITIVE');
    assert.equal(highestClassification([]), 'PUBLIC');
    assert.equal(lowestClassification(['SENSITIVE', 'INTERNAL']), 'INTERNAL');
    assert.equal(lowestClassification([]), 'PUBLIC');
  });
});
