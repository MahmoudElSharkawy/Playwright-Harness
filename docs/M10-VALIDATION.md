# M10 validation record

M10 is accepted on 2026-10-01: required validation passed and independent corrective
review approved the implementation. No finding was waived. M11 has not started.
See [the PostgreSQL guide](M10-POSTGRESQL.md) for the interface, lifecycle policy
and known limits.

The implementation starts from `a15fec03ede69504659995b0bb3c7bdcc90c549a` on the
existing `main` branch. It adds one concrete PostgreSQL driver behind the shared
database interface, native syntax/type handling and real neutrality fixtures.
Package metadata is aligned at 3.0.10. The exact pg 8.23.1 root dependency and
required third-party notices are recorded. No SQL translation, ORM, general parser,
workflow engine, browser language, host adapter or parallel scheduler is added.

The approved review-02 diff contains 29 files, 1,366 additions and 68 deletions,
SHA256 `07a6578dd406990efbfc328caa56291cd21e57294c64013caedebb5b52cc4054`.
The independent reviewer verified all 222 frozen publication source hashes. Only
this acceptance record changed after approval; a separate source comparison and
final documentation/publication checks validate that delivery change. Frozen
patches, original defect demonstrations and exact command receipts remain in
protected local audit storage.

## Package checks

Checks-02 passed all 17 commands after the review correction. The actual local launcher is
`node <node-install>/node_modules/npm/bin/npm-cli.js run <script>` (or `test` for
the entire suite); the ordinary npm launcher is unavailable locally. Protected
receipts preserve exact commands, exit codes and output.

| Command | Result and scope |
|---|---|
| `npm run check:syntax` | PASS: 79 JavaScript files |
| `npm run check:json` | PASS: 20 files, 19 parsed records |
| `npm run check:links` | PASS: 93 Markdown files, 371 local links |
| `npm run check:conventions` | PASS: 15 example files, 60 rule applications, zero findings |
| `npm run test:core` | PASS: 82 tests |
| `npm run test:browser` | PASS: 11 tests |
| `npm run test:api` | PASS: 61 tests |
| `npm run test:database` | PASS: 57 tests |
| `npm run test:sequential` | PASS: 13 tests |
| `npm run test:postgresql` | PASS: 39 tests |
| `npm test` | PASS: 423 tests; includes the focused suites above |
| `npm run test:fetch` | PASS: 15 checks, 3 parsed synthetic nodes |
| `npm run typecheck:examples` | PASS: 18 TypeScript files |
| `npm run check:privacy` | PASS: 222 publication candidates |
| `npm run check:secrets` | PASS: 222 publication candidates |
| `npm run check:provenance` | PASS: 222 candidates, 240 dependency records |
| `npm run check:publication` | PASS: 222 candidates, 219 packed files |

All test suites above reported zero skipped tests. JSON parsing is not schema
validation. Link checks cover local files, not anchors or remote URLs. Runtime
scripts are outside the POM convention layer map; an empty changed-file scope is
not passing convention coverage. The substantive example gate remains nonzero
without weakened rules or expanded baselines. Local contract tests do not replace
native database proof.

## Real database proof

| Receipt | Command | Actual outcome |
|---|---|---|
| pg-windows-02 | `node scripts/probes/postgresql.mjs` | PASS: 73/73 (37 focused, 24 PostgreSQL-specific live, 12 shared live), zero skipped |
| pg-linux-02 | `node scripts/probes/postgresql.mjs --linux-client` | PASS: 73/73, zero skipped |
| comparison-windows-02 | `node scripts/probes/database-neutrality.mjs` | PASS: 12/12 equivalent live scenarios, zero differences |
| comparison-linux-02 | `node scripts/probes/database-neutrality.mjs --linux-client` | PASS: 12/12 equivalent live scenarios, zero differences |
| sql-regression-01 | `node scripts/probes/sqlserver.mjs` | PASS: 39/39 existing live SQL Server cases, zero skipped |
| mixed-regression-01 | `node scripts/probes/sqlserver.mjs --mixed` | PASS: 20/20 existing live browser/API/SQL cases, zero skipped |

