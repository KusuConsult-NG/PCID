import type { Metadata } from 'next';

import { OfflineCard, ServiceWorkerRegistrar } from '@/components/offline';

export const metadata: Metadata = { title: 'No connection' };

/**
 * What a resident sees with no coverage (master system prompt §56).
 *
 * Outside the signed-in area on purpose: a person in a queue whose session
 * expired on the journey should still be able to show their identifier, and a
 * sign-in screen is exactly what they cannot complete.
 *
 * The screen is honest about what it is. It shows what this phone was given, not
 * what the register says now, and it says so — because a card that looked
 * authoritative offline would be a card somebody could rely on after it had been
 * revoked.
 */
export default function OfflinePage(): React.JSX.Element {
  return (
    <>
      <ServiceWorkerRegistrar />
      <main id="main" className="offline-page">
        <header className="page-header">
          <h1>No connection</h1>
          <p>This phone cannot reach the portal. What is below was saved to it while it could.</p>
        </header>
        <OfflineCard />
        <p className="small muted">
          Everything else — who has looked at your record, your emergency contacts, a correction you
          asked for — needs a connection, because it is decided and recorded at the moment you ask.
        </p>
      </main>
    </>
  );
}
