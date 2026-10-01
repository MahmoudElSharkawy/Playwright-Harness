# M16 validation

M16 is accepted on 2026-10-01 within the Windows/source-package scope below.
Implementation, validation and independent review passed with no open findings.
M15 was accepted before M16 began. See [the contract](M16-PARALLEL.md).

## Frozen scope and checks

Baseline: `5d439a42427d39a5bbecf671b075f437c9acbd38` (accepted M15).
The implementation freeze covers 17 changed/new files, including 12 implementation/
test/metadata files. Its implementation fingerprint is
`f0da512f1ccbec2955c7dce2a4577e2bb59ab42b39879940689f9bc879be5b48`.
The protected local manifest records individual hashes and the tracked diff. Public
documentation is excluded from that fingerprint and receives a final evidence review.

The change adds a bounded dispatcher, shared sequential preflight, focused tests and
a fixed native probe. Existing executor mechanics, core verdict contracts, generated
POM code and Allure settings remain intact. Package metadata is 3.0.16; no dependency
or convention-baseline expansion is introduced.

| Actual command | Outcome and substantive scope |
| --- | --- |
| `npm test` | PASS: 713 tests, zero failures, skips or cancellations |
| `node --test harness-tests/parallel-runtime.test.mjs` | PASS: 31 tests, included in the full suite |
| `node --test harness-tests/parallel-runtime.test.mjs harness-tests/sequential-runtime.test.mjs` | PASS: initial 28 parallel plus 13 existing sequential tests; 3 additional parallel cases passed later and in the full suite |
| `npm run check:syntax` | PASS: 136 JavaScript files |
| `npm run check:json` | PASS: 23 files, 22 parsed records; not schema validation |
| `npm run check:links` | PASS: 106 Markdown files, 422 local links; anchors and remote links unperformed |
| `npm run check:privacy` | PASS: 305 publication-candidate files |
| `npm run check:secrets` | PASS: 305 publication-candidate files |
| `npm run check:provenance` | PASS: 305 files and 370 resolved dependency records |
| `npm run check:publication` | PASS: 305 candidate files, 302 packed files |
| `node scripts/check-conventions.mjs --root examples --fail-on-warn` | PASS: 16 files, 61 rule applications |
| `node scripts/check-conventions.mjs --root harness-tests/fixtures/generation-consumer --fail-on-warn` | PASS: 7 files, 40 rule applications |
| `node scripts/check-conventions.mjs --root harness-tests/fixtures/workflow-consumer --fail-on-warn` | PASS: 2 files, 2 rule applications |
| `npm run typecheck:examples` | PASS |
| `npm run test:fetch` | PASS: 15 existing self-checks |
| `node scripts/probes/parallel.mjs <new-external-consumer-directory>` | PASS: actual native scope below |

The changed-only convention scope contains no recognized POM-layer files and is
not a passing check. The reviewer uses the nonzero example scopes above plus a
consistency/correctness review of every changed script. Zero scope is not counted
as coverage.

Focused tests exercise default sequencing, a peak of two active requests within a
five-job batch, result/output/report association despite reverse completion, complete
preflight conflict rejection, runtime exploration access checks, queued input capture,
cancellation of two real API mutations with both required cleanups, unstarted queued
cases, finite deadlines, incomplete-result retention, per-consumer locks and isolation,
and cross-scenario binding rejection. These are real loopback HTTP checks; browser and
database integration evidence is reported separately below.

## Native evidence

The Windows native proof passed on 2026-10-01 with Node 24.15.0, the existing pinned
Playwright CLI 0.1.22 and its resolved Playwright 1.64.0-alpha-1790635538000 graph.
SQL Server was 16.0.4295.3; PostgreSQL was 16.14. Both used the existing digest-pinned
disposable images and least-privilege runtime credentials.

The proof ran 13 scenarios at concurrency 1 and the same 13 at concurrency 2.
Each batch had 44 attempts, 35 required assertions and 166 registered evidence
artifacts: 10 PASS, 1 intentional assertion FAIL and 2 intentional NEEDS_REVIEW
outcomes for restoration conflict and required cleanup failure. All 13 semantic
comparisons passed after revalidating each run's artifact integrity. Each batch
produced 13 JSON/Markdown/HTML report sets.

Two owned browser sessions overlapped with different local-storage values. After
one session closed and its result was written, the other successfully read its
original value and captured evidence. Four sessions in total closed with required
owned cleanup complete and protected browser material removed.

API cases covered temporary fixtures, intentional persistence, no obligation,
guarded restoration, a concurrent restoration conflict, cleanup failure and assertion
failure. Both databases executed bound INSERT/UPDATE/SELECT with temporary DELETE
cleanup and intentional persistence. Independent native queries confirmed temporary
rows were absent and retained rows still contained the expected value before the
owned containers were removed. Shared-write admission failed before dispatch.

The loopback servers and owned database containers were removed. The publication
candidate remained unchanged during native execution. The native proof is Windows
against the current source package, not a clean-install/platform matrix or a new
native Claude/Codex authoring proof. M15's host lifecycle proof remains the prerequisite;
M17's broader matrix is unperformed here.

Two initial probe preparation attempts did not execute any scenario. One package
audit mistakenly traversed protected historical validation material; it now uses
publication inventory. The other found a missing length bound in a PostgreSQL fixture
parameter; it was corrected, and its disposable infrastructure cleanup completed.
These attempts are not counted as native scenario coverage.

## Review and remaining scope

The fresh independent reviewer approved all 17 changed/new files with no actionable
findings. It independently reran all 31 focused tests and the three nonzero convention
scopes, reviewed the 713-test full-suite evidence, revalidated native artifacts and
all 13 sequential/parallel comparisons, and checked actual browser overlap and
verification after the other session's shutdown. The implementation fingerprint
remained unchanged. The local review and class ledger record zero new classes.

The successful native evidence was retained under restricted local access, with all
522 copied files checked against their originals. Protected browser material was
already removed before retention; no credential values were copied into source or
Git history. Prior failed preparation attempts remain separate from accepted evidence.

No M17 work, release tag or package publication is authorized by this milestone.
Historical credential revocation/rotation remains owner-dependent and unresolved;
the removed credential is neither present in this change nor tested for validity.
