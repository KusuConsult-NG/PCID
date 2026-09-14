import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { PCID_PATTERN } from '@pcid/contracts';

import { Dataset, NAME_POOLS } from '../../src/load/dataset';
import { assignUsers } from '../../src/load/driver';
import { Recorder, breaches, formatSummary, percentile } from '../../src/load/metrics';
import { SeededRandom, weightedChoice } from '../../src/load/random';
import { PROFILES, SCENARIOS, profileByName, scenariosFor } from '../../src/load/scenarios';
import { LOAD_PERSONAS } from '../../src/load/personas';
import type { LoadAccount } from '../../src/load/personas';

/**
 * The load harness measures the platform, so the harness itself has to be right.
 * A percentile computed the wrong way, a mix that quietly never issues half its
 * scenarios, or a driver that puts every virtual user on one account would all
 * produce a confident number that means nothing - which is worse than no number,
 * because somebody would sign a go-live decision against it.
 */

const WARDS = Array.from({ length: 51 }, (_unused, index) => ({
  code: `PL-TST-${String(index).padStart(2, '0')}`,
  lgaCode: `PL-TST${index % 17}`,
}));

describe('load harness: measurement', () => {
  test('a percentile names a sample that actually happened', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    assert.equal(percentile(sorted, 0.5), 5);
    assert.equal(percentile(sorted, 0.9), 9);
    assert.equal(percentile(sorted, 0.99), 10);
    assert.equal(percentile(sorted, 1), 10);
    assert.equal(percentile(sorted, 0), 1);
    // Nearest-rank, not interpolated: every reported percentile is a real
    // observation, so "the p99 was 240ms" means a request took 240ms.
    for (const fraction of [0.25, 0.5, 0.75, 0.95, 0.99]) {
      assert.ok(sorted.includes(percentile(sorted, fraction)));
    }
  });

  test('an empty sample set reports zero rather than NaN', () => {
    assert.equal(percentile([], 0.95), 0);
  });

  test('warm-up requests are excluded from the measured window', () => {
    const recorder = new Recorder();
    // Three slow requests while the pool fills and every statement is planned
    // for the first time, then three fast ones.
    for (const startedAtMs of [1_000, 1_100, 1_200]) {
      recorder.record({ scenario: 'warm', status: 200, ok: true, durationMs: 900, startedAtMs });
    }
    for (const startedAtMs of [5_000, 5_100, 5_200]) {
      recorder.record({ scenario: 'measured', status: 200, ok: true, durationMs: 10, startedAtMs });
    }
    assert.equal(recorder.size, 6);

    recorder.discardBefore(4_000);
    assert.equal(recorder.size, 3);
    const summary = recorder.summarise(3, '2026-09-14T00:00:00.000Z');
    assert.equal(summary.requests, 3);
    assert.equal(summary.max, 10);
    assert.deepEqual(
      summary.scenarios.map((scenario) => scenario.scenario),
      ['measured'],
    );
  });

  test('a refusal is counted as a failure only when the scenario did not expect it', () => {
    const recorder = new Recorder();
    recorder.record({ scenario: 'view', status: 403, ok: true, durationMs: 12, startedAtMs: 0 });
    recorder.record({ scenario: 'view', status: 500, ok: false, durationMs: 12, startedAtMs: 1 });
    const summary = recorder.summarise(1, '2026-09-14T00:00:00.000Z');
    assert.equal(summary.requests, 2);
    assert.equal(summary.failures, 1);
    // Both appear in the status distribution, so a shift towards refusals is
    // visible even where the scenario counts them as answers.
    assert.equal(summary.statuses['403'], 1);
    assert.equal(summary.statuses['500'], 1);
  });

  test('a request that never got an answer is reported apart from one that did', () => {
    const recorder = new Recorder();
    recorder.record({
      scenario: 'search',
      status: 0,
      ok: false,
      durationMs: 30_000,
      startedAtMs: 0,
      error: 'timeout',
    });
    const summary = recorder.summarise(1, '2026-09-14T00:00:00.000Z');
    assert.equal(summary.statuses.timeout, 1);
    assert.equal(summary.failures, 1);
  });

  test('the budget gate fires on error rate and on the tail', () => {
    const base = new Recorder();
    // Three slow requests in a hundred. One would not move a nearest-rank p99,
    // which is the point: the tail budget catches a pattern, not a single blip.
    for (let index = 0; index < 100; index += 1) {
      base.record({
        scenario: 'search',
        status: 200,
        ok: index !== 0,
        durationMs: index >= 97 ? 5_000 : 20,
        startedAtMs: index,
      });
    }
    const summary = base.summarise(1, '2026-09-14T00:00:00.000Z');
    const failed = breaches(summary, { maxErrorRate: 0.001, maxP95Ms: 800, maxP99Ms: 2_000 });
    assert.deepEqual(failed.map((breach) => breach.measure).sort(), ['error rate', 'p99 (ms)']);
    assert.equal(
      breaches(summary, { maxErrorRate: 1, maxP95Ms: 10_000, maxP99Ms: 10_000 }).length,
      0,
    );
  });

  test('the report names every scenario that ran', () => {
    const recorder = new Recorder();
    recorder.record({
      scenario: 'counter: search',
      status: 200,
      ok: true,
      durationMs: 5,
      startedAtMs: 0,
    });
    const text = formatSummary(recorder.summarise(1, '2026-09-14T00:00:00.000Z'));
    assert.match(text, /counter: search/);
    assert.match(text, /p99/);
  });
});

