# Test Data — Playbook

Numbered practices for test data in this framework. Shared law lives in
[design-conventions](../../pom-architecture/references/design-conventions.md); this file
adds the test-data depth. All examples are quoted from real project files, except the
per-case `tc<id>` cluster examples — those are the canonical target shape of the
2026-08-24 rulings (no conforming file exists yet; the pipeline generates the first).

## 1. One JSON file per spec, paired by name

**Rule:** every spec file `<Feature>Tests.spec.ts` gets exactly one data file
`resources/testData/<Feature>TestJsonFile.json`. The name derives mechanically: swap
`Tests.spec.ts` for `TestJsonFile.json` — the stem stays identical character for
character. Create the pair together; never share one JSON between specs and never split
one spec's data across several files.

The folder is exactly `resources/testData/` — the camelCase segment is a deliberate
exception to the lowercase folder rule (design-conventions §2). ❌ The kebab
`resources/test-data/` of the illustrative counterexample — never create it; when porting a legacy
spec, rewrite its `readFileSync` path.

**Why:** the pairing rule (design-conventions §2 and §5 — the Java-era
`WFDT_1234.json`-per-test-class rule, renamed) makes it obvious where any value lives
and keeps parallel spec files from coupling through shared data.

✅ Existing pair: `tests/LoginTests.spec.ts` ↔ `resources/testData/LoginTestJsonFile.json`.

Reject the legacy aliases in review: `<Feature>TestData.json`, `<Feature>TestsFile.json`,
and `<Feature>JsonFile.json` (the `Test` dropped) all break the mechanical swap — only
6 of the illustrative counterexample's 14 flat data files conform. Stem forks are worse:

❌ (illustrative counterexample) `tests/ContactUsTests.spec.ts` paired with `ContactUsFormTestData.json`
— the fork breaks grep-pairing: searching the spec's stem never finds its data file.

❌ A `CommonTestData.json` consumed by three specs — a change for one feature silently
alters another feature's inputs.

Per-spec pairing deliberately duplicates app-universal expected values across data
files (the illustrative counterexample carries the home-page title in nine JSONs) — that is the
intended cost; do NOT deduplicate into a shared `CommonTestData.json`.

## 2. Load the JSON once, in `beforeAll`, via `fs.readFileSync`

**Rule:** declare module-level `let testData: any;` and parse the paired file once in
`beforeAll`. Do not re-read it per test and do not `import` the JSON.

**Why:** one synchronous read per spec file is cheap, keeps the data a plain runtime
object, and matches the project canon.

✅ Verbatim from `tests/LoginTests.spec.ts`:

```ts
let testData: any;
// ...
test.beforeAll(async () => {
  testData = JSON.parse(fs.readFileSync('./resources/testData/LoginTestJsonFile.json', 'utf8'));
});
```

