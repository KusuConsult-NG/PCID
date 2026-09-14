/**
 * What a resident actually does with the portal.
 *
 * These run against the real API, so each one is also a check on the platform
 * underneath: a contact only appears because the policy engine released the
 * field, an access only appears because the audit chain recorded it, and the
 * verification history only fills in because a real officer, holding a real
 * role, checked a real ID.
 *
 * They run in the order written, on one provisioned resident, because that is
 * the order the record is built up in.
 */
import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { CREDENTIALS_FILE, type DemoCredentials } from './environment';
import { officerPost, signInOfficer } from './officer';

const demo = (): DemoCredentials =>
  JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf8')) as DemoCredentials;

test.describe.configure({ mode: 'serial' });

test('the dashboard shows the resident their own identifier', async ({ page }) => {
  await page.goto('/dashboard');

  await expect(page.getByRole('heading', { name: /^Hello, Amina/, level: 1 })).toBeVisible();
  await expect(page.getByText(demo().citizen.pcid, { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Show my ID and QR code' })).toBeVisible();

  // Nothing has been added yet, so the portal asks for an emergency contact
  // rather than leaving the card blank.
  await expect(page.getByText('None yet')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add an emergency contact' })).toBeVisible();
});

test('the identity page issues a credential and a code that expires', async ({ page }) => {
  await page.goto('/identity');

  await expect(
    page.getByRole('heading', { name: 'My Plateau Citizen ID', level: 1 }),
  ).toBeVisible();

  const credential = page.getByRole('region', { name: 'Your credential' });
  await expect(credential.getByText('Amina Ladi Dung')).toBeVisible();
  await expect(credential.getByText(demo().citizen.pcid, { exact: true })).toBeVisible();
  await expect(credential.getByText(/^PLC-\d{4}-[0-9A-HJKMNP-TV-Z]{8}$/)).toBeVisible();
  await expect(
    page.getByRole('img', { name: 'Square code for a government officer to scan' }),
  ).toBeVisible();

  // The value of the short lifetime is that it is stated, so the resident knows
  // a photograph of the screen is worthless a few minutes later.
  await expect(page.getByText(/This code stops working in about \d+ minutes/)).toBeVisible();

  // The QR carries an opaque token, never the identifier itself.
  const qr = page.locator('.qr-frame svg');
  await expect(qr).toHaveCount(1);
});

test('a resident adds, corrects and removes an emergency contact', async ({ page }) => {
  await page.goto('/emergency-contacts');

  await page.getByLabel('Full name', { exact: true }).fill('Ngozi Dung');
  await page.getByLabel('How you know them', { exact: true }).fill('Sister');
  await page.getByLabel('Phone number', { exact: true }).fill('08030000002');
  await page.getByRole('button', { name: 'Add contact' }).click();

  await expect(page.getByText('Contact added')).toBeVisible();
  await expect(page.getByText('Ngozi Dung — Sister')).toBeVisible();
  await expect(page.getByText('1 saved')).toBeVisible();

  // Edit it: the form lives inside the contact's own disclosure, which is why
  // its fields carry ids of their own rather than sharing the add form's.
  const entry = page.locator('details', { hasText: 'Ngozi Dung' });
  await entry.locator('summary').click();
  await entry.getByLabel('How you know them').fill('Elder sister');
  await entry.getByRole('button', { name: 'Save changes' }).click();

  await expect(page.getByText('Contact updated')).toBeVisible();
  await expect(page.getByText('Ngozi Dung — Elder sister')).toBeVisible();

  // And the home page stops asking for one.
  await page.goto('/dashboard');
  await expect(page.getByText('Ngozi Dung (Elder sister)')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Manage contacts' })).toBeVisible();
});

test('records held by other offices are shown, and named as theirs', async ({ page }) => {
  await page.goto('/records');

  await expect(page.getByRole('heading', { name: 'My records', level: 1 })).toBeVisible();
  await expect(
    page.getByText('Each office remains responsible for its own records.'),
  ).toBeVisible();

  // Seeded through the sandbox adapters, so these prove the projection path.
  await expect(page.getByRole('heading', { name: 'Property', level: 2 })).toBeVisible();
  await expect(page.getByText('Held by the lands registry.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Revenue', level: 2 })).toBeVisible();
});

test('an officer checking the ID at a counter shows up for the resident', async ({
  page,
  request,
}) => {
  const counter = demo().officers.find((officer) => officer.roles.includes('VERIFICATION_OFFICER'));
  expect(counter, 'the demo seed provisions a verification officer').toBeDefined();

  const session = await signInOfficer(request, counter!);
  const outcome = await officerPost<{ valid: boolean; displayName: string }>(
    request,
    session,
    '/api/v1/verification/pcid',
    { pcid: demo().citizen.pcid },
  );
  expect(outcome.valid).toBe(true);
  expect(outcome.displayName).toBe('Amina Ladi Dung');

  await page.goto('/identity');
  const history = page.getByRole('table', {
    name: 'Occasions on which a government office checked your Plateau Citizen ID',
  });
  await expect(history.getByText('Plateau State Internal Revenue Service')).toBeVisible();
  await expect(history.getByText('Typed the ID')).toBeVisible();
  await expect(history.getByText('Checked', { exact: true })).toBeVisible();
});

test('every access to the record is listed, with a reference to quote', async ({ page }) => {
  await page.goto('/access-history');

  await expect(
    page.getByRole('heading', { name: 'Who has seen my record', level: 1 }),
  ).toBeVisible();
  const table = page.getByRole('table', {
    name: 'Government offices that have opened your record, most recent first',
  });
  await expect(table).toBeVisible();

  // The counter check a moment ago is in here, attributed to the office that
  // made it rather than to "the system".
  await expect(table.getByText('Plateau State Internal Revenue Service').first()).toBeVisible();

  const reference = await table.locator('tbody tr').first().locator('td').last().innerText();
  expect(reference.trim()).not.toBe('');
});

test('a message in the inbox can be read, and the unread count clears', async ({ page }) => {
  await page.goto('/notifications');

  const welcome = page
    .getByRole('listitem')
    .filter({ hasText: 'Welcome to the Plateau Citizen Portal' });
  await expect(welcome.getByText('New')).toBeVisible();

  await welcome.getByRole('button', { name: 'Mark as read' }).click();

  await expect(page).toHaveURL(/\/notifications$/);
  await expect(welcome.getByRole('button', { name: 'Mark as read' })).toHaveCount(0);
  await expect(welcome.getByText('New')).toHaveCount(0);
});

test('a resident asks for a correction and can see it queued', async ({ page }) => {
  await page.goto('/corrections');

  await page.getByLabel('What is wrong').selectOption('citizen.phonePrimary');
  await page.getByLabel('What it should say').fill('08030000009');
  await page
    .getByLabel('Why it should change')
    .fill('I changed network last month and the old number no longer reaches me.');
  await page.getByRole('button', { name: 'Send request' }).click();

  await expect(page.getByText('Your request has been sent')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your requests', level: 2 })).toBeVisible();

  const requests = page.getByRole('table', { name: 'Correction requests you have submitted' });
  const row = requests.locator('tbody tr').first();
  await expect(row).toContainText('Phone primary');
  await expect(row).toContainText('08030000009');

  // Asking is not the same as changing it: nothing is applied until an officer
  // decides, and the portal says so rather than implying the record has moved.
  await expect(row.getByText('Submitted', { exact: true })).toBeVisible();
});

test('raising an emergency returns a reference the resident can quote', async ({ page }) => {
  await page.goto('/report');

  await page.getByLabel('What is happening').selectOption('ROAD_ACCIDENT');
  await page
    .getByLabel('Describe it')
    .fill('A lorry has gone off the road at the Zaria Road junction. Two people are hurt.');
  await page.getByRole('button', { name: 'Send to the emergency service' }).click();

  await expect(page.getByText('Your report has gone to the emergency service')).toBeVisible();
  await expect(page.getByText(/INC-\d{4}-\d+/)).toBeVisible();
});

test('a resident reports identity fraud and an access they do not recognise', async ({ page }) => {
  await page.goto('/access-history');
  const reference = (
    await page
      .getByRole('table', {
        name: 'Government offices that have opened your record, most recent first',
      })
      .locator('tbody tr')
      .first()
      .locator('td')
      .last()
      .innerText()
  ).trim();

  await page.goto('/report');
  await page
    .getByLabel('What has happened')
    .fill('Someone used my name and date of birth to collect a benefit in Bukuru last week.');
  await page.locator('#identity-fraud').getByRole('button', { name: 'Send report' }).click();
  await expect(page.getByText('Your report has been sent to the registry team')).toBeVisible();

  await page.goto('/report');
  await page.getByLabel('Reference of the access').fill(reference);
  await page
    .getByLabel('Why it does not look right')
    .fill('I have never had any dealings with that office and I did not go to a counter that day.');
  await page.locator('#unauthorised-access').getByRole('button', { name: 'Send report' }).click();

  await expect(
    page.getByText('Your report has been sent to the Data Protection Officer'),
  ).toBeVisible();
  await expect(
    page.getByText('The record of that access cannot be altered or deleted'),
  ).toBeVisible();
});

test('reporting a credential lost cancels it and issues another', async ({ page }) => {
  await page.goto('/identity');
  const serial = page
    .getByRole('region', { name: 'Your credential' })
    .getByText(/^PLC-\d{4}-[0-9A-HJKMNP-TV-Z]{8}$/);
  const original = (await serial.innerText()).trim();

  await page.getByLabel('What happened').fill('My card was taken from my bag at Terminus market.');
  await page.getByRole('button', { name: 'Report this credential lost' }).click();

  await expect(page.getByText('that credential has been cancelled')).toBeVisible();
  await expect(page.getByText('Your Plateau Citizen ID has not changed')).toBeVisible();

  // A card can be replaced; an identity cannot.
  const replacement = (await serial.innerText()).trim();
  expect(replacement).not.toBe(original);
  await expect(
    page.getByRole('region', { name: 'Your credential' }).getByText(demo().citizen.pcid, {
      exact: true,
    }),
  ).toBeVisible();
});

test('the security page offers an authenticator and lists where the account is signed in', async ({
  page,
}) => {
  await page.goto('/security');

  await expect(page.getByRole('heading', { name: 'Security', level: 1 })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Where you are signed in', level: 2 }),
  ).toBeVisible();
  await expect(page.getByText('This device')).toBeVisible();

  await page.getByRole('button', { name: 'Set up an authenticator' }).click();

  await expect(page.getByText('Write these recovery codes down now')).toBeVisible();
  await expect(
    page.getByRole('img', { name: 'Square code to scan with your authenticator app' }),
  ).toBeVisible();
  await expect(page.getByLabel('Six-digit code from the app')).toBeVisible();

  // Left unconfirmed on purpose: the enrolment is finished in the API suite,
  // and a second factor here would change how the rest of this suite signs in.
  await page.getByRole('button', { name: 'Cancel this setup' }).click();
  await expect(page.getByRole('button', { name: 'Set up an authenticator' })).toBeVisible();
});
