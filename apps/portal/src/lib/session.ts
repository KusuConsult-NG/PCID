import { createSessionStore } from '@pcid/portal-kit/session';
import type { PortalSessionBase } from '@pcid/portal-kit/session';

import { SESSION_COOKIE, env } from './env';

/**
 * The resident's session.
 *
 * The sealing itself lives in `@pcid/portal-kit`, shared with the government
 * portal: two copies of a session-encryption routine is one copy that quietly
 * stops being reviewed. What is here is what a resident's session carries that
 * an officer's does not.
 */
export interface PortalSession extends PortalSessionBase {
  readonly pcid: string | null;
  /** Set when the passphrase was issued at a desk and not yet replaced. */
  readonly mustChangePassword: boolean;
  /**
   * Authenticator enrolment in progress.
   *
   * The secret and recovery codes are shown once and must survive the round trip
   * between "set this up" and "here is the code from my app". They live here
   * rather than in a page URL or a hidden field because this cookie is
   * encrypted, http-only and never leaves the server - the browser holds the
   * ciphertext and nothing else.
   */
  readonly pendingEnrolment?: {
    readonly secret: string;
    readonly provisioningUri: string;
    readonly recoveryCodes: readonly string[];
  } | null;
}

const store = createSessionStore<PortalSession>(() => ({
  cookieName: SESSION_COOKIE,
  key: env.sessionKey,
  ttlSeconds: env.sessionTtlSeconds,
  secure: env.isProduction,
}));

export const sessions = store;
export const sealSession = store.seal;
export const openSession = store.open;
export const readSession = (): Promise<PortalSession | null> => store.read();
export const writeSession = (session: PortalSession): Promise<void> => store.write(session);
export const clearSession = (): Promise<void> => store.clear();
