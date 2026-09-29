// Example skeleton — adapt to your project (ships with the harness package).
/**
 * All applications under test — one named entry per app; specs and page classes
 * pick what they need:
 *
 *   await page.goto(applications.app.url);
 *
 * Credentials are secrets: account identifiers and passwords come only from
 * environment variables — set them in the gitignored .env at the repo root
 * (loaded by dotenv in playwright.config.ts; copy .env.example to .env and
 * fill in the values). Never commit a literal credential here, and never let
 * one surface in a step title, log, or attachment.
 */
export const applications = {
  app: {
    name: 'app',
    url: 'https://your-app.example.com',
    login: {
      username: process.env.APP_LOGIN_USERNAME ?? '',
      password: process.env.APP_LOGIN_PASSWORD ?? '',
      captcha: process.env.APP_LOGIN_CAPTCHA ?? '',
      otp: process.env.APP_LOGIN_OTP ?? '',
    },
  },
  otherApp: {
    name: 'otherApp',
    url: 'https://your-other-app.example.com/login',
    login: {
      username: process.env.OTHER_APP_USERNAME ?? '',
      password: process.env.OTHER_APP_PASSWORD ?? '',
    },
  },
};
