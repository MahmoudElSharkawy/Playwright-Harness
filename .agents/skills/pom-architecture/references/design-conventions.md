# Framework Design Conventions — Canonical Reference

Shared law for this Playwright/TypeScript test framework. Every specialist skill builds
on this file and must not contradict it. When a specialist playbook and this file seem
to disagree, this file wins; when this file and the actual project code disagree on
style detail, prefer the pattern of the file you are editing and raise the mismatch.

Origin: these conventions merge the team's agreed Java-era review checklist and locator
SOP with the patterns already established in this repository. Section 5 records every
deliberate adaptation from the Java originals, so reviewers can trace why a rule changed.

---

## 1. Architecture

- **Page Object Model without base classes.** No `BasePage`, no inheritance between
  page classes. Shared behavior lives in composition (a page holds what it needs) or in
  `utils/`. Skeleton areas that repeat across pages (header, footer, side menu) get
  their own page class (e.g. `HeaderPage`) instead of being duplicated into every page.
- **Three business families, one technical family** (code layers live under `src/` —
  2026-09-01 layout ruling in the Decision records):
  - `src/pages/` — one class per HTML page or skeleton area. GUI business services.
  - `src/apis/` — `Apis<Domain>` classes exposing API business operations.
  - `src/dbs/` — `Dbs<Domain>` classes exposing DB business operations.
  - `src/utils/` — `ApiActions`, `DBActions`, and future facades. Connections, logging,
    Allure attachments, redaction, retries — every technically complex concern.
  - `src/config/` — environment coordinates (applications, databases, integration APIs,
    identity pools); values from `.harness/targets.json` (the starter's `targets.ts`)
    or `process.env`, never secrets (formerly `resources/config/`).
- **Run-lifecycle scripts** (`global-setup.ts` / `global-teardown.ts`) belong to the
  technical family alongside `utils/` (`try`/`catch`, loops, console allowed). Scope is
  strictly run hygiene: clear stale `allure-results/` before the run; generate/open the
  Allure report after it, honoring `AUTO_ALLURE_OPEN`. NEVER business logic and NEVER
  data seeding/cleanup — global setup runs once per run, not per test (iron law 8).
  Detailed rules: [utility-classes](../../utility-classes/SKILL.md).
- **Layer folders are created on first need** (iron law 11): a repo with no DB tests
  correctly has no `dbs/` — never scaffold empty layers. But when the first test of a
  new kind arrives, create the canonical folder; parking a DB service in `apis/` or
  `utils/` "because the folder exists" is a layering violation. (The illustrative counterexample repo
  has no `dbs/` and no config layer — correct for its scope.)
- **Runtime toggles** consumed by `utils/` resolve constructor option → env var →
  project metadata (the order utility-classes practice 8 canonizes). A metadata key
  nothing consumes is inert — delete it when touching the config
  (❌ `metadata: { timeout: 600000 }` in `playwright.config.ts` configures nothing).
- **Specs orchestrate, never implement.** A test reads as a sequence of business calls
  on page/service objects plus Allure metadata. If a spec needs `page.locator()`,
  `request.fetch()`, a loop, or an `if`, the design is wrong — push it down a layer.
- **Fluent readability, adapted.** Fluency here means: intent-named methods, Allure
  step titles that read as business steps, and Playwright's chainable locator API.
  Methods do **not** `return this` (see §5).

## 2. Naming conventions (TypeScript)

| Identifier | Rule | Examples |
|---|---|---|
| Class | PascalCase noun; role suffix/prefix: `<Name>Page`, `Apis<Domain>`, `Dbs<Domain>`, `<Noun>Actions`. Real words, no acronyms. | `LoginPage`, `HeaderPage`, `ApisUserManagement`, `DbsUserManagement`, `DBActions` |
| Interface / type | PascalCase, descriptive noun or adjective; no `I` prefix | `DBConnectionConfig`, `ApiRequestOptions` |
| Method | camelCase verb phrase; starts with a verb | `login()`, `clickOnCartLink()`, `verifyErrorMessage()` |
| Variable | camelCase; no single letters; no leading `_`, `$`, or other special chars | `testData`, `timestamp`, `deleteResponse` |
| Locator field | `camelCaseName_typeSuffix` — postfix names the element type; lowercase suffix is canonical | `acceptCookies_button`, `loginEmail_input`, `cart_link`, `logo_img` |
| Service-string field | Same postfix pattern as locators: `<operation>_serviceName`, `<operation>_query` | `createUser_serviceName`, `selectUserByEmail_query` |
| Folder | Code layers live under `src/` (lowercase, short); `tests/` and `resources/` stay top-level; subfolders of `resources/` camelCase. ❌ `resources/test-data/` (kebab) is a known legacy-repo drift form — never create it; when maintaining a legacy repo, match its existing folder rather than mass-renaming. Recorded exception: `resources/Queries/` (capital Q) — the team-owned DB-query knowledge library, named by the team's export workflow (Decision records, 2026-08-24) | `src/pages/`, `src/apis/`, `src/dbs/`, `src/utils/`, `src/config/`; `tests/`, `resources/`; `resources/testData/`, `resources/apisCollections/`, `resources/Queries/` |
| Constant (utils/technical) | `UPPER_SNAKE_CASE` for true module constants | `REDACTED_HEADERS`, `TEXTUAL_CONTENT` |
| Enum | PascalCase name; used to replace fixed hardcoded option lists | `enum UserTitle { Mr = 'mr', Mrs = 'mrs' }` |
| Test file | `<Feature>Tests.spec.ts` in `tests/` | `LoginTests.spec.ts`, `DbUserManagementTests.spec.ts` |
| Test data file | `<Feature>TestJsonFile.json` in `resources/testData/` | `LoginTestJsonFile.json` |

Fetched Markdown cases and their supporting manifests, traceability and verification
state live under gitignored `execution-tests/ado-suite-<id>/` or
`execution-tests/ado-story-<id>/`. Existing folders under `test/` move manually;
Playwright automation specs stay in `tests/`.

The test-file ↔ data-file pairing is mechanical: derive one name from the other by
swapping the suffix (`LoginTests.spec.ts` ↔ `LoginTestJsonFile.json`), stem identical
character-for-character. The drift catalogs live in the
[test-classes](../../test-classes/SKILL.md) and [test-data](../../test-data/SKILL.md) playbooks.

Locator suffix vocabulary (closed — extending it requires a design-conventions change, never a per-file invention):
`button`, `input`, `link`, `header`, `txt`, `img`, `icon`, `checkbox`, `radio`,
`dropdown`, `list`, `table`, `row`, `cell`, `form`, `msg`, `tab`, `card`, `modal`, `section`.

**Legacy note:** existing code contains capitalized suffixes (`login_Button`,
`loginEmail_Input`) and mixed casing (`login_Error_Message`). Canonical form for new
code is the lowercase suffix. When editing an existing file, match that file's local
style; do not mass-rename working code ("if it still works, don't touch it") — tighten
only what you are already touching for another reason.

## 3. Class anatomy (member order)

Every business class follows the same top-to-bottom order, with an empty line between
methods and section banners exactly as written:

```
1. Fields: `readonly page: Page` (pages) / context + facade (services), then `url`,
   then locator or service-string fields under a `// Locators` comment
2. constructor(...)          — wires page/request/config and initializes locators
3. Dynamic locator methods   — parameterized `Locator`-returning methods (pages only)
4. ///// Actions             — action methods
5. ///// Validations         — validation methods, always last
```

Existing files with a stray `/////////Assertions` banner are legacy; fold those methods
under `///// Validations` when you next touch the file.

## 4. Iron laws

1. **Separation:** business code (what the user/system does) in `pages/`, `apis/`,
   `dbs/`; technical code (how it's done reliably) in `utils/`.
2. **Encapsulation:** locators never leave their page class. Specs and other classes
   interact only through action/validation methods. New page classes declare locators
   `private readonly`; existing public `readonly` locators are legacy (see §5).
3. **No exception handling** in tests, pages, apis, dbs. `try`/`catch` exists only in
   `utils/` where it implements the never-throw reporting contract. Let failures fail —
   Playwright's error, trace, and the Allure step tell the story.
4. **No loops or conditionals in spec files.** In business classes keep logic minimal;
   prefer smaller intent-named methods over general branching. A domain lifecycle
   cleanup method may use the small ownership/absence guards described in §4a;
   optional teardown calls may guard incomplete setup. Technical complexity belongs
   in `utils/`, but a domain cleanup guard does not justify another utility.
5. **Externalized data:** no hardcoded test inputs or expected values in specs or
   classes — including assertion messages. Scenario values come from the paired JSON;
   environment access comes from config/secret references; fixed option definitions may
   use enums. Disposable inputs may be generated under §4a, with constraints from the
   owning JSON. Expected outcomes never hide in shared constants or default arguments. Recorded exception (see
   Decision records): a page class's own `url` field is structural identity, and
   validations may assert it via `toHaveURL(this.url)`. Literal reporting-metadata
   IDs belong directly in Allure calls; domain cleanup postconditions follow §4a.
6. **Every action and validation method is one Allure step** (`step()` /
   `allure.step()` from `allure-js-commons`) with a business-readable title that
   interpolates the meaningful parameters.
7. **Keep secrets out of authored step titles, metadata and unnecessary attachments.**
   Reuse existing redaction, but do not claim it sanitizes native reporting or every
   facade payload. The protection boundary is utility-classes §20. Consumer code must
   not patch private Playwright instrumentation or install telemetry version gates.
8. **Independence & parallel safety:** every test can run alone, in parallel, and
   repeatedly — fresh browser context per test; data unique per CASE and per RUN
   (each case's mutable inputs live in its own TC-id cluster with the id in the base
   value; compose with the module timestamp by default, adding discrimination only
   when needed — §4a below);
   seed via API/DB — case-agnostic preconditions in `beforeEach`, a case's own records
   at the top of its test body — and clean up what you create. Whenever a lower-layer
   path exists, prerequisites and data preparation run through the API/DB service
   classes, never through the GUI — lower-layer seeding is faster and far less flaky;
   the GUI is for the behavior under test, not for arranging state (GUI lifecycle
   cleanup is the documented last resort when no lower-layer path exists; see §4a).
9. **At least one validation per test.** A test without an assertion is not a test.
10. **Refine, don't rewrite.** Preserve report-facing behavior: step nesting, step
    titles, attachment names. Attachments must use `test.info().attach()` from inside
    the step body — allure-playwright nests those inside the step, whereas
    `step.attach()` lands outside it. Verify report-affecting changes in Allure.
11. **Agile mindset:** build only what the current test needs — no speculative methods,
    pages, or data. One test does not justify a new abstraction.
12. **Hygiene:** empty line between methods; format with the IDE before creating a
    merge request; self-describing code over comments — document a method only when the
    name genuinely cannot carry the meaning (utils are the exception: technical
    contracts there deserve JSDoc).

## 4a. Test-data ownership, method contracts and disposable inputs

- Each spec loads exactly its own paired JSON. Keep any explicit complete schema local;
  do not add a named interface merely to annotate parsed JSON. Preserve existing typing
  or infer the shape from the paired JSON with an erased type reference.
  No shared fixture JSON, common test-value container, aggregate spec schema, common
  cross-spec case-data base, or inheritance combining unrelated specs' inputs,
  expectations or metadata. Same-spec immutable expectation clusters remain allowed.
  Interfaces describe shapes; sharing them does not itself share runtime state.
- Business classes receive only operation inputs/expectations as parameters. They never
  load test-data JSON or depend on complete spec schemas, including indexed access,
  aliases or `Pick` derived from them. A local spec schema may reference a
  business-owned operation type: dependencies still point downward.
- Prefer small explicitly named parameter lists (approximately four positional inputs,
  per action-methods §11). Use a typed object when size/readability warrants it; do not
  introduce an interface for every small argument group. Operation-specific types live
  beside the owning business class by default; a shared type module requires demonstrated
  reuse. Never replace useful typing with `any` or duplicate business behavior.
- Generic technical behavior stays in existing utilities such as `ApiActions`;
  domain API operations and response validations stay in `src/apis/`. A generic API
  class is not a container for types, parameters or constants. Fixed technical constants
  and option definitions remain allowed; scenario inputs and expected outcomes remain
  explicit values from the paired JSON (environment-specific expectations retain the
  existing config exception).
- Externally provisioned account/admin/application/DB/integration credentials use
  ignored environment files or CI secret stores. Fixed synthetic passwords, including
  deliberately invalid inputs, belong in the paired JSON; this is the simple default
  for test-created accounts too. Generate a disposable password only when the scenario
  or observed ownership contract needs a fresh credential.
  Never infer an environment key solely from a field being named `password`.
- When generation is needed, generate once per owned account per test attempt. Reuse those
  exact values for registration, login and cleanup; keep generated emails, credentials
  and returned IDs in test-local variables, reset per-attempt spec state or justified
  test-scoped fixture state. Never persist them in JSON, `.env` or state shared across
  tests. Preserve explicit case
  values, format/generation rules and invalid-input relationships; an intentionally
  wrong password must differ from the account's actual password.
- Required cleanup disposes of temporary records owned by this test, or restores
  borrowed state when the scenario requires it. Intentionally persistent outcomes
  have no disposal obligation. Keep one optional attempted identity/credential value
  per independent resource; reset it before fixture-dependent setup and retain a
  fresh value before creation, including negative-create attempts. An attempted
  identity is not ownership proof. Never designate borrowed identities for deletion.
- Call a focused domain API/DB cleanup method from ordinary teardown. It accepts no
  candidate or verified absence, deletes only an attributable owned record, and
  verifies the required final state. Derive ownership from the observed application
  contract; reconcile uncertain creates and preserve foreign/colliding records.
  Keep existing endpoint and authentication contracts. A test password is not a bearer
  token unless the application actually defines it that way. When no safe ownership or
  absence check is available, report the missing contract instead of inventing an API.
  Small guards and cleanup postcondition assertions belong in this lifecycle method
  under Actions; its stable domain contract values need not come from scenario JSON.
  Cleanup checks in hooks are lifecycle evidence, not business assertion coverage.
  Report cleanup failures alongside the original failure; never swallow either.
- Prefer the built-in isolated `page`/`context` lifecycle. Initialize services from
  the independent `request` fixture before application mutations. Cleanup runs before
  automatic disposal; guard partial setup and bound waits within teardown timeouts.
  Manual contexts use separate cleanup/close hooks when needed. Cleanup refactors
  preserve an existing sound explicit-context lifecycle; changing application
  data cleanup does not by itself require replacing context creation and closure.
  Required cleanup only at the end of the body is insufficient. GUI-only cleanup may use an ordinary
  hook before page disposal when no API/DB route exists; document its limitations.
  Closing contexts/connections does not delete application records.
- Reuse justified public fixtures and existing domain methods. A concrete lifecycle
  or reuse benefit can justify a fixture; no new dated ruling is required. A few
  resource tests do not justify a registry, callback protocol, shared ownership
  state machine or replacement test import solely for telemetry. Technical fixture
  exceptions use the existing reviewed `conventions-ok` mechanism. Business inputs
  and validation signatures never carry harness source keys or tracing callbacks.
- Storage and report redaction are separate. Existing utilities redact selected
  headers/structured keys; confidential assertion variants hide values only in their
  authored titles. Native artifacts, URLs and error copies are not comprehensively
  sanitized; follow [report protection boundaries](../../utility-classes/references/playbook.md#20-report-protection-boundaries). Environment references
  are not a prerequisite for redaction. The lightweight checker covers direct literal
  dependencies; semantic schema ownership, dynamic sources and credential provenance
  require independent review, never filename/property-name guesses.

## 5. Java → Playwright/TS adaptation decisions

The team's original conventions were written for Java/Selenium/TestNG. These mappings
are deliberate and settled — do not "helpfully" reintroduce the Java form:

| Java-era rule | Canon here | Why |
|---|---|---|
| Action/validation methods `return this` (fluent) | Return `Promise<void>`, or a value only when genuinely consumed (`APIResponse`, rows, a string) | Decorative chaining fights `async`/`await`; fluency lives in step titles and Playwright's chainable locators |
| Validation methods start with `Validate` | Start with `verify` (`verifyErrorMessage`). Existing `assert*` methods are legacy aliases — align opportunistically | `verify*` is the dominant project pattern |
| Locator variables `private` | `private readonly` in **new** page classes; existing public `readonly` fields are legacy — tighten only when already editing that file | Same encapsulation goal, TS idiom, minimal churn |
| Packages `src/main/java`, `src/test/java` | `src/{pages,apis,dbs,utils,config}` for framework code; `tests/` and `resources/` top-level (2026-09-01 layout ruling — deliberately NOT `src/main`/`src/test`: a test repo ships no "main" artifact) | Framework-code vs specs split, TS idiom |
| Test class named after JIRA story (`WFDT_1234.java`) | `<Feature>Tests.spec.ts`; traceability via `allure.tms('<id>')` and the test title | File-per-feature reads better; links carry the traceability |
| Test data file named after story (`WFDT_1234.json`) | `<Feature>TestJsonFile.json` matching its spec file | Same pairing rule, project naming |
| `@Step` | `step('title', async () => { … })` from `allure-js-commons` | Direct equivalent |
| `@Epic` / `@Feature` / `@Story` | `allure.epic()` / `allure.feature()` / `allure.story()` as the first lines inside the test body | Direct equivalent |
| `@TmsLink` / `@Issue` | `await allure.tms('id')` / `await allure.issue('id')` — literal IDs, with actual destinations configured in the existing Allure reporter link templates; issues only for real associated bugs | Reporting IDs are exempt from scenario-data externalization; no URL helper needed |
| `@Test(description, groups)` | The test title is the description (JIRA id inside it when applicable); groups → Playwright tags (`{ tag: ['@smoke'] }`) | Playwright idiom |
| Properties files for env variables | `playwright.config.ts` (`baseURL`, projects) + `src/config/*.ts` + `process.env` (dotenv wiring exists, commented, in the config) | TS-native configuration |
| Java method overloading for variants | Optional/default parameters or a second intent-named method | TS idiom |
| Cookie switcher files | Not implemented — discuss before building | Marked "needs more discussion" in the original |

## Decision records (team rulings)

Rulings recorded by the team; specialists implement them — a future change here requires a new ruling.

| Date | Decision | Ruling | Implemented in |
|---|---|---|---|
| 2026-08-19 | URL validations | `toHaveURL(this.url)` is allowed as an arrival/readiness validation; the page class's own `url` field is structural identity (like a locator) — a recorded exception to iron law 5 | validation-methods, page-classes |
| 2026-08-19 | GUI-only preconditions | API/DB seeding stays the default (iron law 8). When NO lower-layer path exists, `beforeEach` may establish the shared precondition as assertion-free business-method calls — compressed into ONE composed intent-named method on the owning page class when the calls live within one page and run longer than a couple of calls; a precondition spanning several pages stays as the plain sequence of business calls in `beforeEach`, never fused across pages (action-methods practice 7) | test-classes, test-methods |
| 2026-08-19 | Readiness-gate validations in hooks | Business scenario validations remain in the body; actions use auto-waiting. Amended by the 2026-10-06 lifecycle ruling: required cleanup postconditions in teardown are allowed but earn no scenario assertion credit. | test-classes, validation-methods |
| 2026-08-19 | Per-test timestamp regeneration | Keep the simple module timestamp and distinct per-case bases as the default. Add a discriminator only for a concrete collision or multi-resource need. Reset per-attempt spec state is valid under §4a; no shared mutable state across tests. | test-classes, test-data |
| 2026-08-19 | Nested sub-steps | Composing other public step-wrapped actions is sanctioned — their steps nest as sub-steps in Allure by design. A method still opens exactly ONE step of its own; private helpers stay step-less | action-methods |
| 2026-08-19 | `textarea` suffix | Not added — `input` covers every fillable control, textarea included; the §2 vocabulary stays closed | element-locators |
| 2026-08-19 | Config `metadata` as a flag channel | Not a primary channel — runtime flags are set via env vars; project `metadata` is only the documented fallback read by utils (practice 8) and report-facing info; inert keys are deleted | pom-architecture, utility-classes |
| 2026-08-19 | `tms` link granularity | Default: one `allure.tms('<id>')` per test, pointing at that test's own tracked case — one id never appears on two tests (tests decomposing one tracked case each get their own case id). Sanctioned exception: a big E2E journey covering several tracked cases carries multiple `allure.tms()` calls, one per covered case — each id honest only if the journey's checkpoint validation for that case exists | test-methods |
| 2026-08-21 | Tag vocabulary | Closed set, mirroring the locator-suffix model: `@smoke` (critical-path subset run on every build) and `@regression` (full functional sweep). New tags require a new ruling. ADO test-case tags map into this set in the automate-test GENERATE phase; unmappable ADO tags are dropped, never invented as new repo tags. Enforced warn-level by `scripts/check-conventions.mjs` | test-methods, automate-test |
| 2026-08-21 | Delivery workflow | All changes ride a purposefully-named feature branch and land via pull request; direct pushes to master/main are prohibited by workflow; the current hook is advisory. Pipeline output uses `automation/ado-suite-<id>-<slug>` branches; a test case's `Custom.Automation` field flips to "Automated" only after its PR merges | CLAUDE.md, automate-test, scripts/hooks/guard.mjs |
| 2026-08-22 | Automation-status semantics | `Custom.Automation = "Automated"` means a WORKING script exists on master — VERIFY-passed, or failing on a classified app defect (a valid assertion detecting a real bug IS automation working). Script-defect and environment failures are never marked. Outcomes (test points Passed/Failed) are the independent "is the app behaving" dimension | automate-test, scripts/publish-ado-results.mjs |
| 2026-08-24 | Rerun-reusability gate | A generated test counts as VERIFY-passed only after its spec passes twice consecutively with no intervening edits (`greens ≥ 2` in `_verify-state.json`); the confirmation run never consumes a fix round. A pass-then-fail on leftover/consumed data is a **data-reusability defect** (script-defect family), remediated in order: per-case + per-run unique data → API/DB seed-and-cleanup (consult `resources/Queries/`) → GUI cleanup in teardown only when no lower-layer path exists (cleanup postconditions allowed under §4a) (flagged in the PR) | automate-test, test-data, test-methods, scripts/publish-ado-results.mjs |
| 2026-08-24 | Per-case data independence | Extends the 2026-08-19 timestamp ruling: the paired JSON clusters each tracked case's mutable inputs under its TC id (`"tc<id>": { … }` — the same id as the test's `allure.tms`; untracked tests key by a stable per-test slug), and record-creating base values carry the TC id inside the value; compose with the module timestamp by default, adding a discriminator only for a concrete collision need. Format-constrained fields (identity numbers, IBANs, phone numbers, OTPs, dates…) never take a postfix — they get per-case distinct VALID values in the cluster, and API/DB seed-and-cleanup for re-runs. No two tests share a mutable record or data key — every case runs alone (`-g "<title>"` must pass). Sanctioned exception: the sibling tests generated from ONE parameterized ADO case's data rows share that case's tms id and its `tc<id>` cluster (rows an array inside it; each record-creating row composes its distinguishing param into the base) — one tracked case, not two. Case-specific records seed at the top of the owning test body via API/DB business methods; hooks stay case-agnostic | test-data, test-classes, test-methods, automate-test, framework-review |
| 2026-08-24 | Reuse-before-create for methods | Before generating ANY new action/validation method, a repo-wide inventory scan of `pages/`, `apis/`, `dbs/` is mandatory (case- and suffix-tolerant, legacy `assert*`/capitalized-suffix names included): reuse an existing equivalent intent, or extend it via an optional parameter / second intent-named method — create only when nothing covers the intent. A duplicate of an existing intent is a blocking review finding | action-methods, validation-methods, automate-test, framework-review |
| 2026-08-24 | Team DB-query library | `resources/Queries/` (team-owned markdown exports; naming exception recorded in §2) is the curated DB knowledge library. Consumption is **derive-only**: consult it before authoring ANY SQL (REFINE `db:` candidates, GENERATE `<op>_query` fields, seed/verify strategy); adapt to `@param` parameterization or catalog entries; never execute its snippets raw; never copy its sample literals (identity numbers, policy numbers, IPs) into test data; embedded connection details are environment data, passwords only via `process.env`. Sessions never edit the exported files; the folder's README + index are harness-maintained | service-classes, test-data, automate-test, framework-review, test/README.md, resources/Queries/README.md |
| 2026-08-26 | Team API-collection library & AgenTeX config sources | `resources/apisCollections/` (Postman v2.1 exports) is the curated API-collection knowledge library — the API counterpart of `resources/Queries/`. Source of truth stays the team's Postman workspace; the checked-in copy is harness-curated on import via the import ritual in its README (secrets stripped, hosts parametrized as collection variables, junk requests dropped — request/response semantics never altered). Consumption is **derive-only**: consult it before authoring ANY API endpoint (REFINE `api:` candidates and PROPOSED `integration/*_api.json` entries, GENERATE `<op>_serviceName` fields and payload shapes, prerequisite-dictionary `api` routes, the reusability ladder's API seed routes); never copy its sample literals (sponsor/member ids, GUIDs, IBANs, phone numbers, emails) into test data; its pre-request/test scripts are recipes to derive TypeScript logic from, never executed raw. AgenTeX integration catalogs source DB connection coordinates from `src/config/databases.ts` (credentials only via the `DB_USER`/`DB_PASSWORD` env keys) and API request definitions from `resources/apisCollections/` — never a parallel connection truth in `environments/<env>.json` | service-classes, test-data, automate-test, framework-review, test/README.md, resources/apisCollections/README.md |
| 2026-08-27 | Delivery traceability table | Every automate-test delivery commits `execution-tests/ado-suite-<id>/_traceability.md` — one section per test case, one row per executable step: `\| # \| Step \| Method \| Class \| Layer (UI/API/DB) \| Why this layer \|`. The reason column is filled ONLY on API/DB rows, as a code from the closed vocabulary `per-ADO` / `seed` / `oracle` / `cross-check` / `reroute` (+one short clause; a `reroute` must name the observable it replaced; codes combine with `+`; extending the vocabulary requires a new ruling). The PR description points to the file instead of inlining it (Azure DevOps silently truncates PR descriptions at 4000 characters), and the full table is also posted as a `closed` PR comment thread so it renders on the Overview tab. framework-review cross-checks the table against the spec (every tms id covered, every named method exists on the named class, reasons present and reroutes named) | automate-test, framework-review |
| 2026-09-01 | Doctrine ownership | Every cross-cutting rule has exactly ONE canonical home: the ruling lives as a dated row in this section; its operational procedure lives in the owning specialist playbook; every other document (CLAUDE.md, the skills README, docs/HARNESS.md, sibling playbooks) carries at most a one-line summary plus a pointer. Changing a rule means editing the canonical home first, then sweeping the citers. On conflict between documents, this file plus the owning playbook win — the skills README and docs/HARNESS.md are descriptive indexes, never authorities. The ownership map below records the homes of the big cross-cutting rules | every skill, CLAUDE.md, .agents/skills/README.md, docs/HARNESS.md |
| 2026-09-01 | Validation layer selection | A validation belongs at the LOWEST layer that can prove it: DB for persisted state, API for service behavior and response contracts, GUI only for what only the GUI can prove — rendering, navigation, user-visible text and state. Iron law 8 already pushes seeding down; this ruling extends the same principle to assertions. No ADO expected result is dropped or weakened by it — each is proven at the correct layer, and the pipeline's traceability table (2026-08-27) records the layer mapping. Deliberate E2E journeys keep their GUI checkpoints where the GUI itself is the thing being proven | validation-methods, automate-test (REFINE/GENERATE), framework-review |
| 2026-09-01 | Single-browser scope | The single chromium project is a ruling, not an accident: one engine keeps the rerun-reusability gate, fix-round budgets, and flake classification meaningful. Cross-browser expansion (firefox/webkit projects, per-browser greens) requires a new dated ruling plus a CI capacity plan; individual specs never add browser projects ad hoc | playwright.config.ts, automate-test, framework-review |
| 2026-09-01 | `src/` code layout | The five code layers live under `src/` — `src/pages`, `src/apis`, `src/dbs`, `src/utils`, and `src/config` (formerly `resources/config`) — separating importable framework code from everything else. `tests/` stays top-level (Playwright convention; specs are consumers of `src/`, not part of it) and `resources/` keeps only knowledge & data (`testData/`, `Queries/`, `apisCollections/`). Supersedes the §5 top-level-folders mapping. Deliberately rejected: `src/main`/`src/test` (a test repo ships no "main" artifact) and a grouping parent over the business layers (e.g. `objectModels/` — a folder earns its place only when a rule or lookup attaches to it; none would). Shorthand license: bare `pages/`, `apis/`, `dbs/`, `utils/`, `config/` in doctrine, playbooks, and prose denote these layers at their `src/` locations; the physical prefix is mandatory in the layer maps, the §2 folder table, repo trees, and machine-consumed paths (linter dirs, hook regexes, imports, markdown links). Docs and AgenTeX catalogs that pointed at `resources/config/*` now point at `src/config/*` | pom-architecture, scripts/check-conventions.mjs, scripts/hooks/guard.mjs, CLAUDE.md, docs/HARNESS.md, .env.example, environments/, integration/, every playbook (shorthand) |
| 2026-09-08 | Assertion-message facade | Every `expect()` whose matcher carries/asserts an expected value (incl. the `toBeTruthy`/`toBeNull` family) goes through the generic wrappers in `src/utils/Expects.ts`, passing a business subject phrase — the wrapper composes the canonical `Expect <subject> to <verb> <interpolated expected>` message, which becomes the Allure step title (the expect message 2nd arg controls the authored title and replaces default `not`/`soft` markers, so wrappers state negation themselves; native assertion data, errors and artifacts can still expose values). Bare locator/page state checks (`toBeVisible`, `toBeEnabled`, `toBeChecked`, …) stay native `expect` (superseded same day — see the grammar-completion row below); secret-valued expectations use value-free facade variants for title protection only (iron law 7). `expect.poll` keeps its failure-sentence `message` option (it doubles as the timeout text) — the option must be present; grammar migration fix-when-touched. Amends utility-classes practice 1: the utils ban narrows to BUSINESS assertions — the domain-free assertion facade is the recorded exception. Enforced warn-level by `check-conventions.mjs` `assertion-message` | utility-classes §18 (facade contract), validation-methods §13 (call-site usage), scripts/check-conventions.mjs, examples/src/utils/Expects.ts |
| 2026-09-08 | Assertion grammar completed; `locator.describe()` rejected | Supersedes the "stay bare" clause of the Assertion-message facade row (same day): argument-less state matchers (`toBeVisible`/`toBeHidden`/`toBeEnabled`/`toBeDisabled`/`(not.)toBeChecked`, …) also go through the `Expects` wrappers — ONE grammar for every assertion title (`Expect <subject> to <verb>[ <value>][ → <selector-tail>]` — locator-backed wrappers delimit Playwright's appended selector tail with `→`; value/page receivers get no tail, hence no delimiter). Business classes carry no direct `expect()` at all — secret-valued expectations use the facade's value-free secret variants (`expectToContainSecretText`, `expectToHaveSecretValue`: value asserted, never titled); the only native `expect` left is the facade itself plus utils-internal non-asserting probes (titled `Probe …`, outcome swallowed by design). `locator.describe()` is REJECTED: the raw selector rendering in step titles is the diagnostic/evidence layer — report-only triage needs it (local runs carry no trace at retries:0), reviewers audit selectors from it, and a description can drift from the selector it decorates while the selector cannot lie; `describe()` would replace it in every title. Enforced by the extended `assertion-message` NEEDS_MSG vocabulary | utility-classes §18, validation-methods §13, scripts/check-conventions.mjs, examples/src/utils/Expects.ts |
| 2026-09-08 | Timeout policy | `src/config/timeouts.ts` single-sources the timing budgets (practice-17 pattern): TEST/EXPECT/ACTION/NAVIGATION defaults consumed by `playwright.config.ts`, plus the named `SLOW_SURFACE_MS` hotspot tier referenced inline by slow-surface waits. An inline timeout is a DOCUMENTED DEVIATION in either direction: the named tier above the default, utils retry-ladder budgets below it (mechanism — never sweep). `expect.poll` budgets + intervals are pinned inline BY CONVENTION — NOT config-immune: Playwright falls back `poll.timeout ?? expect.timeout` (PW 1.62.1 expect.js:13382), so an omitted poll timeout silently inherits the assertion default — always pin poll budgets inline; `tests/` `test.setTimeout` budgets stay per-test. Extends the "inert `metadata.timeout` configures nothing" precedent (§1). Enforced warn-level by `check-conventions.mjs` `timeout-below-default` (lockstep constant EXPECT_DEFAULT_MS mirrors the config) | playwright.config.ts, scripts/check-conventions.mjs, validation-methods §4, utility-classes (ladders) |
| Baseline | Mechanical rule coverage | Enforce locator suffixes, class spacing, value-free credential titles and named timeout tiers. Artifact checks enforce UI/API/DB layer tokens, traceability references and consistency between verification records and specs. Semantic correctness, source intent and call-site provenance remain independent-review responsibilities. Baselines identify individual reviewed legacy findings and must never conceal new violations. | scripts/check-conventions.mjs, framework-review |
| 2026-09-14 | Spec folders per ADO plan branch + Allure epic | Specs live one folder deep under `tests/`, the folder named EXACTLY like the in-scope ADO plan's branch (e.g. a branch called "Customer Portal" → `tests/Customer Portal/` — spaces kept, quote the path in shell commands), and every test carries `allure.epic('<folder>')` directly above its `allure.feature` so the Behaviors tab nests Epic > Feature > tests. New suites scaffold into their branch folder (the fetch-suite script's suggestion + automate-test GENERATE). `testMatch` and the linter's tms-index walk are one-folder-deep aware (Playwright's default `testMatch` already recurses; the linter's own directory walk needed the same). Fixme'd tests never execute body metadata, so they render without epic/feature — pre-existing behavior, accepted | test-classes, pom-architecture, scripts/check-conventions.mjs, scripts/fetch-ado-suite.mjs |
| Baseline | Local traceability artifacts | Keep manual sources and run-specific traceability/verification artifacts in gitignored `execution-tests/`. Reviewers inspect them locally. Any authorized delivery summary must omit private source content and secret-bearing artifacts. | automate-test, framework-review |
| 2026-10-05 | Spec-schema ownership and disposable credentials | Each spec owns its JSON and complete local schema; business contracts describe operations, with small explicit parameters preferred. Externally provisioned access uses env/CI secrets; disposable credentials may be generated once per account per attempt and retained in test scope, with failure cleanup and report protection. Fixed synthetic/invalid values remain in paired JSON. Mechanical checks use dependency evidence; semantic ownership remains independently reviewed. | test-data, action-methods, validation-methods, service-classes, test-classes, test-methods, automate-test, framework-review, convention checker |
| 2026-10-06 | Simple consumer lifecycle and case-level verification | §4a is the canonical lifecycle rule: built-in isolated fixtures, optional attempted identities before creation, proven ownership and ordinary domain cleanup before disposal. Public fixtures need a concrete benefit, not a dated ruling or resource-count threshold. New candidates use review mappings and the case-assertions gate; no source-key business parameters, private interception, registries or replacement wrappers. Historical receipts remain valid history; explicit migration preserves repair counts and requires fresh review/two runs. | test-classes, test-data, service-classes, automate-test, framework-review |
| 2026-10-06 | Reporting and focused enforcement | Redaction protects selected headers/structured keys only; value-free titles do not sanitize native artifacts. Await asynchronous metadata with literal real IDs and configure reporter links. Confirmed private Playwright API usage fails without suppression; fixture/import, marker, metadata and link diagnostics are review warnings that alone do not block ordinary CI. | utility-classes §20, harness-setup, test-methods, convention checker |

**Doctrine-ownership map (2026-09-01)** — the canonical homes of the big cross-cutting rules; consult the home before editing any citer:

| Rule | Ruling | Operational procedure |
|---|---|---|
| Green-twice / rerun-reusability gate | 2026-08-24 row above | automate-test playbook §5 (VERIFY) |
| Reuse-before-create for methods | 2026-08-24 row above | action-methods playbook §8 |
| Seed via API/DB, never GUI | Iron law 8 (§4) | test-data + service-classes playbooks |
| Branch-first / PR-last | 2026-08-21 row above | CLAUDE.md + automate-test playbook §0c |
| Derive-only team libraries | 2026-08-24 + 2026-08-26 rows above | resources/Queries/README.md + resources/apisCollections/README.md |
| Legacy fix-when-touched | §2 legacy note | scripts/conventions-baseline.json (linter baseline) |
| Validation layer selection | 2026-09-01 row above | validation-methods playbook |
| Assertion-message grammar | 2026-09-08 row above | utility-classes playbook §18 (facade) + validation-methods playbook §13 (call sites) |

Still open: raw request/context field retention in service classes; getBy* stance; test-title grammar;
the assertion-message poll check accepts a `message:` token anywhere inside the balanced call
(theoretical false-negative on a warn rule — next linter-hardening pass).

## Report output contract

The retained example workflow produces: `reports/playwright-report/` (HTML), `reports/json-report/test-results.json`,
the CTRF JSON (`ctrf/ctrf-report.json`), root `allure-results/`, and root `allure-report/`
(generated after reporter flush by `src/utils/AllureReport.ts`). **Warning:** the allure-playwright `outputFolder`
option in `playwright.config.ts` is dead in v3 — results land in the root default —
never copy that key into new configs. Any path change lands in lockstep across
`playwright.config.ts` + global-setup/teardown + the README report table + the CI
artifact steps, in the same MR.

For the sequential shared-runtime and generation workflow, follow [reporting](../../../../docs/reporting.md). Its fresh consumer report directories and Allure `resultsDir` keep invocations isolated without changing the retained example paths. Report validated verdicts; keep report delivery failures separate. Native Allure detail does not replace the source-coverage verifier or two-green readiness gate.

## Repo shell & README

- `package.json` `name` matches the repository — ❌ leftover scaffold names (the legacy
  demo ships `"name": "vscode-projects"`).
- Install via `npm ci` / `npm install` — never per-package install steps that bypass the
  lockfile (❌ the illustrative counterexample README: "Install **Playwright Framework** with the
  following commands in order: `npm install playwright --save-dev` &
  `npm install @playwright/test --save-dev`").
- The README is the runbook. Required content: setup, run-command variants, the env
  flags consumed by utils/lifecycle scripts (`AUTO_ALLURE_OPEN`, `API_CONSOLE_LOGS`,
  `DB_CONSOLE_LOGS`), and a report-locations table that mirrors the reporter config —
  updated in the same MR as any reporter change.

## 6. MR review checklist (the fingerprint)

- [ ] New code sits in the correct layer and folder; dependencies point downward only
- [ ] Names follow §2 (classes, methods, locator postfixes, file names)
- [ ] Class anatomy follows §3 (order, banners, spacing)
- [ ] Locators encapsulated, reliable, and built per the element-locators skill
- [ ] Ordinary actions contain no assertions; validations start with `verify` and sit last; lifecycle cleanup guards/postconditions follow §4a
- [ ] Every action/validation wrapped in a business-titled Allure step; no secrets in titles
- [ ] Every assertion goes through the `src/utils/Expects.ts` wrappers with a business subject phrase (`Expect <subject> to <verb>[ <value>]` step titles); business classes carry no direct expect() — secret values use the facade's secret variants (validation-methods §13)
- [ ] No business exception handling or general control flow outside `utils/`; small lifecycle guards and reviewed technical fixture exceptions follow §4a
- [ ] No hardcoded scenario data — paired JSON/config supplies inputs and explicit expectations; disposable generation follows §4a
- [ ] Each spec owns its paired JSON; any explicit complete schema stays local, with no unnecessary named interfaces, shared aggregate schemas, case-data bases or common value containers
- [ ] Business methods receive operation-sized inputs, never complete spec-schema dependencies; necessary shared operation types have demonstrated reuse; useful typing is preserved, never replaced with `any`
- [ ] Credentials classified by provenance: external access via env/CI, fixed synthetic inputs in paired JSON, disposable generated values retained/reused in test scope
- [ ] Required cleanup follows §4a: retain attempted identities before mutation, reconcile ownership, preserve foreign records, verify absence/restoration, and keep original failures; report protection is limited as documented in utility-classes §20
- [ ] Each test: independent, parallel-safe, re-runnable, ≥1 validation, awaited `allure.feature` plus a real literal `allure.tms` or local `allure.testCaseId`
- [ ] Setup seeds via API/DB, teardown cleans up before disposal; built-in isolated page/context by default, justified public fixtures preserved
- [ ] Prerequisites seeded through API/DB layers wherever a lower-layer path exists
- [ ] Data unique per case AND per run: mutable inputs live in the case's `tc<id>` cluster, TC id in the base value (suffix-tolerant fields; format-constrained fields get distinct valid per-case values instead), module timestamp appended by default with extra discrimination only when needed; no two tests share a mutable record or key (rows of one parameterized case share its cluster by design)
- [ ] Every new action/validation method justified against the repo-wide method inventory (`pages/`, `apis/`, `dbs/`) — reuse or extend before create
- [ ] New SQL sourced from `resources/Queries/` where a matching team query exists; all SQL `@param`-parameterized
- [ ] New API endpoints sourced from `resources/apisCollections/` where a matching request exists; no collection sample literals in test data
- [ ] Report/artifact path changes landed in lockstep across all touchpoints (config, lifecycle scripts, README table, CI)
- [ ] Report-facing behavior preserved (step nesting, attachment names) — checked in Allure
- [ ] Code formatted; only what the current tests need was built

<a id="m3-package-and-consumer-clarification"></a>

## Package and consumer clarification

Canonical instructions are immutable package content; consumer state and reviewed
knowledge follow [the shared root contract](../../ROOTS.md). New observations remain
candidates until reviewed and sanitized. Sequential harness dispatch remains the default;
parallel safety of generated tests does not authorize early parallel harness execution.
Temporary owned fixtures normally clean up; restore existing data only when the scenario
requires it. Intentionally persistent outcomes may remain. Before-state capture is
conditional. Reviewed catalogs, deterministic helpers and fixed parameterized inline
definitions are valid peers; catalogs are not mandatory authorization or migration formats.
These clarifications govern older shorthand in the preserved convention examples.
