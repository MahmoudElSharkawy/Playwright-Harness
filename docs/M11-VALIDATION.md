# M11 validation

Status: **IMPLEMENTED; native Codex gate pending — not accepted**. M12 has not started.

The implementation has independent review approval. Unit/fixture tests are not
substituted for the missing complete native Codex run and paired comparison.

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
| `npm run test:hosts` | 41 tests; PASS |
| `npm test` | 464 tests; 464 pass, zero failures/skips/cancellations |
| `npm run test:fetch` | Existing ADO parsing self-checks pass; no external ADO call |
| `npm run typecheck:examples` | Existing example TypeScript project; PASS |
| `npm run check:privacy` | 238 candidate files; PASS |
| `npm run check:secrets` | 238 candidate files; PASS |
| `npm run check:provenance` | 240 dependency records; PASS; no dependency added |
| `npm run check:publication` | 238 candidate / 235 packed files; PASS; inspected only, not published |

## Native proof and review

Native Claude Code 2.1.285 with the explicitly available `claude-sonnet-5` model
passes the corrected proof: 19 cases, 44 required assertions, 62 attempts and 205
individually validated artifacts. This includes both real databases, native browser
observations and SQL setup -> UI edit -> API verification -> required SQL cleanup.
All expected negative scenario results remain intact. Native command digest/count,
chronological hook pairs, successful edit mapping, installed-file immutability and
owned process/database cleanup pass. The installed snapshot contains 8,084 entries,
including dependency files; no package writes were detected.
SQL Server reports 16.0.4295.3; PostgreSQL reports 16.14. Both use the already pinned
container digests and dependency graphs.

An earlier native Codex CLI 0.159.2 attempt completed the API/database portion.
It did not pass browser execution or native hook trust. Native discovery explicitly
reports the three local proof hooks as untrusted. A person-authorized trust decision
is still pending; the one-run override has not been used. The final candidate must
complete all 19 cases, hooks, cleanup and paired comparison before M11 is accepted.
Native host completion alone is not acceptance. The retained failed
browser attempt has `NEEDS_REVIEW`, with its cleanup uncertainty still visible.
Earlier executable/path setup failures are also retained as failed attempts.

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
41 focused tests and the nonzero convention gate. This is separate from the incomplete
native parity gate. Changed package
tooling has no POM-layer lint scope; zero changed convention files would be
inapplicable, never a substantive pass. The example gate above provides nonzero
convention coverage without changing baselines.

The review-3 implementation freeze contains 24 changed files, +1,002/-8, based on
the accepted M10 commit `2a2fc862971c9011bfef67aecb8f0a273331de7d`. Subsequent edits
to this validation record report those results without changing reviewed code.
The retained native Claude scope has 10 PASS (including two recovered), three FAIL,
three BLOCKED and three NEEDS_REVIEW scenarios. These are expected scenario results,
not 19 green business tests. It covers 44 required expectations, including deliberately
missing or failed observations; every retained artifact is checked independently.

Unperformed gates: complete native Codex proof, final cross-host semantic comparison,
and native-host execution on other operating systems. The broader platform matrix
remains M17; full generation/review/verification workflow parity remains M15.
No M12 work, public release or release tag is included. Historical credential revocation/rotation remains unconfirmed;
no historical credential was accessed or tested for this milestone.
