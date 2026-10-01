# Test Methods — Playbook

## Local source identity (M13)

For neutral local sources, use `allure.testCaseId(localScenarioId)` instead of inventing a TMS link. For an actual external test case, preserve `allure.tms`. The M13 source binding maps each generated test and validation to its original expectation. The metadata identity must match that binding.

Rules for the content of one `test(...)` block. The spec-file skeleton around it
(imports, `let` state, hooks) belongs to [test-classes](../../test-classes/SKILL.md).
All section references (§) point to
[design-conventions](../../pom-architecture/references/design-conventions.md).

---

## 1. One test, one focus

**Rule:** Each test verifies exactly one behavior or business outcome. The only
exception is a deliberate end-to-end journey, where one test may chain several
business steps and validations across layers (GUI + API + DB) — but it is still *one*
journey with one reason to fail conceptually.

**Why:** A failing test should name the broken behavior without archaeology.

✅ Single-focus negative test — `tests/LoginTests.spec.ts`:

```ts
test('Test Case 3: Login User with incorrect email and password', async () => {
  allure.feature('Automation Exercise Login Test Cases');
  allure.tms('137183053');
  // allure.issue('#link');

  await homePage.navigate();
  await headerPage.clickOnSignupLoginLink();
  await loginPage.login(testData.invalidEmail, testData.invalidPassword);
  await loginPage.verifyErrorMessage(testData.errorMessages.incorrcetEmailAndPasswordMsg);
});
```

✅ E2E exception — `Test Case 2` in the same file is one journey (login → verify
logged in → delete account via API → verify deletion) with multiple validations along
the way. That is allowed; three unrelated scenarios stuffed into one test is not.

✅ Long-journey shape worth adopting — (illustrative counterexample)
`Test Case 14: Place Order: Register while Checkout` chains 13 business calls as ONE
journey with a checkpoint validation after each irreversible leg — account created
(`assertTextAccountCreatedIsVisiable`), logged in (`assertUserLoggedinSuccessfully`),
address correct (`assertOnAddressDetails`), payment confirmed — and closes with the
business outcome (`assertSuccessPaymentMessage(testData.orderPlacedMessage)`). A
failure names the leg that broke. Litmus: if you can describe two independent reasons
the test exists, it is two tests.

❌ Anti-pattern: one test that checks valid login, then invalid login, then logout —
three behaviors, three tests.

## 2. The title is the test's documentation

**Rule:** The test title is a descriptive sentence of what is verified, optionally
prefixed `Test Case N:` when the team's numbered catalog applies. Never a bare id, a
method-style name, or a vague label. Per §5, the Java `@Test(description = …)` maps to
the Playwright title itself, with the JIRA/story id inside the title when applicable.

**Why:** The title is what Allure, the HTML report, and `--grep` show — it must carry
meaning on its own.

✅ `tests/LoginTests.spec.ts`:

```ts
test('Test Case 2: Login User with correct email and password then delete user account', async () => {
```

❌ Anti-patterns: `test('TC2', …)`, `test('loginTest', …)`, `test('WFDT-1234', …)`
(traceability belongs in `allure.tms`, not as the whole title — §5).

❌ Channel/layer markers in titles — (illustrative counterexample) `'Test Case 8: (Ui & Api) Verify
All Products and Product detail page'`, `'Test Case 1:UI Create New Account'`,
`'Test Case 4: Logout User via UI&API'` — three invented formats in one repo. The
title states the business behavior; the layers are visible from the body's calls; a
filterable channel is a tag (practice 9), never title punctuation.

## 3. Allure metadata opens the body

**Rule:** The first lines inside every test body are the Allure metadata calls, in
this order: `allure.feature(…)` (matching the `test.describe` title), `allure.tms('<id>')`
for the tracked test-case id, and `allure.issue('<id>')` only when a real bug link
exists (keep the commented placeholder otherwise, as the project does). Add
`allure.epic()` / `allure.story()` only when the tracking hierarchy actually uses them
(§5). Import as `import * as allure from 'allure-js-commons';`.

**Why:** Metadata placed first is never skipped by an early failure, and the tms ids
resolve into links via the `nameTemplate`/`urlTemplate` configured under the
`allure-playwright` reporter in `playwright.config.ts`; the `issue` template is a
commented-out placeholder there — uncomment and fill it the first time a real
`allure.issue()` link is added:

```ts
links: {
  tms: {
    nameTemplate: 'Test: #%s',
    urlTemplate: 'https://dev.azure.com/your-org/your-project/_workitems/edit/%s'
  },
  // ...
},
```

✅ `tests/LoginTests.spec.ts`:

```ts
allure.feature('Automation Exercise Login Test Cases');
allure.tms('137183022');
// allure.issue('#link');
```

