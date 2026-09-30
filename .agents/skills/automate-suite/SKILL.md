---
name: automate-suite
description: Load a local scenario suite or an explicitly configured ADO suite, preserve its assertions during refinement, and route automation work to the canonical POM skills.
---

# Automate a Scenario Suite

Resolve this skill to its real path before following references. Read the
[package and consumer boundaries](../ROOTS.md); mutable state belongs to the consumer.

For local input, use `/automate-suite local <source.json> on <environment>`.
Run `node <packageRoot>/scripts/load-local-source.mjs --project-root <consumer> --source <file> --environment <name>`.
Read the [local-source guide](../../../docs/M3-ADOPTION.md) and preserve every action,
expectation and optional external reference. Refinement is a separate consumer artifact;
never silently rewrite the source. ADO configuration and AgenTeX are not prerequisites.
M3 proves loading and refinement inputs; execution and generation integration are later
milestones and must not be reported as already completed.

The following ADO route is retained compatibility guidance for existing adopters.
It is not the provider-neutral runtime and does not grant external delivery permission.

One ADO suite in → one merged, ADO-visible Playwright spec out. Every phase's output
lives on disk, so any phase can be re-entered and the pipeline resumes wherever it
stopped. Detailed execution rules live in
[references/playbook.md](references/playbook.md) — read it before running any phase.

```
0. PREFLIGHT  checks + TRIAGE (blast radius × reversibility) + BRANCH (never master)
1. FETCH      scripts/fetch-ado-suite.mjs        → test/ado-suite-<suiteId>/  (specs + _suite.json)
2. REFINE     scope-preserving executability pass → same specs + "## Refinement log" per file
3. EXPLORE    /execute-test ado-suite-<suiteId>/ → executions/execu_<ts>/ + codegen-notes/
                                                   → knowledge candidates for reviewed promotion
4. GENERATE   skill-first, reuse-first POM codegen → tests/<Suite Folder>/<Feature>Tests.spec.ts (+ data, pages, services;
                                                   folder = the suite's grouping when one applies, 2026-09-14 ruling)
                                                   exit gate: independent framework-review = APPROVE
5. VERIFY     npx playwright test (bounded loop) → green twice in a row or honestly-reported (_verify-state.json)
              (a bare, unscoped `npx playwright test` is the single-project POM
              regression, not a green-earning run for one spec — always scope to the
              generated spec's own path)
6. DELIVER    commit → push branch → PR (scripts/ado-pr.mjs) → outcomes to ADO points
              (scripts/publish-ado-results.mjs) → after merge: --mark-automated
              → learning step (runs at session end regardless of merge state)
```

## Argument grammar

`/automate-suite <planId>/<suiteId>` or `<planId> <suiteId>` or just `<suiteId>`
(when `azure.testPlanId` is set in `config/project.json`). Modifiers, all optional:

- `on <env>` — environment for EXPLORE and the generated spec's target (default:
  `defaultEnvironment` in `config/project.json`).
- Sequential execution is the default. The legacy `parallel` modifier is disabled
  until the complete sequential lifecycle and later bounded-parallel milestone pass.
- A phase keyword — `fetch` / `refetch`, `refine`, `explore`, `generate`, `verify`,
  `deliver` — forces starting at that phase and continuing through DELIVER. Without
  one, resume at the first incomplete phase (see "State on disk" in the playbook).

## Hard boundaries

- **Branch-first, PR-last — never master**: all work happens on
  a suitable continuing feature branch; delivery is a pull request, and a case is
  marked `Custom.Automation = Automated` in ADO only after its PR is merged. Direct
  pushes to master/main are hook-blocked repo-wide.

- **Refinement preserves scope**: phase 2 may restructure, split, or add plumbing
  steps and bind data so the case executes smoothly — it NEVER changes what the case
  covers, drops or weakens a validation point, or invents data that must be real.
  Prose preconditions ("user has an active paid policy") are resolved against
  [references/prerequisite-dictionary.md](references/prerequisite-dictionary.md)
  into explicit seed steps, a GUI-chain expansion, or a NEEDS-FIXTURE flag — never
  left implicit. Every change lands in the spec's `## Refinement log`; unresolvable
  data gaps go to the user as NEEDS-DATA, never guessed.
- **Skill-first generation**: phase 4 NEVER writes framework code from memory — it
  routes through [pom-architecture](../pom-architecture/SKILL.md) and the per-layer
  skills exactly as CLAUDE.md's routing table prescribes.
- **Never go green by weakening**: a failing validation is fixed by repairing the
  script (locator, data, timing) or reported as an app defect — never by deleting or
  loosening the assertion. Bounded loop: 3 fix attempts per test, then report honestly.
  Green means the spec passes TWICE in a row (rerun-reusability gate, 2026-08-24
  ruling) — the confirmation run is free; fixing what it exposes is not.
- **Secrets**: PAT stays in `.env` (`AZURE_PAT` / `AZURE_DEVOPS_EXT_PAT`); never
  printed, never on a command line. Same for every other credential.
- **Never modify application source** — only framework layers listed in the layer map.
- `executions/` stays unread EXCEPT the `codegen-notes/` of the run recorded in
  `_suite.json.explore.run`, readable during phases 4–6 (a sanctioned, explicit
  exception recorded in CLAUDE.md). During phase 3 this session is the
  browser-testing orchestrator and owns the live run folder it is writing; a
  resumed session that finds a run without notes re-runs EXPLORE rather than
  mining old logs.

## Boundaries with neighboring skills

- Running the fetched manual specs in a browser → the AgenTeX **browser-testing**
  skill (invoked via `/execute-test`); this skill only prepares its input and
  harvests its output.
- Filing defects found during EXPLORE as ADO bugs → AgenTeX **bug-report-azure**.
- The generated code's conventions → the repo's per-layer skills (routed via
  [pom-architecture](../pom-architecture/SKILL.md)); this skill never restates them.
- Designing NEW test cases from a story's ACs (nothing to fetch yet) → AgenTeX
  **test-design** (`/design-test`), then come back here once the suite exists.
