# Test case design

Use the discoverable `test-case-design` skill to design cases from a selected story
or supplied requirements, review them in chat and optionally publish an explicitly
approved selection to Azure DevOps. Local design requires no ADO credentials.
The agent performs design and semantic review; scripts own schemas, rendering,
snapshots, approval binding and durable delivery. No external design engine runs.

## Prepare the selected evidence

Run commands from the consumer with `npx --no pom-harness test-case-design ...`.
Canonical scripts also accept `--project-root <consumer>` when invoked directly.
Use the existing [requirements inventory](requirements-analysis.md), including its
acceptance evidence and stable IDs. A design selection has this shape:

```json
{
  "version": 1,
  "analysisId": "sign-in",
  "request": {
    "version": 1,
    "project": "Example",
    "application": "portal",
    "storyId": 1234,
    "sources": [],
    "attachmentIds": []
  },
  "caseIds": [5678],
  "context": {"id": "portal-business", "query": "Arabic sign in"}
}
```

`request` is optional when reusing an existing requirements analysis. For local
requirements omit `storyId` and use selected file sources, for example
`{"id":"story","kind":"file","path":"requirements/sign-in.md"}`. `caseIds`
adds explicitly selected existing cases to the story's Tested By cases; no linked
cases is valid. `context` is optional; it selects a narrow read of captured business
context, with optional `sourceId` or `workItemId`. It never builds or refreshes context.
Missing or incompatible context remains an explicit gap. Related story links are
returned as leads, not automatically fetched or added to scope.

```sh
npx --no pom-harness test-case-design prepare --id sign-in --input design-source.json
npx --no pom-harness requirements read --id sign-in
```

ADO preparation captures current description, criteria, paginated discussion and
relevant history (at most 1,000 revisions), plus selected attachments only. Inspect
omissions and superseded statements. Reused older captures containing attachments
need explicit reselection. When reusing an analysis, retain its original selected
sources; refresh changed evidence through requirements before approving new cases.
Only source criteria or an actual recorded owner decision can mark requirements
accepted. Comments and context never silently accept rules. Partition compound
criteria into exact inventory slices before review; reordering retains identities
while changed snapshots invalidate prior acceptance evidence.

For example, save inventory decisions with the current returned snapshot, IDs and
revision values, copying the exact full criterion slice into `quote`:

```json
{
  "version": 1,
  "snapshot": "<current snapshot>",
  "changes": [
    {
      "id": "<criterion requirement ID>",
      "disposition": "accepted",
      "evidence": [{"kind": "source", "partId": "<criterion part ID>", "revision": "<current part revision>", "quote": "<exact criterion slice>"}]
    },
    {"id": "<unresolved requirement ID>", "disposition": "needs-decision", "evidence": []}
  ]
}
```

Apply it with `npx --no pom-harness requirements inventory --id sign-in --input
inventory-decisions.json`. Even unresolved entries require `evidence: []`. The
source-evidence form accepts only criteria; description and discussion decisions
need actual recorded owner evidence under the requirements inventory contract.

After accepting or partitioning inventory entries, run design `prepare` again with
`{"version":1,"analysisId":"sign-in"}` to bind that updated acceptance head before
saving the proposal. Include the same selected context/case IDs when applicable.

## Proposal and independent assessment

Save a version-1 JSON proposal with `author`, returned `source` fingerprint,
`cases`, `mappings` and `preparations`. Edits additionally require the current
design `head`. Cases contain exactly:

```json
{
  "id": "NEW-01",
  "proposedAction": "Create",
  "title": "Sign in with valid credentials",
  "prerequisites": "A dedicated active account exists; the user is signed out.",
  "testData": "Account username and valid password from env:TEST_PASSWORD.",
  "coverageReferences": [{"requirementId": "AC-1", "label": "AC-1: Successful sign-in"}],
  "testType": "Functional",
  "scenarioType": "Positive",
  "steps": [
    {"action": "Open the sign-in page", "expected": "The sign-in form is displayed."},
    {"action": "Enter valid credentials and select Sign in", "expected": "The current user dashboard opens and displays the correct account identity."}
  ]
}
```

