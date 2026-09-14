/**
 * The registration desk.
 *
 * Registering somebody, being stopped by a possible duplicate, deciding it, and
 * handing over portal credentials. Against the real API throughout: a
 * registration is queued because the platform's own duplicate detection queued
 * it, not because a fixture said so.
 */
import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { CREDENTIALS_FILE, type DemoCredentials } from './environment';

const demo = (): DemoCredentials =>
  JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf8')) as DemoCredentials;

test.describe.configure({ mode: 'serial' });

/** Shared between the tests below: the person registered in the first one. */
let registeredPcid = '';

test('the home page shows what this account may do', async ({ page }) => {
  await page.goto('/home');

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Good day');
  await expect(page.getByRole('heading', { name: 'What this account can do' })).toBeVisible();
  await expect(page.getByText('Registered a resident')).toBeVisible();

  // Built from the account's entitlements, so a registration desk is not shown
  // an audit trail it cannot open.
  const nav = page.getByRole('navigation', { name: 'Portal sections' });
  await expect(nav.getByRole('link', { name: 'Register a resident' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Audit trail' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Alerts' })).toHaveCount(0);
});

test('a resident is registered and given portal credentials', async ({ page }) => {
  await page.goto('/register');

  await page.getByLabel('Given name').fill('Nanmwa');
  await page.getByLabel('Family name').fill('Bitrus');
  await page.getByLabel('Sex').selectOption('MALE');
  await page.getByLabel('Date of birth').fill('1988-11-02');
  // Optional fields carry "(optional)" in their label, so this is not exact.
  await page.getByLabel('Phone number').fill('08032220001');
  await page.getByLabel('Residential address').fill('18 Bukuru Express Way, Jos');
  await page.getByLabel('Local Government Area code').fill('PL-JSO');
  await page.getByRole('button', { name: 'Register this person' }).click();

  await expect(page.getByText('Registered', { exact: true })).toBeVisible();
  const identifier = page.getByText(
    /^PL-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{2}$/,
  );
  registeredPcid = (await identifier.first().innerText()).trim();
  expect(registeredPcid).not.toBe('');

  // The desk hands over a passphrase, shown once.
  await page.getByRole('button', { name: 'Issue portal credentials' }).click();
  await expect(page.getByText('Portal passphrase, shown once:')).toBeVisible();
  await expect(
    page.getByText('The portal will make them choose their own before it shows them anything'),
  ).toBeVisible();
});

test('a registration that looks like somebody already registered is stopped', async ({ page }) => {
  await page.goto('/register');

  // The same person, presented again at the desk.
  await page.getByLabel('Given name').fill('Nanmwa');
  await page.getByLabel('Family name').fill('Bitrus');
  await page.getByLabel('Sex').selectOption('MALE');
  await page.getByLabel('Date of birth').fill('1988-11-02');
  await page.getByLabel('Phone number').fill('08032220001');
  await page.getByLabel('Local Government Area code').fill('PL-JSO');
  await page.getByRole('button', { name: 'Register this person' }).click();

  await expect(page.getByText('This registration has been stopped for review')).toBeVisible();
  await expect(page.getByText('Nothing has been issued and nothing has been merged')).toBeVisible();
});

test('the duplicate queue shows both people and the reasoning, and a person decides', async ({
  page,
}) => {
  await page.goto('/duplicates');

  await expect(page.getByRole('heading', { name: 'Duplicate review', level: 1 })).toBeVisible();
  const candidate = page.getByRole('region', { name: /Nanmwa Bitrus/ }).first();
  await expect(candidate).toBeVisible();

  // Both people, described the same way.
  await expect(candidate.getByRole('heading', { name: 'At the desk' })).toBeVisible();
  await expect(candidate.getByRole('heading', { name: 'Already on the register' })).toBeVisible();
  // And why it was flagged, not just a number.
  await expect(candidate.getByRole('heading', { name: 'Why this was flagged' })).toBeVisible();

  await candidate
    .getByLabel('What you checked, and how you decided')
    .fill('Same person: he came back the next day having lost the slip with his ID on it.');
  await candidate.getByRole('button', { name: 'This is the same person' }).click();

  await expect(page.getByText('Recorded as the same person')).toBeVisible();
  await expect(
    page.getByText('The pending registration was rejected. No identifier was issued'),
  ).toBeVisible();
});

test('a registration desk cannot open the oversight queues', async ({ page }) => {
  // Not in the menu, and not reachable by typing the address either — the API
  // answers the same way it would for something that does not exist.
  await page.goto('/alerts');
  await expect(page.getByText('The queue could not be loaded')).toBeVisible();
});

test('the demo seed provisions officers with distinct roles', async () => {
  const roles = demo().officers.flatMap((officer) => officer.roles);
  expect(roles).toContain('REGISTRATION_OFFICER');
  expect(roles).toContain('VERIFICATION_OFFICER');
  expect(roles).toContain('DATA_PROTECTION_OFFICER');
});