The path is relative to the repo root (Playwright's working directory), with `import *
as fs from 'fs';` at the top of the spec. Hook ordering and the rest of the spec
skeleton belong to [test-classes](../../test-classes/SKILL.md).

## 3. Zero hardcoded inputs or expected values in code

**Rule:** no test input, expected value, or assertion message is a string literal in a
spec, page, or service class (iron law 5). Specs read from `testData`; business methods
receive values as parameters.

**Why:** data changes must never require touching code, and reviewers can audit all
expectations in one small file.

✅ Verbatim from `tests/LoginTests.spec.ts` — both the input and the expected message
come from the JSON:

```ts
await loginPage.login(testData.invalidEmail, testData.invalidPassword);
await loginPage.verifyErrorMessage(testData.errorMessages.incorrcetEmailAndPasswordMsg);
```

❌ `await loginPage.verifyErrorMessage('Your email or password is incorrect!');` — the
expected value is invisible to data review and duplicated wherever it is asserted.

**Legacy note:** `src/apis/ApisUserManagement.ts#createUser` builds its `userData` payload
from literals (`title: 'mr'`, `firstname: 'Mahmoud'`, `company: 'Giza Systems'`, …).
That violates iron law 5 and is legacy — when you next touch that method, feed the
payload from the paired JSON (and an enum for `title`, see practice 5). Do not copy the
literal-payload pattern into new service classes.

## 4. Cluster related values into nested objects

**Rule:** group families of values under a named object key instead of scattering flat
keys. Extend an existing cluster rather than adding a sibling flat key.

**Why:** `testData.errorMessages.<case>` reads as a catalogue; twenty flat keys read as
noise and invite duplicates.

✅ Verbatim from `resources/testData/LoginTestJsonFile.json`:

```json
"errorMessages": {"incorrcetEmailAndPasswordMsg":"Your email or password is incorrect!"}
```

The flat `"deletedAccountExpectedMessage"` key in the same file predates the clustering
pattern; as confirmation messages accumulate, gather them into a
`confirmationMessages` cluster — but only when you are already editing that file
(refine, don't rewrite).

❌ `"loginError1"`, `"loginError2"`, `"signupError"` as top-level keys.

❌ (illustrative counterexample) `PlaceOrderRegisterWhileCheckoutTestJsonFile.json` — 29 flat top-level
keys spanning five families (profile, address, payment card, product, expected
messages), inputs indistinguishable from expectations. The canonical shape clusters
them: `{ "profile": {...}, "address": {...}, "paymentCard": {...}, "expectedMessages": {...} }`.

**Per-case clusters (2026-08-24 ruling):** in an ADO-traced spec, each test case's OWN
inputs — everything mutable or record-creating — live under a top-level cluster keyed
by the case's TC id, the same id the test passes to `allure.tms`:

```json
"tc1001": { "email": "qa.tc1001", "username": "userTc1001" }
```

Shared read-only families (an `errorMessages` catalogue, app-universal expected values)
stay file-level clusters — sharing immutable expectations is fine; sharing mutable
records is not. A test without a tracked id keys its cluster by a stable per-test slug
instead. No test ever reads a sibling case's cluster. A parameterized case's data rows
live as an array INSIDE its cluster — one cluster, one tracked case, one test per row:

```json
"tc1002": { "rows": [ { "planType": "silver", "email": "qa.tc1002.silver" },
                        { "planType": "gold",   "email": "qa.tc1002.gold" } ] }
```

— each record-creating row composes its distinguishing param into the base, so
sibling rows never collide either.

## 5. Enums for fixed option lists

**Rule:** when an input can only take a small fixed set of values defined by the
application (titles, statuses, sort orders), model it as a TypeScript enum, not as free
strings in JSON or literals in code.

**Why:** design-conventions §2 names enums as the replacement for fixed hardcoded
option lists — typos become compile errors and the legal values are documented in one
place.

✅ The canonical shape from design-conventions §2:

```ts
enum UserTitle { Mr = 'mr', Mrs = 'mrs' }
```

❌ `title: 'mr'` hardcoded inside `src/apis/ApisUserManagement.ts#createUser` (legacy — see
practice 3). JSON stays for values that vary per test; enums cover values fixed by the
application.

## 6. Environment data in `src/config/*.ts` + `process.env`; secrets ONLY via `process.env`

**Rule:** URLs, hosts, ports, and database names never enter a test-data JSON.
Environment data lives in `playwright.config.ts` (`baseURL`, projects) and typed
config modules under `src/config/`; every secret is read exclusively from
`process.env` and never committed as a literal.

Credentials come in two kinds. A password the test INVENTS for an account it creates
itself is a business input and lives in the paired JSON like any other value (✅
`"password": "<password-placeholder>"` in `resources/testData/LoginTestJsonFile.json`). A
credential that unlocks anything PRE-EXISTING — a DB user, a pre-provisioned account,
an API key — is a secret and comes only from `process.env` (✅ the `databases.ts`
pattern below). No credential of either kind ever appears in a step title (iron law 7
— [action-methods](../../action-methods/SKILL.md)).

**Why:** the same JSON must be valid against any environment (design-conventions §5:
Java properties files → config TS + `process.env`), and committed secrets are
unrecoverable once pushed.

✅ Verbatim from `src/config/databases.ts` — connection data as a typed config
module, credentials from the environment:

```ts
export const databases = {
  applicationDb: {
    name: 'applicationDb',
    server: process.env.APP_DB_SERVER ?? '',
    port: Number(process.env.APP_DB_PORT ?? '1433'),
    database: process.env.APP_DB_NAME ?? '',
    user: process.env.DB_USER ?? '',
    password: process.env.DB_PASSWORD ?? '',
  },
  // ...
} satisfies Record<string, DBConnectionConfig>;
```

The `satisfies Record<string, DBConnectionConfig>` clause type-checks every entry
against the facade contract in `src/utils/DBActions.ts` — keep it when adding databases.
The file's comment is explicit: credentials come only from environment variables (the
gitignored `.env`, documented by `.env.example`, loaded by dotenv in
`playwright.config.ts`) — never commit a literal credential. Secrets must also
never surface in step titles or attachments (iron law 7; `utils/` redacts them).

✅ `baseURL: process.env.APP_BASE_URL` lives in `playwright.config.ts`, so
specs and pages navigate relatively. Per-environment selection is wired for dotenv —
the `dotenv.config(...)` lines sit commented at the top of `playwright.config.ts` —
so environment switching happens via env vars/`.env`, never by editing test JSON.

❌ `"baseUrl": "https://staging.example.com"` or `"dbPassword": "<password-placeholder>"` inside a
`*TestJsonFile.json` — the same string that is fine as an invented signup password
becomes a secret the moment it unlocks a pre-existing database.

## 7. Unique per case AND per run: TC-id in the JSON base, timestamp suffix in code

**Rule:** the JSON stores a stable, human-readable base value that carries the owning
case's TC id (per-case uniqueness, visible in data review, from the case's `tc<id>`
cluster — practice 4); the spec makes it unique per run with a module-level timestamp
constant (per-run uniqueness). Never store a "unique" value in the JSON itself.

