> Historical record. Read the [current documentation](../../contributing.md) for present behavior. Statements and validation results below describe their original implementation period.

# M17 validation

M17 implementation and technical validation pass: installed Windows/Linux checks,
native host proofs, full lifecycle parity, hosted CI and independent implementation
review. On 2026-10-01, the owner confirmed the historical credential was revoked or
rotated. Public release remains a separate decision requiring current-content review
and explicit authorization.
The [M17 guide](M17-CI.md) defines the gates and reproducible command interfaces.

## Frozen implementation

Baseline: accepted M16 at `bac87bf2cd24d8e38307ff3f675eb474f98e7d4d`.
The implementation checkpoint is `fbf683625f5ba6a1f9fe8aaa30ae83fe40841cca`.
Its protected freeze has 43 path records, including 37 non-Markdown records and
the lockfile rename. The implementation fingerprint is
`0c02e9bf19d113f5d625fbfae504ba9ab62c0b47cfb5b12e071f4a058c3f6f65`.
Documentation is reviewed separately and excluded from that fingerprint.

The change adds actual archive installation, dependency-identity and immutability
checks, a fixed nonzero checklist, Windows/Linux CI and actual timeout evaluations.
The existing native proofs accept an immutable installed package with separate
consumer roots. Narrow fixes cover Windows physical paths, installed JavaScript
type inference, private compiler diagnostics and owned Docker Desktop forwarding.
Native resource recovery uses protected identity receipts and bounded cancellation.

No browser command language, execution-policy redesign, generic workflow engine,
SQL compiler, mandatory catalog conversion or universal restoration is introduced.
Package metadata is 3.0.17. Runtime dependency versions remain unchanged; the
existing root lock is distributed as `npm-shrinkwrap.json`.

## Installed checks

`node scripts/ci/installed.mjs <new-external-workspace>` passed locally on Windows
with Node 24.15.0 and Linux with Node 24.21.0. The paired 729-test checkpoint used
the same 321-file archive, SHA-256
`3f6d355f0944e21ee67e5c033fd8bdb81d94e891c8f9c30845cae8dab0251d17`.
Each resolved 87 cleared runtime dependency identities across 135 installed nodes.
The complete installed trees remained unchanged: 30,170 Windows entries and
30,112 Linux entries, including platform-specific dependencies and shims.
The corrected implementation subsequently passed all 14 gates and **731 tests**
on both hosted platforms with Node 24.21.0, plus a fresh local Linux installation.
Hosted archive SHA-256 values are:

- Linux: `2862f0721952d676fb339e7be01502769101e7a0a1b13d2f7eeb8655fdb0cfa8`.
- Windows: `e9e022c31bf330dcabf714859d2634141c249a5f4a83bbac006329b993cb0db2`.

Both contain 321 files, the same 87 cleared dependency identities / 135 installed
nodes, and unchanged installed trees. These are separately built archives; byte
equality across platforms or later report edits is not claimed. Private receipts
retain each installation's own archive, logs and integrity checks.

All 14 checklist entries passed on both platforms:

| Actual check run inside each installation | Outcome and substantive scope |
| --- | --- |
| `node scripts/validate-package.mjs syntax` | PASS: 150 JavaScript files |
| `node scripts/validate-package.mjs json` | PASS: 23 files, 22 parsed records; not schema validation |
| `node scripts/validate-package.mjs links` | PASS: 108 Markdown files, 426 local links; anchors and remote links unperformed |
| `node scripts/validate-package.mjs privacy` | PASS: 321 installed candidate files, no findings |
| `node scripts/validate-package.mjs secrets` | PASS: 321 installed candidate files, no findings |
| `node scripts/validate-package.mjs provenance` | PASS: 321 files, 370 resolved dependency records |
| `node scripts/validate-package.mjs publication` | PASS: 321 candidate files, 320 files in the installed repack; no dependency tree included |
| `node scripts/ci/contracts.mjs` | PASS: 3 package contracts, 3 profiles, 2 sources, 26 scenarios and 26 expectations through the actual validators |
| `node scripts/check-conventions.mjs --root examples --fail-on-warn` | PASS: 16 files, 61 rule applications |
| `node scripts/check-conventions.mjs --root harness-tests/fixtures/generation-consumer --fail-on-warn` | PASS: 7 files, 40 rule applications |
| `node scripts/check-conventions.mjs --root harness-tests/fixtures/workflow-consumer --fail-on-warn` | PASS: 2 files, 2 rule applications |
| `node scripts/ci/types.mjs <external-type-consumer>` | PASS: examples, two immutable workflow helpers, valid strict external consumer, and rejection of an invalid argument with TS2345 |
| `node scripts/fetch-ado-suite.mjs --self-test` | PASS: 15 checks |
| `node --test <all 28 discovered harness test files>` | PASS: final 731 tests per platform, zero failures, skips, cancellations or todo |

