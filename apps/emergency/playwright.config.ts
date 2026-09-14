/**
 * End-to-end configuration for the emergency response portal.
 *
 * The same shape as the other three suites — a real API against a database
 * created for the run, seeded with `npm run db:demo`, and the standalone build
 * the container runs — on ports and a database of its own so all four can run at
 * the same time.
 *
 * The projects are three jobs at one agency: control, which takes the call and
 * sends the unit; the crew, which attends it; and the fleet office, which owns
 * the vehicles and is entitled to nothing at all about any person. The last of
 * those is the one worth having, because "a technical role carries no data
 * entitlement" is a claim, and this is where it is checked.
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
  // One provisioned cast, one audit trail: the suite runs in order.
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
      name: 'fleet',
      dependencies: ['provision'],
      testMatch: /fleet\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: STATE_FILES.SECURITY_ADMINISTRATOR },
    },
    {
      name: 'control',
      dependencies: ['fleet'],
      testMatch: /(control|map)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: STATE_FILES.DISPATCHER },
    },
    {
      // A tablet in a vehicle, which is where this portal is actually read.
      name: 'crew',
      dependencies: ['control'],
      testMatch: /crew\.spec\.ts/,
      use: {
        ...devices['Pixel 7'],
        storageState: STATE_FILES.EMERGENCY_RESPONDER,
      },
    },
    {
      // Last, so the pages it checks hold the records the journeys created.
      name: 'accessibility',
      dependencies: ['crew'],
      testMatch: /accessibility\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: STATE_FILES.DISPATCHER },
    },
    {
      // After everything, because its last test signs the crew's device out -
      // which by design ends the sessions opened on it, including the one this
      // suite shares. A project that did that in the middle would take the rest
      // of the run down with it, which is the behaviour working correctly.
      name: 'offline',
      dependencies: ['accessibility'],
      testMatch: /offline\.spec\.ts/,
      use: {
        ...devices['Pixel 7'],
        storageState: STATE_FILES.EMERGENCY_RESPONDER,
      },
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
        EMERGENCY_PORTAL_SESSION_KEY: PORTAL_SESSION_KEY,
        EMERGENCY_PORTAL_SESSION_TTL_SECONDS: '43200',
      },
    },
  ],
});
