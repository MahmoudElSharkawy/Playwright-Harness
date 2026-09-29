# Spec File Skeleton — Playbook

The living style references are `tests/LoginTests.spec.ts` (UI + API spec) and
`tests/User Management/DbUserManagementTests.spec.ts` (DB spec). Start every new spec from the closest
existing sibling — reuse before creating.

## 1. Name the file `<Feature>Tests.spec.ts` and give it exactly ONE `test.describe`

One feature per file, one describe block per file, in `tests/`. The describe title is
the business feature name — the same string the tests pass to `allure.feature()`.

**Folder placement:** when specs are grouped by suite or initiative, they live one
folder deep under `tests/`, the folder named EXACTLY like the grouping it represents
(spaces kept; quote the path in shell commands) — `tests/<Suite Folder>/<Feature>Tests.spec.ts`.
Every test in a nested spec carries `allure.epic('<folder>')` directly above its
`allure.feature()` so the Behaviors tab nests Epic > Feature > tests (design-conventions,
2026-09-14 ruling). A repo with no suite/initiative grouping yet correctly keeps specs
flat at `tests/<Feature>Tests.spec.ts` — the folder appears on first need, same as any
other layer (iron law 11).

✅ `tests/LoginTests.spec.ts`:

```ts
test.describe('Automation Exercise Login Test Cases', () => {
```

❌ Naming the file after a JIRA story (`WFDT_1234.spec.ts`) — that is the Java-era rule,
deliberately replaced (design-conventions §5): traceability lives in `allure.tms('<id>')`
and the test title, not the file name.

❌ Two `test.describe` blocks in one file, or tests outside the describe. If a second
feature emerges, it gets its own `<Feature>Tests.spec.ts` and its own paired JSON.

The converse holds too: **one file per feature**. If two spec files would carry the
same describe title, they are one feature — merge them. Differing per-scenario
preconditions never justify a file fork; preconditions vary per test, in the test flow.
❌ (illustrative counterexample) FOUR specs carry the byte-identical title
`'Automation Exercise Place Order Test Cases'` — three `PlaceOrder*` files plus a
copy-paste in `ProductsAndDetailsTests.spec.ts`.

❌ Naming drift (illustrative counterexample), with the corrected forms:

- `LogoutTest.spec.ts` (singular) → `LogoutTests.spec.ts`
- `AddressDetailsInCheckoutPage.spec.ts` (suffix dropped) → `AddressDetailsTests.spec.ts`
- `ScrollUpWithArrow.spec.ts`, `PlaceOrderLoginBeforeCheckout.spec.ts` (scenario name as
  file name) → `ScrollUpTests.spec.ts`, `PlaceOrderTests.spec.ts` — scenarios are test
  titles inside the feature's one file
- `TestCasePageTest.spec.ts` (page name + singular) → `TestCasesPageTests.spec.ts`

Every spec that consumes data pairs with one JSON file named after it:
`LoginTests.spec.ts` ↔ `resources/testData/LoginTestJsonFile.json`. File shape and
content rules → [test-data](../../test-data/SKILL.md).

## 2. Import in a fixed, minimal order

Playwright first, then Allure, then business classes (pages → apis → dbs → config),
then Node built-ins. Import only what this spec uses.

✅ `tests/LoginTests.spec.ts` (verbatim):

```ts
import { test, Page, BrowserContext } from '@playwright/test';
import * as allure from 'allure-js-commons';
import { LoginPage } from '../src/pages/LoginPage'
import { HeaderPage } from '../src/pages/HeaderPage';
import { HomePage } from '../src/pages/HomePage';
import { ApisUserManagement } from '../src/apis/ApisUserManagement';
import * as fs from 'fs';
```

A DB-only spec is smaller — `tests/User Management/DbUserManagementTests.spec.ts` imports just `test`,
`allure`, `DbsUserManagement`, and `databases` from `src/config/databases.ts`.

❌ Importing `expect` into a spec. Assertions live in validation methods on
page/service classes ([validation-methods](../../validation-methods/SKILL.md)); a spec
calls `verify*` methods, it never asserts directly.

## 3. Declare shared state as module-level `let`, in layer order

Between the imports and the describe block: browser plumbing first, then page objects,
then service objects, then `testData`. Hooks assign; tests only read.

✅ `tests/LoginTests.spec.ts` (verbatim):

```ts
let context: BrowserContext;
let page: Page;

let loginPage: LoginPage;
let homePage: HomePage;
let headerPage: HeaderPage;
let apisUserManagement: ApisUserManagement;

let testData: any;
```

