---
name: test-case-design
description: Design, review, create or revise source-grounded test cases for a selected story or supplied requirements, reuse suitable existing cases, and optionally publish an approved proposal to Azure DevOps. Use for test-case design, not test execution, automation generation or direct edits to already selected case text.
---

# Test case design

Resolve this linked skill to its real package path. Read [ROOTS.md](../ROOTS.md)
and the [workflow, formats and example](../../../docs/test-case-design.md).
The host designs and independently reviews; deterministic commands validate,
render, persist and deliver. Consumer state belongs under
`.harness/state/test-case-design/`. The canonical skill name is `test-case-design`.

## Establish accepted scope

Resolve the selected story/local requirements, project/application, relevant saved
context and prior design/requirements IDs from available conversation and project
information. Bundle only essential missing choices. Use an existing #62 requirements
inventory where available; otherwise capture the accepted sources through
`test-case-design prepare`. Local design never needs ADO access. Use `requirements
inventory` to partition compound source statements, preserving IDs across reordering,
and record actual acceptance evidence. Never invent an owner decision merely to
make publication possible. Captured headings and setup introductions can remain
unknown structural context; the independent assessment can classify non-obligation
slices as `context` without inventing an owner ruling or a coverage gap. Preserve
actual description obligations and unresolved business decisions. Use shared capture
and acceptance only for case design; do not invoke requirements analysis or produce
a general gap audit unless requested. Ask only for missing/conflicting setup, inputs,
expectations or verification needed by affected cases, and continue supported work.
After inventory acceptance or partition edits, run design `prepare` again with the
same analysis ID and selected context/case scope to bind the current acceptance head,
then save the proposal using the newly returned source fingerprint.

When an accepted [testing plan](../test-planning/SKILL.md) is supplied, reuse its
compatible version, selected scope, priorities and risk/criterion links as context.
Planning is not required and plan approval does not accept missing expectations,
create extra cases or change the case fields and review/publication gates below.

Read current description, acceptance criteria, relevant discussion/history and
linked cases. New stories may have no linked cases. Captured history identifies
superseded statements; it does not revive them. Retrieve related business evidence
narrowly within authorized scope, using direct links as leads. Consider applicable
rules, terminology, realistic setup/data and reusable cases from the selected
captured project context. Missing optional context, conventions or existing cases
alone is no blocker; mention only material limitations. Do not invoke context-qa,
refresh/build context, download unselected
attachments or expand neighboring regression scope. Captures with older broad
attachment ingestion need explicit reselection.

