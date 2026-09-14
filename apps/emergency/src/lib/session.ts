import { createSessionStore } from '@pcid/portal-kit/session';
import type { PortalSessionBase } from '@pcid/portal-kit/session';

import { SESSION_COOKIE, env } from './env';

/**
 * A responder's or controller's session.
 *
 * The sealing is the shared one. What is here is the account's resolved
 * entitlements, so the navigation shows what this account can genuinely do; the
 * return address for a step-up; and the incident they are working, because in
 * this portal every read of a person is made under one and a crew should not be
 * typing an incident number with gloves on.
 *
 * The working incident is a convenience and never an authority. It is sent as
 * the incident reference on each request and the engine decides afresh every
 * time: the incident has to be active, and this account or its agency has to be
 * attached to it. Holding it in the cookie shortens nothing except the typing.
 */
export interface EmergencySession extends PortalSessionBase {
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
  /** The incident this account is working. A convenience, never an authority. */
  readonly workingIncident: { readonly reference: string; readonly summary: string } | null;
  /**
   * The unit this crew is riding, if they said so.
   *
   * Only used to offer "report our position" without asking which vehicle. The
   * platform does not tie an account to a unit, and nothing here starts.
   */
  readonly workingUnit: string | null;
}

const store = createSessionStore<EmergencySession>(() => ({
  cookieName: SESSION_COOKIE,
  key: env.sessionKey,
  ttlSeconds: env.sessionTtlSeconds,
  secure: env.isProduction,
}));

export const sessions = store;
export const readSession = (): Promise<EmergencySession | null> => store.read();
export const writeSession = (session: EmergencySession): Promise<void> => store.write(session);
export const clearSession = (): Promise<void> => store.clear();

/** Does this account hold the action? Rendering only; the API decides. */
export function can(session: EmergencySession | null, action: string): boolean {
  return session?.actions.includes(action) ?? false;
}

export function canAny(session: EmergencySession | null, ...actions: string[]): boolean {
  return actions.some((action) => can(session, action));
}