All three convention scopes have zero new warnings, failures or legacy findings.
The changed-only scope has no recognized POM files and is not substituted for these
nonzero scopes. Strict TypeScript checks do not claim complete static typing of
the JavaScript runtime. The standalone default `node scripts/ci/checks.mjs` also
passed all 14 gates and 729 tests with its new external audit directory.

Source privacy, secrets and provenance checks cover 323 publication-candidate
files. The 370 dependency notices comprise 87 runtime, 280 example and 3 CLI
records. Original material is owner-cleared for MIT; dependencies retain their
own licenses and notices. `git diff --check` passed before the checkpoint commit.

## Native platforms and hosts

The actual installed proofs use pinned Playwright CLI 0.1.22, SQL Server
16.0.4295.3 and PostgreSQL 16.14. The database fixtures use digest-pinned images,
least-privilege scenario credentials and owned synthetic data.

| Actual command / gate | Windows | Linux |
| --- | --- | --- |
| `node scripts/ci/native.mjs <installed-workspace> browser` | PASS: 26 native checks | PASS: 26 native checks |
| `node scripts/ci/native.mjs <installed-workspace> parallel` | PASS: 13 sequential and 13 parallel cases | PASS: 13 sequential and 13 parallel cases |
| `node <installed-package>/scripts/ci/timeout-proof.mjs <new-workspace> mixed` | PASS: 3 actual fault cases | PASS: 3 actual fault cases |
| Installed `scripts/probes/hosts.mjs` prepare/run/assess | PASS: both native hosts and all 19 semantic cases | PASS: both native hosts and all 19 semantic cases |
| Installed `scripts/probes/workflow.mjs` prepare/run/assess | PASS: both hosts, 16 scenarios, all four stages | PASS: both hosts, 16 scenarios, all four stages |
| Hosted GitHub Actions | PASS: installed, browser and browser timeout proof | PASS: installed, browser, API/two-database/parallel and mixed timeout proof |

The parallel proof on each platform has 44 attempts, 35 required assertions and
166 evidence records in each batch. The 13 results retain 10 PASS, one controlled
FAIL and two controlled NEEDS_REVIEW outcomes; all 13 semantic pairs match.
Real API operations, both database drivers, browser/session isolation, required
cleanup/restoration and intentionally persistent outcomes are included.

The native host proofs use Claude Code 2.1.285 and Codex CLI 0.159.2. Both hosts
demonstrate actual hook allow/deny/edit/execute behavior, resource cleanup and
immutable package content. The 19-case comparison preserves scenario semantics,
assertions, outputs, failure classifications, effects and lifecycle decisions.
Expected identifiers, timing and ephemeral loopback ports are normalized; arbitrary
remote targets and ports remain meaningful. Host permission mechanisms are not
claimed to be identical.

The successful full workflows produce two independent green verification processes
per host/platform combination: eight processes and 128 test executions in total.
Each process selects all 16 source scenarios and records 15 generated runtime
operations. All eight Allure 3 reports pass native and rendered association/integrity
checks, including 30 JSON/HTML harness attachments per report (240 total), nested
under the appropriate technical step. Exploration preserves 29 assessed execution
records and their JSON/Markdown/HTML reports per workflow.

Each original-platform assessment revalidates artifact bytes, source bindings,
assertions, verdicts, native authorship, reviews and required cleanup before
comparison. All four stages match both within and across platforms: notes,
exploration, verification and readiness. The cross-platform comparison uses the
existing semantic output without additional normalization.