**Why:** iron law 8 — tests must survive re-runs, parallel workers, AND each other.
The TC id guarantees no two cases ever address the same record; the timestamp
guarantees run N+1 never collides with run N's leftovers. Both dimensions are
mandatory for record-creating data — the automate-suite VERIFY phase proves them by
requiring two consecutive green runs (2026-08-24 rulings).

✅ Canonical composition (per-case base from the cluster, one module timestamp):

```ts
const timestamp = new Date().toISOString().replace(/[-T:.]/g, "").slice(0, 17);
// ...
const email = testData.tc1001.email + timestamp + '@example.test';
```

backed by `"tc1001": { "email": "qa.tc1001" }` — the TC id keys the cluster AND
lives inside the base value, so the created record itself names its owning case.

**Format-constrained fields never take a postfix.** The compose-a-suffix pattern
applies only to fields the application treats as free text (names, emails, invented
references). A field with a validated format — fixed length, checksum, or app-side
rules: Iqama/identity numbers, IBANs, phone numbers, OTPs, dates, card numbers — would
be made INVALID by a TC-id or timestamp suffix, not unique. For those fields:

- **per-case uniqueness** comes from giving each case its own distinct VALID value
  inside its `tc<id>` cluster (two cases, two identity numbers);
- **per-run reusability** comes from seed-and-cleanup through the API/DB layers
  (practice 8's ladder, step 2) — reset or recreate the entity rather than vary the
  value. When the format tolerates numeric variation within its rules, that variation
  still lives in the per-case cluster, never as a string suffix in code.

A rerun collision on a format-constrained value is ladder-step-2 territory — never a
reason to bend the value's format or weaken the test.

One timestamp, one case, one record (2026-08-24 ruling, extending the 2026-08-19
timestamp ruling — the module-level `const` stays canon, computed once):

- Every record-creating case composes from its OWN `tc<id>` base — never from a
  sibling's cluster, never from a shared file-level base.
- The pre-ruling shape — one shared base key composed identically by every test and
  one record seeded in `beforeEach` for all of them (`tests/LoginTests.spec.ts`,
  base `"emailAddress": "m.elsharkawy"`) — is now a **legacy pattern**: with
  `fullyParallel: true`, two tests in one worker share the timestamp, so a shared
  base means both address the SAME record — an ordering race and a re-run collision.
  Migrate to per-case clusters when you next touch the file.
- The illustrative counterexample's three flat bases (`SignupTestJsonFile.json`: `"emailAddress"`,
  `"emailAddressAPI"`, `"emailAddressForLogin"` — three tests, three bases, one
  timestamp) are the pre-ruling transitional form of the same idea — canonical form
  keys those bases by TC id and puts the id inside the value.

