# Context completeness corrective follow-up

This follow-up addresses the review of the [merged section change](https://github.com/MahmoudElSharkawy/Playwright-Harness/pull/122)
against [issue #112](https://github.com/MahmoudElSharkawy/Playwright-Harness/issues/112).
The comparison baseline is the unmodified merged commit
`53fbd77f6ca64768f350305a24c2355f38a4ce9f`.

## User-visible behavior

List-contained fenced examples no longer supply false section headings or swallow
subsequent policy sections. Multiline setext headings retain their complete title
and first-line location. Plain-text separators no longer enable Markdown fence
handling. Original text, Unicode offsets and bounded chunking are retained.

Search hits now expose `section` chunk index/count and before/after omissions.
Even when all lexical matches fit, a hit explicitly identifies an incomplete
captured contribution. Q&A checks missing support before making an exhaustive
claim, or explains its limitation when evidence or retrieval budget is insufficient.
`complete` never means whole-document or business completeness: legacy lines,
partial host receipts and redacted fragments may be complete contributions.

The native reader recipe changes narrowly from sections-v1 to sections-v2.
Existing captures remain readable before explicit refresh; unchanged-byte refresh
upgrades the native reader, preserves history and leaves host receipts and other
formats on their existing contracts. The JSON/index schema and index recipe do
not change. Metadata derives from already-loaded immutable chunk references,
without reading the rest of the section or original documents.

## Regression design

Nine new runtime tests failed against the merged baseline before implementation.
They cover the three extraction defects, standalone and list/nested/ordered fence
variants, accurate multilingual offsets, a distant exception more than five chunks
away, bounded continuation, unchanged-byte upgrade, failure recovery, unchanged
host/JSON receipts, and the limited meaning of legacy/partial contribution coverage.
The complete long-section test reconstructs the original text from returned
overlapping excerpts and verifies the exception is actually present. A separate
read audit rejects hydration of unmatched section chunks.

Three exercise-driver tests first failed before the new profile was added. A
fourth regression exposed malformed or double-encoded option arguments being
rejected before audit recording; those attempts now count inside the same budget.
The four tests
verify equal inputs and enforced budgets, failed and rejected attempts, formatting
turns with zero retrieval, retained refresh history and actual-answer records.
These are transport tests, not simulated proof of model answer quality.

## Before/after method

The existing [audited driver](../../scripts/probes/context-qa.mjs) gains an optional
`sections` profile. The original twelve-turn continuity profile remains available.
The [independent rubric](../../harness-tests/fixtures/context-qa/sections-rubric.json)
is withheld from answering agents. The eight prompts cover:

1. Gift-refund eligibility from a baseline capture before refresh.
2. The same rule after an explicitly authorized unchanged-byte refresh.
3. A formatting-only transformation with zero retrieval.
4. Ordinary/gift exchanges with a distant exception and different conditions.
5. Dispatch approval after a list-contained fenced demonstration.
6. Multiline international-return headings and plain-text warehouse notices.
7. An exhaustive checklist request with an insufficient retrieval budget.
8. The original gift deadline after an explicitly authorized change and refresh.

Both arms begin with genuine baseline captures. Only the after arm uses the new
reader on explicit refresh. Fresh model contexts answer the same prompts in two
independent repetitions per arm, with identical budgets: six retrieval calls per
factual turn, three for the checklist turn, zero for formatting, and at most 4,096
serialized output bytes per retrieval. Final revision checks count against the
budget. Errors count; rejected attempts remain in the audit and prevent a compliant
report. The runtime, transport and copied instructions are hash-bound, with identical
source hashes checked before answering. The corpus is frozen before trial outcomes.

The driver records actual answers, returned passages/citations, captured-file reads,
calls, bytes, retrieval timings and controller refreshes. Independent assessment
distinguishes supported complete, honest partial and unsupported/incorrect answers,
with separate condition coverage and citation fidelity. An honest partial answer
is safe behavior, not complete task coverage. Baseline successes remain successes;
parity is never labelled improvement.

## Validation and measurement limits

The initial consolidated corrected-environment run passed 213 tests. Independent
review then found two additional list-container cases: tab indentation and empty
list items. Both new regressions failed before repair, and all 27 extraction and
completeness tests passed afterward. The updated context scope passed 102 tests;
the final exercise-driver scope passed all four tests after argument accounting
was corrected. Together with the unchanged requirements/test-design/root checks,
216 distinct scoped tests passed across the consolidated run and focused rechecks.
The nested empty-item fixture was also corrected to use an actual nested list.

Two exploratory model attempts are preserved separately from final acceptance
evidence: one completed pair preceded the independent parser repair; another was
stopped when malformed command arguments exposed the audit gap. Neither is counted
as a final-candidate repetition. Fresh final trials use the repaired runtime and
transport, with the same frozen corpus and expected rubric.

## Final model comparison

The [recorded answers and audited passages](validation/context-completeness-model.json)
contain all 32 final answer turns from four fresh model contexts. The
[independent assessment](validation/context-completeness-assessment.json) grades
every answer against its actually retrieved or retained support, rather than
requiring a predetermined failure in the baseline.

| Repetition | Arm | Supported complete | Honest partial | Unsupported/incorrect | Retrieval calls | Output bytes |
|---|---|---:|---:|---:|---:|---:|
| 1 | Before | 6 | 2 | 0 | 23 | 33,717 |
| 1 | After | 6 | 2 | 0 | 26 | 42,869 |
| 2 | Before | 6 | 2 | 0 | 22 | 32,326 |
| 2 | After | 6 | 2 | 0 | 26 | 43,852 |

Both versions preserve supported answers and honestly qualify incomplete exchange
section/checklist coverage. The baseline model reconstructed correct heading context
in the first repetition. In the second it used a truncated international heading;
the source filename and exact lines still made the citation traceable, so the
reviewer recorded a non-material citation defect without manufacturing an answer
failure. The corrected candidate provides accurate heading metadata in both runs.

These results demonstrate answer-quality parity, not an accuracy uplift. They also
show no retrieval-cost reduction: the candidate uses 52 calls and 86,721 bytes,
versus 45 calls and 66,043 bytes before. The added metadata and guidance make missing
support explicit, but this small comparison does not isolate their individual
overhead or establish a general performance effect. The deterministic regressions
prove the corrected structure, locations, omission signals and bounded recovery of
a distant exception. The model trials separately show those signals can be used
without unsupported exhaustive claims under a fixed budget.

All four runs preserve zero retrieval for formatting, the unchanged-byte refresh,
the 21-day changed deadline and read-only captured-evidence boundaries. Runtime,
transport, instruction and corpus hashes, controller ordering, emitted bytes and
budgets were checked against the recorded evidence. Final independent code review
approved the implementation after the tab/empty-list repair and argument-audit fix.

Package syntax, JSON, links, privacy, secrets, contracts and example TypeScript
checks passed. The examples convention check reports zero new failures/warnings.
The full package suite and remote CI are separate from this scoped local validation.

## Measurement limits

Provider model identity/settings and token/cost measurements are unavailable when
the host does not expose them; those values are recorded as unavailable, never
inferred. Retrieval timing excludes model latency and repeated local trials are
not a statistical performance benchmark. Native-host and live-ADO proof are outside
this synthetic, captured-only exercise.

The first consolidated attempt placed consumer scratch folders under the source
package. Existing consumer-path guards correctly rejected that invalid environment;
the failure log is retained. Subsequent validation uses a byte-verified clean source
copy with consumer scratch outside that copy. No guard, assertion or baseline was
weakened to accommodate the environment.
