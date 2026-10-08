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
| "Execute / run manual tests for ADO suite or story `<id>`", `/execute-test`, with no code generation | `execute-test` — live execution, verified reports and optional ADO delivery |
| "Automate story `<id>`", "automate suite `<id>`" / "automate plan `<id>` suite `<id>`", "automate local scenarios", `/automate-test`, or resume that code-generation pipeline (fetch / explore / generate / verify) | `automate-test` — the end-to-end pipeline orchestrator (it routes into the layer skills below itself) |
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
| "Update / regenerate the plan tracker", "record these cases as done/blocked", "sync the tracker", "where are we on the plan" — any change to the tracked plan's progress or scope | `plan-tracker` — registry + append-only history in the consumer's `.harness/state/tracker/`, rendered by `scripts/generate-tracker.mjs` |
| "Install / update the harness", "configure the harness with my project information", add an environment, target, secret or CI pipeline, roll the harness back | `harness-setup` |
| Folder layout, naming, where new code belongs, or a full MR/code review | `pom-architecture` |

## Automation workflow

Use the canonical automate-test skill and [automation procedure](docs/PIPELINE.md): load a neutral local source or explicitly configured ADO source, preserve its assertions, explore through shared runtimes, generate/reuse POM code, obtain an independent review, and earn two independent scoped green runs. Three cumulative repair rounds are available. Catalogs, helpers and fixed inline definitions are peers. Cleanup follows intent and ownership. AgenTeX is not a runtime prerequisite. External delivery uses optional Azure DevOps adapters only when authorized.

Read only the specific current run's registered evidence when preparing its generation handoff. Do not mine unrelated run artifacts for context.
