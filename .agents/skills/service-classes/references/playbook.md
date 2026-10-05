# Service Classes Playbook

## Shared runtime integration (M13)

A generated service may delegate a reviewed catalog operation, deterministic helper, or fixed inline parameterized definition through a technical facade into the shared API/DB runtime. These are equal execution sources; no catalog conversion is required. Versioned operation records can own their endpoint/SQL fields rather than duplicating them on the service. Review records, bindings and expected values together with their callers. Native driver binding and configured capabilities still apply.

Rules for `Apis<Domain>` classes in `apis/` and `Dbs<Domain>` classes in `dbs/`.
Living style references: `src/apis/ApisUserManagement.ts`, `src/dbs/DbsUserManagement.ts`,
`src/config/databases.ts`, `tests/User Management/DbUserManagementTests.spec.ts`.

## 1. One class per business domain, per channel

Create `Apis<Domain>` for the API operations of a domain and `Dbs<Domain>` for its DB
operations — never mix channels in one class. Why: each channel has its own facade,
lifecycle, and failure modes; the split keeps specs readable ("API seeded it, DB proves
it"). Build only the operations the current tests need — one test does not justify a new
abstraction (design-conventions §4.11).

`<Domain>` is a business-area noun sized to hold the domain's future endpoints — never
an echo of one endpoint. Smell: the class name restates one of its own
`<op>_serviceName` operations. ❌ (illustrative counterexample) the `ApisProductsList` /
`productsList_serviceName` / `getProductsListData()` triple-repeat — the domain class
is `ApisProductCatalog` (or similar), ready to take search/details/brand endpoints
without a rename. Name for the domain; still build only what current tests need.

## 2. Follow the fixed anatomy

Same top-to-bottom order every time (design-conventions §3); empty line between methods:

```
1. Fields: raw context/config + facade instance, then the service-string constants
2. constructor(...)         — wires the facade
3. close()                  — Dbs classes only (see practice 9)
4. ///// Actions
5. ///// Validations        — always last
```

Why: a reviewer finds the endpoint list, the wiring, and the assertions in the same
place in every service class. A `/////////Assertions` banner (as still present in
`src/apis/ApisUserManagement.ts`) is legacy — fold those methods under `///// Validations`
when you next touch the file.

## 3. Declare endpoints and queries as constant fields

Every endpoint path is a `readonly <operation>_serviceName` field; every SQL statement a
`readonly <operation>_query` field — same postfix pattern as locators (design-conventions
§2). Why: the operation catalog reads at a glance and no string literal hides inside a
method body.

✅ `src/apis/ApisUserManagement.ts`:

```ts
readonly createUser_serviceName = '/api/createAccount';
readonly login_serviceName = '/api/verifyLogin';
readonly deleteUser_serviceName = '/api/deleteAccount';
```

✅ `src/dbs/DbsUserManagement.ts`:

```ts
readonly selectUserByEmail_query = 'SELECT Id, Name, Email FROM Users WHERE Email = @email';
readonly deleteUserByEmail_query = 'DELETE FROM Users WHERE Email = @email';
```

❌ Inlining `'/api/deleteAccount'` or a SQL string inside a method body — the operation
disappears from the class's visible surface.

**Source new SQL from the team query library first (2026-08-24 ruling).** Before
authoring any `<operation>_query`, search `resources/Queries/` — the team's curated DB
knowledge base (table names, join paths, status codes, verify and seed recipes for the
application databases). When a matching query exists, adapt it into the field: ONE statement
per field, `@param` placeholders replacing its hardcoded sample values (practice 7),
Notion export artifacts cleaned (e.g. `[a.Id](https://column-name.invalid/)` → `a.Id`). The library is
derive-only: its markdown is read, never executed as-is, never edited by sessions, and
its sample literals (identity numbers, policy numbers, IPs) never become test data —
the full contract lives in `resources/Queries/README.md`. Writing a query the library
already knows, from scratch, is a review finding (`query-library-bypassed`).

**Source new API endpoints from the team collection library first (2026-08-26 ruling).**
Before authoring any `<operation>_serviceName`, search `resources/apisCollections/` —
the team's curated Postman collections (endpoints, payload shapes, auth flow,
request-chaining recipes). When a matching request exists, adapt it: the request path
becomes the `_serviceName` field; the base URL stays in config (practice 4's
hardcoded-base-URL ban); the sample payload becomes a typed parameter object the spec
fills from test data (practice 10); pre-request/test scripts are recipes to derive
TypeScript data-generation logic from, never executed raw. The library is derive-only:
its sample literals (sponsor/member ids, GUIDs, IBANs, phone numbers, emails) never
become test data — the full contract lives in `resources/apisCollections/README.md`.
Defining an endpoint the collection already covers, from scratch, is a review finding
(`collection-library-bypassed`).

