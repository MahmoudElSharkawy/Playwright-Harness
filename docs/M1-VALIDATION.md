# M1 implementation and validation record

Date: 2026-09-29. Package version: 3.0.1 (unreleased).

**Source implementation is complete; full M1 acceptance remains BLOCKED by unresolved
historical credential revocation/rotation.** The owner explicitly did not confirm
rotation. Removal does not revoke a credential. Any credential that could still be
valid requires immediate owner revocation/rotation. Its validity was not tested.
M2 and executor implementation have not begun.

## Changes and original-state accounting

This was package maintenance, not application adoption. The input contained 79
extracted package files, a preliminary checker edit, and two additional draft research
documents: 81 workspace files in total. All are accounted for by protected pre-change
hashes. The checker edit was retained and strengthened; the research drafts were
rewritten as sanitized summaries.

The final candidate has 96 files: 43 original files changed, 38 unchanged and 15 added;
no original file is missing. The original convention baseline remains empty.

- Replaced populated review/prerequisite history with empty consumer templates.
- Removed private configuration, incidents, case identifiers and machine details;
  retained abstract lessons and synthetic examples.
- Fixed empty-scope and Git errors, warning enforcement, diagnostic disclosure,
  baseline occurrence identity and invalid verification JSON handling.
- Added detecting and accepting fixtures for all 26 registered rules and regression
  checks for CLI behavior, secrets, privacy, local links and package contents.
- Corrected example assertion reporting without changing expectations, preserved the
  valid/invalid login distinction, and fixed the documented test-selection filter.
- Declared missing direct dependencies, locked resolutions, documented Node 24,
  corrected CI failure propagation, and described existing hooks as advisory.
- Removed the ADO repository-name fallback: require an ADO origin or `--repository`.
- Applied MIT after owner rights confirmation and inventoried dependency provenance.
- Excluded installed dependencies from npm contents and compared the actual dry-run
  manifest against the independently enumerated source candidate.

## Recovery and credential handling

Pre-change material was initially protected in restricted local recovery storage.
The owner then requested that the historical credential not be retained. Review and
prerequisite history was replaced with clean templates in three retained locations:
workspace recovery entries, the embedded input ZIP and the supplied input ZIP.
All six replacement entries were verified against the clean templates.

The recovery archive uses Windows machine-bound DPAPI and restricted access. The
supplied ZIP remains EFS-encrypted with restricted access. Access inheritance is
disabled on the recovery directory and supplied ZIP. Decryption/verification passed
without restoring plaintext copies or exposing credential values. Historical hashes
describe the original input; sanitization intentionally changed the ZIP's content hash.
The removed history cannot be recovered from these sanitized copies. This is not a
claim of forensic erasure from filesystem snapshots outside this task.

No secret-bearing Git snapshot was created. Git was initialized only after source
sanitization on `chore/m1-sanitized-baseline`, following the owner's later request.
Recovery storage, local validation output, dependencies and runtime artifacts are
excluded. No remote, public repository, push, merge or release tag was created.

## Acceptance criteria

| Criterion | Status | Evidence / limit |
|---|---|---|
| Existing changes accounted for | PASS | All 81 original workspace files accounted for; none missing |
| Recovery protected and credential status explicit | PASS for containment; BLOCKED for remediation | Six sanitized entries verified; encryption/access checks passed; owner rotation unresolved |
| Publication candidate sanitized | PASS within reviewed scope | 96 files scanned, targeted identifier review, independent review; no known remaining private source material |
| Provenance and required source notices | PASS | Owner attestation, MIT, upstream references, 150 dependency records; no dependency implementation bundled |
| Meaningful checker scope | PASS | 15 files, 60 applications; all 26 rules have detecting and accepting fixtures |
| No unexplained example findings | PASS | Zero failures, warnings or baseline entries; 18 TypeScript source files checked |
| Links, dependencies and runtime claims accurate | PASS within tested scope | Local targets pass; dependencies and types checked on Windows/Node 24; broader runtime checks unperformed |
| Results distinguish passed/failed/blocked/unperformed | PASS | Detailed below; unresolved owner action remains blocking |
| No public/external delivery | PASS | Local Git only; no remote or external writes |

## Exact checks and observed results

Host: Windows, PowerShell 7.6.5, Node 24.15.0, npm 11.12.1. npm commands used the
`npm.cmd` shipped beside Node because another npm shim on this host was broken.
The machine-independent PowerShell spelling for that executable is:

```powershell
$harnessNpm = Join-Path (Split-Path (Get-Command node).Source) 'npm.cmd'
& $harnessNpm run check:syntax
```

In the table, `npm` means that executable. Commands ran from the package root.