**One `tms` id per test**, pointing at that test's own tracked case — never copy a
`tms` line from another test without replacing the id. ❌ (illustrative counterexample) all three
Signup tests share `allure.tms('137182787')`, and a commented-out test in
`tests/ProductQuantityTests.spec.ts` still carries `allure.tms('137183022')` — the
login suite's id, copied and never replaced. (Team ruling — design-conventions,
Decision records:) one id never appears on two tests — tests that decompose one
tracked case each get their own minted case id. The sanctioned exception runs the
other way: a big E2E journey covering several tracked cases carries **multiple
`allure.tms()` calls, one per covered case** — each rendering its own link in the
report, and each honest only if the journey's checkpoint validation for that case
exists (practice 1's E2E note). A second sanctioned exception (2026-08-24, per-case
data ruling): the sibling tests generated from ONE parameterized ADO case's data
rows share that case's single tms id — they are one tracked case executed per row,
composing from the row array inside that case's `tc<id>` data cluster.

❌ Feature drift catalog — `feature` and the `describe` title must match; fix
whichever side is wrong:

- Feature disagreeing with the describe title after a copy-paste — (illustrative counterexample)
  `tests/TestCasePageTest.spec.ts` sets `allure.feature('Automation Exercise Test
  Case Page')` under a `describe` still titled `'Automation Exercise Login Test Cases'`.
- Different feature strings per test inside one describe — (illustrative counterexample)
  `tests/SubscriptionTests.spec.ts` splits `'Email Subscription - Home Page'` /
  `'Email Subscription - Cart Page'`, shattering the suite across Allure groups.
- A test missing `allure.feature` entirely, landing ungrouped — (illustrative counterexample)
  `'Test Case 2:API Create user account'` in `tests/SignupTests.spec.ts`.

**Legacy note:** `tests/User Management/DbUserManagementTests.spec.ts` sets `allure.feature` but no
`allure.tms` — it is a marked example spec (`test.describe.skip`). New tests set both
`feature` and `tms` (§6 checklist).

## 4. The body is business-method calls only

**Rule:** Every statement after the metadata is an `await` on an intent-named method
of a page class (`pages/`), `Apis<Domain>` (`apis/`), or `Dbs<Domain>` (`dbs/`) —
plus the minimal `const` glue of practice 6. No `page.locator()`, no `page.goto()`
with raw URLs, no `request.fetch()`, no `expect()` calls, no loops, no `if`, no
`try`/`catch` (§1 "Specs orchestrate, never implement"; §4 iron laws 3 and 4).

**Why:** The test reads as the business scenario; mechanics live one layer down where
they are step-wrapped and reusable.

✅ `tests/LoginTests.spec.ts` — every line is a business call:

```ts
await homePage.navigate();
await headerPage.clickOnSignupLoginLink();
await loginPage.login(email, testData.password);
await headerPage.assertUserLoggedinSuccessfully(testData.username);
```

❌ Anti-pattern in a test body:

```ts
await page.locator('[data-qa="login-button"]').click();   // locator leaked out of its page class
if (await errorMsg.isVisible()) { … }                     // conditional in a spec
expect(response.status()).toBe(200);                      // raw assertion — belongs in a verify* method
```

If the business method you need doesn't exist yet, create it in the right class per
[action-methods](../../action-methods/SKILL.md) /
[validation-methods](../../validation-methods/SKILL.md) — but only for the current
test's need (§4 iron law 11: one test does not justify a speculative abstraction).

## 5. At least one validation, expressed as a `verify*` call

**Rule:** Every test ends its logical arc with at least one validation-method call
(§4 iron law 9). Validations are business methods too — the spec calls
`loginPage.verifyErrorMessage(…)`, never inline `expect()`.

**Why:** A test without an oracle proves nothing; an inline `expect` hides the check
from the Allure step timeline.

✅ Canonical: `await loginPage.verifyErrorMessage(testData.errorMessages.incorrcetEmailAndPasswordMsg);`
and the DB shape from `tests/User Management/DbUserManagementTests.spec.ts`:

```ts
await dbsUserManagement.deleteUserByEmail(email);
await dbsUserManagement.verifyUserNotInDb(email);
```

**Legacy note:** `headerPage.assertUserLoggedinSuccessfully(…)` and
`apisUserManagement.assertDeleteUserSuccess(…)` in `tests/LoginTests.spec.ts` are
`assert*`-named legacy validations (§5: `verify*` is canon). Call methods by their
current names; rename to `verify*` only when already touching that class, per
[validation-methods](../../validation-methods/SKILL.md).

## 6. Consume return values only when a later call needs them

