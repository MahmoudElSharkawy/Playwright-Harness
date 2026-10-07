# Validation Methods — Playbook

Numbered practices for validation methods in `pages/`, `apis/`, and `dbs/` classes.
All examples are quoted from this repository, except those marked *(illustrative counterexample)* —
quoted verbatim from the legacy practice repo as patterns to migrate away from. Seed ✅ examples are shown in the 2026-09-08 Expects-wrapper grammar (§13) — generation pattern-matches on them. Shared law:
[design-conventions](../../pom-architecture/references/design-conventions.md).

---

## 1. Name every validation `verify` + the business condition

`verify*` is the canon; `assert*` is a legacy alias (design-conventions §5). The name
states what is true after the check passes, in business words — not the mechanics.

✅ Canonical — `src/pages/LoginPage.ts` and `src/dbs/DbsUserManagement.ts`:

```ts
async verifyErrorMessage(expectedMessage: string) { … }
async verifyThatUserIsNavigatedToLoginPage() { … }
async verifyUserExistsInDb(email: string) { … }
```

❌ Legacy — `src/pages/HeaderPage.ts` has `assertUserLoggedinSuccessfully(username)` and
`src/apis/ApisUserManagement.ts` has `assertCreateUserSuccess` / `assertLoginUserSuccess` /
`assertDeleteUserSuccess`. Do not copy the `assert*` prefix into new code. Rename to
`verify*` only opportunistically — when you are already editing that file for another
reason ("refine, don't rewrite", iron law 10) — and update every call site in the same change.

Three legacy prefixes to migrate — none is valid in new code:

- `assert*` — the alias above.
- `assertOn*` — a preposition is not a condition: `assertOnAddressDetails` becomes
  `verifyDeliveryAddressDetails`.
- `validate*` — the Java-era prefix design-conventions §5 retired, resurfacing —
  ❌ (illustrative counterexample) `src/apis/ApisProductsList.ts` mixes `assertProductsListReturnedSuccessfully`
  and `validateProductNameExistsInList` in one class.

The Allure step title migrates with the rename: it opens with `Verify` and interpolates
the expected value (a legacy `Validate Products List Returned Successfully …` title is
retitled in the same change).

Typos are defects, not protected legacy: a misspelled identifier — ❌ (illustrative counterexample)
`assetOnInvoiceAddress`, `assertTextEnterAccountInfoIsVisiable` — is fixed as a
deliberate small change together with all its call sites. "Refine, don't rewrite"
protects report-facing strings, and a method identifier never appears in the Allure
report — the step title does.

## 2. Validations sit last, under the `///// Validations` banner

Design-conventions §3 fixes the member order: fields → constructor → dynamic locator
methods → `///// Actions` → `///// Validations`. Validation methods are always the
final section, one empty line between methods.

`src/apis/ApisUserManagement.ts` currently carries a stray `/////////Assertions` banner
above its `///// Validations` banner — that is legacy. When you next touch the file,
fold the `assert*` methods under the single `///// Validations` banner (§3); do not
create a second banner in new classes.

Other drift forms to reject: a plain `//Assertions` comment, bannerless files where
validations merely trail the actions, and step-less bare-expect validations (practice 3)
— ❌ (illustrative counterexample) `src/pages/SignupPage.ts` puts four step-less `assert*` methods under a
lowercase `//Assertions` comment. The banner catalog lives in
[page-classes](../../page-classes/references/playbook.md) practice 2 — link it, don't
duplicate it.

## 3. Wrap the whole body in one Allure step titled `Verify …`

Iron law 6: every validation method is exactly one `step()` / `allure.step()` from
`allure-js-commons`, and every `expect` lives inside it. The title starts with
`Verify`, reads as a business check, and interpolates the meaningful parameters —
never secrets (iron law 7; see the `LoginPage.login()` password-leak counterexample
owned by [action-methods](../../action-methods/SKILL.md)).

✅ Canonical — `src/dbs/DbsUserManagement.ts` (parameter interpolated into the title):

