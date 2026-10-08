# Skill Library — Playwright/TypeScript Test Framework


All convention and workflow skills are maintained in this canonical library.
Mutable state belongs to the consumer as specified in [ROOTS.md](ROOTS.md).

Convention skills for this repository, structured SHAFT-style: each skill is a thin
`SKILL.md` router plus a detailed `references/playbook.md`. The entry point is
**[pom-architecture](pom-architecture/SKILL.md)**; its
[design-conventions.md](pom-architecture/references/design-conventions.md) is the single
canonical law every specialist builds on — the merged "check everything at once" review
checklist lives in its §6. This README itself is a descriptive index: on any conflict,
design-conventions and the owning playbook win (doctrine-ownership ruling, 2026-09-01).

The library preserves conventions and illustrative examples from earlier framework
audits. Current package boundaries are described in the [harness reference](../../docs/architecture.md);
open convention decisions remain in design-conventions.

For standalone ADO manual runs use [execute-test](execute-test/SKILL.md); automation generation stays with automate-test.

| # | Skill | Playbook | Use when (description) | Key checkpoints |
|---|-------|----------|--------------------------|-----------------|
| 1 | [pom-architecture](pom-architecture/SKILL.md) | [design-conventions](pom-architecture/references/design-conventions.md) | Entry point & router — folder layout, POM layering, naming, business-vs-technical split, where new code belongs; also the starting point for "automate / create scripts for" a test case, suite, story, or Azure DevOps id | Code sits in the correct layer, dependencies point downward only; naming table (§2) followed (top-level folders lowercase, `resources/` subfolders camelCase — never `test-data/`); class anatomy order (§3); 12 iron laws (§4) incl. prerequisites seeded through API/DB layers wherever a path exists; Java-era rules never reintroduced (§5); report output contract — path changes land in lockstep (config, lifecycle scripts, README, CI; the allure `outputFolder` key is dead in v3); run-lifecycle scripts = run hygiene only; layers created on first need |
| 2 | [page-classes](page-classes/SKILL.md) | [playbook](page-classes/references/playbook.md) | Creating/refactoring a page class — new page object, skeleton area (header/footer/menu), member order, constructors | One class per HTML page and per skeleton area; **ownership follows the rendering page** — never flow-scoped classes; small confirmation pages get their own class with the FULL anatomy; fixed member order + `///// Actions` / `///// Validations` banners (check contents, not presence; legacy variant zoo folds on touch); `url` field only when a method consumes it; file name = exported class name; no dead members; no base classes; no try/catch/loops |
| 3 | [element-locators](element-locators/SKILL.md) | [playbook](element-locators/references/playbook.md) | Choosing, naming, or repairing a locator; strict-mode failures; collections; upload inputs | `camelCaseName_typeSuffix` lowercase, `private readonly`, closed §2 vocabulary + legacy-suffix mapping (`_Text`→`txt`, `_CheckBox`→`checkbox`, …); evaluation order `#id` → `[name=…]` → `[data-qa=…]` → handcrafted relative XPath → relative CSS; `id=` engine prefix banned; class selectors match the minimal **semantic** token (never Bootstrap chains); over-indexing covers CSS too (`+ p + p`, `:nth-*`); land on the interactive element; uploads target `input[type="file"]` itself; attribute-value interpolation in dynamic methods is legal, text/structure interpolation is not |
| 4 | [test-classes](test-classes/SKILL.md) | [playbook](test-classes/references/playbook.md) | Spec file skeleton — naming, describe block, hooks, wiring, disabling tests | One feature per spec; tests first, hooks below; standard Playwright import and built-in isolated page by default; reset optional cleanup candidates before fixture setup, retain attempted identities before creation, and clean through domain methods before disposal; lifecycle checks and partial-setup guards follow design-conventions §4a |
| 5 | [test-methods](test-methods/SKILL.md) | [playbook](test-methods/references/playbook.md) | An individual test case — title, Allure metadata, body flow, coverage | One behavior per test (deliberate E2E journey is the exception — checkpoint validations after each irreversible leg); **every GUI journey leg lives in the test body** — hooks prepare invisible state; variants are sibling tests, never forked files; descriptive title with no channel markers (`(Ui & Api)` etc.); await asynchronous metadata; `allure.feature` matches the describe + a literal real `allure.tms` id or local `testCaseId` per test (an E2E journey covering several tracked cases carries one per covered case); ≥1 `verify*` call; glue never invents or transforms data (no numeric literals, no `parseInt`) |
| 6 | [action-methods](action-methods/SKILL.md) | [playbook](action-methods/references/playbook.md) | Writing/reviewing an action method — naming, steps, params, dialogs, uploads, scrolling, interaction verbs | **Reuse-before-create gate (2026-08-24): repo-wide inventory scan of `pages/`/`apis/`/`dbs/` before ANY new action/validation method** — reuse or extend an existing intent, create only what nothing covers; camelCase verb phrase named for the intent (`addProductToCart`, not the first click); whole body in exactly one Allure step; titles interpolate 1–3 identifying inputs — never the full payload, never passwords/card data; ≤ ~4 positional params, forms take one typed object; no `expect()` inside actions; dialogs via `page.once` inside the step before the trigger (`page.on` banned); uploads via `setInputFiles` titled with the file name; scrolls step-wrapped, `scrollIntoViewIfNeeded()` preferred; verb-per-control map (`selectOption`, `check()`/`uncheck()`); public ⇒ step-wrapped, private helper ⇒ step-less |
| 7 | [validation-methods](validation-methods/SKILL.md) | [playbook](validation-methods/references/playbook.md) | Writing/reviewing a validation method; matcher choice; migrating legacy `assert*`/`assertOn*`/`validate*` | `verify*` prefix (legacy `assert*`, `assertOn*`, `validate*` all migrate, step titles with them); the repo-wide reuse-before-create gate applies to `verify*` methods too (2026-08-24); placed last under `///// Validations`; one step titled "Verify …" interpolating the distinguishing parameter; `toHaveText` by default — `toContainText` only for genuine composite text; no boolean-collapsed expects or untyped `.find()+?.` — use the canonical collection shapes; body-embedded status codes assert transport **and** body, parameterized; scenario checks stay in bodies; domain cleanup postconditions are allowed in teardown; typos are defects, not protected legacy |
| 8 | [test-data](test-data/SKILL.md) | [playbook](test-data/references/playbook.md) | Data files, expected values, env settings, secrets, fixtures, unique data, seed & cleanup | One JSON per spec — name derived mechanically (`<Feature>Tests.spec.ts` ↔ `<Feature>TestJsonFile.json`, legacy aliases rejected); folder exactly `resources/testData/`; binary fixtures under `resources/testData/fixtures/<Feature>/` with the path stored **inside** the JSON; `testData` frozen at parse — no runtime key injection; schema/credential ownership follows design-conventions §4a; payment cards synthetic + clustered; uniqueness = per-case `tc<id>` clusters with the TC id inside the base value + a module timestamp by default (add a discriminator for a concrete collision need; format-constrained fields get distinct valid per-case values, no suffix); fixed synthetic passwords stay in paired JSON, with generation only when needed; the reusability ladder (unique data → API/DB seed-and-cleanup via `resources/apisCollections/` (API) + `resources/Queries/` (DB) → GUI cleanup last resort); cluster related values; universal values deliberately duplicated per spec |
| 9 | [service-classes](service-classes/SKILL.md) | [playbook](service-classes/references/playbook.md) | `Apis<Domain>` / `Dbs<Domain>` classes — endpoints, queries, lifecycle | Every endpoint/SQL string is a `readonly` `<op>_serviceName` / `<op>_query` field; new SQL sourced from the team query library `resources/Queries/` first (derive-only, 2026-08-24); new API endpoints sourced from the team collection library `resources/apisCollections/` first (derive-only, 2026-08-26); **all raw context verbs banned** (`.get/.post/.delete/…`, not just `.fetch()`) — an unused `apiActions` field is the bypass smell; `<Domain>` is a business-area noun, never an echo of one endpoint; SQL always `@param`-bound; `verify*` validations last, titles interpolate the distinguishing parameter; `close()` from `afterAll`; no hardcoded base URLs or payloads |
| 10 | [utility-classes](utility-classes/SKILL.md) | [playbook](utility-classes/references/playbook.md) | Anything in `utils/` — facades, logging, attachments, redaction, connections — plus global lifecycle scripts | Litmus: utils = "how it's done reliably", zero domain nouns or `expect()`; one `<Noun>Actions` facade per technology; step per operation, `test.info().attach()` inside the step (never `step.attach()`); never-throw reporting — incl. **no `process.exit(1)` in reporting-only teardown**; global-setup/teardown = honorary utils, run hygiene only, no test context; report paths: one source in code, lockstep copies in docs/CI; `AUTO_ALLURE_OPEN` documented opt-out, desktop behaviors off when `CI` is set; facades stateless (no log buffers/file persistence); facade evolution preserves the report-facing surface |

