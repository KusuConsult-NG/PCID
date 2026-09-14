/**
 * Government portal configuration, read at the point of use.
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
    return required('GOVERNMENT_PORTAL_SESSION_KEY');
  },
  get isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  },
  /**
   * How long an idle session lasts before an officer signs in again.
   *
   * Shorter than the citizen portal's by default. A resident's portal is open on
   * their own phone; an officer's is open on a shared counter machine in a busy
   * office, and an unattended signed-in session there is somebody else's access
   * to the register.
   */
  get sessionTtlSeconds(): number {
    return Number(process.env.GOVERNMENT_PORTAL_SESSION_TTL_SECONDS ?? 60 * 15);
  },
} as const;

export const SESSION_COOKIE = 'pcid_government_session';
