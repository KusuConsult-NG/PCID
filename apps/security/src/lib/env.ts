/**
 * Security agency portal configuration, read at the point of use.
 *
 * Like the citizen portal, this application holds a session-encryption key and
 * an API base URL and nothing else - no database credential, no token-signing
 * key. It is a client of the platform and is authorised exactly as the officer
 * signed into it is.
 *
 * Values are read through getters so `next build` - which evaluates every route
 * module to collect its configuration - does not need the runtime secret.
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
    return required('SECURITY_PORTAL_SESSION_KEY');
  },
  get isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  },
  /**
   * How long an idle session lasts before an officer signs in again.
   *
   * The shortest of the three. What is reachable from here is case-bound access
   * to the register under a criminal-investigation purpose, and the machine it
   * is open on is in a command room somebody else can walk into.
   */
  get sessionTtlSeconds(): number {
    return Number(process.env.SECURITY_PORTAL_SESSION_TTL_SECONDS ?? 60 * 10);
  },
} as const;

export const SESSION_COOKIE = 'pcid_security_session';