```ts
async verifyUserExistsInDb(email: string) {
  await allure.step(`Verify User with email: ${email} exists in DB`, async () => {
    const { rows } = await this.dbActions.query(this.selectUserByEmail_query, { email });
    expectToHaveLength('the matching user rows', rows, 1, 'row');
  });
}
```

❌ Legacy — `src/apis/ApisUserManagement.ts` `assertCreateUserSuccess` has **no step at
all**; its expects land unlabeled in the Allure report:

```ts
async assertCreateUserSuccess(response: APIResponse, expectedMessage: string) {
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.message).toBe(expectedMessage);
}
```

The canonical form in the same file is `verifyUserCreatedSuccessfully`, which wraps
both expects in `allure.step('Verify User Created Successfully', …)`.

## 4. Use web-first assertions on the GUI layer

Page validations assert on `Locator`s (or `Page`) with auto-retrying web-first
assertions — `toBeVisible`, `toHaveText`, `toContainText`, `toHaveTitle`, `toHaveURL`,
`toHaveCount` — always awaited. Never extract a value first and feed it to a generic
`expect`, and never pad with `waitForTimeout`: you lose Playwright's built-in retry and
get flakes. Assertion budgets come from `expect.timeout` in `playwright.config.ts`
(30s — 2026-09-08 timeout ruling); pass an inline `{ timeout }` only when a surface
needs MORE than the default, where the value doubles as slow-surface documentation
(the `timeout-below-default` lint flags redundant ones).

✅ Canonical — `src/pages/HomePage.ts`:

```ts
async verifyHomePageVisible() {
  await step("Verify home page is visible successfully", async () => {
    await expectToBeVisible('the site logo', this.logo_img);
    await expectToHaveURL(this.page, this.url);
  });
}
```

❌ Anti-pattern (do not write):

```ts
await this.page.waitForTimeout(2000);
const text = await this.login_Error_Message.textContent(); // one-shot read, no retry
expect(text).toBe(expectedMessage);
```

**Arrival checks** ("user landed on the right page") assert
`await expectToHaveURL(this.page, this.url)` — against the page class's own `url`
field, the same field `navigate()` consumes: one source of truth for navigation and
validation. Never a string literal inside the validation, and never a URL smuggled in
from test data — the `url` field is the recorded iron-law-5 exception
(design-conventions, Decision records). Semantics: with `baseURL` configured, a
relative `url` field resolves against it; use a RegExp when query params vary. Wrap it
in the usual `Verify …` step like any validation (practice 3). When a page declares a
`url` field at all → [page-classes](../../page-classes/SKILL.md).

## 5. Choose the text matcher: `toHaveText` by default, `toContainText` only for composites

Default to `toHaveText(expected)` with the full expected string from test data — an
exact oracle that fails on any extra rendered text. Reach for `toContainText(expected)`
only when the element legitimately renders MORE than the tested value.

✅ Canonical — `src/pages/HeaderPage.ts`: the username sits inside a composite
`Logged in as …` label, so contains is the honest matcher:

```ts
await expectToContainText('the user profile label', this.userProfile_link, username);
```

❌ (illustrative counterexample) Full expected value through contains — `src/pages/PaymentPage.ts` passes
the whole success message to `toContainText(message)`, and `src/pages/CheckoutPage.ts` does
the same with a full expected address block. Contains with a full expected value is a
weakened oracle: extra rendered text passes silently. Both take `toHaveText`.

## 6. One business condition per method; multiple related expects are fine

A validation method checks one business-level condition; several technical expects
that together prove it belong in the same step. Do not split them into micro-methods,
and do not merge unrelated conditions into one mega-verify.

