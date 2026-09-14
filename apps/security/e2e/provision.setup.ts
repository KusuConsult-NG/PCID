/**
 * Provision the suite, and prove the first journey while doing it.
 *
 * An officer's first contact with the portal is: an administrator creates the
 * account, hands over a passphrase they chose and typed, and the officer signs
 * in with both factors and is made to replace it before anything opens. That is
 * exercised here for each of the three officers the rest of the suite needs,
 * because it is also how they get sessions.
 *
 * The demo seed is the same command a developer runs, so this suite cannot pass
 * against a seeding path no human ever uses.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { expect, test as setup } from '@playwright/test';

import {
  API_BASE_URL,
  API_DIRECTORY,
  ARTEFACT_DIRECTORY,
  CHOSEN_PASSPHRASE,
  CREDENTIALS_FILE,
  DATABASE_URL,
  SECRET_ENCRYPTION_KEY,
  STATE_FILES,
  TOKEN_SIGNING_KEY,
  type DemoCredentials,
  type OfficerRole,
} from './environment';
import { totpCode, waitForNextTimeStep } from './officer';

setup('the demo environment is seeded', async () => {
  setup.setTimeout(180_000);

  mkdirSync(ARTEFACT_DIRECTORY, { recursive: true });
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
      TOKEN_SIGNING_KEY,
      SECRET_ENCRYPTION_KEY,
      ALLOW_SANDBOX_ADAPTERS: 'true',
    },
  });

  const demo = JSON.parse(output) as DemoCredentials;
  expect(demo.officers.length).toBeGreaterThan(0);
  writeFileSync(CREDENTIALS_FILE, JSON.stringify(demo, null, 2));
});

const ROLES: readonly OfficerRole[] = ['INVESTIGATOR', 'SUPERVISOR', 'MISSING_PERSON_OFFICER'];

for (const role of ROLES) {
  setup(
    `a ${role.toLowerCase().replace(/_/g, ' ')} signs in and chooses a passphrase`,
    async ({ page }) => {
      setup.setTimeout(90_000);
      const demo = JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf8')) as DemoCredentials;
      const officer = demo.officers.find((entry) => entry.roles.includes(role));
      expect(officer, `the demo seed provisions a ${role}`).toBeDefined();

      await page.goto('/sign-in');
      await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
      await page.getByLabel('Work email address').fill(officer!.email);
      await page.getByLabel('Passphrase', { exact: true }).fill(officer!.password);
      await page.getByRole('button', { name: 'Sign in' }).click();

      // A passphrase alone does not open a law-enforcement account.
      await expect(page).toHaveURL(/\/sign-in\/verify$/);
      await presentSecondFactor(page, officer!.totpSecret);

      // The administrator chose the passphrase, so two people know it.
      await expect(page).toHaveURL(/\/change-passphrase$/);
      await expect(
        page.getByRole('heading', { name: 'Choose your own passphrase', level: 1 }),
      ).toBeVisible();

      await page.getByLabel('Current passphrase').fill(officer!.password);
      await page.getByLabel('New passphrase', { exact: true }).fill(CHOSEN_PASSPHRASE);
      await page.getByLabel('Type the new passphrase again').fill(CHOSEN_PASSPHRASE);
      await page.getByRole('button', { name: 'Save passphrase' }).click();

      await expect(page).toHaveURL(/\/home/);
      await expect(page.getByText('Your passphrase has been changed')).toBeVisible();

      await page.context().storageState({ path: STATE_FILES[role] });
    },
  );
}

/**
 * Present a code, and try again on the next step if it was refused.
 *
 * The seed command signs in as some of these officers to build the demo data,
 * so a code for the current step may already have been spent. An officer who
 * mistypes does exactly this: waits for the next code and tries again.
 */
async function presentSecondFactor(
  page: import('@playwright/test').Page,
  secret: string,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.getByLabel('Six-digit code').fill(totpCode(secret));
    await page.getByRole('button', { name: 'Continue' }).click();
    try {
      await page.waitForURL((url) => !url.pathname.startsWith('/sign-in/verify'), {
        timeout: 8_000,
      });
      return;
    } catch {
      // Still on the second-factor page: the code was refused. Wait for the
      // next one rather than replaying a step the platform has already seen.
      await waitForNextTimeStep();
    }
  }
  throw new Error('the authenticator code was refused three times');
}
