# M16 bounded parallel execution

[M15](M15-VALIDATION.md) established the complete sequential lifecycle before this
milestone. Sequential execution remains the default. M16 adds one deterministic
batch function around [M9](M9-SEQUENTIAL.md), available to either host and ordinary
automation code. It does not schedule workflow dependencies or change POM methods,
generated Playwright worker counts, Allure configuration or native host permissions.
See [actual validation](M16-VALIDATION.md).

## Calling the dispatcher

Import `runScenarioBatch` from `scripts/lib/parallel/index.mjs` in the installed
package. Supply separate package/consumer roots and a nonempty array of jobs:

```js
const batch = await runScenarioBatch(
  {packageRoot, projectRoot},
  [{
    id: 'create-order',
    run, // createRun result containing exactly one scenario
    options: {explorations, database: {resolveCredential}},
    callbacks: {setup, exercise, verify, cleanup}, // existing M9 callbacks
    resources: [{key: 'order-case-a', access: 'write'}]
  }],
  {concurrency: 2, signal}
);
```

Omitting concurrency means **1**. Supported values are integers from 1 to 8, with
at most 500 jobs and 1,000 resource declarations across the batch. No operation is
retried by the dispatcher; existing runtimes decide safe operation recovery. Each
scenario still sequences setup, exercise, verification and any required cleanup or
restoration. A slot is occupied through final result assessment and browser shutdown.

Runs must be immutable M5 `createRun` objects. The batch preflights job shape,
phase/expectation associations, callback/resolver types, identities and resource
conflicts before dispatch. Native definition validation, capabilities, destinations
and effect reasoning remain in the runtimes. Use fresh run identities; job/run IDs
must be distinct within a batch, including case aliases. Job options, callbacks and
declarations are captured at entry. Callback closure state and external services
remain the responsibility of normal automation code and review.

## Independence and conflicts

Parallel jobs require an explicit, nonempty resource footprint. A key is a public,
lowercase execution identifier for a shared business resource or an exclusive fixture
namespace. Use the same key for the same data across UI/API/DB paths and across
target aliases. Include setup, cleanup and restoration in the footprint.

| Overlap between jobs | Parallel admission |
| --- | --- |
| Read / read | Allowed |
| Read / write, write / read, write / write | Entire batch rejected before dispatch |
| Unknown or undeclared footprint | Use sequential execution |

A mutating definition requires a write declaration regardless of catalog/helper/
inline/exploration source. Read-only jobs also reject mutations introduced later by
dynamic exploration. Declarations do not grant target capabilities. A write claim
does not replace configured privileges or authorize arbitrary destinations.

These are reviewed declarations, not automatic discovery of record relationships.
The dispatcher cannot prove that distinct keys describe distinct business data, inspect
arbitrary callback I/O, or coordinate other tools/projects/external users. Callbacks
remain trusted automation code using the shared runtimes. Choose sequential execution
when independence is uncertain; retain native identity/version restoration guards.
There is no general SQL parser or automatic lock/dependency graph.

## Ownership, cancellation and deadlines

Each batch owns fresh `.harness/runs/<batch-id>` storage. Each job gets a fresh child
directory keyed by its run ID, its own runtime context, evidence and session. Frozen
inputs and a relative-path `batch.json` index associate results with job, run and
scenario identities. Result order follows input order even when completion differs.
Input snapshots contain credential references only. Runtime authentication material
uses existing protected storage and owned cleanup.

One exclusive `.harness/state/parallel/active.lock` prevents concurrent batch calls in
the same consumer from bypassing the bound. It covers sequential batch calls too,
but not direct M9 calls or external actors. A process crash leaves the lock in place.
There is no automatic takeover: first inspect the retained run/effect/cleanup evidence,
establish that the owner and its resources are stopped, then remove that exact stale
lock through normal operator recovery. Never remove another live batch's lock.

Use one optional batch `AbortSignal`. Active scenarios receive cancellation through
their existing runtime controls and keep their separate finite cleanup budget. Queued
jobs do not start: they receive an assessed `BLOCKED` result with `CANCELLED` and empty
attempt history. Immutable run deadlines include time spent in the queue; an expired
queued job is `BLOCKED` with `DEADLINE_EXCEEDED`. Create runs with an appropriate
finite budget; the dispatcher never silently resets it. Trusted synchronous callbacks
cannot be preempted by JavaScript timers; process-level limits remain the host's job.

## Results and lifecycle intent

`batch.entries` retain each assessed core result and roots separately. `EXECUTED`
means the lifecycle was dispatched, not that its test passed. `NOT_STARTED` means
no scenario callback/resource acquisition occurred. Unexpected incomplete execution
is `ERROR` with `INCOMPLETE_EXECUTION`, no invented core result, and retained partial
evidence. Other started work is drained before return. Errors are recorded using
fixed classifications; arbitrary exception text and resolver functions are not saved.

Batch `completion` is `COMPLETE` when every entry has an assessed result, including
expected failures or unstarted blocked cases; otherwise it is `INCOMPLETE`. This is
collection completeness, **not a test verdict**. Existing reporting consumes each
assessed result and never recalculates verdicts from completion order.

Required cleanup/restoration failures prevent a clean pass without hiding an
established assertion failure. Intentionally persistent state remains a valid
outcome; no automatic before-state capture or universal cleanup is added. Shared
data conflicts outside declared batch scope still require guarded restoration and
effect-aware reconciliation. Catalogs have no privileged authorization status.

## Validation commands

- `npm run test:parallel`: loopback transport, bounds, isolation and negative controls.
- `npm run probe:parallel -- <new-external-consumer-directory>`: fixed, opt-in native
  proof using the pinned CLI/browser and owned disposable SQL Server/PostgreSQL
  containers. Requires installed dependencies, Docker and browser process ownership.

The native proof compares the same 13 sequential and parallel cases semantically,
revalidating each run's own evidence. Expected controlled failures must stay failures.
It verifies retained database rows before removing only its disposable infrastructure.
This proof does not perform external service writes or publish anything. M17's full
installed-package/platform/host matrix remains a separate milestone.
