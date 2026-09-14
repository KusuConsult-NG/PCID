import type { Metadata } from 'next';

import { OfflineReader, ServiceWorkerRegistrar } from '@/components/offline';

export const metadata: Metadata = { title: 'No signal' };

/**
 * Where a crew lands when the network is not there (master system prompt §56).
 *
 * Served from the device's own cache by the service worker, so it opens with the
 * radio off. It is deliberately outside the signed-in area: the session may have
 * expired hours ago in a place with no coverage, and a screen that demanded a
 * sign-in before showing a casualty's blood group would be useless exactly when
 * it is needed.
 *
 * What it shows is not the platform. It is what this device was given, sealed
 * under a key the browser will not hand back, with an expiry it enforces itself.
 */
export default function OfflinePage(): React.JSX.Element {
  return (
    <>
      <ServiceWorkerRegistrar />
      <main id="main" className="offline-page">
        <header className="page-header">
          <h1>No signal</h1>
          <p>
            This device cannot reach the platform. What is below was given to it while it could, and
            is all it holds.
          </p>
        </header>
        <OfflineReader />
        <p className="muted small">
          Nothing here is live. Anything you record — a person found, a status change — has to wait
          until you have a signal, because an emergency record that was never written is worse than
          one written late.
        </p>
      </main>
    </>
  );
}
