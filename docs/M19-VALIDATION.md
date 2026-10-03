# M19 validation

Validated on 2026-10-03, Windows, Node 24.15.0. The implementation has passed
independent framework review. Linux and real-agent/ADO acceptance remain pending;
the scripted fixture driver does not prove agent adaptation.

| Gate | Status |
|---|---|
| Offline execution contract tests | PASS; 39 M19 tests across 11 new test files, included in the full suite |
| Full check:ci checklist | PASS from the installed archive; all 14 gates and 882/882 tests, zero failures, skips or cancellations |
| Installed archive on Windows | PASS; exact dependency graph validated and installed package unchanged |
| Installed execute probe on Windows | PASS; all 10 required live checks, complete owned recovery, package unchanged |
| Independent framework review | APPROVE; zero remaining findings, 9 affected tests independently verified |
| Installed archive/probe on Linux | Pending; Windows/Linux workflow wired, local Docker engine did not respond |
| Claude Code / Codex ADO sandbox and changed UI | Pending; requires consumer/sandbox scope and host access |

The live checks cover login reuse, secret handling, mixed checked/observed
conditions, historical FAIL preservation, asynchronous evidence binding,
diagnostics modes, read retry, mutation reconciliation, resource cleanup and
killed-host recovery. Earlier probe attempts also have complete owned recovery.

Diagnostics fixture: three step endings took 1,018 ms with default `end`
diagnostics (one capture), and 2,413 ms with `per-step` (three captures).
These are fixture measurements, not a general performance guarantee.

Validated archive: `playwright-pom-harness-3.2.0.tgz` (352 files).
SHA-256: `0ed4f9025e2b6fd58d1099804cf3f615e675c053698dc036d43732f43cc7d8f1`.
Installed and native receipts retain the archive identity, check results and
package immutability proof. The native assessment SHA-256 is
`b3deb675731097e8c16b106014f435bc3e6a98a865d70eb9420bb438549c2280`.

Run `npm run check:ci`, `npm run test:installed -- <new external folder>` and
`npm run probe:execute -- <new external folder>`. An existing successful installed
workspace can run node scripts/ci/native.mjs <workspace> execute without another
installation. Native proof receipts include checks, cleanup and diagnostics timings.

Real-agent acceptance must retain source/freeze fingerprints, actor identity,
suite/story scope, verdicts/methods and variant-B completion without refinement
edits. Do not mark that gate passed from the scripted driver.
