# M13: generation, independent review and verification

M13 connects assessed exploration to ordinary durable POM source. Agents still author
or reuse page/service methods through the canonical skills; there is no code-generation
DSL, new browser command language, workflow engine, or AgenTeX runtime dependency.
This milestone does not implement M14 reports, M15 native host end-to-end parity,
parallel execution, or automatic delivery.

## From source to a reviewed candidate

1. Load a neutral [local source](M3-ADOPTION.md) or explicitly configured
   [ADO source](M12-ADO.md). Preserve the original actions, expectations and optional
   external references. Refinement and knowledge candidates are separate consumer
   artifacts. Never change an expected value just because the application differs.
2. Explore with the existing browser/API/DB runtimes. Browser mechanics remain the
   official Playwright CLI skill and commands. Keep the frozen run input plus its
   observations and registered artifacts. Resolve uncertain effects, missing evidence
   and required lifecycle obligations first. A reliable FAIL can inform a failing
   regression; it cannot become a new expected behavior.
3. Call `createGenerationHandoff(source, executions, bindings)`. Each execution supplies
   its actual `run`, `roots` and `observations`; the core reassesses evidence bytes.
   Bind every `sourceExpectations(source)` key to an observed run/scenario/expectation.
   Source text, operation fingerprints, attempts, evidence and lifecycle dispositions
   survive. Outputs and credentials are not harvested into generated test data.
4. `beginGeneration(roots, handoff, author)` creates consumer-owned history under
   `.harness/state/generation/<source-id>/`. It refuses to restart an existing source.
   Search for reusable business methods before adding code. Consult the POM, locator,
   action, validation, service, test-class, test-method and test-data skills as needed.
5. `registerCandidate(roots, sourceId, {config, tests})` binds each source scenario to
   one explicit `{scenarioId, spec, project, titlePath, mapping}` (mapping below). The complete nested describe
   and test titles select a native test; project is explicit, including an empty name
   for an unnamed project. Tests must be independent. Native Playwright's per-test
   `page` fixture or explicit fresh contexts are both valid.
6. Run type checks and meaningful conventions checks. Freeze and share the candidate
   revision, source/handoff, file hashes and validation evidence with a **fresh
   independent reviewer**, prompted to REFUTE. The author cannot review their work.
   Follow [framework-review](../.agents/skills/framework-review/SKILL.md).
7. Record the actual review using `recordGenerationReview`. Supply the revision,
   different reviewer identity, APPROVE/CHANGES-REQUIRED verdict, findings and a
   consumer-relative Markdown review artifact. Findings carry an ID, blocking flag,
   resolution (`open`, `resolved`, `accepted`) and evidence/rationale in `reason`.
   An acceptance must refer to the user's explicit acceptance in that artifact;
   an agent cannot invent acceptance. An open blocking finding prevents approval.

The review must compare the source's meaning with executable assertions, including
the selected observation layer. It checks reuse, selector quality, expected values,
operation scope, cleanup/retention, imported dependency closure and external environment
references. The mapping provides review traceability; assertion counts provide case-level runtime
evidence. Neither proves semantic equivalence or execution of every source expectation. Reviewer IDs are auditable
attestations, not authentication or a substitute for an actual independent review.

