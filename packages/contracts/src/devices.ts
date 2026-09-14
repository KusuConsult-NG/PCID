/**
 * Registered devices and the controlled offline mode (master system prompt §56).
 *
 * A responder at a roadside with no signal still has to know whether the person
 * in front of them is diabetic. That is the whole case for holding anything on a
 * device, and it is narrow enough to say in a sentence: the minimum necessary
 * emergency profile for people already attached to an incident this responder is
 * already attached to, and a resident's own Plateau Citizen ID.
 *
 * Six properties, each enforced somewhere a reader can check:
 *
 *  1. **Encrypted.** The bundle is sealed in the browser under a key that the
 *     WebCrypto store will use but never hand back, so an image of the device's
 *     storage is ciphertext.
 *  2. **Expiring.** Bounded here, and again by a database constraint, so no code
 *     path can issue a longer-lived one.
 *  3. **Device-bound.** Released to a registered device, recorded against it.
 *  4. **Minimal.** Bounded in size and composed only of releases the policy
 *     engine already made for that person under that incident.
 *  5. **Revocable.** Revoking the device refuses the next request and tells the
 *     client to erase what it holds.
 *  6. **Never a copy of the registry.** There is no path that returns people who
 *     are not already linked to the incident, and a hard cap besides.
 */

export const DEVICE_PLATFORMS = ['ANDROID', 'IOS', 'DESKTOP', 'OTHER'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

export const DEVICE_STATUSES = ['ACTIVE', 'REVOKED'] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

export const DEVICE_REVOCATION_REASONS = [
  'USER_REQUEST',
  'LOST_OR_STOLEN',
  'ADMINISTRATIVE',
  'ACCOUNT_CLOSED',
] as const;
export type DeviceRevocationReason = (typeof DEVICE_REVOCATION_REASONS)[number];

/**
 * What an offline bundle may be.
 *
 * Two kinds, and adding a third is a deliberate act rather than a parameter:
 * every kind is a standing decision that some data may leave the platform's
 * control for a while, and that decision deserves its own name in the audit
 * trail.
 */
export const OFFLINE_BUNDLE_KINDS = ['CITIZEN_CARD', 'INCIDENT_PROFILES'] as const;
export type OfflineBundleKind = (typeof OFFLINE_BUNDLE_KINDS)[number];

/**
 * How long a bundle stays readable. A shift is eight hours; four is long enough
 * for the job in front of the crew and short enough that a phone left in a
 * vehicle overnight holds nothing in the morning.
 */
export const OFFLINE_BUNDLE_TTL_SECONDS: Readonly<Record<OfflineBundleKind, number>> =
  Object.freeze({
    INCIDENT_PROFILES: 4 * 60 * 60,
    // A resident's own identifier, which is theirs and changes only when they
    // report the credential lost. A day, so a card works on a journey with no
    // coverage, and no longer, so a lost phone stops showing it.
    CITIZEN_CARD: 24 * 60 * 60,
  });

/** The ceiling a database constraint also enforces. Nothing may exceed it. */
export const OFFLINE_BUNDLE_MAX_TTL_SECONDS = 24 * 60 * 60;

/**
 * The most people one bundle may describe.
 *
 * A bus crash with forty casualties is the case this has to serve; a bundle
 * larger than that is not a response, it is an extract. The service refuses
 * rather than truncating, because a silently shortened list of casualties is
 * worse than an error - a crew would not know somebody was missing from it.
 */
export const OFFLINE_BUNDLE_MAX_RECORDS = 50;

export function offlineBundleTtlSeconds(kind: OfflineBundleKind): number {
  return OFFLINE_BUNDLE_TTL_SECONDS[kind];
}

export function isDevicePlatform(value: unknown): value is DevicePlatform {
  return typeof value === 'string' && (DEVICE_PLATFORMS as readonly string[]).includes(value);
}
