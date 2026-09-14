/**
 * Bounding boxes, and the arithmetic a map asks for
 * (master system prompt §16, §35).
 *
 * Pure and I/O-free, like the policy engine and for the same reason: the sums
 * that decide what appears on a command map should be testable without a
 * database, and readable by somebody checking them against a chart.
 *
 * Everything here is about *places* - an incident, a vehicle. Nothing in this
 * module takes a person, and there is no function that could be given one.
 */

export interface BoundingBox {
  readonly north: number;
  readonly south: number;
  readonly east: number;
  readonly west: number;
}

export interface Position {
  readonly latitude: number;
  readonly longitude: number;
}

/** Mean Earth radius, the value the platform's SQL great-circle uses. */
const EARTH_RADIUS_METRES = 6_371_008.8;

/** Plateau State is roughly 8.4°–10.4°N, 8.4°–10.5°E. A box may not be absurd. */
export const MAX_BOX_DEGREES = 12;

export function isValidBox(box: BoundingBox): boolean {
  if (![box.north, box.south, box.east, box.west].every(Number.isFinite)) return false;
  if (box.north > 90 || box.south < -90 || box.east > 180 || box.west < -180) return false;
  if (box.north <= box.south || box.east <= box.west) return false;
  // A request for half the planet is not a map view; it is somebody asking for
  // everything and calling it a viewport.
  return box.north - box.south <= MAX_BOX_DEGREES && box.east - box.west <= MAX_BOX_DEGREES;
}

export function contains(box: BoundingBox, position: Position): boolean {
  return (
    position.latitude <= box.north &&
    position.latitude >= box.south &&
    position.longitude <= box.east &&
    position.longitude >= box.west
  );
}

/**
 * A box around a point, in metres.
 *
 * Used to bound a proximity query before any distance is computed, so the
 * database can use an index instead of measuring every row on Earth. The box is
 * deliberately a little generous: it is a filter, and the distance sort that
 * follows it is what decides the answer.
 */
export function boxAround(centre: Position, radiusMetres: number): BoundingBox {
  const latitudeDegrees = (radiusMetres / EARTH_RADIUS_METRES) * (180 / Math.PI);
  // Longitude degrees shrink towards the poles. At the equator they do not, and
  // a cosine of zero would give an infinite box, so the factor is floored.
  const shrink = Math.max(Math.cos((centre.latitude * Math.PI) / 180), 0.01);
  const longitudeDegrees = latitudeDegrees / shrink;
  return {
    north: clampLatitude(centre.latitude + latitudeDegrees),
    south: clampLatitude(centre.latitude - latitudeDegrees),
    east: centre.longitude + longitudeDegrees,
    west: centre.longitude - longitudeDegrees,
  };
}

/** The same great-circle distance the database computes, for use in tests and sorting. */
export function distanceMetres(from: Position, to: Position): number {
  const φ1 = (from.latitude * Math.PI) / 180;
  const φ2 = (to.latitude * Math.PI) / 180;
  const Δφ = φ2 - φ1;
  const Δλ = ((to.longitude - from.longitude) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return Math.round(EARTH_RADIUS_METRES * 2 * Math.asin(Math.sqrt(a)));
}

/**
 * The smallest box containing every position given, with a margin.
 *
 * What a command map opens on when nobody has chosen a view: everything that is
 * happening, and a little air around it. An empty list has no extent, and the
 * caller decides what to show instead of guessing at one.
 */
export function extentOf(positions: readonly Position[], marginDegrees = 0.02): BoundingBox | null {
  if (positions.length === 0) return null;
  let north = -90;
  let south = 90;
  let east = -180;
  let west = 180;
  for (const position of positions) {
    north = Math.max(north, position.latitude);
    south = Math.min(south, position.latitude);
    east = Math.max(east, position.longitude);
    west = Math.min(west, position.longitude);
  }
  // A single point has no extent. Give it one, or a map of one incident is a
  // division by zero rather than a picture.
  const padLatitude = Math.max(marginDegrees, (north - south) * 0.1);
  const padLongitude = Math.max(marginDegrees, (east - west) * 0.1);
  return {
    north: clampLatitude(north + padLatitude),
    south: clampLatitude(south - padLatitude),
    east: east + padLongitude,
    west: west - padLongitude,
  };
}

function clampLatitude(value: number): number {
  return Math.min(90, Math.max(-90, value));
}
