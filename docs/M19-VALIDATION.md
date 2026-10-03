# M19 validation

Validation update on 2026-10-04, Windows, Node 24.15.0. All ten strict-review code
findings have been addressed and a fresh independent reviewer approved the fixes.
Full acceptance remains incomplete: the local installed suite has two failures,
and Linux and real-agent/ADO acceptance remain separate gates. The scripted
fixture driver does not prove agent adaptation.

| Gate | Status |
|---|---|
| Offline execution contract tests | PASS, including the installed M19 regressions |
| Full check:ci checklist | 13 static gates PASS; tests FAIL: 897/899 passed, no skips |
| Installed archive on Windows | FAIL at the two adoption tests described below; package unchanged |
| Execute probe on Windows | Source probe PASS, all 12 checks; direct installed probe in progress |
| Independent framework review | APPROVE; no remaining findings in the remediation scope |
| Installed archive/probe on Linux | Pending; Windows/Linux workflow available, local Docker engine did not respond |
| Claude Code / Codex ADO sandbox and changed UI | Pending; requires consumer/sandbox scope and host access |

The two failed tests are the unchanged adoption cases for repairing moved links
and removing retired links. Both reproduce against source with ordinary and
elevated execution: Windows lists a dangling junction but `readlinkSync` returns
`ENOENT`. A temporary classifier fallback also encountered `rmdirSync: ENOENT`
and was reverted. No adoption workaround or test skip is included in M19.

The live checks cover login reuse, secret handling, mixed checked/observed
conditions, historical FAIL preservation, asynchronous evidence binding,
diagnostics modes, read retry, mutation reconciliation, resource cleanup and
killed-host recovery. Two added live checks prove immediate integrity stopping
and bounded provenance with a historical FAIL retained in a valid report.

Focused regressions cover exact subject matching, screenshot-backed visual
judgments, real ADO classification paths, omitted-case point maps, hard execution
limits, large native API assertions, shared output accumulation, in-flight cleanup
deadlines, parameter-stable fingerprints and persisted revision flags.

Source diagnostics fixture: three step endings took 1,021 ms with default `end`
diagnostics (one capture), and 2,430 ms with `per-step` (three captures).
These are fixture measurements, not a general performance guarantee.

Tested archive: `playwright-pom-harness-3.2.0.tgz` (352 files).
SHA-256: `f8871286748a7a46d7402a9c9870935875de04655dfd53559aa57fcdeda7c4ff`.
This identifies the implementation snapshot before this validation-record update.
The installed receipt retains the archive identity, failed check results and
package immutability proof; it must not be represented as a successful full gate.

Run `npm run check:ci`, `npm run test:installed -- <new external folder>` and
`npm run probe:execute -- <new external folder>`. An existing successful installed
workspace can run node scripts/ci/native.mjs <workspace> execute without another
installation. Native proof receipts include checks, cleanup and diagnostics timings.

Real-agent acceptance must retain source/freeze fingerprints, actor identity,
suite/story scope, verdicts/methods and variant-B completion without refinement
edits. Do not mark that gate passed from the scripted driver.
