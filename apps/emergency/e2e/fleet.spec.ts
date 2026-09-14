/**
 * The fleet office.
 *
 * A technical role that registers vehicles and crews and holds no entitlement to
 * anybody's record at all (§7). That is a claim the platform makes about itself,
 * and this is where it is checked rather than asserted: the same account that
 * can put an ambulance on the road is walked at the pages that would show it a
 * person, and must find nothing.
 */
import { expect, test } from '@playwright/test';

test('a fleet office sees the vehicles and nothing about anybody', async ({ page }) => {
  await page.goto('/home');
  const nav = page.getByRole('navigation', { name: 'Portal sections' });

  await expect(nav.getByRole('link', { name: 'Units' })).toBeVisible();

  // No INCIDENT_VIEW, no EMERGENCY_PROFILE_VIEW: the sections are absent because
  // the entitlements are, not because somebody hid them.
  await expect(nav.getByRole('link', { name: 'Incidents' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Identify someone' })).toHaveCount(0);
  await expect(page.getByText('Your account does not work incidents')).toBeVisible();
});

test('typing the address of a page it does not hold opens nothing', async ({ page }) => {
  await page.goto('/identify');
  // The page renders — it is a form, not a record — but the platform is what
  // refuses, and the form cannot reach anything.
  await page.goto('/incidents');
  await expect(page.getByText('Your account does not work incidents')).toBeVisible();
});

test('a unit is registered, put into service, and taken back out', async ({ page }) => {
  await page.goto('/units#register');

  const form = page.getByRole('region', { name: 'Register a unit' });
  await form.getByLabel('Unit code').fill('amb-jos-09');
  await form.getByLabel('What it is').selectOption('AMBULANCE');
  await form.getByLabel('Based in which LGA').fill('PL-JNO');
  await form.getByLabel('What it can do').fill('paramedic, defibrillator');
  await form.getByLabel('Crew telephone').fill('08035550109');
  await form.getByLabel('In service now').selectOption('OFFLINE');
  await form.getByRole('button', { name: 'Register this unit' }).click();

  // Normalised, so a unit is not registered twice under two spellings.
  await expect(page.getByRole('heading', { name: 'AMB-JOS-09 is registered' })).toBeVisible();

  const registered = page
    .getByRole('region', { name: /units$/ })
    .locator('.card', { hasText: 'AMB-JOS-09' });
  await expect(registered.getByText('Paramedic, Defibrillator')).toBeVisible();
  await expect(registered.getByText('Offline')).toBeVisible();

  await registered.getByRole('button', { name: 'Put into service' }).click();
  await expect(page.getByRole('heading', { name: 'In service' })).toBeVisible();

  const inService = page
    .getByRole('region', { name: /units$/ })
    .locator('.card', { hasText: 'AMB-JOS-09' });
  await expect(inService.getByText('Available')).toBeVisible();
  await inService.getByRole('button', { name: 'Take out of service' }).click();
  await expect(page.getByRole('heading', { name: 'Out of service' })).toBeVisible();
});

test('the same code cannot be registered twice', async ({ page }) => {
  await page.goto('/units#register');
  const form = page.getByRole('region', { name: 'Register a unit' });
  await form.getByLabel('Unit code').fill('AMB-JOS-09');
  await form.getByLabel('What it is').selectOption('AMBULANCE');
  await form.getByRole('button', { name: 'Register this unit' }).click();

  await expect(page.getByText('A unit is already registered under that code')).toBeVisible();
});

test('a unit out on a job cannot be taken off the road from here', async ({ page }) => {
  await page.goto('/units');

  // AMB-JOS-01 is on the seeded road-accident incident. The dispatch workflow
  // owns the operational statuses because it knows whether they are true; a
  // fleet screen that could write them would let somebody mark an ambulance
  // available while it is carrying a patient.
  const fleet = page.getByRole('region', { name: /units$/ });
  const dispatched = fleet.locator('.card', { hasText: 'AMB-JOS-01' });
  await expect(dispatched.getByText('Out on a job.')).toBeVisible();
  await expect(dispatched.getByRole('button', { name: /service/ })).toHaveCount(0);
});

test('there is no field on the fleet form for where a unit is', async ({ page }) => {
  await page.goto('/units#register');

  // Where a unit is, is something the unit says. An administrator setting a
  // position would be an administrator asserting where a crew is.
  const form = page.getByRole('region', { name: 'Register a unit' });
  await expect(form.getByLabel('Latitude')).toHaveCount(0);
  await expect(form.getByLabel('Longitude')).toHaveCount(0);
  await expect(page.getByText('There is no position field here')).toBeVisible();
});
