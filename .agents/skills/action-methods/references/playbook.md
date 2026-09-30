# Action Methods — Playbook

Depth for writing action methods in `pages/`, `apis/`, and `dbs/` classes.
Builds on [design-conventions](../../pom-architecture/references/design-conventions.md);
that file wins on any apparent conflict.

## 1. Name every action as a camelCase verb phrase stating the business intent

The method name is the API a spec reads — it must say what the user/system does,
not how (design-conventions §2). Start with a verb; use real words, no acronyms.

✅ Real examples: `login()`, `navigate()`, `openSignupPage()` (`src/pages/LoginPage.ts`);
`clickOnCartLink()`, `clickOnProductsLink()` (`src/pages/HeaderPage.ts`);
`createUser()`, `deleteUser()` (`src/apis/ApisUserManagement.ts`);
`getUserByEmail()`, `deleteUserByEmail()` (`src/dbs/DbsUserManagement.ts`).

❌ Anti-patterns: noun names (`userLogin()`), mechanics names (`fillAndClick()`),
abbreviations (`delUsr()`), or names promising more than the body does
(`loginAndVerify()` — see practice 5).

## 2. Wrap the entire body in exactly one Allure step

Iron law §4.6: every action method opens exactly ONE Allure step of its own,
with a business-readable title. The step opens as the first statement and
closes as the last — nothing executes outside it. Composing other public
step-wrapped actions inside that step is sanctioned (settled —
design-conventions, Decision records): their steps nest as sub-steps in
Allure, and that nesting is intended — it is exactly how a composed business
method appears in the report. What stays banned: one method opening two
sibling steps of its own (compose instead), and private helpers opening steps
(pairing rule below). Pages import
`{ step } from 'allure-js-commons'`; service classes use
`import * as allure from 'allure-js-commons'` and `allure.step(...)` — both are
settled forms; match the file you are in.

✅ Canonical (`src/pages/LoginPage.ts`):

```ts
async navigate() {
  await step(`Navigate to Login Page`, async () => {
    await this.page.goto(this.url);
  });
}
```

❌ Legacy violation — `login()` in `src/apis/ApisUserManagement.ts` has no step at
all, so the report shows only the facade's technical `POST /api/verifyLogin`
step — the business intent ('Login via API…') is missing from the step tree:

```ts
async login(email: string, password: string) {
  const response = await this.apiActions.post(this.login_serviceName, {
    form: { email, password }
  });
  return response;
}
```

Canonical repair: wrap the body in `allure.step('Login via API with email: ...')`
and `return await` it (see practice 6). Fix opportunistically when already
touching the file (design-conventions preamble; §4.10 — verify the report after).

The pairing rule for helpers: a method a spec can call is public AND
step-wrapped; a method that exists only to keep a long body readable is
private AND step-less — its work is mechanics of its caller's single step,
and it never opens a step of its own. A piece of flow that deserves its own
step is a public action, composed as above so its step nests as a sub-step.
Never a public step-less action. ❌ (illustrative counterexample `src/pages/SignupPage.ts`) —
`selectCountry(countryName)` is public with no step, its body a bare
`this.page.locator('#country').selectOption({ label: countryName })` —
callable from specs yet invisible in the report.

## 3. Interpolate the meaningful business parameters into the step title — never secrets

A step title should let a reader replay the action from the report. "Meaningful"
means the 1–3 inputs that identify what the action operated on (email, name, id,
quantity) — never the full payload (with a typed-object parameter, practice 11,
interpolate selected fields), and never zero when the action takes
distinguishing inputs: `ApisUserManagement.login()` (practice 2) takes an email,
so its repaired title must carry it. Iron law §4.7: passwords, tokens, and
credentials never appear in step titles, logs, or attachments — redaction lives
in `utils/`, and an interpolated title bypasses it. Payment-card numbers and CVC
are title-secrets too: card data may live in test-data JSON as synthetic
business input ([test-data](../../test-data/SKILL.md)), but never in a title.

