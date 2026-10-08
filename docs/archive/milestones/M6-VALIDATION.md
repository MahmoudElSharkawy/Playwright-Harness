> Historical record. Read the [current documentation](../../contributing.md) for present behavior. Statements and validation results below describe their original implementation period.

# M6 validation record

M6 is accepted on 2026-10-01: all required gates passed and independent review
approved the corrected implementation with no open findings. M7 is not implemented.
The [browser guide](M6-BROWSER.md) describes the supported interface and limitations.

## Scope and frozen review

Work remains on the existing `main` branch, based on
`57c3754c5cdd3500ccb930997d7cb0ba37da0f43`. The implementation connects the exact M4
native CLI graph to M5 policy, identity, evidence, effects, recovery and required
cleanup. It adds no browser command language, API/DB executor, host adapter or
workflow engine. A narrow shared-validator correction permits an unexecuted policy
refusal to be recorded after expiry; genuine denial is still required.

The approved review-04 diff contains 19 files, 1,247 additions and 18 deletions.
Its SHA256 is `0972a0ae16db35ccfdb39969dc7c3f64329be882d4bdad536c277649d8e770fb`.
Frozen patches, source hashes, original review reports and validation receipts are
retained in protected local audit storage. Only this acceptance document changed
after that review; the runtime and tests remain the reviewed files.

## Final validation

Package checks 05: all 13 commands passed. Commands ran through the Node
installation's bundled npm CLI because the local npm launcher is unavailable.
Each receipt preserves stdout, stderr and the actual exit status.

| Command | Result and actual scope |
|---|---|
| `npm run check:syntax` | PASS: 50 JavaScript files |
| `npm run check:json` | PASS: 19 files, 18 parsed records |
| `npm run check:links` | PASS: 85 Markdown files, 342 local links |
| `npm run check:conventions` | PASS: 15 example files, 60 rule applications, zero new findings |
| `npm run test:core` | PASS: 81 tests, zero skipped |
| `npm run test:browser` | PASS: 11 tests, zero skipped |
| `npm test` | PASS: 252 tests, zero skipped; includes the focused suites above |
| `npm run test:fetch` | PASS: 15 self-test checks, 3 parsed synthetic nodes |
| `npm run typecheck:examples` | PASS: 18 example TypeScript files |
| `npm run check:privacy` | PASS: 184 publication candidates |
| `npm run check:secrets` | PASS: 184 publication candidates |
| `npm run check:provenance` | PASS: 184 candidates, 153 dependency records |
| `npm run check:publication` | PASS: 184 candidates, 181 packed files |

Live attempt 07 passed all 26 checks on each platform:

| Platform | Runtime | Checks | Scenario results | Attempts | Verified artifacts |
|---|---|---:|---:|---:|---:|
| Windows | Node 24.15.0 | 26/26 | 22 | 69 | 85 |
| Linux container | Node 24.21.0 | 26/26 | 22 | 69 | 85 |

The command was `node scripts/probes/browser.mjs <new-external-consumer>`.
Windows selected the previously installed M4 browser cache. Linux used the accepted
`playwright-harness-m4:0.1.22` image with `--init --network none --shm-size=1g`, a
publication-only source archive and the image's pinned dependencies. Containers were
removed after receipt transfer. No external service or real account was used.

Both runs preserved the same 184-file package digest:
`71b8071689ff9d069a0d4a57c1047454711548cb93d391ebfd3a0a85de46c786`.
All 85 artifact sizes and hashes on each platform were independently re-read after
transfer. Semantic comparison passed for all 22 scenario results: attempt, artifact
and session identities were mapped; timing, input fingerprint and artifact
location/size/hash were omitted. Business outputs, binding relationships, assertions,
effects, failure classifications and lifecycle dispositions remained in the comparison.

Coverage includes success with real snapshot/PNG evidence, reliable assertion failure,
outage, safely recovered read, uncertain transmitted mutation without replay, daemon
crash, actual authentication restoration, stale authentication, cancellation both
during and between commands, callback/body/sanitizer deadlines, late-context refusal,
unawaited work, assertion history, intentional persistence, stale effect claims,
temporary fixture cleanup, unreached required invocations, late policy refusals,
cleanup exhaustion, unrelated-session retention and package immutability.

A passing probe means the expected verdict and lifecycle facts were verified. The
deliberately exhausted cleanup run remains `NEEDS_REVIEW` with its failed obligation.
A separate fixture-recovery receipt records the later named-session close, recorded
process-identity checks and verified private-directory removal. The original result
was not rewritten. No private runtime directories remain from either final proof.

The 11 browser contract tests also passed on Linux before the final live proof.
They include injected post-copy preparation failure and failure of the rollback
itself, exercising actual owned directories and explicit remediation receipts.
These fault-injection tests do not claim browser integration coverage.

## Independent review and attempt accounting

The reviewer was a separate agent, following the canonical framework-review procedure
and checking milestone requirements, architecture, changed files and evidence.
It independently ran the 15-file/60-rule convention baseline and focused tests.
The final review independently reran 59 result-validator tests and real browser
policy/deadline reproductions. All four findings are resolved:

| Finding | Resolution |
|---|---|
| F1: callback lifetime and expiry records | Bound asynchronous work and cancellation; retain explicit unreached/expired results and genuine unexecuted policy refusals |
| F2: private storage left by preparation failure | Check executable prerequisites before acquisition; safely roll back owned storage or return remediation status with a private original cause |
| F3: business lifecycle could not be completed | Update the original resource obligation from the actual cleanup/restoration attempt while preserving identity and intent |
| F4: dashboard ownership bypass | Refuse dashboard lifecycle commands, including global kill and untracked listener forms |

Earlier evidence remains intact:

- Initial focused contract checks: 101/101 PASS.
- Windows attempt 01: INCOMPLETE, 2/12 checks passed due to short/long path spelling
  differences. A separate recovery receipt records removal of ten owned protected
  directories. Windows attempt 02 passed 12/12 after correction.
- Windows/Linux attempt 03 passed 18/18; attempt 04 passed 23/23; attempt 06 passed
  25/25. They are intermediate coverage, not substitutes for the final 26-case gate.
- Linux launches 01/02 failed on source access before browser execution; those browser
  checks were unperformed. Publication-only archive transfer resolved the setup issue.
  Linux attempt 05 was a contract-only run, not a live browser proof.
- Review 01 required changes for F1-F4. Review 02 resolved F2-F4 and reproduced two
  remaining expiry-result failures. Review 03 verified those fixes and reproduced
  the late policy-refusal conflict. Review 04 approved the final narrow correction.
- Package checks 01/02/03/04 passed with their then-current coverage of 246, 248, 249
  and 249 total tests. Final checks 05 passed 252. Earlier green checks were not used
  to waive later findings; the finding ledger retains their resolution history.

## Limits and stopping point

JSON parsing is not schema validation. Link checks cover local files, not remote
URLs or anchors. Changed-file POM convention scope is empty; the explicit example
baseline provides meaningful coverage and was not expanded or weakened.

Linux validation is a container proof. Full Claude/Codex parity, real SSO, borrowed
browser attachment, live API/DB execution, visual testing and concurrency remain
unperformed and outside M6. The browser guide documents trusted callback intent,
native origin-filter limits and synchronous event-loop blocking.

Historical credential values remain removed. Owner confirmation of their revocation
or rotation remains unresolved; M6 did not access protected historical material.
No new dependency, public release or release tag was introduced. Stop before M7.
