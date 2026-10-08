> Historical record. Read the [current documentation](../../contributing.md) for present behavior. Statements and validation results below describe their original implementation period.

# M14 validation

Status: **M14 accepted for reporting and Allure integration in the validated Windows scope.**

M14 covers validated JSON, Markdown and static HTML execution reports and optional
native Allure integration for generated Playwright tests. See the
[reporting guide](M14-REPORTING.md) for interfaces, authority and artifact locations.

The initial independent review approved the frozen implementation and exact repaired
consumer with no open findings. Both subsequent scoped native processes passed all
ten generated cases. Both Allure captures and HTML generations passed, and artifact
integrity and owned cleanup passed. Final independent evidence review also approved
M14 with no open findings. M15 remains outside this implementation.

## Package validation

Windows, Node 24.15.0, harness 3.0.14. All 22 package checks passed. These commands
were invoked through `node <node-install>/node_modules/npm/bin/npm-cli.js run <script>`
(or `test` for the full suite). Focused counts are subsets of the full suite. Logs,
patches, consumer paths and synthetic runtime artifacts remain in ignored development
storage; no private runtime files are included in the publication candidate.

| Command | Outcome and actual scope |
|---|---|
| `check:syntax` | PASS: 122 JavaScript files |
| `check:json` | PASS: 21 files, 20 records; parsing, not schema validation |
| `check:links` | PASS: 101 Markdown files, 401 local links; anchors and remote links unperformed |
| `check:conventions` | PASS: 15 example files, 60 rule applications, zero warnings/failures |
| `test:core` | PASS: 82 tests |
| `test:browser` | PASS: 11 tests |
| `test:api` | PASS: 61 tests |
| `test:database` | PASS: 57 tests |
| `test:sequential` | PASS: 13 tests |
| `test:postgresql` | PASS: 39 tests |
| `test:hosts` | PASS: 43 tests |
| `test:integrations` | PASS: 70 tests |
| `test:generation` | PASS: 59 tests, including 14 actual native-runner controls |
| `test:reporting` | PASS: 34 tests |
| `check:generation-conventions` | PASS: 7 files, 40 rule applications, zero warnings/failures |
| `test` | PASS: 630 tests; zero failed, skipped or cancelled |
| `test:fetch` | PASS: 15 retained parser/renderer checks |
| `typecheck:examples` | PASS: configured TypeScript example project |
| `check:privacy` | PASS: 282 candidate files |
| `check:secrets` | PASS: 282 candidate files |
| `check:provenance` | PASS: 282 files, 240 dependency records; no new root dependency |
| `check:publication` | PASS: 282 candidate / 279 packed files |

The root changed-file POM check has zero applicable framework scope and fails closed;
it is not counted as a pass. The actual separate consumer independently passed its
7-file/40-rule convention check and TypeScript check. Three narrowly updated canonical
skills passed the skill creator's `quick_validate.py`, using the existing development
YAML dependency. That validates skill metadata, not native host workflow behavior.
No convention baseline was expanded or rule weakened.

The reporting tests cover all five core statuses; recovered attempts; reconciliation;
affected rows/resources; SETUP, EXERCISE, VERIFY, CLEANUP and RESTORE; guarded restoration;
failed cleanup preserving reliable FAIL; intentional persistence and no-obligation
writes; selected-output redaction and clipping; unsafe text escaping; immutable
validated-result inputs; report ownership/overwrite refusal; manifest hashes; native
attachment failure; CLI evidence reassessment; and invalid Allure capture inventories.

Four actual native Allure controls cover two isolated scoped captures with nested
attachments, missing Allure while native tests pass/fail, and a caught assertion
that native Playwright reports passed while the harness verifier correctly records
FAIL. The optional HTML branch of that failure control was also run with
`HARNESS_ALLURE_HTML_PROOF=1` and
`node --test --test-name-pattern 'Allure capture preserves' harness-tests/generation-native.test.mjs`:
**1/1 PASS**, using actual Java/Allure generation. Its landing page preserved FAIL,
regeneration into existing output was refused, and readiness remained zero greens.
These arithmetic/runner controls are distinct from the live POM proof.

## Frozen diff and independent review

Base: `f36c240e880de36c4b5e11a6f7521300d0705692`, on the user's existing main branch.
The first freeze contains 31 files, +778/-24, patch SHA256
`6d41daa0ffec637756ad1bac03f3d1f576736373147f4a74d13aa997b777f8aa`.
Native visual checks found horizontal document overflow at 390 pixels caused by
long fingerprint text. A one-line wrapping correction fixed it. The repaired freeze
contains 31 files, +779/-24, SHA256
`5f0ac8ce1edf057164e63d97de036635408cc889002d0cb8aa152a59c7f9a9e4`.

A fresh independent reviewer verified that patch and all 282 source hashes, reviewed
the changed architecture/utility/reporting layers, and approved the exact repaired
consumer before generated execution. Design checklist: 14 applicable boxes PASS,
five N/A, zero FAIL. No confirmed open finding or accepted exception remains.

