import { expect, type Locator } from '@playwright/test';

/** Compare a public normalized result without swallowing an assertion failure. */
export async function expectToEqual(subject: string, actual: unknown, expected: unknown) {
  expect(actual, `Expect ${subject} to equal ${expected}`).toEqual(expected);
}

/** Retain Playwright's native web-first waiting and exact text comparison. */
export async function expectToHaveText(subject: string, locator: Locator, expected: string) {
  await expect(locator, `Expect ${subject} to have text ${expected}`).toHaveText(expected);
}
