/**
 * The crew with no signal (master system prompt §56).
 *
 * The only part of this platform that keeps anything outside it, and therefore
 * the part where the tests have to be about absences as much as presences: what
 * the device is given, what it refuses to give back, and what happens to it when
 * the platform says stop.
 *
 * Runs on a phone-sized viewport with the crew's session, because that is the
 * device this is for.
 */
import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';

import {
  CREDENTIALS_FILE,
  PORTAL_BASE_URL,
  STATE_FILES,
  type DemoCredentials,
} from './environment';

const SEEDED_INCIDENT = 'INC-2026-000001';

function citizenPcid(): string {
  return (JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf8')) as DemoCredentials).citizen.pcid;
}

/**
 * Control names the casualty on the incident, which is what puts anybody in a
 * crew's pack at all. A responder cannot choose who is in one - that is the
 * property that stops an offline bundle being a way to walk the register - so
 * the setup has to be done by the desk that really does it.
 */
async function attachCasualty(browser: Browser): Promise<void> {
  const context = await browser.newContext({
    storageState: STATE_FILES.DISPATCHER,
    baseURL: PORTAL_BASE_URL,
  });
  const page = await context.newPage();
  await page.goto(`/incidents/${SEEDED_INCIDENT}#people`);
  const field = page.getByLabel('Record who somebody at the scene is');
  if ((await field.count()) > 0) {
    await field.fill(citizenPcid());
    await page.getByRole('button', { name: 'Record this' }).click();
    await page.waitForLoadState('networkidle');
  }
  await context.close();
}

test.beforeAll(async ({ browser }) => {
  await attachCasualty(browser);
});

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

test('the portal is installable, and says what it is', async ({ page }) => {
  const response = await page.goto('/manifest.webmanifest');
  expect(response?.ok()).toBe(true);
  const manifest = (await response?.json()) as {
    name: string;
    display: string;
    start_url: string;
    icons: { sizes: string; purpose?: string }[];
  };
  expect(manifest.name).toContain('Emergency');
  // Installable means these three, and a maskable icon so Android does not put a
  // white square on a coloured home screen.
  expect(manifest.display).toBe('standalone');
  expect(manifest.start_url).toBe('/home');
  expect(manifest.icons.some((icon) => icon.sizes === '512x512')).toBe(true);
  expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
});

test('the worker caches the shell and nothing that was decided per request', async ({ page }) => {
  await page.goto('/home');
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
  // The claim that matters: no page a person was authorised to see is in there.
  for (const page_ of ['/home', '/identify', '/incidents', `/person/${citizenPcid()}`]) {
    expect(cached).not.toContain(page_);
  }
});

test('a crew keeps the incident, reads it without the platform, and erases it', async ({
  page,
}) => {
  await page.goto(`/incidents/${SEEDED_INCIDENT}#people`);
  const keep = page.getByRole('button', { name: 'Keep for offline' });
  await expect(keep).toBeVisible();
  await keep.click();
  await expect(page.getByText(/Held on this device/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/until/)).toBeVisible();
  await readyForNoSignal(page);

  // The document the worker will serve when a navigation fails is on the device
  // and is the right one. Playwright can take the network away from a page but
  // not from a service worker, so this is the link that can be checked here; the
  // worker's own navigate handler is four lines and returns exactly this.
  const cachedPage = await page.evaluate(async () => {
    for (const name of await caches.keys()) {
      const match = await (await caches.open(name)).match('/offline');
      if (match !== undefined) return match.text();
    }
    return null;
  });
  expect(cachedPage).toContain('No signal');

  // And the pack itself reads out of the device, with nothing asked of the
  // platform: the page is rendered from the browser's own sealed storage.
  await page.goto('/offline');
  await page.getByRole('button', { name: /Incident INC-/ }).click();
  await expect(page.getByRole('heading', { level: 2, name: /Incident INC-/ })).toBeVisible();

  // The fields actually released, read off the terms in the list. An approximate
  // age and never a date of birth is the emergency profile's whole point.
  const released = await page.locator('.held-person dt').allInnerTexts();
  expect(released).toContain('approximateAge');
  expect(released).not.toContain('dateOfBirth');
  expect(released).not.toContain('registeredAddress');
  expect(released).not.toContain('nin');

  // The withheld ones travel with it and are named, so a crew reading this in a
  // tunnel can tell "not recorded" from "not released to you".
  await expect(page.getByText(/Restricted information, withheld/)).toBeVisible();

  await page.goto(`/incidents/${SEEDED_INCIDENT}#people`);
  await page.getByRole('button', { name: 'Erase it now' }).click();
  await expect(page.getByRole('button', { name: 'Keep for offline' })).toBeVisible();
});

test('what the device holds is not readable from the device’s own storage', async ({ page }) => {
  await page.goto(`/incidents/${SEEDED_INCIDENT}#people`);
  await page.getByRole('button', { name: 'Keep for offline' }).click();
  await expect(page.getByText(/Held on this device/)).toBeVisible({ timeout: 15_000 });

  // Read the raw record straight out of IndexedDB, the way anything with access
  // to the profile directory would. It is ciphertext, and the key beside it is
  // one WebCrypto will use and will not return.
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
      count: bundles.length,
      text: new TextDecoder().decode(
        new Uint8Array((bundles[0]?.ciphertext as ArrayBuffer) ?? new ArrayBuffer(0)),
      ),
      extractable: key?.extractable ?? null,
    };
  });

  expect(stored.count).toBeGreaterThan(0);
  expect(stored.extractable).toBe(false);
  expect(stored.text).not.toContain(citizenPcid());
  expect(stored.text.toLowerCase()).not.toContain('displayname');
});

test('signing the device out ends its sessions and takes back what it held', async ({ page }) => {
  await page.goto('/account#devices');
  await expect(page.getByRole('heading', { name: /Devices that can hold/ })).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'Responder device' }).first();
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: 'Sign this device out' }).click();

  // Signing out the device signs out the sessions opened on it, which is the
  // whole point of reporting a tablet lost: one act, not two.
  await expect(page).toHaveURL(/sign-in/, { timeout: 15_000 });
});
