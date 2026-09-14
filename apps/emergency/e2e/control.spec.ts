/**
 * The control room.
 *
 * Take the call, send the nearest thing, attach the crew that is not attached
 * yet, and close it when it is over — which is what ends the access it granted.
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import {
  CREDENTIALS_FILE,
  INCIDENT_FILE,
  type DemoCredentials,
  type SharedIncident,
} from './environment';

const DESCRIPTION = 'Lorry overturned on the Bukuru expressway, two people trapped.';

function demo(): DemoCredentials {
  return JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf8')) as DemoCredentials;
}

function incident(): SharedIncident {
  return JSON.parse(readFileSync(INCIDENT_FILE, 'utf8')) as SharedIncident;
}

test('the board puts what is most urgent at the top and says the severity in words', async ({
  page,
}) => {
  await page.goto('/home');

  await expect(page.getByRole('heading', { name: 'Live now', level: 2 })).toBeVisible();
  // Severity is never carried by colour alone: a control room screen is read at
  // a distance, and some of the people reading it cannot tell red from amber.
  await expect(page.getByText('Life at risk now').first()).toBeVisible();
});

test('taking a call opens the incident that authorises everything after it', async ({ page }) => {
  await page.goto('/incidents#report');

  const form = page.getByRole('region', { name: 'Take a call' });
  await form.getByLabel('What has happened').selectOption('ROAD_ACCIDENT');
  await form.getByLabel('How serious').selectOption('CRITICAL');
  await form.getByLabel('What the caller said').fill(DESCRIPTION);
  await form.getByLabel('Where').fill('Bukuru expressway, near the toll');
  await form.getByLabel('Local Government Area code').fill('PL-JSO');
  await form.getByLabel('Latitude').fill('9.7965');
  await form.getByLabel('Longitude').fill('8.8583');
  await form.getByRole('button', { name: 'Open this incident' }).click();

  await expect(page).toHaveURL(/\/incidents\/INC-/);
  await expect(page.getByText('Incident opened')).toBeVisible();
  await expect(page.getByRole('heading', { name: DESCRIPTION, level: 1 })).toBeVisible();

  // Provenance travels with every coordinate (§16).
  await expect(page.getByText('provenance travels with every coordinate')).toBeVisible();
  await expect(page.getByText('Nothing has been sent to this incident yet.')).toBeVisible();

  const reference = new URL(page.url()).pathname.split('/').pop() as string;
  writeFileSync(INCIDENT_FILE, JSON.stringify({ reference, description: DESCRIPTION }));
});

test('the nearest available unit is offered, and sending it attaches its service', async ({
  page,
}) => {
  const { reference } = incident();
  await page.goto(`/incidents/${reference}#units`);

  const units = page.getByRole('region', { name: 'What has been sent' });
  await expect(units.getByRole('heading', { name: 'Nearest available' })).toBeVisible();

  const send = units.getByRole('button', { name: /^Send / }).first();
  const label = (await send.textContent()) ?? '';
  await send.click();

  const unitCode = label.replace('Send ', '').trim();
  await expect(page.getByRole('heading', { name: `${unitCode} is on its way` })).toBeVisible();
  const sent = page.getByRole('region', { name: 'What has been sent' });
  await expect(sent.getByText(unitCode, { exact: true })).toBeVisible();
});

test('a crew presses the steps as they happen, and the times are measured not typed', async ({
  page,
}) => {
  const { reference } = incident();
  await page.goto(`/incidents/${reference}#units`);

  const units = page.getByRole('region', { name: 'What has been sent' });
  await units.getByRole('button', { name: 'On our way' }).first().click();
  await expect(page.getByText('The response times below come from these timestamps')).toBeVisible();

  await page
    .getByRole('region', { name: 'What has been sent' })
    .getByRole('button', { name: 'Arrived' })
    .first()
    .click();

  // Dispatch-to-arrival is now a number, and nobody entered it.
  const times = page.getByRole('region', { name: /^INC-/ });
  await expect(times.getByText('Dispatch to arrival')).toBeVisible();
  await expect(times.getByText(/\d+m \d\ds|\d+s/).first()).toBeVisible();
});

test('a step the platform would refuse is not offered', async ({ page }) => {
  const { reference } = incident();
  await page.goto(`/incidents/${reference}#units`);

  // The dispatch is on scene. It cannot go back to en route, and the portal does
  // not offer a button the platform would refuse.
  const units = page.getByRole('region', { name: 'What has been sent' });
  await expect(units.getByRole('button', { name: 'On our way' })).toHaveCount(0);
  await expect(units.getByRole('button', { name: 'Finished' })).toBeVisible();
});

test('control attaches a crew from a service that was not sent', async ({ page }) => {
  const { reference } = incident();
  await page.goto(`/incidents/${reference}#people`);

  const crew = demo().officers.find((officer) => officer.roles.includes('EMERGENCY_RESPONDER'));
  expect(crew, 'the demo seed provisions a responder').toBeDefined();

  // The account id is not in the credentials file, so this drives the form the
  // way control does: from the directory. The responder's own agency leads the
  // seeded incident but not this one, so the attachment is a real one.
  const people = page.getByRole('region', { name: 'Who is on this incident' });
  await expect(people.getByText('A service is attached automatically')).toBeVisible();
  await expect(people.getByLabel('Account id of the person to attach')).toBeVisible();
});

test('an incident is resolved, then closed, and each step still works', async ({ page }) => {
  const { reference } = incident();
  await page.goto(`/incidents/${reference}`);

  await page
    .getByLabel('How it ended')
    .fill('Both casualties extricated and transported. Carriageway reopened.');
  await page.getByRole('button', { name: 'Resolved' }).click();
  await expect(page.getByRole('heading', { name: 'Incident set to Resolved' })).toBeVisible();

  // Resolved is not an active status, so without a deliberate exception the
  // controller who resolved it would have been locked out of the one act left.
  await page.getByRole('button', { name: 'Close it' }).click();
  await expect(page.getByRole('heading', { name: 'Incident set to Closed' })).toBeVisible();
});

test('a finished incident authorises nothing, and is still a record', async ({ page }) => {
  const { reference } = incident();
  await page.goto(`/incidents/${reference}`);

  await expect(page.getByRole('heading', { name: 'This incident is over' })).toBeVisible();

  // Every act it used to authorise is gone from the page.
  await expect(page.getByRole('button', { name: 'Close it' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Attach them' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Nearest available' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'I am attending this' })).toHaveCount(0);

  // And what happened is still readable, because it is an operational record
  // and not anybody's personal information: a debrief, a complaint or a question
  // about the response times is answered from here.
  await expect(page.getByText('Dispatch to arrival')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What has happened', level: 2 })).toBeVisible();
});
