> Historical record. Read the [current documentation](../../reference/execution-model.md) for present behavior. Statements and validation results below describe their original implementation period.

# Sequential mixed execution

M9 connects the existing browser, API and SQL Server runtimes within one scenario.
Import `runSequentialScenario` from `scripts/lib/sequential/index.mjs`. It calls four
ordinary JavaScript callbacks in order: `setup`, `exercise`, `verify`, `cleanup`.
There is no serialized step language, dependency graph, plugin registry or scheduler.
Sequential execution remains the only supported mode.

## Scope and lifecycle

Create one immutable M5 run with the scenario's required expectations, targets,
limits, values and stable operation definitions. Each mixed expectation also supplies
its `phase`: `SETUP`, `EXERCISE`, `VERIFY`, `CLEANUP` or `RESTORE`. This optional M5
field is mandatory for M9 so an unreached invocation retains its intended phase
without pretending its assertion was evaluated. An invocation has one operation and
phase; its check IDs must still match the existing runtime definition.

For exploration, pass already defined run-local operations in `options.explorations`.
They remain exploration sources, receive the same profile/target checks and do not
become a catalog or reviewed knowledge. Required unexecuted scope must name a known
definition; the runner cannot invent missing exploratory provenance after a failure.
Ordinary dynamic operations may still be constructed inside a callback when they do
not introduce previously unknown required expectation scope.

The callbacks receive:

| Interface | Behavior |
|---|---|
| `api.execute(options)` | Existing API definition, bindings and lifecycle options |
| `database.execute(options)` | Existing SQL Server definition, bindings and lifecycle options |
| `browser.attempt(options, callback)` | Existing official-CLI browser attempt context; present when a browser is configured |
| `value(name)` | An immutable initial typed value |
| `output(attempt, name, alias?)` | A prior completed output, optionally renamed without changing producer, type, value or sensitivity |
| `resource(id)` | A copy of a recorded resource and its originating outputs, or undefined if setup never created it |
| `selectOutput(attempt, name)` | Select a completed business output for the final result |

The active callback supplies the operation phase. `cleanup` may select `RESTORE`
explicitly; it shares the same cleanup deadline. The callback cannot move an invocation
into another lifecycle phase. Browser ownership operation/invocation names remain
reserved. Cross-runtime overlapping operations and reused invocation IDs are refused
before dispatch. Await each runtime operation.

`setup`, `exercise` and `verify` stop advancing after a failed or blocked phase.
Remaining required checks receive explicit not-evaluated records; cleanup still runs.
Unexpected callback failures, expired handles and unawaited work cannot yield a clean
pass. Runtimes bound and drain their own I/O before the shared result is assessed.
Synchronous JavaScript that blocks the event loop still needs host process limits.

## Intent-driven cleanup

Use the existing resource options to declare temporary fixtures, existing data that
needs restoration, persistent outcomes or no obligation. Cleanup is ordinary code
under the configured environment capabilities; it does not request repeated harness
approval. Only required obligations prevent a clean pass when incomplete.

The cleanup callback can inspect `resource(id)` before selecting a corresponding
operation, so partial setup cleans resources that were actually recorded. Bind that
resource's original identity even when cleanup uses a different runtime. An API-created
fixture may be removed with SQL; a SQL-created fixture may be removed through an API.
The scenario author is responsible for mapping those operations to the same business
resource. A matching numeric ID alone does not establish that unrelated targets refer
to the same entity.

Restoration remains opt-in. A protected API before-state output can feed the SQL
driver's guarded restoration. Its genuine post-change rowversion and resource identity
must remain bound to the originating mutation; concurrent changes produce a visible
conflict. There is no automatic before-image capture for ordinary writes.

