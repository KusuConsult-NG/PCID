import { Badge } from '@pcid/portal-kit/components';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Masthead, SiteFooter } from '@/components/chrome';
import { NavLink } from '@/components/nav-link';
import { callApi } from '@/lib/api';
import { canAny, readSession } from '@/lib/session';
import type { SecuritySession } from '@/lib/session';

import { signOut } from '../sign-in/actions';

/**
 * The shell, and the guard.
 *
 * The navigation is built from the account's resolved entitlements, read from
 * `/auth/me` — the list the policy engine itself reads. An investigator does not
 * see the missing-person register they hold no role for, and a missing-person
 * desk does not see the break-glass review queue.
 *
 * It stays a rendering decision. Every request is authorised again at the API,
 * and in this portal most of them are refused unless a case says otherwise, so a
 * stale menu shows a link that does not work rather than opening anything.
 */
const SECTIONS: readonly { href: string; label: string; actions: readonly string[] }[] = [
  { href: '/home', label: 'Home', actions: [] },
  { href: '/cases', label: 'Cases', actions: ['CASE_VIEW', 'CASE_CREATE'] },
  { href: '/find', label: 'Find a person', actions: ['CITIZEN_SEARCH'] },
  {
    href: '/missing-persons',
    label: 'Missing persons',
    actions: ['MISSING_PERSON_VIEW', 'MISSING_PERSON_CREATE'],
  },
  {
    href: '/unidentified-persons',
    label: 'Unidentified persons',
    actions: ['UNIDENTIFIED_PERSON_VIEW', 'UNIDENTIFIED_PERSON_CREATE'],
  },
  {
    href: '/authorisation',
    label: 'Access and break glass',
    actions: [
      'ACCESS_REQUEST_CREATE',
      'ACCESS_REQUEST_APPROVE',
      'BREAK_GLASS_INITIATE',
      'BREAK_GLASS_REVIEW',
    ],
  },
  { href: '/account', label: 'My account', actions: [] },
];

export default async function SignedInLayout({ children }: { children: React.ReactNode }) {
  const session = await readSession();
  if (session === null) redirect('/sign-in');
  if (session.pendingMfaSessionId !== null) redirect('/sign-in/verify');
  if (session.mustChangePassword) redirect('/change-passphrase');

  const me = await callApi<{ actions: string[]; compartments: string[] }>('/api/v1/auth/me');
  if (!me.ok && me.status === 401) redirect('/sign-in?error=expired');
  const live: SecuritySession = me.ok ? { ...session, actions: me.data.actions } : session;
  const compartments = me.ok ? me.data.compartments : [];

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
          {session.workingCase === null ? null : (
            <div className="purpose-banner">
              <span>
                <strong>Working under case:</strong>{' '}
                <Link href={`/cases/${encodeURIComponent(session.workingCase.reference)}`}>
                  {session.workingCase.reference}
                </Link>{' '}
                — {session.workingCase.title}
              </span>
              {compartments.includes('LAW_ENFORCEMENT_RESTRICTED') ? (
                <Badge tone="muted">Law-enforcement compartment</Badge>
              ) : null}
              <span className="small muted">
                A reminder, not an authority. The case still has to be active and you still have to
                be on it.
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
