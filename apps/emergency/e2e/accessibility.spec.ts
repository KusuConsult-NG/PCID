/**
 * Accessibility (§73).
 *
 * This portal is read in a moving vehicle, at night, on a small screen, by
 * somebody wearing gloves — and in a control room on a wall, by somebody eight
 * feet away. Every page is checked against WCAG 2.1 AA after the journeys have
 * filled it with real content, because an empty table hides most of the
 * mistakes a populated one makes.
 *
 * Automated checks catch perhaps half of what matters. They are the floor.
 */
import { expect, test } from '@playwright/test';

import AxeBuilder from '@axe-core/playwright';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const SIGNED_IN = [
  '/home',
  '/incidents',
  '/map',
  '/identify',
  '/units',
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

test('a live incident meets WCAG 2.1 AA', async ({ page }) => {
  await page.goto('/incidents');
  await page.getByRole('table', { name: 'Incidents' }).getByRole('link').first().click();

  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(summarise(results.violations)).toEqual([]);
});

test('the refusal page meets WCAG 2.1 AA', async ({ page }) => {
  // A refusal is read carefully, under pressure, by somebody standing over a
  // casualty. It is held to the same standard as the page that releases.
  await page.goto('/person/PL-0000-0000-0000?incident=INC-0000-000000');
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

test('the board is legible at 400px and never scrolls sideways', async ({ page }) => {
  // A control room wall is one reader; a phone in a vehicle is the other. The
  // board has to work for both without a horizontal scrollbar, which is the
  // failure mode that makes a small screen unusable.
  await page.setViewportSize({ width: 400, height: 900 });
  await page.goto('/home');

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'the board does not scroll sideways at 400px').toBeLessThanOrEqual(1);
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
