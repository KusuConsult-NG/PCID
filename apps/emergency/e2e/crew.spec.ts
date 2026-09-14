/**
 * The crew, on a phone-sized screen, which is where this portal is actually
 * read.
 *
 * The seeded road-accident incident has an ambulance on it, so the crew's
 * service is attached and they can identify the person in front of them. What
 * they receive is the Minimum Necessary Emergency Profile (§10, §38) — and the
 * point of these tests is as much what is absent from it as what is in it.
 */
import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { CREDENTIALS_FILE, type DemoCredentials } from './environment';

function citizenPcid(): string {
  return (JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf8')) as DemoCredentials).citizen.pcid;
}

test('a crew is offered their own portal, not control’s', async ({ page }) => {
  await page.goto('/home');
  const nav = page.getByRole('navigation', { name: 'Portal sections' });

  await expect(nav.getByRole('link', { name: 'Identify someone' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Somebody found' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Break glass' })).toBeVisible();

  // A responder holds neither INCIDENT_VIEW nor RESPONSE_UNIT_VIEW: no board,
  // no fleet. They see the person in front of them and the incident they were
  // told about.
  await expect(nav.getByRole('link', { name: 'Units' })).toHaveCount(0);
});

test('a read without an incident is refused, and the page says why', async ({ page }) => {
  await page.goto(`/person/${citizenPcid()}`);

  await expect(
    page.getByRole('heading', { name: 'An emergency profile is read under an incident', level: 1 }),
  ).toBeVisible();
  await expect(page.getByText('the policy engine refuses an emergency read')).toBeVisible();
});

test('the identify screen asks for two things and nothing else', async ({ page }) => {
  await page.goto('/identify');

  await expect(page.getByLabel('Plateau Citizen ID')).toBeVisible();
  await expect(page.getByLabel('Incident you are attending')).toBeVisible();
  await expect(page.getByText('Not their date of birth, address, phone number')).toBeVisible();
});

test('the crew receives what care needs, in the order care needs it', async ({ page }) => {
  const seeded = seededIncident();
  await page.goto('/identify');

  // Typed the way somebody types with gloves on: lower case, no hyphens.
  await page.getByLabel('Plateau Citizen ID').fill(citizenPcid().toLowerCase());
  await page.getByLabel('Incident you are attending').fill(seeded);
  await page.getByRole('button', { name: 'Open the emergency profile' }).click();

  await expect(page.getByRole('heading', { name: 'What care needs', level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Who to call', level: 2 })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Confirming it is them', level: 2 }),
  ).toBeVisible();

  await expect(page.getByText('Read under:')).toBeVisible();
  await expect(page.getByText('This is the whole of it')).toBeVisible();

  // Blood group and the conditions a resident chose to disclose for exactly this
  // moment are the reason this screen exists. If a responder's clearance sat
  // below them these rows would read "Restricted information", which is §29
  // working and a crew unable to do their job.
  const clinical = page.getByRole('region', { name: 'What care needs' });
  await expect(clinical.getByText('Restricted information')).toHaveCount(0);
});

test('the whole of somebody’s life is not behind it', async ({ page }) => {
  const seeded = seededIncident();
  await page.goto(`/person/${citizenPcid()}?incident=${seeded}`);

  // Not withheld as a matter of trust: not what emergency care needs, and an
  // emergency is not a reason to see everything.
  for (const absent of ['Date of birth', 'Registered address', 'Nin', 'Email']) {
    await expect(page.getByText(absent, { exact: true })).toHaveCount(0);
  }
  await expect(page.getByRole('link', { name: /case/i })).toHaveCount(0);
});

test('somebody found is recorded with no field saying who they are', async ({ page }) => {
  await page.goto('/unidentified-persons#record');

  const form = page.getByRole('region', { name: 'Record somebody found' });
  await form.getByLabel('Incident you are attending').fill(seededIncident());
  await form.getByLabel('Condition when found').selectOption('UNCONSCIOUS');
  await form.getByLabel('Apparent age, from').fill('25');
  await form.getByLabel('Apparent age, to').fill('35');
  await form
    .getByLabel('What they look like')
    .fill('Man of about 1.7m, short hair, no identification carried.');
  await form
    .getByLabel('Anything distinctive')
    .fill('Healed fracture of the left forearm, visible as a deformity.');
  await form.getByLabel('Where they were found').fill('Bukuru expressway, near the toll');
  await form.getByRole('button', { name: 'Record this person' }).click();

  await expect(page.getByText(/Recorded as UP-/)).toBeVisible();

  // An identity comes from a supervisor confirming a candidate match by name,
  // never from a responder typing an identifier into this record.
  await expect(page.getByText('There is no field here for who they are')).toBeVisible();
  await expect(page.getByLabel('Plateau Citizen ID')).toHaveCount(0);
});

test('break glass is offered, and the ordinary path is offered first', async ({ page }) => {
  await page.goto('/authorisation');

  // This portal's readers are the ones who genuinely reach for it, so they hold
  // it — and the page still puts "ask control" above the button.
  await expect(page.getByRole('heading', { name: 'Break the glass', level: 2 })).toBeVisible();
  await expect(page.getByText('First, ask control to attach you')).toBeVisible();
  await expect(page.getByText('Reviewed within 24 hours')).toBeVisible();
  await expect(page.getByLabel('What is happening')).toBeVisible();
});

test('break glass will not take a few words as a reason', async ({ page }) => {
  await page.goto('/authorisation#break-glass');

  await page.getByLabel('Whose details you need').fill(citizenPcid());
  await page.getByLabel('I am not attached to this incident').check();
  await page.getByLabel('What is happening').fill('urgent');
  await page.getByRole('button', { name: 'Break the glass' }).click();

  await expect(page.getByText('A reviewer has only what you put here')).toBeVisible();
});

/**
 * The incident the demo seed leaves live, with an ambulance on it.
 *
 * The crew cannot list incidents, so it is not discoverable from the portal —
 * which is exactly the position a crew is in. They are told the number.
 */
function seededIncident(): string {
  return 'INC-2026-000001';
}
