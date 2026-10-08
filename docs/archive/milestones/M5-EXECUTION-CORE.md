> Historical record. Read the [current documentation](../../reference/execution-model.md) for present behavior. Statements and validation results below describe their original implementation period.

# M5: minimal execution contracts

The [library entry point](../../../scripts/lib/execution-core/index.mjs) exports deterministic
records and validators, usable without Claude, Codex, Playwright or AgenTeX. It does
not execute operations, implement SQL parsing, launch browsers, schedule tasks or
introduce another browser command language. Browser-specific policy/integration
remains M6; API and database dispatch remain M7–M8. Existing helpers stay valid.

## Public functions

| Function | Responsibility |
|---|---|
| `defineOperation(definition)` | Validate a sanitized definition/source and compute its canonical SHA-256 fingerprint |
| `createRun(inputs)` | Deep-copy, validate and freeze selected scope, effective environment, definitions, reviewed knowledge, initial typed values and finite limits |
| `authorizeOperation(run, operation, supportedCapabilities)` | Check the frozen target/capabilities and declared implementation support; return an allowed/refused decision without prompting or dispatching |
| `typedValue(record, maxBytes)` | Validate a JSON value's type, sensitivity and producer provenance |
| `attemptRecord(run, record)` | Validate a completed attempt's identity, timing, effects, exact scoped assertion coverage and typed values |
| `decideRecovery(run, history, options)` | Check every prior replay transition and actual reconciliation artifacts before deciding retry, verification, reconciliation, review or stop |
| `checkExecutionWindow(run, options)` | Check the run deadline/cancellation or a separate bounded cleanup window |
| `registerEvidence(run, roots, metadata)` | Register an already-sanitized file with relative association, size and SHA-256 |
| `verifyEvidence(run, roots, artifact)` | Re-read and verify an artifact inside consumer run storage |
| `assessRun(run, roots, observations)` | Validate sequential records and all artifacts, derive immutable scenario/run verdicts and counts |

The run object returned by `createRun` is the in-process input authority. It can be
serialized for audit, but replay/resume from deserialized contexts is intentionally
not implemented. No function loads credentials or serializes a live handle.

## Frozen inputs and policy

Pass the environment returned by M3's `loadEnvironment`, or an equivalent validated
record. The core revalidates it and freezes only selected destinations and secret
reference identities. It does not resolve their secret values. Later edits to the
original environment, definitions, limits or knowledge affect subsequent runs only.

`test` enables API reads/mutations/exploration and database SELECT/DML/exploration.
`protected` enables reads and read-oriented exploration, with mutations explicitly
configurable. `custom` grants only configured capabilities. DDL/admin default off.
Unknown or disabled targets fail, and enabling a capability does not manufacture
driver support. Normal permitted mutations have no per-operation approval flag.

Definitions record `id`, `family` (`api` or `database`), `target`, `capability`,
`source` and bounded sanitized `definition` JSON. Source has `kind`, `reference`
and `version`. Source and knowledge revisions accept bounded version strings,
including semantic versions with prerelease/build suffixes, or commit identifiers.
Catalog, helper and inline definitions all freeze before a run and
receive identical controls. Their source references are opaque identifiers, not
absolute file paths. Exploration definitions are run-local and need the appropriate
exploration plus read/mutation capability. They cannot replace a frozen operation
with the same ID. The driver remains responsible for interpreting its own request
or statement and matching actual behavior to the declared capability; these records
are not a transport API or SQL compiler.

Initial typed values freeze with run/scenario/name provenance and no `attemptId`.
Output values name their actual producer attempt. Inputs may bind frozen values or
earlier outputs in the same scenario, with unchanged type, sensitivity and value;
renaming the local input is allowed. Values use `string`, `number`, `boolean`,
`object`, `array` or `null`. Sensitive values carry only an opaque
`protected:<identifier>` reference, never a serialized value. Cross-scenario graphs
and automatic knowledge promotion are outside M5.

Selected scenario scope must be nonempty. Each expectation freezes its description,
operation ID, invocation ID and required evidence kinds. An invocation identifies
one intended call; attempts identify finite replays of that call. A new invocation
of the same helper cannot satisfy a missing observation from an earlier invocation.

## Attempts, recovery and verdicts

Attempt identity includes run, scenario, operation, invocation, attempt, phase and
one-based attempt number. Records include the operation fingerprint, start/end,
outcome and failure classification, typed inputs/outputs, assertions, effect certainty,
resource IDs, optional affected-row expectations, evidence and reconciliation.
Phase/time order is checked for sequential `SETUP → EXERCISE → VERIFY → CLEANUP/RESTORE`
records; this validation does not schedule phases or require every phase in every test.

Recovery accepts definitely unexecuted/no-effect attempts, evidence-backed no-effect
reconciliation, or an explicit supported idempotency contract. Known effects direct
verification; unresolved effects direct reconciliation/review. A verb or invented
header is not proof. Definitions, bindings and invocation identity cannot change on
replay. Budgets and chronology stay bounded. `decideRecovery` checks every earlier
transition in the supplied complete invocation history; an unsafe earlier replay
prevents another retry. Reconciliation requires `evidence` records and consumer
`roots` so the helper can verify the actual proof files, including earlier attempts'
proof. Metadata alone does not establish reconciliation. Native waiting/polling is
not a replay.

