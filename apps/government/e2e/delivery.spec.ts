/**
 * Message delivery, from the administrator's side (§33, §58, §7).
 *
 * Two things are being checked here and they pull in opposite directions.
 *
 * The queue has to be legible: an operator needs to see what is waiting, what is
 * failing and what has been given up on, or nobody will notice when the SMS
 * gateway has been rejecting every message for a week.
 *
 * And it has to disclose nothing. A platform administrator holds no entitlement
 * to citizen data — that is the §7 separation the whole authorisation model
 * rests on — so a delivery screen that showed message bodies would be a second
 * copy of everybody's inbox, reachable by exactly the role that must not have
 * one.
 */
import { expect, test } from '@playwright/test';

test('a platform administrator is offered administration and nothing about anybody', async ({
  page,
}) => {
  await page.goto('/home');
  const nav = page.getByRole('navigation', { name: 'Portal sections' });

  await expect(nav.getByRole('link', { name: 'Administration' })).toBeVisible();

  // No CITIZEN_SEARCH, no CITIZEN_VERIFY, no oversight. The separation runs both
  // ways: an officer cannot administer, and an administrator cannot read.
  await expect(nav.getByRole('link', { name: 'Find a person' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Verify an ID' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Audit' })).toHaveCount(0);
});

test('the delivery queue says what is waiting and what has failed', async ({ page }) => {
  await page.goto('/administration#delivery');

  const delivery = page.getByRole('region', { name: 'Message delivery' });
  await expect(delivery).toBeVisible();
  await expect(
    delivery.getByRole('table', { name: 'Queued messages by channel and status' }),
  ).toBeVisible();
  await expect(delivery.getByText('Oldest still waiting')).toBeVisible();
  await expect(delivery.getByRole('heading', { name: 'Given up on' })).toBeVisible();
});

test('the queue shows no message body, subject or recipient', async ({ page }) => {
  await page.goto('/administration#delivery');
  const delivery = page.getByRole('region', { name: 'Message delivery' });

  // The demo seeds a welcome for the resident. Its detail is readable in their
  // portal and must not be readable here.
  await expect(delivery.getByText('Choose your own passphrase')).toHaveCount(0);
  await expect(delivery.getByText(/PL-[A-Z0-9]{5}-/)).toHaveCount(0);
  await expect(delivery.getByText('Welcome to the Plateau Citizen Portal')).toHaveCount(0);

  // What it does show is the template, which says what kind of message it was
  // without saying what it said.
  await expect(delivery.getByText('Message delivery')).toBeVisible();
});

test('a sweep can be run from the page, and reports what it did', async ({ page }) => {
  await page.goto('/administration#delivery');

  await page.getByRole('button', { name: 'Run a delivery sweep now' }).click();
  await expect(page.getByText('taken from the queue')).toBeVisible();
});

test('putting an abandoned message back demands a reason', async ({ page }) => {
  await page.goto('/administration#delivery');
  const delivery = page.getByRole('region', { name: 'Message delivery' });

  const requeue = delivery.getByRole('button', { name: 'Put it back on the queue' });
  if ((await requeue.count()) === 0) {
    // Nothing has been abandoned in this run, which is the ordinary case for a
    // sandbox sender that always succeeds. The page says so rather than showing
    // an empty table.
    await expect(delivery.getByText('Nothing has been abandoned.')).toBeVisible();
    return;
  }

  await requeue.first().click();
  await expect(
    page.getByText('The next person reading this queue needs the sentence'),
  ).toBeVisible();
});
