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

Playwright first, then Allure, business classes, and Node built-ins. Default to
`import { test } from '@playwright/test'`; import only the types actually used.
Built-in `page`/`context` fixtures provide per-test isolation. Preserve justified
public fixtures for concrete lifecycle/reuse benefits. Never generate a replacement
`test` solely for telemetry, private instrumentation or an exact-version gate.
Reviewed technical fixture exceptions use the existing `conventions-ok` annotation;
utils are not a home for a test wrapper. Specs call business `verify*` methods.

## 3. Declare per-attempt state in layer order

Declare page objects, services, test data and optional cleanup candidates near the
imports. Hooks construct business objects; test bodies may assign their cleanup
candidates before creation. The first, dependency-free `beforeEach` resets candidates
before fixture setup can fail. Initialize services before application mutations and
use optional teardown calls for partial setup. Never retain a previous test's resource
or write generated values into JSON. Follow [design-conventions §4a](../../pom-architecture/references/design-conventions.md#4a-test-data-ownership-method-contracts-and-disposable-inputs).

## 4. Compose unique identities once per attempt

Use each case's JSON base and the module timestamp by default. Fixed synthetic
passwords stay in the paired JSON. Generate a credential only when the scenario or
observed ownership contract needs one, and reuse it in the operations that need it. Retain each fresh
attempted identity before creation, including negative-create attempts. It is not
ownership proof; borrowed identities must never become deletion candidates. Never
recompute credentials independently in teardown.

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

  test.beforeEach(async ({ request, page }) => { /* services + page objects */ });

  test.afterEach('Clean up owned data', async () => { /* domain cleanup */ });

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
`beforeAll` — anything per-test belongs in `beforeEach` (practice 7). Scenario validations and
Allure metadata belong in bodies; cleanup postconditions are allowed → practice 10.

## 7. `beforeEach` — reset state, initialize services and page objects

Reset per-attempt cleanup state in a dependency-free hook before fixture-dependent
setup. Construct services from `request` and page objects from the built-in isolated
`page`. A service that did not initialize must remain safely absent at teardown.

```ts
test.beforeEach('Reset per-test state', () => {
  userToClean = undefined;
  apisUserManagement = undefined;
});

test.beforeEach('Initialize services and page objects', async ({ request, page }) => {
  apisUserManagement = new ApisUserManagement(request);
  loginPage = new LoginPage(page);
});
```

Create case-specific records in their test body from that case's JSON cluster; retain
the fresh attempted identity before the create call. Shared prerequisites may use
domain methods in setup, with the same ownership and teardown rules. Never branch on
which test is running or issue raw requests in a hook. Explicit fresh contexts remain
valid when needed; preserve existing explicit context setup when changing data cleanup,
and close contexts in a separate teardown hook after application cleanup.

Prefer API/DB preconditions. When no lower-layer path exists, a page method may
establish a prerequisite after page objects are constructed; scenario verification
still belongs in the test body. Follow the canonical lifecycle rules in
[§4a](../../pom-architecture/references/design-conventions.md#4a-test-data-ownership-method-contracts-and-disposable-inputs).

## 8. `afterEach` — clean application data before disposing resources

Call the owning API/DB service's focused cleanup method from an ordinary named hook.
Use the independent `request` fixture or a DB connection available during teardown.
Ownership reconciliation and cleanup postconditions follow [§4a](../../pom-architecture/references/design-conventions.md#4a-test-data-ownership-method-contracts-and-disposable-inputs).

```ts
test.afterEach('Clean up the owned user', async () => {
  await apisUserManagement?.cleanupUserIfOwned(userToClean);
});
```

Playwright disposes built-in pages/contexts after the hook. Manual contexts use a
separate close hook with an optional call for partial setup. Hooks continue after
ordinary failures but share a teardown budget: bound cleanup and avoid spending that
budget on context closure first. Report cleanup errors alongside the original error.

Closing a browser or pool is not application cleanup. Body-only cleanup can be skipped
by an earlier failure. GUI-only cleanup may run before page disposal when no API/DB
route exists; document its limitations. Omit empty hooks.

## 9. `afterAll` — close what `beforeAll` opened

Symmetric teardown: a DB service constructed in `beforeAll` is closed in `afterAll`,
or the worker leaks the pool.

✅ `tests/User Management/DbUserManagementTests.spec.ts` (verbatim):

```ts
test.afterAll(async () => {
  await dbsUserManagement?.close();
});
```

❌ Closing the pool in `afterEach` (reopens per test, defeats pooling) or never closing
it (worker hangs on open handles).

## 10. Keep scenario assertions in the body; verify cleanup in teardown

Scenario `verify*` calls and Allure metadata belong in test bodies. Hooks may invoke
lifecycle cleanup postconditions under [§4a](../../pom-architecture/references/design-conventions.md#4a-test-data-ownership-method-contracts-and-disposable-inputs).
These checks prevent a false clean result but earn no scenario assertion credit.
Do not add business readiness assertions to setup or hide scenario checks in fixtures.

## 11. Zero logic, zero exception handling, zero Playwright plumbing in the spec

No scenario branching, loops, `try`/`catch`, raw `page.locator()` or `request.fetch()`
in specs (iron laws 3–4). Small lifecycle guards for partial initialization are allowed. A spec is a straight-line
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
- [ ] Per-attempt cleanup candidates reset before fixture setup; test bodies may retain fresh attempted identities before creation; paired JSON stays immutable
- [ ] Schema and generated-state ownership follow design-conventions §4a
- [ ] Tests first, hooks grouped at the bottom in lifecycle order
- [ ] `beforeAll` only loads the paired JSON and/or inits connection-holding services
- [ ] Setup initializes services before application mutations and constructs page objects from the built-in page by default; case-specific records are created in the owning test
- [ ] Required application cleanup runs before context disposal, guards partial setup and follows §4a; `afterAll` closes every pool it opened
- [ ] No scenario logic, `try`/`catch`, raw `page.locator()`/`request.fetch()` or debugging; small partial-setup guards and direct literal metadata IDs are allowed
- [ ] Scenario validations and Allure metadata stay in bodies; lifecycle cleanup postconditions are permitted in hooks
- [ ] Unrunnable suites gated with `.skip` + reason comment; single tests declared via `test.fixme` (defect) or `test.skip` (environment); no `test.only`, no commented-out tests
