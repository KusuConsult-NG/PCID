import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Masthead, SiteFooter } from '@/components/chrome';
import { callApi } from '@/lib/api';
import { readSession } from '@/lib/session';
import type { NotificationInbox } from '@/lib/types';

import { signOut } from '../sign-in/actions';
import { NavLink } from './nav-link';

const LINKS = [
  { href: '/dashboard', label: 'Home' },
  { href: '/identity', label: 'My Plateau Citizen ID' },
  { href: '/records', label: 'My records' },
  { href: '/emergency-contacts', label: 'Emergency contacts' },
  { href: '/access-history', label: 'Who has seen my record' },
  { href: '/corrections', label: 'Corrections' },
  { href: '/notifications', label: 'Messages' },
  { href: '/report', label: 'Report something' },
  { href: '/security', label: 'Security' },
] as const;

/**
 * The shell every signed-in page renders inside.
 *
 * It is also the guard: a session that has not presented its second factor, or
 * that still owes a passphrase change, cannot reach any of these pages. Putting
 * that here rather than in each page means a new page is protected by default.
 */
export default async function SignedInLayout({ children }: { children: React.ReactNode }) {
  const session = await readSession();
  if (session === null) redirect('/sign-in');
  if (session.pendingMfaSessionId !== null) redirect('/sign-in/verify');
  if (session.mustChangePassword) redirect('/change-passphrase');

  const inbox = await callApi<NotificationInbox>('/api/v1/me/notifications?limit=1');
  const unread = inbox.ok ? inbox.data.unread : 0;

  return (
    <>
      <Masthead>
        <div className="masthead-account">
          <span>
            <span className="visually-hidden">Signed in as </span>
            {session.displayName}
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
            {LINKS.map((link) => (
              <li key={link.href}>
                <NavLink href={link.href}>
                  {link.label}
                  {link.href === '/notifications' && unread > 0 ? (
                    <>
                      {' '}
                      <span className="badge badge-info">
                        {unread}
                        <span className="visually-hidden"> unread</span>
                      </span>
                    </>
                  ) : null}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      <main id="main">
        <div className="shell">{children}</div>
      </main>

      <div className="shell" style={{ paddingBottom: '2rem' }}>
        <p className="small muted">
          Need help? <Link href="/report">Report a problem</Link> or visit any registration desk.
        </p>
      </div>
      <SiteFooter />
    </>
  );
}