The comparison runs both disposable engines sequentially and requires each live
suite to exit successfully, produce a real-instance receipt and remove owned
containers/networks. It also requires all 12 named normalized scenario results.
The Linux SQL Server comparison runs its 57 focused tests plus 12 shared live
cases; the corrected PostgreSQL suite runs its 37 focused, 24 native and 12 shared cases. These overlap
the separately reported suites and are not additional unique test counts.

Actual versions: Windows client Node 24.15.0; pinned Linux client Node 24.18.0;
PostgreSQL 16.14 (Debian 16.14-1.pgdg13+1), pg 8.23.1; SQL Server 16.0.4295.3,
node-mssql 12.7.2. Immutable image references:

```text
postgres@sha256:fe03a7605299a34ddf5e4f285dff78c3d7190a576b3c6b46f2fcff69f4bffd54
mcr.microsoft.com/mssql/server@sha256:4402d880dd4c34bfa7d8705e56a86cd6c88da80a1f6bbbe741f999e76264a090
node@sha256:5711a0d445a1af54af9589066c646df387d1831a608226f4cd694fc59e745059
```

The shared cases cover CRUD with catalog/helper/inline/exploration sources, typed
producer bindings, extraction, temporary fixtures, optional restoration, concurrent
restoration conflict, persistent/no-obligation outcomes, assertion failure, required
cleanup failure, DB-to-API verification and partial setup cleanup. Normalization
preserves source kind, status/stability, assertions, business values and relationships,
failure/effect decisions, evidence-kind coverage and required lifecycle outcomes.
Native revision values, IDs, timing and artifact hashes are intentionally excluded;
each original result still validates its own evidence integrity.

PostgreSQL-specific live cases prove bound injection-shaped values, controlled
identifiers, precision/microseconds, redaction, server read-only function/sequence
refusal, principal and cross-schema column privilege checks, unsupported/oversized
results, real lock-wait recovery, cancellation, cleanup after cancellation and a
lost COMMIT reply after an actual committed write. No simulated database supplies
these results. Full TLS deployment configurations and other PostgreSQL releases
were not exercised. The disposable PostgreSQL connection is local without TLS.

## Independent review and acceptance

Review-01 returned CHANGES-REQUIRED with one blocking P1. Real protected-profile
reads could terminate a same-role backend or deliver a notification; a bound SQL
query passed through `query_to_xml` could do the same indirectly. All three were
incorrectly labeled PASS with no effect. The reviewer reproduced each on disposable
owned resources and confirmed cleanup. Initial green suites did not cover this gap.

The correction adds a bounded lexical call restriction for administrative/system,
large-object and supplied-SQL evaluator functions, including quoted, qualified and
dynamically bound identifiers. It keeps ordinary value functions and dynamic DML.
The new native protected-profile regressions confirm no credential resolution or
dispatch, a surviving owned peer and no notification delivery. The original
reproductions and correction receipts are retained.

Independent review-02 returned APPROVE with F1 resolved and no remaining findings.
The reviewer independently ran 39 focused tests, the 15-file/60-application convention
gate and three real PostgreSQL correction tests in a fresh owned fixture. Direct,
quoted and qualified calls were refused; identifier-bound termination, notification
and XML indirection each returned BLOCKED/not-executed before credential resolution.
The owned peer remained alive, no notification arrived and fixture cleanup passed.

All M10 acceptance requirements are satisfied: real ordinary DML across four peer
sources, precise extraction, equivalent business semantics on both engines,
conditional restoration, conflict handling, required cleanup and intentional
persistence. Driver-local SQL/native types are preserved. Both client platforms
passed; the existing SQL Server and mixed-lifecycle suites remain green. No general
parser, automatic SQL translation, ORM or later milestone was introduced.

Final delivery checks cover syntax, JSON, local links, privacy, secrets, provenance,
publication content and whitespace. The changed-file convention command correctly
refuses its empty POM scope; it is not recorded as a passing gate. Separate nonzero
example coverage provides the substantive convention result. TLS deployment
variants, other PostgreSQL releases and full host parity remain unperformed,
outside this milestone's demonstrated scope.

Historical credential rotation remains unconfirmed; removed historical values are
not used or reproduced by these synthetic local proofs. Original source rights are
owner-cleared; required dependency notices remain recorded. No public release,
tag or later milestone is authorized by M10 completion.
