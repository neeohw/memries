import { defineConfig, devices } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';
import { resolveE2ePlaywrightProfile } from './scripts/e2e-profile.mjs';
import { ORIGIN } from './steps/origins';

const profile = resolveE2ePlaywrightProfile();

function featureGlob(): string {
  const raw = process.env.MEMRIES_E2E_FEATURE?.trim();
  if (!raw) return 'features/**/*.feature';
  const file = raw.replace(/^features\//, '');
  return `features/${file}`;
}

const bddDir = defineBddConfig({
  features: featureGlob(),
  steps: 'steps/**/*.ts',
  outputDir: '.features-gen',
  tags: 'not @future',
});

export default defineConfig({
  testDir: bddDir,
  fullyParallel: profile.fullyParallel,
  workers: profile.workers,
  retries: profile.retries,
  forbidOnly: profile.forbidOnly,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: profile.reporter,
  use: {
    baseURL: ORIGIN,
    locale: 'en-GB',
    timezoneId: 'UTC',
    headless: profile.headless,
    trace: profile.trace,
    screenshot: profile.screenshot,
  },
  projects: [
    {
      name: 'chromium-1280',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'chromium-touch',
      use: { ...devices['Pixel 5'], hasTouch: true },
    },
  ],
  webServer: {
    command: 'node scripts/stack.mjs up',
    url: ORIGIN,
    reuseExistingServer: !profile.inCI,
    timeout: 180_000,
  },
});