Use actual inventory IDs, never invented `AC-1` labels as authority. Labels are
readable references; internal IDs preserve traceability. New IDs begin `NEW-`;
existing IDs are numeric strings with action Update or Reuse unchanged. A case
already created must use its returned ADO ID in later proposals. Unsupported extra
case fields are rejected. Exactly one of the eight test types and one of Positive /
Negative is required. A zero-case proposal is valid but does not imply complete
coverage.

Each internal mapping has `caseId`, `requirementId` and nonempty `checks`, where
each check carries the 1-based business `step`, its exact `expected` text and the
case's exact `data` text. Every coverage reference needs a mapping. Actual semantic
coverage remains an independent review duty: references and copied expectations
alone never establish it. Each internal preparation contains `caseId` and an
observable `expected` readiness result. It is shown outside case tables during
publication approval. Normally one combined preparation is used. For genuinely
distinct setup actions requiring separate verification, use `caseId`, `reason`
and `steps` (2–20 action/expected pairs) instead of `expected`; the native first
step retains the labeled reviewed setup and later preparation steps follow in order.

```sh
npx --no pom-harness test-case-design review --id sign-in --input proposal.json
npx --no pom-harness test-case-design edit --id sign-in --input revised-proposal.json
npx --no pom-harness test-case-design assess --id sign-in --input assessment.json
npx --no pom-harness test-case-design read --id sign-in
```

The independent reviewer receives the raw selected evidence, full case content
and mappings, not an intended verdict. Its version-1 assessment binds `proposal`
to the saved proposal fingerprint and names `reviewer`. Its `cases` contains every
case's `id`, `verdict` (pass or revise) and evidence-backed `reason`. Its
`requirements` contains every description/criterion inventory entry's `id`,
`verdict` (covered, gap or unresolved), `reason` and supporting `caseIds`. A covered
entry must be accepted, have actual mapped verifying checks and pass independent
case review. List all cases needed collectively for that requirement; selection
that removes a required branch exposes a gap. The host must conduct actual fresh
independent review; different actor names and JSON hashes cannot prove independence.

Review all accepted conditions, branches, boundaries and outcomes, including
requirements stated only in the description. Keep assumptions and missing targets
unresolved. Captured headings and setup introductions may be unknown structural
context; explain that distinction in assessment reasons instead of presenting them
as missing business decisions or inventing owner acceptance.
Reject weak wrong-user/wrong-record/no-op expectations, filler cases and
unsupported nonfunctional targets. There is no mandatory user-facing coverage matrix
or extra per-case metadata. `coverage.complete` is limited to assessed current
source evidence; it never describes execution. Missing or inaccessible evidence
prevents a completeness claim.

## Agreed chat rendering

Show `rendered.markdown` in chat. It starts with the distinct-case total, counts
for both scenario types and all eight test types, including zeros. The overview
contains every case. The final expected result is derived from the last mapped
business verification; it is not a separately maintained case field or cleanup result.

**Total cases: 1 · Positive: 1 · Negative: 0**

| Test type | Total |
|---|---:|
| Functional | 1 |
| Accessibility | 0 |
| Compatibility | 0 |
| UIUX | 0 |
| Security | 0 |
| Performance | 0 |
| Responsiveness | 0 |
| Localization | 0 |

| ID | Proposed action | Title | Prerequisites | Final expected results | Coverage reference | Test type | Scenario type |
|---|---|---|---|---|---|---|---|
| NEW-01 | Create | Sign in with valid credentials | Active dedicated account; signed out | The current user dashboard opens and displays the correct account identity | AC-1: Successful sign-in | Functional | Positive |

| **1. CASE DETAILS** | | | | |
|---|---|---|---|---|
| **ID** | **Title** | **Coverage reference** | **Test type** | **Scenario type** |
| NEW-01 | Sign in with valid credentials | AC-1: Successful sign-in | Functional | Positive |
| **2. SETUP** | | | | |
| **Prerequisites** | Active dedicated account exists; signed out | | | |
| **Test data** | Account username; valid password from env:TEST_PASSWORD | | | |
| **3. STEPS** | **Step action** | **Step expected result** | | |
| **1** | Open the sign-in page | The sign-in form is displayed | | |
| **2** | Enter valid credentials and select Sign in | The current user dashboard opens and displays the correct account identity | | |

