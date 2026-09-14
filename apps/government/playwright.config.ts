/**
 * End-to-end configuration for the government portal.
 *
 * The same shape as the citizen portal's suite — a real API against a database
 * created for the run, seeded with `npm run db:demo`, and the standalone build
 * the container runs — on ports and a database of its own so the two can run at
 * the same time.
 */
import { defineConfig, devices } from '@playwright/test';

import {
  API_BASE_URL,
  API_PORT,
  PORTAL_BASE_URL,
  PORTAL_PORT,
  PORTAL_SESSION_KEY,
  STATE_FILES,
} from './e2e/environment';

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.results',
  fullyParallel: false,
  // One provisioned cast of officers, one audit trail: the suite runs in order.
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
      name: 'registration',
      dependencies: ['provision'],
      testMatch: /registration\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: STATE_FILES.REGISTRATION_OFFICER },
    },
    {
      // The counter: a different account with different entitlements, which is
      // the point of running these as somebody other than the registrar.
      name: 'counter',
      dependencies: ['provision'],
      testMatch: /(verification|entitlements)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: STATE_FILES.VERIFICATION_OFFICER },
    },
    {
      name: 'oversight',
      dependencies: ['registration', 'counter'],
      testMatch: /oversight\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: STATE_FILES.DATA_PROTECTION_OFFICER },
    },
    {
      // Last, so the pages it checks hold the records the journeys created.
      name: 'accessibility',
      dependencies: ['oversight'],
      testMatch: /accessibility\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: STATE_FILES.DATA_PROTECTION_OFFICER },
    },
  ],
  webServer: [
    {
      command: 'node --import tsx e2e/start-api.ts',
      url: `${API_BASE_URL}/api/v1/health/ready`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
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
        GOVERNMENT_PORTAL_SESSION_KEY: PORTAL_SESSION_KEY,
        GOVERNMENT_PORTAL_SESSION_TTL_SECONDS: '1800',
      },
    },
  ],
});
