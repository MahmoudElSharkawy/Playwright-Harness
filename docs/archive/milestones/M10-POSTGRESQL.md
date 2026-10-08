> Historical record. Read the [current documentation](../../reference/databases.md) for present behavior. Statements and validation results below describe their original implementation period.

# M10 PostgreSQL and database neutrality

M10 adds the concrete PostgreSQL driver to the existing deterministic database
runtime. The same library interfaces serve exploration, catalog operations,
helpers and fixed inline definitions. Environment capabilities, typed outputs,
attempts, effects, evidence and optional lifecycle obligations stay shared.
SQL and native types stay in each engine's driver and syntax module. No SQL
translation, ORM, general parser, host adapter or workflow engine is introduced.

## Configuration and native binding

Use an explicit configured target; names never imply permission:

```json
{
  "engine": "postgresql",
  "server": "database.example.com",
  "port": 5432,
  "database": "automation",
  "schema": "fixtures",
  "connectionRef": "env:AUTOMATION_DATABASE_CREDENTIAL",
  "encrypt": true,
  "trustServerCertificate": false
}
```

Resolve the reference to an in-memory user/password pair. Credentials cannot
override the destination. TLS and certificate verification are enabled by default;
the disposable local fixture explicitly disables TLS. A definition declares
`engine: 'postgresql'`; existing definitions without an engine keep SQL Server
semantics. A definition/target mismatch fails before credential resolution.

```js
import {defineDatabaseOperation} from '../scripts/lib/database/index.mjs';

const read = defineDatabaseOperation({
  id: 'read-item', target: 'qa-db',
  source: {kind: 'inline', reference: 'spec-read-item', version: '1'},
  engine: 'postgresql',
  sql: 'SELECT "Label" FROM fixtures."Items" WHERE "Id"=$1',
  parameters: [{name: 'recordId', input: 'recordId', type: 'integer'}],
  checks: [{id: 'label-matches', select: {from: 'rows', path: [0, 'Label']}, equals: {$input: 'label'}}],
  extract: [{name: 'label', type: 'string', sensitivity: 'public', select: {from: 'rows', path: [0, 'Label']}}]
});
```

