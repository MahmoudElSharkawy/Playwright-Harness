# Sequential SQL Server execution

M8 implements one database scenario per runtime using the shared M5 records and
assessment. Import `defineDatabaseOperation` and `createDatabaseRuntime` from
`scripts/lib/database/index.mjs`. Deterministic services/helpers and both hosts can
call this library without loading an AI host, Playwright or AgenTeX. Existing
`DBActions`/`DbsDomain` examples remain valid; no catalog migration is required.

Install the root lockfile with `npm ci --ignore-scripts` on Node 24. The driver is
node-mssql 12.7.2; its resolved dependencies and notices have their own inventory.

## Explicit scope and credentials

Choose a profile once, then configure a target in the consumer's `.harness/targets.json`:

```json
{
  "api": {},
  "databases": {
    "qa-db": {
      "engine": "sqlserver",
      "server": "database.example.com",
      "port": 1433,
      "database": "SyntheticTesting",
      "schema": "fixtures",
      "connectionRef": "env:HARNESS_DB_CREDENTIAL",
      "encrypt": true,
      "trustServerCertificate": false
    }
  }
}
```

The chosen environment must list `qa-db` in `databaseTargets`. `test` enables normal
SELECT and DML, including exploration; `protected` needs explicit `dbDml` permission
for writes. Existing configuration-only targets can still load, but execution needs
the explicit server, database and schema. They are frozen at run initialization.
Neither target names nor credential contents grant capabilities.

The default credential resolver reads the referenced environment variable as JSON
containing only `user` and `password`. Supply it through protected local secret
provisioning, never committed configuration. An optional `resolveCredential` callback
receives the frozen destination and reference; it cannot return a different server,
database, port, schema or TLS policy. Authentication stays in memory. TLS encryption
and certificate verification default on. Explicit self-signed trust is used only by
the disposable local proof.

Use a dedicated SQL principal whose default schema is the configured schema. Grant
only needed SELECT/INSERT/UPDATE/DELETE rights on that schema or its objects, without
server/admin roles, database-wide data grants, schema ownership, DDL or EXECUTE.
The driver checks effective server/database/schema/object privileges before every
business statement and refuses broad or wrong-scope principals. Database permissions
are the security boundary; the lexer is not an authorization parser. Views, triggers,
ownership chains and other programmable objects in the approved schema remain the
database owner's trusted configuration. Audit those dependencies when configuring a
target. Arbitrary server authentication modes and cross-database queries are outside
this first driver.

## Definitions and actual binding

All four source kinds (`catalog`, `helper`, `inline`, `exploration`) use this shape:

```js
const create = defineDatabaseOperation({
  id: 'create-item', target: 'qa-db',
  source: {kind: 'inline', reference: 'item-scenario', version: '1'},
  sql: 'INSERT INTO fixtures.Items (Id, Label) OUTPUT INSERTED.Id VALUES (@recordId, @label)',
  parameters: [
    {name: 'recordId', type: 'int', input: 'recordId'},
    {name: 'label', type: 'nvarchar', length: 200, input: 'label'}
  ],
  checks: [{id: 'created', select: {from: 'affectedRows', path: []}, equals: 1}],
  affectedRows: {min: 1, max: 1},
  extract: [{name: 'recordId', type: 'number', sensitivity: 'public',
    select: {from: 'rows', path: [0, 'Id']}}]
});
```

Each value binds an immutable typed run input or prior output. The driver calls
`Request.input(name, type, value)`; no interpolation or shell SQL path exists.
Undefined/nonfinite values, implicit numeric coercion and overlong inputs fail.
Supported bindings include int, bigint (exact decimal string), bit, float, decimal
(up to 15 digits with declared precision/scale), varchar, nvarchar, varbinary (hex),
uniqueidentifier and datetime2 (canonical UTC milliseconds). Null is supported.
Use nvarchar for Unicode. Driver-native dates, bytes and bigint become ISO text,
hex and exact integer text. SQL datetime2/time fractional precision is preserved
through 100-nanosecond ticks; datetimeoffset instants normalize to UTC (select text
explicitly when the original offset itself is an assertion). High-precision decimal/money result types are refused;
select an explicit textual SQL conversion when exact larger values are needed.

Dynamic object/column identifiers use lexical `{{slot}}` markers plus
`identifiers: {slot: {input: 'tableName', allowed: ['Items', 'OtherItems']}}`.
Only allowlisted single identifiers are bracket-quoted, including embedded closing
brackets. Slots in comments/literals are not replaced. Keep the schema fixed in
SQL. Ordinary SQL values never become identifier fragments.

The small SQL Server lexer classifies ordinary single SELECT/INSERT/UPDATE/DELETE,
including CTEs and INSERT SELECT. It does not validate SQL grammar, translate dialects
or compile a query model. SQL Server validates syntax. DDL, administration, EXEC,
MERGE, legacy text writes, broker commands, batch/session commands, SELECT INTO, linked/cross-database names, temporary
database objects and sequence increments are unsupported even if broader capabilities
are enabled. There is no universal WHERE rule; full-table fixture cleanup can be valid.

Stable definitions are frozen with the run; permitted exploratory definitions are
recorded run-locally. Catalogs receive no special privileges. Changed stable definitions
are rejected before dispatch and cannot replace the frozen input.

## Results, bounds and recovery

