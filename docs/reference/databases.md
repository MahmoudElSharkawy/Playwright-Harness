# Database runtimes

SQL Server, PostgreSQL and MySQL share definitions, typed bindings, attempts, effects,
evidence and lifecycle assessment. Native SQL/types stay driver-specific; there is
no dialect translator, ORM or required query builder. Source SQL from consumer team
queries first and follow the [service-class skill](../../.agents/skills/service-classes/SKILL.md).

## Targets and principals

Select an explicit database target through the environment; for example:

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

PostgreSQL uses `engine: "postgresql"`, appropriate destination/database and normally
port 5432. Its operation definitions explicitly declare the engine; omission means
SQL Server. Mismatch fails before credentials resolve. Execution needs server,
database and schema even if an older configuration-only target can still load.

MySQL uses `engine: "mysql"`, MySQL 8.4, and default port 3306. Its schema is the
database: omit `schema` or set it to the same value. Other MySQL versions and
MariaDB are outside this initial support boundary. Definitions must declare
`engine: "mysql"`; existing definitions still default to SQL Server.

Default credentials resolve the reference from shell environment or consumer `.env`
as JSON containing only user/password. Custom resolvers cannot override destination,
schema or TLS. Authentication stays in memory. Encryption/certificate verification
default on; disposable local proofs select their fixture policy explicitly.
Verified MySQL TLS requires a DNS server name and checks both its certificate chain
and hostname. Literal IP targets require an explicit unencrypted or trusted-certificate
fixture policy because the pinned driver omits their TLS server name.
SELECT/DML/exploration capabilities follow [configuration](../configuration.md).

| Engine | Required dedicated principal scope |
|---|---|
| SQL Server | Configured default schema and required SELECT/INSERT/UPDATE/DELETE; no server/admin roles, database-wide data grants, schema ownership, DDL or EXECUTE |
| PostgreSQL | CONNECT, selected-schema USAGE and ordinary DML; no memberships/admin flags, database CREATE/TEMP, schema CREATE, table ownership or broad privileges |
| MySQL | Direct database-level SELECT/INSERT/UPDATE/DELETE on exactly the target database, optionally USAGE; no roles, global/admin, table/column, proxy or grant-option privileges |

Preflight checks effective privileges. PostgreSQL PUBLIC grants often need narrowing;
cross-schema table/column, sequence and user-function access is refused. Permissions
are the authorization boundary, not the lightweight lexer. Approved-schema triggers,
views/functions and ownership chains remain database-owner-controlled dependencies
requiring target administrator review. System database/schema and cross-database scope
are unsupported.

MySQL checks `SHOW GRANTS`, active and applicable roles, and visible table metadata
before each operation. Only InnoDB base tables are supported; visible views and
nontransactional tables fail preflight. Database names containing `_` require an
escaped literal database grant when `partial_revokes` is off. Database owners must
review triggers and definer dependencies; a DML-only principal cannot inspect all
such bodies. These checks do not isolate an untrusted database administrator.

## Definitions and parameter binding

Import `defineDatabaseOperation`/`createDatabaseRuntime` from
`playwright-pom-harness/scripts/lib/database/index.mjs`. A SQL Server definition:

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