Windows full-workflow evidence uses the earlier strict-consumer installed archive;
the fresh Linux workflow uses the corrected archive. Later changes affect CI,
owned Linux fixture transport, the Chrome prerequisite and command-evidence
recognition; production execution, generation and reporting semantics are unchanged.
The final hosted checks cover the corrected implementation on both platforms.

The three timeout cases cover cooperative cancellation, forced process termination
and loss of a browser-open bookkeeping receipt. Every interrupted operation remains
a failed deadline result. Exact owned resources are removed; an unrelated browser
and two unrelated database containers survive, then their owner removes them.
The final runs recovered one browser and two databases in each forced case.

An earlier Linux lost-receipt attempt correctly remained INCOMPLETE when the
browser was already gone and ownership evidence was insufficient. Protected storage
was retained. The fixture owner subsequently used its separate authentic process
receipt for teardown. The earlier uncertainty and later cleanup are both retained;
neither recovery nor reconciliation upgrades the interrupted operation to PASS.

## Independent review and retained attempts

The independent implementation reviewer approved the frozen checkpoint with no
open code findings. Final evidence was independently revalidated against all 37
implementation records, immutable installed trees, frozen generated candidates,
native tool receipts, report bytes and cleanup receipts. Findings resolved before
acceptance:

1. A synchronous timeout could stop resource owners before cleanup. The bounded
   supervisor, atomic identity receipts and real fault tests now cover that path.
2. The default CI audit directory conflicted with external-consumer isolation.
   It now defaults outside the package and rejects an in-package path before writes.
3. Docker Desktop gateway ports produced meaningful remote-port parity differences.
   Fixture-owned loopback forwarders now represent those local ephemeral resources;
   the semantic comparator was not weakened.

Installed validation also exposed omitted root lockfiles, legitimate dependency
relocation, npm ignore-file conversion, a platform-specific hook test skip and
installed-module inference errors. These failed attempts were preserved and fixed
through packaging, real platform shell coverage and strict consumer settings.
Windows short-path allowlists and missing private compiler diagnostics were fixed.
The Linux native CLI binary placement and unavailable sandbox namespace were
recorded; the latter used ordinary approval escalation only for commands that had
not started. No denied operation or transmitted mutation was replayed.

During Windows generated-code review, 23 derived package/dependency/skill junctions
per consumer were unexpectedly absent. No deleting command was found in the author,
controller or reviewer histories; the cause remains unresolved. Frozen authored
files, scaffolds and the installed tree were intact. Only exact setup-defined links
were restored, with an exclusive private recovery receipt and unchanged before/after
fingerprints. Independent type and convention checks then passed. No scenario
verification had started, and no mutation or assertion was retried to obtain green.

Both generated Windows candidates are independently approved and completed two
scoped green processes, Allure generation and cleanup. Independent Claude review
found missing distinguishing inputs in business step titles; the native author
repaired six title expressions, which passed re-review with no remaining findings.
All four Windows semantic stages match: notes, exploration, verification and
readiness. Scope is 16 scenarios, 29 exploration cases and 15 generated runtime
operations per verification.

The first Linux complete verification exposed a missing prerequisite: the immutable
fixture requests the `chrome` channel, while the client had installed only bundled
Chromium. All 16 tests failed during browser launch, before source assertions or
generated runtime operations. The Docker recipe now installs that channel and
checks its actual binary. Google Chrome 154.0.8037.92 was observed and separately
launched/closed successfully. This is an observed stable-channel release, not a
pinned Chrome version.

Linux Claude's first repair produced a real candidate and paired receipt but the
evidence checker rejected its exact unquoted consumer-directory prefix. The narrow
recognizer now accepts that literal POSIX spelling while still rejecting expansion,
foreign directories, additional operations and failed receipts. All 22 focused
evidence tests pass, including two new cases. Independent implementation review
approved both fixes. A new Linux archive passes all 14 gates and 731 tests. Both
fresh native consumers then received independent approval, completed two green
processes, generated Allure reports and removed their owned fixtures. Their final
evidence assessment passes all four semantic stages. Earlier failed consumers and
cleanup receipts remain intact; their failed outcomes were not relabeled.

