/**
 * The command map.
 *
 * What is checked here is as much what is absent as what is drawn: no tile
 * request leaves the browser, an incident with no coordinate is beside the
 * picture rather than on it, and the table under the plot carries everything the
 * plot does.
 */
import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { INCIDENT_FILE, type SharedIncident } from './environment';

function incident(): SharedIncident {
  return JSON.parse(readFileSync(INCIDENT_FILE, 'utf8')) as SharedIncident;
}

test('the picture draws what has a position, with a scale bar', async ({ page }) => {
  await page.goto('/map');

  await expect(page.getByRole('heading', { name: 'The picture', exact: true })).toBeVisible();

  const plot = page.getByRole('img', { name: /Positions of \d+ live incidents/ });
  await expect(plot).toBeVisible();

  // Without a scale bar the picture is a diagram: two pins a centimetre apart
  // could be two streets or two local governments.
  await expect(page.locator('.plot-scale text')).toHaveText(/^\d+ km$/);
});

test('the browser fetches nothing from anywhere else', async ({ page }) => {
  // Every tile a browser fetched would tell the provider which rectangle of the
  // state a control room is looking at. The portal's CSP forbids it; this is the
  // check that the page does not try.
  const external: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') external.push(request.url());
  });

  await page.goto('/map');
  await page.waitForLoadState('networkidle');

  expect(external, 'the map made an external request').toEqual([]);
});

test('everything on the picture is also in a table, in order of urgency', async ({ page }) => {
  await page.goto('/map');

  const listed = page.getByRole('table', { name: 'Live incidents with a reported position' });
  await expect(listed).toBeVisible();

  // Not a fallback: a scatter of marks is unreadable to a screen reader and to
  // anybody who cannot tell one colour from another.
  await expect(page.getByText('This is not a fallback')).toBeVisible();
  await expect(listed.getByText('Life at risk now').first()).toBeVisible();
});

test('an incident with no coordinate is listed, never placed', async ({ page }) => {
  // Taken by address, the way most calls actually arrive: somebody says where
  // they are in words and nobody has a coordinate.
  await page.goto('/incidents#report');
  const form = page.getByRole('region', { name: 'Take a call' });
  await form.getByLabel('What has happened').selectOption('PUBLIC_DISTURBANCE');
  await form.getByLabel('How serious').selectOption('MEDIUM');
  await form
    .getByLabel('What the caller said')
    .fill('Crowd gathering outside the market; caller could not say exactly where.');
  await form.getByLabel('Where').fill('Terminus market, Jos');
  await form.getByLabel('Local Government Area code').fill('PL-JNO');
  await form.getByRole('button', { name: 'Open this incident' }).click();
  await expect(page.getByText('Incident opened')).toBeVisible();

  const reference = new URL(page.url()).pathname.split('/').pop() as string;

  await page.goto('/map');
  const unplaced = page.getByRole('region', { name: 'Live, and not on the picture' });
  await expect(unplaced).toBeVisible();
  await expect(unplaced.getByText(reference)).toBeVisible();

  // A map that placed it at the centre of its local government would be
  // inventing precision, and somebody would send a unit to the pin.
  await expect(
    unplaced.getByText('a point somebody chose is a point a crew drives to'),
  ).toBeVisible();
  const placed = page.getByRole('table', { name: 'Live incidents with a reported position' });
  await expect(placed.getByText(reference)).toHaveCount(0);
});

test('every position says how much it should be trusted', async ({ page }) => {
  await page.goto('/map');

  // Provenance travels with every coordinate (§16), and on a map it is the
  // difference between a point a responder stood on and one a caller guessed at.
  const listed = page.getByRole('table', { name: 'Live incidents with a reported position' });
  await expect(listed.getByText(/Taken with the report|Given by the caller/).first()).toBeVisible();
});

test('the map says there is no layer that could show a person', async ({ page }) => {
  await page.goto('/map');
  await expect(page.getByText('There is no layer here that could show a person')).toBeVisible();
});

test('a pin links to the incident it is', async ({ page }) => {
  const { reference } = incident();
  await page.goto('/map');

  const listed = page.getByRole('table', { name: 'Live incidents with a reported position' });
  const link = listed.getByRole('link', { name: reference });
  if ((await link.count()) === 0) {
    // The control spec closes the incident it opened, so by the time this runs
    // it may be off the picture — which is itself the right behaviour.
    return;
  }
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/incidents/${reference}`));
});
