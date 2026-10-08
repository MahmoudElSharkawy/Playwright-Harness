<a id="automation-pipeline"></a>

# Automation workflow

Turn a local scenario source or Azure DevOps cases into durable Playwright POM
automation. This is the current generation procedure: each phase below describes
its inputs, outputs, commands and gates. Start with [getting started](getting-started.md)
and [configuration](configuration.md) before using these command-level interfaces.
The [canonical conventions](../.agents/skills/pom-architecture/references/design-conventions.md)
and owning specialist skills govern the authored code.

Agents run the pipeline through the
[automate-test skill](../.agents/skills/automate-test/SKILL.md):

```text
/automate-test story <id> on <environment>
/automate-test suite <id> [plan <id>] on <environment>
/automate-test local <source.json> on <environment>
```

All three source routes follow the same workflow. Standalone
[manual execution](manual-execution.md) is a separate ADO-only workflow that
produces reports without generating POM code. Dated native-host proof and limits
are retained in the [validation archive](archive/milestones/M15-VALIDATION.md).

```text
SOURCE → REFINE → EXPLORE → PREPARE → AUTHOR → CANDIDATE → REVIEW → VERIFY ×2 → READY → DELIVER
                                        ▲                    │        │                 (optional)
                                        └─ repair (max 3) ───┴────────┘
```

