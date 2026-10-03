# M19 validation

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
