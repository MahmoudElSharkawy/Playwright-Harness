# M13 validation

Status: **M13 accepted for generation, independent review and sequential verification.**
All 21 package checks pass. Independent re-review approved the implementation and
the exact repaired consumer, with all three findings resolved. Two fresh native
processes then passed all ten generated cases each; owned cleanup passed. No open
review finding remains. M14 and later milestones are outside this implementation.

The [generation guide](M13-GENERATION.md) describes source handoff, consumer-owned
history, revision-bound independent review, three cumulative repair rounds, actual
assertion coverage and two independent scoped green runs. API/DB services reuse the
existing deterministic runtimes; catalog/helper/inline definitions are peers.
Browser exploration uses the existing official CLI integration, while generated
POM tests use native Playwright Test. No workflow engine or browser DSL was added.

## Package checks

Validated on Windows, Node 24.15.0, harness 3.0.13. Commands below are package-script
names, invoked here through `node <node-install>/node_modules/npm/bin/npm-cli.js run
<script>` (or `test` for the full suite). Private outputs remain outside the
publication candidate. Focused test counts are subsets of the full suite.

| Command | Outcome and actual scope |
|---|---|
| `check:syntax` | PASS: 113 JavaScript files |
| `check:json` | PASS: 21 files, 20 records; parsing, not schema validation |
| `check:links` | PASS: 99 Markdown files, 393 local links after the final documentation update; anchors and remote links unperformed |
| `check:conventions` | PASS: 15 example files, 60 rule applications, zero warnings/failures |
| `test:core` | PASS: 82 tests |
| `test:browser` | PASS: 11 tests |
| `test:api` | PASS: 61 tests |
| `test:database` | PASS: 57 tests |
| `test:sequential` | PASS: 13 tests |
| `test:postgresql` | PASS: 39 tests |
| `test:hosts` | PASS: 43 tests |
| `test:integrations` | PASS: 70 tests |
| `test:generation` | PASS: 55 tests, including 10 real native-runner contract tests |
| `check:generation-conventions` | PASS: 7 generated fixture files, 40 rule applications, zero warnings/failures |
| `test` | PASS: 592 tests, zero failed/skipped/cancelled |
| `test:fetch` | PASS: 15 retained parser/renderer self-checks |
| `typecheck:examples` | PASS: configured TypeScript example project |
| `check:privacy` | PASS: 271 candidate files |
| `check:secrets` | PASS: 271 candidate files |
| `check:provenance` | PASS: 271 files, 240 dependency records; no new root dependency |
| `check:publication` | PASS: 271 candidate / 268 packed files |

The root changed-file POM check has zero applicable framework scope and fails
closed; it is not counted as a pass. The two nonzero scopes above are the meaningful
mechanical checks. The actual separate consumer also passed its 7-file/40-rule
convention check and TypeScript validation. Local scenario metadata is accepted
through `allure.testCaseId`; real external references may still use `allure.tms`.
No baseline was expanded and no unrelated convention was relaxed.

The generation contracts cover reassessment of original evidence, preserved source
text, recovered results, reliable failures, intentional persistence, required
cleanup, complete assertion bindings, immutable snapshots, independent reviewer
identity, open findings, review integrity, three cumulative repairs, preserved
history, exclusive writes, scope/count/identity errors, missing assertions, crashes,
unavailable native installation and redacted CLI failures. Synthetic contract
approvals are explicitly fixtures, not independent review evidence.

The ten native-runner tests cover two fresh green invocations, exact selection,
repair/re-review, actual failure, empty callbacks, runtime skip, expected failure,
prefix ambiguity before dispatch, caught assertion failures, successful polling
and exhausted polling. These small arithmetic/runner fixtures do not substitute
for the live POM proof below.

## Frozen diff and independent review

Base: `9b77a7457ab5afcc8a74e1e7f3823ec012febe9c`, on the user's existing main branch.
The initial review froze 38 files, +1709/-139, patch SHA256
`714f41b4f1a531d4f83f2b3eb671646fe70b25b0bd02bfe813f2ecab20e5352b`.
The reviewer independently reproduced two gate defects and confirmed incomplete
consumer dependency declarations. All three findings were blocking:

| Finding | Correction and verification |
|---|---|
| Native title-prefix selection could dispatch an unselected nested test | Check every selector against the full collected set before execution; native sentinel regression proves no extra test or execution receipt |
| A helper could catch a failed assertion and earn a green | Preserve native assertion terminal failures through helper steps; native tests prove caught failures stay FAIL while ordinary successful polling remains valid |
| Linked consumer dependencies were undeclared | Declare all libraries/tools at actual versions, add a relative local harness dependency and freeze version evidence; independent inspection verifies declarations and link destinations |

