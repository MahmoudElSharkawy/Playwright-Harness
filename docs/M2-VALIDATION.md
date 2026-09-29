# M2 validation record

Status as of 2026-09-30: **INCOMPLETE — Claude behavior proof is blocked by model
availability at the configured service.** M3 is not authorized by this record.
No executor or bulk skill migration is included.

## Scope and current evidence

- One canonical `element-locators` skill and playbook, with thin legacy redirects.
- Claude plugin manifest pointing directly to the canonical skills directory.
- Separate package, consumer and run roots; seven root/ownership tests pass.
- Twelve assessment tests pass, including missing evidence and false-pass cases.
- Native Codex discovery and the six-case behavior proof passed on Windows using
  `codex-cli 0.158.0-alpha.2.1`. Native tools read the canonical skill, both required
  references and the synthetic fixture. All package files remained unchanged.
- Claude Code `2.1.285` loaded the plugin and registered its namespaced skill. Two
  corrected behavior attempts received repeated HTTP 503 responses. The last error
  reported no available channel for the selected model. Authentication is available,
  but this does not prove a successful authenticated model turn.
  Plugin registration is not reported as behavior success or host parity.

Earlier setup attempts are retained in ignored consumer evidence: one omitted the
Windows Codex sandbox setting; one Claude restricted-mode attempt excluded the user
settings supplying authentication. Their failures have not been converted into passes.
The corrected launch preserves read-only behavior; see [the proof guide](M2-SKILL-PROOF.md).

The Codex proof checked a snapshot of 103 files; the later Claude retry checked 107.
Both snapshots contain the identical canonical skill. All files in each snapshot
remained unchanged. The preparatory code and report additions account for the
different snapshot sizes. Local evidence, including failed attempts, remains ignored
under `.validation/m2`; it is not copied into the publication candidate.

## Validation commands and outcomes

Commands below ran on Windows with Node 24.15.0. The 94 unit tests are synthetic
checks of conventions, validators, root handling and proof assessment. They are not
browser/database execution tests. The final focused independent review approved the
source changes after the correction described below.

| Command | Outcome and actual scope |
|---|---|
| `npm run check:syntax` | PASS — 18 JavaScript files |
| `npm run check:json` | PASS — 15 files, 14 parsed records; not schema validation |
| `npm run check:links` | PASS — 266 local links in 48 Markdown files; anchors/remote links not checked |
| `npm run check:conventions` | PASS — 15 files, 60 rule applications; 0 new FAIL/WARN, 0 legacy |
| `npm run test:conventions` | PASS — 62 tests |
| `npm run test:validation` | PASS — 13 tests |
| `npm run test:roots` | PASS — 7 tests |
| `npm run test:skill-proof` | PASS — 12 tests |
| `npm run test:fetch` | PASS — 15 existing self-checks |
| `npm run typecheck:examples` | PASS — 18 example TypeScript files; no runtime execution |
| `npm run check:privacy` | PASS — 107 candidate files |
| `npm run check:secrets` | PASS — 107 candidate files, redacted diagnostics |
| `npm run check:provenance` | PASS — 107 candidate files; 150 dependency records |
| `npm run check:publication` | PASS — 105 npm-packed files; no dependencies, recovery material or proof logs bundled |
| `claude plugin validate .` | PASS with two explained warnings below |
| Skill creator `quick_validate.py .agents/skills/element-locators` | PASS — one canonical skill |
| `node scripts/prove-skill.mjs discover <state>` | PASS — exactly one enabled native Codex match, canonical real path |
| `node scripts/prove-skill.mjs codex <state>` and assessment | PASS — 6/6 cases plus actual skill/reference/fixture reads |
| `node scripts/prove-skill.mjs claude <state> <native-executable>` | BLOCKED — plugin loaded; service model unavailable, no completed behavior proof |
| `node scripts/prove-skill.mjs assess <state>` | INCOMPLETE, nonzero exit — no false cross-host pass |

Native plugin validation warns that the optional author field is absent and that root
`CLAUDE.md` is not injected as plugin context. No personal author identity is invented;
the project template remains available for legacy adoption, while the plugin uses its
canonical skill for instructions. These are explained packaging warnings, not ignored
convention findings. `--changed` correctly rejects the empty application-code scope
of this M2 diff; it is not reported as a passing zero-file check.

## Remaining acceptance gates

Claude must finish the same six cases with successful canonical skill/reference reads,
and both hosts must pass semantic comparison. Independent source review passed. Linux
host execution and full workflow parity were not performed; neither is claimed by
this representative Windows proof. No M3 migration, external delivery or publication
has occurred. The Git branch is `chore/m2-skill-proof`; the source checkpoint does not
claim M2 acceptance and is not authorization to start M3.

## Independent review and correction

The fresh reviewer first returned CHANGES-REQUIRED: class `native-skill-proof-unproven`
in `scripts/lib/skill-proof-assessment.mjs`. Claude registration and reference reads
could pass without evidence that the canonical skill itself had been consumed.
The assessor now requires a successful native read of the canonical `SKILL.md` for
both hosts. The proof prompt explicitly requests it, and a negative fixture proves
that registration, references and a correct answer cannot substitute for that read.

The focused re-review returned **APPROVE for the source changes**, with 12/12 assessment
tests passing and no remaining source findings. This generic package-maintenance
finding is recorded here; the empty consumer review-ledger template remains empty.
The reviewer did not certify the unavailable Claude behavior run or full M2 acceptance.

The historical credential revocation/rotation status from M1 remains unresolved.
The credential value is not retained in source or publication material. M2 does not
resolve that owner-dependent security item or authorize external publication.
