/**
 * Accessibility (§73).
 *
 * Officers use this application in vehicles, in control rooms and on old station
 * hardware, sometimes with a screen reader. Every page is checked against WCAG
 * 2.1 AA after the journeys have filled it with real content — an empty table
 * hides most of the mistakes a populated one makes.
 *
 * Automated checks catch perhaps half of what matters. They are the floor.
 */
import { expect, test } from '@playwright/test';

import AxeBuilder from '@axe-core/playwright';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** Run as the missing-person officer, whose entitlements reach the most pages. */
const SIGNED_IN = [
  '/home',
  '/cases',
  '/find',
  '/missing-persons',
  '/unidentified-persons',
  '/authorisation',
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

test('a populated enquiry meets WCAG 2.1 AA', async ({ page }) => {
  await page.goto('/missing-persons');
  await page
    .getByRole('table', { name: 'Missing-person enquiries' })
    .getByRole('link')
    .first()
    .click();

  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(summarise(results.violations)).toEqual([]);
});

test('an unidentified-person record meets WCAG 2.1 AA', async ({ page }) => {
  await page.goto('/unidentified-persons');
  await page
    .getByRole('table', { name: 'Unidentified-person records' })
    .getByRole('link')
    .first()
    .click();

  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(summarise(results.violations)).toEqual([]);
});

test('the refusal page meets WCAG 2.1 AA', async ({ page }) => {
  // A refusal is a page an officer reads carefully, under pressure. It is held
  // to the same standard as the page that releases something.
  await page.goto('/person/PL-0000-0000-0000');
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