✅ Canonical — `src/pages/LoginPage.ts`, two expects proving one condition ("user landed
on the login page"):

```ts
async verifyThatUserIsNavigatedToLoginPage() {
  await step(`Verify that user is navigated to login page`, async () => {
    await expectToHaveURL(this.page, this.url);
    await expectToBeVisible('the login form header', this.login_header);
  });
}
```

❌ Anti-pattern: `verifyLoginPageAndCartCountAndFooterLinks(…)` — three unrelated
conditions in one step title. Split by business condition so the Allure report shows
which one failed.

## 7. Expected values are always parameters, fed from test data

Iron law 5: no hardcoded expected values inside a validation method — messages, titles,
texts, and counts arrive as parameters, and the spec feeds them from its paired JSON
file. Where that JSON lives and how it is clustered is owned by
[test-data](../../test-data/SKILL.md). The one recorded exception is the page class's
own `url` field: arrival checks assert `toHaveURL(this.url)` against it, never against
a test-data parameter (practice 4; design-conventions, Decision records).

✅ Canonical chain — `tests/LoginTests.spec.ts` feeding `src/pages/LoginPage.ts` from
`resources/testData/LoginTestJsonFile.json`:

```ts
// spec
await loginPage.verifyErrorMessage(testData.errorMessages.incorrcetEmailAndPasswordMsg);
```

```json
"errorMessages": {"incorrcetEmailAndPasswordMsg":"Your email or password is incorrect!"}
```

❌ Anti-pattern: `await expect(this.login_Error_Message).toHaveText('Your email or password is incorrect!');`
inside the page class — the expected value is now invisible to test data review and
unusable across environments.

Legacy-to-parameterize: the inline `expect(response.status()).toBe(200)` in
`src/apis/ApisUserManagement.ts` is a hardcoded expected value too — iron law 5 records no
exception for scenario status codes. Stable lifecycle cleanup postconditions follow
§4a and may be defined beside the domain cleanup method. New code takes the expected status as a parameter (or a
second intent-named method for negative scenarios, per the design-conventions §5
method-variant row — never a branch inside the method); tighten the inline `200` when
you next touch the file.

Pass the condition's explicit inputs/expectations under [§4a](../../pom-architecture/references/design-conventions.md#4a-test-data-ownership-method-contracts-and-disposable-inputs):

```ts
async verifyCustomerAbsent(response: APIResponse, expectedHttpStatus: number, expectedResponseCode: number) {
  await allure.step(`Verify customer absence with status: ${expectedHttpStatus} and code: ${expectedResponseCode}`, async () => {
    expectToBe('the customer lookup HTTP status', response.status(), expectedHttpStatus);
    expectToBe('the customer lookup response code', (await response.json()).responseCode, expectedResponseCode);
  });
}
// spec: values come from this spec's own paired JSON
await apisCustomers.verifyCustomerAbsent(response, testData.tc98.expected.httpStatus, testData.tc98.expected.absentApi);
```

`CaseData['expected']` couples the class upward; business-response indexed access remains valid (§4a).

## 8. API validation shape: status + body, typed `APIResponse` parameter

The action returns the `APIResponse`; the spec passes it to the validation. This keeps
action and oracle visible as two calls in the test. Assert status first, then the body
field(s) — all inside the one step.

✅ Canonical — `src/apis/ApisUserManagement.ts`:

```ts
async verifyUserCreatedSuccessfully(createResponse: APIResponse, createUserConfirmationMessage: string) {
  await allure.step(`Verify User Created Successfully`, async () => {
    expectToBe('the create-user response status', createResponse.status(), 200);
    expectToBe('the response confirmation message', (await createResponse.json()).message, createUserConfirmationMessage);
  });
}
```

❌ Legacy in the same file: `assertLoginUserSuccess(response: any, …)` — `any` hides
the contract. Type the parameter `APIResponse` (import from `@playwright/test`). The
inline `toBe(200)` above is also legacy-to-parameterize (practice 7): a new method
takes the expected status as a parameter.

**Body-embedded status codes:** some services answer HTTP 200 to everything and tunnel
the outcome in a body field — the practice AUT's `responseCode`. A validation against
such a service asserts BOTH the transport status and the body code inside the one step,
both arriving as parameters like any expected value. Sibling validations in a class must
agree on what success means — ❌ (illustrative counterexample) `src/apis/ApisProductsList.ts`:
`assertProductsListReturnedSuccessfully` checks only `data.responseCode` while
`validateFirstProductDetails` checks only `response.status()` — each guards a different half.

## 9. DB validation shape: row counts via the class's parameterized query constant

DB validations re-run the class's `<operation>_query` constant through the `DBActions`
facade with `@param` binding and assert on the row count (or a column value). Never
build SQL by string interpolation, and never touch the pool directly — those rules are
owned by [service-classes](../../service-classes/SKILL.md).

✅ Canonical — `src/dbs/DbsUserManagement.ts` (positive and negative pair):

```ts
async verifyUserNotInDb(email: string) {
  await allure.step(`Verify User with email: ${email} does not exist in DB`, async () => {
    const { rows } = await this.dbActions.query(this.selectUserByEmail_query, { email });
    expectToHaveLength('the matching user rows', rows, 0, 'row');
  });
}
```

Note the pattern: existence and absence are two intent-named methods, not one method
with a boolean parameter and an `if` inside.

## 10. No loops or conditionals — use collection assertions or split

Iron law 4: keep logic out of business classes. A validation that wants a `for` loop
over elements should use a collection assertion instead; a validation that wants an
`if` should be two intent-named methods (see practice 9). Genuinely complex comparison
mechanics belong in `utils/` ([utility-classes](../../utility-classes/SKILL.md)).

✅ Correct:

```ts
async verifyCartProductNames(expectedNames: string[]) {
  await step(`Verify cart shows products: ${expectedNames.join(', ')}`, async () => {
    await expectToHaveText('the cart product name cells', this.cartProductName_cells, expectedNames);
  });
}
```

❌ Anti-pattern:

```ts
for (let i = 0; i < expectedNames.length; i++) {
  await expect(this.cartProductName_cells.nth(i)).toHaveText(expectedNames[i]);
}
```

The same law governs API collection checks. ❌ (illustrative counterexample) `src/apis/ApisProductsList.ts`:

```ts
expect(data.products && data.products.length > 0).toBe(true); // fails as 'expected false to be true' — zero diagnostics
const product = data.products.find((p: any) => p.name === expectedName);
expect(product?.name).toEqual(expectedName);                  // fails as 'expected undefined' — hides the actual list
```

The three canonical collection shapes:

- **Non-empty** → `expectToBeGreaterThan('the returned product count', body.products.length, 0);`
- **Membership** → `expectToContain('the returned product names', body.products.map((p: Product) => p.name), expectedName);`
  — the failure prints the real list.
- **Element details** → one typed expected object, not a field-by-field scatter.

Ruling: a single-expression TYPED array query (`map`/`find`/`some`/`filter`) counts as
minimal logic and is allowed — but prefer the matcher shapes above, because their
failure output shows the collection.

## 11. Validations observe — never act, never handle errors, return `Promise<void>`

A validation reads and asserts. No `goto`, `click`, or `fill` inside it — if the check
needs an action first, the spec calls the action method, then the validation (keep
setup / action / oracle visible as separate calls). No `try`/`catch` and no soft-assert
wrappers (iron law 3): let `expect` fail — Playwright's error, the trace, and the Allure
step title tell the story. Return `Promise<void>`; a method that returns data for the
test to use is an action (compare `getUserByEmail` — an action returning a row — with
`verifyUserExistsInDb` in `src/dbs/DbsUserManagement.ts`). No `return this` (§5).

Scenario validations belong in test bodies. Teardown may invoke domain lifecycle
cleanup postconditions under [§4a](../../pom-architecture/references/design-conventions.md#4a-test-data-ownership-method-contracts-and-disposable-inputs);
these checks earn no scenario assertion credit. Required cleanup failures must fail
the run while retaining an earlier body failure. Keep independent cleanup/closure
operations in separate hooks when a prior error could otherwise prevent later work.

## 12. Choose the validation layer before writing the method

The 2026-09-01 "validation layer selection" ruling (design-conventions, Decision
records): a validation belongs at the LOWEST layer that can prove it. DB row/state
checks → a `Dbs<Domain>` `verify*` (practice 9); API status/body contracts → an
`Apis<Domain>` `verify*` (practice 8); a GUI `verify*` only for what only the GUI
proves — rendering, navigation, user-visible text and state. Decide the layer before
writing the method; the reuse scan (checklist, first box) then runs against that
layer's class.

❌ Anti-pattern — a GUI verify that re-opens a records list page just to prove a
created record persisted (slow, flaky, and proves persistence only indirectly,
through the list UI):

```ts
await ordersListPage.navigate();
await ordersListPage.verifyOrderAppearsInList(orderId);
```

✅ Correct — the persistence proof sits in the DB layer; the GUI keeps only the
user-visible confirmation the case actually asserts:

```ts
await orderPage.verifyOrderConfirmationMessage(testData.expectedMessages.orderCreatedMsg);
await dbsOrders.verifyOrderExistsInDb(orderId);
```

Relocating a proof never drops or weakens an expected result — every validation
point survives, at the layer that owns it. And when the GUI itself is the subject —
a deliberate E2E journey checkpoint — the check stays a GUI `verify*`: the ruling
moves proofs off the GUI only where the GUI was merely a window onto them.

---

## 13. Every assertion goes through the `Expects` wrappers — self-describing step titles

The 2026-09-08 "Assertion-message facade" ruling (design-conventions, Decision
records): Playwright auto-generates an Allure sub-step per `expect()`, but its default
title is just the matcher name — a value assertion renders as a bare `Expect "toBe"`
with no business subject. Native parameters, errors and artifacts can carry expected
values independently of that title (utility-classes §20). The fix is Playwright's custom
message (2nd `expect` argument), which **replaces** the step title — and the grammar
for it is implemented ONCE, in the generic wrappers of `src/utils/Expects.ts`
(utility-classes §18 owns the facade contract; the package ships it as
`examples/src/utils/Expects.ts`).

**Rule:** every assertion is written as an `Expects` wrapper call with a **business
subject phrase** ("the create-user response status", "the login error message") —
value-carrying matchers AND, per the same-day grammar-completion ruling, the
argument-less state matchers (`expectToBeVisible`/`Hidden`/`Enabled`/`Disabled`,
`expectNotToBeChecked`): one grammar for every assertion title, with Playwright's selector tail kept as the diagnostic layer, delimited by a trailing `→` on locator-backed wrappers (`<business clause> → <selector tail>`; value/page receivers get no tail, hence no delimiter) (`locator.describe()` is rejected — the
raw selector in the title is evidence a description could drift from). Secret-valued expectations use the facade's secret variants (`expectToContainSecretText`,
`expectToHaveSecretValue` — value asserted, never titled; utility-classes §18): business
classes carry NO direct `expect()` at all. `expect.poll` keeps
its own failure-sentence `message` option (it doubles as the timeout text) — the
option is mandatory; its grammar migrates fix-when-touched only.