This is a library definition, not a standalone run. Freeze it and its typed inputs
through the [core contracts](M5-EXECUTION-CORE.md), then execute it with the database
runtime or [sequential lifecycle](M9-SEQUENTIAL.md). The native `$1`, `$2`, ...
references match the ordered parameter array exactly; values go to pg's `values`
array. No substitution rewrites native SQL. Dynamic identifiers use the existing
explicit allowlist slots and PostgreSQL quoting, independently of value binding.
See [node-postgres queries](https://node-postgres.com/features/queries).

The driver accepts bounded text/varchar/bytea/jsonb, integer, bigint, boolean,
double precision, numeric, date, timestamp, timestamptz, uuid and xid inputs.
Text, binary and JSON declare a byte length; numeric declares precision and scale.
Bigint/numeric/xid use exact decimal strings. Bytea uses hexadecimal strings.
Temporal inputs use ISO text with up to six fractional digits; timestamptz uses
UTC `Z`. Structured JSON is serialized as a separately bound value. PostgreSQL
validates calendar values and actual SQL syntax.

## Scope, transactions and results

Each operation owns a native pg connection and transaction. The preflight requires
a dedicated login with CONNECT, selected-schema USAGE and ordinary DML privileges,
without role memberships, administrative flags, database CREATE/TEMP, schema CREATE,
table ownership or broad table privileges. Cross-schema table/column, sequence and
user-function access is refused. Target system databases/schemas are refused.
The default PostgreSQL PUBLIC grants usually need narrowing during onboarding.
Configured database owners administer these privileges; normal scenario mutations
do not request repeated harness approval.

SELECT executes inside a server-enforced read-only transaction. The real probe
verifies that a function attempting a write and a sequence increment are rejected
without changing data. Native privileges enforce schema access. This is not a
sandbox for malicious database owners: triggers, functions and other programmable
objects in the approved schema remain owner-controlled dependencies. See
[PostgreSQL transaction modes](https://www.postgresql.org/docs/current/sql-set-transaction.html).

Read-only mode alone does not prevent server signaling or notifications. The
lightweight classifier also refuses reserved `pg_*` function calls except
`pg_typeof`, `pg_column_size`, `pg_backend_pid`, `pg_sleep`, `pg_sleep_for` and
`pg_sleep_until`. Large-object `lo_*`/`loread`/`lowrite`, `set_config`, the
`query_to_xml` family and `ts_stat`/`ts_rewrite` SQL evaluators are unsupported.
Quoted, schema-qualified and dynamically bound function identifiers receive the
same check. Ordinary value functions remain available. These exclusions close
native administrative entrypoints, including supplied-SQL indirection, without
claiming to inspect the bodies of owner-controlled programmable objects. See
[PostgreSQL administrative functions](https://www.postgresql.org/docs/16/functions-admin.html).

Lightweight lexical classification admits ordinary SELECT/INSERT/UPDATE/DELETE,
read CTEs and INSERT SELECT. It refuses multiple statements, session commands,
DDL/admin, COPY/CALL/DO, data-modifying CTEs and UPSERT. Unicode escape syntax is
unsupported; bound Unicode values work. Prepared extended queries add native
single-statement enforcement. No general dialect grammar is a prerequisite for
ordinary DML, and no universal WHERE or catalog requirement is imposed.

Native row events avoid accumulating unselected resultsets. Row count, selected
result bytes, connection time, query time and cancellation are bounded. A native
driver decodes each incoming row before the harness applies its byte limit; the
limit is not a hard pre-decoding memory ceiling for an arbitrarily large cell.
Results above the configured bound, unsupported native types, duplicate fields,
unsafe member names and nonfinite numbers fail explicitly. Defaults remain
10 seconds, 1,000 rows and 1 MiB, with finite definition overrides.

Per-query parsers isolate execution from global pg parser overrides. Integer and
boolean results use ordinary JSON scalars; bigint/numeric/xid use exact text.
Binary results use hex, and date/time results preserve microseconds as ISO text
in UTC. JSON/JSONB results are exact JSON text, avoiding implicit JavaScript numeric
rounding; select them as strings or use explicit native SQL field extraction.
Arrays and unlisted native types require an explicit supported SQL projection.
The shared runtime still checks encoded JSON for sensitive members and values.
See the [native client API](https://node-postgres.com/apis/client) and
[type behavior](https://node-postgres.com/features/types).

The neutral completion contains rows, returned-row count and a separate native
affected count. PostgreSQL commits only after the response is complete and its
types/counts are representable. Connection cleanup is owned and bounded, including
after cancellation. Native SQL diagnostics and unrestricted rows are not persisted;
only sanitized metadata, required checks and selected outputs become evidence.

## Recovery and conditional lifecycle

Safe read retries can finish PASS with `stability=recovered`; attempts remain
visible and protected inputs resolve once. A reliable assertion stays FAIL.
Any interrupted transmitted mutation remains uncertain and is not replayed merely
because a disconnect normally rolls back a transaction. A lost COMMIT response
can follow an actual commit. The real fixture proves this case yields NEEDS_REVIEW
without a duplicate write. Reconciliation cannot replace a missing required response.

Temporary owned fixtures normally clean up. Existing data can require restoration;
persistent and no-obligation outcomes require neither cleanup nor before-images.
The shared lifecycle records those distinctions and cleanup remains available after
ordinary cancellation. Required cleanup failure prevents a clean pass.

Optional PostgreSQL restoration uses a direct ordinary-table UPDATE with a unique
identity and the server's `xmin` from the originating change's output:

```js
sql: 'UPDATE fixtures."Items" SET "Label"=$2 WHERE "Id"=$1 AND xmin=$3',
parameters: [
  {name: 'recordId', input: 'recordId', type: 'integer'},
  {name: 'label', input: 'originalLabel', type: 'text', length: 500},
  {name: 'revision', input: 'revision', type: 'xid'}
],
restorationGuard: {identityParameter: 'recordId', versionParameter: 'revision'},
affectedRows: {min: 1, max: 1}
```

The driver checks the unique key in native metadata. A concurrent update causes a
visible restoration conflict, rather than overwriting that update. This narrow
guard is optional and does not constrain ordinary exploratory DML. `xmin` is a
transaction identity that can wrap; use it only within the short-lived scenario,
with the original resource identity. It is not a durable/global revision token.
See [PostgreSQL system columns](https://www.postgresql.org/docs/current/ddl-system-columns.html).

## Repeatable proof and boundaries

`npm run test:postgresql` runs local classifier/binding/assessment tests. It does
not claim real database coverage. `npm run probe:postgresql` creates a fresh
PostgreSQL 16 fixture, runs native precision, privilege, recovery, cancellation and
effect-uncertainty checks plus the shared scenarios, and removes owned resources.
`npm run probe:database-neutrality` runs both native engines and compares all 12
normalized scenario receipts. Either command accepts `-- --linux-client`.

Docker must support the pinned Linux images. The SQL Server half uses its existing
Developer fixture with explicit EULA acceptance. Credentials are generated in
memory, passed by environment reference and never saved to the checkout or audit
logs. Docker administrators can inspect them while the containers exist. Only
publication candidates enter the Linux client; its exact root lockfile is installed
without scripts. No checkout/private audit mounts or persistent volumes are used.
After a machine/process crash, inspect leftover owned containers/networks carrying
the `playwright-harness.milestone=M10` label before reusing the host.

The comparison preserves assertions, status/stability, source kinds, business
outputs, producer relationships, failure classes, effect certainty, evidence kinds
and resource lifecycle outcomes. It omits execution IDs, times, hashes and native
revision contents. Each underlying run validates its own evidence integrity before
normalization. Missing, duplicate or zero-scope fixtures fail the comparison.
These are database semantics; full Claude/Codex host parity remains M11.

See [M10 validation](M10-VALIDATION.md) for actual pinned versions, counts, review
and acceptance. No public release or later milestone is implied by these commands.