Generation follows [design-conventions §4a](../.agents/skills/pom-architecture/references/design-conventions.md#4a-test-data-ownership-method-contracts-and-disposable-inputs):
spec-local JSON schemas, operation-sized business inputs and credential provenance.
Use the built-in isolated `page` by default. Keep one optional attempted identity per
owned resource, reset before fixture-dependent setup and assigned before creation.
Keep the simple case-base plus timestamp pattern and paired-JSON synthetic passwords;
generation beyond that needs a scenario or observed-contract reason. Preserve existing
sound explicit context setup and application deletion/authentication contracts.
Ordinary teardown calls a focused domain cleanup method that proves ownership or
absence before deletion, including when a create response was lost. Preserve justified
public fixtures; do not generate callback registries or replacement test wrappers.
Report a missing ownership/absence contract rather than inventing one; the starter
cleanup method deliberately requires application-specific adaptation.
Native input sources follow the [refinement contract](../.agents/skills/execute-test/references/refinement.md#inputs).
Independent review covers semantic ownership and protection beyond literal checks.

## Shared deterministic operations and assertion coverage

Catalogs, deterministic service/helper operations and fixed inline parameterized
definitions are peers. All use the same shared API/database libraries and configured
capabilities. Existing helpers remain usable; there is no catalog conversion gate.
Keep domain intent in services and technical execution in utilities. A service can
delegate a versioned operation record instead of repeating its endpoint/SQL fields.
Review that definition together with the service, bindings and expected values.
Imported team libraries remain immutable, derive-only inputs.

Write ordinary business validations with existing assertion facades:

```ts
await expectToHaveText('the confirmation message', this.confirmation_msg, expected);
```

Keep business parameters limited to application inputs and expected values. Source
keys live in the existing candidate/review workflow, not in generated method
parameters or tracing-only JSON. Each candidate test supplies:

```json
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
        {"key": "<source expectation key>", "validations": ["ConfirmationPage.verifyConfirmation"]}
      ]
    }
  ]
}
```

Use the source's one-based step numbers and actual expectation keys. Every source step and its
expectations must appear exactly once. Each expectation needs a nonempty validation
reference; each step needs at least one action or validation reference. Action-only
and verification-only steps, composed methods and one method covering several
expectations are valid. These are review references, not a lexical method resolver
or direct-call requirement. Review must detect dummy assertions and missing coverage.

Await asynchronous public metadata calls: use `await allure.testCaseId('scenario-1')`
for local identity, or `await allure.tms('12345')` for a real supplied case ID. Use
literal IDs directly and issue links only for associated bugs. Configure reporter
link templates as described in [M14](M14-REPORTING.md#generated-playwright-tests-and-allure).
The old three-argument `sourceExpectation(test, key, callback)` remains a deprecated
callback pass-through for compatibility; new code must not use it.

Cleanup follows scenario intent and ownership. Required cleanup/restoration must finish;
intentional persistence is valid. Generated tests must use unique owned resources and
avoid overwriting concurrent changes. Do not introduce universal restoration, mandatory
before-images, SQL parsing, or additional per-mutation approvals.

## Two independent scoped green runs

`verifyGeneration(roots, sourceId)` launches the consumer's **Playwright Test 1.63.0**,
the exact version validated by this adapter. This is separate from the pinned
exploration CLI. Other versions fail explicitly until validated. No new root runtime
dependency is installed. Dependency declarations/locks remain consumer-owned.
The live proof declares all linked libraries and tools at their installed versions,
including a relative `file:` dependency for the harness and frozen version evidence.
Its local package alias is recreated against the reviewed checkout on another machine.
This is linked-source proof; packed installation remains an M17 gate.
For TypeScript consumers of the installed JavaScript runtime libraries, enable
`allowJs: true`, `checkJs: false` and `maxNodeModuleJsDepth: 1`, while retaining
`strict: true` (or supply reviewed declarations at the consumer boundary). The
[TypeScript inference setting](https://www.typescriptlang.org/tsconfig/maxNodeModuleJsDepth.html)
allows loading JavaScript interfaces inside `node_modules`; source-only links can
hide its default exclusion. The installed check compiles both runtime helpers and
rejects a deliberately wrong argument type. The proof
type-checks its TypeScript POM code; it does not claim full static typing of the existing
JavaScript execution libraries. Their runtime validation and contract tests still apply.

The runner collects tests first and checks every native test-list prefix against the
complete collection. If a selector would also dispatch an unselected nested test,
verification stops before execution. It forces one worker, zero retries, one repetition, forbids `only`, disables
project dependencies, and bounds time and output. Put required prerequisites in
reviewed per-test fixtures/hooks; dependency projects are not implicitly executed.
The verification receipt replaces the configured reporter for these scoped checks.
With `verify --allure`, [M14 reporting](M14-REPORTING.md) composes that required
receipt with optional Allure capture. It does not change scope, assertions or readiness.

New candidates and verification records use the harness-derived
`gate: 'case-assertions'`. Both collection and execution receipts must use
`version: 2`; each result carries `assertions: {passed, failed}` and `skippedSteps`.
Every selected test must run once with normal expected status, pass, have at least
one credited passing assertion, no failed assertions and no skipped steps.

The reporter counts completed outermost native expectations. It does not descend into
polling/retry attempts: the enclosing expectation's final outcome wins. It traverses
ordinary helper/step containers so caught failures remain visible. Hook/fixture
assertions earn no passing credit, but genuine failures still fail verification.
Only existing documented nonasserting `Probe` expectations originating in utility
code are exempt. Missing/extra tests, skips, expected failures, soft failures, flaky
retries and nonzero exits cannot earn a green. Two fresh processes with distinct
invocation IDs must pass the **same reviewed candidate**. These receipts do not claim
per-source-expectation execution. Historical v1 receipts retain their original
interpretation; live case-level candidates cannot use them.

File or shared-runtime changes invalidate the candidate. The snapshot covers consumer
files, additions/deletions, configured targets/knowledge, dependency declarations and
the shared library version/content. Installed `node_modules`, host instruction storage,
runtime output directories and secret files are excluded; secrets are never copied.
Installed dependency contents and arbitrary environment variables are not independently
attested: verify lockfile installation and external references in review/CI. Links in
consumer behavior are rejected; installed package links remain read-only dependencies.
Each green receipt is integrity-checked again when readiness is requested.

After any repair, register another candidate with `repair` set to `script-defect`,
`environment` or `review-findings`. There are **three cumulative repair rounds per
source batch**, including environment-only fixes; this is conservative for multi-case
batches. A repair resets review and green counts, not history. Unchanged failed or
interrupted candidates cannot retry to green. Preserve genuine application failures;
do not repair them by weakening assertions. Before replay after interruption, reconcile
possible effects and required cleanup, and include that evidence in the new review.
An abandoned process leaves STARTED visible as NEEDS_REVIEW. Stale writer locks need
operator inspection; there is no automatic takeover or speculative resume engine.

PASS/FAIL/BLOCKED/NEEDS_REVIEW describe verification attempts. READY means two scoped
greens and intact review/receipts, not delivery authorization. The hash-linked append-only
history detects accidental edits and gaps; it is not tamper-proof against its filesystem
owner. Generated tests and their reviewers remain trusted automation code.

## One-time migration from the legacy gate

Use the existing registration command with a candidate input containing
`migration: 'case-assertions'`, the existing `config` and native test identities,
and the new `mapping` for each test:

```text
npx --no pom-harness generate candidate --id <source-id> --input .harness/state/migration.json
```

Eligibility requires a legacy candidate and no case-level candidate anywhere in
that source's history. Preserve the handoff, source, config path and scenario-to-test
identities. Release-related consumer edits and mapping additions are permitted.
A successful migration appends a revision without charging a repair round, even
when all three rounds are used. It permanently consumes the exception; invalid
input consumes nothing. No old candidate, review, failure, run or receipt is removed.

The new revision needs fresh independent review and two fresh scoped green v2
processes. Old approvals and greens do not count. Review must establish migration
scope and reconcile prior failed or interrupted execution before replay; there is
no automated migration-diff analyzer. If the candidate also fixes unrelated defects,
include the existing `repair` classification: the normal round is charged and
registration fails when the budget is exhausted. Later revisions use normal repair
accounting.

Existing consumers should update the harness, review their custom lifecycle and
reporter configuration, remove marker-only business parameters/wrappers, and register
this explicit migration when continuing legacy generation. Setup does not silently
rewrite custom test code. The adapter's Playwright version pin is a verifier
compatibility requirement, not a telemetry protection feature.

## Local command interfaces

Run every command from the consumer folder (or pass `--project-root <consumer>`); it
cannot use installed package storage as the consumer. JSON inputs and review artifacts belong to the consumer. These commands
do not contact ADO, create PRs, publish, push or merge.

```text
npx --no pom-harness generate prepare --input <preparation.json>
npx --no pom-harness generate candidate --id <source-id> --input <candidate.json>
npx --no pom-harness generate review --id <source-id> --input <review.json>
npx --no pom-harness generate verify --id <source-id>
npx --no pom-harness generate verify --id <source-id>
npx --no pom-harness generate status --id <source-id>
```

Preparation JSON contains `source` (neutral source file), `author`, `executions` and
`bindings`. Each execution contains consumer-relative `snapshot` (the serialized
`createRun` result) and `runRoot` with `observations.json` and evidence. Preparation
reconstructs/fingerprints inputs and reassesses evidence; it never trusts result JSON.
Bindings are `{key, runId, scenarioId, expectationId}`. Candidate JSON has `config`,
`tests` as above, optional `migration` for the one-time legacy transition, and
`repair` for ordinary repairs. `gate` is derived by the harness, never supplied. Store command/review
inputs under `.harness/state/` to avoid changing the behavior snapshot while recording
review. Failed preconditions return exit 2; an unsuccessful verification returns exit 1.

See [validation](M13-VALIDATION.md) for actual counts and proof limitations.
