import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Assertion-message facade (2026-09-08 "Assertion-message facade" ruling — the one
 * sanctioned `expect` home in utils; utility-classes playbook §18).
 *
 * The custom-message argument of expect controls the authored assertion title.
 * Native assertion data, errors and attachments may still contain expected/actual
 * values. Value-free secret variants protect titles only; traces, screenshots,
 * videos and Allure artifacts require appropriate access and retention.
 * Custom messages replace default not/soft markers, so negation is stated here.
 *
 * These generic wrappers implement the canonical grammar ONCE:
 * `Expect <subject> to <verb phrase> <formatted expected>`. Business layers pass a
 * business subject phrase ("the quote response status") and the same values the
 * matcher receives — the facade knows verbs, never domain nouns (practice 1 litmus).
 * Locator-backed wrappers end the message with " →", so titles read
 * `<business clause> → <selector tail>`; value/page receivers get no Playwright
 * tail, hence no delimiter.
 * Callers must keep secrets out of subjects/titles and use secret variants as needed;
 * expected values
 * arrive as the caller's parameters, so a message can never smuggle a literal the
 * matcher doesn't assert (iron law 5).
 *
 * Contract (playbook §18): no extra `test.step` — the message-titled expect step IS
 * the step, so nesting is identical to a bare expect; locator/page wrappers delegate
 * the `Locator`/`Page` straight to native `expect` (web-first auto-retry and options
 * untouched; Playwright still appends its ` locator('…')` suffix after the message);
 * one wrapper per matcher actually used in the repo — extend by need (iron law 11).
 * Which call sites MUST use these wrappers is validation-methods §13's territory.
 */

