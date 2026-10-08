# Execution model

Browser, API and database work share records for frozen inputs, observations,
effects, recovery and lifecycle obligations. Assessment derives a verdict from
those records and verified evidence; a reporter cannot turn incomplete evidence
into a pass. Use [automation](../PIPELINE.md) for POM generation or
[manual execution](../manual-execution.md) for captured ADO cases.

## Core interfaces and frozen inputs

Import from `playwright-pom-harness/scripts/lib/execution-core/index.mjs`:

| Function | Responsibility |
|---|---|
| `defineOperation` | Validate sanitized definitions and compute canonical fingerprints |
| `createRun` | Copy, validate and freeze scope, effective environment, definitions, knowledge, initial typed values and finite limits |
| `authorizeOperation` | Check selected targets, capabilities and implementation support |
| `typedValue` | Validate type, sensitivity and producer provenance |
| `attemptRecord` | Validate completed identity, timing, effects, values and exact scoped assertion coverage |
| `decideRecovery` | Check complete invocation history and actual reconciliation files |
| `checkExecutionWindow` | Check cancellation and ordinary or cleanup deadlines |
| `registerEvidence`, `verifyEvidence` | Register and recheck file association, size and hash |
| `assessRun`, `requireAssessedResult` | Derive or require a validated result |

The in-process `createRun` object is the input authority. Serialization produces
an audit snapshot, not a reusable live context. Resume/report workflows reconstruct
inputs through their own verified protocol. The core performs no browser/HTTP/SQL
I/O and resolves no credentials.

Operations name `id`, `family`, `target`, `capability`, `source` and bounded definition
JSON. Sources contain `kind`, `reference` and `version`. Catalog/helper/inline
definitions freeze before execution; exploration definitions are recorded run-locally
and need exploration plus underlying read/mutation capabilities. They cannot replace
a frozen ID. Source references are opaque identifiers, not absolute paths.

Each scenario freezes required expectations, operation and invocation IDs, descriptions
and evidence categories. Mixed work also needs each expectation's phase. One invocation
is one intended call; attempts are finite replays. Another call to the same helper
cannot satisfy missing observations from the earlier invocation.

Initial values have run/scenario/name provenance without `attemptId`; outputs name
their actual producer attempt. Bindings may rename values without changing their type,
value, sensitivity or producer. Types are string, number, boolean, object, array and
null. Sensitive values serialize only an opaque `protected:<identifier>` reference.
See [configuration](../configuration.md) for effective modes and selected targets.

## Sequential lifecycle

`runSequentialScenario` from `scripts/lib/sequential/index.mjs` runs caller callbacks
in `SETUP → EXERCISE → VERIFY → CLEANUP/RESTORE` order:

```js
import {runSequentialScenario} from 'playwright-pom-harness/scripts/lib/sequential/index.mjs';

// Caller supplies a frozen single-scenario run, roots, services and resolvers.
const result = await runSequentialScenario(run, roots, {
  browser: {target: 'application'},
  api: {resolveCredential, resolveSensitive, storeSensitive},
  database: {resolveCredential: resolveDatabaseCredential, resolveSensitive}
}, {
  setup: async context => { await services.prepareFixture(context); },
  exercise: async context => { await pages.exerciseFixture(context); },
  verify: async context => { await services.verifyFixture(context); },
  cleanup: async context => { await services.cleanRequiredFixtures(context); }
});
```

The names above are caller-owned examples, not a serialized step language or
dependency scheduler. API/DB-only scenarios omit `browser`. Browser runs freeze
the [reserved lifecycle operations](browser.md) before session acquisition.

| Callback interface | Purpose |
|---|---|
| `api.execute`, `database.execute` | Execute definitions with typed bindings and lifecycle options |
| `browser.attempt` | Work through the owned official-CLI browser context |
| `value(name)` | Bind a frozen initial value |
| `output(attempt, name, alias?)` | Bind a completed output with provenance intact |
| `resource(id)` | Read a recorded resource, or undefined after incomplete setup |
| `selectOutput(attempt, name)` | Select a business output for the result |

Await every operation. Overlap across families, duplicate invocations, expired handles
and unawaited work are refused or prevent a clean pass. Failed/blocked ordinary phases
stop later ordinary work; unreached expectations remain not evaluated. Cleanup still
runs. The runner never retries a phase or repeats successful setup. Cleanup may use
`RESTORE` within the same cleanup window.

Cross-runtime bindings retain identity and sensitivity. API-created data may be
cleaned with SQL only when both operations address the same business resource;
equal numeric IDs alone do not establish this. Protected values cannot become public
through extraction in another runtime. Native browser artifacts need sanitization.

## Effects, recovery and verdicts

Attempts retain identity, phase, one-based attempt number, operation fingerprint,
timing, outcome, failure class, inputs/outputs, assertions, effect certainty, resource
IDs and evidence. Assertions use `PASS`, `FAIL`, `NOT_EVALUATED` or `INDETERMINATE`
with reliability and evidence IDs. Every replay records its own results; old greens
cannot fill gaps. Missing mandatory results/evidence or malformed scope is a validation error.

