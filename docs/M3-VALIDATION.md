# M3 validation record

Date: 2026-09-30. Package: 3.0.3. Scope: M3 only, on the continuing
`harness/development` branch. M4 and executor implementation have not started.

## Changes and acceptance

| M3 criterion | Result and evidence |
|---|---|
| One canonical skill library | All 13 skills maintained in `.agents/skills`; legacy Markdown redirects preserve old references. No maintained host copies. |
| Preserve consumer work | Adoption preflights conflicts, merges instructions/ignore rules, preserves host settings/configuration/app code/imports, and refuses customized skill replacement. Repeat application is idempotent. |
| Consumer-state separation | Review, prerequisite, tracker and hook state use consumer storage; legacy state migration records source fingerprints. Package/output escapes, including Windows junction cases, are rejected. |
| Local source without ADO | Neutral scenarios preserve actions, expectations and optional references; empty/malformed scope fails. Loader records exact source-byte fingerprint and never reports execution. |
| Explicit environment onboarding | Test/protected/custom selection is deliberate; targets and secret references are separate. Unknown environments, targets and configuration fields fail. No credentials are resolved. |
| Host discovery and reference resolution | Native Codex and Claude each discovered all 13 skills from the same isolated installed package. Six representative locator decisions passed on each host with actual reference reads and semantic parity. |
| Immutable imports and installed package | Synthetic adoption fixtures preserve imported files and framework code. Both host processes left the complete 145-file proof snapshot unchanged. |
| Independent review | APPROVE after two review/fix passes; no remaining blocking findings. |

M3 adds configuration and input loading, not browser/API/DB execution policy or
runtimes. Legacy ADO changes are limited to consumer-root selection and containment;
no live ADO operation was performed. Hooks remain optional and advisory.

## Repeatable validation

Commands below ran from the package directory with Node 24.15.0 on Windows. `npm`
refers to the installed npm command. Results cover real nonzero scope.

| Command | Outcome | Measured scope |
|---|---|---|
| `npm test` | PASS | 118 tests, 0 failures, 0 skipped |
| `npm run check:syntax` | PASS | 26 JavaScript modules |
| `npm run check:json` | PASS | 16 files, 15 parsed records; one empty history template |
| `npm run check:links` | PASS | 78 Markdown files, 313 local links; remote URLs and anchors not checked |
| `npm run check:conventions` | PASS | 15 example files, 60 rule applications, 0 FAIL, 0 WARN, 0 legacy findings |
| `npm run test:fetch` | PASS | 15 offline parser/renderer assertions |
| `npm run typecheck:examples` | PASS | Example TypeScript project; no browser/database execution |
| `node examples/node_modules/@playwright/test/cli.js test --config examples/playwright.config.ts --list` | PASS | 3 tests in 2 files; listing only |
| `npm run check:privacy` | PASS | 146 publication-candidate files, 0 findings |
| `npm run check:secrets` | PASS | 146 publication-candidate files, 0 findings |
| `npm run check:provenance` | PASS | 146 candidate files, 150 dependency-license records; no new runtime dependency |
| `npm run check:publication` | PASS | 146 candidate files, 144 packed files; offline dry run, no upload |

Test allocation after the final fixture: 62 convention tests, 13 package-validation
checks, 7 root tests, 14 proof-assessment tests, 15 adoption tests and 7 local-source
tests. Synthetic host events validate assessor false-pass prevention; they do not
replace the native host proof below. JSON parsing is not schema validation; project
configuration and local scenarios have separate structural validators.

The changed-POM mechanical command did not complete: this maintenance change has
zero POM scope and the consolidated branch has no default main/master base. This is
not reported as a passing diff check. The explicit nonzero example check passed;
no convention baseline was weakened or expanded.

## Native host and skill proof

All 13 canonical skill folders passed the skill-creator `quick_validate.py` check.
Native `claude plugin validate .` passed with two explained warnings: optional author
metadata is omitted, and root CLAUDE.md is a consumer instruction template rather
than plugin-injected context. The canonical skills carry shared instructions.

The proof used native Codex 0.158.0-alpha.2.1 and native Claude Code 2.1.285, with
Claude's previously proven available `claude-sonnet-5` model override. The override
was attempt-local; host settings were not changed. Authentication and native logs
remain in ignored local storage, not the public source.

Reproduction interface:

```sh
node scripts/prove-skill.mjs prepare-library
node scripts/prove-skill.mjs discover <state-file> <codex-executable>
node scripts/prove-skill.mjs codex <state-file> <codex-executable>
node scripts/prove-skill.mjs claude <state-file> <claude-executable> <available-model>
node scripts/prove-skill.mjs assess <state-file>
```

| Native requirement | Codex | Claude |
|---|---|---|
| All canonical skills registered | 13/13 | 13/13 |
| Representative locator cases evaluated | 6/6 | 6/6 |
| Actual canonical skill, reference and fixture reads | PASS | PASS |
| Successful process and host turn | PASS | PASS |
| Installed snapshot unchanged | 145/145 files | 145/145 files |
| Semantic decision parity | PASS | PASS |

The tested references are canonical sibling paths. Expected wording, field-name and
native diagnostic differences do not establish semantic disagreement. This is native
library discovery plus representative instruction behavior, not behavioral coverage
of every skill or full execution/generation/review/verification parity. Linux native
behavior is unperformed. The later ignore-order fix and documentation clarifications
do not change the six locator rules.

## Review, recovery and outstanding gates

The first independent review found four classes: a hook ledger leaf escape, installed
ADO package-root use, incomplete consumer secret ignores, and stale parallel/knowledge
promotion instructions. Fixes were applied with targeted regression checks. Re-review
also found an existing `.env.example` exception could be overridden by a new broad
ignore; its ordered merge now has real Git ignore and idempotence coverage.

Final independent re-review: **APPROVE**, with no remaining blocking findings.
The reviewer inspected code/docs and reran the affected tests; native-host outcomes
were separately assessed from actual host evidence, not independently rerun by the reviewer.

Existing M1/M2 commits and user changes remain accounted for. Legacy non-Markdown
tracker assets moved into canonical immutable assets. Old mutable source records in
consumer migration fixtures are retained and conflicts never overwrite newer state.
Ignored proof snapshots are synthetic test artifacts; no secret-bearing recovery
archive or credential value was copied into Git.

Historical credential revocation/rotation remains unresolved, as the owner explicitly
reported. The historical value remains removed. M1 protected recovery storage and
owner-cleared provenance are unchanged. MIT does not grant publication authorization.
No push, remote creation, public repository, merge, release tag or publication occurred.

M4, browser/API/DB integration, live ADO writes, complete lifecycle parity and parallel
execution remain unperformed and outside this milestone's authorization.