## 4. The constructor wires the facade — methods never touch the raw client

`Apis<Domain>` accepts Playwright's `APIRequestContext` and immediately builds an
`ApiActions`; `Dbs<Domain>` accepts a `DBConnectionConfig` and builds a `DBActions`.
Every method then calls facade verbs (`apiActions.post(...)`, `dbActions.query(...)`).
The ban covers every raw verb on the context — `this.request.get`/`post`/`put`/`patch`/
`delete`/`fetch` all count, not just `fetch()`; where the raw context field is retained,
it exists only to hand to the facade constructor, never to call verbs on. Why: the
facades own steps, attachments, redaction, and connect/close reporting; bypassing them
produces invisible, unredacted calls (facade internals →
[utility-classes](../../utility-classes/SKILL.md)).

✅ `src/apis/ApisUserManagement.ts` / `src/dbs/DbsUserManagement.ts`:

```ts
constructor(request: APIRequestContext) {
  this.request = request;
  this.apiActions = new ApiActions(request);
}
```

```ts
constructor(dbConfig: DBConnectionConfig) {
  this.dbActions = new DBActions(dbConfig);
}
```

DB config comes from the named catalog in `src/config/databases.ts` (credentials
via `process.env` — the variable the database target names, or the shared `DB_USER` /
`DB_PASSWORD` keys), picked by the spec:
`new DbsUserManagement(databases.applicationDb)` (`tests/User Management/DbUserManagementTests.spec.ts`).
❌ Hardcoding a base URL in the class — the commented-out
`readonly baseURL = 'https://api.example.test'` in `src/apis/ApisUserManagement.ts` is
the flagged anti-pattern; the base URL belongs in `playwright.config.ts` / config files.
❌ (illustrative counterexample) `src/apis/ApisProductsList.ts` constructs `ApiActions` in its constructor
and never uses it — every call goes `this.request.get(...)`, losing the step, the
Request/Response attachments, and redaction:

```ts
const response = await this.request.get(this.productsList_serviceName, {});
```

Review smell: an `apiActions`/`dbActions` field that no method references means a
bypass exists somewhere in the class.

## 5. Wrap every action in one `allure.step` — business title, no secrets

Each action method is exactly one `allure.step(...)` whose title reads as a business
step and interpolates the meaningful parameters (design-conventions §4.6). Facade calls
inside it nest as sub-steps with request/query attachments automatically.

✅ `src/dbs/DbsUserManagement.ts`:

```ts
async getUserByEmail(email: string): Promise<Record<string, unknown> | undefined> {
  return await allure.step(`Get User from DB with email: ${email}`, async () => {
    const { rows } = await this.dbActions.query(this.selectUserByEmail_query, { email });
    return rows[0];
  });
}
```

❌ Secret leak (design-conventions §4.7) — `src/apis/ApisUserManagement.ts` `createUser()`
interpolates the password into its step title (and mislabels the parameters):

```ts
return await allure.step(`Create User Account with name: ${name}, First Name: ${email} and Last Name: ${password}`,
```

Canonical title: `` `Create User Account with name: ${name} and email: ${email}` `` —
the facade already redacts the password in attachments; never re-leak it upstream.
❌ Missing step — `login()` in the same file calls `apiActions.post` with no
`allure.step` wrapper: legacy, wrap it when you touch it (report shows only the raw
`POST …` facade step instead of the business intent).

## 6. Return what the test consumes

API actions return `Promise<APIResponse>` so the spec can hand the response to a
validation; DB actions return the row(s) or the affected-row count. Validations return
`Promise<void>`. No `return this` — fluent chaining was a Java-era rule, retired in
design-conventions §5.