**Rule:** Declare a `const` in the test body only to pass a value from one business
call into another (an `APIResponse`, a composed unique email). Business methods return
`void` unless the value is genuinely consumed (§5) — so a test never holds a value it
doesn't use. Glue passes values, it never invents or transforms them — the only
sanctioned composition is the unique-suffix idiom of practice 7.

✅ `tests/LoginTests.spec.ts` — both constants are consumed downstream:

```ts
const email = testData.emailAddress + timestamp + '@example.test';
…
const deleteResponse = await apisUserManagement.deleteUser(email, testData.password);
await apisUserManagement.assertDeleteUserSuccess(deleteResponse, testData.deletedAccountExpectedMessage);
```

❌ Anti-patterns: an unused `const user = …`; and debug output in a spec —
`console.log('User row from DB:', user);` in `tests/User Management/DbUserManagementTests.spec.ts` is
example-only, not canon. Evidence belongs in Allure steps/attachments produced by the
lower layers, not stdout.

❌ Invented and transformed values — literals include numbers: (illustrative counterexample)
`await productsPage.clickViewProduct(1);` hardcodes the index; (illustrative counterexample)
`addProductQuantity(parseInt(testData.displayedQuantity))` — a `parseInt` in a body
means the JSON stored the wrong type, fix the data file; and each ProductQuantity
test declares a `const randomEmail = …` that no call ever consumes.

## 7. Independent, parallel-safe, unique per-case and per-run data

**Rule:** Every test must pass when run alone (`-g "<its title>"`), in any order, in
parallel, and repeatedly (§4 iron law 8 — `playwright.config.ts` sets
`fullyParallel: true` and up to 3 workers, with `retries: 2` on CI, and the
automate-suite VERIFY phase requires two consecutive green runs). Never depend on
another test's side effects. A record-creating test seeds its own record at the top of
its body from its own `tc<id>` data cluster — TC id in the base value, the module-level
timestamp appended (2026-08-24 rulings; composition rules →
[test-data](../../test-data/SKILL.md)) — and cleans up what it creates. No test ever
reads a sibling case's cluster or record.

✅ Per-case composition — the case's own base plus the shared timestamp:

```ts
const timestamp = new Date().toISOString().replace(/[-T:.]/g, "").slice(0, 17);
…
const email = testData.tc1001.email + timestamp + '@example.test';
…
const deleteResponse = await apisUserManagement.deleteUser(email, testData.tc1001.password);
```

(`tests/LoginTests.spec.ts` still composes from a shared file-level base seeded in
`beforeEach` — pre-ruling legacy; migrate to per-case clusters when next touching it.)

❌ Anti-pattern: `Test Case 3` assuming the account from `Test Case 2` still exists,
two tests composing from the same base key, or asserting on a fixed email that a
parallel worker is mutating.

## 8. No hardcoded inputs or expected values in the body

**Rule:** Every input and every expected value the test passes into an action or
validation comes from the paired JSON test-data object (loaded in `beforeAll`),
`src/config/`, or an enum — never a string literal in the test (§4 iron law 5).

✅ `tests/LoginTests.spec.ts` feeds even the expected error text from data:

```ts
await loginPage.verifyErrorMessage(testData.errorMessages.incorrcetEmailAndPasswordMsg);
```

backed by `resources/testData/LoginTestJsonFile.json`:

```json
"errorMessages": {"incorrcetEmailAndPasswordMsg":"Your email or password is incorrect!"}
```

**Legacy note:** `const email = 'someuser@example.test';` in
`tests/User Management/DbUserManagementTests.spec.ts` is a hardcoded literal in a marked example spec —
do not copy it. Canonical form reads the value from that spec's own
`<Feature>TestJsonFile.json`. File shape and clustering rules →
[test-data](../../test-data/SKILL.md).

## 9. Tag tests for group runs

**Rule:** When a test belongs to an execution group, use Playwright tags in the
test's details object — the §5 mapping of Java `@Test(groups = …)`. The vocabulary
is CLOSED (Decision records, 2026-08-21): `@smoke` (critical-path subset, every
build) and `@regression` (full functional sweep); a new tag requires a new ruling,
never an ad-hoc invention. Run them with `--grep @smoke`.

✅ Canonical form (no tagged tests exist in the project yet — this is the settled
syntax for `@playwright/test` ^1.62 when the need arises):

```ts
test('Test Case 2: Login User with correct email and password then delete user account',
  { tag: ['@smoke'] }, async () => {
```

❌ Anti-patterns: encoding the group into the title (`test('SMOKE - login…')`), or
maintaining separate spec files per suite.

## 10. Keep the scenario visible

