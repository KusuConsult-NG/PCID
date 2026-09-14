/**
 * The same agency, a different officer, a different portal.
 *
 * A supervisor in the Police Command holds neither CITIZEN_SEARCH nor
 * CASE_CREATE, and is not on the investigator's case. What they hold instead is
 * the power to approve, to review break glass, to decide a match and to close a
 * case — none of which the investigator has. The portal must show each of them
 * their own platform and not a menu of things that would be refused.
 *
 * It also proves the one place where the portal had to go beyond the case file:
 * a supervisor cannot read a case they are not assigned to, and the form that
 * would assign them lives inside that very file. The platform allows the
 * assignment on agency authority; the interface has to make it reachable.
 */
import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { CASE_FILE, type SharedCase } from './environment';

function openedCase(): SharedCase {
  return JSON.parse(readFileSync(CASE_FILE, 'utf8')) as SharedCase;
}

test('a supervisor is offered a different portal', async ({ page }) => {
  await page.goto('/home');
  const nav = page.getByRole('navigation', { name: 'Portal sections' });

  await expect(nav.getByRole('link', { name: 'Cases', exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Access and break glass' })).toBeVisible();

  // No CITIZEN_SEARCH and no MISSING_PERSON_VIEW: the sections are absent
  // because the entitlements are, not because somebody hid them.
  await expect(nav.getByRole('link', { name: 'Find a person' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Missing persons' })).toHaveCount(0);
});

test('a colleague’s case is closed to a supervisor who is not on it', async ({ page }) => {
  const { reference } = openedCase();
  await page.goto(`/cases/${reference}`);

  await expect(
    page.getByRole('heading', { name: 'That case is not open to you', level: 1 }),
  ).toBeVisible();
  await expect(page.getByText('No such case, or not one you are on')).toBeVisible();
});

test('a supervisor can take a case on, which is the exception the platform allows', async ({
  page,
}) => {
  const { reference, title } = openedCase();
  await page.goto('/cases#take-on');

  const takeOn = page.getByRole('region', { name: 'Take a case on' });
  await expect(takeOn).toBeVisible();

  await takeOn.getByLabel('Case number').fill(reference);
  await takeOn.getByLabel('On the case as').selectOption('SUPERVISOR');
  await takeOn.getByRole('button', { name: 'Assign to this case' }).click();

  await expect(page).toHaveURL(new RegExp(`/cases/${reference}`));
  await expect(page.getByText('Officer assigned')).toBeVisible();
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();

  const officers = page.getByRole('region', { name: 'Officers on this case' });
  await expect(officers.getByText('Command Supervisor')).toBeVisible();

  // Assigned, and still not able to do an investigator's work on it: a
  // supervisor holds neither CASE_UPDATE nor CASE_LINK_SUBJECT. Being on a case
  // is not the same as being able to do everything on it.
  await expect(page.getByRole('heading', { name: 'Correct or advance this case' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Link to this case' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add to the file' })).toHaveCount(0);
});

test('the case now appears in the supervisor’s own list', async ({ page }) => {
  const { reference } = openedCase();
  await page.goto('/cases');

  const listing = page.getByRole('table', { name: 'Cases you are assigned to' });
  await expect(listing.getByRole('link', { name: reference })).toBeVisible();
});

test('closing a case is a supervisor’s act and demands a note', async ({ page }) => {
  const { reference } = openedCase();
  await page.goto(`/cases/${reference}`);

  await expect(page.getByRole('heading', { name: 'Close this case' })).toBeVisible();

  // Submitting without a note is refused by the portal before the platform is
  // troubled with it, and the message says what is missing.
  await page.getByRole('button', { name: 'Close this case' }).click();
  await expect(page.getByText('A closure note is required')).toBeVisible();

  await page
    .getByLabel('How this case ended')
    .fill('Vehicle recovered and returned to the keeper. No suspect identified.');
  await page.getByRole('button', { name: 'Close this case' }).click();

  // Back to the list, not to the file: a closed case authorises no access, and
  // that includes reading the file. Landing on the file would have shown the
  // supervisor a refusal for the thing they had just successfully done.
  await expect(page).toHaveURL(/\/cases\?closed=/);
  await expect(page.getByRole('heading', { name: `${reference} is closed` })).toBeVisible();
  await expect(page.getByText('neither is the file itself')).toBeVisible();
});

test('a closed case authorises nothing further, including its own file', async ({ page }) => {
  const { reference } = openedCase();
  await page.goto(`/cases/${reference}`);

  await expect(
    page.getByRole('heading', { name: 'That case authorises nothing now', level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByText(`Case ${reference} is closed and authorises no access.`),
  ).toBeVisible();
  await expect(page.getByText('What happened on it is on the audit record')).toBeVisible();

  // Not the opaque refusal: the platform named what was missing because saying
  // so to an officer who already held the case leaks nothing.
  await expect(page.getByText('No such case, or not one you are on')).toHaveCount(0);
});

test('the authorisation page shows a supervisor the queues they are answerable for', async ({
  page,
}) => {
  await page.goto('/authorisation');

  await expect(page.getByRole('heading', { name: 'Awaiting your approval' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Break-glass reviews due' })).toBeVisible();
  await expect(page.getByText('An officer cannot review their own')).toBeVisible();

  // A supervisor holds ACCESS_REQUEST_APPROVE but not ACCESS_REQUEST_CREATE, so
  // there is nothing here for them to ask with.
  await expect(
    page.getByRole('heading', { name: 'Ask for a field that was withheld' }),
  ).toHaveCount(0);
});

test('the account page states the clearance and compartment the portal turns on', async ({
  page,
}) => {
  await page.goto('/account');

  await expect(page.getByRole('heading', { name: 'Entitlements', level: 2 })).toBeVisible();
  await expect(page.getByText('Plateau State Police Command (PLT-POLICE)')).toBeVisible();
  await expect(page.getByText('Law enforcement restricted').first()).toBeVisible();
  await expect(page.getByText('A case decides')).toBeVisible();

  // The entitlement list is the one the engine reads, said in plain words.
  await expect(page.getByText('Decided an access request')).toBeVisible();
  await expect(page.getByText('Reviewed break-glass access')).toBeVisible();
});
