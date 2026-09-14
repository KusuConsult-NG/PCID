/**
 * The PCID credential (master system prompt §39, §40).
 *
 * A credential is the thing a resident carries: a printed card, or the digital
 * one in the portal. It is deliberately separate from the identity behind it —
 * the PCID is for life and is never reissued, while a credential can be
 * suspended, revoked and replaced when a card is lost.
 *
 * The QR on a credential encodes a verification URL ending in an opaque random
 * token. It carries no name, no PCID and no date of birth, so reading it
 * discloses nothing; resolving it requires an authenticated officer holding the
 * verification action, and returns only whether the credential is live and the
 * name printed on it.
 */
export const CREDENTIAL_FORMATS = ['DIGITAL', 'PHYSICAL'] as const;
export type CredentialFormat = (typeof CREDENTIAL_FORMATS)[number];

export const CREDENTIAL_STATUSES = [
  'ACTIVE',
  'SUSPENDED',
  'REVOKED',
  'REPLACED',
  'EXPIRED',
] as const;
export type CredentialStatus = (typeof CREDENTIAL_STATUSES)[number];

export const CREDENTIAL_TOKEN_PURPOSES = ['PORTAL_DISPLAY', 'CARD_PRINT'] as const;
export type CredentialTokenPurpose = (typeof CREDENTIAL_TOKEN_PURPOSES)[number];

/**
 * A token shown on a screen expires quickly, so a photograph of somebody else's
 * phone stops working within minutes. The database enforces this ceiling too.
 */
export const CREDENTIAL_PORTAL_TOKEN_TTL_SECONDS = 300;
export const CREDENTIAL_PORTAL_TOKEN_MAX_TTL_SECONDS = 900;

/** Printed cards are valid for five years unless revoked sooner. */
export const CREDENTIAL_DEFAULT_VALIDITY_DAYS = 365 * 5;

/** Serial numbers are human-readable and distinct from the PCID itself. */
export const CREDENTIAL_SERIAL_PATTERN = /^PLC-[0-9]{4}-[0-9A-HJKMNP-TV-Z]{8}$/;

export function isCredentialUsable(
  status: CredentialStatus,
  expiresAt: Date | null,
  now = new Date(),
): boolean {
  if (status !== 'ACTIVE') return false;
  if (expiresAt !== null && expiresAt.getTime() <= now.getTime()) return false;
  return true;
}