## Workflow skills

| Skill | Use when |
|---|---|
| [automate-test](automate-test/SKILL.md) | Turning story-linked cases, ADO suites or local scenarios into reviewed POM automation with two scoped green runs |
| [framework-review](framework-review/SKILL.md) | Reviewing a change against the conventions and producing a verdict |
| [plan-tracker](plan-tracker/SKILL.md) | Recording a tracked plan's progress and regenerating its report |
| [harness-setup](harness-setup/SKILL.md) | Installing, updating, configuring or rolling back the harness in a project |

## Checking them together

- **Chain of authority:** every specialist rule traces back to
  [design-conventions](pom-architecture/references/design-conventions.md). Reviewing an
  MR means walking its §6 checklist and dipping into a specialist playbook only where a
  box fails. Each playbook also ends with its own topic-specific review checklist.
- **Legacy is flagged, not alarmed:** the playbooks label illustrative noncompliant patterns as counterexamples —
  *fix-when-touched*, so a full review of untouched files produces no false alarms.
- **Open decisions:** settled rulings live in the "Decision records (team rulings)"
  section of [design-conventions](pom-architecture/references/design-conventions.md);
  the remaining open topics are exactly the three on that section's "Still open" line
  (raw request/context field retention in service classes, `getBy*` stance, test-title
  grammar) — decide them as a team, then record each
  ruling as a row in the Decision records section.

## Roadmap — candidate next skills

Candidates awaiting a team decision — each lands first as a Decision-records ruling, per that section's process:

- **Environment switching** (`TEST_ENV` + per-env config diff) — why: env targeting must be canon before it is improvised per spec.
- **storageState login optimization** — why: pay the login cost once per run, not once per test; needs a ruling vs the beforeEach-login pattern.
- **Tag taxonomy** — why: a closed vocabulary beyond `@smoke`/`@regression` (the 2026-08-21 set) once suites need finer run selection.
- **Localization/RTL validation rules** — why: a canonical stance on asserting localized/RTL text (source of truth, matcher choice) before such checks multiply.
