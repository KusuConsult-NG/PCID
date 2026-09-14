/**
 * End-to-end configuration for the citizen portal.
 *
 * The suite runs against the real API and the real portal build, on ports and a
 * database of its own (see `e2e/environment.ts`). Nothing is stubbed: a test
 * that passes here passes because the platform authorised the request, released
 * the field and wrote the audit record, not because a fixture said so.
 */
import { defineConfig, devices } from '@playwright/test';

import {
  API_BASE_URL,
  API_PORT,
  PORTAL_BASE_URL,
  PORTAL_PORT,
  PORTAL_SESSION_KEY,
  RESIDENT_STATE_FILE,
} from './e2e/environment';

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.results',
  fullyParallel: false,
  // The suite shares one resident and one audit trail, so it runs in order.
  workers: 1,
  forbidOnly: process.env.CI !== undefined,
  retries: process.env.CI !== undefined ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI !== undefined ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: PORTAL_BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-NG',
    timezoneId: 'Africa/Lagos',
  },
  projects: [
    {
      name: 'provision',
      testMatch: /provision\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'portal',
      dependencies: ['provision'],
      testMatch: /(journeys|security|offline)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: RESIDENT_STATE_FILE },
    },
    {
      // Last, so the pages it checks hold the records the journeys created: an
      // empty table hides most of the mistakes a populated one makes.
      name: 'accessibility',
      dependencies: ['portal'],
      testMatch: /accessibility\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: RESIDENT_STATE_FILE },
    },
  ],
  webServer: [
    {
      command: 'node --import tsx e2e/start-api.ts',
      url: `${API_BASE_URL}/api/v1/health/ready`,
      // Always a fresh stack: the API launcher recreates its database, so
      // reusing a server would leave the suite asserting against unknown data.
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // The standalone server, which is what the container runs: `next start`
      // is a different process with a different module graph.
      command: 'npm run build && npm run start',
      url: `${PORTAL_BASE_URL}/sign-in`,
      reuseExistingServer: false,
      timeout: 240_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        NODE_ENV: 'production',
        PORT: String(PORTAL_PORT),
        HOSTNAME: '127.0.0.1',
        PCID_API_URL: `http://127.0.0.1:${API_PORT}`,
        PORTAL_SESSION_KEY,
        PORTAL_SESSION_TTL_SECONDS: '1800',
      },
    },
  ],
});
