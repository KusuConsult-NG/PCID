/**
 * The resident with no connection (master system prompt §56).
 *
 * A much smaller claim than the responder's, and worth testing for the same
 * reason: this is the one place the portal keeps anything outside itself, and
 * "only the identifier and the name" is an assertion that has to be checked
 * rather than believed.
 *
 * Runs on a phone, because a queue at a counter with no coverage is the whole
 * case for it.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

/**
 * Wait until the worker is actually in charge and the shell is on disk.
 *
 * Registering it is not enough: the install has to finish fetching the shell,
 * and the worker has to claim the page. Going offline before both have happened
 * tests the race, not the feature.
 */
async function readyForNoSignal(page: Page): Promise<void> {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
    timeout: 20_000,
  });
  await page.waitForFunction(
    async () => {
      for (const name of await caches.keys()) {
        if ((await (await caches.open(name)).match('/offline')) !== undefined) return true;
      }
      return false;
    },
    null,
    { timeout: 20_000 },
  );
}

test('the portal is installable, and the manifest says what it is for', async ({ page }) => {
  const response = await page.goto('/manifest.webmanifest');
  expect(response?.ok()).toBe(true);
  const manifest = (await response?.json()) as {
    name: string;
    display: string;
    start_url: string;
    icons: { sizes: string; purpose?: string }[];
  };
  expect(manifest.name).toContain('Plateau');
  expect(manifest.display).toBe('standalone');
  expect(manifest.start_url).toBe('/dashboard');
  expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
});

test('the worker caches the shell and no page about anybody', async ({ page }) => {
  await page.goto('/dashboard');
  await readyForNoSignal(page);

  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const entries: string[] = [];
    for (const name of names) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) entries.push(new URL(request.url).pathname);
    }
    return entries;
  });

  expect(cached).toContain('/offline');
  for (const page_ of ['/dashboard', '/identity', '/access-history', '/records']) {
    expect(cached).not.toContain(page_);
  }
});

test('a resident keeps their identifier, reads it without the portal, and takes it off', async ({
  page,
}) => {
  await page.goto('/identity');
  const shown = await page.locator('.credential-pcid').first().innerText();
  expect(shown).toMatch(/^PL-/);

  await page.getByRole('button', { name: 'Keep on this phone' }).click();
  await expect(page.getByText(/Kept on this phone/)).toBeVisible({ timeout: 15_000 });
  await readyForNoSignal(page);

  // The page the worker will serve when a navigation fails is on the phone and
  // is the right one. Playwright can take the network away from a page but not
  // from a service worker, so this is the link that can be checked here.
  const cachedPage = await page.evaluate(async () => {
    for (const name of await caches.keys()) {
      const match = await (await caches.open(name)).match('/offline');
      if (match !== undefined) return match.text();
    }
    return null;
  });
  expect(cachedPage).toContain('No connection');

  // The card reads out of the phone's own sealed storage.
  await page.goto('/offline');
  await expect(page.getByRole('heading', { name: 'No connection', level: 1 })).toBeVisible();
  await expect(page.getByText(shown)).toBeVisible();

  // And nothing else. The card is the name and the identifier; the address, the
  // contacts and the history are decided and recorded at the moment they are
  // asked for, which cannot happen here. Scoped to the card itself, because the
  // page around it explains in prose what it is *not* showing.
  const card = await page.locator('.offline-card').innerText();
  expect(card).not.toMatch(/Rwang Pam|emergency contact|date of birth|\d{4}-\d{2}-\d{2}/i);

  await page.goto('/identity');
  await page.getByRole('button', { name: 'Remove it from this phone' }).click();
  await expect(page.getByRole('button', { name: 'Keep on this phone' })).toBeVisible();
});

test('what the phone holds is ciphertext, under a key it will not hand back', async ({ page }) => {
  await page.goto('/identity');
  await page.getByRole('button', { name: 'Keep on this phone' }).click();
  await expect(page.getByText(/Kept on this phone/)).toBeVisible({ timeout: 15_000 });

  const stored = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('pcid-offline');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const bundles = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
      const request = db.transaction('bundles').objectStore('bundles').getAll();
      request.onsuccess = () => resolve(request.result as Record<string, unknown>[]);
      request.onerror = () => reject(request.error);
    });
    const key = await new Promise<CryptoKey | undefined>((resolve, reject) => {
      const request = db.transaction('device').objectStore('device').get('device-key');
      request.onsuccess = () => resolve(request.result as CryptoKey | undefined);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return {
      extractable: key?.extractable ?? null,
      text: new TextDecoder().decode(
        new Uint8Array((bundles[0]?.ciphertext as ArrayBuffer) ?? new ArrayBuffer(0)),
      ),
    };
  });

  expect(stored.extractable).toBe(false);
  expect(stored.text).not.toMatch(/PL-[0-9A-Z]{5}/);
});
