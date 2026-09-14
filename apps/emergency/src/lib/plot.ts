import type { Pin, SituationView } from './types';

/**
 * Turning positions into a picture.
 *
 * Kept out of the page and out of the browser: it is arithmetic, it is testable
 * without a DOM, and the page that renders it is a server component with no
 * client JavaScript at all.
 *
 * The projection is equirectangular with a cosine correction on longitude. Over
 * a state-sized view that is accurate to well under a pixel, and it has the
 * property that matters here: it is obvious. A command picture whose geometry
 * nobody can check is a command picture nobody should trust.
 */

export interface Extent {
  readonly north: number;
  readonly south: number;
  readonly east: number;
  readonly west: number;
}

export interface Plot {
  readonly width: number;
  readonly height: number;
  /** Where a position falls on the canvas, or null if it is outside the view. */
  place(pin: { latitude: number; longitude: number }): { x: number; y: number } | null;
  /** A round number of kilometres and how wide that is in canvas units. */
  scaleBar: { kilometres: number; width: number };
}

const EARTH_RADIUS_KM = 6371.0088;

export function plotFor(extent: Extent, width = 1000, height = 700): Plot {
  const latitudeSpan = Math.max(extent.north - extent.south, 1e-6);
  const longitudeSpan = Math.max(extent.east - extent.west, 1e-6);
  const shrink = Math.max(Math.cos(((extent.north + extent.south) / 2) * (Math.PI / 180)), 0.01);

  return {
    width,
    height,
    place(pin) {
      if (
        pin.latitude > extent.north ||
        pin.latitude < extent.south ||
        pin.longitude > extent.east ||
        pin.longitude < extent.west
      ) {
        return null;
      }
      return {
        x: round(((pin.longitude - extent.west) / longitudeSpan) * width),
        // SVG counts downwards and the world counts upwards.
        y: round(((extent.north - pin.latitude) / latitudeSpan) * height),
      };
    },
    scaleBar: scaleBarFor(longitudeSpan, shrink, width),
  };
}

/**
 * A scale bar with a round number on it.
 *
 * Without one the picture is a diagram rather than a map: two pins a centimetre
 * apart could be two streets or two local governments, and a controller has no
 * way to tell which.
 */
function scaleBarFor(
  longitudeSpan: number,
  shrink: number,
  width: number,
): { kilometres: number; width: number } {
  const kilometresPerDegree = ((2 * Math.PI * EARTH_RADIUS_KM) / 360) * shrink;
  const spanKilometres = longitudeSpan * kilometresPerDegree;
  // About a quarter of the picture, rounded to something a person would say.
  const target = spanKilometres / 4;
  const kilometres = roundToNice(target);
  return {
    kilometres,
    width: round((kilometres / spanKilometres) * width),
  };
}

function roundToNice(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) {
    if (value <= step * magnitude) return step * magnitude;
  }
  return 10 * magnitude;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * How much a pin should be trusted, said in words.
 *
 * Provenance travels with every coordinate (§16), and on a map it is the
 * difference between a point a responder stood on and a point a frightened
 * caller guessed at.
 */
export function confidence(pin: Pin): string {
  switch (pin.source) {
    case 'RESPONDER_OBSERVED':
      return 'Reported from the scene';
    case 'CALLER_SUPPLIED':
      return 'Given by the caller';
    case 'INCIDENT_REPORT':
      return 'Taken with the report';
    case 'REGISTERED_ADDRESS':
      return 'From a registered address, not the scene';
    case 'GOVERNMENT_RECORD':
      return 'From a government record';
    case 'REAL_TIME_DEVICE':
      return 'From a device, live';
    default:
      return 'Source not recorded';
  }
}

/** Everything on the picture, for the count beside it. */
export function plotted(view: SituationView): number {
  return view.incidents.length + view.units.length;
}
