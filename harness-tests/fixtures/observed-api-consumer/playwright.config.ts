import {defineConfig} from '@playwright/test';
import {applications} from './src/config/applications';

export default defineConfig({
  testDir: './tests',
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 30_000,
  reporter: [['list']],
  use: {baseURL: applications.orders.url, channel: 'chrome', trace: 'off', screenshot: 'off', video: 'off'},
  projects: [{name: 'chromium'}],
});
