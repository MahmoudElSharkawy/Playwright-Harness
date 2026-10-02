# Automation pipeline

This guide lists the phases that turn a scenario suite into reviewed Playwright POM
automation, in execution order. Each phase gives its inputs, outputs, commands and the
milestone document that defines its contract. Those documents remain authoritative;
this guide summarizes them and links to the detail. The phase names are labels for
this guide; the milestone documents number their steps instead.

Agents run the pipeline through the
[automate-suite skill](../.agents/skills/automate-suite/SKILL.md), for example
`/automate-suite local <source.json> on <environment>`. [M15](M15-WORKFLOW-PARITY.md)
proves the complete sequential route through both native hosts; see its
[validation status](M15-VALIDATION.md).

```text
SOURCE → REFINE → EXPLORE → PREPARE → AUTHOR → CANDIDATE → REVIEW → VERIFY ×2 → READY → DELIVER
                                        ▲                    │        │                 (optional)
                                        └─ repair (max 3) ───┴────────┘
```

| Phase | Purpose | Main output | Command or interface | Contract |
|---|---|---|---|---|
| [SOURCE](#1-source) | Load scenarios unchanged | Loader record with source fingerprint | `load-local-source.mjs`, `fetch-ado-suite.mjs`, `fetch-ado-story.mjs` | [M3](M3-ADOPTION.md), [M12](M12-ADO.md) |
| [REFINE](#2-refine) | Make steps executable without changing what they prove | Frozen refinement artifact | Agent work | [M15](M15-WORKFLOW-PARITY.md) |
| [EXPLORE](#3-explore) | Run against the configured application | Run snapshot, observations, evidence | Runtime libraries | [M5](M5-EXECUTION-CORE.md)–[M10](M10-POSTGRESQL.md), [M16](M16-PARALLEL.md) |
| [PREPARE](#4-prepare) | Bind each source expectation to an observation | Generation history | `generate-tests.mjs prepare` | [M13](M13-GENERATION.md) |
| [AUTHOR](#5-author) | Write or reuse POM code | Page, service, spec and data files | Layer skills | [M13](M13-GENERATION.md) |
| [CANDIDATE](#6-candidate) | Map each scenario to one native test | Candidate revision | `generate-tests.mjs candidate` | [M13](M13-GENERATION.md) |
| [REVIEW](#7-review) | Independent attempt to refute the candidate | Recorded verdict | `generate-tests.mjs review` | [M13](M13-GENERATION.md) |
| [VERIFY](#8-verify) | Two scoped green processes | Verification receipts | `generate-tests.mjs verify` | [M13](M13-GENERATION.md), [M14](M14-REPORTING.md) |
| [READY](#9-ready) | Confirm readiness | Status | `generate-tests.mjs status` | [M13](M13-GENERATION.md) |
| [DELIVER](#10-deliver-optional) | Optional, authorized delivery | PR, published outcomes | `ado-pr.mjs`, `publish-ado-results.mjs` | [M12](M12-ADO.md) |

## Before you start

- Adopt the package into a separate consumer and select its environment profile
  deliberately ([M3 adoption](M3-ADOPTION.md)). Node 24 is the supported runtime.
- Configure the targets the scenarios need in `.harness/project.json` and
  `.harness/targets.json`: browser ([M6](M6-BROWSER.md#installation-and-targets)),
  API ([M7](M7-API.md)), SQL Server ([M8](M8-SQLSERVER.md)) or PostgreSQL
  ([M10](M10-POSTGRESQL.md)). The `environmentMode` (`test`, `protected` or `custom`)
  decides which operations are allowed. In `test`, ordinary permitted mutations need
  no per-operation approval.
- For browser work, install the pinned official Playwright CLI as described in
  [M4](M4-PLAYWRIGHT-CLI.md).
- For verification, the consumer needs Playwright Test **1.63.0**. TypeScript consumers
  enable `allowJs: true`, `checkJs: false` and `maxNodeModuleJsDepth: 1` while keeping
  `strict: true` ([M13](M13-GENERATION.md#two-independent-scoped-green-runs)).
- ADO is needed only for ADO sources or delivery. Configure it in
  `.harness/integrations.json` ([M12](M12-ADO.md#consumer-configuration)).
- Work on a feature branch, following the branch rule that setup adds to the project's
  `CLAUDE.md` and `AGENTS.md`: for example `automation/<source-id>-<slug>` for
  generated suites, delivered through a pull request.

Run harness commands from the consumer folder as `npx --no pom-harness <command>`;
`npx --no pom-harness help` lists them. The underlying scripts also accept
`--project-root <consumer>`, and the convention checker `--root <consumer>`. Store generation command inputs and review
artifacts under `.harness/state/`, so recording them does not change the candidate's
file snapshot.

## 1. SOURCE

Load the scenarios to automate without changing them. A source is a neutral local JSON
file, or an ADO plan/suite or user story exported to that format.

- **Inputs:** a local source file, for example `.harness/sources/<name>.json` (format in
  [M3](M3-ADOPTION.md#local-scenario-sources)), or an ADO plan/suite or story ID with
  ADO configured.
- **Outputs:** a loader record (`--out`) holding the source's relative path and SHA-256
  fingerprint, with status `LOADED` and `executed: false`. An ADO fetch also writes
  `_suite.json` and one Markdown spec per case under `test/ado-suite-<suiteId>/` or
  `test/ado-story-<storyId>/`; `--source-out` exports the neutral format.
- **Rules:** keep the source immutable and preserve every action, expectation and
  external reference. Each scenario needs at least one expectation. Limits are 2 MiB,
  1–500 scenarios and 1–1000 steps per scenario. `LOADED` means the source was read,
  not that anything passed. The loader refuses an existing `--out` destination. ADO
  fetches never change ADO. Parameterized or incomplete ADO cases fail conversion and
  must be refined into the neutral format explicitly.

```text
npx --no pom-harness load-source --source .harness/sources/<name>.json --environment <env> --out .harness/runs/source.json
npx --no pom-harness fetch-suite --plan <planId> --suite <suiteId> --source-out .harness/sources/<name>.json
npx --no pom-harness fetch-story --story <storyId> --source-out .harness/sources/<name>.json
```

Details: [M3 local sources](M3-ADOPTION.md#local-scenario-sources),
[M12 commands](M12-ADO.md#compatibility-commands),
[story retrieval](M12-ADO.md#story-scoped-retrieval).

## 2. REFINE

Rewrite human-oriented steps so an agent can execute them, without changing what the
scenario covers or proves.

- **Inputs:** the loaded source and reviewed consumer knowledge under
  `.harness/knowledge/`, including `prerequisites.md` for recurring setup states
  ([prerequisite knowledge](../.agents/skills/automate-suite/references/prerequisite-dictionary.md)).
- **Outputs:** a separate refinement artifact in consumer run storage, bound to the
  source and frozen before exploration. Facts that cannot be resolved, such as missing
  data or unknown setup states, are reported rather than guessed.
- **Allowed:** add implicit steps (opening the application, signing in as a configured
  user, dismissing banners); expand prose preconditions into explicit setup steps;
  split compound steps and make vague ones concrete; bind data to configured values or
  secret references; tag whether each expectation is best proven through the UI or
  through an API/DB check.
- **Forbidden:** dropping, weakening or rewording any expectation, or changing its key;
  adding validations outside the scenario's scope; inventing data that must be real.
  Report a broken source case so it is fixed at the source.

There is no command; the agent refines with native file tools. Section 2 of the
[compatibility playbook](../.agents/skills/automate-suite/references/playbook.md) has
the detailed allowed and forbidden list. Its file layout (a `## Refinement log` in each
fetched spec) is the legacy ADO one.

Details: [M15 lifecycle](M15-WORKFLOW-PARITY.md#complete-sequential-lifecycle),
[M3 local sources](M3-ADOPTION.md#local-scenario-sources).

## 3. EXPLORE

Run each refined scenario against the configured application with the shared runtimes,
and record what actually happens before any code is written.

- **Inputs:** the frozen refinement and the configured targets, capabilities and
  credential references.
- **Outputs:** one run directory per execution, for example `.harness/runs/<run-id>/`,
  holding the frozen run snapshot (`inputs.json`), `observations.json` and registered
  evidence; an assessed result; and unreviewed knowledge candidates under
  `.harness/knowledge-candidates/`.
- **Rules:** resolve uncertain effects, missing evidence and required cleanup before
  continuing. A reliable FAIL can support a failing regression test; it never becomes
  a new expected value. Cleanup follows scenario intent and ownership: temporary data is
  cleaned up, required restorations are explicit, and intentionally persistent outcomes
  may remain. Knowledge candidates need review before promotion.

Exploration uses library interfaces rather than a single command:

| Need | Interface | Contract |
|---|---|---|
| Freeze scope, environment, definitions, expectations and limits | `createRun` | [M5](M5-EXECUTION-CORE.md) |
| Browser steps through the official Playwright CLI skill | `runBrowserScenario` | [M6](M6-BROWSER.md#using-the-library) |
| API operations | `defineApiOperation`, `createApiRuntime` | [M7](M7-API.md) |
| SQL Server or PostgreSQL operations | `defineDatabaseOperation`, `createDatabaseRuntime` | [M8](M8-SQLSERVER.md), [M10](M10-POSTGRESQL.md) |
| One scenario mixing UI, API and DB (`setup`, `exercise`, `verify`, `cleanup`) | `runSequentialScenario` | [M9](M9-SEQUENTIAL.md) |
| Opt-in bounded batch of independent scenarios (default concurrency 1) | `runScenarioBatch` | [M16](M16-PARALLEL.md#calling-the-dispatcher) |

To render a saved run as JSON, Markdown and HTML reports (optional; output defaults to
a fresh `reports/harness/` directory):

```text
npx --no pom-harness render-results --snapshot .harness/runs/<run-id>/inputs.json --run-root .harness/runs/<run-id>
```

Details: [M14 execution reports](M14-REPORTING.md#validated-execution-reports).

## 4. PREPARE

Bind every source expectation to an observed result and open the generation history.

- **Inputs:** a preparation JSON file containing `source` (the neutral source file),
  `author`, `executions` (each a consumer-relative `snapshot` and `runRoot`) and
  `bindings` (`{key, runId, scenarioId, expectationId}` for every key that
  `sourceExpectations(source)` returns).
- **Outputs:** append-only generation history under
  `.harness/state/generation/<source-id>/`. The command prints `PREPARED` with the
  expectation count.
- **Rules:** preparation rebuilds and fingerprints the inputs and reassesses the
  evidence bytes; it never trusts saved result JSON. It refuses a source ID that
  already has history. Run outputs and credentials are not copied into generated test
  data.

```text
npx --no pom-harness generate prepare --input .harness/state/<preparation>.json
```

Details: [M13 steps 3–4](M13-GENERATION.md#from-source-to-a-reviewed-candidate),
[command inputs](M13-GENERATION.md#local-command-interfaces).

## 5. AUTHOR

Write durable POM code for the scenarios, reusing existing business methods before
adding new ones.

- **Inputs:** the handoff, the exploration observations and the consumer's existing
  framework.
- **Outputs:** page and service classes, specs and test data in the consumer.
- **How:** start with the [pom-architecture skill](../.agents/skills/pom-architecture/SKILL.md)
  and use only the layer skills the change touches (locators, actions, validations,
  services, test classes, test methods, test data).
- **Rules:** wrap each source expectation's original assertions in `sourceExpectation`,
  imported from the installed package's `scripts/lib/generation/assertion.mjs`, and
  keep its source key in versioned test data. Use `allure.testCaseId(<scenario id>)`
  for a local source, or the real `allure.tms` reference when one is supplied; never
  invent an ADO ID. Tests must be independent and use unique owned resources.
  Catalogs, deterministic helpers and fixed inline definitions are equally valid;
  imported team libraries are derive-only.

```ts
await sourceExpectation(test, sourceKey, async () => {
  await expectToHaveText('the confirmation message', this.confirmation_msg, expected);
});
```

Run the consumer's TypeScript check and the convention checker; the checker's file and
rule counts must be nonzero. Their results go to the reviewer. A file change after
registration invalidates the candidate, so fix check failures before registering.

```text
npx --no pom-harness check-conventions
```

Details: [M13 steps 4 and 6](M13-GENERATION.md#from-source-to-a-reviewed-candidate),
[assertion coverage](M13-GENERATION.md#shared-deterministic-operations-and-assertion-coverage).

## 6. CANDIDATE

Register the code as a candidate and map each source scenario to exactly one native
Playwright test.

- **Inputs:** a candidate JSON file with `config`, and `tests` entries of
  `{scenarioId, spec, project, titlePath}`. `titlePath` is the complete chain of
  describe and test titles. `project` is explicit, with an empty name for an unnamed
  project. Add `repair` only on later candidates (see [Repairs](#repairs)).
- **Outputs:** a frozen candidate revision covering consumer files, configured targets
  and knowledge, dependency declarations and the shared library version. The command
  prints `NEEDS_REVIEW` with the revision.

```text
npx --no pom-harness generate candidate --id <source-id> --input .harness/state/<candidate>.json
```

Details: [M13 step 5](M13-GENERATION.md#from-source-to-a-reviewed-candidate).

## 7. REVIEW

A fresh, independent reviewer tries to refute the candidate. The author cannot review
their own work, and a self-review cannot release verification.

- **Inputs:** the candidate revision, the source and handoff, file hashes and check
  results, given to a reviewer who follows the
  [framework-review skill](../.agents/skills/framework-review/SKILL.md).
- **The reviewer checks** that the executable assertions keep the source's meaning,
  including the chosen observation layer, plus reuse, selector quality, expected
  values, operation scope, cleanup and retention, imported dependencies and external
  environment references. Source keys and assertion counts prove traceability, not
  semantic equivalence.
- **Outputs:** a consumer-relative Markdown review artifact and a review JSON file with
  the revision, a reviewer identity different from the author's, the verdict
  (`APPROVE` or `CHANGES-REQUIRED`) and findings. Each finding has an ID, a blocking
  flag, a resolution (`open`, `resolved` or `accepted`) and a `reason`.
- **Rules:** an open blocking finding prevents approval. An `accepted` finding must
  point to the user's explicit acceptance in the review artifact; an agent cannot
  accept on the user's behalf. `CHANGES-REQUIRED` leads to a [repair](#repairs).

```text
npx --no pom-harness generate review --id <source-id> --input .harness/state/<review>.json
```

Details: [M13 steps 6–7](M13-GENERATION.md#from-source-to-a-reviewed-candidate).

## 8. VERIFY

Run the approved candidate in two fresh, independent Playwright processes. Both must
pass the same reviewed candidate.

- **Inputs:** the approved candidate and the consumer's Playwright Test 1.63.0.
- **Outputs:** one verification receipt per process (`PASS`, `FAIL`, `BLOCKED` or
  `NEEDS_REVIEW`). Exit code 0 is a pass, 1 an unsuccessful verification and 2 a
  failed precondition.
- **How it runs:** the verifier collects tests first and stops if the selection would
  also run an unselected test. It forces one worker, zero retries and one repetition,
  forbids `only`, disables project dependencies and bounds time and output. Put
  required prerequisites in reviewed per-test fixtures or hooks.
- **What counts as green:** every selected test runs once, passes, and runs every
  mapped `sourceExpectation` with at least one native assertion. Missing or extra
  tests, duplicate markers, empty callbacks, caught assertion failures, skips,
  expected failures, soft failures, flaky retries and nonzero exits never count.

```text
npx --no pom-harness generate verify --id <source-id>
npx --no pom-harness generate verify --id <source-id>
```

For optional Allure 3 capture, add `--allure` to `verify` and render after it returns.
This needs `allure-playwright` 3.13.0 and the Node-based `allure` 3.19.1 in the
consumer; Java is not required. Reporting never grants or revokes a green.

```text
npx --no pom-harness generate verify --id <source-id> --allure
npx --no pom-harness generate-allure --input reports/generation/<verification-id>
```

Details: [M13 verification](M13-GENERATION.md#two-independent-scoped-green-runs),
[M14 Allure](M14-REPORTING.md#generated-playwright-tests-and-allure).

### Repairs

After a failed verification or a `CHANGES-REQUIRED` review, fix the code, rerun the
checks and register a new candidate with `repair` set to `script-defect`,
`environment` or `review-findings`. Then go through REVIEW and VERIFY again.

- Each source batch has **three cumulative repair rounds**, including environment-only
  fixes.
- A repair resets the review and the green count, never the history.
- An unchanged failed or interrupted candidate cannot be rerun until it turns green.
- Genuine application failures stay failures. Never repair them by weakening
  assertions.
- After an interruption, reconcile possible effects and required cleanup before
  replaying, and include that evidence in the new review. An abandoned process leaves
  its `STARTED` record, reported as `NEEDS_REVIEW`. A stale writer lock needs an
  operator to inspect it; there is no automatic takeover.

Details: [M13 verification](M13-GENERATION.md#two-independent-scoped-green-runs).

## 9. READY

Check whether the candidate is ready:

```text
npx --no pom-harness generate status --id <source-id>
```

`READY` means the current approved candidate has two scoped greens from distinct
processes, and its review and receipts are intact. Each green receipt is
integrity-checked again when status is requested. `READY` does not authorize delivery.
The hash-linked history detects accidental edits and gaps; it is not tamper-proof
against the filesystem's owner.

Details: [M13 verification](M13-GENERATION.md#two-independent-scoped-green-runs).

## 10. DELIVER (optional)

Delivery happens only when the user authorizes it. The generation commands never
contact ADO, create PRs, publish, push or merge.

- **Inputs:** a READY candidate committed on a pushed feature branch, and ADO
  configuration for ADO delivery.
- **Outputs:** a PR, published test outcomes and work-item updates, each with a durable
  write receipt.
- **Rules:** remote mutation commands preview by default; repeat with `--execute` after
  authorization. Outcome publication is suite-scoped, because test points exist only
  inside a plan/suite. Run `--mark-automated` only after the PR is merged. The harness
  never pushes, merges or changes branch policy.

```text
npx --no pom-harness pr --source <branch> --title "<title>" --description-file <description>.md
npx --no pom-harness publish-results --suite <suiteId>
```

Details: [M12 commands](M12-ADO.md#compatibility-commands),
[publication and linking](M12-ADO.md#publication-and-linking).

## Where state lives

| Path | Contents |
|---|---|
| `.harness/sources/` | Versioned scenario sources |
| `.harness/runs/` | Loader records, exploration runs and evidence (ignored) |
| `.harness/knowledge/` | Reviewed, sanitized project knowledge |
| `.harness/knowledge-candidates/` | Unreviewed observations awaiting review (ignored) |
| `.harness/state/` | Generation command inputs and review artifacts |
| `.harness/state/generation/<source-id>/` | Append-only, hash-linked generation history |
| `reports/harness/` | Rendered execution reports |
| `reports/generation/<verification-id>/` | Allure capture from `verify --allure` |

All of this belongs to the consumer; the installed package stays unchanged. See
[consumer-owned state](M3-ADOPTION.md#consumer-owned-state).

## Legacy ADO phase names

The [compatibility playbook](../.agents/skills/automate-suite/references/playbook.md)
keeps the older ADO workflow and its resume rules (`_suite.json`,
`_verify-state.json`). Its historical host, catalog, parallelism and cleanup
assumptions do not override this procedure. Its phase names map to this guide as
follows:

| Legacy phase | This guide |
|---|---|
| BRANCH | [Before you start](#before-you-start) |
| FETCH | SOURCE |
| REFINE | REFINE |
| EXPLORE (AgenTeX) | EXPLORE, with the shared runtimes; AgenTeX is not required |
| GENERATE | PREPARE, AUTHOR, CANDIDATE, REVIEW |
| VERIFY | VERIFY, READY |
| DELIVER | DELIVER |
