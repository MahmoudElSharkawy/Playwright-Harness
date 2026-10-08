> Historical record. Read the [current documentation](../../contributing.md) for present behavior. Statements and validation results below describe their original implementation period.

# M12 validation

Status: **M12 accepted for the implemented adapter and compatibility contracts.**
All 19 package commands pass after the fixes. Independent re-review approved the
implementation and closed all six findings; no findings remain. Live tenant
validation remains unperformed, as specified below.

M12 separates optional ADO retrieval, publication/linking and source-control
delivery while retaining the five compatibility entrypoints. Local sources remain
independent of ADO. See [the adapter guide](M12-ADO.md) for configuration, behavioral
compatibility changes and receipts.

Validation was executed on Windows with Node 24.15.0, package version 3.0.12.
The corrected implementation passed the commands below. These are package-script
names; this environment invoked them through
`node <node-install>/node_modules/npm/bin/npm-cli.js run <script>` (and `test` for
the full test suite). Private command output receipts are retained outside the
publication candidate. All tests use synthetic fixtures.

| Command | Outcome and actual scope |
|---|---|
| `check:syntax` | PASS: 102 JavaScript files |
| `check:json` | PASS: 20 files, 19 parsed records; parsing, not schema validation |
| `check:links` | PASS: 97 Markdown files, 383 local links; anchors and remote links unperformed |
| `check:conventions` | PASS: 15 example files, 60 rule applications, zero warnings/failures |
| `test:core` | PASS: 82 tests |
| `test:browser` | PASS: 11 tests |
| `test:api` | PASS: 61 tests |
| `test:database` | PASS: 57 tests |
| `test:sequential` | PASS: 13 tests |
| `test:postgresql` | PASS: 39 tests |
| `test:hosts` | PASS: 43 tests |
| `test:integrations` | PASS: 70 tests |
| `test` | PASS: 536 tests, zero failed/skipped/cancelled |
| `test:fetch` | PASS: 15 retained parser/renderer self-checks |
| `typecheck:examples` | PASS: configured TypeScript example project |
| `check:privacy` | PASS: 249 candidate files |
| `check:secrets` | PASS: 249 candidate files |
| `check:provenance` | PASS: 249 files, 240 dependency records; no new dependency |
| `check:publication` | PASS: 249 candidate / 246 packed files |

The changed-package POM check has no applicable framework-file scope and fails
closed; it is not counted as a passing convention check. The nonzero example gate
above is the meaningful mechanical result. No convention rule/baseline was relaxed.

Focused contracts cover consumer root separation and local-only loading, explicit
configuration, paginated retrieval, shared steps and incomplete sources, parameter
preservation, safe previews, complete case/point/result mappings, all five status
translations, recovered passes, evidence tampering, stale source fingerprints,
revision conflicts, tagging/linking/automation, PR default branches, redaction,
timeouts, redirects, uncertain effects, partial receipts and output junction escape.
The transport maps a synthetic HTTPS destination to a real local HTTP fixture;
this does not prove a live tenant's permissions, process rules or TLS behavior.

The first independent review rejected the initial frozen 28-file diff
(+1313/-1231, SHA256 `7d86b1fbe59b7a2bf90ff9ac1156a8ad5017f314463262c3a07b571f69a3dcb6`).
It independently reproduced four issues and confirmed two author smoke-test
observations. All six fixes have regression coverage:

| Finding | Correction |
|---|---|
| Work-item project ownership unchecked | Resolve configured project identity; reject missing/foreign ownership for items and shared steps; validate repository project |
| Result associations could change | Preserve exact result-to-point mapping and returned case/run identities, including final readback after completion |
| Uncertain receipt lacked known item ID | Record known remote identities before dispatch, retaining them for partial or lost-response writes |
| Valid paths with spaces rejected | Accept contained relative spec paths with spaces/Unicode; retain absolute/traversal refusal |
| Remote errors mislabeled as local IO | Preserve sanitized ADO error category/status; keep local IO details redacted |
| Non-main default branch bypass | Refuse the repository's actual default branch as a PR source even with another explicit target |

Review evidence, the original defect reproductions, initial/fixed check receipts
and the finding-class ledger remain in ignored consumer/development state.
Independent re-review verified seven replay groups, including project name/GUID
variants, all 70 focused tests and the 15-file/60-rule example gate. It verified
all 249 source hashes against the corrected frozen diff
(`302ad1467d1759d4debbd3ad94bf5e4c1c98cd45a2d78d729257fa5535e4bea1`).
It then verified the sole cosmetic removal of one extra trailing blank line;
the staged whitespace check passes. This acceptance update changes documentation
only. Final document/publication checks and a final diff receipt precede delivery.

M12 acceptance covers optional/local-only operation, separate concrete adapters,
explicit configuration and consumer storage, complete verified publication,
revision-guarded linking, explicit external write execution with receipts, and
retained compatibility entrypoints with documented safety changes. No execution
core, browser/API/DB runtime, host adapter or generic workflow engine was added.

Live tenant reads/writes, permissions, service process rules and ADO Server
variants: **UNPERFORMED**. No tenant credentials or live-write authorization were
provided for M12. No ADO PR, work item or test result was created during this work.
M13 and later milestones remain unimplemented.
