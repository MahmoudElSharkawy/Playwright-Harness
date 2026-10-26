# Context sections and surrounding evidence: issue 112

Recorded 2026-10-26 on Windows, Node 24.15.0 and npm 11.12.1. The comparison
baseline is commit `bb68533` (4.2.0), whose context scripts and Q&A instructions
were exported unchanged from Git. This record covers synthetic runtime and model
evidence, not authenticated native-host invocation, live ADO or Linux behavior.

## Delivered contract

Native Markdown retains located sections and heading ancestry; text retains
paragraphs. Original text, line endings, lists, tables, fenced content and source
order survive capture. Existing chunking bounds long sections. Character offsets
refer to the decoded original; original byte offsets are supplied for UTF-8 inputs,
including BOM, CRLF, Arabic and supplementary Unicode. Other encodings expose
character offsets without claiming original UTF-8 byte coordinates. Heading labels
are bounded with an ellipsis when shortened; their full text remains captured.
Headings are provenance metadata and do not create shared business topics.

`search --around <passageId> --source <sourceId> --revision <capture-revision>`
retrieves a bounded source-order window. Before/after default to 2 and accept 0–5
each. Item/topic filters remain strict; byte limits, result limits, cursors and
outside-window/filter omissions are explicit. Every returned passage resolves
against immutable captured source/fact/chunk objects. Q&A retains the existing
identity check, same-revision support reuse, explicit-only invocation and
zero-retrieval transformation path.

The JSON layout, SQLite schema and business index recipe remain unchanged.
Pre-enhancement captures remain readable/searchable before refresh. Only explicit
refresh upgrades selected native Markdown/text recipes, including unchanged bytes.
Unaffected formats and host-reader receipts preserve their contracts. History,
source selections, owner notes, stale support and atomic publication remain in
place. Regrouping changes evidence IDs/counts/ranking without implying changed
business requirements; refreshed citations bind to the new capture revision.

## Deterministic verification

The first focused run against the pre-change runtime produced 7 failures and 1
pass, exposing absent section grouping, document offsets, surrounding retrieval,
CLI options and targeted reader invalidation. The first consolidated context run
passed 75/80: three failures encoded the old line-per-fact fixtures, one assumed a
25-result page despite the byte budget, and one found that section-level redaction
discarded adjacent safe text. The fixtures now use explicit paragraph boundaries,
assert complete text round trips and verify every bounded result page. Credential
lines are isolated before redaction, preserving safe text and original offsets.

Independent review raised leading blank preambles and indented code followed by
a setext-like underline. A new regression failed before the fix. Capture now
preserves the preamble and does not invent heading ancestry from indented code.
The final section and audited-Q&A scope passed 22/22, including consumer-bound
cursors for identical copied captures, unavailable legacy originals, host receipts,
UTF-16 character spans, safe redaction and failed upgrade/publication recovery.
Additional red-first checks cover 140,000 paragraphs (bounded partial extraction
instead of argument overflow), malformed byte-span receipts and Unicode-safe
truncation of heading labels. The final parser was also checked against every
actual model-fixture contribution; their captured content and locations match.

The first full source-copy run passed 1,523/1,603 and failed 80. It exposed a real
shared-reader regression: requirements inventories need independent located lines.
Requirements capture now explicitly retains its original line-reader contract for
files and attachments; business-context capture receives sections. The unchanged
requirements and test-case-design tests plus section tests then passed 118/118.
Other failures showed the documented user-Temp dangling-junction limitation,
shared Playwright transform-cache permissions and unavailable native process
inspection. A fresh D: scratch location passed the live/dangling junction probe
and cleanup; focused elevated checks recovered 71/72, with the sole remaining
failure identifying the source copy's missing Git marker. Initializing Git only
in that disposable source copy resolved that check without changing its assertion.

The original checkout has a preexisting ignored protected ChaosEngine overlay;
package inventory checks cannot read it. Validation therefore uses a clean copy
of all tracked/new source files, verifying every copied byte hash, with installed
dependencies copied separately. No package validator, baseline, test assertion or
local overlay was weakened to bypass the environmental limitations.