```js
const result = await runSequentialScenario(run, roots, {
  browser: {target: 'app'},
  api: {resolveCredential, resolveSensitive, storeSensitive},
  database: {resolveCredential: resolveDatabaseCredential, resolveSensitive}
}, {
  setup: async context => { await services.prepareFixture(context); },
  exercise: async context => { await pages.exerciseFixture(context); },
  verify: async context => { await services.verifyFixture(context); },
  cleanup: async context => { await services.cleanRequiredFixtures(context); }
});
```

These names illustrate ordinary caller-owned services. The runner does not generate
them or impose catalogs. Browser callbacks still use the official Playwright CLI
skill and native argument arrays, exactly as in [M6](M6-BROWSER.md).

## Ownership, recovery and evidence

One fresh consumer run directory contains one attempt history, one evidence inventory,
typed cross-runtime bindings and one final M5 verdict. Browser-enabled runs first
acquire the owned isolated session and protected storage, then always attempt session
cleanup. Browser settings, installed CLI versions and origins remain validated by the
existing narrow native integration. API/database-only scenarios do not create a browser.

An operation's own executor continues to decide replay. The mixed runner never retries
a phase or replays a successful fixture creation. A confirmed-effect reconciliation may
allow subsequent verification when no required observation is missing. A lost required
response assertion remains unevaluated even if a database read proves the effect.
Unresolved effects require review; reliable assertion failures remain FAIL.

Known sensitive values are shared in memory across the runtimes. A protected API value
cannot be published through a later database extraction. Protected references preserve
their sensitivity when bound into another family. Browser structured observations and
public outputs are screened against the shared values; native artifacts still require
an explicit sanitizer. Fixed native status codes and lifecycle booleans remain technical
facts even when an application value happens to match them. Caller-supplied command
names are screened separately, and raw callback exception fields are omitted. A failed
automatic observation marks the run indeterminate while retaining the real attempt,
effects and resource bindings so required cleanup can proceed.
Arbitrary encodings and undeclared confidential business fields
are not automatically discoverable. Secrets and live handles are never shared through
serialized context.

Standalone M6/M7/M8 entry points remain available and assess their own single-family
run. Attached runtime state is internal to M9 and cannot independently finish a partial
result. Reporters still consume M5's validated verdict rather than recompute it.

## Validation

`npm run test:sequential` exercises lifecycle, binding, deadline and refusal behavior
with real loopback HTTP where relevant. It is not SQL/browser integration proof.

`npm run probe:mixed` reuses the disposable SQL Server provisioner from M8 and serves
a synthetic SQL-backed HTTP/UI application. Install the exact root and M4 CLI graphs,
and the M4-pinned Chromium browser, before this probe. Use the existing protected
browser cache through `PLAYWRIGHT_BROWSERS_PATH` when needed.

For a Linux client, first build the browser image using the M4 Dockerfile and obtain
its immutable image ID. Then run:

```sh
npm run probe:mixed -- --linux-client --browser-client-image=sha256:<image-id>
```

Use the actual 64-digit image ID. The container copies the publication inventory,
installs the root lockfile, including the pinned native CLI, with lifecycle scripts
disabled, and uses the browser provisioned in the image. It connects to the disposable SQL Server
through its owned Docker network; the UI/HTTP fixture runs on container loopback.
No checkout, Git history, private audit storage or database volume is mounted.
Browser, database, client and network ownership cleanup are checked. Unavailable
mandatory integrations fail; they are never counted as skipped success.

The mixed proof also imports `harness-tests/mixed-browser.integration.mjs`: eight
real-browser controls for confidential-value collisions, diagnostic redaction, public
output/observation refusal, and an injected automatic evidence-write failure after a
mutation. Each verifies recorded effects and actual required cleanup. It can run alone
with `node --test harness-tests/mixed-browser.integration.mjs` using the same native
browser prerequisites; those controls do not need SQL Server.

See [actual M9 validation](M9-VALIDATION.md) for counts, platform evidence, review
disposition and limitations. PostgreSQL, full host parity, generation/reporting and
parallel execution remain outside M9.
