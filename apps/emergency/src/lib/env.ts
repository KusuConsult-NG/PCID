/**
 * Emergency response portal configuration, read at the point of use.
 *
 * Like the other portals, this application holds a session-encryption key and
 * an API base URL and nothing else - no database credential, no token-signing
 * key. It is a client of the platform and is authorised exactly as the person
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
    return required('EMERGENCY_PORTAL_SESSION_KEY');
  },
  get isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  },
  /**
   * How long an idle session lasts before signing in again.
   *
   * Twelve hours, and the longest of the four - which is the opposite of what a
   * risk table alone would say, and is deliberate. This portal is open on a
   * control-room wall and on a tablet in an ambulance at three in the morning;
   * a crew locked out mid-job will write the passphrase on the dashboard, and
   * then the control is worse than none. What keeps the risk down here is not
   * the timeout but the reach: an emergency profile is the minimum necessary
   * set, under an active incident this account is attached to, and closing the
   * incident closes it.
   */
  get sessionTtlSeconds(): number {
    return Number(process.env.EMERGENCY_PORTAL_SESSION_TTL_SECONDS ?? 60 * 60 * 12);
  },
} as const;

export const SESSION_COOKIE = 'pcid_emergency_session';