Display every full case with this single-table structure, continuing long cases.
No extra final-result row, review status, priority, execution layer, technique,
counterexample, risk block, nested tables or step-summary substitution is supported.

## Preview, approve, publish and recover

```sh
npx --no pom-harness test-case-design preview --id sign-in --selected NEW-01,5678
npx --no pom-harness test-case-design publish --id sign-in --approval <preview-fingerprint>
npx --no pom-harness test-case-design reject --id sign-in
npx --no pom-harness test-case-design reconcile --id sign-in
```

Omit `--selected` to preview all cases. The saved preview binds full reviewed
content, selected IDs, native operations, accepted source revisions, independent
assessment and configured destination. Show the exact native differences, shared
case impacts and preparation readiness outside the agreed tables, then obtain one
consolidated approval. Reject retains draft/history and invalidates unattempted
approval. Edits, requirement decisions, destination/source/case changes or missing
capabilities require revalidation and renewed approval. Unselected cases and residual
gaps remain saved. Publication can deliver valid selected cases even when unrelated
requirements remain unresolved.

Native publication maps title to Title; coverage reference to a marked story-specific
Description block (keeping unrelated existing content); exact test/scenario values
to separate tags (keeping unrelated tags); and preparation plus business actions/
expectations to native Steps XML. Example first step action:

> Preparation<br>Prerequisites: Confirm an active dedicated account exists and the user is signed out.<br>Test data: Account username and valid password from the approved secret reference.

Its reviewed expected result might be “The account is active, its credentials are
available, and no authenticated session exists.” This checks readiness, not the final
test result or an assumed pass. Native sequence positions run from 1; updates retain
existing stable XML IDs and reconcile preparation instead of prepending duplicates.
Shared/parameterized/unsupported XML is an explicit publication gap. It is never
flattened into a lossy update.

The adapter checks configured project/category, field availability/writability,
tag visibility and validate-only process/permission results. Validation requests
do not publish cases. Custom mandatory fields requiring user data are explicit
gaps, never invented defaults. Creation includes the approved Tested By relation
atomically. Updates preserve relationships and native history. A previewed History
entry records the stable operation marker; it adds no custom fields or extra tags.

Immutable previews persist before dispatch. Per-case ordered intent, request
fingerprints, returned IDs/URLs, and pending/applied/unchanged/failed/uncertain states
stay in consumer records and existing integration receipts. A lost acknowledgement
is reconciled against exact operation marker, expected history revision, full native
fields and story relation, never title matching. Unknown/mismatched results remain
uncertain. Repeated invocation never recreates confirmed cases or replays uncertain
writes. After reconciliation, reuse the same approved `publish` command to perform
only remaining authorized work. Do not bypass failed recovery by editing receipts.

## Handoff and ownership

```sh
npx --no pom-harness test-case-design handoff --id sign-in --selected NEW-01
```

The handoff writes an ordinary validated local scenario source under
`.harness/sources/test-case-design/` and adjacent source/coverage/impact references.
Its mapping check numbers address the emitted source steps, including preparation;
the saved proposal keeps its original business-step numbers.
Use existing [execution](manual-execution.md) and [automation](PIPELINE.md) intake.
Confirmed ADO IDs become external references; proposed cases never receive invented
numeric identities. Accepted revisions affecting existing automation belong to
[maintain-test](maintenance.md). Preserve failure history, cumulative repair budgets,
independent review and two fresh scoped green runs. Publication/handoff cannot mark
execution passing, automation repaired or tracker complete. Report wider impacts
separately without expanding selected-story scope.

Canonical skills/scripts/docs remain package-owned. Source snapshots, acceptance
records, proposals, approvals, recovery and handoffs are consumer-owned. State is
immutable and content-bound with a current pointer; interrupted locks require
inspection, never automatic deletion. Tests use synthetic HTTP destinations; they
do not prove live ADO permissions or authorize real publication.
