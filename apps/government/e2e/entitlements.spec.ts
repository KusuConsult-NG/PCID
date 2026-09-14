/**
 * What an account cannot do.
 *
 * The navigation is built from the account's resolved entitlements, and that is
 * only a rendering decision — so the interesting assertions are the ones that
 * type the address in anyway and check the platform refuses.
 */
import { expect, test } from '@playwright/test';

test('the menu offers only what this account holds', async ({ page }) => {
  await page.goto('/home');

  const nav = page.getByRole('navigation', { name: 'Portal sections' });
  await expect(nav.getByRole('link', { name: 'Verify an ID' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Register a resident' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Duplicate review' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Audit trail' })).toHaveCount(0);
});

test('typing the address of a page you do not hold gets you nothing', async ({ page }) => {
  await page.goto('/register');
  await expect(page.getByText('Your account cannot register residents')).toBeVisible();

  await page.goto('/duplicates');
  await expect(page.getByText('The queue could not be loaded')).toBeVisible();

  await page.goto('/audit');
  await expect(page.getByText('The trail could not be searched')).toBeVisible();
});

test('administration shows nothing to an account with no administration role', async ({ page }) => {
  await page.goto('/administration');
  await expect(page.getByText('Your account holds no administration entitlements.')).toBeVisible();
  // And says plainly that administration is not access to the register.
  await expect(page.getByText('Administration is not access')).toBeVisible();
});

test('the account page states the ceiling the engine will actually apply', async ({ page }) => {
  await page.goto('/account');

  await expect(page.getByRole('heading', { name: 'Entitlements', level: 2 })).toBeVisible();
  await expect(page.getByText('Authenticator confirmed')).toBeVisible();
  await expect(page.getByText('Clearance ceiling')).toBeVisible();
  await expect(page.getByText('Where you are signed in')).toBeVisible();
  await expect(page.getByText('This device')).toBeVisible();
});