✅ Canonical — `src/apis/ApisUserManagement.ts` shape after the ruling:

```ts
async verifyUserCreatedSuccessfully(createResponse: APIResponse, expectedStatus: number, confirmationMessage: string) {
  await allure.step(`Verify User Created Successfully with status: ${expectedStatus}`, async () => {
    expectToBe('the create-user response status', createResponse.status(), expectedStatus);
    expectToBe('the response confirmation message', (await createResponse.json()).message, confirmationMessage);
  });
}
// Allure children: "Expect the create-user response status to be 200" /
// "Expect the response confirmation message to be \"User created!\""
```

❌ The pre-ruling form this retires — indistinguishable children (`Expect "toBe"`,
`Expect "toBe"`):

```ts
expect(createResponse.status()).toBe(expectedStatus);
expect((await createResponse.json()).message).toBe(confirmationMessage);
```

Subject-phrase rules: a business noun, never the code expression; the expected value
is interpolated by the wrapper from the same argument the matcher receives (iron
law 5 — so it can never be a smuggled literal), and subjects/values must never carry
secrets (iron law 7 — use the facade's confidential-value variants, which protect the
authored title only; utility-classes §18/§20). Locator wrappers pass the
`Locator` straight through — web-first auto-retry and `{ timeout }` options are
untouched. The maintained `AllureReport.ts` reporter appends Playwright's public
locator parameter after the message; polling count comparisons include both locator
strings explicitly.
Hand-rolled `expect(x, 'msg')` messages are not a substitute — one grammar source, no
drift (enforced warn-level by `check-conventions.mjs` `assertion-message`; per-line
escape: `// conventions-ok`).