✅ Canonical (`src/dbs/DbsUserManagement.ts`) — identifies the row, leaks nothing:

```ts
async deleteUserByEmail(email: string): Promise<number> {
  return await allure.step(`Delete User from DB with email: ${email}`, async () => {
    const { rowsAffected } = await this.dbActions.query(this.deleteUserByEmail_query, { email });
    return rowsAffected[0] ?? 0;
  });
}
```

❌ Known violation, cited by design-conventions §4.7 (`src/pages/LoginPage.ts`) —
the password lands in every Allure report:

```ts
await step(`User Login with: Username: ${username} and Password: ${password}`, async () => {
```

Canonical form: `` `User Login with Username: ${username}` `` — drop the
password entirely (do not print a placeholder that implies the value is shown).

❌ Second violation (`src/apis/ApisUserManagement.ts` `createUser()`) — leaks the
password *and* mislabels the parameters:

```ts
return await allure.step(`Create User Account with name: ${name}, First Name: ${email} and Last Name: ${password}`,
```

Canonical form: `` `Create User Account with name: ${name} and email: ${email}` ``.

❌ Full-payload echo (illustrative counterexample `src/pages/SignupPage.ts`) — `createNewAccount`'s
title interpolates all 13 signup parameters, starting
`` `User Creates New Account With: password: ${password} ,day: ${day} …` `` —
the password leads, and the identifying inputs drown in noise.

❌ Card data in a title (illustrative counterexample `src/pages/PaymentPage.ts`) — `pay()`
interpolates `` `Card Number ${cardNumber}, CVC ${cvc}` `` into every report;
canonical form names only the cardholder.

## 4. Make the step title say exactly what the method does

Copy-paste drift produces reports that lie. When duplicating an action as a
starting point, the title is the first thing to update.

❌ Real bug (`src/pages/HeaderPage.ts`) — the method clicks Contact Us, the report
says Delete Account:

```ts
async clickOnContactUsFormLink(){
      await step("Click on Delete Account Link", async () => {
    await this.contactUsForm_link.click();
  });
}
```

Canonical form: title `"Click on Contact Us Form Link"`. Fix such mismatches
whenever you touch the method — it is a report-facing bug, not a style nit.

❌ Title promising more than the body performs (illustrative counterexample
`src/pages/CheckoutPage.ts`) — `writeComment`'s title claims
`'Enter Description in Comment Text Area and Click on Place and Confirm Order'`
but the body only fills the textarea, so the report asserts a step that never
ran. When an action is split, each half takes its part of the title with it.

❌ Mangled template literals rendering verbatim in Allure (illustrative counterexample) — the
stray brace in `` `Fill in contact us form with data}` ``
(`src/pages/ContactUsFormPage.ts`) and the literal newline mid-title in
`src/pages/PaymentPage.ts` `pay()`. Proofread titles in the report (§4.10).

## 5. No assertions inside action methods

Actions perform; validation methods (prefixed `verify`, placed last under
`///// Validations`) assert. Mixing them makes actions unreusable in negative
tests (a `login()` that asserts success can never test a failed login) and
hides the oracle from the spec. No `expect()` of any kind inside an action —
rely on Playwright's auto-waiting for readiness, not manual visibility checks.
Everything assertion-shaped routes to
[validation-methods](../../validation-methods/SKILL.md).

✅ `LoginPage.login()` only fills and clicks; the spec then calls
`verifyErrorMessage(...)` or `HeaderPage`'s logged-in validation as the test
demands — same action, both polarities.

## 6. Return `Promise<void>` unless the value is genuinely consumed — never `return this`

Design-conventions §5: fluent `return this` chaining is a Java-era pattern,
deliberately dropped. Page actions return nothing (implicit `Promise<void>`).
Service actions return a value only because the test or a validation consumes
it — an `APIResponse`, DB rows, an affected-row count. When returning from
inside a step, return the step itself: `return await allure.step(...)`, and
`return` the value from the step callback, so the value flows through the step
without executing anything outside it.

