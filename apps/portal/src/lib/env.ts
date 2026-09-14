/**
 * Portal configuration, validated at the point of use.
 *
 * The portal holds a session-encryption key the API knows nothing about, and an
 * API base URL. It holds no database credential and no API signing key: it is a
 * client of the platform like any other, and is trusted with nothing more than
 * the tokens of the person currently signed in.
 *
 * The values are read through getters rather than at module load so that
 * `next build` - which evaluates every route module to collect its
 * configuration - does not need the runtime secret. A build machine should
 * never hold one. The first request that actually needs the key still fails
 * loudly if it is missing.
 */
function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing required configuration: ${name}`);
  }
  return value;
}

export const env = {
  get apiBaseUrl(): string {
    return (process.env.PCID_API_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
  },
  get sessionKey(): string {
    return required('PORTAL_SESSION_KEY');
  },
  get isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  },
  /** How long an idle portal session lasts before the resident signs in again. */
  get sessionTtlSeconds(): number {
    return Number(process.env.PORTAL_SESSION_TTL_SECONDS ?? 60 * 30);
  },
} as const;

export const SESSION_COOKIE = 'pcid_portal_session';
