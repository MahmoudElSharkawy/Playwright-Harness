<!-- Template: replace <your-repo> with your repository name. Everything else is
     project-agnostic convention and can be adopted as-is. -->

# <your-repo> — Playwright/TypeScript POM test framework

## Branch & delivery rule (repo-wide, with advisory hooks)

**Never commit to or push master/main directly.** Reuse the ongoing feature branch and add commits instead of creating a branch per milestone. Every change — framework code,
skills, scripts, docs — rides a purposefully-named feature branch
(`automation/ado-suite-<id>-<slug>` for pipeline output, `harness/<topic>` for
harness work, `fix/<topic>` otherwise) and lands through a pull request
(`node scripts/ado-pr.mjs`). The current PreToolUse hook is advisory and fail-open;
it does not replace this rule or a remote branch policy.

Mechanical enforcement exists — don't rely on memory alone:
`node scripts/check-conventions.mjs --changed` lints the grep-able conventions
(hooks run it automatically after edits, warn-only; known legacy violations live in
`scripts/conventions-baseline.json` — fix-when-touched, never extend it to silence a
new violation). An identical failed `npx playwright test` command cannot be rerun
until something is edited (classify the failure instead).

## Skill-first rule (applies to every session in this repo)

This repo ships a convention skill library in `.agents/skills/`. For **any** work on
framework code — creating, extending, refactoring, or reviewing — invoke the matching
skill(s) with the Skill tool **before** touching files, even when the user never mentions
a skill by name. Infer the intent from the request and route via the table below. Never
restate skill content from memory: read the SKILL.md and follow it into its
`references/` playbook when routed there.

When several layers are involved, start with `pom-architecture` (the entry point and
router) and follow its routing table.

## Intent → skill routing

| When the user asks to… | Invoke |
|---|---|
| "Automate suite `<id>`" / "automate plan `<id>` suite `<id>`", "fetch the cases from Azure and automate them", "run the ADO suite and generate the scripts", or resume any phase of that pipeline (fetch / explore / generate / verify) | `automate-suite` — the end-to-end pipeline orchestrator (it routes into the layer skills below itself) |
| "Automate this test case / test suite", "create scripts for Azure (DevOps) suite `<id>` / test case `<id>`", "write automation for this story / scenario" | `pom-architecture` first, then the per-layer skills below as the work touches each layer |
| Create or restructure a spec file — naming, `test.describe`, hooks, setup/teardown | `test-classes` |
| Write, review, or refactor an individual test — title, Allure metadata, tags, body flow | `test-methods` |
| Create or extend a page object, or a header/footer/side-menu (skeleton) class | `page-classes` |
| Find, name, or repair a locator; strict-mode violation; dynamic/parameterized locators | `element-locators` |
| Write or review an action method — naming, Allure step, params, dialogs, uploads | `action-methods` |
| Write or review a `verify*` method; matcher choice; migrate legacy `assert*` | `validation-methods` |
| Add or change test data — JSON files, expected values, secrets, unique per-case/per-run data (`tc<id>` clusters) | `test-data` |
| An `Apis<Domain>` / `Dbs<Domain>` class — endpoints (sourced from the team API-collection library `resources/apisCollections/`), SQL queries (sourced from the team library `resources/Queries/`), lifecycle | `service-classes` |
| Anything in `utils/` — facades, logging, Allure attachments, global setup/teardown | `utility-classes` |
| Review a diff/MR against the conventions, "run framework review", the GENERATE exit gate | `framework-review` — mechanical linter + §6 walk + verdict (independent reviewer, never the author) |
| "Update / regenerate the plan tracker", "record these cases as done/blocked", "sync the tracker", "where are we on the plan" — any change to the tracked plan's progress or scope | `plan-tracker` — registry + append-only history in `.agents/skills/plan-tracker/data/`, rendered by `scripts/generate-tracker.mjs` |
| Folder layout, naming, where new code belongs, or a full MR/code review | `pom-architecture` |

## The common flow: automating a test case end-to-end

**Packaged version:** when the request names an Azure DevOps plan/suite id, the whole
flow below (plus fetching the cases and verifying the result) is the `automate-suite`
skill — `/automate-suite <planId>/<suiteId>`. It branches first
(`automation/ado-suite-<id>-*`), fetches the suite's cases into
`test/ado-suite-<suiteId>/` (via `scripts/fetch-ado-suite.mjs`), refines them for
executability (scope-preserving, every change logged), executes them with AgenTeX
(`/execute-test` — a mandatory phase; only an explicit user "generate directly"
skips it), generates the POM automation through the skills below (exit gate:
independent `framework-review`, with a reuse-before-create method inventory), loops
`npx playwright test "tests/<Suite Folder>/<Feature>Tests.spec.ts"` (quoting matters
when the folder name has spaces) until honestly green twice in a row (the
rerun-reusability gate; a bare, unscoped `npx playwright test` is the single-project
POM regression, never a green-earning run for one spec),
and delivers: PR (`scripts/ado-pr.mjs`), outcomes to ADO test points, and — after
merge — the automation-status field on the cases
(`scripts/publish-ado-results.mjs`). Use the manual sequence only for a single
pasted test case or when deliberately doing one layer by hand.

A request like "create scripts for test case 12345" means: turn a manual test case into
framework-conformant automation. Follow this sequence, skipping skills for layers that
already exist and are not changing:

1. Obtain the test case's steps and expected results (from Azure DevOps tooling if
   available in the session, otherwise ask the user to paste them).
2. `pom-architecture` — decide which layers the scenario touches and where code belongs.
3. `test-data` — one JSON per spec; inputs, expected values, secrets placement.
4. `page-classes` + `element-locators` + `action-methods` + `validation-methods` — build
   or extend the page objects the journey needs.
5. `service-classes` — API/DB prerequisites and seed/cleanup (iron law: seed through
   API/DB wherever a path exists, never through the GUI).
6. `test-classes` + `test-methods` — the spec skeleton, hooks, and the test itself; the
   Azure DevOps test-case id goes into `allure.tms()`.

For reviews, `pom-architecture`'s design-conventions §6 is the merged checklist; dip into
a specialist playbook only where a box fails.

- `executions/` holds generated test-run artifacts (reports, screenshots, logs).
  Never read or search it when gathering context — only when explicitly asked
  about a specific run. Sanctioned exception: the `automate-suite` pipeline reads
  the `codegen-notes/` (selector/network harvest written for exactly that purpose)
  of the run its suite manifest records — nothing else in the folder.
