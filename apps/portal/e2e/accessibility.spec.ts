/**
 * Accessibility (§73).
 *
 * A state identity portal is not optional for the people who use it: someone
 * who cannot see the screen, cannot use a mouse, or is reading on a cheap phone
 * in bright sun still has to be able to prove who they are. Every page is
 * checked against WCAG 2.1 AA, signed in and signed out, after the journeys
 * have filled the pages with real content - an empty table hides most of the
 * mistakes a populated one makes.
 *
 * Automated checks catch perhaps half of what matters. They are the floor, not
 * the ceiling, and the portal is also built to work without JavaScript.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const SIGNED_IN = [
  '/dashboard',
  '/identity',
  '/records',
  '/emergency-contacts',
  '/access-history',
  '/corrections',
  '/notifications',
  '/report',
  '/security',
  '/change-passphrase',
];

for (const path of SIGNED_IN) {
  test(`${path} meets WCAG 2.1 AA`, async ({ page }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(summarise(results.violations)).toEqual([]);
  });
}

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('/sign-in meets WCAG 2.1 AA', async ({ page }) => {
    await page.goto('/sign-in');
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(summarise(results.violations)).toEqual([]);
  });

  test('an error on sign-in is announced, not just coloured', async ({ page }) => {
    await page.goto('/sign-in?error=credentials');
    const alert = page.getByRole('status');
    await expect(alert).toContainText('Those sign-in details are not correct');

    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(summarise(results.violations)).toEqual([]);
  });
});

test('the keyboard can skip the navigation on every page', async ({ page }) => {
  await page.goto('/dashboard');

  // First tab stop is the skip link, and it becomes visible when focused.
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to the main content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();

  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main$/);
});

test('every page has exactly one first-level heading and a main landmark', async ({ page }) => {
  for (const path of SIGNED_IN) {
    await page.goto(path);
    await expect(page.locator('h1'), `${path} has one h1`).toHaveCount(1);
    await expect(page.locator('main#main'), `${path} has a main landmark`).toHaveCount(1);
  }
});

/** A violation, reduced to something a failure message can be read from. */
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
