/**
 * Oversight: corrections, alerts and the audit trail.
 *
 * Written from the Data Protection Officer's side, which is the role whose whole
 * description is these three things and which, until this phase, could do none
 * of them.
 */
import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { API_BASE_URL, CREDENTIALS_FILE, type DemoCredentials } from './environment';

const demo = (): DemoCredentials =>
  JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf8')) as DemoCredentials;

test.describe.configure({ mode: 'serial' });

test('a correction a resident raised reaches the queue and can be decided', async ({
  page,
  request,
}) => {
  // The resident asks, from their own portal.
  const login = await request.post(`${API_BASE_URL}/api/v1/auth/citizen/login`, {
    data: { identifier: demo().citizen.pcid, password: demo().citizen.temporaryPassword },
  });
  const token = ((await login.json()) as { accessToken: string }).accessToken;
  const raised = await request.post(`${API_BASE_URL}/api/v1/me/correction-requests`, {
    headers: { authorization: `Bearer ${token}` },
    data: {
      fieldPath: 'citizen.phonePrimary',
      requestedValue: '08039998888',
      justification: 'I changed network last month and the old number no longer reaches me.',
    },
  });
  expect(raised.ok()).toBe(true);

  await page.goto('/corrections');
  await expect(page.getByRole('heading', { name: 'Corrections', level: 1 })).toBeVisible();

  const item = page.getByRole('region', { name: 'Phone primary' }).first();
  await expect(item).toBeVisible();
  await expect(item.getByText('08039998888')).toBeVisible();
  await expect(item.getByText('The resident', { exact: true })).toBeVisible();

  await item
    .getByLabel('What you checked')
    .fill('Confirmed against the number the resident gave at the desk today.');
  await item.getByRole('button', { name: 'Approve and change the record' }).click();

  await expect(page.getByText('Approved, and the record has been changed')).toBeVisible();
});

test('the alert queue explains why each alert fired', async ({ page }) => {
  await page.goto('/alerts');

  await expect(page.getByRole('heading', { name: 'Alerts', level: 1 })).toBeVisible();
  // The duplicate registration in the registration spec raised one.
  const alert = page.getByRole('region').filter({ hasText: 'identity' }).first();
  await expect(alert).toBeVisible();

  await alert.getByRole('group').getByText('Why this was raised').click();
  await expect(alert.getByRole('button', { name: 'False positive' })).toBeVisible();
});

test('an alert can be dismissed, and dismissing is recorded as a finding', async ({ page }) => {
  await page.goto('/alerts');

  const alert = page.getByRole('region').filter({ hasText: 'Reference' }).first();
  await alert
    .getByLabel('What you found')
    .fill('Two registrations of one person at the same desk. Resolved in the duplicate queue.');
  await alert.getByRole('button', { name: 'Acted on it' }).click();

  await expect(page.getByText('Recorded', { exact: true })).toBeVisible();
});

test('the audit trail shows refusals as plainly as permits', async ({ page }) => {
  await page.goto('/audit?outcome=DENIED');

  await expect(page.getByRole('heading', { name: 'Audit trail', level: 1 })).toBeVisible();
  const table = page.getByRole('table', {
    name: 'Audit records matching your search, most recent first',
  });
  await expect(table).toBeVisible();
  // The registration desk tried to open the alert queue; that refusal is here.
  await expect(table.getByText('Refused').first()).toBeVisible();
});

test('the audit chain can be verified from the page that shows the log', async ({ page }) => {
  await page.goto('/audit');

  await page.getByRole('button', { name: 'Verify the chain' }).click();
  await expect(page.getByText('The audit chain is intact')).toBeVisible();
  await expect(page.getByText('Nothing has been altered or removed')).toBeVisible();
});

test('an approved correction is visible to the resident, with the reason', async ({ request }) => {
  const login = await request.post(`${API_BASE_URL}/api/v1/auth/citizen/login`, {
    data: { identifier: demo().citizen.pcid, password: demo().citizen.temporaryPassword },
  });
  const token = ((await login.json()) as { accessToken: string }).accessToken;

  const history = await request.get(`${API_BASE_URL}/api/v1/me/access-history?limit=100`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const accesses = ((await history.json()) as { accesses: { action: string }[] }).accesses;
  expect(accesses.some((entry) => entry.action === 'CORRECTION_REQUEST_REVIEW')).toBe(true);

  // And an alert review is not: telling the subject which detections fired
  // would tell them the thresholds.
  expect(accesses.some((entry) => entry.action === 'ALERT_REVIEW')).toBe(false);
});
