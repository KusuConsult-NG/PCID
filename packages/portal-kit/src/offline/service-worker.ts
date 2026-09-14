'use client';

/**
 * Registering the service worker, and what it is allowed to do (§56).
 *
 * The worker in `public/sw.js` caches the application *shell* - the stylesheet,
 * the fonts, the icons, one offline page - and deliberately nothing else. It
 * never caches an authenticated response, because a portal page holds the very
 * information this platform spends its effort deciding who may see, and the
 * browser's HTTP cache is neither encrypted nor revocable.
 *
 * What a device holds offline goes through `store.ts` instead: sealed under a
 * non-extractable key, expiring, and erased when the platform says so.
 */

export interface ServiceWorkerState {
  readonly supported: boolean;
  readonly registered: boolean;
  readonly error: string | null;
}

export async function registerServiceWorker(path = '/sw.js'): Promise<ServiceWorkerState> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return { supported: false, registered: false, error: null };
  }
  try {
    await navigator.serviceWorker.register(path, { scope: '/' });
    return { supported: true, registered: true, error: null };
  } catch (error) {
    // A failed registration is not a failed portal: everything still works
    // online. Reported rather than swallowed so somebody can see it.
    return { supported: true, registered: false, error: (error as Error).message };
  }
}

/**
 * Remove the worker and its caches. Used on sign-out, so a shared device does
 * not keep serving the previous person's shell from disk.
 */
export async function unregisterServiceWorker(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));
  if (typeof caches !== 'undefined') {
    const names = await caches.keys();
    await Promise.all(names.map((name) => caches.delete(name)));
  }
}