✅ Value consumed (`src/dbs/DbsUserManagement.ts`):

```ts
async getUserByEmail(email: string): Promise<Record<string, unknown> | undefined> {
  return await allure.step(`Get User from DB with email: ${email}`, async () => {
    const { rows } = await this.dbActions.query(this.selectUserByEmail_query, { email });
    return rows[0];
  });
}
```

✅ No consumer, so void: every action in `src/pages/HeaderPage.ts`.

❌ Returning `this` for chaining; returning a response "just in case" nobody
reads (iron law §4.11 — build only what the current test needs).

## 7. Granularity: one action = one user-visible business service

Model what a user or system does in one intent, not every element interaction
and not whole journeys. `LoginPage.login()` is the calibration point — three
mechanical interactions, one business step:

```ts
async login(username: string, password: string) {
  await step(`...`, async () => {
    await this.loginEmail_Input.fill(username);
    await this.loginPassword_Input.fill(password);
    await this.login_Button.click();
  });
}
```

❌ Too fine: public `fillEmail()` / `fillPassword()` / `clickLoginButton()`
micro-actions — the spec degenerates into element scripting, and no test needs
them individually (one test does not justify a new abstraction).
❌ Too coarse: `loginAndDeleteAccount()` fusing services from two pages —
compose that sequence in the spec, where the flow stays visible
([test-methods](../../test-methods/SKILL.md)).

✅ Folding an incidental confirmation into the action is correct granularity:
in the illustrative counterexample's `src/pages/ProductsPage.ts` the add-to-cart click opens a
modal the method rightly dismisses too — one intent, "add product to cart".
Then the name states the intent, not the first click: `addProductToCart()`,
not the demo's `clickOnAddToCartButton()`, which hides the second interaction.

## 8. Reuse before creating — repo-wide; duplicate intent, not implementation

Before adding ANY action — and the same gate applies to validation methods
(`verify*`), reviewed by the same rule from
[validation-methods](../../validation-methods/SKILL.md) — prove no existing method
already covers the intent
(2026-08-24 ruling — the check is mandatory, repo-wide, and blocking in review):

