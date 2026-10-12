import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: process.env.LIST_SEARCH_PROBES ? 'OrderTargetRejectionTests.spec.ts' : 'OrderLookupTests.spec.ts',
  workers: 1,
  retries: 0,
  expect: {timeout: 1500},
  use: {baseURL: process.env.LIST_SEARCH_ORIGIN, actionTimeout: 1500, headless: true},
  reporter: [['json', {outputFile: process.env.LIST_SEARCH_REPORT}],
    ['allure-playwright', {resultsDir: process.env.LIST_SEARCH_ALLURE}]],
  projects: [{name: 'chromium', use: {browserName: 'chromium'}}],
});