✅ `src/dbs/DbsUserManagement.ts`:

```ts
async deleteUserByEmail(email: string): Promise<number> {
  return await allure.step(`Delete User from DB with email: ${email}`, async () => {
    const { rowsAffected } = await this.dbActions.query(this.deleteUserByEmail_query, { email });
    return rowsAffected[0] ?? 0;
  });
}
```

Type returns honestly: `Promise<APIResponse>`, `Promise<Record<string, unknown> | undefined>`,
`Promise<number>`. The `response: any` parameter on `assertLoginUserSuccess` in
`src/apis/ApisUserManagement.ts` is legacy — use `APIResponse`.

## 7. Parameterize every query — never interpolate values into SQL

SQL strings use `@param` placeholders; values travel as the params object of
`dbActions.query(queryText, { email })`, which binds them via `request.input()`
(injection-safe, per the `src/utils/DBActions.ts` contract). Why: string-built SQL is an
injection vector, breaks on quoting, and dodges the facade's param redaction.

✅ `src/dbs/DbsUserManagement.ts`:

```ts
readonly selectUserByEmail_query = 'SELECT Id, Name, Email FROM Users WHERE Email = @email';
// ...
const { rows } = await this.dbActions.query(this.selectUserByEmail_query, { email });
```

❌ `` await this.dbActions.query(`SELECT * FROM Users WHERE Email = '${email}'`) `` —
never, even in "just a test".

## 8. Validations: service-specific notes only — canon lives in validation-methods

Prefix (`verify*`), step wrapping (`Verify …` titles), placement last, expected values
as parameters, and the API (status + body) / DB (row-count) validation shapes →
[validation-methods](../../validation-methods/SKILL.md).

The service-specific delta:

- Validations reuse the class's `<op>_query` / `<op>_serviceName` constants through the
  facade (practice 3) — never a second inline literal.
- Collection/list validation shapes (non-empty, find-in-list, first-item fields) live in
  [validation-methods](../../validation-methods/SKILL.md) — do not restate them here.
  The delta: list validations still reuse the class's `<op>_serviceName` / `<op>_query`
  constants through the facade, and sibling validations must agree on the success shape —
  an API whose status lives in the body is checked the same way by every sibling
  (❌ illustrative counterexample: `ApisProductsList` checks `data.responseCode` in one validation and
  `response.status()` in the next; shape canon → validation-methods).
- Step titles: a re-invocable validation interpolates its parameter — ❌ (illustrative counterexample)
  the static title `Verify Product Name Exists In The Available Products List` called
  N times produces N indistinguishable Allure steps; the interpolation rule lives in
  [validation-methods](../../validation-methods/SKILL.md) practice 3.
- The `///// Validations` section exists in service classes too, always last (practice 2).
- `src/apis/ApisUserManagement.ts` still carries a legacy `/////////Assertions` banner with
  `assert*` methods (`assertCreateUserSuccess` / `assertLoginUserSuccess` /
  `assertDeleteUserSuccess`) — fold them under `///// Validations` and rename to
  `verify*` when you next touch the file. Its inline `expect(response.status()).toBe(200)`
  is likewise legacy-to-parameterize (iron law §4.5 records no status-code exception).
- Keep actions assertion-free: an action that also asserts belongs split in two.

## 9. `Dbs` classes expose `close()`; specs call it in `afterAll`

A DB service owns a connection pool, so it exposes a `close()` that delegates to the
facade; the spec's `afterAll` calls it (wiring details →
[test-classes](../../test-classes/SKILL.md)). `Apis` classes need no close — Playwright
owns the `request` fixture's lifecycle. Why: an unclosed pool keeps the worker process
alive after the run.

✅ `src/dbs/DbsUserManagement.ts` + `tests/User Management/DbUserManagementTests.spec.ts`:

```ts
/** Closes the underlying connection pool — call from afterAll/afterEach. */
async close(): Promise<void> {
  await this.dbActions.close();
}
```

Note: the "/afterEach" half of this legacy JSDoc contradicts hook canon — DB services
opened in `beforeAll` are closed in `afterAll` only (closing per test defeats pooling;
see [test-classes](../../test-classes/SKILL.md)); tighten the doc-string when next
touching the file.