Freeze it with typed values and exact expectations using `createRun`, then execute
`runtime.execute({operation, invocationId, phase, inputs, ...})`. This is a definition,
not a complete runnable test. Roots separate immutable package storage from the fresh
consumer run. One runtime handles one scenario; `selectOutput` chooses explicit outputs,
and `finish()` validates scope/evidence/lifecycle. Prefer the
[sequential lifecycle](execution-model.md#sequential-lifecycle) for mixed work.

SQL Server uses native `Request.input` and `@name`; PostgreSQL `$1`, `$2`, … match
the ordered parameter array and pg's values. MySQL uses ordered native `?` parameters
through mysql2 prepared execution. Values never rewrite SQL text:

```js
const read = defineDatabaseOperation({
  id: 'read-item', target: 'qa-db', engine: 'postgresql',
  source: {kind: 'inline', reference: 'spec-read-item', version: '1'},
  sql: 'SELECT "Label" FROM fixtures."Items" WHERE "Id"=$1',
  parameters: [{name: 'recordId', input: 'recordId', type: 'integer'}],
  checks: [{id: 'label-matches', select: {from: 'rows', path: [0, 'Label']},
    equals: {$input: 'label'}}]
});
```

Bindings preserve type, sensitivity and producer. Undefined, nonfinite, coerced or
overlong values fail. Selectors use rows/rowCount/affectedRows. MySQL additionally
supports scalar `insertId` (empty path), an exact string for the first generated
AUTO_INCREMENT identity, only when INSERT generated a nonzero identity. For example:

```js
const createMysql = defineDatabaseOperation({
  id: 'create-mysql-item', target: 'mysql-db', engine: 'mysql',
  source: {kind: 'inline', reference: 'item-scenario', version: '1'},
  sql: 'INSERT INTO Items (Label) VALUES (?)',
  parameters: [{name: 'label', input: 'label', type: 'varchar', length: 200}],
  checks: [{id: 'created', select: {from: 'affectedRows', path: []}, equals: 1}],
  affectedRows: {min: 1, max: 1},
  extract: [{name: 'recordId', type: 'string', sensitivity: 'public',
    select: {from: 'insertId', path: []}}]
});
```

Bind the extracted identity as `unsigned bigint` to later reads or cleanup DELETEs.
Catalog/helper/inline
definitions freeze before execution; enabled exploration has identical controls.
Dynamic identifiers use lexical `{{slot}}` markers and an allowlist such as
`identifiers: {slot: {input: 'tableName', allowed: ['Items']}}`. Engines quote single
allowed identifiers; markers in comments/literals stay untouched. Schema stays fixed.

## Types and completeness

| Engine | Binding/result rules |
|---|---|
| SQL Server | int, bigint exact strings, bit, float, bounded decimal, varchar/nvarchar, varbinary hex, uniqueidentifier and datetime2 canonical UTC milliseconds; null supported |
| PostgreSQL | Bounded text/varchar/bytea/jsonb, integer/bigint, boolean, double precision/numeric, date/timestamp/timestamptz, uuid/xid; precision/scale and byte lengths explicit |
| MySQL | int, signed/unsigned bigint exact strings, boolean, double, bounded decimal, text/varchar, varbinary hex, date/datetime/timestamp and structured json; null supported |

Use nvarchar for Unicode. SQL Server result dates/bytes/bigint become ISO/hex/exact
text; datetime2/time preserve 100-nanosecond ticks, datetimeoffset normalizes UTC.
High-precision decimal/money needs textual SQL projection; XML/variant/spatial and
multiple resultsets are unsupported.

PostgreSQL per-query parsers ignore global overrides: bigint/numeric/xid remain exact
text, binary hex, temporal values preserve microseconds (UTC for timestamptz).
JSON/JSONB returns exact JSON text; project supported fields explicitly for arrays/
unlisted types. Duplicate fields, unsafe names and nonfinite/unsupported values fail.

MySQL text/binary/JSON bindings require byte-length bounds; decimal requires
precision (1–65) and scale (0–30, at most precision). BIGINT and DECIMAL results
remain exact strings. JSON results remain exact JSON text, binary becomes hex,
BOOLEAN results are numeric 0/1. DATE is `YYYY-MM-DD`; DATETIME preserves local
calendar text such as `2026-01-02T03:04:05.123456`; TIMESTAMP preserves microseconds
in UTC with `Z`. Temporal inputs use these same formats. Sessions enforce strict
mode, `NO_BACKSLASH_ESCAPES`, and UTC. Warnings, duplicate columns, invalid dates,
BIT, TIME, spatial and other unsupported result types fail rather than silently
coercing. Project supported fields when a table also contains unsupported types.

Defaults are 10 seconds per operation, 1,000 rows and 1 MiB selected result data.
Connections, query/cancellation and drain are bounded; owned resources close before
return. SQL Server streams with TEXTSIZE and refuses truncation/completeness ceilings.
PostgreSQL row events avoid collecting unselected sets, but native cell decoding
precedes the byte ceiling, so it is not a universal pre-decoding memory bound.
Cancellation drain has a separate finite window.

MySQL bounds streamed rows/bytes after native decoding, with the same per-cell
memory limitation. Each operation owns one connection and transaction. Cancellation
destroys the local socket; server completion or rollback may lag that close.
Connection establishment and lock waits are also bounded by the operation deadline.

Returned rows and affected counts differ. One unambiguous DML count supports min/max;
missing/multiple counts, including trigger counts, are indeterminate rather than summed.
PostgreSQL commits after response completeness/representability checks. Reliable
count/assertion failures remain FAIL and never retry to green.

MySQL DML returns no rows (`rowCount: 0`). UPDATE affectedRows counts matched rows,
including unchanged values, using the native FOUND_ROWS capability. INSERT/DELETE
report their native counts. MySQL commits after result/type/warning validation;
later assertion failures remain failures even when that mutation has committed.

## Supported SQL and recovery

The classifiers admit single SELECT/INSERT/UPDATE/DELETE, read CTEs and INSERT SELECT;
native engines validate grammar. There is no universal WHERE requirement.

- SQL Server refuses DDL/admin/EXEC/MERGE, legacy text writes, broker/batch/session
  commands, SELECT INTO, linked/cross-database names, temporary objects and sequence increments.
- PostgreSQL refuses multiple statements, session/admin/DDL, COPY/CALL/DO,
  data-modifying CTEs, UPSERT and Unicode escape syntax. Bound Unicode works.
  SELECT uses a server-enforced read-only transaction. Reserved `pg_*` functions
  are refused except pg_typeof, pg_column_size, pg_backend_pid, pg_sleep,
  pg_sleep_for and pg_sleep_until. Large-object APIs, set_config, query_to_xml
  family and ts_stat/ts_rewrite evaluators are unsupported, including bound/quoted names.
- MySQL refuses multi-statements, executable/optimizer comments, DDL/admin/session
  commands, CALL/LOAD, REPLACE statements, IGNORE/UPSERT, SELECT INTO, user variables,
  lock/file/admin/session-state functions and guarded restoration. SELECT runs in
  a read-only transaction. INSERT SET and ordinary value functions are supported.

Read-only transactions do not inspect owner-controlled bodies or prevent every
signaling entrypoint. Privileges and scope checks work together; capability overrides
do not add unsupported operations. Safe reads/known unexecuted work may retry within
budget. Sensitive inputs resolve once per invocation. Interrupted transmitted DML
stays uncertain and is not automatically replayed; a lost PostgreSQL or MySQL COMMIT reply can
follow an actual commit. There is no automatic DB reconciliation workflow. A later
read cannot replace a missing response/count assertion. Unresolved effects need review.

Only sanitized metadata/checks and selected outputs persist. Raw SQL errors, credentials,
unrestricted rows and before-state are not evidence. Sensitive selectors/overlapping
paths/known values and JSON-encoded values are screened. Protected storage callbacks
return opaque refs; classify domain-sensitive data explicitly.

## Cleanup and guarded restoration

Resources bind an originating identity, ownership and intent. Temporary owned fixtures
need cleanup, borrowed temporary changes may need restore, and persistent/no-obligation
outcomes create neither disposal nor automatic before-image requirements. Cleanup binds
original identity in CLEANUP with `lifecycle: {resourceId}`. Pending/failed obligations
prevent a clean pass while established failures remain. One cleanup budget survives cancellation.

Restoration is opt-in: protected before-state, original identity, and the genuine
post-change version from the originating mutation. Use a direct ordinary-table UPDATE
with terminal identity AND version equality and exactly one affected row. Declare
`restorationGuard: {identityParameter: 'recordId', versionParameter: 'revision'}`.
SQL Server uses server-maintained rowversion; PostgreSQL uses xmin, bound as xid.
Metadata verifies a single-column unique identity. Ordinary version-named columns,
arbitrary initial versions, aliases/joined updates cannot claim that guarantee.
Concurrent changes produce visible conflict. xmin can wrap; use it within short-lived
scenarios, not as a durable global revision token.

MySQL supports identity-bound cleanup for temporary owned fixtures, but rejects
`restorationGuard` and RESTORE execution before credentials or business SQL. An
ordinary version column cannot substitute for SQL Server rowversion or PostgreSQL
xmin. Durable generated MySQL POM services are outside this execution feature.

Run `test:database`, `test:postgresql` and `test:mysql` for contracts/bindings. Native
`probe:database`, `probe:postgresql`, `probe:mysql` and `probe:database-neutrality` need owned disposable
instances and pinned Docker images. SQL Server Developer proofs explicitly accept its
EULA. No private checkout mounts, persistent volumes or backups are used; generated
credentials remain in memory/environment. Docker administrators can inspect live
container environment. Missing prerequisites do not become skipped successes.
After crashes inspect exact owned identities/labels before recovery; preserve unrelated infrastructure.

See [contributing](../contributing.md) and archived
[SQL Server](../archive/milestones/M8-SQLSERVER.md) /
[PostgreSQL](../archive/milestones/M10-POSTGRESQL.md) for full type/guard/proof details.
Database semantic neutrality does not prove all host/workflow behavior.

`probe:mysql` also requires the installed native Chromium browser and proves a real
browser → API → MySQL scenario, exact CRUD/types, policy/privilege rejection, bounded
failure/cancellation, protected outputs, uncertain COMMIT and owned cleanup. Linux
CI runs it from the installed archive; missing prerequisites fail the proof.