The reviewer independently repeated the nonzero convention scopes, all 34 reporting
tests and four native Allure controls. It rebuilt the original handoff from 50 artifact
records, 19 reliably evaluated core assertions and ten source bindings, and checked
the exact 15-file consumer snapshot. The original candidate and observations remain
in history. The renderer repair consumed round 1; it did not restart generation or
reset the budget. No generated run occurred before that independent approval.

The full 630-test suite passed before the one-line CSS repair. The relevant reporting
and native Allure controls passed again afterward, together with desktop/mobile visual
checks and the complete live proof below. Subsequent publication-document changes
do not alter runtime behavior. Final independent evidence review approved the live
receipts, original handoff, generated reports, readiness, visual evidence and cleanup.
The five documentation/publication checks passed again: links, privacy, secrets,
provenance and publication content, with the counts above unchanged.

## Separate consumer and actual live reports

The read-only synthetic source contains ten scenarios: one UI heading, three API
reads, three SQL Server queries and three PostgreSQL queries. Each data family
uses catalog, deterministic helper and fixed inline definitions. Expectations remain
exact heading text; HTTP status 200 plus observation value 42; or one database row
with the driver-bound value 42. Business assertions and source semantics are unchanged.

`node scripts/probes/generation.mjs --reports` (package `probe:reporting`) performed
actual official CLI/browser, local HTTP and owned database exploration, paused for
independent approval, then ran the generated native POM tests twice. Allure generation
ran only after each native process and reporter flush.

| Live validation | Outcome |
|---|---|
| Original exploration | PASS: 10 runs, 19 reliably evaluated assertions, 50 verified evidence records |
| Execution reporting | PASS: 10 bundles, each with JSON/Markdown/HTML and intact final manifest |
| Native verification run 1 | PASS: 10 tests, 10 source markers, 10 executed native assertions, no retries/skips |
| Native verification run 2 | PASS: same 10 cases/markers/assertions in another process, same reviewed candidate |
| Shared runtime across both runs | PASS: 18 API/DB operations, 36 runtime assertions, 90 verified artifacts |
| Native Allure capture | PASS: 2 isolated captures, 20 test results, 58 captured files with verified hashes |
| Harness attachments | PASS: 36 stable JSON/HTML attachments nested under their technical operations |
| Allure HTML generation | PASS: 2 official single-file native reports and 2 verification landing pages; generated hashes verified |
| Readiness | READY: 2 distinct green invocations, 2 retained candidates, 1 independent approval, repair round 1 |
| Owned cleanup | PASS: 3 temporary endpoints closed, no owned fixture database containers remain |

Each attached JSON view was compared with its owning persisted runtime result for
status, stability, counts and assertion scope. All original and generated artifact
hashes were rechecked after execution. The exact candidate, independent review and
both verification receipts still satisfy readiness after cleanup. Intentional
persistence and failure/recovery reporting are covered by the explicit contract
cases above; these ten live cases do not pretend to perform mutations.

Using the official CLI in owned browser sessions, visual checks passed for recovered
PASS, assertion FAIL with incomplete cleanup and intentional retention at 1360×920
and 390×844. Six screenshots were inspected, and every page passed the document-width
check. The actual Allure dashboard showed ten cases and a visible native-result source;
its verification landing page displayed the recorded PASS and explained the independent
two-green gate. An individual rendered testcase also showed the original business
step, nested technical operation and both stable harness attachments in that order.
Browser sessions and local report servers cleaned up successfully.

Exact linked proof versions: Playwright Test/Playwright 1.63.0, playwright-core
1.64.0-alpha-1790635538000, Allure reporter/commons 3.13.0, Allure commandline 2.46.1,
Java 25.0.3, TypeScript 7.0.2 and Node types 24.19.0. SQL Server reported 16.0.4295.3;
PostgreSQL reported 16.14 (Debian 16.14-1.pgdg13+1). The consumer declares actual linked
versions and a relative local harness dependency. This is a linked development proof,
not an npm clean-install or arbitrary-version compatibility claim. TypeScript checks
consumer code with `allowJs`/`checkJs: false`; runtime library validation remains dynamic.

## Failed attempts and remaining boundaries

Early contract fixtures were corrected when the core rejected incoherent effect or
evidence identities; no production rule was weakened. The first Allure HTML attempt
could not read the installed Java security configuration inside the sandbox; the
authorized run with access passed. The first private visual helper double-decoded
a native JSON value; fixing that helper exposed the real mobile overflow, which was
then corrected and validated. The independent native control also correctly rejected
a run whose shared runtime changed during that CSS edit; repeating the isolated
control after the freeze stabilized passed. An optional Allure testcase-navigation
check initially timed out because its feature group was collapsed; following the
observed group expansion completed the detail/attachment check. These were development checks, not
retries of a failed live generated candidate. Failed receipts remain available.

Linux M14 execution, packed clean-install proof, full Claude/Codex end-to-end workflow
parity, broader Java/Allure version compatibility and bounded parallel execution are
**UNPERFORMED here**. M15–M17 retain their respective gates. The report bundle contains
evidence inventory rather than raw evidence files, and native consumer Allure artifacts
still require review before sharing. No ADO mutation or public package release occurred.

The user's existing Git history/push authorization remains separate from release
authorization. Historical credential revocation/rotation remains owner-unconfirmed;
no historical credential was inspected, tested or reproduced during M14.