❌ Varying the constant part in code instead — the illustrative counterexample's
`SubscriptionTests.spec.ts` appends `'@example.test'` in one test and `'@test2.com'` in the
next: per-case variation belongs in the per-case JSON clusters, never in string
literals scattered across test bodies.

❌ `"emailAddress": "m.elsharkawy@example.test"` reused verbatim across runs — the second
run fails on "email already exists", and two parallel workers fight over one account.

## 8. Seed via API/DB, own your cleanup — and prove re-runnability

**Rule:** whatever a test (or its hooks) creates, that same spec removes — seed through
the API/DB layers (fast, no GUI), and delete through the API or DB layer before the
test ends. Never rely on another test, a nightly job, or manual cleanup.
Prerequisites and data preparation run through the API/DB layers whenever a path
exists (iron law 8; hook wiring → [test-classes](../../test-classes/SKILL.md)).

Seeding location (2026-08-24 ruling): a **case-agnostic** precondition every test
needs identically belongs in `beforeEach`; a **case-specific** record (composed from
that case's `tc<id>` cluster — practice 7) is seeded at the top of the owning test
body via the same API/DB business methods — hooks stay case-agnostic, so no hook ever
branches on which test is running.

**Why:** iron law 8 ("seed via API/DB, clean up what you create") — leaked
records break independence and poison later runs.

✅ Seeding, from `tests/LoginTests.spec.ts` (**legacy note:** the call itself is the
canonical business-method shape, but it seeds one shared record for every test from a
shared base — under the per-case ruling this seeding moves to the top of each test
body, composed from that case's own cluster; migrate when next touching the file):

```ts
test.beforeEach(async ({ request, browser }) => {
  apisUserManagement = new ApisUserManagement(request);
  await apisUserManagement.createUser(testData.username, testData.emailAddress + timestamp + '@example.test', testData.password)
  // ...
});
```

✅ Cleanup folded into the flow when deletion IS the scenario — Test Case 2 in the same
file deletes the seeded user via `apisUserManagement.deleteUser(...)` and validates the
`testData.deletedAccountExpectedMessage`. `tests/User Management/DbUserManagementTests.spec.ts` shows
the DB cleanup half only: `verifyUserExistsInDb` → `getUserByEmail` →
`deleteUserByEmail` → `verifyUserNotInDb` in one test — note the example spec assumes a
pre-existing user rather than seeding one (it is `.skip`-gated example scaffolding); a
canonical spec would first seed via the API layer.

Uniqueness (practice 7) is the safety net, not a license to leak: when a mid-test
failure leaves a record behind, the next run composes different values and still
passes — the leftover is reported as debt, never load-bearing.

**The reusability ladder (2026-08-24 ruling).** The automate-suite VERIFY phase passes
a spec only when it goes green **twice in a row** — a pass-then-fail with
already-exists / duplicate / consumed-data symptoms is a **data-reusability defect**.
Fix it in this order, never by weakening the test:

1. Make the data unique per case AND per run (practice 7) — the fix for collisions on
   values the test invents.
2. Seed/reset the state through the API/DB layers — the fix when the app limits how
   many records can exist or the test consumes a pre-existing entity. Consult
   `resources/Queries/` for the team's known seed/verify SQL before writing new
   queries, and `resources/apisCollections/` for the team's known API seed routes
   before authoring new endpoints — derive-only, per the contract in
   `resources/apisCollections/README.md` ([service-classes](../../service-classes/SKILL.md)).
3. ONLY when no lower-layer path exists and the value cannot be made unique (e.g. the
   app allows one entity per account): an assertion-free GUI cleanup/reset step is the
   sanctioned last resort — record it in the spec and flag it in the PR so the team
   can provide a backend path later.

❌ Creating a user in `beforeEach` and never deleting it — every run grows the
database and eventually collides with practice 7's uniqueness.

## 9. Parallel isolation: data files are read-only inputs

**Rule:** never write back to a `*TestJsonFile.json` at runtime, and never let two
specs depend on the same mutable record. `testData` is frozen at the moment of parsing
— never assign keys to it at runtime, not even in `beforeAll`. Values produced during a
run (a created email, an API response) live in local `const`s, not in the data file.

**Why:** `playwright.config.ts` sets `fullyParallel: true` with `workers: process.env.CI
? 1 : 3` — spec files execute concurrently, so any shared mutable data is a race.

✅ `const deleteResponse = await apisUserManagement.deleteUser(email, testData.password);`
(`tests/LoginTests.spec.ts`) — run-produced state stays in a local constant.

❌ `fs.writeFileSync('./resources/testData/LoginTestJsonFile.json', ...)` to "remember"
a created id — the file is shared by every worker and by version control.

❌ (illustrative counterexample) `tests/ContactUsTests.spec.ts`, on the line after `readFileSync`:
`testData.filePath = './resources/test-data/ContactUsFormTestData/file.pdf';` — the
input becomes invisible in the JSON. A static value is a real JSON key (practice 11); a
run-produced value is a local `const`.

## 10. Per-environment strategy: sort every value into one of three homes

**Rule:** before adding any value, classify it:

| Kind | Home | Example |
|---|---|---|
| Business input / expected value (environment-agnostic) | paired `*TestJsonFile.json` | `"invalidEmail"`, `errorMessages.*` |
| Environment data (varies per env, not secret) | `playwright.config.ts` / `src/config/*.ts` | `baseURL`, `databases.applicationDb.server` |
| Secret | `process.env` (dotenv wiring available in `playwright.config.ts`) | `DB_USER`, `DB_PASSWORD` |

**Why:** a value in the wrong home either leaks (secret in JSON), breaks environment
portability (URL in JSON), or hides from data review (expected message in config).

If an expected value genuinely differs per environment, it is environment data —
expose it through `src/config/` and pass it into the validation like any other
expected parameter; do not fork the JSON per environment.

## 11. Binary fixtures: `fixtures/<Feature>/`, path stored in the JSON

**Rule:** files a flow uploads or attaches live under
`resources/testData/fixtures/<Feature>/` with descriptive names
(`ContactUsAttachment.pdf`, ❌ `file.pdf`). The fixture's repo-relative path is stored
as a normal key INSIDE the paired JSON (e.g. `"attachmentPath"`) and reaches the action
method as a parameter.

**Why:** the path is a business input like any other — in the JSON it is visible to
data review; hardcoded in code it violates iron law 5.

✅ `resources/testData/fixtures/ContactUs/ContactUsAttachment.pdf`, referenced by an
`"attachmentPath"` key in the paired `ContactUsTestJsonFile.json`.

❌ (illustrative counterexample) a per-feature subfolder `resources/test-data/ContactUsFormTestData/`
shadowing the JSON, plus the spec hardcoding `testData.filePath = './resources/...'`
in code (see practice 9).

(The `fixtures/` location was chosen by this audit — flagged for team confirmation in
the enhancement report.)

## 12. Payment card data: synthetic, clustered, never real

**Rule:** card data is a synthetic business input, clustered under a `paymentCard`
object (`{ nameOnCard, cardNumber, cvc, expirationMonth, expirationYear }`). The number
is obviously fake or an official test number; a real PAN never appears anywhere —
repo, env var, or report. Card values never surface in step titles
([action-methods](../../action-methods/SKILL.md)).

**Why:** a test number exercises the flow identically; a real card number is a data
leak the moment it is committed or reported.

✅ (illustrative counterexample) `"cardNumber": "123456789"` in
`PlaceOrderRegisterWhileCheckoutTestJsonFile.json` — obviously fake; but cluster the
five flat card keys under `paymentCard` (practice 4).

---

## Boundaries

This skill does NOT cover:

- Hook mechanics, module-level `let` wiring, `afterAll` closing of DB services →
  [test-classes](../../test-classes/SKILL.md)
- Test titles, Allure metadata, and how a test's flow consumes data →
  [test-methods](../../test-methods/SKILL.md)
- The shape of `verify*` methods that receive expected values →
  [validation-methods](../../validation-methods/SKILL.md)
- Writing the `Apis<Domain>` / `Dbs<Domain>` seed/cleanup methods themselves →
  [service-classes](../../service-classes/SKILL.md)
- `DBConnectionConfig`, redaction, and other facade contracts →
  [utility-classes](../../utility-classes/SKILL.md)

## Review checklist — test data

- [ ] Spec has exactly one paired `resources/testData/<Feature>TestJsonFile.json` —
  stem identical to the spec's, no legacy aliases (`TestData`/`TestsFile`/`JsonFile`),
  folder never `test-data/`
- [ ] App-universal expected values duplicated per spec — no shared `CommonTestData.json`
- [ ] JSON parsed once in `beforeAll` via `fs.readFileSync`, into module-level `testData`
- [ ] No string-literal inputs, expected values, or assertion messages in specs or business classes
- [ ] Related values clustered into nested objects (e.g. `errorMessages`, `paymentCard`);
  each tracked case's mutable inputs in their own `tc<id>` cluster (id = the test's
  `allure.tms`); no test reads a sibling case's cluster
- [ ] Fixed option lists modeled as enums, not free strings
- [ ] No URLs, hosts, or environment data in test JSON; pre-existing credentials
  (DB users, provisioned accounts, API keys) read only from `process.env`;
  invented-account passwords live in the paired JSON
- [ ] Uploaded/attached files live in `resources/testData/fixtures/<Feature>/`,
  descriptively named, their paths stored as keys in the paired JSON
- [ ] Payment card data synthetic and clustered under `paymentCard`; no real PAN anywhere
- [ ] Record-creating values compose per-case base (TC id inside the value, from the
  case's `tc<id>` cluster) + the one module-level timestamp — unique per case AND per
  run (format-constrained fields instead get distinct valid per-case values, no
  suffix — practice 7); no two tests share a mutable record or key
- [ ] Everything seeded (API/DB — case-agnostic in `beforeEach`, case-specific at the
  top of the owning test body) is cleaned up by the same spec; prerequisites run
  through the API/DB layers whenever a path exists; GUI cleanup only as the recorded
  last resort, flagged in spec and PR
- [ ] Data design survives two consecutive full runs (the VERIFY reusability gate) —
  nothing depends on a clean database or a prior run's leftovers
- [ ] No sample literals copied from `resources/Queries/` or
  `resources/apisCollections/` into test data (they are point-in-time examples, not
  fixtures)
- [ ] Data files never written at runtime; `testData` never assigned after parsing (not
  even in `beforeAll`); run-produced values held in local `const`s