Assertions report `PASS`, `FAIL`, `NOT_EVALUATED` or `INDETERMINATE`, plus reliability
and evidence references. Reliable failures remain failures. Every replay must record
the required expectation results again; old green observations cannot fill gaps.
The single-attempt validator enforces exact scoped IDs and counts before recovery
can authorize another attempt. Unrelated setup/cleanup invocations with no scoped
expectations may have empty assertion arrays.
Missing required results/evidence and malformed identities/counts throw validation
errors rather than producing a successful verdict. Explicit unknown observations
remain indeterminate. Finding a created resource cannot replace a missing required
response artifact or status assertion.

Final statuses remain `PASS`, `FAIL`, `BLOCKED`, `SKIPPED` and `NEEDS_REVIEW`.
Established reliable assertion/affected-row failures take precedence over cleanup
or uncertainty issues without erasing those records. Uncertainty, assertion instability,
contradictory evidence and incomplete required lifecycle work prevent a clean pass.
Known unexecuted scope is blocked or explicitly skipped. A safe recovery may finish
`PASS` with `stability=recovered`; unresolved failures use `unstable`, while runs
without recovery or uncertainty use `stable`. Attempt history is always retained.

Scenario counts distinguish required, reliably evaluated, passed, failed,
indeterminate and not-evaluated expectations. Run counts enumerate the five final
statuses. These are computed from validated records, not accepted from a reporter.

## Intent-driven lifecycle

Resources reference an originating effect and a typed identity produced by or bound
into that originating attempt. Identity references use `{attemptId, name}` for an
output or `{name}` for a frozen initial value in the same scenario. Existing-state
helpers do not need to fabricate identity outputs. Their explicit ownership and
intent determine the obligation:

| Intent | Action |
|---|---|
| Temporary, harness-owned | Cleanup |
| Temporary existing state, or explicit restoration | Restore |
| Persistent outcome | Retain; no cleanup obligation |
| No obligation required | Record effects without cleanup/restoration |

Required actions record pending/completed/failed/conflict and their associated
attempt/evidence. Completion needs a successful action and lifecycle evidence,
associated with the same resource by a confirmed resource effect or a matching typed
identity input and known effect. This permits bulk cleanup and read verification
that the bound resource is already absent/restored. Unrelated successful work cannot
complete an obligation.
Restoration also needs recorded identity/version guard evidence. A conflict never
authorizes overwriting concurrent changes. Optional before-state references remain
opaque protected references; before-image capture is not automatic or mandatory.
Executors will own the actual protected storage, mutation, reconciliation and cleanup.

Ordinary phases honor the run deadline and an `AbortSignal`. Required cleanup can
continue after that cancellation/deadline using its own finite budget. The sequential
record validator prevents restarting that budget for each later cleanup invocation.
For cleanup/restoration recovery, callers must pass the existing scenario-wide
`cleanupStartedAt`; the helper never substitutes the current invocation's start.
These functions do not terminate a process or cancel a driver; adapters must implement
real timers and cancellation when their milestones are authorized.

## Evidence and scope limits

Roots remain separate: immutable `packageRoot`, consumer `projectRoot`, consumer
`runRoot`. Artifacts must be nonempty bounded files under relative `evidence/`
paths; lexical and resolved paths must stay in the actual evidence directory and
outside the package. The evidence directory itself cannot redirect to other storage,
and nested aliases cannot point into sibling protected storage within the run.
The gate rechecks sizes/hashes, rejects duplicate files, and checks exact attempt
association plus each expectation's declared evidence categories. Sensitive runtime
storage and authentication state are not evidence. Absolute paths are not serialized.

Structured data is bounded JSON: no functions, accessors, cycles, sparse arrays,
live handles or hidden fields. Conservative credential checks reject obvious literals;
they cannot discover every sensitive word inside arbitrary prose or binary files.
Producers must sanitize observations before registration. Integrity and association
checks do not independently prove that an observation is truthful; future adapters
must capture reliable evidence. The M4 native evidence checks remain version-specific
inside that spike; M5 does not couple the core to its CLI or implement general parsers.

Defaults: two attempts, a 60-second run, a separate 30-second cleanup budget,
32-KiB typed values and 8-MiB artifacts. Limits are finite and frozen. Hard bounds
are twenty attempts, one day per run, one hour per cleanup window, 1-MiB typed values
and 64-MiB artifacts. Each input/report JSON record is also bounded to 1 MiB,
20,000 nodes and depth 32. These are contract limits, not runtime integration proof.

Run `npm run test:core`. The fixtures exercise policy and record decisions with
synthetic data and real temporary artifact files. They perform no HTTP request,
database query or browser action. See [actual M5 validation](M5-VALIDATION.md).