1. **Scope the search to all three business homes** — `pages/` (the rendering page's
   class first, then skeleton classes like `HeaderPage`), `apis/`, and `dbs/`. The
   reusable surface is every PUBLIC step-wrapped method (practice 2's pairing rule);
   private helpers are not candidates.
2. **Search by intent, tolerantly.** Derive the verb+object stems from the business
   step ("delete the user" → `delete.*[Uu]ser`, "open the cart" → `[Cc]art`), then
   grep case-insensitively across the three folders. Legacy naming coexists with
   canon, so match suffix-tolerantly (`login_Button` vs `login_button`) and include
   legacy `assert*` alongside `verify*`. Parameterized actions count — an existing
   `clickViewProduct(productName)` covers a new product name; no new method needed.
3. **Prefer, in order:** reuse as-is → extend via an optional/default parameter or a
   second intent-named method (practice 9) → create, via the owning skill, only when
   nothing covers the intent.

A second copy of the same intent is redundancy — a blocking review finding
(`duplicate-action-method`). Two intent-named methods over the *same*
mechanics are fine when the business meanings differ: `src/pages/HeaderPage.ts`
deliberately has both `clickOnSignupLoginLink()` and `clickOnLogoutButton()` clicking
`signupLoginLogout_link`, because a spec calling "logout" should read as logout. What
is never fine is two methods with the same name-meaning and diverging bodies.

## 9. Keep logic out of actions

No loops, no conditionals, no `try`/`catch` (iron laws §4.3–4.4). An action is
a straight-line sequence of awaited calls. If a variant is needed, prefer an
optional/default parameter or a second intent-named method (§5, overloading
row) over an `if`. Anything genuinely complex — retries, polling, branching on
environment — belongs in `utils/`
([utility-classes](../../utility-classes/SKILL.md)). Let failures fail: the
Playwright error plus the Allure step already tell the story.

## 10. Business data enters as parameters — none is hardcoded inside the action

An action receives what varies as arguments; the spec feeds it from the paired
JSON/config/enums (iron law §4.5; ownership in
[test-data](../../test-data/SKILL.md)).

❌ Legacy violation (`src/apis/ApisUserManagement.ts` `createUser()`): the body
hardcodes `firstname: 'Mahmoud'`, `company: 'Giza Systems'`, `country: 'India'`,
a mobile number, and more. Canonical form: take a typed user-details object (or
individual parameters) fed from `resources/testData/`, with fixed option lists
(like `title: 'mr'`) as enums.

## 11. Cap positional parameters at ~4 — a bigger form takes one typed object

Positional strings past a handful are swap bugs waiting to compile. An action
with more than ~4 inputs takes ONE typed object (an `interface`, fixed option
lists as enums per design-conventions §2), destructured in the body — call
sites read as named fields, and a field swap becomes a compile error.

❌ (illustrative counterexample `src/pages/SignupPage.ts`) — 13 positional strings; a call site
that swaps `state` and `city` still compiles and runs:

```ts
async createNewAccount(password: string, day: string, month: string, year: string, firstName: string, lastName: string, company: string, address: string, countryName: string, state: string, city: string, zipCode: string, mobileNumber: string) {
```

✅ Canonical shape: `async createNewAccount(details: AccountDetails)` with
`const { firstName, lastName, city, ... } = details;` opening the step body,
fed from the paired JSON (practice 10).

## 12. Use the verb the control is built for

Dropdown → `selectOption(...)` (value from test data or an enum). Checkbox and
radio → `check()` / `uncheck()`, which are idempotent. Hover only when the UI
genuinely requires it before the real action; `press()` is a last resort.

❌ (illustrative counterexample `src/pages/SignupPage.ts`) toggles checkboxes with `.click()` —
so a retry of the action toggles the box back off; `check()` is safe to repeat.

No inline locators inside action bodies — `selectCountry` (practice 2) hides
`page.locator('#country')` in its body; locators are fields or dynamic locator
methods ([element-locators](../../element-locators/SKILL.md)).

## 13. Handle a native dialog inside the same action, with `once`

When a click triggers a native dialog (alert/confirm), the same action handles
it: register `this.page.once('dialog', dialog => dialog.accept())` as the first
statement inside the step, BEFORE the triggering interaction, and state it in
the title — `'Submit contact us form and accept the confirmation alert'`.
Always `once`, never `on`.

❌ (illustrative counterexample `src/pages/ContactUsFormPage.ts`) — `submitContactUsForm()`
registers `this.page.on('dialog', ...)` before the click: a persistent
accept-all listener that stacks another copy on every call and silently
swallows every later dialog on the page.

## 14. File uploads: one step, file NAME in the title, path from test data

A file upload is a business action wrapping `locator.setInputFiles(filePath)`
in one step. The title interpolates the file NAME — never the machine-specific
path — and the path arrives as a parameter fed from test data, where fixture
files are owned ([test-data](../../test-data/SKILL.md)). ✅ Canonical shape:
`` await step(`Upload file '${path.basename(filePath)}' in contact us form`, ...) ``
wrapping `this.file_input.setInputFiles(filePath)`.

❌ (illustrative counterexample `src/pages/ContactUsFormPage.ts`) — the title
`` `Upload file in contact us form}` ``: a stray brace rendering verbatim in
Allure, and no file name, so no run is distinguishable from another.

## 15. Scrolls are step-wrapped actions like any other

A scroll a test depends on is a business action with a business title. Prefer
`await targetElement.scrollIntoViewIfNeeded()` on a real locator;
`page.evaluate(() => window.scrollTo(...))` only for viewport-level scrolls
with no target element — the canonical shape is `src/pages/HeaderPage.ts`
`scrollToHeader()`: `window.scrollTo(0, 0)` inside `step('Scroll to Header', ...)`.

❌ (illustrative counterexample `src/pages/FooterPage.ts`) — `scrollToFooter()` is public and
step-less: invisible in the report for the very tests that verify scrolling.

## 16. Hygiene: spacing and JSDoc restraint

One empty line between methods (iron law §4.12) — `src/pages/HeaderPage.ts` is
missing it between `clickOnDeleteAccountLink()` and `clickOnContactUsFormLink()`;
add it when touching the file. Do not JSDoc an action whose name already carries
the meaning (`clickOnCartLink()` needs nothing). Document only a genuine
contract the name cannot express — the model is
`src/dbs/DbsUserManagement.ts`:

```ts
/** Closes the underlying connection pool — call from afterAll/afterEach. */
async close(): Promise<void> {
```

(The afterEach mention is legacy drift — pools close in `afterAll` only, per
[test-classes](../../test-classes/SKILL.md); fix the wording when touching the file.
The quote stays as the JSDoc-restraint example: one line, a contract the name
cannot carry.)

## Boundaries

This skill does NOT cover:

- Validation methods (`verify*`, `expect` usage, web-first assertions) →
  [validation-methods](../../validation-methods/SKILL.md)
- Class anatomy: field order, `///// Actions` banner placement, constructors,
  when a new page class is justified →
  [page-classes](../../page-classes/SKILL.md)
- Locator strategy, naming, and dynamic locator methods →
  [element-locators](../../element-locators/SKILL.md)
- `Apis<Domain>`/`Dbs<Domain>` structure, endpoint/query constant fields,
  parameterized queries → [service-classes](../../service-classes/SKILL.md)
- Step/attachment plumbing, redaction, never-throw contracts in `utils/` →
  [utility-classes](../../utility-classes/SKILL.md)
- Test data files and environment config →
  [test-data](../../test-data/SKILL.md)

## Review checklist — action methods

- [ ] Name is a camelCase verb phrase stating the intent, not the first click (§2)
- [ ] Entire body wrapped in exactly one Allure step of its own; nothing
      executes outside it; sub-steps come only from composed public actions
      (intended nesting) — never two sibling steps opened by one method
- [ ] Public ⇔ step-wrapped; private helper ⇔ step-less — no public step-less
      action, no step-opening private helper
- [ ] Step title reads as a business step, matches what the body does, and
      interpolates the 1–3 identifying business parameters — never the full
      payload, never none when the action takes distinguishing inputs
- [ ] No secrets (passwords, tokens, payment-card numbers/CVC) anywhere in the
      step title; upload titles carry the file name, never the path
- [ ] Zero `expect()` calls — assertions live in `verify*` validation methods
- [ ] Returns `Promise<void>` unless a consumer exists; value returned via
      `return await allure.step(...)`; never `return this`
- [ ] Granularity is one user-visible service — neither element micro-actions
      nor multi-page mega-flows
- [ ] No duplicate of an existing action's intent — repo-wide search across `pages/`,
      `apis/`, `dbs/` done before creating (case/suffix-tolerant, legacy names
      included); no loops/conditionals/try-catch
- [ ] All business data arrives as parameters — nothing hardcoded in the body
- [ ] At most ~4 positional parameters — a bigger form takes one typed object
      (enums for fixed option lists)
- [ ] Right verb per control: `selectOption`, `check()`/`uncheck()` — never
      click-toggling a checkbox; scrolls prefer `scrollIntoViewIfNeeded()` on a
      real locator; no inline locators in action bodies
- [ ] Native dialogs handled via `page.once` inside the same step, before the
      trigger, and stated in the title
- [ ] Blank line before the method; JSDoc only where the name cannot carry the
      contract
