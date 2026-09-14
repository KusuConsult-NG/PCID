/**
 * The counter: checking an ID, and opening a record under a stated purpose.
 *
 * The distinction between the two is the point of the platform, so it is the
 * thing this spec is mostly about. Verifying answers "is this live and is this
 * their name". Opening the record is a separate act, needs a reason, releases
 * only what that reason justifies, and is shown to the person afterwards.
 */
import { readFileSync } from 'node:fs';

import { pcidCheckCharacters } from '@pcid/contracts';
import { expect, test } from '@playwright/test';

import { API_BASE_URL, CREDENTIALS_FILE, type DemoCredentials } from './environment';

const demo = (): DemoCredentials =>
  JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf8')) as DemoCredentials;

/**
 * A well-formed Plateau Citizen ID that was never issued.
 *
 * Built from the real one with a body character changed and the check
 * characters recomputed, so it passes format validation and fails only because
 * nobody holds it - which is the case worth testing.
 */
function unissuedPcid(): string {
  const real = demo().citizen.pcid;
  const body = real.slice(3, 8) + real.slice(9, 14);
  const swapped = (body[0] === 'Z' ? 'Y' : 'Z') + body.slice(1);
  return `PL-${swapped.slice(0, 5)}-${swapped.slice(5)}-${pcidCheckCharacters(swapped)}`;
}

test.describe.configure({ mode: 'serial' });

test('a presented ID is confirmed, and nothing else is released', async ({ page }) => {
  await page.goto('/verify');

  await page.getByLabel('Plateau Citizen ID').fill(demo().citizen.pcid);
  await page.getByRole('button', { name: 'Check this ID' }).click();

  await expect(page.getByText('This ID is live')).toBeVisible();
  await expect(page.getByText('Amina Ladi Dung')).toBeVisible();

  // The answer carries a name and a status. Not an address, not a date of birth.
  const answer = page.getByRole('status').first();
  await expect(answer).not.toContainText('Rwang Pam');
  await expect(answer).not.toContainText('1994');
});

test('an identifier that was never issued is refused without saying why', async ({ page }) => {
  await page.goto('/verify');
  await page.getByLabel('Plateau Citizen ID').fill(unissuedPcid());
  await page.getByRole('button', { name: 'Check this ID' }).click();

  // Well-formed, checksum and all, and simply not on the register. The answer is
  // "not valid" and a blank name: the counter learns nothing it could use to
  // work out which identifiers exist.
  await expect(page.getByText('This ID is not valid')).toBeVisible();
  const answer = page.getByRole('status').first();
  await expect(answer).not.toContainText('Amina');
});

test('a malformed identifier is refused as malformed, not as unknown', async ({ page }) => {
  await page.goto('/verify');
  await page.getByLabel('Plateau Citizen ID').fill('PL-22222-33333-44');
  await page.getByRole('button', { name: 'Check this ID' }).click();

  // Telling somebody they typed it wrong is not an oracle: it says nothing about
  // whether any identifier exists.
  await expect(page.getByText('That does not look like a Plateau Citizen ID')).toBeVisible();
});

test('opening a record asks why, and the reason stays on screen', async ({ page }) => {
  await page.goto(`/person/${demo().citizen.pcid}`);

  // No purpose in the address: the portal asks before it opens anything.
  await expect(
    page.getByRole('heading', { name: 'Why are you opening this record?', level: 1 }),
  ).toBeVisible();

  await page.getByLabel('Reason for opening this record').selectOption('SERVICE_DELIVERY');
  await page.getByRole('button', { name: 'Open the record' }).click();

  await expect(page.getByRole('heading', { name: 'Amina Ladi Dung', level: 1 })).toBeVisible();
  // Shown for as long as the record is: it decided what is on screen, and it was
  // written down.
  await expect(page.getByText('Opened for:')).toBeVisible();
  await expect(page.getByText('Delivering a service')).toBeVisible();
  await expect(page.getByText('This access is recorded.')).toBeVisible();
});

test('a card the engine withheld is shown as withheld, not omitted', async ({ page }) => {
  await page.goto(`/person/${demo().citizen.pcid}?purpose=SERVICE_DELIVERY`);

  // A counter officer delivering a service does not get the revenue card. The
  // page says so rather than leaving a gap that reads as "nothing recorded".
  const restricted = page.getByText('Restricted information.');
  await expect(restricted.first()).toBeVisible();
  await expect(page.getByText('Restricted', { exact: true }).first()).toBeVisible();
});

test('the resident sees the access afterwards, named and reasoned', async ({ page, request }) => {
  // Sign in as the resident to their own portal API and read the history the
  // platform kept of what this officer just did.
  const login = await request.post(`${API_BASE_URL}/api/v1/auth/citizen/login`, {
    data: { identifier: demo().citizen.pcid, password: demo().citizen.temporaryPassword },
  });
  expect(login.ok()).toBe(true);
  const token = ((await login.json()) as { accessToken: string }).accessToken;

  const history = await request.get(`${API_BASE_URL}/api/v1/me/access-history?limit=50`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const accesses = (
    (await history.json()) as {
      accesses: { action: string; agency: string | null; purpose: string | null }[];
    }
  ).accesses;

  const opened = accesses.find((entry) => entry.action === 'CITIZEN_VIEW');
  expect(opened, 'the resident can see that their record was opened').toBeDefined();
  expect(opened!.purpose).toBe('SERVICE_DELIVERY');
  // The office by name, not its internal code.
  expect(opened!.agency).toBe('Plateau State Internal Revenue Service');

  void page;
});
