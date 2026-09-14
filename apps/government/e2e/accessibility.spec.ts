/**
 * Accessibility (§73).
 *
 * The officers using this application are at a counter all day, often on old
 * hardware, sometimes with a screen reader. Every page is checked against WCAG
 * 2.1 AA after the journeys have filled it with real content — an empty table
 * hides most of the mistakes a populated one makes.
 *
 * Automated checks catch perhaps half of what matters. They are the floor.
 */
import { readFileSync } from 'node:fs';

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { CREDENTIALS_FILE } from './environment';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const SIGNED_IN = [
  '/home',
  '/verify',
  '/find',
  '/duplicates',
  '/corrections',
  '/alerts',
  '/access-requests',
  '/audit',
  '/administration',
  '/account',
  '/change-passphrase',
  '/step-up',
];

for (const path of SIGNED_IN) {
  test(`${path} meets WCAG 2.1 AA`, async ({ page }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(summarise(results.violations)).toEqual([]);
  });
}

test('an opened record meets WCAG 2.1 AA', async ({ page }) => {
  const demo = JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf8')) as {
    citizen: { pcid: string };
  };

  await page.goto(`/person/${demo.citizen.pcid}?purpose=CORRECTION_REVIEW`);
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(summarise(results.violations)).toEqual([]);
});

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('/sign-in meets WCAG 2.1 AA', async ({ page }) => {
    await page.goto('/sign-in');
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(summarise(results.violations)).toEqual([]);
  });
});

test('the keyboard can skip the navigation', async ({ page }) => {
  await page.goto('/home');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to the main content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
});

test('every page has exactly one first-level heading and a main landmark', async ({ page }) => {
  for (const path of SIGNED_IN) {
    await page.goto(path);
    await expect(page.locator('h1'), `${path} has one h1`).toHaveCount(1);
    await expect(page.locator('main#main'), `${path} has a main landmark`).toHaveCount(1);
  }
});

function summarise(
  violations: readonly { id: string; help: string; nodes: readonly { target: unknown[] }[] }[],
): string[] {
  return violations.map(
    (violation) =>
      `${violation.id}: ${violation.help} (${violation.nodes
        .map((node) => JSON.stringify(node.target))
        .join(', ')})`,
  );
}
