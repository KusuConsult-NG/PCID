/**
 * What the portal must not do.
 *
 * The portal is a back-end-for-front-end precisely so that no API token ever
 * reaches the browser, and so that a page is unreachable without a session
 * rather than merely unlinked. Both are asserted here against the running
 * build, because both are the kind of property that quietly stops being true.
 */
import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import {
  CHOSEN_PASSPHRASE,
  CREDENTIALS_FILE,
  PORTAL_BASE_URL,
  type DemoCredentials,
} from './environment';

const demo = (): DemoCredentials =>
  JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf8')) as DemoCredentials;

// Signed out: these tests bring their own session, or none at all.
test.use({ storageState: { cookies: [], origins: [] } });

const PROTECTED = [
  '/dashboard',
  '/identity',
  '/records',
  '/emergency-contacts',
  '/access-history',
  '/corrections',
  '/notifications',
  '/report',
  '/security',
  '/change-passphrase',
];

for (const path of PROTECTED) {
  test(`${path} is unreachable without a session`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
  });
}

test('a wrong passphrase and an identifier that does not exist read the same', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Plateau Citizen ID or email address').fill(demo().citizen.pcid);
  await page.getByLabel('Passphrase', { exact: true }).fill('not-the-right-passphrase-at-all');
  await page.getByRole('button', { name: 'Sign in' }).click();
  const wrongPassphrase = await page
    .getByRole('status')
    .filter({ hasText: 'not correct' })
    .innerText();

  await page.goto('/sign-in');
  // A well-formed identifier that was never issued.
  await page.getByLabel('Plateau Citizen ID or email address').fill('PL-22222-33333-44');
  await page.getByLabel('Passphrase', { exact: true }).fill('not-the-right-passphrase-at-all');
  await page.getByRole('button', { name: 'Sign in' }).click();
  const unknownIdentifier = await page
    .getByRole('status')
    .filter({ hasText: 'not correct' })
    .innerText();

  // The sign-in page must not become a way to find out which identifiers exist.
  expect(unknownIdentifier).toBe(wrongPassphrase);
});

test('the session cookie is sealed, http-only and same-site', async ({ page, context }) => {
  await signIn(page);

  const cookie = (await context.cookies()).find((entry) => entry.name === 'pcid_portal_session');
  expect(cookie, 'the portal sets a session cookie').toBeDefined();
  expect(cookie!.httpOnly).toBe(true);
  expect(cookie!.sameSite).toBe('Strict');
  // Sealed, not a bearer token in a wrapper.
  expect(cookie!.value).toMatch(/^v1\./);
  expect(cookie!.value).not.toContain('eyJ');
});

test('no API token reaches the browser', async ({ page }) => {
  await signIn(page);

  for (const path of ['/dashboard', '/identity', '/records', '/security']) {
    await page.goto(path);
    const html = await page.content();
    // A JWS compact serialisation always starts its header this way.
    expect(html, `${path} leaks a token`).not.toMatch(/eyJhbGciOi/);
    expect(html, `${path} leaks a bearer header`).not.toMatch(/Bearer\s+ey/);
  }
});

test('the browser is told not to frame, sniff or leak the portal', async ({ page }) => {
  const response = await page.goto('/sign-in');
  const headers = response!.headers();

  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('no-referrer');
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['content-security-policy']).toContain("form-action 'self'");
  expect(headers['content-security-policy']).toContain("object-src 'none'");
  // Nothing about a resident's record should be indexed.
  expect(await page.locator('meta[name="robots"]').getAttribute('content')).toContain('noindex');
});

test('signing out ends the session, not just the page', async ({ page }) => {
  await signIn(page);
  await page.goto('/dashboard');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in\?signed-out=1$/);
  await expect(page.getByText('You have been signed out')).toBeVisible();

  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/sign-in$/);
});

test('the portal will not accept a form posted from somewhere else', async ({ page, request }) => {
  await signIn(page);
  const cookies = await page.context().cookies();
  const jar = cookies.map((entry) => `${entry.name}=${entry.value}`).join('; ');

  // A Server Action invoked with a foreign Origin is what a cross-site form
  // post looks like. Next rejects it; nothing is changed.
  const response = await request.post(`${PORTAL_BASE_URL}/emergency-contacts`, {
    headers: {
      origin: 'https://not-the-portal.example',
      cookie: jar,
      'next-action': '00000000000000000000000000000000000000',
      'content-type': 'application/x-www-form-urlencoded',
    },
    data: 'fullName=Injected&relationship=None&phonePrimary=08030000000',
    maxRedirects: 0,
  });
  expect(response.status()).toBeGreaterThanOrEqual(400);
});

async function signIn(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Plateau Citizen ID or email address').fill(demo().citizen.pcid);
  await page.getByLabel('Passphrase', { exact: true }).fill(CHOSEN_PASSPHRASE);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}
