# M5 validation record

Scope: minimal execution contracts following accepted M4. Browser, API and database
executors, SQL parsing, host orchestration, reporting integration and parallel dispatch
remain outside this milestone. The existing `main` branch and earlier history are retained.

## Acceptance status

**M5 accepted on 2026-10-01 (Africa/Cairo).** All twelve checks passed, including
78 focused tests and 238 package tests. Final independent review returned
**APPROVE**, with all five findings resolved and no remaining findings.
The [contract guide](M5-EXECUTION-CORE.md) describes the implemented boundary.

The initial checks passed on 2026-09-30, but independent review found five contract
gaps. Corrective review resolved four and required one further assertion-coverage
boundary fix. The final correction passed both validation and independent re-review;
the earlier failed review gates remain recorded.

## Actual validation

The table records the corrected candidate. Original receipts remain preserved.

| Package command | Result | Effective scope |
|---|---|---|
| `npm run check:syntax` | PASS | 44 JavaScript sources |
| `npm run check:json` | PASS | 19 JSON/JSONL files; 18 parsed records |
| `npm run check:links` | PASS | 83 Markdown files; 335 local links |
| `npm run check:conventions` | PASS | 15 example files; 60 rule applications; zero FAIL/WARN/legacy findings |
| `npm run test:core` | PASS | 78 focused contract tests; zero failures or skips |
| `npm test` | PASS | 238 tests; zero failures or skips, including the 26 convention rules' positive/negative fixtures |
| `npm run test:fetch` | PASS | 15 self-test checks; three parsed nodes; no ADO request |
| `npm run typecheck:examples` | PASS | Configured example project; 18 local TypeScript sources; no emit |
| `npm run check:privacy` | PASS | 176 publication candidates; zero findings |
| `npm run check:secrets` | PASS | 176 publication candidates; zero findings |
| `npm run check:provenance` | PASS | 176 candidates; 153 existing dependency records |
| `npm run check:publication` | PASS | 176 candidates; 173 packed files; no dependencies or private runtime material |

Platform: Windows, Node 24.15.0. The first sandboxed `npm` launcher could not load
its user-level npm entry point. The recorded checks instead invoke the npm CLI
bundled beside the active Node executable:

```text
node <node-install>/node_modules/npm/bin/npm-cli.js run <script>
node <node-install>/node_modules/npm/bin/npm-cli.js test
```

This is the same package script interface, without relying on that launcher. No
global install or user configuration was changed. Results are retained in restricted,
ignored `.validation/m5/checks-03`, with exact arguments, exits and outputs; the
earlier `.validation/m5/checks-01` and `checks-02` receipts are unchanged. Core
tests use the built-in Node runner and require no new dependency. The full package
suite still needs the separately pinned M4 packages documented in the README.

## Requirement coverage

| M5 requirement | Demonstrated behavior |
|---|---|
| Frozen inputs | Original configuration/knowledge edits and direct nested edits cannot change active capabilities, targets, references, definitions, limits or typed inputs |
| Peer operation sources | Catalog/helper/inline operations receive identical checks; a catalog cannot grant target access or unsupported DDL/admin |
| Dynamic autonomy | Uncataloged API read/mutation and DB SELECT/DML definitions pass permitted profile checks; protected/custom defaults and exploration overrides are enforced |
| Execution identity and bindings | Wrong run/scenario/attempt/provenance, missing attempt numbers, changed bindings and future producers are rejected |
| Recovery | Safe no-effect retries and evidence-backed reconciliation/idempotency preserve history; unknown effects and missing required responses cannot become clean passes |
| Assertions and results | Zero/incomplete scope and supplied verdict/count shortcuts fail; assertions must be evaluated again after replay; reliable failures remain FAIL |
| Lifecycle intent | Temporary owned fixtures require cleanup; restoration completion needs a guard; conflicts and required cleanup failure remain visible; persistent/no-obligation outcomes need no before-state capture |
| Evidence | Actual temporary files are read and hashed; tampering, deletion, empty files, wrong attempt association, missing categories and alias escapes fail |
| Deadlines/cancellation | Ordinary operations stop at the deadline/cancellation decision; cleanup gets a separate finite budget that later invocations cannot reset |

These are contract and filesystem tests with synthetic operation records, not
browser/API/database integration proof. No live HTTP or SQL was executed, no browser
was launched for M5, and no end-to-end host parity is claimed. Linux core execution,
live executor timers/cancellation, protected secret storage, real recovery/restoration
and reporting integration are unperformed here and belong to later milestones.
Link checks cover local files, not remote pages or anchors. JSON parsing is not
schema validation; focused tests exercise the actual runtime record validators.

## Review and accounting

The change builds on accepted M4 commit
`1c5446eb694b7f66b9e6f7f4ca66c83275d0aa4c`. Source changes are limited to the core,
its fixtures/tests, package-owned version 3.0.5 and documentation. No baseline, skill
content, imported team library, native CLI pin or consumer configuration was changed.
Original review and M1–M4 evidence remain intact. Independent review resolved every
finding before acceptance. Implementation stops at M5; M6 is not implemented.

The first independent verdict was **CHANGES-REQUIRED**, despite all initial checks
passing. Corrections address the five findings:

| Resolved finding | Independently approved correction |
|---|---|
| F1: unrelated cleanup/resource identity | Require origin-bound identity and the same resource's confirmed effect or typed identity binding for completion; preserve frozen-input identities and bulk cleanup |
| F2: evidence alias into protected storage | Require the actual evidence subtree and reject redirected evidence roots |
| F3: earlier unsafe replay ignored | Validate every prior replay transition and re-read reconciliation proof files before retry decisions |
| F4: missing intermediate assertion history | Require exact scoped IDs/counts in the single-attempt validator, before a recovery decision as well as final assessment; interrupted attempts explicitly record unknown/unevaluated results |
| F5: cleanup budget reset | Require the shared scenario cleanup start for recovery decisions and use it across invocations |

The review also identified source-version compatibility: source and knowledge
revisions now accept normal semantic versions while execution identifiers stay strict.
Thirteen added tests cover these corrections, including direct pre-action rejection
of omitted and unrelated assertions. Unrelated lifecycle invocations still accept
empty assertion arrays. The first corrective re-review remains recorded as
CHANGES-REQUIRED because F4 initially blocked only final assessment.
Original frozen diff and review reproductions remain under restricted ignored
`.validation/m5/review-01` and `.validation/m5/independent-review`.

Final review independently verified 78 focused tests, all 176 source hashes and
four additional rejection/positive-control cases, carrying forward the verified
19 corrective controls and 15-file/60-application convention result. The twelve
package-check results above are author validation, not a claim that the reviewer
reran every command. Final approval and receipts are retained in restricted ignored
`.validation/m5/final-review`; no review records were overwritten.

The reviewed implementation was frozen from the M4 base as 18 changed files,
1,272 additions and five deletions, with patch SHA-256
`d4229dca71c847c9c80c6a4ea64e9b2cf9298a0fcca4c26b96fbcbe2f8e55e82`.
Only this acceptance record and the ignored review ledger were updated after the
verdict; the approved source and tests remain unchanged.

Historical credential values remain removed; owner confirmation of revocation/rotation
remains unresolved. Protected historical material is not read or copied by M5.