## Publication and recovery boundary

The checkpoint is pushed to the user-authorized existing `main` branch. The final
[implementation validation run](https://github.com/MahmoudElSharkawy/Playwright-Harness/actions/runs/36912928995)
passed both jobs at `fbf683625f5ba6a1f9fe8aaa30ae83fe40841cca`, with seven passing
sanitized summaries. The earlier
[729-test checkpoint](https://github.com/MahmoudElSharkawy/Playwright-Harness/actions/runs/36910530791)
also passed both jobs. Workflows use read-only repository permissions and pinned
actions. The Windows hosted database step is intentionally inapplicable; local
Windows real-instance evidence supplies that required milestone gate.
GitHub emitted a non-failing Node 20 deprecation annotation for the pinned upload
action, which the runner executed under Node 24; artifact upload succeeded.
Native host transcripts, authentication, raw runtime artifacts and local paths are
excluded from public source and uploaded summaries.

The one-time Linux host proof uses the explicitly authorized local validation
container with native authentication mounted read-only. Its Docker socket is broad
at the OS level; proof code restricts operations to its owned fixtures. Both local
validation clients have now been removed by their exact recorded container IDs.
Read-only authentication mounts were confirmed before removing the authenticated
client; account files were neither copied into the image nor archived.

Private evidence was retained before removal in an owner-only local directory.
The authenticated proof archive contains 5,629 files from 17 validation workspaces,
including earlier failed attempts and successful reviews, receipts and reports.
Its 27,698,655 bytes and SHA-256 were verified after copying; the private manifest
is also hash-verified. Authentication mounts, protected runtime material,
installation trees and symlinks are excluded. The earlier credential-free client
has a separately verified 37,863-byte evidence archive. No secret-bearing image
snapshot was made. No labelled synthetic database containers remain.

Final source checks pass: 108 Markdown files / 426 local links, 323 files in each
privacy/secret/provenance inspection, 370 dependency records, and 321 packed files
from 323 publication candidates. Remote links and heading anchors were not tested.
The Windows junction interruption remains an unresolved environment incident with
exact restoration evidence; it did not alter source or replay a scenario.

The owner confirmed historical credential revocation or rotation on 2026-10-01.
This owner attestation resolves the previously open credential-remediation gate;
the credential was not reproduced or tested. Earlier milestone reports record the
status known at their respective times. Current release-content review and explicit
authorization are still required for publication.
No npm publication, release tag, GitHub release or live ADO write occurred.

## Final-review corrections — 2026-10-02

The approved correction scope addresses F1–F3 from the final independent review.
F1–F3 are resolved. All required correction validations pass, and the independent
canonical `framework-review` verdict is **APPROVE** with no remaining findings.
This closes the M6, M12 and M13/M14 gaps identified in the final review.
The earlier milestone reports above retain their original scope and results.
The executable candidate freezes 13 files against baseline
`4f5f5412924051b4817c868a73791c46bd617188`; documentation is recorded separately.
Public interfaces, result schemas, dependencies and normal tester autonomy remain
unchanged. Work continues on the existing `main` branch.

### Changes

- F1: physical owned-browser cleanup now runs in an unconditional `finally` after
  session acquisition, sharing the original cleanup deadline. One internal helper
  records missing invocations in frozen phase order, groups their unevaluated
  assertions and flushes missed earlier phases before advancement. Started
  operations with incomplete recording never become fabricated `not-executed`
  attempts. Reliable assertion failures remain `FAIL`; unusable evidence surfaces
  an integrity error after physical cleanup. Business-resource retention policy
  is unchanged.
- F2: a shared narrow classifier accepts absent, blank, empty-array and genuinely
  empty `parameters`/`NewDataSet` metadata through case retrieval, shared steps,
  neutral conversion and legacy rendering. Definitions, populated data, malformed
  XML and unrecognized nonempty content still require refinement. Raw metadata
  remains available. No XML parser or dependency was added.
- F3: the API/database reference-fixture observation titles now include their
  supplied description; validation titles include the expected assessed status.
  Assertions, signatures, technical steps and attachment behavior remain intact.

### Correction validation

The following commands ran against the frozen executable candidate. Workspace
arguments refer to fresh, protected, external consumer directories.

| Command / substantive scope | Windows | Linux |
| --- | --- | --- |
| `node scripts/ci/checks.mjs <workspace>` | PASS: 14 checks, 755 tests across 28 test files | Not separately repeated; the installed checklist below runs the same checks |
| `node scripts/ci/installed.mjs <workspace>` | PASS: 14 checks, 755 tests; installed tree unchanged | PASS: 14 checks, 755 tests; installed tree unchanged |
| `node scripts/ci/native.mjs <installed-workspace> browser` | PASS: 38 exact native checks; installed tree unchanged | PASS: 38 exact native checks; installed tree unchanged |
| `node --test <package>/harness-tests/mixed-browser.integration.mjs` | PASS: 8 native controls | PASS: 8 native controls |
| `node --test harness-tests/ado-integrations.test.mjs` | PASS: 93 focused contract tests | Included in the 755-test installed checklist |
| `node --test harness-tests/browser-policy.test.mjs` | PASS: 12 policy/scope tests | Included in the 755-test installed checklist |
| `node scripts/probes/generation.mjs --reports` | READY: independent generated-code approval and two distinct 10-case scoped green runs; both Allure reports generated | Not repeated for this bounded correction |

Every passing suite in the table has zero failures, skips, cancellations and todo.
The 38-check browser gate includes 12 added real-session regressions and rejects
missing, duplicate or unknown check names. Regressions cover all five frozen phases,
multiple assertions per invocation, legacy unphased expectations, native-open
failure, earlier-phase advancement, interrupted bodies, placeholder-write failure,
started-attempt validation failure and preserved reliable failure. Process shutdown
and protected storage removal are checked independently of the result/error.
Existing ownership, mixed cleanup and exhausted shared-deadline controls remain.

The package checklist covers 153 JavaScript files, 23 JSON files / 22 parsed
records, 108 Markdown files / 426 local links and 25 convention files / 103 rule
applications. Source privacy, secret and provenance checks cover 326 publication
candidates and 370 dependency records. The validated archive contains 324 files,
87 dependency identities and 135 installed dependency nodes. JSON parsing is not
schema validation; remote links and heading anchors were not checked.

Fresh installations use Node 24.15.0 on Windows and 24.21.0 on Linux. Archive
SHA-256 values are
`c67b29e9a53b63530cc7cd0704578cd6ec7a19d0509422c85515e5d02a4361f8`
and `6d036ee000589f745f588f07b64b9a11608dc33de935a28dddc5fa73f1e5cc2f`,
respectively. Each archive retains its own installation and immutability receipts;
byte equality across separately packed archives is not claimed.

The ADO tests use synthetic transport and metadata controls; they do not claim
live ADO integration. Native browser and generation proofs use real browser
processes. Generation also executes real loopback API, SQL Server and PostgreSQL
fixtures, then removes its owned fixtures. Independent inspection of actual
Allure data verifies 18 corrected action titles, 18 validation titles, technical
and assertion nesting, 36 case-associated JSON/HTML attachments, 18 distinct
runtime identities and both generated report hashes across the two green runs.

### Review, retained attempts and delivery boundary

The independent canonical `framework-review` approves the correction: 10 applicable
checklist boxes pass, zero fail and nine are not applicable to this bounded scope.
It verified the executable
freeze, nonzero convention/type scope, the original regressions and actual report
data. An additional malformed-XML whitespace finding was fixed by recognizing
XML whitespace narrowly; all 14 negative metadata controls pass on re-review.

The initial Windows source browser proof retained a 37/38 result because its new
failure-injection fixture incorrectly required an observation file after evidence
recording aborted. The fixture now verifies the surfaced integrity error, absence
of a successful result and independent physical cleanup. The subsequent installed
Windows and Linux proofs pass all 38 checks; the earlier attempt remains retained.

Authenticated Claude/Codex and complete workflow parity proofs were not repeated
for this bounded correction. Their prior M17 evidence remains historical; no host
adapter changed. The credential-free Linux correction client mounts no account
authentication or Docker socket and was removed after validation. Public release
remains outside this scope, with no npm publication, release tag, GitHub release
or live ADO write.
