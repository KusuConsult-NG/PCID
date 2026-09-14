/*
 * The service worker (master system prompt §56).
 *
 * It caches the application *shell* and nothing else: the offline page, the
 * stylesheet, the icons, and the immutable build assets Next emits under
 * /_next/static. It never caches an authenticated response, and the rule is
 * enforced by only ever putting a response in the cache when the request was
 * for one of those paths - not by inspecting headers, which is the kind of check
 * that quietly stops matching.
 *
 * That restraint is the point. A portal page holds exactly the information this
 * platform spends its effort deciding who may see, and the browser's HTTP cache
 * is neither encrypted, nor bounded in time, nor revocable. What a device is
 * allowed to hold goes through the offline store instead, sealed under a
 * non-extractable key, with an expiry and a release the platform can withdraw.
 */

const VERSION = 'pcid-shell-v1';
const OFFLINE_PAGE = '/offline';
const SHELL = [OFFLINE_PAGE, '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      // `reload` so an install never adopts a stale copy from the HTTP cache.
      .then((cache) => cache.addAll(SHELL.map((path) => new Request(path, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => name !== VERSION).map((n) => caches.delete(n))),
      )
      .then(() => self.clients.claim()),
  );
});

/** The only paths this worker will ever store. */
function isShell(url) {
  return (
    url.origin === self.location.origin &&
    (url.pathname === OFFLINE_PAGE ||
      url.pathname.startsWith('/_next/static/') ||
      url.pathname.startsWith('/icon-'))
  );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // A page the person asked for: always from the network, because it is decided
  // per request and may not be reused. When the network is not there, the
  // offline page answers instead and reads what the device is allowed to hold.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(OFFLINE_PAGE).then((cached) => cached ?? Response.error()),
      ),
    );
    return;
  }

  if (!isShell(url)) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});

/** Sign-out and revocation both reach the worker here. */
self.addEventListener('message', (event) => {
  if (event.data === 'pcid:forget') {
    event.waitUntil(caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n)))));
  }
});