| Phase | Purpose | Main output | Command or interface | Further reading |
|---|---|---|---|---|
| [SOURCE](#1-source) | Load scenarios unchanged | Loader record with source fingerprint | `load-local-source.mjs`, `fetch-ado-suite.mjs`, `fetch-ado-story.mjs` | [Configuration](configuration.md), [Azure DevOps](azure-devops.md) |
| [REFINE](#2-refine) | Make steps executable without changing what they prove | Frozen refinement artifact | Agent work | [Refinement](../.agents/skills/execute-test/references/refinement.md) |
| [EXPLORE](#3-explore) | Run against the configured application | Run snapshot, observations, evidence | Runtime libraries | [Execution model](reference/execution-model.md) |
| [PREPARE](#4-prepare) | Bind each source expectation to an observation | Generation history | `generate-tests.mjs prepare` | [Library interfaces](#generation-library-interfaces) |
| [AUTHOR](#5-author) | Write or reuse POM code | Page, service, spec and data files | Layer skills | [POM architecture](architecture.md) |
| [CANDIDATE](#6-candidate) | Map each scenario to one native test | Candidate revision | `generate-tests.mjs candidate` | [Mapping](#candidate-mapping) |
| [REVIEW](#7-review) | Independent attempt to refute the candidate | Recorded verdict | `generate-tests.mjs review` | [Framework review](../.agents/skills/framework-review/SKILL.md) |
| [VERIFY](#8-verify) | Two scoped green processes | Verification receipts | `generate-tests.mjs verify` | [Compatibility](#verification-compatibility-and-integrity), [Reporting](reporting.md) |
| [READY](#9-ready) | Confirm readiness | Status | `generate-tests.mjs status` | [Verification](#8-verify) |
| [DELIVER](#10-deliver-optional) | Optional, authorized delivery | PR, published outcomes | `ado-pr.mjs`, `publish-ado-results.mjs` | [Azure DevOps](azure-devops.md) |

## Before you start

- Adopt the package into a separate consumer and select its environment profile
  deliberately ([getting started](getting-started.md)). Node 24 is the supported runtime.
- Configure the targets the scenarios need in `.harness/project.json` and
  `.harness/targets.json`: browser ([browser runtime](reference/browser.md)),
  API ([API runtime](reference/api.md)), SQL Server ([database runtimes](reference/databases.md)) or PostgreSQL
  ([database runtimes](reference/databases.md)). The `environmentMode` (`test`, `protected` or `custom`)
  decides which operations are allowed. In `test`, ordinary permitted mutations need
  no per-operation approval.
- The release dependency supplies the pinned official Playwright CLI. Browser
  binaries and host readiness are checked separately; see the
  [browser runtime](reference/browser.md).
- For verification, the consumer needs Playwright Test **1.63.0**. TypeScript consumers
  enable `allowJs: true`, `checkJs: false` and `maxNodeModuleJsDepth: 1` while keeping
  `strict: true` ([automation workflow](PIPELINE.md#8-verify)).
- ADO is needed only for ADO sources or delivery. Configure it in
  `.harness/integrations.json` ([Azure DevOps](azure-devops.md)).
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
  [local source format](configuration.md)), or an ADO plan/suite or story ID with
  ADO configured.
- **Outputs:** a loader record (`--out`) holding the source's relative path and SHA-256
  fingerprint, with status `LOADED` and `executed: false`. An ADO fetch also writes
  `_suite.json` and one Markdown spec per case under `execution-tests/ado-suite-<suiteId>/` or
  `execution-tests/ado-story-<storyId>/`; `--source-out` exports the neutral format.
- **Rules:** keep the source immutable and preserve every action, expectation and
  external reference. Each scenario needs at least one expectation. Limits are 2 MiB,
  1–500 scenarios and 1–1000 steps per scenario. `LOADED` means the source was read,
  not that anything passed. The loader refuses an existing `--out` destination. ADO
  fetches never change ADO. Parameterized or incomplete ADO cases fail conversion and
  must be refined into the neutral format explicitly.

Existing `test/ado-suite-*` and `test/ado-story-*` folders need a one-time manual
move; see [fetch storage and migration](azure-devops.md).

```text
npx --no pom-harness load-source --source .harness/sources/<name>.json --environment <env> --out .harness/runs/source.json
npx --no pom-harness fetch-suite --plan <planId> --suite <suiteId> --source-out .harness/sources/<name>.json
npx --no pom-harness fetch-story --story <storyId> --source-out .harness/sources/<name>.json
```

Details: [local source format](configuration.md) and
[ADO suite/story retrieval](azure-devops.md).

## 2. REFINE

Rewrite human-oriented steps so an agent can execute them, without changing what the
scenario covers or proves.

- **Inputs:** the loaded source and reviewed consumer knowledge under
  `.harness/knowledge/`, including `prerequisites.md` for recurring setup states
  ([prerequisite knowledge](../.agents/skills/automate-test/references/prerequisite-dictionary.md)).
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
[compatibility playbook](../.agents/skills/automate-test/references/playbook.md) has
the detailed allowed and forbidden list. Its file layout (a `## Refinement log` in each
fetched spec) is the legacy ADO one.

Details: [reviewed knowledge](configuration.md),
[refinement procedure](../.agents/skills/execute-test/references/refinement.md).

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

Standalone manual execution uses the [execute-test skill](../.agents/skills/execute-test/SKILL.md)
and [manual execution](manual-execution.md), with no code generation. Automation exploration
continues to use these library interfaces:

| Need | Interface | Contract |
|---|---|---|
| Freeze scope, environment, definitions, expectations and limits | `createRun` | [execution model](reference/execution-model.md) |
| Browser steps through the official Playwright CLI skill | `runBrowserScenario` | [browser runtime](reference/browser.md) |
| API operations | `defineApiOperation`, `createApiRuntime` | [API runtime](reference/api.md) |
| SQL Server or PostgreSQL operations | `defineDatabaseOperation`, `createDatabaseRuntime` | [database runtimes](reference/databases.md) |
| One scenario mixing UI, API and DB (`setup`, `exercise`, `verify`, `cleanup`) | `runSequentialScenario` | [execution model](reference/execution-model.md) |
| Opt-in bounded batch of independent scenarios (default concurrency 1) | `runScenarioBatch` | [execution model](reference/execution-model.md) |

To render a saved run as JSON, Markdown and HTML reports (optional; output defaults to
a fresh `reports/harness/` directory):

```text
npx --no pom-harness render-results --snapshot .harness/runs/<run-id>/inputs.json --run-root .harness/runs/<run-id>
```

Details: [reporting execution reports](reporting.md).

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

Details: [generation library interfaces](#generation-library-interfaces).

## 5. AUTHOR

Write durable POM code for the scenarios, reusing existing business methods before
adding new ones.

- **Inputs:** the handoff, the exploration observations and the consumer's existing
  framework.
- **Outputs:** page and service classes, specs and test data in the consumer.
- **How:** start with the [pom-architecture skill](../.agents/skills/pom-architecture/SKILL.md)
  and use only the layer skills the change touches (locators, actions, validations,
  services, test classes, test methods, test data).
- **Rules:** use ordinary business validations and standard Playwright imports.
  Default GUI tests to the built-in isolated `page`. Keep source keys in the
  candidate mapping, never in business parameters or tracing-only JSON. Await
  asynchronous Allure calls with literal real IDs; local scenarios retain their
  `testCaseId`. Tests use unique resources and domain cleanup from ordinary hooks,
  retaining a fresh attempted identity before creation and proving ownership before
  deletion. Catalogs, deterministic helpers and fixed inline definitions remain peers;
  imported team libraries are derive-only.

```ts
await expectToHaveText('the confirmation message', this.confirmation_msg, expected);
```

Run the consumer's TypeScript check and the convention checker; the checker's file and
rule counts must be nonzero. Their results go to the reviewer. A file change after
registration invalidates the candidate, so fix check failures before registering.

```text
npx --no pom-harness check-conventions
```

Details: [POM architecture](architecture.md) and
[candidate mapping](#candidate-mapping).

## 6. CANDIDATE

Register the code as a candidate and map each source scenario to exactly one native
Playwright test.

- **Inputs:** a candidate JSON file with `config`, and `tests` entries of
  `{scenarioId, spec, project, titlePath, mapping}`. `titlePath` is the complete chain of
  describe and test titles. `project` is explicit, with an empty name for an unnamed
  project. Map every source step and expectation exactly once to action/validation
  references using the [candidate mapping](#candidate-mapping).
  Add `repair` for repairs or `migration: 'case-assertions'` for the one-time legacy
  transition (see [Repairs](#repairs)).
- **Outputs:** a frozen candidate revision covering consumer files, configured targets
  and knowledge, dependency declarations and the shared library version. The command
  prints `NEEDS_REVIEW` with the revision.

```text
npx --no pom-harness generate candidate --id <source-id> --input .harness/state/<candidate>.json
```

### Candidate mapping

The candidate JSON names the consumer's Playwright configuration and one native
test per source scenario. For example:

```json
{
  "config": "playwright.config.ts",
  "tests": [
    {
      "scenarioId": "scenario-1",
      "spec": "tests/ConfirmationTests.spec.ts",
      "project": "",
      "titlePath": ["Confirmation", "confirms the request"],
      "mapping": [
        {
          "step": 1,
          "actions": ["ConfirmationPage.submitRequest"],
          "expectations": [
            {
              "key": "<actual source expectation key>",
              "validations": ["ConfirmationPage.verifyConfirmation"]
            }
          ]
        }
      ]
    }
  ]
}
```

Use the source's one-based step numbers and actual expectation keys. Every step
and expectation appears exactly once, and every expectation has a nonempty
validation reference. Each step has an action or validation reference; composed
methods and one method covering several expectations are allowed. These are
review references, not a direct-call or lexical-resolution requirement. The
reviewer checks actual semantic coverage rather than trusting these names.

Await public Allure metadata with literal real identities: `allure.testCaseId`
for local scenarios and `allure.tms` for externally supplied case IDs. Source
keys belong to this mapping, not business parameters or tracing-only test data.
Use ordinary business validations and the existing assertion facades. The old
`sourceExpectation(test, key, callback)` helper is a deprecated pass-through;
new automation does not use it. See [reporting](reporting.md) for link templates.

## 7. REVIEW

A fresh, independent reviewer tries to refute the candidate. The author cannot review
their own work, and a self-review cannot release verification.

- **Inputs:** the candidate revision, the source and handoff, file hashes and check
  results, given to a reviewer who follows the
  [framework-review skill](../.agents/skills/framework-review/SKILL.md).
- **The reviewer checks** that the executable assertions keep the source's meaning,
  including the chosen observation layer, plus reuse, selector quality, expected
  values, operation scope, cleanup and retention, imported dependencies and external
  environment references. Mapping completeness and assertion counts do not prove
  semantic equivalence or that every source expectation executed.
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

Details: [framework review procedure](../.agents/skills/framework-review/references/procedure.md).

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
- **What counts as green:** v2 receipts show every selected test ran once and passed,
  with at least one completed passing assertion outside hooks/fixtures, no failed
  assertions and no skipped steps. Count outermost native expectations by their final
  outcome, including successful polling. Traverse ordinary step containers to detect
  caught failures. Utility-origin nonasserting `Probe` expectations are the sole
  exemption. Scope, expected-status, worker, retry and repetition rules still apply.
  The gate is `case-assertions`; independent review assesses full scenario coverage.

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

Details: [verification compatibility](#verification-compatibility-and-integrity)
and [Allure reporting](reporting.md).

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

A legacy candidate may use the [one-time migration](#legacy-candidate-migration)
without charging a repair round, including at round three. It preserves scope and
history, requires fresh review and two v2 greens, and cannot be reused. Unrelated
repairs still need a classification and available repair budget.

Details: [verification compatibility and integrity](#verification-compatibility-and-integrity).

### Verification compatibility and integrity

The verifier requires Playwright Test **1.63.0**, separately from the exploration
CLI's dependency pin. Other versions fail explicitly until validated. TypeScript
consumers of installed JavaScript runtime libraries use `allowJs: true`,
`checkJs: false` and `maxNodeModuleJsDepth: 1` with `strict: true`, or reviewed
consumer declarations. Runtime validation still applies; this does not claim
complete static typing of the JavaScript libraries.

The candidate snapshot covers consumer behavior files and additions/deletions,
configured targets and knowledge, dependency declarations and shared runtime
version/content. A change invalidates the candidate. Installed dependency bytes,
arbitrary environment variables and secret files are not independently attested;
review external references and verify lockfile installation in CI. Secret values
are never copied into the snapshot. Consumer behavior links are rejected;
installed package links remain read-only dependencies.

Verification receipts use version 2 and the harness-derived `case-assertions`
gate. Expected failures, skips, flaky retries, extra/missing tests and nonzero
exits cannot earn a green. Hook/fixture assertions earn no passing credit, while
genuine failures in them still fail verification. History detects accidental
edits and gaps; it is not tamper-proof against its filesystem owner. Reviewer
identities are attestations, not authentication or proof that a review occurred.

### Legacy candidate migration

To continue an eligible legacy candidate, register the existing configuration
and native test identities with the new mapping and
`migration: "case-assertions"`. Eligibility requires no case-level candidate
anywhere in that source's history. Preserve the source, handoff, configuration
path and scenario-to-test identities.

```text
npx --no pom-harness generate candidate --id <source-id> --input .harness/state/migration.json
```

This exception is usable once and does not charge a repair round, including at
round three. It preserves all old history, requires a fresh independent review
and two fresh version-2 greens, and does not reuse old approvals. Invalid inputs
consume nothing. Unrelated repairs still require a repair classification and
available repair budget. Setup does not rewrite customized consumer test code.

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

Details: [verification compatibility and integrity](#verification-compatibility-and-integrity).

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

Details: [Azure DevOps](azure-devops.md),
[publication and linking](azure-devops.md).

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
[consumer-owned state](getting-started.md).

## Generation library interfaces

Agents normally use the CLI commands above. Integration code imports the handoff,
history, candidate and review functions from
`playwright-pom-harness/scripts/lib/generation/index.mjs`. Import `verifyGeneration`
from `playwright-pom-harness/scripts/lib/generation/verify.mjs`.

| Operation | Interface |
|---|---|
| Bind unchanged source expectations to reassessed observations | `createGenerationHandoff(source, executions, bindings)` |
| Open consumer history | `beginGeneration(roots, handoff, author)` |
| Freeze a candidate and its mapping | `registerCandidate(roots, sourceId, candidate)` |
| Record the independent verdict and review artifact | `recordGenerationReview(roots, sourceId, review)` |
| Run one scoped verification process | `verifyGeneration(roots, sourceId)` |

An in-process handoff uses actual run, roots and observation records. CLI
preparation instead reconstructs them from consumer-relative `snapshot` and
`runRoot` paths and reassesses registered evidence bytes. Neither route trusts
a saved claimed verdict. Catalogs, deterministic helpers and fixed parameterized
inline operations remain peers; imported team libraries are derive-only.

Promote observations into `.harness/knowledge/` only after review and
sanitization. Active-run inputs remain frozen; promoted knowledge does not
silently alter a run or a reviewed candidate.

## Legacy ADO phase names

The [compatibility playbook](../.agents/skills/automate-test/references/playbook.md)
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