```ts
test.afterAll(async () => {
  await dbsUserManagement.close();
});
```

No explicit `connect()` call needed — `DBActions.query()` connects lazily.

## 10. Inputs come from parameters, not hardcoded payloads

A service method's data arrives through its parameters, sourced upstream from the
spec's JSON test data (data-file rules → [test-data](../../test-data/SKILL.md)).
Hardcoding payload fields violates iron law §4.5. Known legacy violation:
`createUser()` in `src/apis/ApisUserManagement.ts` hardcodes a full `userData` object
(names, address, `mobile_number`, …) — canonical form takes those values as a typed
parameter object that the spec fills from `resources/testData/*.json`, with fixed
option lists (like the `title: 'mr'` field) modeled as enums.

Parameter/response ownership follows [design-conventions §4a](../../pom-architecture/references/design-conventions.md#4a-test-data-ownership-method-contracts-and-disposable-inputs).

## 11. No exception handling, no loops, no branching

`try`/`catch` is forbidden in `apis/` and `dbs/` — it exists only in `utils/`, where it
implements the never-throw reporting contract (design-conventions §4.3–4.4). Let a
failed request or query fail the test; the facade's step and attachments already tell
the story. Keep logic minimal (`rowsAffected[0] ?? 0` is fine); anything needing a loop
or conditional belongs in `utils/` or split into intent-named methods.

## Boundaries

This skill does NOT cover:

- `ApiActions`/`DBActions` internals — dispatch/step plumbing, `test.info().attach()`
  nesting, redaction sets, console logging, pool management, adding new facade verbs →
  [utility-classes](../../utility-classes/SKILL.md)
- Spec skeleton and hooks — where services are instantiated, `beforeEach` API seeding,
  `afterAll` teardown ordering → [test-classes](../../test-classes/SKILL.md)
- Test content — titles, `allure.feature`/`tms`, flow composition →
  [test-methods](../../test-methods/SKILL.md)
- Generic action/validation method style beyond the service-specific shapes above →
  [action-methods](../../action-methods/SKILL.md) /
  [validation-methods](../../validation-methods/SKILL.md)
- Test data files, enums, env/config strategy → [test-data](../../test-data/SKILL.md)
- Page classes and locators → [page-classes](../../page-classes/SKILL.md) /
  [element-locators](../../element-locators/SKILL.md)

## Review checklist — service classes

- [ ] Class named `Apis<Domain>` / `Dbs<Domain>`, in `apis/` / `dbs/`, one channel per class; `<Domain>` is a business area, not an echo of one endpoint
- [ ] Every endpoint/SQL string is a `readonly <operation>_serviceName` / `<operation>_query` field — no inline literals in method bodies
- [ ] New SQL checked against `resources/Queries/` first; matching team queries adapted (one statement, `@param` placeholders, sample literals stripped, export artifacts cleaned) — never pasted raw, never bypassed
- [ ] New API endpoints checked against `resources/apisCollections/` first; matching team requests adapted (path as the `_serviceName` field, base URL to config, sample payload as typed params, sample literals stripped) — never bypassed
- [ ] Constructor wires `ApiActions` / `DBActions`; no raw context verb (`this.request.get`/`post`/`put`/`patch`/`delete`/`fetch`) or raw pool usage anywhere in the class
- [ ] Every facade field is referenced by a method — an unused `apiActions`/`dbActions` field means a bypass exists
- [ ] Anatomy order: fields → constructor → (`Dbs` only) `close()` → `///// Actions` → `///// Validations`; no `Assertions` banner
- [ ] Every action is one `allure.step` with a business title; no secrets in any title
- [ ] Actions return `APIResponse` / rows / affected count as consumed; honest types, no `any`
- [ ] All SQL parameterized via `@param` + params object — zero string-interpolated values
- [ ] Validations `verify*`-prefixed, step-wrapped, last in the class; expected values arrive as parameters
- [ ] No `try`/`catch`, loops, or branching; no hardcoded payload data or base URLs
- [ ] Parameter/response types and dependencies follow design-conventions §4a
- [ ] `Dbs` class exposes `close()` and the spec's `afterAll` calls it
