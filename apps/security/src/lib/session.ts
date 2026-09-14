import { createSessionStore } from '@pcid/portal-kit/session';
import type { PortalSessionBase } from '@pcid/portal-kit/session';

import { SESSION_COOKIE, env } from './env';

/**
 * A security agency officer's session.
 *
 * The sealing is the shared one. What is here is the account's resolved
 * entitlements, so the navigation shows what this account can genuinely do; the
 * return address for a step-up, so an officer sent to re-authenticate mid-task
 * comes back to the task; and the case they are currently working, because in
 * this portal a record is opened *under* a case and the officer should not have
 * to re-state which one on every screen.
 *
 * The working case is a convenience and never an authority. It is sent as the
 * case reference on each request and the engine decides afresh every time: the
 * case has to be active, and this officer has to be assigned to it, and the
 * person has to be linked to it. Holding it in the cookie shortens nothing
 * except the typing.
 */
export interface SecuritySession extends PortalSessionBase {
  readonly userId: string;
  readonly email: string;
  readonly agencyName: string | null;
  readonly agencyCode: string | null;
  readonly roles: readonly string[];
  /**
   * The resolved action list from `/auth/me`.
   *
   * Read from the platform rather than inferred from role names: it is what the
   * policy engine itself reads, so an interface built from it cannot promise
   * something the engine will refuse. It is a convenience for rendering and
   * never a decision - every request is authorised again at the API.
   */
  readonly actions: readonly string[];
  /**
   * Set when the passphrase was chosen and typed by an administrator.
   *
   * Until the officer replaces it, two people know it. The signed-in shell sends
   * them to change it before anything else opens.
   */
  readonly mustChangePassword: boolean;
  /** Where to return after a step-up, if one interrupted something. */
  readonly stepUpReturnTo: string | null;
  /** The case this officer is working under. A convenience, never an authority. */
  readonly workingCase: { readonly reference: string; readonly title: string } | null;
}

const store = createSessionStore<SecuritySession>(() => ({
  cookieName: SESSION_COOKIE,
  key: env.sessionKey,
  ttlSeconds: env.sessionTtlSeconds,
  secure: env.isProduction,
}));

export const sessions = store;
export const readSession = (): Promise<SecuritySession | null> => store.read();
export const writeSession = (session: SecuritySession): Promise<void> => store.write(session);
export const clearSession = (): Promise<void> => store.clear();

/** Does this account hold the action? Rendering only; the API decides. */
export function can(session: SecuritySession | null, action: string): boolean {
  return session?.actions.includes(action) ?? false;
}

export function canAny(session: SecuritySession | null, ...actions: string[]): boolean {
  return actions.some((action) => can(session, action));
}
