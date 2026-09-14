import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Masthead, SiteFooter } from '@/components/chrome';
import { NavLink } from '@/components/nav-link';
import { callApi } from '@/lib/api';
import { canAny, readSession } from '@/lib/session';
import type { EmergencySession } from '@/lib/session';

import { signOut } from '../sign-in/actions';

/**
 * The shell, and the guard.
 *
 * The navigation is built from the account's resolved entitlements, read from
 * `/auth/me` — the list the policy engine itself reads. A control room sees
 * dispatching; an ambulance crew does not. A fleet office sees the vehicles and
 * nothing about any person at all.
 *
 * It stays a rendering decision. Every request is authorised again at the API,
 * and in this portal almost everything is refused unless an active incident says
 * otherwise, so a stale menu shows a link that does not work rather than opening
 * anything.
 */
const SECTIONS: readonly { href: string; label: string; actions: readonly string[] }[] = [
  { href: '/home', label: 'Board', actions: [] },
  { href: '/incidents', label: 'Incidents', actions: ['INCIDENT_VIEW', 'INCIDENT_CREATE'] },
  { href: '/map', label: 'Map', actions: ['INCIDENT_VIEW', 'RESPONSE_UNIT_VIEW'] },
  { href: '/identify', label: 'Identify someone', actions: ['EMERGENCY_PROFILE_VIEW'] },
  { href: '/units', label: 'Units', actions: ['RESPONSE_UNIT_VIEW', 'RESPONSE_UNIT_MANAGE'] },
  {
    href: '/unidentified-persons',
    label: 'Somebody found',
    actions: ['UNIDENTIFIED_PERSON_CREATE', 'UNIDENTIFIED_PERSON_VIEW'],
  },
  {
    href: '/authorisation',
    label: 'Break glass',
    actions: [
      'BREAK_GLASS_INITIATE',
      'BREAK_GLASS_REVIEW',
      'ACCESS_REQUEST_CREATE',
      'ACCESS_REQUEST_APPROVE',
    ],
  },
  { href: '/account', label: 'My account', actions: [] },
];

export default async function SignedInLayout({ children }: { children: React.ReactNode }) {
  const session = await readSession();
  if (session === null) redirect('/sign-in');
  if (session.pendingMfaSessionId !== null) redirect('/sign-in/verify');
  if (session.mustChangePassword) redirect('/change-passphrase');

  const me = await callApi<{ actions: string[] }>('/api/v1/auth/me');
  if (!me.ok && me.status === 401) redirect('/sign-in?error=expired');
  const live: EmergencySession = me.ok ? { ...session, actions: me.data.actions } : session;

  const visible = SECTIONS.filter(
    (section) => section.actions.length === 0 || canAny(live, ...section.actions),
  );

  return (
    <>
      <Masthead>
        <div className="masthead-account">
          <span>
            <span className="visually-hidden">Signed in as </span>
            {live.displayName}
            {live.agencyName === null ? null : <span className="small"> · {live.agencyName}</span>}
          </span>
          <form action={signOut}>
            <button type="submit" className="button button-secondary">
              Sign out
            </button>
          </form>
        </div>
      </Masthead>

      <nav className="primary" aria-label="Portal sections">
        <div className="shell">
          <ul>
            {visible.map((section) => (
              <li key={section.href}>
                <NavLink href={section.href}>{section.label}</NavLink>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      <main id="main">
        <div className="shell">
          {session.workingIncident === null ? null : (
            <div className="incident-banner">
              <span>
                <strong>Attending:</strong>{' '}
                <Link href={`/incidents/${encodeURIComponent(session.workingIncident.reference)}`}>
                  {session.workingIncident.reference}
                </Link>{' '}
                — {session.workingIncident.summary}
              </span>
              {session.workingUnit === null ? null : (
                <span className="small">Riding {session.workingUnit}</span>
              )}
              <span className="small muted">
                A reminder, not an authority. The incident still has to be live and you still have
                to be on it.
              </span>
            </div>
          )}
          {children}
        </div>
      </main>

      <SiteFooter />
    </>
  );
}