The repaired implementation freeze contains 38 files, +1785/-139, SHA256
`01abd0fd732a57462867ae640f158063a6ab2328750d033751c080114620ff06`.
Independent re-review approved this freeze and the exact 15-file consumer snapshot.
It rechecked the original reproductions, source semantics, dependencies, unchanged
POM files, hash-linked history and all original exploration evidence. The original
rejection remains in history. The repaired candidate consumed round 1; it did not
restart the source or reset the repair budget. All three classes are closed in the
private review ledger.

The reviewer assessed the changed layers against the owning skills and architecture:
13 applicable design checklist boxes pass, six are N/A, and none fail. Required
independence is an actual separate reviewer, not a synthetic identity claim. The
final changes after this freeze are README/validation documentation only. Full
review records, reproductions, command receipts and diff inventories remain in
ignored development state; public documentation excludes local paths and identities.

## Separate consumer and live proof

The read-only synthetic source has ten scenarios: one UI heading, three API reads,
three SQL Server queries and three PostgreSQL queries. Each data family exercises
catalog, deterministic helper and fixed inline definitions. Source meaning remains:
exact heading text; HTTP status 200 plus JSON observation value 42; one database row
with the driver-bound observation value 42. No expectation was weakened.

Actual official CLI/browser, local HTTP and owned database exploration produced ten
PASS runs, 19 reliably evaluated assertions and 50 registered evidence records.
The independent reviewer reassessed the original inputs and artifact bytes. Those
observations became the generation handoff for ordinary TypeScript page/service
classes and tests in a separate protected consumer project.

The actual review rejection was recorded before verification, and the gate refused
dispatch. The owned environment cleaned up. The focused proof repair reused the
same consumer history and original evidence, started new owned infrastructure,
registered one repaired candidate, and waited for the real independent approval.
Only then did verification proceed.

| Live validation | Outcome |
|---|---|
| Native scoped run 1 | PASS: 10 tests, 10 source expectation markers, 10 executed native assertions, no retries/skips |
| Native scoped run 2 | PASS: the same 10 tests and expectations in another process, same reviewed candidate, no retries/skips |
| Shared API/DB execution across both runs | PASS: 18 operations, 36 runtime assertions, 90 registered artifacts; all hashes rechecked after execution |
| Readiness and history | READY: two distinct green invocations, round 1, two candidates, original rejection and independent approval retained |
| Required owned cleanup | PASS: temporary HTTP and both DB endpoints closed; no owned fixture containers remain |

Native page fixtures provide fresh contexts and native teardown. API/DB calls use
the existing runtimes and connection cleanup. These read-only cases create no
scenario data-restoration requirement. Readiness rechecks the candidate, review
artifact and both verification receipts; their integrity still passed after cleanup.

Exact linked proof versions: Playwright Test/Playwright 1.63.0, playwright-core
1.64.0-alpha-1790635538000, Allure commons 3.13.0, TypeScript 7.0.2 and Node types
24.19.0. SQL Server reported 16.0.4295.3; PostgreSQL reported
16.14 (Debian 16.14-1.pgdg13+1). A frozen consumer version manifest records the
actual links and portable relative harness dependency. This is evidence of that
linked environment, not an npm clean-install or arbitrary-version compatibility
claim. The TypeScript check covers consumer code with `allowJs` and `checkJs: false`;
it does not claim full static typing of the JavaScript execution libraries.

## Failures, limits and remaining gates

An early proof preparation failed on the Allure metadata API and JavaScript-library
TypeScript configuration; both were corrected before independent review and no
generated tests ran. A repair regression initially detected that polling internals
were being counted as terminal assertion failures; the corrected native-boundary
handling passes both successful and exhausted polling controls. Failed/rejected
receipts are retained alongside the final passing results.

Linux M13 execution, clean packed consumer installation, fully attested installed
dependency contents, rendered Allure reports, complete Claude/Codex native workflow
parity and parallel execution: **UNPERFORMED here**, belonging to later milestones.
The package tests and this live proof do not claim those gates. Arbitrary environment
references and imported dependency meaning remain explicit review/CI obligations.
M13 uses the accepted sequential executors; it does not rerun every prior milestone's
live failure matrix. No live ADO retrieval or mutation occurred.

No package release, tag or external test-system delivery is implied. The user's
existing authorization covers Git history/push on main. Public release authorization
and the owner-dependent historical credential revocation/rotation status are unchanged;
no historical credential was inspected, tested or reproduced for M13.
