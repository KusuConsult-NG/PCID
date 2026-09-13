import { createHash, randomBytes as nodeRandomBytes } from 'node:crypto';

/**
 * Plateau Citizen ID format (master system prompt §49).
 *
 * Format: `PL-XXXXX-XXXXX-CC`
 *
 *  - 10 payload characters drawn uniformly from Crockford Base32 (50 bits of
 *    cryptographic entropy), so the identifier is unique, non-sequential and
 *    non-predictable.
 *  - 2 trailing check characters derived from SHA-256 over the payload, which
 *    catch mistyped and transposed characters before a lookup is attempted.
 *  - Crockford Base32 excludes I, L, O and U, and decoding folds I/L to 1 and O
 *    to 0. A responder typing an ID off a card under pressure cannot produce a
 *    silent mis-read.
 *
 * The PCID is derived from nothing. It carries no NIN, phone number, date of
 * birth, LGA, sex or name, and no information can be recovered from it - the only
 * input to generation is a cryptographic random source.
 *
 * Non-recycling is a database guarantee, not a format guarantee: every value ever
 * issued is recorded in the append-only `pcid_allocation` table with a unique
 * constraint, and nothing in the platform deletes from it.
 */
export const PCID_PREFIX = 'PL';
export const PCID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const PAYLOAD_LENGTH = 10;
const CHECK_LENGTH = 2;

/** Canonical form, e.g. `PL-4K7T9-QM2XB-7H`. */
export const PCID_PATTERN =
  /^PL-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{2}$/;

export interface RandomSource {
  (byteLength: number): Buffer;
}

function encodePayload(bytes: Buffer): string {
  // Rejection-free uniform mapping: consume 5 bits at a time from a bit buffer.
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < PAYLOAD_LENGTH) {
      bits -= 5;
      out += PCID_ALPHABET[(value >>> bits) & 0b11111];
    }
    value &= (1 << bits) - 1;
    if (out.length === PAYLOAD_LENGTH) break;
  }
  if (out.length !== PAYLOAD_LENGTH) {
    throw new Error('Insufficient entropy supplied for PCID payload');
  }
  return out;
}

/** Two check characters over the payload. */
export function pcidCheckCharacters(payload: string): string {
  const digest = createHash('sha256').update(`${PCID_PREFIX}:${payload}`, 'utf8').digest();
  // 10 bits -> two base32 characters.
  const first = digest[0] as number;
  const second = digest[1] as number;
  const bits = ((first << 8) | second) >>> 6; // top 10 bits
  const high = (bits >>> 5) & 0b11111;
  const low = bits & 0b11111;
  return `${PCID_ALPHABET[high]}${PCID_ALPHABET[low]}`;
}

function format(payload: string, check: string): string {
  return `${PCID_PREFIX}-${payload.slice(0, 5)}-${payload.slice(5, 10)}-${check}`;
}

/**
 * Generate a candidate PCID. Uniqueness across the registry is guaranteed by the
 * database, which rejects a collision; callers retry with a fresh candidate.
 */
export function generatePcid(randomSource: RandomSource = nodeRandomBytes): string {
  const payload = encodePayload(randomSource(8));
  return format(payload, pcidCheckCharacters(payload));
}

/**
 * Fold a user-entered value into canonical form. Accepts lower case, missing
 * hyphens, a missing `PL` prefix, and the Crockford confusables I/L/O.
 * Returns `null` when the value cannot be a PCID at all.
 */
export function normalizePcid(input: string): string | null {
  if (typeof input !== 'string') return null;
  const cleaned = input
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/^PL/, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
  if (cleaned.length !== PAYLOAD_LENGTH + CHECK_LENGTH) return null;
  if (!/^[0-9A-HJKMNP-TV-Z]+$/.test(cleaned)) return null;
  return format(cleaned.slice(0, PAYLOAD_LENGTH), cleaned.slice(PAYLOAD_LENGTH));
}

/** True when the value is a syntactically valid PCID with a correct check pair. */
export function isValidPcid(input: string): boolean {
  const normalized = normalizePcid(input);
  if (normalized === null) return false;
  const payload = normalized.slice(3, 8) + normalized.slice(9, 14);
  return pcidCheckCharacters(payload) === normalized.slice(15);
}

/** Normalise and validate in one step; returns `null` when the check fails. */
export function parsePcid(input: string): string | null {
  const normalized = normalizePcid(input);
  if (normalized === null) return null;
  return isValidPcid(normalized) ? normalized : null;
}
