# M15 validation

Both native lifecycles and the final semantic comparison passed on 2026-10-01.
Implementation corrections, both generated candidates and the final evidence review
are independently approved with no open findings. M15 is accepted within the
Windows and linked-source scope documented below.
See [the proof guide](M15-WORKFLOW-PARITY.md) for scope and required gates.

The focused assessor tests validate synthetic records, not browser/database/host
integration. Their initial run exposed a saved-run reconstruction error before the
handoff reassessment; the implementation was corrected. Native proof results are
recorded separately below and are not inferred from unit coverage.

| Gate | Status |
| --- | --- |
| Implementation and meaningful negative assessor tests | 44 focused tests pass |
| Independent implementation review | APPROVE after corrections and final evidence reassessment; no open findings |
| Actual Claude complete lifecycle | PASS, including independent approval and owned cleanup |
| Actual Codex complete lifecycle | PASS, including independent approval and owned cleanup |
| Separate independent generated-code reviews | Both approved by separate reviewers with zero findings |
| Two scoped green native processes per host | PASS: 2/2 per host, 4 independent processes total |
| Allure 3/report attachment validation | PASS: all 4 captured and rendered reports |
| Final semantic comparison and owned cleanup | PASS: all 4 comparison stages equivalent; both hosts cleaned up |
| Package/privacy/provenance/publication checks | PASS, including final documentation inspection |

## Frozen implementation and validation

Baseline: `17f1ab1b634169ca725121683430daf60c0f636b` (accepted Allure 3 upgrade).
The reviewed implementation freeze covers 19 changed/new files. Its implementation
fingerprint is `b25704891af904034f9914b4b5f8f7531b9cce6013c6bf931bb47d671cdc8786`;
documentation is excluded from that implementation fingerprint and receives a final
evidence review. The private manifest records every file hash and the tracked diff.

The diff adds a fixed opt-in workflow proof, two test-only technical scaffolds,
native-event evidence assessment and complete semantic/report reassessment. It adds
negative assessor coverage, documentation and version metadata. Production browser,
API, database and generation contracts remain unchanged. No dependency is added.

| Actual command | Result and substantive scope |
| --- | --- |
| `npm test` | PASS: 682 tests, zero failures, skips or cancellations |
| `npm run test:workflow` | PASS: 44 focused tests, included in the full suite |
| `npm run check:workflow-conventions` | PASS: 2 supplied utility files, 2 rule applications |
| `npm run check:syntax` | PASS: 130 JavaScript files |
| `npm run check:json` | PASS: 23 files, 22 parsed records; not schema validation |
| `npm run check:links` | PASS: 104 Markdown files, 414 local links; remote links and anchors not checked |
| `npm run check:privacy` | PASS: 297 publication-candidate files |
| `npm run check:secrets` | PASS: 297 publication-candidate files |
| `npm run check:provenance` | PASS: 370 dependency records |
| `npm run check:publication` | PASS: 297 candidate files, 294 packed files |
| `npm run check:conventions` | PASS: 16 example files, 61 rule applications |
| `npm run check:generation-conventions` | PASS: 7 existing generation-fixture files, 40 rule applications |
| `npm run typecheck:examples` | PASS |
| `npm run test:fetch` | PASS: 15 existing self-checks |

No convention baseline was expanded and no rule was weakened.

The actual native probe commands were the following; machine-specific operands
are replaced with descriptive placeholders in this public record:

```sh
node scripts/probes/workflow.mjs prepare
node scripts/probes/workflow.mjs run <state> claude <claude-cli> claude-sonnet-5
node scripts/probes/workflow.mjs run <state> codex <codex-cli>
node scripts/probes/workflow.mjs assess <state>
```

The successful preparation recorded 21,986 installed entries and 12 immutable
consumer scaffolds per host. Both hosts used that same frozen package. The runs
were sequential, with Claude's complete cleanup confirmed before Codex started.

## Review corrections and preserved attempts

The independent implementation review required source refinement to be validated
and frozen **before** exploration, rather than reconstructed afterward. It also
required method documentation on the two supplied technical helpers. Both findings
were corrected and re-reviewed.

Three earlier native Claude author attempts completed real exploration and generated
type-correct, convention-clean candidates, but failed native evidence assessment:
the initial assessor rejected an explicit owned working-directory prefix, then a
native whole-file shell read, then Windows Git Bash drive spelling. Their failed
receipts remain unchanged; all three recorded owned server/database cleanup. They
never entered generated-code review or verification and are not accepted proof.

