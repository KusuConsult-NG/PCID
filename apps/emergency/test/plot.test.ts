import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { confidence, plotFor } from '../src/lib/plot';

/**
 * The arithmetic behind the command picture.
 *
 * Tested without a DOM and without a browser, because it is arithmetic: a
 * projection, a scale bar and a sentence about how much a coordinate should be
 * trusted. A picture whose geometry nobody can check is a picture nobody should
 * make a dispatching decision from.
 */

/** A view roughly the size of the Jos plateau. */
const VIEW = { north: 10.0, south: 9.8, east: 8.95, west: 8.75 };

describe('placing a position on the canvas', () => {
  test('the corners of the view land on the corners of the canvas', () => {
    const plot = plotFor(VIEW, 1000, 700);

    const topLeft = plot.place({ latitude: VIEW.north, longitude: VIEW.west });
    const bottomRight = plot.place({ latitude: VIEW.south, longitude: VIEW.east });

    assert.deepEqual(topLeft, { x: 0, y: 0 });
    assert.deepEqual(bottomRight, { x: 1000, y: 700 });
  });

  test('north is up, which SVG does not do by itself', () => {
    const plot = plotFor(VIEW, 1000, 700);
    const north = plot.place({ latitude: 9.95, longitude: 8.85 });
    const south = plot.place({ latitude: 9.85, longitude: 8.85 });

    assert.ok(north && south);
    assert.ok(north.y < south.y, 'the northern point is higher on the screen');
  });

  test('east is right', () => {
    const plot = plotFor(VIEW, 1000, 700);
    const west = plot.place({ latitude: 9.9, longitude: 8.78 });
    const east = plot.place({ latitude: 9.9, longitude: 8.92 });

    assert.ok(west && east);
    assert.ok(east.x > west.x);
  });

  test('a position outside the view is not drawn at the edge', () => {
    // Clamping would put a pin on the boundary of the picture, where a
    // controller would read it as something happening at the edge of the view
    // rather than something outside it.
    const plot = plotFor(VIEW, 1000, 700);
    assert.equal(plot.place({ latitude: 6.5, longitude: 3.4 }), null);
    assert.equal(plot.place({ latitude: 9.9, longitude: 9.9 }), null);
  });

  test('the centre of the view is the centre of the canvas', () => {
    const plot = plotFor(VIEW, 1000, 700);
    const centre = plot.place({
      latitude: (VIEW.north + VIEW.south) / 2,
      longitude: (VIEW.east + VIEW.west) / 2,
    });
    assert.ok(centre);
    assert.ok(Math.abs(centre.x - 500) < 0.5);
    assert.ok(Math.abs(centre.y - 350) < 0.5);
  });
});

describe('the scale bar', () => {
  test('it carries a round number somebody would say out loud', () => {
    const plot = plotFor(VIEW, 1000, 700);
    assert.ok(
      [1, 2, 5, 10, 20, 50, 100, 200, 500].includes(plot.scaleBar.kilometres),
      `${plot.scaleBar.kilometres} is not a number anybody puts on a scale bar`,
    );
  });

  test('it is about a quarter of the picture, and always fits inside it', () => {
    for (const view of [
      VIEW,
      { north: 10.5, south: 8.4, east: 10.5, west: 8.4 },
      { north: 9.91, south: 9.89, east: 8.86, west: 8.84 },
    ]) {
      const plot = plotFor(view, 1000, 700);
      assert.ok(plot.scaleBar.width > 0, 'a scale bar of no width tells nobody anything');
      assert.ok(plot.scaleBar.width < 1000, 'and one wider than the picture is worse');
    }
  });

  test('a wider view means more kilometres to the same bar', () => {
    const tight = plotFor({ north: 9.91, south: 9.89, east: 8.86, west: 8.84 }, 1000, 700);
    const wide = plotFor({ north: 10.5, south: 8.4, east: 10.5, west: 8.4 }, 1000, 700);
    assert.ok(wide.scaleBar.kilometres > tight.scaleBar.kilometres);
  });

  test('a degenerate view does not divide by zero', () => {
    // One incident and nothing else produces an extent with no width until the
    // server pads it. The plot must survive the un-padded case regardless.
    const plot = plotFor({ north: 9.9, south: 9.9, east: 8.85, west: 8.85 }, 1000, 700);
    assert.ok(Number.isFinite(plot.scaleBar.width));
    assert.ok(Number.isFinite(plot.scaleBar.kilometres));
  });
});

describe('how much a pin should be trusted', () => {
  test('each provenance gets a sentence, and an unknown one says so', () => {
    assert.equal(
      confidence({ latitude: 0, longitude: 0, source: 'RESPONDER_OBSERVED' }),
      'Reported from the scene',
    );
    assert.equal(
      confidence({ latitude: 0, longitude: 0, source: 'CALLER_SUPPLIED' }),
      'Given by the caller',
    );
    // A registered address is not where the emergency is. Saying so is the
    // difference between a crew driving to a house and to a road.
    assert.match(
      confidence({ latitude: 0, longitude: 0, source: 'REGISTERED_ADDRESS' }),
      /not the scene/,
    );
    assert.equal(confidence({ latitude: 0, longitude: 0, source: null }), 'Source not recorded');
    assert.equal(
      confidence({ latitude: 0, longitude: 0, source: 'SOMETHING_NEW' }),
      'Source not recorded',
    );
  });
});
