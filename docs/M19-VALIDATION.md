# M19 validation

## M19 remediation — current candidate

Updated 2026-10-04. The remediation retains 3.2.0, CLI 0.1.22, the pinned native
core and sequential execution. The records below supersede the historical
implementation review later in this document. They do not authorize merge or release.

- Focused command, settlement, read, recovery, refinement, source and verdict regressions: **81/81 PASS**.
- Additional host receipt/cache/startup regressions passed, including CLI `--await` recovery.
- Full local source suite: **978/980 PASS**, only the two unchanged Windows adoption-junction failures documented below; no skipped tests. All 13 static checks pass after removing a validation-record heading rejected by the existing privacy scanner. The subsequent delivery-stage/index/checkpoint changes pass their focused regressions and are included in the final installed gate.
- Scale fixture: **500 scenarios, 5,000 steps, 5,000 native dispatches, 16,000 artifacts**, actual collection/reassessment/reports; zero host launches and OS process listings. Isolated elapsed time: **261,576 ms**. Concurrent full-suite samples were **306,233 ms** and **333,607 ms**. Node reported PASS despite its configured 300,000 ms timeout because synchronous report work delayed timer delivery; these samples are not a performance guarantee or proof of a strict wall-clock cap.
- Fresh independent implementation review: **APPROVE**, 0 remaining confirmed findings; 27 targeted rechecks passed. It found and verified the H2 repair that preserves the recovered previous run's terminal state when appending an explicit rerun. Platform gates remain separate.
- Expanded native Windows probe: **15/15 PASS** from the intermediate installed archive, including navigation/reload/frame dispatch, rendered text, modal recovery, 100 KiB reads and killed-host recovery. It does not override full installed validation.
- Subsequent local installed suite: **980/983 PASS**, all 13 static checks pass and package content remains unchanged. Besides the two unchanged junction failures, an existing 120 ms test deadline expired during storage setup under concurrent load; the test passes in isolation and now controls its clock to test callback expiration deterministically. This archive predates the final H2 repair and is superseded.
- Reviewed local installed candidate: **982/984 PASS**, all 13 static checks pass, 363 installed files match the archive and package content remains unchanged. Only the two documented local junction failures remain. After packing, three explicit F5 cases and callback-assertion propagation were added without changing runtime code; all **20/20** finalization tests pass, with independent approval. Hosted gates will test those additions in the final branch archive.
- Same-version replacement proof: **PASS**, npm **11.12.1**, two distinct 3.2.0 archives. Replacement verifies 363 installed files; injected failure after candidate setup restores the original archive/manifest/lock/setup journal and `npm ci` content, retaining execution/report hashes. Proof receipt: ignored `reports/maintainer/replacement-proof.json`.
- Final hosted installed archive and Windows/Linux native gates: **PASS** on commit `01c0e080a5b1c5892c44c7e1a197402a1dc01471`, [workflow 37195482652](https://github.com/MahmoudElSharkawy/Playwright-Harness/actions/runs/37195482652). Each platform passed 987/987 tests, 13 static gates, 38 browser checks, 15 execute checks and three timeout proofs; package content was unchanged and owned cleanup completed. Both npm 12 consumer-flow jobs passed. These final receipts supersede the earlier failed local gates.
- Fresh Story 84 agent execution: **completed**, 17 PASS, one observed application FAIL, zero unresolved and zero excluded. Case 126 observed an empty cart after logout, preventing the expected checkout prompt. The verified installed archive replaced the prior 3.2.0 build; all 28 original configuration/library/report files remained unchanged. Temporary-account cleanup completed; declared shared fixtures were retained. Results include checked, observed and mixed methods; the earlier inconclusive case-117 run remains in history. Execution: `execute-15aeccb7-2ddd-43b7-ad2a-d3daaa6a1da2`. ADO remained read-only.
- Changed-UI agent acceptance: **PASS**, two real native-browser runs of the same frozen case on the verified final archive. See the acceptance record below. Real ADO writes/publication require an authorized sandbox with test points and remain pending; neither this fixture nor synthetic ADO transports establish live delivery acceptance.

### Changed-UI agent acceptance, 2026-10-04

Codex drove the live mailbox protocol against a local display-name form, selecting
controls from each fresh snapshot. The helper served the fixture and dispatched
commands; it did not select controls or execute a scripted adaptation loop.
Variant B changed the input/button IDs, nested wrappers, DOM order and button
position. Both variants kept the same origin, `/profile` URL, visible labels,
save behavior and expected `"Saved for Ada"` confirmation.

| Variant | Fresh textbox / Save refs | Reassessed result | Method / cleanup |
|---|---|---|---|
| A, baseline | `e5` / `e6` | PASS | Checked; owned browser cleanup complete |
| B, changed UI | `e10` / `e7` | PASS | Checked; owned browser cleanup complete |

Both runs used execution `execute-569ea506-0260-424b-b327-fcfa0217725d` and
scenario `tc-901-r1`. Source, refinement and freeze file hashes stayed identical;
the freeze fingerprint stayed
`4b5a3f8a032388e0c7f917088e9ca95ec935b20a8c23ff06e75f4d9715ea0f55`.
The candidate archive SHA-256 was
`7d8f28b82d40f6b7c636234741dfb9981afbe1ad7514c246ec27a26136d1f7d7`;
all 363 installed files matched before and after the runs. Each variant received
exactly one save request. Both native sessions removed protected storage and
released the execution lock; both fixture servers and listeners were stopped.
Registered screenshots confirm the changed layout. No ADO requests or writes
were made by this local acceptance check.

Ignored maintainer evidence: `reports/maintainer/changed-ui-acceptance/result.json`,
`acceptance.json` (full command/reply transcript), `variant-A.png`, `variant-B.png`
and `server-cleanup.json`. The one-off helper is ignored maintainer tooling and
does not ship. The initial fixture setup used a different Windows account from
the native launcher and was denied access before dispatch; the accepted pair
used a fresh fixture with one consistent Windows owner. This establishes the
requested representative adaptation check, not adaptation to every possible UI.

Candidate identities:

| Candidate | SHA-256 | Evidence / limitation |
|---|---|---|
| B1 diagnostic, commit `1958849` | `c16579a01da26c55f01c255d45d6c924e2ed5a6d799daaae5d806a4714293ec0` | Fresh installation; 13 static gates pass; 902/904 tests pass. The two unchanged local adoption junction failures remain. All other remediation findings unresolved in this diagnostic archive. |
| Intermediate remediation | `e2434d38c2df51977425559b22fad4d70fa9d7c9d51e92a1771737d2c7e17a72` | 363 packed files; maintainer helper absent. Built for synthetic replacement/rollback proof. Full installed/platform gates and real-agent acceptance unresolved; not approved for consumer replacement. |
| Superseded installed candidate | `991a2132f6896cb8aafd71e65286659195b39977ba6a45ec9da5d6357bfd3e3f` | 363 packed files verified against installed content; 980/983 tests and 13 static checks pass. Predates the final H2 repair and deadline-test stabilization; full gate failed. |
| Reviewed runtime candidate | `de71087bde609c59a8a41db57ec57928a8f96b2cceac235f560c8b81fb5def4a` | 363 packed files verified against installed content; 982/984 tests and 13 static checks pass. Includes final H2 repair; only the two local junction failures remain. Subsequent changes add F5 test coverage and validation documentation. |

The ignored `reports/maintainer/replace-candidate.mjs` is a one-off maintainer
transaction, not a package command. It verifies both archive and installed content
hashes, accounts for npm's `.gitignore` extraction rename, retains the setup journal,
and restores the journal with `modules:false` plus original manifest, lock, archive
and setup state before `npm ci` on failure. It preserves execution data and reports.
The completed Story 84 consumer replacement is recorded above. Reuse the validated
archive; do not repack it for installation. A failed installed validation cannot be
overridden by a direct probe.

## Finding → implemented change → regression proof

Test paths below are under `harness-tests/`. Finding IDs are in new test names.
Outcome and settlement tests use the real runtime and reassessment where relevant.

| ID | Implemented change | Regression proof |
|---|---|---|
| B1 | Pinned YAML/ref grammar, quoted keys and prefixed/frame refs; unchanged membership/freshness boundary | `execute-commands.test.mjs`: verbatim reproduction subprocess, fresh dispatch, stale/missing/malformed/embedded decoys; native `snapshot-refs` navigation/reload/frame check |
| B2 | Pinned arity/options/regex validation, history aliases, focused editable `type`, password/raw snapshot refusals | `execute-remediation.test.mjs` B2; native `modal-and-type` |
| B3 | Modal refusal remains recoverable for reads and screenshots; dialog action invalidates refs | `execute-remediation.test.mjs` B3/F6; native modal sequence |
| B4 | Capture before clearing, separate exception/console histories, prefix/reset detection and navigation deltas | `execute-remediation.test.mjs` B4; native diagnostics modes. End collection cannot reconstruct earlier discarded navigation logs |
| B5 | Public usernames, password-only secrets, host alias binding and conflict detection | `execute-remediation.test.mjs` B5; native login/no-secret checks |
| F1 | Preserve uncertain original effect, validate compatible reconciliation before atomic commit | `execute-finalize.test.mjs` F1/F4/V1 |
| F2 | Interrupt cleanup from actual dispatch/effect facts; retain lifecycle obligations and earlier FAIL | `execute-finalize.test.mjs` F2/H4 stop, command-limit, size-limit and expiry |
| F3 | Resolve cleanup resource before producer bindings; skip never-registered resources independently | `execute-host.test.mjs` F3/F8 with two resources and failed first creation |
| F4 | Immutable/idempotent reconciliation; wrong accepted reconciliation requires indeterminate/new execution | `execute-finalize.test.mjs` F4 acknowledgement and correction tests |
| F5 | Refuse incompatible not-executed settlement while keeping the step open | `execute-finalize.test.mjs` F5 evaluated FAIL, action/capture refusal, recoverable valid settlement and genuinely unexecuted step |
| F6 | Required screenshot/state-save/persistence failures poison; modal pre-dispatch refusals do not | `execute-finalize.test.mjs` F6; `execute-remediation.test.mjs` B3/F6 |
| F7 | Attempt-local captures committed with their producer | `execute-finalize.test.mjs` F7 capture/failure/retry |
| F8 | Service cleanup requires reliable required checks and resource-identifying lifecycle evidence | `api-runtime.test.mjs` F8; `execute-host.test.mjs` F3/F8; shared API/DB lifecycle validator |
| H1 | Policy-denied begin and synchronous startup errors settle/release ownership | `execute-host.test.mjs` H1 |
| H2 | Reconnect delayed READY; distinguish absent startup from interrupted running host and unresolved identity | `execute-host.test.mjs` H2; native killed-host recovery |
| H3 | Catch post-dispatch budget/receipt failures; retain dispatch facts and explicit uncertainty | `execute-host.test.mjs` H3/H5/L4; `execute-remediation.test.mjs` H3/L4 |
| H4 | One onBeforeExpire hook, bounded evidence/commit facade and single finalizer before context expiry | `execute-finalize.test.mjs` H4 dispatch/poll/finalize boundaries, late evidence/commit refusal; host deadline tests |
| H5 | Bound the full reply envelope; explicit oversized snapshot/ref invalidation; token lines masked before subjects | `execute-remediation.test.mjs` H5; actual-host near-limit/oversized/post-dispatch receipt tests |
| V1 | Dispatched or possibly dispatched mutation advances state; reconciliation needs post-action evidence | `execute-finalize.test.mjs` F1/F4/V1; command freshness tests |
| V2 | Explicit indeterminate rulings survive page changes and later PASS | `execute-verdicts.test.mjs` V2 for every supported reason |
| V3 | Fixed rendered readers, coverage gaps, visible-descendant overrides, selected labels, shadow/slot uniqueness and scoped editable text | `execute-reads.test.mjs` V3; native `rendered-reads`; command subject/freshness tests |
| V4 | Explicit values follow frozen expected types | `execute-remediation.test.mjs` V4 string 42/10.00; existing numeric count checks |
| V5 (P) | Polling retains decisive evidence/absence agreement plus bounded summary | Reproduced proportional artifact retention; `execute-remediation.test.mjs` V5 eventual PASS/cancellation now retains two decisive artifacts |
| V6 | Store read once; compact /2 provenance; verified reassessment recomputes comparisons | `execute-commands.test.mjs` V6; `execute-finalize.test.mjs` V6/D3; native 100 KiB read and provenance budget |
| V7 | Resolve expected env references via the consumer environment loader | `execute-refinement.test.mjs` S4/S5/V7, value only in .env |
| L1 | Bounded read/remove/sharing races, nonce and creation-identity ownership retained | `execute-remediation.test.mjs` L1/L3; ownership regression suite |
| L2 | Atomic mutex publication and ownership-safe bounded contention/release | `execute-recovery.test.mjs` L2 empty/contended/replacement owner cases |
| L3 (P) | Monotonic two-second rename budget; update memory after durable write | Injected contention over 280 ms reproduces the old bound; `execute-remediation.test.mjs` L1/L3 and L4 post-publication failure |
| L4 | Canonical receipt before sequence link; duplicate request cache; terminal missing receipt is COMMAND_UNCERTAIN | `execute-remediation.test.mjs` L4 crash injection; `execute-host.test.mjs` H3/H5/L4 and CLI await |
| L5 | Shared native recovery environment and ownership proof before protected-data deletion | `execute-recovery.test.mjs` L5 environment parity/surviving session |
| L6 (P) | 30-second recovery with close/tree/delete/verify reservations; tree probe/stop/proof subwindows | Injected slow/failed probe reproduced starvation; `execute-recovery.test.mjs` L6 proves forced-stop opportunity and data retention |
| S1 | Aggregate 500/64 MiB/2M nodes/depth32 bounds; verified host-bound guard cache; legacy full read | `execute-scale.test.mjs`; `execute-refinement.test.mjs` S1 boundaries; `execute-host.test.mjs` S1 tamper/legacy/stop |
| S2 (P) | Shared parameter parser accepts both XML quote styles | Single-quote reproduction; `execute-remediation.test.mjs` S2 |
| S3 | Distinct exclusion reasons | `execute-source.test.mjs` S3 step/shared limits, parameter set, source/expected credentials |
| S4 | Explicit REFINE login/service/provenance/cleanup declarations with actionable errors | `execute-refinement.test.mjs` S4 incomplete operation and unused-user guidance |
| S5 | Freeze returns scenario-scoped readiness | `execute-refinement.test.mjs` S4/S5/V7; API-only detached host |
| S6 | startUrl/checkpoint returned and execution instructions consume them | `execute-host.test.mjs` H2/S6; skill protocol and native initial navigation |
| S7 | Original acceptance criteria assigned to owning regressions | Coverage checklist below |
| D1 | Bounded sensitive leaves and encoded variants; structural redaction collisions stop verification | `execute-remediation.test.mjs` D1/H5; native no-secret check; raw argument protection tests |
| D2 (P) | Owned-path validation before saved login-state dispatch/write | Planted link and escaped destination reproduction; `execute-remediation.test.mjs` D2 |
| D3 (P) | Verify/parse the same bounded evidence bytes, cache only those bytes per report | Inspected separate-read race; `execute-finalize.test.mjs` V6/D3 evidence alteration; command missing/tampered evidence tests |
| D4 | Escape generated Markdown fields | `execute-remediation.test.mjs` D4 |
| D5 | Default reliable matching FAIL candidates, explicit includes and file:false, per-defect legacy eligibility | `execute-ado.test.mjs` D5 mixed browser/API/diagnostics cases |
| D6 | Bound generated titles; validate every edited title before batch writes | `execute-remediation.test.mjs` D6 and delivery preflight tests |
| D7 | Normalize allowed field values by declared type/identity | `execute-remediation.test.mjs` D7; ADO fixtures use realistic string picklists |
| D8 | Exact acknowledgement identity, isolated uncertain attachments, persisted/resealed publication resume | `execute-ado.test.mjs` D8 real loopback upload and resume sequences; exact-ack tests |
| U1 | Current M13 handoff references replace obsolete exploration notes | `execute-remediation.test.mjs` U1 and package links gate |
| U2 | Preserve consumer-owned conflicting skill folders with rename guidance | `adoption.test.mjs` U2 for both discovery roots |
| U3 (P) | Allow-list finite native/CI summary fields | Inspected arbitrary-field propagation; `ci.test.mjs` U3 unknown fields cannot survive |
| U4 | One-time publication indexes instead of repeated full scans | `execute-ado.test.mjs` U4 counters at 500 cases/50 Bugs |
| U5 | Cache own identity/completed protection only; recheck other-process identities | `execute-recovery.test.mjs` U5 inventory counters and replacement identities |
| U6 (P) | Remove consumed inbox entries, retain canonical receipts/sequence links | Reproduced accumulating inbox; `execute-remediation.test.mjs` L4/U6; command limit bounds retained storage |
| C8 | Disposition of the named cleanup leads only | Detailed list below; no unrelated framework redesign |

C8 dispositions: removed the unused groupStatus helper and native reconciliation
option; username overlap/alias collisions have explicit refusal tests; maps and
XML parameter names reject prototype keys; apostrophe parsing and waits use literal
and monotonic handling. Repeated serialization was inspected: assertions and
observations retain their scoped size guards; the costly aggregate reread is removed
from routine commands and the scale fixture records actual work. Completion
persistence errors retain interruption/ownership rather than reporting success.
ADO identity-callback failure preserves its durable acknowledgement and rejected
cache entries are evicted (`ado-integrations.test.mjs`, C8). Query documentation
points to native fixed definitions, and recovery rejects invalid file types
(`execute-recovery.test.mjs`). No broader cache/pruning or execution framework was added.

## Original §12 acceptance coverage

| Requirement | Owning proof |
|---|---|
| FAIL finality and invalidation | `execute-verdicts.test.mjs`, `execute-finalize.test.mjs`, native fail-finality |
| Supporting versus matching checks; no self-comparison | `execute-verdicts.test.mjs`, `execute-commands.test.mjs` |
| Polling mismatch→PASS; asynchronous UI evidence | V5 regression and existing asynchronous command/native artifact-binding checks |
| Missing versus tampered artifacts | Command integrity regressions, V6/D3 reassessment, native integrity-stop |
| Verification-only steps | `execute-commands.test.mjs`, `execute-finalize.test.mjs` F5, refinement contracts |
| Resource/lifecycle bookkeeping | F2/F3/F6/F7/F8 regressions and native cleanup-lifecycle |
| Bounded read-only retries | Real-core F7, native read-retry; no automatic uncertain mutation replay |
| Delayed READY ownership | Host H1/H2 plus native killed-host recovery |
| Request deduplication and receipt crash boundaries | Mailbox L4, actual-host H3/H5/L4, CLI await test |
| Diagnostic notices versus execution errors | B3/B4/F6 tests; native diagnostics modes |
| Scoped readiness and manual reports | S4/S5/V7, API-only detached host, scale actual report collection |
| ADO revision batches above 200 | `execute-source.test.mjs`: 405 cases/shared dependency, three batches ≤200 |
| Delivery crash recovery at create/upload/link/results/complete | `execute-ado.test.mjs` durable IDs, uncertain upload isolation, publication-stage receipts and resume |
| Installed archives on Windows/Linux and changed UI agent execution | Final hosted receipts and the live two-variant acceptance above; never inferred from offline fixtures |

## Historical validation before this remediation

Validation update on 2026-10-04; local Node 24.15.0, hosted Node 24.21.0. All ten strict-review code
findings have been addressed and a fresh independent reviewer approved the fixes.
Full acceptance remains incomplete: real-agent/ADO acceptance is pending and
the latest hosted installed-package checks failed the secrets gate on both platforms.
Earlier hosted Windows validation failed twice at different gates. The first hosted
installed checks passed on both platforms and all Linux gates passed. Local
installed tests also have two failures described below. The scripted fixture
driver does not prove agent adaptation.

The [first PR validation run](https://github.com/MahmoudElSharkawy/Playwright-Harness/actions/runs/37156853698)
checked head `a000e0941b8896c4bf98458d88f2ab8c4e0fb02d`. All 901 installed tests
passed on Windows and Linux, as did both npm 12 consumer-flow jobs. The secrets
validator rejected a synthetic token assignment in the new CI diagnostic test;
the other 12 static checks passed. Native probes did not run after that gate failed.
The fixture now uses the accepted `<synthetic-token>` placeholder; the validator
is unchanged and the diagnostics exclusion assertion remains intact. Focused
CI-helper tests pass 26/26 and the secrets check passes. Hosted validation of
this correction remains pending.

Correction checks: all 13 static checks pass, CI-helper tests pass 26/26, and
independent review approved the fixture correction. The full local sandbox run
passed 881/901 tests: two known adoption junction failures and 18 failures when
Windows process inspection was unavailable. Rerunning the affected runtime files
with the required process-inspection access passed 30/30; no runtime code changed.

| Gate | Status |
|---|---|
| Offline execution contract tests | PASS, including the installed M19 regressions |
| Full check:ci checklist | First hosted attempt: Windows/Linux 899/899; Windows rerun 897/899; local Windows 897/899; 13 static gates pass, no skips |
| Installed archive on Windows | First hosted attempt PASS, rerun FAIL at tests; local FAIL at two adoption tests; package unchanged |
| Execute probe on Windows | Direct installed probe PASS, all 12 checks; first hosted probe 11/12 PASS, read-retry FAIL; rerun did not reach the probe |
| Independent framework review | APPROVE; no remaining findings in the remediation scope |
| Installed archive/probe on Linux | PASS, all 12 execute checks; browser, API/DB, timeout and consumer-flow gates also pass |
| Claude Code / Codex ADO sandbox and changed UI | Pending; requires consumer/sandbox scope and host access |

The two failed tests are the unchanged adoption cases for repairing moved links
and removing retired links. Both reproduce against source with ordinary and
elevated execution: Windows lists a dangling junction but `readlinkSync` returns
`ENOENT`. A temporary classifier fallback also encountered `rmdirSync: ENOENT`
and was reverted. No adoption workaround or test skip is included in M19.
The failures did not reproduce in the hosted installed checks.

[Hosted validation](https://github.com/MahmoudElSharkawy/Playwright-Harness/actions/runs/37154242931)
checks implementation commit `a35fe7d46fa8e959e64296fcd69131c57592c68b`.
The first Windows attempt failed only `read-retry`; recovery completed and the
package was unchanged. All five isolated local repetitions passed. The uploaded
receipt does not preserve the failing stage or message, so the cause is not
established. No speculative runtime change or timeout increase was made.
The unchanged Windows rerun stopped at two unit-test failures; its receipt has
counts but no failed locations. Diagnostic-only changes now retain known test
file/line locations and finite retry stage/status facts for the next run. All
26 CI-helper tests pass, including bounded serialization of an ordinary error.
Independent review approved those diagnostics, pushed as `a1257b2`. Before PR
creation, validation could not be confirmed because GitHub Actions API requests
returned HTTP 503 or stalled. The confirmed PR run above subsequently passed all
901 tests on both platforms but stopped at the synthetic secrets finding. The
earlier Windows native-probe failure remains unresolved; neither a passing local
retry nor the diagnostic change closes that gate.

The live checks cover login reuse, secret handling, mixed checked/observed
conditions, historical FAIL preservation, asynchronous evidence binding,
diagnostics modes, read retry, mutation reconciliation, resource cleanup and
killed-host recovery. Two added live checks prove immediate integrity stopping
and bounded provenance with a historical FAIL retained in a valid report.

Focused regressions cover exact subject matching, screenshot-backed visual
judgments, real ADO classification paths, omitted-case point maps, hard execution
limits, large native API assertions, shared output accumulation, in-flight cleanup
deadlines, parameter-stable fingerprints and persisted revision flags.

Installed diagnostics fixture: three step endings took 1,243 ms with default
`end` diagnostics (one capture), and 2,443 ms with `per-step` (three captures).
These are fixture measurements, not a general performance guarantee.

Tested archive: `playwright-pom-harness-3.2.0.tgz` (352 files).
SHA-256: `f8871286748a7a46d7402a9c9870935875de04655dfd53559aa57fcdeda7c4ff`.
This identifies the implementation snapshot before this validation-record update.
The installed receipt retains the archive identity, failed check results and
package immutability proof; it must not be represented as a successful full gate.
The separate direct installed-probe receipt records all 12 checks, cleanup and
package immutability; its assessment SHA-256 is
`71e8ae03703c097cf455bf183486814d44e90fad322852cc2ae1854875709e04`.

Hosted Linux archive SHA-256:
`78d6fda43b868c3abe125d9dc14e99fbd55c8c284d5947651e9f5d3a7d759a67`.
Its successful execute assessment SHA-256:
`23e482ba2b826ae7459eda8e9997fc9ef87218344f48b6bc7513a42c8c20a0d7`.

Run `npm run check:ci`, `npm run test:installed -- <new external folder>` and
`npm run probe:execute -- <new external folder>`. An existing successful installed
workspace can run node scripts/ci/native.mjs <workspace> execute without another
installation. Native proof receipts include checks, cleanup and diagnostics timings.

Real-agent acceptance must retain source/freeze fingerprints, actor identity,
suite/story scope, verdicts/methods and variant-B completion without refinement
edits. Do not mark that gate passed from the scripted driver.