❌ Instantiating page objects inside a test body, or passing `page` around as a test
parameter — the hooks own construction so every test starts from identical state.
Service objects are no exception: ❌ (illustrative counterexample)
`const apisUserManagement = new ApisUserManagement(request)` inside a test body
(`LogoutTest.spec.ts`; `SignupTests.spec.ts` does the same as `apiUserManagement`) —
`beforeEach` receives the same `{ request }` fixture a test would, so hooks own ALL
construction.

When a spec holds many page objects, keep the module-level declaration list and the
`beforeEach` instantiation list in the same order — user-journey order preferred — so
the two lists diff cleanly. ✅ (illustrative counterexample) `PlaceOrderRegisterWhileCheckoutTests.spec.ts`
declares and instantiates its ten page objects in matching order.

## 4. Compute the uniqueness discriminator ONCE, at module level

The per-run uniqueness discriminator (the `timestamp` const in `tests/LoginTests.spec.ts`)
is computed a single time as a module-level `const` so that every consumer in the file
shares one discriminator and composes reproducible values. Per-case uniqueness is the
JSON's job, not the timestamp's (2026-08-24 ruling): each record-creating test composes
from its OWN `tc<id>` cluster base (TC id inside the value) plus the one shared
timestamp — no two tests ever compose the same value, and a re-run never collides with
a previous run's leftovers. The pre-ruling form — per-test flat base keys (illustrative counterexample
`SignupTests.spec.ts`: `emailAddress`, `emailAddressAPI`, `emailAddressForLogin`, each
composed with the one shared timestamp) — migrates to `tc<id>` clusters when touched.
Why and how the uniqueness pattern works → [test-data](../../test-data/SKILL.md).

❌ Generating the timestamp inside `beforeEach` or inside a test — seeder and consumer
would disagree and the test becomes order-dependent.

❌ (illustrative counterexample) Varying the constant part instead: `SubscriptionTests.spec.ts` keeps one
base key and splits its two tests via `+ '@example.test'` / `+ '@test2.com'` — per-test
variation belongs in the JSON base keys, not in string literals across test bodies.

❌ (illustrative counterexample) A test body assigning module state a hook later consumes:
`PlaceOrderRegisterBeforeCheckout.spec.ts` declares `let email`, assigns it inside the
test, and `afterEach` calls `deleteUser(email, ...)` — failing before the assignment
leaves teardown deleting stale or `undefined` data. Hooks assign, tests only read
(practice 3).

## 5. Tests first, hooks grouped at the bottom — project canon

Inside the describe block, write the `test(...)` blocks first, then all hooks together
at the end in lifecycle order (`beforeAll`, `beforeEach`, `afterEach`, `afterAll`).
Both project specs follow this layout; a reader meets the business flows before the
plumbing.

✅ Shape of `tests/LoginTests.spec.ts`:

```ts
test.describe('Automation Exercise Login Test Cases', () => {

  test('Test Case 2: ...', async () => { /* business calls */ });

  test('Test Case 3: ...', async () => { /* business calls */ });

  test.beforeAll(async () => { /* data load */ });

  test.beforeEach(async ({ request, browser }) => { /* seed + fresh context + POs */ });

  test.afterEach(async () => { /* context.close() */ });

});
```

❌ Hooks-first layout (the Playwright docs default). It is not wrong Playwright — it is
not this project's canon. When editing an existing spec, keep its layout.

## 6. `beforeAll` — load test data and init connection-holding services, nothing else

Runs once per worker. Two legitimate jobs:

**a) Load the paired JSON** — ✅ `tests/LoginTests.spec.ts` (verbatim):

```ts
test.beforeAll(async () => {
  testData = JSON.parse(fs.readFileSync('./resources/testData/LoginTestJsonFile.json', 'utf8'));
});
```

That path is CWD-relative by canon — which makes **running from the repo root
mandatory**: `npx playwright test` from any subdirectory breaks every spec's data
load. Scripts, CI steps, and pipeline phases must always invoke Playwright from the
repo root.

**b) Init services that hold long-lived connections** (a DB pool outlives any single
test) — ✅ `tests/User Management/DbUserManagementTests.spec.ts` (verbatim):

```ts
test.beforeAll(async () => {
  dbsUserManagement = new DbsUserManagement(databases.applicationDb);
});
```

❌ Creating browser contexts, seeding data, or instantiating page objects in
`beforeAll` — anything per-test belongs in `beforeEach` (practice 7). Validations and
Allure metadata are banned in every hook → practice 10.

## 7. `beforeEach` — seed case-agnostic state via API, then fresh context/page, then page objects