**Rule:** Setup, action, and oracle must all be readable inside the test body in
order: navigate/arrange calls, the action under test, then validations. The arrange
leg is included — every GUI step of the journey (navigation, clicks, form fills) lives
in the test body; hooks prepare only invisible state through the API/DB layers (§4
iron law 8: lower-layer seeding is faster and far less flaky). Don't hide the action
under test inside a hook, and don't add helper functions inside the spec file — a
shared arrange sequence that lives within ONE page collapses into one intent-named
business method on that page class (or an API/DB precondition method), called at the
top of each test body, never a local function. A shared multi-page prefix stays as
repeated business calls at the top of each test body — never fused into one method
(granularity limits → [action-methods](../../action-methods/SKILL.md) practice 7).
Settled (design-conventions, Decision records): a precondition with NO API/DB path at
all (e.g. a cart only fillable through the UI) may be established in `beforeEach` as
assertion-free business calls — full rule in the
[test-classes](../../test-classes/SKILL.md) playbook, practice 7. Anything the test
itself verifies still belongs in the body.

**Why:** A reader (and the Allure step list) should reconstruct the scenario from the
test body alone. Test Case 3 above is the model: navigate → open login → act → verify,
four lines, zero indirection.

❌ (illustrative counterexample) `tests/PlaceOrderRegisterWhileCheckoutTests.spec.ts` walks half the
journey in `beforeEach` — `homePage.navigate()` → `clickViewProduct` →
`clickOnAddToCartButton` → … → `cartPage.clickOnProceedToCheckout()` — so the Allure
timeline for Test Case 14 starts at a checkout modal with no visible cause, and an
arrange failure reports as a hook error instead of a test failure.

## 11. Variants stay together

**Rule:** When two tests share the same arrange and the same oracle and differ in one
action or entry point, they are sibling tests in one `describe` with one paired data
file — the titles carry the variant. Never fork a near-identical spec+data file per
variant; one file per feature is the [test-classes](../../test-classes/SKILL.md) rule.

**Why:** Forked variants drift independently — a fix lands in one copy, and every
shared value is maintained twice.

❌ (illustrative counterexample) `tests/ScrollUpWithArrow.spec.ts` vs `tests/ScrollUpWithoutArrow.spec.ts`
— identical 5-line bodies except one call (`footerPage.clickArrowScrollToHeader()` vs
`headerPage.scrollToHeader()`), backed by two byte-identical single-key data files.
The titles already carry the variant (`with "Arrow" button` / `without "Arrow"
button`), so the fork buys nothing. Canonical form: one `ScrollUpTests.spec.ts`, two
sibling tests, one data file.

---

## Boundaries

This skill does NOT cover:

- **Spec skeleton & hooks** — `test.describe` blocks, `let` declarations,
  `beforeAll`/`beforeEach` seeding, `afterEach`/`afterAll` cleanup, file naming →
  [test-classes](../../test-classes/SKILL.md)
- **Inside `verify*` methods** — web-first assertions, step titles, placement →
  [validation-methods](../../validation-methods/SKILL.md)
- **Inside action methods** — step wrapping, parameter interpolation, secrets →
  [action-methods](../../action-methods/SKILL.md)
- **Test data files & environment data** — JSON shape, config, enums, secrets →
  [test-data](../../test-data/SKILL.md)
- **Locators** (a test never sees one) →
  [element-locators](../../element-locators/SKILL.md)

## Review checklist — test methods

- [ ] One behavior per test (or one explicit E2E journey), never bundled scenarios
- [ ] Title is a descriptive sentence; `Test Case N:` prefix where the catalog applies; no channel/layer markers (`(Ui & Api)`)
- [ ] `allure.feature(…)` + `allure.tms('<id>')` are the first lines of the body; feature matches the `describe` title; tms id(s) are the test's own — one per test, or one per covered case in an E2E journey; never shared across tests (data rows of one parameterized case share theirs by design)
- [ ] Body contains only business-method calls — no locators, `expect`, loops, `if`, or `try`/`catch`
- [ ] Every GUI step of the verified journey is in the test body — hooks prepare only invisible state via API/DB (GUI only when no lower-layer path exists — test-classes playbook practice 7)
- [ ] At least one validation call, positioned to close the scenario's arc
- [ ] Local `const`s exist only to pass values between business calls — never invented or transformed; no `console.log`
- [ ] Inputs and expected values all come from `testData` / config / enums — zero literals, numbers included
- [ ] Test passes alone (`-g` its title), in parallel, on CI retry, and twice in a row: per-case data from its own `tc<id>` cluster (TC id in the base value + module timestamp), cleans up what it creates, never touches a sibling case's data
- [ ] Variants of one behavior are sibling tests in one `describe` with one data file — no forked near-identical specs
- [ ] Group membership expressed via `{ tag: [...] }`, not the title