Independent re-review of the drive-spelling correction found that UNC network paths
could be confused with local drive paths. The fix preserves filesystem authority,
checks the exact owned file for both hosts, and resolves only consumer-owned skill
links. Tests reject another consumer, foreign shares, unpaired or failed commands,
incomplete content and shell additions while accepting valid native reads. The
sixth implementation review approved the corrected freeze and reproduced the UNC
negative controls independently. The earlier M2 assessor remains unchanged.

Two preparations were superseded without execution. Private failed attempts and
review artifacts are retained with restricted access. No prior failure was changed
to a pass and no reliable assertion was retried to green.

## Actual native proof

Both fresh author stages pass every native evidence requirement, including
canonical skill/source reads, all four authored files, actual command receipts,
native skill integration, owned-process shutdown and immutable package contents.
Each candidate passes 8-file / 41-application convention checks with zero findings
and TypeScript validation. A different independent reviewer examined each host's
candidate before verification. Claude's reviewer repeated the full 8-file / 41-rule
scope; Codex's reviewer checked the four authored files / 37 applications. Both
repeated type checking and verified the 24-file snapshot, all 16 source bindings,
all 29 exploration records/reports and the 16 unreviewed knowledge facts. Both
approved with zero findings; each host produced one candidate with no review repair.

Each host's exploration completed 29 cases: 20 `PASS`, 3 `FAIL`, 3 `BLOCKED` and 3
`NEEDS_REVIEW`, preserving the deliberately controlled negative cases. It recorded
74 attempts, 63 required expectations and 255 evidence artifacts. Stability is
23 stable, 4 unstable and 2 recovered outcomes.

Each host then completed two fresh sequential native verification processes. Each
passed 16 tests and 16 evaluated source assertions, with one worker and zero retries.
Each produced 15 fresh API/DB execution records, 30 runtime attempts and 131 runtime
evidence items. Allure captured 16 tests and 47 files per invocation; all four Allure 3
reports rendered successfully. The 15 runtime-backed tests' raw and rendered
JSON/HTML harness attachments matched their assessed results and remained under
the technical step. The UI test carries native browser assertion evidence.
Two required greens yielded `READY` for each host; owned native processes stopped,
both loopback servers closed, all owned disposable database containers were removed,
and installed-package and consumer-scaffold integrity remained intact.

| Per-host evidence | Claude | Codex |
| --- | --- | --- |
| Source scenarios / unreviewed knowledge facts | 16 / 16 | 16 / 16 |
| Exploration cases / attempts / required expectations / evidence items | 29 / 74 / 63 / 255 | 29 / 74 / 63 / 255 |
| Independent candidate review | APPROVE, zero findings | APPROVE, zero findings |
| Native test processes | 2, each 16/16 tests and 16 evaluated assertions | 2, each 16/16 tests and 16 evaluated assertions |
| Fresh API/DB records across both greens | 30 | 30 |
| Allure reports / JSON+HTML harness attachments across both greens | 2 / 60 | 2 / 60 |
| Readiness and owned cleanup | READY; complete | READY; complete |

The final assessment reread original native events and receipts, revalidated each
run's own evidence/report integrity, and compared notes, exploration, verification
and readiness. All four stages are equivalent. Scope is 16 original scenarios,
29 exploration cases and 15 generated API/DB operations per verification. It
compares assertion semantics, business outputs and bindings, status/stability,
failure/effect decisions, required cleanup and intentional retention. Expected
execution IDs, timestamps, durations and artifact identities are normalized only
after integrity checks. Native source/assertion meaning is independently reviewed.

Claude Code 2.1.285 used `claude-sonnet-5`; Codex CLI was 0.159.2. Both ran on Windows
with Node 24.15.0. Actual
database versions were SQL Server 16.0.4295.3 and PostgreSQL 16.14, using the pinned
fixture images. Generated tests used Playwright Test 1.63.0, Allure generator 3.19.1
and reporter/commons 3.13.0. Dependency identities and full receipts remain in the
protected proof inventory, alongside the actual review artifacts and preserved
attempt history. No credentials or raw native transcripts enter the public candidate.

This is a linked-source consumer proof against an isolated, frozen package copy
and pinned dependency links. It does not claim a clean registry installation or
the broader operating-system matrix; those remain M17 gates. The M15 native proof
runs on Windows. Earlier milestone platform results do not substitute for an
unperformed M15 run on another platform.

No M16 implementation, release tag or package publication is part of M15.
Historical credential revocation/rotation remains an owner-dependent unresolved
item; M15 does not change that status or retain historical values.
