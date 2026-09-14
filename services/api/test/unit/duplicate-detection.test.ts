import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import {
  DUPLICATE_WEIGHTS,
  DuplicateDetectionService,
} from '../../src/identity/duplicate-detection';

/**
 * The candidate query and the scoring have to agree.
 *
 * The query that gathers candidates pairs the name net with the date of birth,
 * so it reads a few hundred rows instead of four million. That is only sound
 * while the arithmetic below holds: without an exact date-of-birth agreement,
 * and without a national identifier, telephone number or email address in
 * common, nothing a record can score reaches the threshold that queues it for
 * review. If somebody raises a weight, the net silently starts missing
 * duplicates - so the arithmetic is asserted rather than remembered.
 */
describe('duplicate detection: the net matches the score', () => {
  test('the name net cannot lose a record that could have been queued', () => {
    // The most a record can score on names, an approximate date of birth and the
    // same ward - every non-exact agreement there is, all at once.
    const bestWithoutExactDateOfBirth =
      DUPLICATE_WEIGHTS.nameMaximum +
      DUPLICATE_WEIGHTS.dateOfBirthWithinAYear +
      DUPLICATE_WEIGHTS.ward;

    assert.ok(
      bestWithoutExactDateOfBirth < DuplicateDetectionService.REVIEW_THRESHOLD,
      `a record scoring ${bestWithoutExactDateOfBirth} without an exact date of birth would be ` +
        `queued at threshold ${DuplicateDetectionService.REVIEW_THRESHOLD}, and the candidate ` +
        'query would never find it. Widen the net in findCandidates before raising a weight.',
    );

    // And with the exact date of birth, names alone are enough to be queued -
    // which is what makes pairing them the right net rather than a shortcut.
    const nameAndExactDateOfBirth =
      DUPLICATE_WEIGHTS.nameMaximum + DUPLICATE_WEIGHTS.dateOfBirthExact + DUPLICATE_WEIGHTS.ward;
    assert.ok(nameAndExactDateOfBirth >= DuplicateDetectionService.REVIEW_THRESHOLD);
  });

  test('each exact identifier the net looks up can queue a record by itself or with a name', () => {
    // A national identifier in common is conclusive on its own.
    assert.ok(DUPLICATE_WEIGHTS.nin >= DuplicateDetectionService.REVIEW_THRESHOLD);
    // A telephone number or an email address is not - but each is looked up
    // exactly, so a record carrying one is always among the candidates and is
    // scored against the names as well.
    assert.ok(
      DUPLICATE_WEIGHTS.phonePrimary + DUPLICATE_WEIGHTS.nameMaximum >=
        DuplicateDetectionService.REVIEW_THRESHOLD,
    );
    assert.ok(
      DUPLICATE_WEIGHTS.email +
        DUPLICATE_WEIGHTS.nameMaximum +
        DUPLICATE_WEIGHTS.dateOfBirthExact >=
        DuplicateDetectionService.REVIEW_THRESHOLD,
    );
  });

  test('a strong agreement is a higher bar than a reviewable one', () => {
    assert.ok(
      DuplicateDetectionService.STRONG_THRESHOLD > DuplicateDetectionService.REVIEW_THRESHOLD,
    );
  });
});
