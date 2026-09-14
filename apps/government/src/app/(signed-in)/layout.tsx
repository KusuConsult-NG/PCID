import { redirect } from 'next/navigation';

import { Masthead, SiteFooter } from '@/components/chrome';
import { NavLink } from '@/components/nav-link';
import { callApi } from '@/lib/api';
import { canAny, readSession } from '@/lib/session';
import type { GovernmentSession } from '@/lib/session';

import { signOut } from '../sign-in/actions';

/**
 * Navigation built from what this account may actually do.
 *
 * The action list comes from `/auth/me`, which is what the policy engine itself
 * reads — so a menu built from it cannot offer work the engine will refuse.
 * A registration desk does not see the audit trail; an auditor does not see the
 * registration form. That is not only tidier: a menu of twenty items of which
 * three work teaches people to click and see, which is exactly the habit a
 * purpose-bound system cannot afford.
 *
 * It is a rendering decision and never an authorisation one. Every request is
 * authorised again at the API, so a stale entitlement list shows a link that
 * does not work rather than opening something it should not.
 */
const SECTIONS: readonly {
  href: string;
  label: string;
  actions: readonly string[];
}[] = [
  { href: '/home', label: 'Home', actions: [] },
  { href: '/verify', label: 'Verify an ID', actions: ['CITIZEN_VERIFY'] },
  { href: '/find', label: 'Find a person', actions: ['CITIZEN_SEARCH'] },
  { href: '/register', label: 'Register a resident', actions: ['CITIZEN_CREATE'] },
  { href: '/duplicates', label: 'Duplicate review', actions: ['DUPLICATE_REVIEW'] },
  { href: '/corrections', label: 'Corrections', actions: ['CORRECTION_REQUEST_REVIEW'] },
  { href: '/alerts', label: 'Alerts', actions: ['ALERT_VIEW'] },
  {
    href: '/access-requests',
    label: 'Access requests',
    actions: ['ACCESS_REQUEST_CREATE', 'ACCESS_REQUEST_APPROVE'],
  },
  { href: '/audit', label: 'Audit trail', actions: ['AUDIT_VIEW'] },
  { href: '/retention', label: 'Retention', actions: ['RETENTION_VIEW'] },
  {
    href: '/administration',
    label: 'Administration',
    actions: ['ADMIN_AGENCY_MANAGE', 'ADMIN_USER_MANAGE', 'ADMIN_INTEGRATION_MANAGE'],
  },
  { href: '/account', label: 'My account', actions: [] },
];

export default async function SignedInLayout({ children }: { children: React.ReactNode }) {
  const session = await readSession();
  if (session === null) redirect('/sign-in');
  if (session.pendingMfaSessionId !== null) redirect('/sign-in/verify');
  if (session.mustChangePassword) redirect('/change-passphrase');

  // The account may have been suspended, or a role removed, since the menu was
  // last built. Re-read it rather than trusting a fifteen-minute-old copy.
  const me = await callApi<{ actions: string[] }>('/api/v1/auth/me');
  if (!me.ok && me.status === 401) redirect('/sign-in?error=expired');
  const live: GovernmentSession = me.ok ? { ...session, actions: me.data.actions } : session;

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
        <div className="shell">{children}</div>
      </main>

      <SiteFooter />
    </>
  );
}
