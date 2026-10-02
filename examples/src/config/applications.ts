// Example skeleton — adapt to your project (ships with the harness package).
import { appUrl } from './targets';

/**
 * All applications under test — one named entry per app; specs and page classes
 * pick what they need:
 *
 *   await page.goto(applications.app.url);
 *
 * Addresses come from the browser target of the same name in .harness/targets.json,
 * shared with the harness runtime (see targets.ts for the per-machine override).
 * Credentials are secrets: account identifiers and passwords come only from
 * environment variables — set them in the gitignored .env at the repo root
 * (loaded by dotenv in playwright.config.ts; copy .env.example to .env and
 * fill in the values). Never commit a literal credential here, and never let
 * one surface in a step title, log, or attachment.
 */
export const applications = {
  app: {
    name: 'app',
    url: appUrl('app'),
    login: {
      username: process.env.APP_LOGIN_USERNAME ?? '',
      password: process.env.APP_LOGIN_PASSWORD ?? '',
      captcha: process.env.APP_LOGIN_CAPTCHA ?? '',
      otp: process.env.APP_LOGIN_OTP ?? '',
    },
  },
  otherApp: {
    name: 'otherApp',
    url: `${appUrl('otherApp')}/login`,
    login: {
      username: process.env.OTHER_APP_USERNAME ?? '',
      password: process.env.OTHER_APP_PASSWORD ?? '',
    },
  },
};
