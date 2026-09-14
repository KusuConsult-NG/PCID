/**
 * An investigator's day, and the sequence the portal is built around.
 *
 * The claim this suite has to prove is the one §22 makes: that a record is
 * reachable only through an active case the officer is assigned to, with the
 * person linked to it and a reason written down. Every step below is an attempt
 * to reach a record without one of those three, followed by the step that
 * supplies it.
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { CASE_FILE, CREDENTIALS_FILE, type DemoCredentials, type SharedCase } from './environment';

const CASE_TITLE = 'Vehicle theft, Rayfield roundabout';

function citizenPcid(): string {
  return (JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf8')) as DemoCredentials).citizen.pcid;
}

function openedCase(): SharedCase {
  return JSON.parse(readFileSync(CASE_FILE, 'utf8')) as SharedCase;
}

test('the navigation offers only what this account can do', async ({ page }) => {
  await page.goto('/home');
  const nav = page.getByRole('navigation', { name: 'Portal sections' });

  for (const section of ['Cases', 'Find a person', 'Missing persons', 'My account']) {
    await expect(nav.getByRole('link', { name: section, exact: true })).toBeVisible();
  }

  // An investigator holds ACCESS_REQUEST_CREATE, so the authorisation section is
  // there; what is inside it differs from a supervisor's, which is asserted in
  // supervision.spec.ts against the same page.
  await expect(nav.getByRole('link', { name: 'Access and break glass' })).toBeVisible();
});

test('a record cannot be opened without a case', async ({ page }) => {
  await page.goto(`/person/${citizenPcid()}`);

  await expect(
    page.getByRole('heading', { name: 'A record is opened under a case', level: 1 }),
  ).toBeVisible();
  await expect(page.getByText('the policy engine refuses an investigative read')).toBeVisible();
});

test('opening a case assigns you to it', async ({ page }) => {
  await page.goto('/cases');
  await expect(page.getByRole('heading', { name: 'Open a case', level: 2 })).toBeVisible();

  await page.getByLabel('What kind of case').selectOption('CRIMINAL_INVESTIGATION');
  await page.getByLabel('Title').fill(CASE_TITLE);
  await page.getByLabel('Summary').fill('Reported stolen overnight from the hotel car park.');
  await page.getByLabel('Local Government Area code').fill('PL-JNO');
  await page.getByRole('button', { name: 'Open this case' }).click();

  await expect(page).toHaveURL(/\/cases\/CASE-/);
  await expect(page.getByText('Case opened')).toBeVisible();
  await expect(page.getByRole('heading', { name: CASE_TITLE, level: 1 })).toBeVisible();

  const officers = page.getByRole('region', { name: 'Officers on this case' });
  await expect(officers.getByText('Case Officer')).toBeVisible();

  // Nobody is linked yet, which is the whole point of the next test.
  await expect(page.getByText('Nobody is linked to this case.')).toBeVisible();

  const reference = new URL(page.url()).pathname.split('/').pop() as string;
  writeFileSync(CASE_FILE, JSON.stringify({ reference, title: CASE_TITLE }));
});

test('working under a case is a convenience and says so', async ({ page }) => {
  const { reference } = openedCase();
  await page.goto(`/cases/${reference}`);
  await page.getByRole('button', { name: 'Work under this case' }).click();

  const banner = page.getByText('A reminder, not an authority.');
  await expect(banner).toBeVisible();
  await expect(page.getByText('Stop working under this case')).toBeVisible();
});

test('a search returns a projection whose only next step is the case', async ({ page }) => {
  const { reference } = openedCase();
  await page.goto('/find');

  // The working case lives in the session cookie and each test starts from the
  // state captured at provisioning, so the case is given here explicitly. That
  // is also the honest path: the case reference travels with the search either
  // way, and a search for an investigative purpose without one is refused.
  await page.getByLabel('Under which case').fill(reference);
  await page.getByLabel('Plateau Citizen ID').fill(citizenPcid());
  await page.getByRole('button', { name: 'Search' }).click();

  const results = page.getByRole('region', { name: /match(es)?$/ });
  await expect(results.getByText(citizenPcid())).toBeVisible();

  // The only action on a result is to link the person to the case. There is no
  // route from a results list into a record, which is the pattern this design
  // exists to remove.
  await expect(results.getByRole('link', { name: `Link to ${reference}` })).toBeVisible();
  await expect(results.getByRole('link', { name: 'Open record' })).toHaveCount(0);
});

test('a person not linked to the case is refused as if they did not exist', async ({ page }) => {
  const { reference } = openedCase();
  await page.goto(`/person/${citizenPcid()}?case=${reference}`);

  await expect(
    page.getByRole('heading', { name: 'That record is not open to you', level: 1 }),
  ).toBeVisible();
  await expect(page.getByText('No such record, or not one this case reaches')).toBeVisible();
  await expect(page.getByRole('link', { name: `Link this person to ${reference}` })).toBeVisible();
});

test('linking somebody is a separate act, and it opens the record', async ({ page }) => {
  const { reference } = openedCase();
  await page.goto(`/cases/${reference}#subjects`);

  await page.getByLabel('Plateau Citizen ID').fill(citizenPcid());
  await page.getByLabel('What are they to this case').selectOption('COMPLAINANT');
  await page
    .getByLabel('Why this person is relevant')
    .fill('Reported the theft and is the registered keeper of the vehicle.');
  await page.getByRole('button', { name: 'Link to this case' }).click();

  await expect(page.getByText('Linked to the case')).toBeVisible();

  const subjects = page.getByRole('region', { name: 'People and records linked to this case' });
  // The reason given at the time is part of the file, not a hidden audit field.
  await expect(subjects.getByText('Reported the theft and is the registered keeper')).toBeVisible();

  await subjects.getByRole('link', { name: 'Open record' }).click();
  const banner = page.getByText('Opened under:');
  await expect(banner).toBeVisible();
  await expect(page.getByRole('link', { name: reference })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Identity' })).toBeVisible();
});

test('the case file keeps an append-only note', async ({ page }) => {
  const { reference } = openedCase();
  await page.goto(`/cases/${reference}#notes`);

  await page.getByLabel('Add a note').fill('Statement taken from the complainant at 11:20.');
  await page.getByRole('button', { name: 'Add to the file' }).click();

  await expect(page.getByText('Note added')).toBeVisible();
  const notes = page.getByRole('region', { name: 'Case notes' });
  await expect(notes.getByText('Statement taken from the complainant at 11:20.')).toBeVisible();
  await expect(notes.getByText('Case Officer', { exact: false })).toBeVisible();
});

test('the status list offers nothing that would lock the officer out', async ({ page }) => {
  const { reference } = openedCase();
  await page.goto(`/cases/${reference}`);

  // SUSPENDED authorises no access either, and changing a case is itself
  // case-bound, so an officer who set it would lose the file and have no way to
  // set it back. A one-way door is not something an interface puts a button on.
  await expect(page.locator('#edit-status option')).toHaveCount(3);
  await expect(page.locator('#edit-status option', { hasText: 'Suspended' })).toHaveCount(0);
  await expect(page.getByText('the platform offers no way out of it')).toBeVisible();
});

test('an investigator cannot close their own case', async ({ page }) => {
  const { reference } = openedCase();
  await page.goto(`/cases/${reference}`);

  // CASE_CLOSE belongs to a supervisor. The portal does not offer a button the
  // platform would refuse.
  await expect(page.getByRole('heading', { name: 'Close this case' })).toHaveCount(0);
  await expect(
    page.getByText('It belongs to a supervisor and demands a closure note.'),
  ).toBeVisible();
});

test('a withheld field is asked for, not worked around', async ({ page }) => {
  await page.goto('/authorisation');

  await expect(
    page.getByRole('heading', { name: 'Ask for a field that was withheld' }),
  ).toBeVisible();

  await page.getByLabel('Why you need it').selectOption('CRIMINAL_INVESTIGATION');
  await page.getByLabel('Whose record').fill(citizenPcid());
  await page.getByLabel('National Identification Number').check();
  await page
    .getByLabel('Why the enquiry needs it')
    .fill('The keeper record and the complainant must be shown to be the same person.');
  await page.getByRole('button', { name: 'Request access' }).click();

  // Either answer is correct and both are informative: the engine runs the check
  // before queueing anything, so a field already open to this account is not
  // sent to an approver at all.
  await expect(
    page.getByText('You already have those fields').or(page.getByText(/is with an approver/)),
  ).toBeVisible();
});

test('break glass is absent, and the page says why', async ({ page }) => {
  await page.goto('/authorisation');

  // No investigative role holds BREAK_GLASS_INITIATE. Saying so is better than
  // a blank space an officer would read as "the platform cannot do this".
  await expect(page.getByRole('heading', { name: 'Break glass', exact: true })).toBeVisible();
  await expect(page.getByText('Not held by this account')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Break the glass' })).toHaveCount(0);
});