The independent fresh-context framework review returned APPROVE with no findings;
its blocker follow-up also approved the requirements-reader compatibility fix.
It also graded both actual-model arms 12/12 for factual support, citations,
uncertainty and conversational continuity.

The fixed package run passed all 13 non-suite checks: syntax, JSON, links,
privacy, secrets, provenance, publication, contracts, example/generation/workflow
conventions, strict external-consumer types and ADO-fetch self-tests. Example
TypeScript also passed directly. On D:, the full suite exceeded the existing
900-second limit after 1,040 completed top-level tests with no reported failure;
that interrupted attempt is not passing-suite evidence. Windows Temp restored
normal runtime and passed 1,606/1,607, with the remaining pinned-CLI test correctly
rejecting an output path under the Windows system directory.

A fresh ordinary C: workspace scratch folder passed dangling-junction inspection,
the exact pinned native resolver and the transport prerequisite. With that folder
and native process-inspection permission, the unchanged fixed package checklist
passed **14/14**, including **1,607/1,607 tests**, zero failures, skips or
cancellations. The final related context/requirements/test-design scope passed
**191/191** separately. The budget, test assertions and validators remain unchanged.
Final documentation was synchronized to the byte-verified source copy and checked
again after recording these results. Authenticated native-host/live-ADO proof and
other platforms were not exercised by this local validation.

## Actual model-answer comparison

Two independent fresh-context model agents answered the same 12 prompts using
the old and new Q&A instructions respectively. They received no expected answers.
The new arm started with an actual old-reader capture and explicitly upgraded it
without changing the document bytes. Both arms performed controller-authorized
unchanged and changed refreshes before turns 8 and 9. The model-facing transport
called the corresponding real context API under a read audit that prohibited
original-file reads, writes, network access and subprocesses during Q&A. Audit
logging occurred outside that read-only boundary.

[The recorded comparison](validation/context-sections-112-model.json) contains
every actual answer, citation, returned supporting passage, audited captured-file
read and per-turn retrieval measurement. Answers covered gift eligibility and its
exception, processing order, missing cryptocurrency support, conflicting retention
rules, stale office evidence, partial courier coverage, embedded instructions,
refresh continuity, a context switch and recovery after lost retained support.
The new arm exercised surrounding retrieval for processing support. Both arms
preserved the gift referent as the deadline changed from 14 to 21 days; the other
context used 7 days.

| Measurement | Before | After |
|---|---:|---:|
| Actual answer turns | 12 | 12 |
| Read calls | 18 | 19 |
| Search calls | 14 | 13 |
| Total retrieval calls | 32 | 32 |
| Tool-output bytes, including newlines | 38,202 | 38,784 |
| Audited API retrieval time | 763.48 ms | 568.24 ms |
| Formatting-only retrieval, turns 3 and 10 | 0 | 0 |
| Initial native capture | 553.06 ms | 368.54 ms |
| Unchanged refresh | 514.99 ms | 345.17 ms |
| Explicit unchanged-byte native-reader upgrade | not applicable | 437.21 ms |
| Provider model tokens/cost | unavailable | unavailable |

These are individual local observations, not a statistical benchmark. Output bytes
measure read/search JSON plus its newline, excluding host-tool framing. Retrieval
timings exclude model latency. Initial current-reader capture was measured in a
separate identical synthetic consumer; the upgraded arm was initially captured
with the old reader. The old arm front-loaded broader support that it later reused;
the new arm fetched processing support later. This run shows no overall reduction
in retrieval calls or output bytes. Bytes/calls/timings are not measured model-token
or cost savings. Native-host invocation and live integrations were not exercised.

Reproduce with `node scripts/probes/context-qa.mjs prepare <new-external-directory>
<unmodified-baseline-package>`, the returned prompts/instructions and audited
`query`/`control` commands. Record the actual answers and run `report` as documented
in [the Q&A guide](../context-qa.md#upgrade-and-proof). Independently assess answer
claims and citations against the recorded evidence; a runtime test or keyword
match alone does not establish answer quality.