Recovery needs definitely unexecuted/no-effect work, verified no-effect reconciliation,
or supported idempotency. An HTTP verb or invented header proves none of these.
Known effects direct verification; unresolved effects direct reconciliation/review.
Definitions, bindings and invocation identity stay unchanged. `decideRecovery` checks
every prior transition and actual reconciliation file. Native polling is not replay.
Concrete [API](api.md), [database](databases.md) and [browser](browser.md) policies differ.

| Final status | Meaning |
|---|---|
| `PASS` | Required reliable observations and required lifecycle work are complete |
| `FAIL` | An established reliable assertion or affected-row expectation failed |
| `BLOCKED` | Required work could not execute |
| `SKIPPED` | Scope was explicitly skipped |
| `NEEDS_REVIEW` | Uncertainty, indeterminate observations or lifecycle issues remain |

Reliable failures remain failures after infrastructure or cleanup problems. Finding
a created resource cannot replace a lost response assertion. Uncertainty, conflicting
evidence and incomplete obligations prevent a clean pass. Stability is `stable`,
`recovered` after safe recovery, or `unstable` for unresolved failure/uncertainty.
Counts come from validated records; [reporting](../reporting.md) preserves that authority.

Temporary harness-owned resources need cleanup; temporary existing state or explicit
restoration needs restore. Persistent/no-obligation outcomes need neither automatic
disposal nor before-images. Completion links successful lifecycle work and evidence
to the originating effect and typed identity. Restoration also needs genuine identity/
version guards; concurrent changes produce conflict. Before-state capture is optional
and protected. Cleanup has one finite scenario-wide budget after ordinary cancellation;
never restart it per invocation. Recovery uses the existing `cleanupStartedAt`.

## Optional parallel batches

`runScenarioBatch` from `scripts/lib/parallel/index.mjs` wraps independent sequential
lifecycles. Each job provides one frozen run/scenario, runtime options, callbacks and
an explicit resource footprint. Concurrency defaults to 1 and accepts integers 1–8;
batches support 1–500 jobs and at most 1,000 resource declarations. Job/run IDs are
distinct, including case aliases. Definitions and callbacks preflight before dispatch.

Above concurrency 1, a nonempty footprint must cover setup, exercise and cleanup.
Use the same lowercase key for the same data across UI/API/DB and target aliases.
Read/read overlap is allowed; read/write or write/write overlap rejects the batch.
Every mutation needs a write declaration, including exploratory work. Unknown
independence uses sequential execution. Declarations do not grant privileges,
discover relationships or coordinate external actors.

Each batch owns `.harness/runs/<batch-id>` with separate child contexts, browser
sessions and evidence. Returned entries follow input order. The consumer's exclusive
`.harness/state/parallel/active.lock` bounds batch calls, including concurrency 1,
but not direct sequential calls or external actors. A crash leaves the lock; inspect
recorded owners, effects and cleanup before targeted removal. No automatic takeover exists.

Cancellation retains active cleanup budgets; queued jobs become `BLOCKED/CANCELLED`.
Frozen deadlines include queue time. `EXECUTED` means dispatched, `NOT_STARTED`
means no callbacks/resources acquired, and `ERROR/INCOMPLETE_EXECUTION` preserves
partial evidence without inventing a verdict. Batch `COMPLETE` means all entries
have assessed results, including failed ones. Batches neither retry operations nor
change generated Playwright workers. Manual ADO execution remains sequential with
a single-flight mailbox and does not expose this batch interface.

## Evidence and limits

Separate immutable `packageRoot`, consumer `projectRoot` and fresh consumer `runRoot`.
Artifacts are nonempty files at relative `evidence/` paths with lexical/resolved
containment, size/hash checks, exact attempt associations and category coverage.
Protected authentication/runtime state is not evidence. Aliases into protected,
sibling or package storage and duplicate files are refused. Sanitization precedes
registration; integrity alone cannot establish truth or detect all confidential data.

| Limit | Default | Hard maximum |
|---|---|---|
| Attempts per invocation | 2 | 20 |
| Ordinary run | 60 seconds | 1 day |
| Cleanup window | 30 seconds | 1 hour |
| Typed value | 32 KiB | 1 MiB |
| Artifact | 8 MiB | 64 MiB |

Input/report records additionally cap at 1 MiB, 20,000 nodes and depth 32. Structured
data rejects functions, accessors, cycles, sparse arrays and live handles. Executors
enforce I/O timers/cancellation; synchronous blocking code needs host process limits.
Workflow-specific limits can differ within these bounds.

Run `test:core`, `test:sequential` and `test:parallel` in the harness checkout.
Native proofs need the prerequisites in [contributing](../contributing.md).
Full original reproduction details remain in the archived
[core](../archive/milestones/M5-EXECUTION-CORE.md),
[mixed lifecycle](../archive/milestones/M9-SEQUENTIAL.md) and
[parallel](../archive/milestones/M16-PARALLEL.md) records.