/** Renders an expected value for a step title: strings quoted, arrays compact ("[] (empty)" when empty), regexes verbatim, objects as clipped single-line JSON. Never throws. */
function fmt(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`;
  if (value instanceof RegExp) return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[] (empty)';
    return `[${value.map((entry) => fmt(entry)).join(', ')}]`;
  }
  if (value !== null && typeof value === 'object') {
    try {
      const json = JSON.stringify(value);
      return json.length > 120 ? `${json.slice(0, 120)}…` : json;
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/** Options accepted by the auto-retrying locator/page wrappers (passed through to the native matcher). */
interface RetryOptions {
  timeout?: number;
}

/** Options accepted by the text wrappers (passed through to the native matcher). */
interface TextOptions extends RetryOptions {
  useInnerText?: boolean;
  ignoreCase?: boolean;
}

///// Value assertions (synchronous — subject is an already-resolved value)

/** Asserts strict equality, titling the Allure step `Expect <subject> to be <expected>`. */
export function expectToBe<T>(subject: string, actual: T, expected: T): void {
  expect(actual, `Expect ${subject} to be ${fmt(expected)}`).toBe(expected);
}

/** Asserts strict inequality, titling the step `Expect <subject> not to be <unexpected>`. */
export function expectNotToBe<T>(subject: string, actual: T, unexpected: T): void {
  expect(actual, `Expect ${subject} not to be ${fmt(unexpected)}`).not.toBe(unexpected);
}

/** Asserts deep equality, titling the step `Expect <subject> to equal <expected>`. */
export function expectToEqual<T>(subject: string, actual: T, expected: T): void {
  // cast: Playwright's conditional matcher types can't resolve toEqual on an unconstrained generic receiver
  expect(actual as unknown, `Expect ${subject} to equal ${fmt(expected)}`).toEqual(expected);
}

/** Asserts the collection holds an entry deep-equal to the expected one — `Expect <subject> to contain an entry equal to <expected>`. */
export function expectToContainEqual<T>(subject: string, actual: T[], expectedEntry: T): void {
  expect(actual, `Expect ${subject} to contain an entry equal to ${fmt(expectedEntry)}`).toContainEqual(expectedEntry);
}

/** Asserts truthiness, titling the step `Expect <subject> to be present`. */
export function expectToBeTruthy(subject: string, actual: unknown): void {
  expect(actual, `Expect ${subject} to be present`).toBeTruthy();
}

/** Asserts the value is not undefined — `Expect <subject> to be defined`. */
export function expectToBeDefined(subject: string, actual: unknown): void {
  expect(actual, `Expect ${subject} to be defined`).toBeDefined();
}

/** Asserts the value is null — `Expect <subject> to be null`. */
export function expectToBeNull(subject: string, actual: unknown): void {
  expect(actual, `Expect ${subject} to be null`).toBeNull();
}

/** Asserts the value is not null — `Expect <subject> not to be null` (negation stated here: the message discards Playwright's `not` marker). */
export function expectNotToBeNull(subject: string, actual: unknown): void {
  expect(actual, `Expect ${subject} not to be null`).not.toBeNull();
}

/** Asserts actual > threshold — `Expect <subject> to be greater than <threshold>`. */
export function expectToBeGreaterThan(subject: string, actual: number, threshold: number): void {
  expect(actual, `Expect ${subject} to be greater than ${fmt(threshold)}`).toBeGreaterThan(threshold);
}

/** Asserts actual >= min — `Expect <subject> to be at least <min>`. */
export function expectToBeAtLeast(subject: string, actual: number, min: number): void {
  expect(actual, `Expect ${subject} to be at least ${fmt(min)}`).toBeGreaterThanOrEqual(min);
}

/** Asserts actual <= max — `Expect <subject> to be at most <max>`. */
export function expectToBeAtMost(subject: string, actual: number, max: number): void {
  expect(actual, `Expect ${subject} to be at most ${fmt(max)}`).toBeLessThanOrEqual(max);
}

/** Asserts numeric closeness — `Expect <subject> to be close to <expected>`; `numDigits` passes through to the matcher. */
export function expectToBeCloseTo(subject: string, actual: number, expected: number, numDigits?: number): void {
  expect(actual, `Expect ${subject} to be close to ${fmt(expected)}`).toBeCloseTo(expected, numDigits);
}

/** Asserts membership (array element or substring) — `Expect <subject> to contain <expected>`. */
export function expectToContain<T>(subject: string, actual: string | T[], expected: T): void {
  expect(actual, `Expect ${subject} to contain ${fmt(expected)}`).toContain(expected);
}

/** Asserts non-membership — `Expect <subject> not to contain <unexpected>`. */
export function expectNotToContain<T>(subject: string, actual: string | T[], unexpected: T): void {
  expect(actual, `Expect ${subject} not to contain ${fmt(unexpected)}`).not.toContain(unexpected);
}

/** Inverted membership — the element is the business subject, the allowed set the oracle: `Expect <subject> to be one of <allowed>`. */
export function expectToBeOneOf<T>(subject: string, element: T, allowed: T[]): void {
  expect(allowed, `Expect ${subject} to be one of ${fmt(allowed)}`).toContain(element);
}

/** Asserts collection/string length — `Expect <subject> to have <expected> <unit>(s)`; `unit` defaults to "item" (DB validations pass "row"). */
export function expectToHaveLength(subject: string, actual: string | unknown[], expected: number, unit: string = 'item'): void {
  expect(actual, `Expect ${subject} to have ${expected} ${unit}(s)`).toHaveLength(expected);
}

///// Web-first assertions (auto-retrying — subject is a live Locator/Page, passed straight through)

/** Auto-retrying exact-text assertion — `Expect <subject> to have text <expected> → …`. */
export async function expectToHaveText(
  subject: string,
  locator: Locator,
  expected: string | RegExp | (string | RegExp)[],
  options?: TextOptions,
): Promise<void> {
  await expect(locator, `Expect ${subject} to have text ${fmt(expected)} →`).toHaveText(expected, options);
}

/** Auto-retrying contains-text assertion (composite elements only — validation-methods §5) — `Expect <subject> to contain text <expected> → …`. */
export async function expectToContainText(
  subject: string,
  locator: Locator,
  expected: string | RegExp | (string | RegExp)[],
  options?: TextOptions,
): Promise<void> {
  await expect(locator, `Expect ${subject} to contain text ${fmt(expected)} →`).toContainText(expected, options);
}

/** Auto-retrying input-value assertion — `Expect <subject> to have value <expected> → …`. */
export async function expectToHaveValue(
  subject: string,
  locator: Locator,
  expected: string | RegExp,
  options?: RetryOptions,
): Promise<void> {
  await expect(locator, `Expect ${subject} to have value ${fmt(expected)} →`).toHaveValue(expected, options);
}

/** Auto-retrying count assertion — `Expect <subject> to show <expected> <unit>(s) → …`; `unit` defaults to "item". */
export async function expectToHaveCount(
  subject: string,
  locator: Locator,
  expected: number,
  unit: string = 'item',
  options?: RetryOptions,
): Promise<void> {
  await expect(locator, `Expect ${subject} to show ${expected} ${unit}(s) →`).toHaveCount(expected, options);
}

/**
 * Auto-retrying count-equality assertion against a second, independently-changing
 * locator — `Expect <subject> to show as many <unit>(s) as the reference set → …`.
 * Both counts are re-read together on every retry (unlike a plain `.count()` snapshot
 * compared against a fixed number), so it settles correctly even when the reference
 * locator itself is still catching up to an async reload.
 */
export async function expectToHaveMatchingCount(
  subject: string,
  locator: Locator,
  referenceLocator: Locator,
  unit: string = 'item',
  options?: RetryOptions,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const [actual, expected] = await Promise.all([locator.count(), referenceLocator.count()]);
        return actual === expected ? true : `${actual} of ${expected}`;
      },
      { message: `Expect ${subject} to show as many ${unit}(s) as the reference set →`, ...options },
    )
    .toBe(true);
}

/** Auto-retrying negated count assertion — `Expect <subject> not to show <unexpected> <unit>(s) → …`. */
export async function expectNotToHaveCount(
  subject: string,
  locator: Locator,
  unexpected: number,
  unit: string = 'item',
  options?: RetryOptions,
): Promise<void> {
  await expect(locator, `Expect ${subject} not to show ${unexpected} ${unit}(s) →`).not.toHaveCount(unexpected, options);
}

/** Auto-retrying attribute assertion — `Expect <subject> to have <name> = <value> → …`. */
export async function expectToHaveAttribute(
  subject: string,
  locator: Locator,
  name: string,
  value: string | RegExp,
  options?: RetryOptions,
): Promise<void> {
  await expect(locator, `Expect ${subject} to have ${name} = ${fmt(value)} →`).toHaveAttribute(name, value, options);
}

/** Auto-retrying CSS-property assertion — `Expect <subject> to have css <property> = <value> → …`. */
export async function expectToHaveCSS(
  subject: string,
  locator: Locator,
  property: string,
  value: string | RegExp,
  options?: RetryOptions,
): Promise<void> {
  await expect(locator, `Expect ${subject} to have css ${property} = ${fmt(value)} →`).toHaveCSS(property, value, options);
}

/** Auto-retrying visibility assertion — `Expect <subject> to be visible → …`. */
export async function expectToBeVisible(subject: string, locator: Locator, options?: RetryOptions): Promise<void> {
  await expect(locator, `Expect ${subject} to be visible →`).toBeVisible(options);
}

/** Auto-retrying hidden-state assertion — `Expect <subject> to be hidden → …`. */
export async function expectToBeHidden(subject: string, locator: Locator, options?: RetryOptions): Promise<void> {
  await expect(locator, `Expect ${subject} to be hidden →`).toBeHidden(options);
}

/** Auto-retrying enabled-state assertion — `Expect <subject> to be enabled → …`. */
export async function expectToBeEnabled(subject: string, locator: Locator, options?: RetryOptions): Promise<void> {
  await expect(locator, `Expect ${subject} to be enabled →`).toBeEnabled(options);
}

/** Auto-retrying disabled-state assertion — `Expect <subject> to be disabled → …`. */
export async function expectToBeDisabled(subject: string, locator: Locator, options?: RetryOptions): Promise<void> {
  await expect(locator, `Expect ${subject} to be disabled →`).toBeDisabled(options);
}

/** Auto-retrying negated checked-state assertion — `Expect <subject> not to be checked → …` (negation stated here: the message discards Playwright's `not` marker). */
export async function expectNotToBeChecked(subject: string, locator: Locator, options?: RetryOptions): Promise<void> {
  await expect(locator, `Expect ${subject} not to be checked →`).not.toBeChecked(options);
}

/** Auto-retrying negated editable-state assertion — `Expect <subject> not to be editable → …` (negation stated here: the message discards Playwright's `not` marker). Fails for either a `disabled` or a `readonly` element, so it proves "read-only/non-editable" without assuming which attribute the app uses. */
export async function expectNotToBeEditable(subject: string, locator: Locator, options?: RetryOptions): Promise<void> {
  await expect(locator, `Expect ${subject} not to be editable →`).not.toBeEditable(options);
}

///// Secret-valued assertions (the expected value is a credential — asserted for real, never rendered in any title; iron law 7)

/** Auto-retrying contains-text assertion whose expected value is confidential — titled `Expect <subject> to contain the confidential expected text → …`; the matcher still receives and asserts the real value. */
export async function expectToContainSecretText(
  subject: string,
  locator: Locator,
  secretValue: string | RegExp,
  options?: TextOptions,
): Promise<void> {
  await expect(locator, `Expect ${subject} to contain the confidential expected text →`).toContainText(secretValue, options);
}

/** Auto-retrying input-value assertion whose expected value is confidential — titled `Expect <subject> to have the confidential expected value → …`; the matcher still receives and asserts the real value. */
export async function expectToHaveSecretValue(
  subject: string,
  locator: Locator,
  secretValue: string | RegExp,
  options?: RetryOptions,
): Promise<void> {
  await expect(locator, `Expect ${subject} to have the confidential expected value →`).toHaveValue(secretValue, options);
}

/** Auto-retrying page-URL assertion (arrival checks pass the page class's own `url` field) — `Expect the page URL to be <expected>`. */
export async function expectToHaveURL(page: Page, expected: string | RegExp, options?: RetryOptions): Promise<void> {
  await expect(page, `Expect the page URL to be ${fmt(expected)}`).toHaveURL(expected, options);
}
