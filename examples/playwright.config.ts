// Example skeleton — adapt to your project (ships with the harness package).
import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { allureConfig, allureEnvironmentInfo } from './src/config/reporting';
import { TEST_DEFAULT_MS, EXPECT_DEFAULT_MS, ACTION_DEFAULT_MS, NAVIGATION_DEFAULT_MS } from './src/config/timeouts';
/**
 * Read environment variables (secrets like DB credentials) from the gitignored
 * .env at the repo root — copy .env.example to .env and fill in the values.
 * https://github.com/motdotla/dotenv
 */
dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  /* Default testMatch already recurses into subfolders — a one-folder-deep spec
   * layout (tests/<Suite Folder>/<Feature>Tests.spec.ts, design-conventions.md
   * spec-folder ruling) needs no extra config. */
  /* Multi-step wizard journeys (page load + step transitions) exceed the 30s default. */
  timeout: TEST_DEFAULT_MS,
  /* Assertion budget for slow environments — the de-facto 30s tier (2026-09-08 timeout
   * ruling). An inline { timeout } on an assertion now means: this spot deviates
   * deliberately (hotspots above it; utils retry-ladder budgets below it). */
  expect: { timeout: EXPECT_DEFAULT_MS },
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : 3,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [
    ['list'],
    // Finish Allure before the HTML viewer's onExit can keep an interactive run open.
    ['./src/utils/AllureReport.ts'],
    ['html', { open: 'always', outputFolder: 'reports/playwright-report' }],
    // Paths and environmentInfo are shared with setup and the post-flush report job.
    ['allure-playwright', {
      resultsDir: allureConfig.resultsDir,
      environmentInfo: allureEnvironmentInfo,
      links: {
        tms: {
          nameTemplate: 'Test: #%s',
          urlTemplate: 'https://dev.azure.com/your-org/your-project/_workitems/edit/%s'
        },
        // issue: {
        //   nameTemplate: 'Bug: #%s',
        //   urlTemplate: 'https://dev.azure.com/your-org/your-project/_workitems/edit/%s'
        // },
      },
    }],
    ['json', { outputFile: 'reports/json-report/test-results.json' }],
    // consumed by Azure Pipelines' PublishTestResults task — feeds the run's Tests tab
    ['junit', { outputFile: 'reports/junit/results.xml' }],
    ['playwright-ctrf-json-reporter', {}]
  ],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* No baseURL — every journey navigates to an absolute URL from src/config (e.g. the partner portal quote URL). */
    ignoreHTTPSErrors: true,
    /* A hung click/fill/waitFor fails as itself after 30s, never as an opaque "test timed out". */
    actionTimeout: ACTION_DEFAULT_MS,
    /* Sized to measured slow-environment page loads. */
    navigationTimeout: NAVIGATION_DEFAULT_MS,
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
    headless: true,
    // viewport: { width: 1920, height: 1080 },
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },

  globalSetup: require.resolve('./global-setup.ts'),

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } },
    },

    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'], viewport: { width: 1920, height: 1080 } },
    // },

    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'], viewport: { width: 1920, height: 1080 } },
    // },
  ],

});
