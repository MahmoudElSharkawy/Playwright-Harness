# DB query discovery validation

Recorded 2026-10-29 for issue #134. This is the implementation/proof record;
use the [database reference](../../reference/databases.md#schema-backed-query-discovery)
and [design contract](../../db-query-discovery-design.md) for current behavior.

## Supported scope

SQL Server ordinary tables, bounded literal table-name hints or exact table names,
and SELECT lookup/verification by a complete nonnullable unique key. Metadata uses
the existing native driver and restricted-principal preflight. No extra privileges,
row sampling, inferred joins/status meanings or mutation recipes are introduced.
PostgreSQL/MySQL discovery and generated MySQL services remain unsupported; their
existing execution adapters are unchanged.

## Verification

| Gate | Result |
|---|---|
| Final clean Windows package checklist | 14/14 gates; 1,746/1,746 tests passed; no failures, skips or cancellations |
| Final POSIX discovery/persistence/reporting | 65/65 passed; no failures, skips or cancellations |
| Independent implementation review | Passed after two reporting corrections |
| Final native SQL Server/GUI/POM proof | READY after independent review and two distinct scoped green runs; both Allure captures passed business-step and nested-DB-evidence checks |

Windows uses Node 24.15.0. POSIX checks used Linux Node 24.18.0 in the pinned
`node@sha256:5711a0d445a1af54af9589066c646df387d1831a608226f4cd694fc59e745059`
container, with a public source archive, locked dependencies and no host mounts or
forwarded credentials. The owned container and staging directory were removed.
This establishes POSIX file/persistence behavior, not live Linux UI/DB discovery.

The Windows checklist runs on an exact external snapshot of Git-tracked and
nonignored task files with a recorded hash manifest, three locked dependency
installs, and source-mode Git metadata. Local ignored agent/plugin installations
remain outside that snapshot. Validation rules and user files were not changed.

## Native proof contract

`npm run probe:discovered-db` creates an external disposable consumer and an owned
SQL Server 2022 container using the pinned existing probe image and mssql 12.7.2.
Its native run establishes:

- An initially absent query library and no generated POM code during standalone execution.
- Bounded metadata discovery through the literal `Order` hint and a typed exact-key SELECT.
- Established DB setup, required UI submission and UI checks, source-defined persisted-state checks, owned deletion and verified absence.
- Reviewed immutable authority, separate derived Markdown, stable repeated promotion, untouched supplied bytes and exclusion of credential/customer/current-ID sentinels.
- Rejection of missing cleanup evidence for reuse/promotion, followed by restoration of the exact retained artifact.
- A separate process using a new identity and fresh schema evidence, with current query selection and saved library visible in reporting.
- Ordinary `DbsOrders`/`DBActions` and page methods, independent review, then two separate scoped native runs. Allure captures must retain business steps and nested database attachments.

The independent reviewer re-assesses frozen source/snapshot/history, all seven
source expectation mappings, matching reviewed SQL, the mixed run's eight checks,
the later reuse run's six checks, distinct identities and complete lifecycle.
No query-author approval substitutes for generated-candidate independent review.

## Failed attempts and repairs

- Red-first regressions covered unsupported/forged metadata, source-only checks,
  concurrent promotion, exact review attribution and cross-scenario reuse.
- Independent review found missing cross-scenario reuse reporting and a review
  label joined by operation name instead of exact candidate identity. Both were
  repaired, regression-tested and independently rechecked. Reuse receipts live in
  reporting state and do not claim a successful SQL execution.
- The first live attempt reached native metadata but Playwright rejected the
  system temporary directory before business operations. The external proof
  directory resolved that environment restriction; owned SQL cleanup passed.
- Two later proof attempts completed standalone execution and reuse, then were
  explicitly cancelled before verification: one for the reporting repair and one
  to enable actual Allure capture. Non-approval markers and audits were retained;
  both owned containers were removed and neither attempt claimed a green.
- The first generated run with Allure capture failed before DB assertions because
  the proof used an ES-module package with the existing CommonJS SQL Server facade.
  The fixture package mode was corrected to match the shipped examples. The same
  consumer retains that failed invocation, its Allure capture and generation
  history; the repair is registered as a script defect rather than resetting the
  history or repair budget. The disposable database's replacement target is
  recorded explicitly in the repaired snapshot.
- Independent review rejected that replacement target because its fingerprint
  differed from the reviewed query's target. The rejection remains in history.
  A second repair restored the original endpoints and recorded schema/key names,
  then passed authentic fresh-schema reuse, six source-grounded runtime checks,
  new-identity verification and cleanup before registration. The same consumer
  retained its original failed invocation and completed two distinct scoped green
  runs after independent approval of repair round 2. Both Allure captures retained
  the business steps and nested `Query details` attachment. Source/query-library
  bytes and prior history remained intact; zero orders and no owned fixture
  infrastructure remained afterward.
- The initial in-place package run reported two synthetic credential literals,
  unrelated locally installed plugin files, and one native-report expectation
  receiving BLOCKED while edits were ongoing. The literals became explicit test
  placeholders. The isolated native-report check passed on the stable runtime.
  The final clean checklist establishes the delivered source result; no scanner,
  publication rule, test expectation or baseline was weakened.

Private native evidence and audit logs remain outside the repository. No release,
publication, merge, additional engine proof or authenticated-host parity is implied.