Use the captured reference diagnostics and [reference workflow](../../../docs/test-case-design.md#referenced-rules-and-provenance).
Classify each direct reference as required, supporting, incidental or unresolved;
keep every originating occurrence and affected selected-story inventory entry.
Choose exact relevant rule passages, resolve deeper required evidence only through
explicit supplemental selection, and reuse current owner decisions bound to the
reference identity/revision/content through the existing acceptance workflow.
Retrieval and classification never accept rules. Conflicts, unavailable rules and
unresolved delegation remain affected gaps; unrelated valid cases can proceed.
Relevant reference changes need affected revalidation and renewed approval even
when the selected story is unchanged. Never backfill accepted historical captures.

Reuse existing settings and selected reviewed context before the optional
[conventions profile](../../../docs/test-case-design.md#optional-agreed-conventions).
Accepted requirements and current authorized choices override defaults. Missing,
stale or conflicting profiles permit supported design. Conventions cannot invent
credentials, fixtures, expectations or locale coverage; preserve case/run ownership.

Accepted selected-story description/criteria and explicitly selected supplemental
requirements accepted through a real owner decision authorize main-case outcomes.
Comments, conventions and neighboring stories can clarify or support optional
drafts; they do not automatically accept rules. Resolve contradictions, missing decisions and
unaccepted assumptions before delivering affected cases. Empty values, spaces and
special characters do not automatically imply rejection.

## Consider optional quality suggestions

Use the [quality considerations](../../../docs/test-case-design.md#quality-considerations)
as internal prompts across the existing eight test types. Judge relevance from
behavior, platform, scope, dependencies, affected workflows and risk; absence from
acceptance criteria alone does not make an area irrelevant. Match depth to risk,
complexity and impact. Reference adequate reusable coverage within authorized scope.
Select only material concerns not already covered; no category quotas, forced
combinations, placeholder cases or routine full-checklist/N/A matrix.

Accepted in-scope quality requirements belong in the main proposal with normal
source/step/data/expectation mappings. Missing evidence or decisions needed for
accepted behavior remain affected requirement gaps. Missing context for an optional
suggestion does not block otherwise valid cases or alter required-coverage totals.
Clearly highlight material security or data-loss risks without expanding scope.
Distinguish explicit requirements, applicable documented standards/design systems/
agreed targets, quality risks and assumptions; a retrieved reference alone accepts
no new behavior and requests no cases.

Draft a small relevant set of optional cases on the first pass, without waiting for
a separate request to design suggestions. Save ordinary case content, actual source
basis and specific unresolved questions in `optionalDrafts`; see the documented
schema. Use supported inputs and observable expectations. Where an outcome, target
or environment is missing, retain the proposed check and specific decision needed;
never invent an executable expectation. Consolidate overlap; zero drafts is valid.
Optional IDs and counts stay separate from main cases. They earn no accepted
coverage and cannot enter publication or execution/automation handoffs.

### FR-4: Promote only requested, supported suggestions

Promote optional drafts into main scope only when the user selects them and their
scope and observable expectations are supported through the accepted-source workflow.
Selection can also confirm the clearly presented expectations in one message. Keep
that choice across turns and resolve only remaining essential decisions; do not
request another design turn or redundant confirmation. Approving the main proposal
does not select optional drafts or settle unspecified rules or targets.

Before saving an affected case, capture any agreed addition through the existing
authorized source-update/inventory acceptance process and prepare again against
that accepted source. Bind normal mappings to actual inventory identities, steps,
data and expectations; never invent IDs, messages, rejection behavior, thresholds,
environments or compliance obligations, or automatically edit remote story fields.
Follow the [promotion recipe](../../../docs/test-case-design.md#user-controlled-promotion)
to reuse saved draft content after preparing the accepted addition. Move only selected,
supported drafts into main cases with genuine mappings and preparation; retain all
unselected drafts. Refresh counts, the current file and affected independent review.
Publication and execution authorizations remain separate.

## Design and independently evaluate

Choose Create, Update, Reuse unchanged or no-change from actual differences and
coverage. Preserve real ADO IDs; new cases retain stable `NEW-...` IDs until the
server assigns one. Reuse suitable cases without copies or cosmetic rewrites.
Keep one coherent objective and executable path per case. Use meaningful partitions,
boundaries, decisions and state transitions where accepted behavior needs them.
Consolidate overlap while retaining meaningful role/input/state/integration/outcome
differences. No category or count quotas. Use consumer setup/data conventions and
per-case/per-run ownership; include necessary cleanup in the actual ordered steps.

Case content is exactly ID, title, prerequisites, test data, coverage references,
test type, scenario type and ordered action/observable-expectation pairs. Proposed
action is a review control. Choose one test type: Functional, Accessibility,
Compatibility, UIUX, Security, Performance, Responsiveness or Localization; choose
Positive or Negative. Nonfunctional cases require accepted conditions, environments
and measurable targets in these ordinary fields. Missing workloads, thresholds or
compliance decisions for accepted requirements remain gaps; optional concerns follow
[FR-4](#fr-4-promote-only-requested-supported-suggestions). Classification authorizes
no execution. Apply positive, negative, boundary and failure variations where
meaningful within the existing fields.

Map every accepted in-scope criterion and testable description requirement to actual
verifying steps, exact expectations and test data. One criterion may need several
cases; one case may verify related criteria. Partition multi-part criteria before
claiming completeness. Missing branches and unresolved decisions remain explicit.
Expected results distinguish wrong-user/wrong-record/no-op outcomes. Cleanup is
not the final business outcome. The overview derives its final result from the last
mapped verification, so map business verification rather than cleanup as coverage.

After saving the complete proposal, dispatch a fresh independent reviewer with the
raw selected sources, inventory, context, existing cases and complete main/optional
draft content, source basis and questions, not only the chat summary. Ask it to
refute source grounding, every rule/condition/branch/outcome, independence, meaningful
expectations and completeness. Save its actual per-case and per-requirement evidence
with `assess`; include a separate verdict/reason for every optional draft. Optional
review does not accept additional scope. An author-filled reviewer name, schema pass or matching reference is
not evidence of independent review. Fix findings and revalidate edited content.
Record residual gaps after edits, selection and delivery. Never equate publication,
approval or valid unchanged cases with passing execution.

Ask the reviewer: “Can another agent identify the actor, starting state, target,
inputs, action, observable outcome and necessary cleanup without inventing business
information?” Name ambiguous cases/steps for source-backed clarification or revision;
selectors and login bindings remain downstream refinement work. Retain the actual
host run reference and complete reviewer output using the
[assessment evidence contract](../../../docs/test-case-design.md#proposal-and-independent-assessment).
Missing/stale output cannot pass the enhanced gate; names and hashes alone do not
prove independence. Review every exact-content duplicate warning and record retain
or revise with a reason. Consolidate only through explicit edits preserving all
verifying mappings and real published IDs. Keep these concise diagnostics outside
the unchanged case tables. Review or conventions never promote optional suggestions
without both conditions in FR-4.

## Show the agreed chat review

Use `--format compact` for routine commands. Default JSON remains available for
complete source/case reads and independent review. Reuse returned state/bindings;
use `assess --notes <review-notes-json> --format compact` for a final assessment
with notes, without a routine second `read --notes`. Batch independent reads, reuse
unchanged instructions and avoid repeated polling or model-driven formatting.

Display the returned chat summary: test-type counts, then Positive/Negative counts,
then the main-case overview with exactly **Case | Action | Title | Prerequisites |
Final expected results | Coverage reference | Test type | Scenario type**.
Both count tables have separate Main cases and Optional drafts columns and zero
rows; the test-type table includes all eight types and separate totals. These are
two classifications of the same cases, not additive totals. Zero is not itself a gap.
Follow with optional titles/counts, material decisions/limitations and one current
file link. Do not repeat detailed step tables in chat unless explicitly requested.

The complete review is `.harness/runs/test-case-design/<design-id>/review.md`,
refreshed atomically after review, edits, assessment and reads. Link `reviewFile.path`
only when status is `written` and the host can deliver it. Explain that it shows the
current version. Failed generation/delivery gets a concise limitation, no stale link
or automatic full-chat dump; detailed reads remain available on request. Preserve
legacy files and immutable technical history internally. See the
[Markdown copy workflow](../../../docs/test-case-design.md#markdown-review-copy).

Use readable criterion descriptions or source labels/excerpts in both views.
Keep real story/case IDs and stable temporary selection IDs, with internal mappings,
revision/approval hashes and recovery evidence out of the human review. Do not
replace arbitrary IDs in literal source text or test data. Optional content, source
basis and review feedback persist with the design; `--notes` is only supplemental
advisory prose, never the storage for drafts or acceptance.

In the Markdown file, display every main and optional case completely in one table
with three bold section banners:
case details (ID, Title, Coverage reference, Test type, Scenario type); setup
(Prerequisites and Test data); complete numbered steps (action and expected result).
Continue long tables. Never replace steps with summaries, split a case into adjacent
tables, nest tables or add a separate final-result row. Do not add Priority, Review
status, Execution layer, risk-rationale, Technique, Basis, Counterexample or other
case-data fields. Internal mappings are not a mandatory chat coverage matrix.

Support approve all, selected IDs, reject and revise. Explain material update diffs,
shared-case impacts, unresolved gaps and publication choices briefly outside tables.
Use `reject` to invalidate an unattempted preview; retain its draft/history. Save edits
against the current head and repeat affected review. Partial approval preserves the
unapproved cases and gaps.

## Optional ADO publication

Resolve destination field metadata only when preview/publication is requested;
missing delivery values never block ordinary design. Support existing standard and
custom Test Case fields. Use `ado.testCases.fields` as creation defaults and
`preview --fields <consumer-json>` for reviewed per-case choices; see the
[publication input](../../../docs/test-case-design.md#preview-approve-publish-and-recover).
Per-case values override creation defaults. Updates preserve unspecified fields;
Reuse unchanged with a material field change requires a reviewed Update. Bundle
unresolved mandatory writable choices into one focused question.

Required read-only/server-managed metadata alone is not a publication blocker.
Reject attempted assignments to those fields. Use supported AreaPath/IterationPath
values or verified server defaults and let ADO derive internal IDs. Local metadata
cannot prove hidden rules, identity or path validity; retain server validate-only
checks. Explain missing input, local adapter limits and actual server rejection
distinctly. Populating an existing custom field is supported; creating new field
definitions or changing the ADO process requires a separate explicit request.

When requested, generate `preview --format compact` for selected main-case IDs.
Show the summary and full current Markdown link, exact native changes, destination
and shared-case effects. Show per-case additional
field values and differences from `fieldPreview`, including verified server defaults,
outside the case tables, alongside the destination and selected cases. Outside the case tables,
show each combined Preparation action and its observable readiness expectation;
these are part of approval, never hidden implementation metadata. Usually one step
combines the reviewed Prerequisites and Test data. If distinct setup actions each
need independent verification, resolve their ordering/readiness explicitly before
delivery rather than inventing a readiness result. Missing setup/data remains a
decision. Keep secret references; never publish actual external credentials.

Obtain one consolidated approval for this complete unchanged preview. Reuse already
given authorization when it covers exactly this content, selection, operations and
destination. Changed content, relevant source/case revisions, field values/schema,
destination or missing acceptance requires affected revalidation and renewed approval.
Use only `publish`
with its exact fingerprint; do not bypass it with direct ADO writes.

Native Title receives the title. Description receives the selected-story coverage
block while retaining unrelated content. Two separate tags use the exact test/scenario
values, preserving unrelated tags. Native steps begin with combined Preparation and
its readiness check, followed by all reviewed business steps; update reconciles
existing preparation and preserves stable step IDs. Sequence position is consecutive.
No duplicate setup in Description or chat steps, separate final result or chat-only
columns. Resolve missing/invalid writable values and genuine process or permission
failures before publication; do not silently omit requested fields or invent values.
New cases link to the approved story atomically. Native History carries the previewed
operation marker needed for unambiguous recovery.

On partial/interrupted delivery, `reconcile` reads exact native history, fields and
story links against durable request fingerprints. Never identify by title, blindly
retry, recreate uncertain cases or repeat confirmed writes. Resume only remaining
authorized work using the same approval. Retain returned IDs/URLs, failed/pending/
uncertain outcomes and immutable receipts. Use real ADO IDs in subsequent proposals.

## Handoff

Use `handoff` to write validated local scenarios and adjacent source/impact mappings
for [automate-test](../automate-test/SKILL.md); published ADO cases use existing
story/suite [execute-test](../execute-test/SKILL.md) intake. Preserve setup, explicit
inputs/variations, every ordered action/expectation and necessary cleanup. Accepted revisions affecting existing
automation go to [maintain-test](../maintain-test/SKILL.md). Preserve failure history,
cumulative repair budgets, independent review and two fresh scoped green runs.
Handoff/publication does not set tracker completion or claim repaired automation.
Wider source impacts belong to the change-impact workflow when available; report
them without adding neighboring tests to this design.
