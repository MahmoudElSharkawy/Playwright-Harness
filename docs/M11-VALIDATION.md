# M11 validation

Status: **PASS — M11 execution and host parity accepted on Windows**. M12 has not started.

The implementation, Windows hook correction and final native evidence have independent
review approval. Both native hosts pass the complete proof, with zero semantic
differences across the 19 required cases.

## Package gates

All 18 commands passed on Node 24.15.0 / Windows. Run package commands through npm;
where npm is not on PATH, use `node <node-install>/node_modules/npm/bin/npm-cli.js`.
Private receipts retain stdout, stderr and exit codes for every command.

| Command | Actual scope / outcome |
| --- | --- |
| `npm run check:syntax` | 93 JavaScript files parsed; PASS |
| `npm run check:json` | 20 files parsed / 19 records; PASS; not schema validation |
| `npm run check:links` | 95 Markdown files / 375 local links; PASS; remote links and anchors not checked |
| `npm run check:conventions` | 15 example files / 60 rule applications; no warnings, failures or legacy findings |
| `npm run test:core` | 82 tests; PASS |
| `npm run test:browser` | 11 tests; PASS |
| `npm run test:api` | 61 tests; PASS |
| `npm run test:database` | 57 tests; PASS |
| `npm run test:sequential` | 13 tests; PASS |
| `npm run test:postgresql` | 39 tests; PASS |
| `npm run test:hosts` | 43 tests; PASS |
| `npm test` | 466 tests; 466 pass, zero failures/skips/cancellations |
| `npm run test:fetch` | Existing ADO parsing self-checks pass; no external ADO call |
| `npm run typecheck:examples` | Existing example TypeScript project; PASS |
| `npm run check:privacy` | 238 candidate files; PASS |
| `npm run check:secrets` | 238 candidate files; PASS |
| `npm run check:provenance` | 240 dependency records; PASS; no dependency added |
| `npm run check:publication` | 238 candidate / 235 packed files; PASS; inspected only, not published |

## Native proof and review

Both hosts pass the corrected native proof on Windows:

| Host | Native version | Cases | Required assertions | Attempts | Verified artifacts | Native proof |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | CLI 0.159.2 | 19 | 44 | 62 | 205 | PASS |
| Claude | Code 2.1.285; `claude-sonnet-5` | 19 | 44 | 62 | 205 | PASS |

All 19 cases are semantically equivalent. This includes both real databases, native
browser observations and SQL setup -> UI edit -> API verification -> required SQL
cleanup. Expected negative scenario results remain intact. Native command digest/count,
chronological hook pairs, successful edit mapping, installed-file immutability and
owned process/database cleanup pass for both hosts. Each host used the same unchanged
installed copy of 8,084 entries, including dependency files. No package writes were
detected; no owned M11 database containers remain.
SQL Server reports 16.0.4295.3; PostgreSQL reports 16.14. Both use the already pinned
container digests and dependency graphs.

Codex's corrected native pre-command hook returns a structured deny decision, and
the harmless denied-command marker is absent. Allowed commands and the native edit
still succeed. Each use of the one-run hook-trust override was explicitly approved;
normal command approvals remained enabled and global host settings were not changed.

The earlier native pair remains FAIL in its saved assessment: the denied marker was
created after PowerShell converted the inner guard's exit 2 to shell exit 1. Review 4
approved the structured-denial correction and verified it through both Windows shells
and the actual proof wrapper. The fresh native Codex retest now proves the correction
in the host itself. Earlier executable/path failures and the earlier browser attempt's
`NEEDS_REVIEW`/cleanup uncertainty remain recorded. No failed evidence was overwritten
or relabeled by the successful fresh proof.

The first independent review found five blocking proof defects: weak native receipt
binding, unknown ownership reported as cleanup success, dependencies omitted from
integrity checks, failed patches re-arming the retry guard, and missing assertion
summary counts. Independent review 2 closed all five after corrections and negative
regression checks. It also confirmed the mixed case closes the execution-coverage
gap. Review 2 found one additional regression: the hook adapter dropped stderr-only
failures. The minimal fix restores that known output field; both the original
reproduction and new guard-level regression checks now block unchanged failed-test
retries. Independent review 3 is **APPROVE for implementation**, with all six findings
closed. It verified the frozen patch/source hashes, the original stderr reproduction,
41 focused tests and the nonzero convention gate. Review 4 closes the subsequently
discovered Windows transport defect, with 43 focused checks and the now-completed
native retest. All seven implementation findings are resolved. Its frozen incremental
correction is seven files, +68/-25, based on `cf2ecf2`.
The final independent evidence review approves M11 for the tested Windows scope.
It reconstructed both runs, checked all 410 artifacts and the 8,084 installed entries,
verified the native denial/cleanup receipts, and reproduced the saved comparison.
It also confirmed that the earlier failed proof remains FAIL with its evidence intact.
Changed package tooling has no POM-layer lint scope; zero changed convention files would be
inapplicable, never a substantive pass. The example gate above provides nonzero
convention coverage without changing baselines.

The review-3 implementation freeze contains 24 changed files, +1,002/-8, based on
the accepted M10 commit `2a2fc862971c9011bfef67aecb8f0a273331de7d`. Subsequent edits
to this validation record report those results without changing reviewed code.
Each host's retained scope has 10 PASS (including two recovered), three FAIL,
three BLOCKED and three NEEDS_REVIEW scenarios. These are expected scenario results,
not 19 green business tests. It covers 44 required expectations, including deliberately
missing or failed observations; every retained artifact is checked independently.

Actual native commands: `node scripts/probes/hosts.mjs prepare`, followed by `run`
for Claude and Codex against the returned state file, and `assess` against that same
state. The Codex invocation used `--reviewed-hooks` only with explicit approval.
Private receipts retain the exact arguments, command output, process exit codes,
native hooks, manifests and aggregate PASS assessment. No unit or mocked test is
counted as native browser/database/host integration evidence.

Deferred scope: native-host execution on other operating systems and the broader
installed-platform matrix remain M17. Full generation/review/verification workflow
parity remains M15; bounded parallelism remains M16. M11 proves sequential execution
and host parity only. No M12 work, public release or release tag is included.
Historical credential revocation/rotation remains unconfirmed;
no historical credential was accessed or tested for this milestone.
