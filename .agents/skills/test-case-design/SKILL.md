---
name: test-case-design
description: Design, review, create or revise source-grounded test cases for a selected story or supplied requirements, reuse suitable existing cases, and optionally publish an approved proposal to Azure, Xray or Zephyr Scale, or keep local cases without a plugin. Use for test-case design, not test execution or automation generation.
---

# Test case design

Use the shared [tracker provider contract](../../../docs/tracker-providers.md) for
Azure, Jira with Xray or Zephyr Scale, and Jira without a plugin. Keep the same
workflow and gates; select native adapters and preserve the captured source identity.

Resolve [required native case fields](../../../docs/tracker-providers.md#required-native-case-fields)
before publication approval. Use `nativeFields` in the same reviewed case proposal;
Xray discovers Jira metadata, while Zephyr needs the complete reviewed project
field schema. Never infer missing definitions or silently rely on tenant defaults.

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
`test-case-design prepare`. Local design never needs remote access. Use `requirements
inventory` to partition compound source statements, preserving IDs across reordering,
and record actual acceptance evidence. Never invent an owner decision merely to
make publication possible. Captured headings and setup introductions can remain
unknown structural context; distinguish them from unresolved business decisions in
assessment reasons instead of inventing an owner ruling.
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
captured project context. Missing/stale context permits useful supported design;
disclose the gap. Do not invoke context-qa, refresh/build context, download unselected
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

Only accepted selected-story description/criteria authorize expected outcomes.
Comments, conventions and neighboring stories can clarify or expose gaps; they do
not automatically accept rules. Resolve contradictions, missing decisions and
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

When useful, place a short optional suggestions section outside the case tables.
Put material concerns first, consolidate overlaps and explain selection once in a
short footer. Each suggestion identifies the affected behavior/risk, proposed check
and any missing scope, rule, standard or observable expected-result decision.
Omit clearly irrelevant areas; flag material uncertainty instead of guessing.
Zero suggestions is valid. Suggestions have no case IDs, case counts or accepted
coverage credit, and never enter publication or execution/automation handoffs.

### FR-4: Promote only requested, supported suggestions

Create suggestion-derived cases only when the user explicitly requests the selected
cases **and** their scope and observable expected results are agreed, documented and
supported through the existing accepted-source workflow. Neither condition alone
is enough. Reviewing suggestions, confirming relevance, supplying targets or
approving the original proposal does not request extra cases. A clear selection
such as “Create cases for responsiveness and accessibility” is sufficient as the
request; keep it across turns and resolve only remaining essential decisions,
reusing agreed context without repeated confirmation. One message may satisfy both
conditions. Generic approval cannot settle an unspecified business rule or target.

Before saving an affected case, capture any agreed addition through the existing
authorized source-update/inventory acceptance process and prepare again against
that accepted source. Bind normal mappings to actual inventory identities, steps,
data and expectations; never invent IDs, messages, rejection behavior, thresholds,
environments or compliance obligations, or automatically edit remote story fields.
Add only requested, supported cases to the ordinary proposal and independent review;
leave unselected or unresolved suggestions advisory. Refresh normal counts and full
rendering. Existing publication and execution authorizations remain separate.

## Design and independently evaluate

Choose Create, Update, Reuse unchanged or no-change from actual differences and
coverage. Preserve captured native IDs, including opaque Jira/plugin keys; new cases retain stable `NEW-...` IDs until the
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
raw selected sources, inventory, context, existing cases and proposal. Ask it to
refute source grounding, every rule/condition/branch/outcome, independence, meaningful
expectations and completeness. Save its actual per-case and per-requirement evidence
with `assess`; an author-filled reviewer name, schema pass or matching reference is
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

Every complete `review`, `edit`, `assess` or `read` returns `rendered.markdown`
and a derived Markdown copy under the consumer's `.harness/runs/test-case-design/`.
Display that full Markdown in chat and provide one link to the current
`reviewFile.path` through the host's existing local-file/attachment facility, only
when `reviewFile.status` is `written` and the host can deliver it. Use the new
returned path after revisions; never substitute an earlier copy.

When adding user-facing gaps or optional suggestions, put the same Markdown in a
consumer JSON file with optional `gaps` and `suggestions` strings and run
`read --id <design> --notes <review-notes-json>` for the final view. The notes stay
outside the unchanged case tables and never become cases, acceptance or coverage
credit. Omit unused sections. Reuse this notes file explicitly on subsequent
reviews when still relevant; it is not part of saved proposal state.

The copy identifies the design/story, existing proposal/state revision and actual
recorded review/delivery status. It does not approve or publish cases or establish
execution readiness. If file creation or host delivery fails, still display the
full chat review and explain the file-specific limitation; provide no success link
or download claim. See the [Markdown copy workflow](../../../docs/test-case-design.md#markdown-review-copy).

Display the renderer's summary first: distinct-case total, all eight test-type
counts including zeros, and both scenario counts. Then the overview containing
every case with exactly ID, Proposed action, Title, Prerequisites, Final expected
results, Coverage reference, Test type and Scenario type.

Display every case completely in one table with three bold section dividers:
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

## Optional publication

When requested, generate `preview` for selected IDs. Show the complete proposal and
exact native changes, destination and shared-case effects. Outside the case tables,
show each combined Preparation action and its observable readiness expectation;
these are part of approval, never hidden implementation metadata. Usually one step
combines the reviewed Prerequisites and Test data. If distinct setup actions each
need independent verification, resolve their ordering/readiness explicitly before
delivery rather than inventing a readiness result. Missing setup/data remains a
decision. Keep secret references; never publish actual external credentials.

Obtain one consolidated approval for this complete unchanged preview. Reuse already
given authorization when it covers exactly this content, selection, operations and
destination. Changed content, relevant source/case revisions, destination or missing
acceptance requires affected revalidation and renewed approval. Use only `publish`
with its exact fingerprint; do not bypass it with direct provider writes.

For Azure, native Title receives the title. Description receives the selected-story coverage
block while retaining unrelated content. Two separate tags use the exact test/scenario
values, preserving unrelated tags. Native steps begin with combined Preparation and
its readiness check, followed by all reviewed business steps; update reconciles
existing preparation and preserves stable step IDs. Sequence position is consecutive.
No duplicate setup in Description or chat steps, separate final result or chat-only
columns. Required unavailable/read-only fields, tag permissions or custom process
requirements are explicit publication gaps; never drop fields or create custom ones.
New cases link to the approved story atomically. Native History carries the previewed
operation marker needed for unambiguous recovery.

For Jira, use the selected Xray or Zephyr Scale adapter through this same pipeline.
Preview native steps, labels, owned recovery marker and exact story link. Preserve
opaque keys and source-qualified references. Without a plugin, keep approved cases
local with Jira story links; publication does not create remote test entities.

On partial/interrupted delivery, `reconcile` reads exact native history, fields and
story links against durable request fingerprints. Never identify by title, blindly
retry, recreate uncertain cases or repeat confirmed writes. Resume only remaining
authorized work using the same approval. Retain returned IDs/URLs, failed/pending/
uncertain outcomes and immutable receipts. Use returned native IDs in subsequent proposals.
Reconcile stays read-only unless `--execute --approval <original-fingerprint>` is
explicit. That continuation may finish only missing native steps/coverage links
whose readback and receipts prove no dispatch or rejection without execution.
Never retry an unknown dispatched effect.

## Handoff

Use `handoff` to write validated local scenarios and adjacent source/impact mappings
for [automate-test](../automate-test/SKILL.md) or local
[execute-test](../execute-test/SKILL.md) intake; published native cases use the
selected provider's story/group intake. Preserve setup, explicit
inputs/variations, every ordered action/expectation and necessary cleanup. Accepted revisions affecting existing
automation go to [maintain-test](../maintain-test/SKILL.md). Preserve failure history,
cumulative repair budgets, independent review and two fresh scoped green runs.
Handoff/publication does not set tracker completion or claim repaired automation.
Wider source impacts belong to the change-impact workflow when available; report
them without adding neighboring tests to this design.
