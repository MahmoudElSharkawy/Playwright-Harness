# M8 validation record

M8 is accepted on 2026-10-01: all required gates passed, and independent review
approved the corrected implementation. No finding was waived. M9 is not started.
The [SQL Server guide](M8-SQLSERVER.md) describes the interface, required privileges
and supported limits.

## Scope and frozen review

The implementation starts from `086595b7d2b7433bde63153368b4b681eb822929` on the
existing `main` branch. M8 adds one sequential database runtime using M5 identities,
capabilities, typed bindings, effect records, evidence, recovery and lifecycle
assessment. Catalog, deterministic helper, fixed inline and exploratory definitions
share the same controls and actual SQL Server driver.

Ordinary bound SELECT/INSERT/UPDATE/DELETE remains available in configured test
environments. Cleanup and restoration follow ownership and declared intent;
persistent and no-obligation outcomes do not require automatic before-state capture.
The lightweight statement classifier is driver-local. No general SQL parser,
workflow engine, browser command language, new host adapter, mixed execution or
PostgreSQL driver is added.

One matching confidentiality correction in the existing API sanitizer screens object
member names against known protected values, with a real-loopback regression. It
does not change API authorization or introduce a shared-engine refactor. Package
metadata is aligned at 3.0.8. Consumer examples and convention baselines are unchanged.

The final review-03 diff contains 23 files, 2,695 additions and 12 deletions, SHA256
`b62b782d3ab6af10d5a8b82a92286db57c0530c6e9c7634cb0733d37ee8b1264`.
Frozen patches, original findings, synthetic reproduction observations and validation
receipts remain in protected local audit storage. Only this acceptance document
changed after approval; final documentation, privacy, secret, provenance and
publication checks are recorded separately.

## Package validation

Checks-04 passed all 15 commands. They ran through the Node installation's bundled
npm CLI because the local npm launcher is unavailable. The exact launcher pattern
was `node <node-install>/node_modules/npm/bin/npm-cli.js run <script>`; the whole
suite used `node <node-install>/node_modules/npm/bin/npm-cli.js test`.
Receipts preserve exit status, standard output and standard error.

| Command | Result and actual scope |
|---|---|
| `npm run check:syntax` | PASS: 63 JavaScript files |
| `npm run check:json` | PASS: 20 files, 19 parsed records |
| `npm run check:links` | PASS: 89 Markdown files, 354 local links |
| `npm run check:conventions` | PASS: 15 example files, 60 rule applications, zero findings |
| `npm run test:core` | PASS: 82 tests, zero skipped |
| `npm run test:browser` | PASS: 11 tests, zero skipped |
| `npm run test:api` | PASS: 61 tests, zero skipped |
| `npm run test:database` | PASS: 57 tests, zero skipped |
| `npm test` | PASS: 371 tests, zero skipped; includes the focused suites above |
| `npm run test:fetch` | PASS: 15 self-test checks, 3 parsed synthetic nodes |
| `npm run typecheck:examples` | PASS: 18 example TypeScript files |
| `npm run check:privacy` | PASS: 202 publication candidates |
| `npm run check:secrets` | PASS: 202 publication candidates |
| `npm run check:provenance` | PASS: 202 candidates, 226 dependency records |
| `npm run check:publication` | PASS: 202 candidates, 199 packed files |

JSON parsing is not schema validation. Remote links and Markdown anchors were not
checked. The changed-files convention invocation cannot claim coverage for package
runtime code outside its POM layer map; zero scope is not a passing check. The
nonzero example gate passed without weakening rules or expanding a baseline.
Local tests include refusal and contract cases; their total is not a count of
database executions.

## Real SQL Server validation

| Command | Client | Actual database cases | Other cases | Outcome |
|---|---|---:|---:|---|
| `node scripts/probes/sqlserver.mjs` | Windows, Node 24.15.0 | 39 | 0 | PASS, zero skipped |
| `node scripts/probes/sqlserver.mjs --linux-client` | Linux, Node 24.18.0 | 39 | 57 focused | PASS, 96 total, zero skipped |

Both final probes used node-mssql 12.7.2 and SQL Server 16.0.4295.3 from this pinned
SQL Server 2022 image:

`mcr.microsoft.com/mssql/server@sha256:4402d880dd4c34bfa7d8705e56a86cd6c88da80a1f6bbbe741f999e76264a090`

The Linux client image was:

`node@sha256:5711a0d445a1af54af9589066c646df387d1831a608226f4cd694fc59e745059`

The same real database cases ran from both client platforms; they are not 78
distinct behaviors. Linux copied only the 202 publication sources and installed
the exact root lockfile with lifecycle scripts disabled. It mounted no checkout,
Git history or private recovery material. SQL Server ran as a disposable Linux
container for both proofs; this is not a Windows-native SQL Server installation
claim.

