---
name: pom-architecture
description: "Use when designing, structuring, extending, or reviewing anything in this Playwright/TypeScript test framework — folder layout, POM layering, naming conventions, business-vs-technical separation, Allure reporting strategy, updating existing ADO test-case content, or deciding where new code belongs. Also use when asked to \"automate\", \"script\", or \"create scripts for\" a test case, test suite, user story, or an Azure DevOps suite/test-case id — that request spans layers and starts here. This is the entry point and router — start here, then follow the specialist skill it routes you to."
---

# POM Architecture (Entry Point & Router)

Resolve this skill to its real path before following references. Read the
[package and consumer boundaries](../ROOTS.md); mutable state belongs to the consumer.

This framework implements the Page Object Model with **no base classes**, a strict
**business / technical split**, and **Allure-first reporting**. Every structural or
convention question is answered by one authority chain:

1. Read the canonical shared law: [design-conventions](references/design-conventions.md)
2. Route the specific task to its specialist skill (table below)
3. The actual project files are the living style reference — when in doubt, read the
   closest existing sibling (e.g. a new page class starts from [LoginPage.ts](../../../examples/src/pages/LoginPage.ts))

For a specific item on a list page, follow [record targeting (§4b)](references/design-conventions.md#4b-record-targeting-on-list-pages): observe suitable search and its scope, verify the exact row identity before acting, and preserve scenario-intent exceptions. Do not infer search capability from a generic input.

## Layer map

```
tests/        → spec files: orchestrate business flows, carry Allure metadata. Zero logic.
                (top-level by design — specs are consumers of src/, not part of it)
                One folder deep when specs are grouped by suite/initiative — e.g.
                tests/<Suite Folder>/<Feature>Tests.spec.ts, folder named exactly like
                the grouping it represents (spaces kept; quote the path in shells) — see
                the 2026-09-14 Decision-records ruling in design-conventions.md
src/pages/    → GUI business layer: page classes (locators + actions + validations)
src/apis/     → API business layer: Apis<Domain> service classes
src/dbs/      → DB business layer: Dbs<Domain> service classes
src/utils/    → technical layer: ApiActions / DBActions facades — technical complexity lives here; small domain cleanup guards stay in services
src/config/   → environment & DB coordinates, values from .harness/targets.json or process.env (formerly resources/config/)
resources/    → testData/ (one JSON per spec, per-case tc<id> clusters) + Queries/ (supplied and reviewed discovered DB-query knowledge — derive-only, see service-classes) + apisCollections/ (team API-collection knowledge library — derive-only, harness-curated on import, see service-classes)
playwright.config.ts → baseURL, reporters (Allure/HTML/JSON/CTRF), projects, global setup/teardown
global-setup.ts / global-teardown.ts → run lifecycle (technical family): run hygiene only, details in utility-classes
.github/workflows/playwright.yml → CI: checkout → setup-node → npm ci → npx playwright install --with-deps → AUTO_ALLURE_OPEN=false npx playwright test → upload report artifacts; branch filter must match the repo's default branch
```

Bare layer names (`pages/`, `apis/`, `dbs/`, `utils/`, `config/`) anywhere in the skill
library are shorthand for these `src/` locations (2026-09-01 layout ruling).

Dependencies point strictly downward: tests call business classes; business classes call
utils; nothing reaches upward or skips a layer (a spec never calls `page.locator()` or
`request.fetch()` directly).

## Routing table

| Working on | Specialist skill |
|---|---|
| Requirements/story analysis, editable chat review and confirmed story comments with requested team mentions | [requirements-analysis](../requirements-analysis/SKILL.md) |
| Plan a testing cycle's objectives, risk-based scope, strategy, feasibility and measurable criteria | [test-planning](../test-planning/SKILL.md) |
| Design or revise source-grounded test cases, review complete coverage in chat and optionally publish approved create/update/reuse proposals | [test-case-design](../test-case-design/SKILL.md) |
| Draft/review a bug from selected story context, a user description or verified execution evidence, including project-specific fields and approved attachments | [bug-report](../bug-report/SKILL.md) |
| Identify affected areas and recommend regression scope for a selected story, bug fix or requirement/application/framework change | [impact-analysis](../impact-analysis/SKILL.md) |
| Automating story-linked cases, an ADO suite or local scenarios into durable POM code | [automate-test](../automate-test/SKILL.md) |
| Executing ADO manual cases interactively, with reports and optional bug/result delivery | [execute-test](../execute-test/SKILL.md) |
| Updating existing ADO case titles, actions, expected results or ordinary-step ordering | [Case editing](../../../docs/ado-case-editing.md) |
| Diagnose only or diagnose and fix failed/flaky/changed/blocked tests, including combined analysis-and-repair requests and requested workflow resumption | [maintain-test](../maintain-test/SKILL.md) |
| A page class (new page, header/footer/skeleton area, refactor) | [page-classes](../page-classes/SKILL.md) |
| Finding, naming, or repairing an element locator | [element-locators](../element-locators/SKILL.md) |
| A spec file's skeleton — describe block, hooks, wiring | [test-classes](../test-classes/SKILL.md) |
| An individual test case — title, metadata, flow, scope | [test-methods](../test-methods/SKILL.md) |
| An action method on a page/service class | [action-methods](../action-methods/SKILL.md) |
| A validation/assertion method | [validation-methods](../validation-methods/SKILL.md) |
| Test data files, expected values, environment data | [test-data](../test-data/SKILL.md) |
| An `Apis<Domain>` or `Dbs<Domain>` service class | [service-classes](../service-classes/SKILL.md) |
| Technical plumbing in `utils/` (logging, attachments, connections) | [utility-classes](../utility-classes/SKILL.md) |
| Installing, updating or configuring the harness itself — environments, targets, secrets, CI | [harness-setup](../harness-setup/SKILL.md) |
| Explicitly invoke snapshot-only Q&A; ordinary questions do not activate it | [context-qa](../context-qa/SKILL.md) |
| Build or update selected business context with saved or new criteria | [project-context](../project-context/SKILL.md) |
| Refresh saved business sources and discover new criteria matches | [context-update](../context-update/SKILL.md) |

Select the workflow by the requested outcome. A story/bug ID or failure report alone
does not select maintenance. Impact-only requests produce recommendations without
diagnosis, test execution or repairs; maintenance reuses the shared impact procedure
inside its existing assessment/history.

Cycle planning is optional and distinct from actual progress tracking. An accepted
plan can inform scoped design/execution; it does not create cases, accept unstated
expectations or replace execution, review, verification or repair gates.
