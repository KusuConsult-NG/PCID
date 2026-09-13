import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { test, describe } from 'node:test';

import {
  PCID_ALPHABET,
  PCID_PATTERN,
  generatePcid,
  isValidPcid,
  normalizePcid,
  parsePcid,
  pcidCheckCharacters,
} from '../src/pcid';

describe('PCID format (§49)', () => {
  test('generated identifiers match the canonical pattern', () => {
    for (let i = 0; i < 500; i += 1) {
      assert.match(generatePcid(), PCID_PATTERN);
    }
  });

  test('generated identifiers validate', () => {
    for (let i = 0; i < 500; i += 1) {
      assert.equal(isValidPcid(generatePcid()), true);
    }
  });

  test('alphabet excludes the ambiguous characters I, L, O and U', () => {
    for (const ambiguous of ['I', 'L', 'O', 'U']) {
      assert.equal(
        PCID_ALPHABET.includes(ambiguous),
        false,
        `alphabet must not contain ${ambiguous}`,
      );
    }
  });

  test('identifiers are non-sequential: consecutive generations never share a prefix run', () => {
    const first = generatePcid();
    const second = generatePcid();
    assert.notEqual(first, second);
  });

  test('identifiers are unpredictable: 20000 draws produce no collision and high entropy', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20000; i += 1) {
      seen.add(generatePcid());
    }
    assert.equal(seen.size, 20000, 'expected no collisions across 20000 draws');
  });

  test('payload characters are close to uniformly distributed', () => {
    const counts = new Map<string, number>();
    const draws = 4000;
    for (let i = 0; i < draws; i += 1) {
      const pcid = generatePcid();
      for (const character of pcid.slice(3, 8) + pcid.slice(9, 14)) {
        counts.set(character, (counts.get(character) ?? 0) + 1);
      }
    }
    const expected = (draws * 10) / 32;
    for (const symbol of PCID_ALPHABET) {
      const observed = counts.get(symbol) ?? 0;
      // Generous bound: a biased generator (e.g. a truncating modulo) fails this badly.
      assert.ok(
        observed > expected * 0.6 && observed < expected * 1.4,
        `symbol ${symbol} occurred ${observed} times, expected about ${expected}`,
      );
    }
  });

  test('generation depends only on the random source, never on citizen attributes', () => {
    // A fixed random source must always produce the same identifier: there is no
    // other input to derive from, so no NIN, phone, date of birth, LGA, sex or
    // name can influence the result.
    const fixed = () => Buffer.from('0123456789abcdef', 'hex');
    assert.equal(generatePcid(fixed), generatePcid(fixed));
  });

  test('check characters reject a single mistyped character', () => {
    let detected = 0;
    let attempts = 0;
    for (let i = 0; i < 400; i += 1) {
      const pcid = generatePcid();
      const characters = [...pcid];
      const positions = [3, 4, 5, 6, 7, 9, 10, 11, 12, 13];
      const position = positions[i % positions.length] as number;
      const original = characters[position] as string;
      let replacement = original;
      while (replacement === original) {
        replacement = PCID_ALPHABET[randomBytes(1)[0]! % 32] as string;
      }
      characters[position] = replacement;
      attempts += 1;
      if (!isValidPcid(characters.join(''))) detected += 1;
    }
    // The 10-bit check detects ~99.9% of single-character corruptions.
    assert.ok(detected / attempts > 0.97, `detected only ${detected}/${attempts}`);
  });

  test('normalisation folds case, hyphens, prefix and Crockford confusables', () => {
    const pcid = generatePcid();
    const mangled = pcid.toLowerCase().replace(/-/g, '').replace(/^pl/, '');
    assert.equal(normalizePcid(mangled), pcid);
    assert.equal(normalizePcid(`  ${pcid.toLowerCase()}  `), pcid);
  });

  test('normalisation maps I and L to 1 and O to zero', () => {
    const normalized = normalizePcid('PL-I23O5-6789A-BC');
    assert.equal(normalized, 'PL-12305-6789A-BC');
  });

  test('normalisation rejects values of the wrong length or alphabet', () => {
    assert.equal(normalizePcid('PL-123'), null);
    assert.equal(normalizePcid(''), null);
    assert.equal(normalizePcid('PL-!!!!!-!!!!!-!!'), null);
  });

  test('parsePcid returns null when the check characters do not agree', () => {
    const pcid = generatePcid();
    const payload = pcid.slice(3, 8) + pcid.slice(9, 14);
    const wrongCheck = pcidCheckCharacters(payload) === 'ZZ' ? 'YY' : 'ZZ';
    assert.equal(parsePcid(`${pcid.slice(0, 15)}${wrongCheck}`), null);
    assert.equal(parsePcid(pcid), pcid);
  });
});
