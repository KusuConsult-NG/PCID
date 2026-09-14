import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import {
  MAX_BOX_DEGREES,
  boxAround,
  contains,
  distanceMetres,
  extentOf,
  isValidBox,
} from '../../src/common/geography';

/**
 * The arithmetic the command map rests on.
 *
 * Pure and tested without a database, like the policy engine, because the sums
 * that decide what appears on a command picture should be checkable against a
 * chart by somebody who does not want to read SQL.
 */

/** Jos, roughly. The state's centre of gravity, and a convenient reference. */
const JOS = { latitude: 9.8965, longitude: 8.8583 };
/** Bukuru, about 12km south. */
const BUKURU = { latitude: 9.7965, longitude: 8.8583 };

describe('bounding boxes', () => {
  test('a box has to be ordered, on the planet, and smaller than half of it', () => {
    assert.equal(isValidBox({ north: 10, south: 9, east: 9, west: 8 }), true);

    // Inverted: somebody has swapped two corners.
    assert.equal(isValidBox({ north: 9, south: 10, east: 9, west: 8 }), false);
    assert.equal(isValidBox({ north: 10, south: 9, east: 8, west: 9 }), false);

    // Degenerate: a line is not a view.
    assert.equal(isValidBox({ north: 10, south: 10, east: 9, west: 8 }), false);

    // Off the planet.
    assert.equal(isValidBox({ north: 91, south: 9, east: 9, west: 8 }), false);
    assert.equal(isValidBox({ north: 10, south: 9, east: 181, west: 8 }), false);

    // Not a number.
    assert.equal(isValidBox({ north: Number.NaN, south: 9, east: 9, west: 8 }), false);
  });

  test('a request for half the planet is refused', () => {
    // "Everything" with a viewport wrapped round it is still everything, and a
    // command map that served it would be a bulk extract of where the state's
    // emergencies are.
    const enormous = { north: 40, south: 0, east: 40, west: 0 };
    assert.equal(isValidBox(enormous), false);

    const atTheLimit = { north: MAX_BOX_DEGREES, south: 0, east: MAX_BOX_DEGREES, west: 0 };
    assert.equal(isValidBox(atTheLimit), true);
  });

  test('containment is inclusive of the edges', () => {
    const box = { north: 10, south: 9, east: 9, west: 8 };
    assert.equal(contains(box, { latitude: 9.5, longitude: 8.5 }), true);
    assert.equal(contains(box, { latitude: 10, longitude: 9 }), true);
    assert.equal(contains(box, { latitude: 10.0001, longitude: 8.5 }), false);
    assert.equal(contains(box, { latitude: 9.5, longitude: 7.9 }), false);
  });
});

describe('a box around a point', () => {
  test('it contains the point, and points inside the radius', () => {
    const box = boxAround(JOS, 20_000);
    assert.equal(contains(box, JOS), true);
    assert.equal(contains(box, BUKURU), true, 'Bukuru is about 12km away');
  });

  test('it is generous rather than exact, because it is a filter', () => {
    // A box is a rectangle and a radius is a circle, so the corners reach
    // further than the radius. That is the right direction to be wrong in: the
    // distance sort that follows decides the answer, and a box that clipped
    // would lose the nearest unit.
    const box = boxAround(JOS, 10_000);
    const corner = { latitude: box.north, longitude: box.east };
    assert.ok(
      distanceMetres(JOS, corner) > 10_000,
      'the corner is outside the radius, which is why the sort is still needed',
    );
  });

  test('a box grows wider in longitude the further from the equator it is', () => {
    const nearEquator = boxAround({ latitude: 0, longitude: 8 }, 50_000);
    const farNorth = boxAround({ latitude: 60, longitude: 8 }, 50_000);
    const widthOf = (box: { east: number; west: number }): number => box.east - box.west;
    assert.ok(
      widthOf(farNorth) > widthOf(nearEquator),
      'a degree of longitude is shorter at 60° than at the equator',
    );
  });

  test('a box at the pole does not become infinite', () => {
    // cos(90°) is zero, and dividing by it would produce a box spanning the
    // planet — which `isValidBox` would then refuse, turning a map view into an
    // error nobody could explain.
    const box = boxAround({ latitude: 90, longitude: 0 }, 10_000);
    assert.ok(Number.isFinite(box.east) && Number.isFinite(box.west));
    assert.ok(box.north <= 90, 'latitude is clamped to the planet');
  });
});

describe('distance', () => {
  test('it agrees with a known separation', () => {
    // A tenth of a degree of latitude is about 11.1km anywhere on Earth.
    const metres = distanceMetres(JOS, BUKURU);
    assert.ok(metres > 11_000 && metres < 11_300, `expected about 11.1km, got ${metres}`);
  });

  test('a point is no distance from itself, and distance is symmetric', () => {
    assert.equal(distanceMetres(JOS, JOS), 0);
    assert.equal(distanceMetres(JOS, BUKURU), distanceMetres(BUKURU, JOS));
  });
});

describe('the extent of what is happening', () => {
  test('nothing has no extent, and the caller decides what to show instead', () => {
    assert.equal(extentOf([]), null);
  });

  test('one point still gets a view, rather than a division by zero', () => {
    const box = extentOf([JOS]);
    assert.ok(box !== null);
    assert.equal(isValidBox(box), true);
    assert.equal(contains(box, JOS), true);
  });

  test('every point is inside the extent, with air around it', () => {
    const box = extentOf([JOS, BUKURU, { latitude: 9.95, longitude: 9.1 }]);
    assert.ok(box !== null);
    for (const point of [JOS, BUKURU, { latitude: 9.95, longitude: 9.1 }]) {
      assert.equal(contains(box, point), true);
    }
    assert.ok(box.north > 9.95, 'the northernmost point is not on the edge');
    assert.ok(box.west < 8.8583, 'the westernmost point is not on the edge');
  });

  test('the extent of a live picture is a view the platform would accept', () => {
    // Otherwise a map that opens on "everything happening" immediately asks for
    // a box its own validator refuses.
    const box = extentOf([
      { latitude: 8.5, longitude: 8.5 },
      { latitude: 10.4, longitude: 10.4 },
    ]);
    assert.ok(box !== null);
    assert.equal(isValidBox(box), true);
  });
});