## Boundaries

This skill does NOT cover:

- **Test data storage/loading** (JSON structure, `beforeAll` loading, env config,
  enums) → [test-data](../../test-data/SKILL.md)
- **Action methods** (verb naming, action step titles, return policy) →
  [action-methods](../../action-methods/SKILL.md)
- **Locator construction and naming** → [element-locators](../../element-locators/SKILL.md)
- **Page class anatomy** (where the `///// Validations` banner sits in the file) →
  [page-classes](../../page-classes/SKILL.md)
- **Service class anatomy** (query/endpoint constants, facade wiring, `close()`) →
  [service-classes](../../service-classes/SKILL.md)
- **Test-level rules** (≥1 validation per test, title, metadata) →
  [test-methods](../../test-methods/SKILL.md)
- **Facade internals** (attachments, redaction, never-throw contract) →
  [utility-classes](../../utility-classes/SKILL.md)

## Review checklist — validation methods

- [ ] No duplicate of an existing validation's intent — the repo-wide reuse-before-create scan across `pages/`, `apis/`, `dbs/` (case/suffix-tolerant, legacy `assert*`/`assertOn*`/`validate*` included) ran before creating; reuse or extend an existing `verify*` method first (the action-methods practice-8 gate, 2026-08-24 ruling, applies to validations too)
- [ ] Validation layer chosen deliberately (2026-09-01 ruling): the check sits at the lowest layer that can prove it — DB state → `Dbs<Domain>`, API contract → `Apis<Domain>`, GUI `verify*` only for what only the GUI proves; relocated proofs preserve every expected result, and deliberate E2E journey checkpoints stay in the GUI
- [ ] Method name starts with `verify` and states the business condition — no `assert*`, `assertOn*`, or `validate*` in new code; typo'd identifiers fixed together with their call sites
- [ ] Sits last in the class under a single `///// Validations` banner (no `Assertions` banner or plain `//Assertions` comment in new code)
- [ ] Entire body wrapped in one `step()`/`allure.step()` titled `Verify …` with meaningful params interpolated
- [ ] No secrets in the step title
- [ ] GUI checks use awaited web-first assertions (`toBeVisible`, `toHaveText`, `toHaveTitle`, `toHaveURL`, `toHaveCount`) — no `textContent()` + generic expect, no `waitForTimeout`
- [ ] Arrival checks assert `toHaveURL(this.url)` against the page's own `url` field — never a string literal or a test-data URL (the recorded iron-law-5 exception); RegExp when query params vary
- [ ] Text matcher chosen deliberately: `toHaveText` with the full expected string by default; `toContainText` only when the element renders more than the tested value
- [ ] Expected values arrive as explicit operation-sized parameters from the paired JSON/config exception; no defaults/shared constants hiding scenario outcomes and no complete spec-schema dependencies
- [ ] API validations take a typed `APIResponse` (never `any`) and check status + body in one step — including any body-embedded status code, consistently across the class
- [ ] DB validations use the class's `_query` constant with `@param` binding and assert row counts
- [ ] No loops, conditionals, `try`/`catch`, actions, or returned values inside the validation
- [ ] No boolean-collapsed expects or untyped `(p: any)` pre-queries — collection checks use the length / `toContain` / typed-object shapes
- [ ] One business condition per method; related expects grouped, unrelated ones split
- [ ] Every assertion uses an `src/utils/Expects.ts` wrapper with a business subject phrase (`Expect <subject> to <verb>[ <value>]` step title) — state checks included (2026-09-08 grammar-completion ruling); direct `expect()` only for secret-value bypasses with `// conventions-ok`; `expect.poll` carries its failure-sentence `message` option
- [ ] Scenario validations stay in the body; required domain cleanup postconditions may run in teardown and earn no scenario coverage