Three responsibilities, in this order: (1) seed **case-agnostic** prerequisite data
through a business API method — a precondition every test in the file needs
identically; (2) open a **fresh** `BrowserContext` and `Page`; (3) instantiate the page
objects on that page. Services wrapping the per-test `request` fixture are also
constructed here (unlike DB services — see practice 6). A **case-specific** record
(composed from that case's `tc<id>` cluster) is seeded at the top of the owning test
body instead, with the same API/DB business methods — hooks never branch on which test
is running (2026-08-24 per-case ruling; data ownership →
[test-data](../../test-data/SKILL.md)).

✅ `tests/LoginTests.spec.ts` (verbatim; **legacy note:** this hook seeds one shared
record for every test from a shared base — pre-ruling canon. The wiring order and the
business-method call are still the model; migrate the seeding itself to per-case
test-body calls when next touching the file):

```ts
test.beforeEach(async ({ request, browser }) => {
  apisUserManagement = new ApisUserManagement(request);
  await apisUserManagement.createUser(testData.username, testData.emailAddress + timestamp + '@example.test', testData.password)

  context = await browser.newContext();
  page = await context.newPage();
  loginPage = new LoginPage(page);
  homePage = new HomePage(page);
  headerPage = new HeaderPage(page);
});
```

Note the seeding goes through `ApisUserManagement.createUser(...)` — a business method.
❌ Raw `request.post('/api/createAccount', ...)` in a hook: specs never touch the HTTP
layer (design-conventions §1). Prerequisites and data preparation run through the
API/DB layers whenever a path exists (iron law 8). Settled (design-conventions,
Decision records): when NO lower-layer path exists (e.g. a cart only fillable through
the UI), `beforeEach` may establish the shared precondition as assertion-free
business-method calls after the page objects are constructed — compressed into ONE
composed intent-named method on the owning page class when the calls live within one
page and run longer than a couple of calls; a precondition spanning several pages
stays as the plain sequence of business calls in `beforeEach` — never fused across
pages ([action-methods](../../action-methods/SKILL.md) practice 7). Anything the test
itself verifies still belongs in the test body, never the
hook. Who seeds vs. who cleans up → [test-data](../../test-data/SKILL.md).

❌ Reusing Playwright's default `page` fixture or sharing one context across tests. The
fresh context per test is iron law 8: isolation and parallel safety.

## 8. `afterEach` — close the context first; never drive the GUI

✅ `tests/LoginTests.spec.ts` (verbatim):

```ts
test.afterEach(async () => {
  await context.close();
});
```

`afterEach` never drives the GUI. Cleanup of records a test created goes through API/DB
business methods — they use the `request` fixture, not the possibly-broken page — or
lives in the test flow itself: canon `tests/LoginTests.spec.ts` TC2 deletes its user via
`apisUserManagement.deleteUser(...)` inside the test. If cleanup must sit in `afterEach`,
`await context.close()` comes FIRST so it is unconditionally reachable, then the API
cleanup — never inline SQL or raw requests (use the services already wired). If the
spec opened nothing per-test (pure DB spec), omit `afterEach` entirely; don't add empty
hooks.

❌ (illustrative counterexample) The GUI delete-account cascade in
`PlaceOrderRegisterWhileCheckoutTests.spec.ts`:

```ts
test.afterEach(async () => {
  await headerPage.clickOnDeleteAccountLink();
  await deleteAccountPage.assertSuccessDeleteMessage(testData.accountDeletedMessage);
  await deleteAccountPage.clickOnContinue();
  await context.close();
});
```

A mid-test failure makes teardown click a broken page, masking the real failure — and
because `context.close()` sits last, the context leaks too.

## 9. `afterAll` — close what `beforeAll` opened

Symmetric teardown: a DB service constructed in `beforeAll` is closed in `afterAll`,
or the worker leaks the pool.

✅ `tests/User Management/DbUserManagementTests.spec.ts` (verbatim):

```ts
test.afterAll(async () => {
  await dbsUserManagement.close();
});
```

❌ Closing the pool in `afterEach` (reopens per test, defeats pooling) or never closing
it (worker hangs on open handles).

## 10. No validations in hooks — hooks establish state, tests prove it

`verify*`/`assert*` calls belong in test bodies only; a hook that validates smuggles
part of the test into plumbing shared by every test. If setup must fail fast, let the
action's auto-waiting locator throw — that failure is already loud, located, and
reported. Allure metadata (`allure.feature`/`tms`/`issue`) likewise belongs in test
bodies, never in hooks.

Considered and rejected (team ruling — design-conventions, Decision records):
readiness-gate validations in `beforeEach` — fail-fast comes from the actions'
auto-waiting locators, not assertions.

❌ (illustrative counterexample) `PlaceOrderRegisterWhileCheckoutTests.spec.ts`: `assertCartPageLoaded`
in `beforeEach` and `assertSuccessDeleteMessage` in `afterEach` — both are test
evidence hiding in plumbing.

## 11. Zero logic, zero exception handling, zero Playwright plumbing in the spec

No `if`, no loops, no `try`/`catch`, no `page.locator()`, no `request.fetch()` —
anywhere in the file, hooks included (iron laws 3–4). A spec is a straight-line
sequence of business calls. If you feel the need to branch or retry, push it down:
business variation → an intent-named method on the page/service class; technical
complexity → `utils/` ([utility-classes](../../utility-classes/SKILL.md)).

❌ Also banned: `console.log` debugging left in a spec. `tests/User Management/DbUserManagementTests.spec.ts`
line 19 (`console.log('User row from DB:', user)`) is example scaffolding, not canon —
the Allure step and attachments already tell the story.

❌ Hardcoded values: `const email = 'someuser@example.test'` in the DB spec is likewise
example-only (the suite is `.skip`-gated). Canonical form reads every input and
expected value from the paired JSON / config / enums (iron law 5).

## 12. Gate an unrunnable suite with `.skip` plus a reason — never comment tests out

When a suite depends on unavailable infrastructure, skip the whole describe and say why.

✅ `tests/User Management/DbUserManagementTests.spec.ts` (verbatim):

```ts
// EXAMPLE: remove `.skip` once src/config/databases.ts points at a real,
// reachable SQL Server — until then the queries would fail to connect.
test.describe.skip('User Management DB Test Cases', () => {
```

❌ Commented-out test blocks, or `test.only` left in (CI forbids it via `forbidOnly`
in `playwright.config.ts`).

The same applies to a single test: a test that cannot run is declared, not commented.
`test.fixme` for a known defect (pair it with `allure.issue` once the ticket is filed),
`test.skip` for an environment condition — either way the case stays visible in reports
instead of silently vanishing. ❌ (illustrative counterexample) `ProductQuantityTests.spec.ts` carries a
test committed as `//` comments, still holding a stale `allure.tms('137183022')`
copied from the Login suite.

## Boundaries

This playbook covers the spec file's skeleton only. It does NOT cover:

- **Test content** — titles, `allure.feature`/`tms`/`issue` placement, one-focus rule,
  tags, flow composition → [test-methods](../../test-methods/SKILL.md)
- **Test data** — JSON shape, clustering, env data, secrets, seed-and-cleanup
  ownership, per-environment strategy → [test-data](../../test-data/SKILL.md)
- **Service class internals** — `Apis<Domain>`/`Dbs<Domain>` anatomy, `close()`
  implementation → [service-classes](../../service-classes/SKILL.md)
- **Page class internals** and when a new page class is justified →
  [page-classes](../../page-classes/SKILL.md)
- **Runner configuration** — workers, retries, reporters, projects: that is
  `playwright.config.ts`, routed via [pom-architecture](../../pom-architecture/SKILL.md)

## Review checklist — spec skeleton

- [ ] File is `tests/<Feature>Tests.spec.ts`, one folder deep under a suite/initiative folder when one applies (feature name, plural `Tests` — not a scenario, page, or singular name) with exactly one `test.describe`; title is the business feature name and no other spec shares it
- [ ] Imports minimal and ordered (Playwright → allure → business classes → Node); no `expect` imported
- [ ] Shared state is module-level `let` in layer order; unique-data `const` (timestamp) computed once at module level; record-creating tests compose from their own `tc<id>` cluster in the paired JSON (per-case base + the one timestamp; format-constrained fields get distinct valid per-case values, no suffix — test-data practice 7); no test body assigns state a hook consumes
- [ ] Tests first, hooks grouped at the bottom in lifecycle order
- [ ] `beforeAll` only loads the paired JSON and/or inits connection-holding services
- [ ] `beforeEach` seeds only case-agnostic state via API/DB business methods (case-specific records seed at the top of the owning test body from that case's cluster), then opens a fresh context/page, then constructs ALL page and service objects (none in test bodies); declaration and instantiation lists in matching order; GUI-only preconditions (no lower-layer path exists) follow construction as assertion-free business calls — one composed intent-named method when the calls live within one page and run longer than a couple of calls; a multi-page precondition stays as the plain sequence, never fused across pages
- [ ] `afterEach` never drives the GUI; if cleanup follows, `context.close()` comes first; `afterAll` closes every service `beforeAll` opened
- [ ] No logic, `try`/`catch`, raw `page.locator()`/`request.fetch()`, `console.log`, or hardcoded data anywhere in the file
- [ ] No validations (`verify*`/`assert*`) or Allure metadata inside hooks — hooks establish state, tests prove it
- [ ] Unrunnable suites gated with `.skip` + reason comment; single tests declared via `test.fixme` (defect) or `test.skip` (environment); no `test.only`, no commented-out tests