describe('load harness: the data underneath', () => {
  test('the same seed produces the same population', () => {
    const first = new SeededRandom(42);
    const second = new SeededRandom(42);
    const third = new SeededRandom(43);
    const a = Array.from({ length: 20 }, () => first.next());
    const b = Array.from({ length: 20 }, () => second.next());
    const c = Array.from({ length: 20 }, () => third.next());
    assert.deepEqual(a, b);
    assert.notDeepEqual(a, c);
  });

  test('generated identifiers are well-formed Plateau Citizen IDs', () => {
    const random = new SeededRandom(7);
    const dataset = new Dataset(7, WARDS);
    const source = (byteLength: number): Buffer => {
      const bytes = Buffer.alloc(byteLength);
      for (let i = 0; i < byteLength; i += 1) bytes[i] = random.int(0, 255);
      return bytes;
    };
    const citizens = Array.from({ length: 200 }, () => dataset.citizen(source));
    for (const citizen of citizens) {
      assert.match(citizen.pcid, PCID_PATTERN);
      assert.match(citizen.dateOfBirth, /^\d{4}-\d{2}-\d{2}$/);
      // Nothing generated can reach a real handset: 0700 is unallocated.
      assert.match(citizen.phonePrimary, /^0700\d{7}$/);
      if (citizen.email !== null) assert.match(citizen.email, /@example\.invalid$/);
    }
    assert.equal(new Set(citizens.map((citizen) => citizen.pcid)).size, citizens.length);
  });

  test('the population is varied enough for a trigram index to be exercised', () => {
    const random = new SeededRandom(11);
    const dataset = new Dataset(11, WARDS);
    const source = (byteLength: number): Buffer => {
      const bytes = Buffer.alloc(byteLength);
      for (let i = 0; i < byteLength; i += 1) bytes[i] = random.int(0, 255);
      return bytes;
    };
    const citizens = Array.from({ length: 2_000 }, () => dataset.citizen(source));
    const families = new Set(citizens.map((citizen) => citizen.familyName));
    const places = new Set(citizens.map((citizen) => citizen.wardCode));
    // Most of the pool should appear, and the distribution should be skewed
    // rather than flat - a register where every surname is equally common is an
    // easier index than the one production has.
    assert.ok(families.size > NAME_POOLS.FAMILY_NAMES.length * 0.8, `${families.size} surnames`);
    assert.ok(places.size > 30, `${places.size} wards`);
    const counts = new Map<string, number>();
    for (const citizen of citizens) {
      counts.set(citizen.familyName, (counts.get(citizen.familyName) ?? 0) + 1);
    }
    const ordered = [...counts.values()].sort((a, b) => b - a);
    assert.ok((ordered[0] as number) > (ordered[ordered.length - 1] as number) * 3);
  });

  test('an empty reference geography is refused rather than guessed at', () => {
    assert.throws(() => new Dataset(1, []), /reference geography is empty/i);
  });

  test('most incidents are finished, as a control room board really is', () => {
    const dataset = new Dataset(3, WARDS);
    const incidents = Array.from({ length: 1_000 }, () => dataset.incident(Date.now(), 365));
    const live = incidents.filter((incident) =>
      ['REPORTED', 'VERIFIED', 'DISPATCHED', 'ON_SCENE', 'CONTAINED'].includes(incident.status),
    );
    assert.ok(live.length > 100 && live.length < 400, `${live.length} live of 1000`);
    // Some have no coordinate: an incident called in by address has none, and
    // the map has to say so rather than place it at a guess.
    assert.ok(incidents.some((incident) => incident.latitude === null));
    assert.ok(incidents.some((incident) => incident.latitude !== null));
  });
});