Every fixture query, including setup, uses the native driver. Administrative setup
uses a separate generated fixture principal; business execution uses a dedicated
schema-scoped principal. Tests create synthetic data and credentials only.
Both final receipts confirm owned database/client/network cleanup, and a separate
post-run inventory found no remaining M8-labeled containers or networks.
No database volume, backup or credential-bearing recovery copy was retained.

Live coverage includes:

- Read and mutation equivalence across catalog/helper/inline/exploration sources;
  dynamic CRUD, injection-shaped bound values, controlled identifiers, native
  parameter types and selected typed outputs.
- Temporary fixture cleanup, ordinary full-table cleanup, required restoration,
  intentionally persistent and no-obligation outcomes without forced before-images.
- Affected-row assertions, reliable FAIL preservation, ambiguous trigger counts,
  missing/failed required cleanup and unchanged frozen definitions.
- Dedicated schema/database permissions, broad-principal refusal, protected
  capability decisions and default/unsupported DDL/admin refusal.
- Real timeout/cancellation, safe recovered reads with stable protected inputs,
  uncertain transmitted writes without replay, and cleanup after cancellation.
- Sensitive values, JSON values and member names, native-error redaction, row/byte
  bounds, LOB completeness, native precision and 100-nanosecond datetime2 results.
- Genuine rowversion restoration guards, post-change output provenance,
  concurrent-change conflicts and refusal of ordinary binary version substitutes.
- Legacy mutation classification and a live global-temporary-table visibility
  control followed by runtime refusal of fixed, quoted and dynamic references.

Required real-instance availability failures are failures, not silent skips.
Assessed runs validate their own artifact files and integrity through M5.
Some cases deliberately prove refusal before dispatch; the live control establishes
the database condition instead of treating a mocked result as integration proof.

## Independent review disposition

The independent reviewer verified the patch digest and all 202 frozen source
hashes, checked the approved M8 requirements and architecture, and examined test
behavior and actual validation receipts. It reran local in-memory checks for the
reported defects and normal controls; it did not independently rerun live SQL probes. Earlier green candidates were not
accepted when review exposed missing cases. All five distinct finding classes are
resolved, including the reopened confidentiality class:

| Finding class | Resolution |
|---|---|
| Legacy mutation accepted as a read | Unsupported legacy and batch command families are refused; ordinary CASE expressions and SELECT/DML controls remain supported. |
| JSON-encoded protected values or member names exposed | Bounded decoded inspection screens both names and values before public outputs or assertion evidence; ordinary public siblings remain usable. The API path receives the matching member-name fix. |
| Native temporal precision lost | SQL Server fractional ticks are preserved during normalization; expecting the former truncated value reliably fails. |
| Identity or arbitrary binary value masqueraded as restoration version | Optional restoration verifies distinct columns, unique identity and genuine rowversion metadata, and binds the version from the original change's outputs. Concurrent changes cannot be overwritten. |
| Quoted or dynamic temporary objects escaped scope | Temporary names are refused consistently in plain and quoted tokens; identifier binding re-runs classification. Live shared-object visibility and runtime-refusal controls pass. |

The original failing evidence remains available in protected audit storage.
No finding is converted into an accepted risk merely because ordinary tests pass.

## Provenance, limits and remaining dependencies

The root lockfile and runtime license inventory describe 73 separately installed
dependencies, including node-mssql 12.7.2. Installed packages have top-level
license/notice files. The 226 checked dependency records comprise 150 example,
3 Playwright CLI and 73 runtime records. Required notices are preserved. New
project implementation is original; no third-party implementation was copied.
Microsoft SQL Server Developer and the Linux Node image remain separate upstream
distributions and are not bundled or relicensed under the project's MIT license.

M8 supports ordinary single-statement DML with SQL Server authentication and a
dedicated scoped principal. Database permissions remain the security boundary;
programmable objects and ownership chains within the configured schema are trusted
owner configuration. The classifier is not an exhaustive T-SQL grammar or a general
query compiler.

High-precision decimal/money results require an explicit textual SQL conversion;
unsupported result types, multiple resultsets and ambiguous affected-row counts
are refused instead of approximated. Optional guarded restoration deliberately uses
a narrow direct-table UPDATE form. Uncertain writes remain NEEDS_REVIEW; automatic
write reconciliation is not implemented by M8.

External/Azure deployments, alternate authentication modes, native Windows SQL
Server hosting, live Claude/Codex parity and later mixed execution were not tested.
The live precision regression covers datetime2(7); time/datetimeoffset use the
reviewed conversion but were not separately exercised live. The M6 live browser
probe was not rerun; browser policy and shared-core regressions passed. PostgreSQL, generation/review integration, reporting and bounded parallel
execution remain later milestones.

Historical credential revocation/rotation remains owner-dependent and unconfirmed.
M8 did not read, reproduce or test historical credentials. Protected business-value
storage remains consumer-provided. Confidential business selectors must be declared
sensitive; the checks do not discover every arbitrary encoding or undeclared secret. No public package release or release tag was
created. M9 and later implementation require the next authorization.