Call `runtime.execute({operation, invocationId, phase, inputs, ...})` sequentially;
phases use the existing SETUP/EXERCISE/VERIFY/CLEANUP/RESTORE order. Checks must match
frozen invocation expectations. Selectors address `rows`, `rowCount` or
`affectedRows`; expected values can reference an input with `{$input: 'name'}`.
`selectOutput(attempt, name)` selects explicit business outputs, and `finish()`
validates scope, evidence integrity and lifecycle obligations before writing results.
Package storage is immutable; each runtime requires a fresh consumer-owned run root.

Each operation owns a short-lived pool, closes it before returning, and uses bounded
connection/acquisition/query/cancellation timeouts. Cancellation drains connections;
this bounded drain can extend beyond the scenario deadline. Every attempt records
timing. Defaults are 10 seconds per operation, 1,000 rows and 1 MiB of selected result
data; definitions can lower these within finite limits. Streaming plus native TEXTSIZE
bounds LOB decoding. Values at the truncation/completeness ceiling are rejected, never
silently accepted. XML/variant/spatial results and multiple resultsets are unsupported.

Keep driver affected counts separate. One unambiguous count establishes a DML effect
and supports a declared min/max expectation. Multiple/missing counts (for example
trigger counts) are indeterminate, not summed into an invented success. Reliable
assertion/row-count failures stay FAIL and never retry to green. SQL errors are recorded
without their native messages, which can contain query data.

Known unexecuted operations and non-mutating read transport/timeouts may retry within
the frozen finite budget. Successful recovery can produce PASS with
`stability=recovered` and complete history. Concrete protected inputs are resolved
once per invocation so retries cannot silently change values. Interrupted transmitted
DML stays uncertain and is not replayed; M8 returns NEEDS_REVIEW. It does not infer
rollback from cancellation or provide an automatic reconciliation workflow. A later
read cannot replace a missing required response/count assertion.

Only sanitized metadata, checks and explicitly selected outputs persist. Sensitive
inputs/outputs use protected references and caller-provided `resolveSensitive` /
`storeSensitive` storage callbacks. Declare sensitive output selectors before
execution; overlapping public selectors and known sensitive values are refused.
JSON-encoded result strings are decoded for confidentiality checks before publication;
both member names and values are screened. The existing API sanitizer also checks
member names against known confidential values.
Unselected rows, SQL error text, credentials and before-state are never evidence files.
Protect arbitrary confidential business fields explicitly; name heuristics cannot
discover all domain-specific sensitive data.

## Optional lifecycle obligations

`resource: {id, output, ownership, intent, beforeStateRef?}` records an identity output.
Temporary harness fixtures normally require cleanup; existing temporary changes may
require restoration. `persistent` and `no-obligation` do not create cleanup work or
before-state capture. A mutation can omit resource tracking when no obligation exists.

Cleanup binds the recorded identity and passes `lifecycle: {resourceId}` in CLEANUP.
Only completed required obligations permit a clean pass. Cleanup has the existing
separate shared deadline and can proceed after ordinary cancellation. A failed cleanup
does not erase an established assertion failure.

Restoration is opt-in. Supply a protected before-state reference only when needed,
and use a guarded UPDATE with exactly one expected affected row:

```js
// Binding definitions for originalLabel, recordId and revision accompany this SQL.
sql: 'UPDATE fixtures.Items SET Label=@originalLabel WHERE Id=@recordId AND Revision=@revision',
restorationGuard: {identityParameter: 'recordId', versionParameter: 'revision'},
affectedRows: {min: 1, max: 1}
```

The optional guard validator requires this terminal identity AND version equality
predicate on a direct table UPDATE, with distinct columns and bound inputs. The
driver verifies a single-column unique identity index and an actual server-maintained
rowversion column from database metadata. Bind the recorded resource identity and
the eight-byte post-change version from that original change's outputs. An ordinary
column called version, an arbitrary initial version input, aliases or joined updates
cannot claim this restoration guarantee. A concurrent change causes zero affected rows and a visible
restoration conflict; it cannot overwrite that change. This narrow restoration form
does not restrict ordinary exploratory or regression DML to a query builder.

## Real-instance validation

`npm run test:database` runs local policy/classifier/binding tests. It is not a live
database proof. Run `npm run probe:database` for the real-instance suite, or
`npm run probe:database -- --linux-client` for a pinned Linux Node client as well.
Docker must run x86-64 Linux containers with sufficient memory. The probe explicitly
accepts SQL Server's EULA for a disposable Developer instance used only for testing.
It pins SQL Server's image digest and creates fresh synthetic principals/data. No
historical credential or external database is used.

All SQL, including administrative fixture setup, goes through the driver. Docker
receives generated credentials through environment values, never command arguments
or reports. Local Docker administrators can inspect container environments while
they exist. The probe removes its owned containers/network afterward; no volume or
database backup is retained. After a machine/process crash, remove leftover containers
with the `playwright-harness.milestone=M8` label before reusing that host. The Linux
proof copies only publication candidates and installs the exact root lockfile; it
does not mount the checkout, Git history or private audit material.

The suite fails if its instance is unavailable; it does not count skipped/mock tests
as integration coverage. See [the validation record](M8-VALIDATION.md) for actual
counts, platform versions, review status and limitations. M9 mixed execution and M10
PostgreSQL are not implemented by this milestone.