describe('load harness: the mix', () => {
  test('a weighted choice follows its weights', () => {
    const items = [
      { name: 'a', weight: 90 },
      { name: 'b', weight: 10 },
    ];
    const counts = { a: 0, b: 0 };
    const random = new SeededRandom(5);
    for (let index = 0; index < 10_000; index += 1) {
      counts[weightedChoice(items, random.next()).name as 'a' | 'b'] += 1;
    }
    assert.ok(counts.a > 8_500 && counts.a < 9_500, `${counts.a} of 10000`);
  });

  test('every scenario belongs to a desk the seeder creates accounts for', () => {
    const personas = new Set(LOAD_PERSONAS.map((persona) => persona.key));
    for (const scenario of SCENARIOS) {
      assert.ok(personas.has(scenario.persona), `${scenario.name} has no accounts`);
      assert.ok(scenario.weight > 0, `${scenario.name} would never run`);
      assert.ok(scenario.answers.length > 0, `${scenario.name} accepts no status`);
    }
  });

  test('every desk a profile names has scenarios to drive', () => {
    for (const profile of PROFILES) {
      const shares = Object.values(profile.mix).reduce((sum, share) => sum + share, 0);
      assert.ok(Math.abs(shares - 1) < 1e-9, `${profile.name} mix sums to ${shares}`);
      for (const persona of Object.keys(profile.mix)) {
        assert.ok(scenariosFor(persona).length > 0, `${profile.name}: ${persona} has no scenarios`);
      }
    }
    assert.throws(() => profileByName('nonexistent'), /Unknown profile/);
  });

  test('virtual users are spread across accounts rather than piled onto one', () => {
    const accounts: LoadAccount[] = LOAD_PERSONAS.flatMap((persona) =>
      Array.from({ length: 25 }, (_unused, index) => ({
        persona: persona.key,
        email: `${persona.key}-${index}@example.invalid`,
        password: 'x',
        totpSecret: 'y',
        roles: persona.roles,
      })),
    );
    const chosen = assignUsers(accounts, profileByName('counter'), 20);
    assert.equal(chosen.length, 20);
    // The busiest desk gets most of the users, and no account is used twice
    // while there are unused accounts on that desk.
    const counter = chosen.filter((account) => account.persona === 'counter');
    assert.ok(counter.length >= 12, `${counter.length} of 20 at the counter`);
    assert.equal(new Set(counter.map((account) => account.email)).size, counter.length);
    assert.ok(new Set(chosen.map((account) => account.persona)).size >= 3);
  });

  test('a run asking for more users than there are accounts still fills every seat', () => {
    const accounts: LoadAccount[] = [
      { persona: 'counter', email: 'a@example.invalid', password: 'x', totpSecret: 'y', roles: [] },
    ];
    const chosen = assignUsers(accounts, profileByName('counter'), 5);
    assert.equal(chosen.length, 5);
  });
});
