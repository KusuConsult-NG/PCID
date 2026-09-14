/**
 * Provision the suite, and prove the first journey while doing it.
 *
 * A resident's first contact with the portal is: details handed over at a
 * registration desk, sign in with them, and immediately be made to choose a
 * passphrase nobody else has ever seen. That is exercised here rather than in a
 * separate spec, because it is also how the rest of the suite gets a signed-in
 * session to work with.
 *
 * The demo seed is the same command a developer runs, so this suite cannot pass
 * against a seeding path that no human ever uses.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

import { expect, test as setup } from '@playwright/test';

import {
  API_BASE_URL,
  API_DIRECTORY,
  ARTEFACT_DIRECTORY,
  CHOSEN_PASSPHRASE,
  CREDENTIALS_FILE,
  DATABASE_URL,
  RESIDENT_STATE_FILE,
  SECRET_ENCRYPTION_KEY,
  TOKEN_SIGNING_KEY,
  type DemoCredentials,
} from './environment';

setup('a resident signs in and chooses their own passphrase', async ({ page }) => {
  setup.setTimeout(120_000);

  mkdirSync(ARTEFACT_DIRECTORY, { recursive: true });
  // The built output, so the suite provisions itself with the same artefact the
  // API it is talking to was started from.
  const output = execFileSync(process.execPath, ['dist/database/demo-cli.js', '--json'], {
    cwd: API_DIRECTORY,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'development',
      DATABASE_URL,
      DATABASE_SSL: 'disable',
      PCID_API_URL: API_BASE_URL,
      LOG_LEVEL: 'error',
      // The same keys the API was started with: the seed writes the first
      // administrator's authenticator secret under the envelope, and the
      // service has to be able to open it.
      TOKEN_SIGNING_KEY,
      SECRET_ENCRYPTION_KEY,
      ALLOW_SANDBOX_ADAPTERS: 'true',
    },
  });

  const demo = JSON.parse(output) as DemoCredentials;
  expect(demo.citizen.pcid).toMatch(
    /^PL-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{2}$/,
  );
  writeFileSync(CREDENTIALS_FILE, JSON.stringify(demo, null, 2));

  await page.goto('/sign-in');
  await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();

  await page.getByLabel('Plateau Citizen ID or email address').fill(demo.citizen.pcid);
  await page.getByLabel('Passphrase', { exact: true }).fill(demo.citizen.temporaryPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // The desk-issued passphrase was written down by someone else, so the portal
  // refuses to go anywhere until the resident replaces it.
  await expect(page).toHaveURL(/\/change-passphrase$/);
  await expect(
    page.getByRole('heading', { name: 'Choose your own passphrase', level: 1 }),
  ).toBeVisible();

  await page.getByLabel('Current passphrase').fill(demo.citizen.temporaryPassword);
  await page.getByLabel('New passphrase', { exact: true }).fill(CHOSEN_PASSPHRASE);
  await page.getByLabel('Type the new passphrase again').fill(CHOSEN_PASSPHRASE);
  await page.getByRole('button', { name: 'Save passphrase' }).click();

  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText('Your passphrase has been changed')).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Hello, Amina/, level: 1 })).toBeVisible();

  await page.context().storageState({ path: RESIDENT_STATE_FILE });
});