| Command | Exit | Actual result and scope |
|---|---:|---|
| `npm install --prefix examples --ignore-scripts --no-audit --no-fund` | 0 | PASS: 122 packages installed; no install scripts or browsers downloaded |
| `npm install --package-lock-only --ignore-scripts --no-audit --no-fund --cache .validation/npm-cache` | 0 | PASS: root lockfile generated |
| `npm run check:syntax` | 0 | PASS: 13 JavaScript modules |
| `npm run check:json` | 0 | PASS: 13 JSON/JSONL files, 12 parsed records; empty history contributes zero records |
| `npm run check:conventions` | 0 | PASS: 15 files, 60 rule applications; 0 failures, warnings or legacy findings |
| `npm test` | 0 | PASS: 75 tests; 0 failed/skipped (62 convention tests, 13 package-validation tests) |
| `npm run test:fetch` | 0 | PASS: 15 existing parser/formatting self-checks; no live ADO calls |
| `npm run typecheck:examples` | 0 | PASS: 18 TypeScript source files; no emitted files |
| `npm run check:links` | 0 | PASS: 254 local links across 44 Markdown files |
| `npm run check:privacy` | 0 | PASS: 96 candidate files, including lockfiles; zero findings |
| `npm run check:secrets` | 0 | PASS: 96 candidate files; zero findings; no matched values in diagnostics |
| `npm run check:provenance` | 0 | PASS: 96 candidate files and 150 dependency records matched by path, version, license, source and integrity |
| `npm run check:publication` | 0 | PASS: 94 npm dry-run files match the 96-file source scope, excluding the root lockfile and nested npm ignore file as expected |
| `node examples/node_modules/@playwright/test/cli.js test --config examples/playwright.config.ts --list --grep 'Test Case 12345:' --reporter=list` | 0 | PASS: 1 test in 1 file; discovery only |

`test:conventions` and `test:validation` expose the same suites run by `npm test`,
not extra coverage. JSON parsing is not schema validation. Empty records do not count
as tests. The dependency inventory includes 28 optional platform packages not installed
on Windows. THIRD_PARTY_NOTICES.md records notice limitations for any future binary
redistribution; this source package does not bundle dependencies.

Negative fixtures deliberately generate rejected inputs and verify nonzero exits.
Earlier development failures were repaired and rechecked, including package bundling,
scanner bypasses, source-bearing errors and the example filter. They were not counted
as passing runs.

## Independent review

A fresh reviewer applied the framework-review skill and returned CHANGES-REQUIRED.
All six findings and one follow-up were resolved: redacted errors; short, backtick and
compound-name credentials; literal URL hosts despite dynamic paths/userinfo/ports;
private historical prose; distinct negative-login data; and accurate instructions.
The final focused independent review returned **APPROVE for the source changes**.
This does not resolve credential rotation or authorize publication.

## Blocked and unperformed work

- BLOCKED: owner revocation/rotation of any historical credential that could remain valid.
- UNPERFORMED: remote-link availability and Markdown anchor validation.
- UNPERFORMED: Linux, Claude/Codex discovery or hook certification, browser execution,
  actual API/DB requests, real SQL Server/PostgreSQL, Allure rendering and host parity.
- UNPERFORMED: new executors, canonical skill migration and every M2+ milestone.
- NOT AUTHORIZED: public repository creation, GitHub pushes, merges or releases.

Stop at M1. Later milestones require further authorization. Syntax checks, fixture
tests, typechecking and test discovery do not establish runtime integration readiness.

## Later retained-content cleanup (2026-10-01)

After reviewing the original-material inventory, the owner requested removal of
additional legacy project names and numbered change references. The tracked package
and existing Git history had no matches. The local machine-protected recovery ZIP,
its embedded input ZIP, and the supplied encrypted ZIP were sanitized in memory.
The comparison verified 242 archive entries: 33 text entries changed and 208 text
entries retained identical content; the remaining entry is the embedded ZIP whose
contents changed. Re-reading both retained archives found zero requested matches.
The recovery remains machine-protected with restricted access, and the supplied ZIP
remains encrypted with restricted access. A private checksum receipt is retained
outside Git at `.m1-private/content-redaction-receipt.json`.

The original-state accounting hashes still describe the pre-sanitization input.
This cleanup does not establish credential revocation or change the owner-dependent
public-release gate.

A further owner-requested term and its compound fixture identifier were removed from
the same retained archives. The follow-up checked 338 archive entries across the
machine-protected recovery, its embedded ZIP, and the encrypted supplied ZIP; three
changelog entries changed. The archived term has zero remaining matches, unrelated
entries retained their content, and both protection mechanisms remain in place. The
private follow-up receipt is `.m1-private/content-redaction-followup.json`.

A subsequent local Git-object audit found one unreachable historical script blob with
an owner-prohibited legacy reference. Only that blob and its two unreachable parent
trees were removed. Git integrity validation passed; 242 other unreachable objects
were preserved, and the remaining unreachable blobs had zero requested-term matches.
The previous branch history and working files were unaffected by the object cleanup.
