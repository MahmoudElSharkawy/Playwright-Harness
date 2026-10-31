# Test case design

Use the discoverable `test-case-design` skill to design cases from a selected story
or supplied requirements, review them in chat and optionally publish an explicitly
approved selection to Azure DevOps. Local design requires no ADO credentials.
Chat shows counts, the eight-column case overview, optional titles and material
decisions, with one link to the complete current Markdown. The agent performs design and semantic review; scripts own schemas, rendering,
snapshots, approval binding and durable delivery. No external design engine runs.

## Prepare the selected evidence

Run commands from the consumer with `npx --no pom-harness test-case-design ...`.
Canonical scripts also accept `--project-root <consumer>` when invoked directly.
Use the existing [requirements inventory](requirements-analysis.md), including its
acceptance evidence and stable IDs, only as needed for selected cases. This does not
invoke a requirements-analysis skill or general gap audit. Ask only for decisions
needed to specify setup, data, expected behavior or verification. A design selection has this shape:

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
Missing optional context, conventions or existing cases alone is not a blocker;
report only material limitations. Related story links are
returned as leads, not automatically fetched or added to scope.

```sh
npx --no pom-harness test-case-design prepare --id sign-in --input design-source.json --format compact
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

## Referenced rules and provenance

New captures retain visible hyperlink text and destination separately, with field,
revision and occurrence offsets. Literal encoded markup stays literal and entities
decode once. Secret-bearing destinations are redacted; malformed, unsupported and
out-of-scope links are diagnostics, never arbitrary fetch routes. Historical captures
remain unchanged. An older ADO capture without link metadata requires an explicit
source refresh before claiming complete reference coverage.

Preparation discovers explicit `#1180` tokens, hyperlinks and verified work-item
relationships. Ordinary numbers are not IDs. Repeated verified destinations share a
read and retain all occurrences. Inline references initially need classification;
relationships alone are incidental and cause no fetch or coverage gap. Classify the
returned stable reference IDs as `required`, `supporting`, `incidental` or `unresolved`:

```json
{
  "version": 1,
  "analysisId": "postcode",
  "references": [{
    "id": "<returned reference ID>",
    "classification": "required",
    "requirementIds": ["<affected selected-story inventory ID>"],
    "reason": "The selected story delegates postcode validation.",
    "rules": [{"location": "Microsoft.VSTS.Common.AcceptanceCriteria", "quote": "<exact relevant captured rule>"}]
  }]
}
```

Use `unresolved` with a reason for conflicting, superseded or ambiguous applicability;
never use `supporting` to hide a required decision. Keep every affected inventory entry
on required/unresolved references. Rules must quote exact located captured passages.
Read only direct references and explicitly selected `referenceIds` (at most 20 IDs),
with at most 20 unique target reads per preparation. Deeper dependencies are exposed
without recursive fetching; select a necessary deeper item explicitly. Cycles and
exhausted bounds remain visible. Fetching a reference downloads no attachments,
refreshes no context and adds no neighboring regression scope.

Accepting “apply #1180” does not accept unseen rules. Reuse actual owner acceptance
through the existing requirements inventory. The existing owner-decision JSON may
include `references: [{"id":"<reference ID>","revision":"<revision>",
"content":"<returned reference content fingerprint>"}]`, alongside its ordinary
consumer/snapshot/requirement/content/disposition/actor/statement bindings. Record
only a real decision; use the returned reference fingerprint after selecting relevant
rules. Submit that decision through `requirements inventory`, then prepare again with
the same reference selection. A current matching decision is reused without another
confirmation. Referenced rules support the selected story's inventory; fetching a
reference never adds a primary requirement. An explicitly selected supplemental
source accepted through an actual owner decision can extend scope using the
[promotion recipe](#user-controlled-promotion).

Required or unresolved delegated evidence keeps affected requirements incomplete and
blocks affected cases. Supported unrelated cases can still be reviewed and published.
Selection, edits and reconciliation recalculate these gaps. Relevant referenced
revisions and retained acceptance are checked before delivery even if the story is
unchanged. Refresh, revalidate and renew approval after a change; earlier previews and
receipts remain immutable. Reconciliation preserves confirmed writes while reporting
stale referenced coverage separately.

## Optional agreed conventions

Reuse existing project settings and selected reviewed business context first. If agreed
business defaults have no existing home, optionally save
`.harness/knowledge/test-case-design-conventions.json`:

```json
{
  "version": 1,
  "project": "Example",
  "application": "checkout",
  "status": "current",
  "agreement": {"actor": "Project owner", "reference": "Retained agreement reference"},
  "defaults": {
    "persona": "Customer",
    "terminology": {"basket": "cart"},
    "titleConvention": "Describe the observable business objective",
    "setupOwnership": "Use disposable case-owned setup",
    "dataOwnership": "Keep per-case and per-run identity; use secret references",
    "languages": ["English", "Arabic"]
  }
}
```

All defaults are optional. Current authorized choices and accepted requirements govern;
existing compatible settings/context take precedence over this fallback. Do not copy
credentials or runtime targets into it, infer available fixtures, invent expectations,
or create locale cases merely because languages are listed. Mark stale/conflicting
agreements `stale` or `conflicting`; do not silently merge contradictory prose.
Absent, malformed, foreign or stale profiles are advisory diagnostics and permit useful
supported design. No mandatory setup or extra approval is introduced. Bound profile
changes require affected revalidation. Applicable documented conventions can support
first-pass optional drafts; selecting them into main scope still requires accepted
expectations under FR-4.

## Quality considerations

Use these as internal prompts under the canonical skill's
[quality guidance and FR-4](../.agents/skills/test-case-design/SKILL.md#consider-optional-quality-suggestions),
not mandatory cases or an additional review form. For affected UI, normally consider
responsiveness, accessibility and visual/usability risks. Select concerns in proportion
to the feature's behavior, platform, dependencies and impact, including material
uncertainty; do not treat absence from acceptance criteria as evidence of irrelevance.

- **General:** UI/visual consistency; UX/usability; responsive/adaptive layouts;
  accessibility; browser/OS/device compatibility; input validation and edge cases;
  application states/feedback; authentication/authorization; security/privacy;
  performance/scalability; reliability/error recovery; data integrity/concurrency;
  integrations; localization/RTL; end-to-end journeys/regression impact.
- **Accessibility, where applicable:** keyboard/focus behavior, screen-reader
  semantics and feedback, contrast, text resizing/reflow, touch targets and non-text
  alternatives, guided by the changed feature and agreed target. These are examples,
  not an exhaustive checklist or assumed compliance obligation.
- **Native/cross-platform mobile, where relevant:** OS conventions; shared versus
  platform-specific behavior; mobile layouts/input/accessibility; lifecycle and
  interruptions; connectivity/offline behavior; permissions/device integrations;
  installation, updates and device resources. A website may still have mobile-browser
  input, layout and network risks; native lifecycle or installation prompts do not
  imply native-app scope or offline support.

Keep accepted required coverage authoritative, reference adequate reusable cases in
scope and leave additional concerns advisory. Do not assume empty or special-character
inputs must be rejected, infer thresholds, or expand into neighboring workflows.
Draft useful optional cases on the first pass, retaining supported details and exact
questions where expectations are missing. Zero drafts is valid. No routine 22-area or N/A
matrix. An explicitly requested applicability assessment can explain feature-specific
exclusions. The checkout example below demonstrates selection and promotion without
adding a second workflow or bypassing source acceptance.

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

The proposal may also contain `optionalDrafts`. Each uses the ordinary case fields
above, a unique stable `NEW-...` ID and `proposedAction: "Create"`, but has
`coverageReferences: []`, plus:

```json
{
  "sourceBasis": [{"kind": "source", "id": "<captured part ID>", "label": "Description — country selector", "excerpt": "<exact captured passage>"}],
  "questions": ["Which keyboard focus order is expected for the country selector?"]
}
```

Use actual captured `source` part IDs, selected `context` passage IDs, `reference`
IDs or the usable `convention` profile path. Excerpts must match that evidence;
labels remain readable. Use `questions: []` when no decision is missing. A proposed
step may omit `expected` only with a specific question; never supply a guessed
executable outcome. Optional drafts have no main mappings or preparation approvals.
Their content and basis persist with the proposal, independently of `--notes`, and
are excluded from main coverage, publication selection and handoffs. Absence of
`optionalDrafts` means none, preserving existing saved proposals.

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
npx --no pom-harness test-case-design review --id sign-in --input proposal.json --format compact
npx --no pom-harness test-case-design edit --id sign-in --input revised-proposal.json --format compact
npx --no pom-harness test-case-design assess --id sign-in --input assessment.json --notes review-notes.json --format compact
npx --no pom-harness test-case-design read --id sign-in
```

Use the returned compact view directly; do not follow `assess --notes` with a routine
second read. Omit notes when unnecessary. Default output (or `--format json`) remains
the complete JSON for source inspection, independent review and debugging. Compact
output returns summary, counts, status, actionable diagnostics, paths and necessary
command bindings without full state or duplicate case renderings. Save and assess
reuse their returned state for rendering; current-state checks remain enforced.

The independent reviewer receives the raw selected evidence, full main/optional case
content, source basis, questions and mappings, not an intended verdict or only a chat
summary. Its version-1 assessment binds `proposal`
to the saved proposal fingerprint and names `reviewer`. Its `cases` contains every
case's `id`, `verdict` (pass or revise) and evidence-backed `reason`. Its
`requirements` contains every description/criterion inventory entry's `id`,
`verdict` (covered, gap, unresolved or context), `reason` and supporting `caseIds`. A covered
entry must be accepted, have actual mapped verifying checks and pass independent
case review. List all cases needed collectively for that requirement; selection
that removes a required branch exposes a gap. The host must conduct actual fresh
independent review; different actor names and JSON hashes cannot prove independence.

Use `context` only for an unknown, unmapped slice without a testable obligation,
owner evidence or unresolved business questions, with an independent reason and
empty `caseIds`. It cannot discard accepted requirements or unresolved business
decisions. Partition mixed narrative/obligations first. Narrative alone
does not require owner acceptance or make required coverage incomplete. When the
proposal has optional drafts, assessment must include every one in `optionalDrafts`
as `{id, verdict: "supported" | "needs-decision" | "revise", reason}`. The same array
must appear in retained reviewer output. A supported optional draft needs complete
expectations and no unresolved questions; its review never accepts it into scope.

The reviewer must ask: “Can another agent identify the actor, starting state, target,
inputs, action, observable outcome and necessary cleanup without inventing business
information?” Mark an ambiguous case/step `revise`, name the missing information,
and correct it from source-backed clarification before re-review. Selectors and login
bindings remain downstream refinement details, not invented case requirements.

Retain the actual host review run and its output. Add
`evidence: {"host":"<host>","runId":"<actual run reference>","source":"<source fingerprint>",
"output":{"path":"<consumer-relative JSON export>","sha256":"<SHA-256 of exported bytes>"}}`
to the assessment. The exported JSON contains `version: 1`, that `host`, `runId`,
`source`, `proposal`, `reviewer`, the actual `cases`, `requirements`, `duplicates`
arrays, and `clarityQuestion` containing the exact question above. The arrays must
match the assessment, including findings and dispositions. Use the host's actual
export/storage facilities; never manufacture an identifier or output to pass a gate.
These references make the review auditable; the CLI verifies retention and bindings,
not the authenticity of an independent actor or the quality of semantic judgment.

`assess` sanitizes the export and retains an immutable copy under the design's
`reviews/` directory. Preview, handoff and each pending publication check that copy.
Missing/stale evidence is a limitation, not a completed enhanced review. Older
records and uncertain-write reconciliation remain readable; they are never silently
upgraded into enhanced review evidence. Edited proposals need a newly bound review.

The `duplicates` diagnostic compares exact prerequisites, test data and ordered
action/expectation content, ignoring IDs and titles. It includes captured existing
cases when their native preparation can be interpreted without guessing. Preparation outcomes, split setup,
roles, languages, data, states and outcomes remain meaningful differences. Every
warning needs an assessment entry `{id, verdict: "retain" | "revise", reason}`;
use `[]` when there are none. A `revise` decision withholds affected delivery until
the proposal is corrected and reviewed. Consolidation is an explicit edit: retain
all verifying coverage mappings and real ADO identities, then recalculate totals.
Never delete, merge or renumber published cases automatically. Equal titles alone
are not a duplicate test.

Review all accepted conditions, branches, boundaries and outcomes, including
requirements stated only in the description. Keep assumptions and missing targets
unresolved. Captured headings and setup introductions may be unknown structural
context; record that distinction with the `context` verdict instead of presenting them
as missing business decisions or inventing owner acceptance.
Reject weak wrong-user/wrong-record/no-op expectations, filler cases and
unsupported nonfunctional targets. There is no mandatory user-facing coverage matrix
or extra per-case metadata. `coverage.complete` is limited to assessed current
source evidence; it never describes execution. Missing evidence needed to verify an
actual obligation prevents a completeness claim; absent optional context alone does not.

## Agreed chat rendering

Show the compact result's `summary` (or detailed result's `rendered.chatSummary`).
It starts with separate main/optional totals, the eight-type count table, then the
Positive/Negative table, including zero rows, before the exact eight-column main-case
overview. The tables classify the same cases; their totals are not additive and a
zero does not itself indicate a gap. Final expected results come from the last
mapped business verification, never cleanup or a separately invented field. Follow
with optional draft titles/counts, material decisions/limitations, recorded status
and one [current Markdown](#markdown-review-copy) link. Do not repeat detailed step
tables in chat unless requested. Real story/case IDs and temporary selection IDs
remain visible; structured references use established labels with descriptions or
source labels/excerpts. Internal IDs and revision/approval hashes stay in state and
command bindings. Literal source/test data is never globally rewritten.

**1 main case · 0 optional drafts**

| Test type | Main cases | Optional drafts |
|---|---:|---:|
| Functional | 1 | 0 |
| Accessibility | 0 | 0 |
| Compatibility | 0 | 0 |
| UIUX | 0 | 0 |
| Security | 0 | 0 |
| Performance | 0 | 0 |
| Responsiveness | 0 | 0 |
| Localization | 0 | 0 |
| **Total** | **1** | **0** |

| Scenario type | Main cases | Optional drafts |
|---|---:|---:|
| Positive | 1 | 0 |
| Negative | 0 | 0 |

| Case | Action | Title | Prerequisites | Final expected results | Coverage reference | Test type | Scenario type |
|---|---|---|---|---|---|---|---|
| NEW-01 | Create | Sign in with valid credentials | Active dedicated account; signed out | The current user dashboard opens and displays the correct account identity | AC-1: Successful sign-in | Functional | Positive |

**Full details:** Current Markdown review (a working file link in a real run).

The Markdown contains complete main and optional cases in this format; chat includes
them only when explicitly requested:

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

Display every full case in Markdown with this single-table structure, continuing long cases.
No extra final-result row, review status, priority, execution layer, technique,
counterexample, risk block, nested tables or step-summary substitution is supported.

### Markdown review copy

`review`, `edit`, `assess` and `read` automatically write the exact returned
`rendered.markdown` bytes to the consumer-owned
`.harness/runs/test-case-design/<design-id>/review.md`. The existing renderer
still owns the summary, overview and every complete case table. Review identity,
recorded independent-review verdict counts, retained-evidence status, material case decisions,
duplicate decisions and recorded delivery outcomes appear separately after the
tables. A local design does not need an ADO story ID.

The file identifies the story/design and readable review/delivery status, without
technical revision hashes. It always shows the current version. Edits, assessment
and reads atomically refresh the same path; a stale state cannot overwrite a newer
current review. Legacy hash-named Markdown files remain untouched; no new hash
copies are generated. Immutable internal records, mappings, evidence, approval
bindings and recovery receipts remain unchanged. Neither writing nor sharing a
copy accepts requirements, approves cases, publishes them or establishes execution
readiness. Approval fingerprints and execution/automation handoffs are unchanged.

If the host adds relevant gaps, conventions/reference clarification or optional
suggestions to the review, supply exactly those notes as Markdown strings in an
optional consumer JSON file (maximum 64 KiB):

```json
{
  "gaps": "The fixture owner still needs confirmation; supported cases remain available.",
  "suggestions": "- Keyboard focus is an optional draft; its expected focus order still needs a decision."
}
```

```bash
npx --no pom-harness test-case-design assess --id sign-in --input assessment.json --notes review-notes.json --format compact
```

`--notes` also works with `review`, `edit` and `assess`. Omit unused keys or the
entire option. These notes are advisory output, not proposal fields or saved
acceptance; pass them explicitly on later reviews only while still relevant. Use
readable descriptions, never internal IDs or revision hashes in this prose. Saved
optional drafts and their independent feedback survive plain reads and restarts
without these notes. Keep only case-relevant clarification in `gaps` (the legacy
input key); do not turn it into a general requirements audit.
Secret references remain references; credential-like literals are rejected.

Show the summary, then one **Markdown review** link
using the host's existing local-file/attachment facility and the absolute
`reviewFile.path`. Only `reviewFile.status: "written"` reports a created copy.
If the host cannot expose that file, report the delivery limitation rather than
claiming a successful download. File or notes failures return
`reviewFile.status: "unavailable"` and a reason without a path. Report the limitation
without a success/stale link or automatic full-chat dump; saved details remain
available via an explicitly requested detailed read/chat fallback.

### Checkout example

Illustrative requirements and data only; these are not live project evidence or executed tests. This example preserves the current main-proposal format and shows the optional addition separately. AC/BR labels below are readable sample references; real proposals retain their actual inventory identities and verifying-step mappings.

#### Supplied story and accepted requirements

**Edit the delivery address during checkout.** A signed-in shopper can edit their cart's delivery address. The change introduces a two-column form, a custom country selector, and an external address-lookup service.

- **AC-1:** Saving a populated address updates the checkout summary and persists after reload.
- **AC-2:** An empty postcode prevents saving, displays "Postcode is required," and preserves the previously saved address.
- **AC-3:** Cancel closes the editor without saving changes.
- **BR-1, in the accepted description:** A signed-in shopper cannot update another shopper's cart. Denied attempts leave that cart unchanged.

This release is an English-language website. Supported browser/screen-size matrices, accessibility targets, and lookup-failure behavior were not supplied. No existing cases were supplied, so reuse cannot yet be confirmed.

Each case uses its own disposable cart. Accepted synthetic fixtures:

- **Original address:** 12 Oak Road, London, SW1A 1AA, United Kingdom.
- **Replacement address:** 24 Rue des Fleurs, Paris, 75001, France.

#### Main proposal — summary

**4 main cases · 1 optional draft**

| Test type | Main cases | Optional drafts |
|---|---:|---:|
| Functional | 3 | 0 |
| Accessibility | 0 | 0 |
| Compatibility | 0 | 0 |
| UIUX | 0 | 0 |
| Security | 1 | 0 |
| Performance | 0 | 0 |
| Responsiveness | 0 | 1 |
| Localization | 0 | 0 |
| **Total** | **4** | **1** |

| Scenario type | Main cases | Optional drafts |
|---|---:|---:|
| Positive | 2 | 1 |
| Negative | 2 | 0 |

| Case | Action | Title | Prerequisites | Final expected results | Coverage reference | Test type | Scenario type |
|---|---|---|---|---|---|---|---|
| NEW-01 | Create | Save the delivery address | Signed-in shopper with an editable cart | Replacement address appears in checkout after reload | AC-1 | Functional | Positive |
| NEW-02 | Create | Prevent saving without a postcode | Cart has an existing address | Required-field error appears; existing address remains saved | AC-2 | Functional | Negative |
| NEW-03 | Create | Cancel address changes | Cart has an existing address | Editor closes; existing address remains saved | AC-3 | Functional | Positive |
| NEW-04 | Create | Deny changes to another shopper's cart | Two shoppers with separate carts | Update is denied; target cart's address remains unchanged | Description: BR-1 | Security | Negative |

**Optional:** NEW-05 — Use the address form at supported viewport sizes
(Responsiveness / Positive); viewport and layout expectations need agreement.

**Full details:** Current Markdown review (a working link in a real run).

The complete Markdown contains the following case tables; chat omits them by default.

| **1. CASE DETAILS** | | | | |
|---|---|---|---|---|
| **ID** | **Title** | **Coverage reference** | **Test type** | **Scenario type** |
| NEW-01 | Save the delivery address | AC-1 | Functional | Positive |
| **2. SETUP** | | | | |
| **Prerequisites** | Shopper is signed in; an editable cart contains the original address | | | |
| **Test data** | Original and replacement addresses listed above | | | |
| **3. STEPS** | **Step action** | **Step expected result** | | |
| **1** | Open the cart's delivery-address editor | The editor displays the original address | | |
| **2** | Enter the replacement address and select Save | The checkout summary displays the replacement street, city, postcode, and country | | |
| **3** | Reload checkout | The replacement address remains displayed for the same cart | | |

| **1. CASE DETAILS** | | | | |
|---|---|---|---|---|
| **ID** | **Title** | **Coverage reference** | **Test type** | **Scenario type** |
| NEW-02 | Prevent saving without a postcode | AC-2 | Functional | Negative |
| **2. SETUP** | | | | |
| **Prerequisites** | Shopper is signed in; an editable cart contains the original address | | | |
| **Test data** | Replacement address with its postcode empty; original address retained for comparison | | | |
| **3. STEPS** | **Step action** | **Step expected result** | | |
| **1** | Open the delivery-address editor | The editor displays the original address | | |
| **2** | Enter the replacement address, leave postcode empty, and select Save | "Postcode is required" appears; saving is prevented | | |
| **3** | Reload checkout | The original address remains saved; the attempted replacement was not persisted | | |

| **1. CASE DETAILS** | | | | |
|---|---|---|---|---|
| **ID** | **Title** | **Coverage reference** | **Test type** | **Scenario type** |
| NEW-03 | Cancel address changes | AC-3 | Functional | Positive |
| **2. SETUP** | | | | |
| **Prerequisites** | Shopper is signed in; an editable cart contains the original address | | | |
| **Test data** | Original and replacement addresses listed above | | | |
| **3. STEPS** | **Step action** | **Step expected result** | | |
| **1** | Open the editor and enter the replacement address | The editor contains the replacement values as unsaved edits | | |
| **2** | Select Cancel | The editor closes; checkout displays the original address | | |
| **3** | Reload checkout | The original address remains saved | | |

| **1. CASE DETAILS** | | | | |
|---|---|---|---|---|
| **ID** | **Title** | **Coverage reference** | **Test type** | **Scenario type** |
| NEW-04 | Deny changes to another shopper's cart | Description: BR-1 | Security | Negative |
| **2. SETUP** | | | | |
| **Prerequisites** | Dedicated shoppers A and B have separate carts; B's cart contains the original address; the cart-update interface is available for testing | | | |
| **Test data** | A's authenticated session; B's cart identifier; replacement address | | | |
| **3. STEPS** | **Step action** | **Step expected result** | | |
| **1** | Using A's session, submit an address update targeting B's cart through the cart-update interface | The update is denied | | |
| **2** | In B's isolated session, open B's checkout | B's cart still displays the original address | | |

#### First-pass optional draft

This bounded example adds one optional draft for the changed layout and custom
selector. Other material concerns may be appropriate in a real project; no quota
or full applicability matrix is required. Save the draft immediately, with the
captured description as its source basis and the questions below. Main coverage
remains four cases. The optional draft is not executable until its decisions settle.

| **1. CASE DETAILS** | | | | |
|---|---|---|---|---|
| **ID** | **Title** | **Coverage reference** | **Test type** | **Scenario type** |
| NEW-05 | Use the address form at supported viewport sizes | Optional basis: Description — changed address layout and country selector | Responsiveness | Positive |
| **2. SETUP** | | | | |
| **Prerequisites** | Signed-in shopper with an editable cart containing the original address | | | |
| **Test data** | Original and replacement addresses above; viewport configurations need agreement | | | |
| **3. STEPS** | **Step action** | **Step expected result** | | |
| **1** | Open the address editor at each agreed viewport | Decision needed: expected layout and supported configurations | | |
| **2** | Expand the country selector, then select the replacement country | Decision needed: expanded-state layout | | |
| **3** | Clear the postcode and select Save | AC-2 supplies the required message; validation-state layout needs agreement | | |

**Decisions:** Which viewports and zoom levels apply? Should the initial form,
expanded selector and validation state avoid clipping, unintended overlap and
horizontal scrolling, with controls reachable using vertical scrolling? These are
proposed expectations, not accepted rules. In JSON, omit unsupported `expected`
values and put the specific decisions in `questions`.

#### User-controlled promotion

This exchange illustrates [FR-4](../.agents/skills/test-case-design/SKILL.md#fr-4-promote-only-requested-supported-suggestions);
it is not evidence of a completed evaluation, execution or publication.

1. **Selection and agreement.** The user says, “Include NEW-05 with those layout
   expectations for 390×844, 768×1024 and 1440×900 at 100% zoom.” This both selects
   the draft and settles its clearly presented questions. Do not ask for another
   request to design it. Approving only the original four would leave it optional.
2. **Capture the real addition.** Retain the current complete proposal input or
   detailed read before source preparation. Write the agreed expectation to an
   explicitly authorized local source, for example `requirements/address-layout.md`.
   Add `{ "id": "layout", "kind": "file", "path": "requirements/address-layout.md" }`
   to the existing capture request's `sources`, preserving the story and all other
   selected evidence. Capture with `requirements prepare --id <analysis> --request
   <request-json>`. A changed capture resets inventory acceptance. Inspect the current
   entries and reapply still-valid source evidence or retained actual owner decisions
   for unchanged main requirements using the new snapshot/content bindings; old
   evidence cannot simply be copied as current. Accept the supplemental entry through
   its real owner decision under the [existing acceptance contract](requirements-analysis.md#capture-and-acceptance-inventory).
   Reuse existing authorization where expectations and authority are unchanged;
   resolve changed decisions without inventing acceptance or asking again about
   unchanged rules. Never substitute an unrelated story ID or silently edit the remote story.
3. **Prepare and reuse.** Run `test-case-design prepare` with the same analysis,
   context and selected-case scope to bind current acceptance. A changed source clears
   the current draft while immutable history retains it. Reuse the saved content,
   fill only the agreed decisions, move NEW-05 from `optionalDrafts` to `cases`, remove
   its optional `sourceBasis`/`questions`, and add actual supplemental requirement
   references, verifying-step mappings and preparation. Keep unselected drafts intact.
   Save against the returned source with `review` (or `edit` when a current draft
   exists), then obtain affected independent assessment and refresh the summary/current
   Markdown. Historical approval cannot cover changed content or selection.

The following additional case uses **R-1** as a readable sample label for the
accepted addition; actual mappings use the captured inventory identity. AC-2 still
supports the required-field message. Map the shared layout checks at every state,
not only the initial form, in each configured viewport.

| **1. CASE DETAILS** | | | | |
|---|---|---|---|---|
| **ID** | **Title** | **Coverage reference** | **Test type** | **Scenario type** |
| NEW-05 | Use the address form at supported viewport sizes | Description: R-1 — Responsive address form; AC-2 | Responsiveness | Positive |
| **2. SETUP** | | | | |
| **Prerequisites** | Signed-in shopper with an editable cart containing the original address; a fresh original-address fixture for each viewport configuration | | | |
| **Test data** | Viewports: 390×844, 768×1024, 1440×900 CSS pixels; browser zoom: 100%; original address above; replacement country for selector interaction. Repeat the steps for each configuration. | | | |
| **3. STEPS** | **Step action** | **Step expected result** | | |
| **1** | Set the viewport and open the address editor | No controls are clipped or unintentionally overlapped; no horizontal page scrolling occurs. Fields and actions remain reachable and operable, using vertical scrolling where necessary. | | |
| **2** | Expand the country selector, inspect the expanded state, then select the replacement country | While expanded, no controls or options are clipped or unintentionally overlapped; no horizontal page scrolling occurs. Fields, actions and options remain reachable and operable, using vertical scrolling where necessary. | | |
| **3** | Clear the postcode and select Save | In the validation state, no controls are clipped or unintentionally overlapped; no horizontal page scrolling occurs. Fields and actions remain reachable and operable, using vertical scrolling where necessary. “Postcode is required” remains readable without obscuring fields or actions. | | |

The refreshed ordinary proposal has **5 cases · Positive: 3 · Negative: 2**:
Functional 3, Security 1, Responsiveness 1, and zero for the other five test types.
Refresh both count tables and the five-row overview in chat, and all five complete
cases in the current Markdown. NEW-05 moves from optional to main without double
counting; optional totals become zero. The overview's final result comes from the last mapped
verification. Review NEW-05 independently; approval of the original four does not
approve the addition. Unselected drafts remain optional. Partial approval keeps
unapproved cases and required gaps visible, with existing publication safeguards.

If an accepted criterion instead requires an unavailable referenced rule, retain an
affected requirement gap while supported cases proceed through existing gates. If
only an optional suggestion lacks a design reference, keep that missing context
advisory. Supplied targets or languages alone do not select optional drafts into scope.
Already accepted accessibility requirements belong in the main proposal; adequate
shared coverage is proposed for reuse without cloning, merging or deleting cases.
When no material additional concern remains, zero optional drafts is valid.

## Preview, approve, publish and recover

```sh
npx --no pom-harness test-case-design preview --id sign-in --selected NEW-01,5678 --format compact
npx --no pom-harness test-case-design publish --id sign-in --approval <preview-fingerprint>
npx --no pom-harness test-case-design reject --id sign-in
npx --no pom-harness test-case-design reconcile --id sign-in
```

Omit `--selected` to preview all main cases; optional drafts are ineligible. The saved preview binds full reviewed
content, selected IDs, native operations, accepted source revisions, independent
assessment and configured destination. Show the exact native differences, shared
case impacts and preparation readiness outside the agreed tables, then obtain one
consolidated approval. Reject retains draft/history and invalidates unattempted
approval. Edits, requirement decisions, destination/source/case changes or missing
capabilities require revalidation and renewed approval. Unselected cases and residual
gaps remain saved. Publication can deliver valid selected cases even when unrelated
requirements remain unresolved.

Compact preview retains the exact destination, selected IDs, native changes,
`fieldPreview` (including per-case differences and verified server defaults), and
`preparationPreview` outside case tables. Full per-case material details accompany
the complete cases in the same current Markdown. A concise chat summary cannot hide
approval-relevant values. The immutable preview remains the approval authority.
Detailed/default JSON preserves the stored plan fields and adds a separate
`presentation` containing `rendered`, `reviewFile` and `nativePreview`. Compact output
uses that presentation. File paths or write failures never change the saved plan's
approval fingerprint; regenerate a preview when its actual approved payload changes.

Additional publication fields stay outside case content and tables. Configure
optional creation defaults in `ado.testCases.fields` in the consumer's
`.harness/integrations.json`. Per-case choices override those defaults:

```json
{
  "version": 1,
  "cases": [
    {
      "caseId": "NEW-01",
      "fields": {
        "System.AreaPath": "Example\\Portal",
        "Custom.BusinessUnit": "Retail"
      }
    }
  ]
}
```

The example field and path must already exist in the destination. Save the choices
as consumer `delivery-fields.json` and run
`npx --no pom-harness test-case-design preview --id sign-in --selected NEW-01,5678 --fields delivery-fields.json`.
Only selected case IDs may appear, once each. Values are bounded strings, finite
numbers or booleans; use stable field references. Reviewed Title, Description,
Steps, Tags and History remain controlled by the proposal and publication adapter.

The preview's `fieldPreview` lists each case's additional field references, readable
labels, values and existing values where applicable, alongside the exact destination,
case selection and preparation changes. Values supplied by server rules are verified
through validate-only and shown with `source: "server-default"`, even when metadata
does not declare the default. Show these details before publication approval.
The immutable preview retains the choices, observed defaults and relevant schema;
`publish --approval <preview-fingerprint>` reuses that intent without resupplying
the input file. Changed material values/defaults/schema require affected revalidation
and approval. Updates preserve unspecified current values and never apply creation
defaults; a material field change cannot remain Reuse unchanged.

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

The adapter discovers destination field labels, types, required/default/allowed
values and writability, and checks project/category, tag visibility and server
validate-only process/permission results. Neither required nor read-only metadata
alone blocks publication; attempted read-only/server-managed assignments do.
AreaPath/IterationPath use supported path values or verified server defaults, with
ADO deriving their internal IDs. Missing/invalid mandatory writable choices are
reported together without guessing values. Valid false, zero and permitted empty
values are retained. Conditional rules, identities and paths still need current
server validation. These publication checks do not run during ordinary design.
Populating existing custom fields is supported; creating field definitions or
changing the ADO process needs a separate explicit request. Validation requests
do not publish cases. Creation includes the approved Tested By relation
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
Existing saved previews and delivery receipts remain immutable and usable when
their approved request is still valid. Recovery uses their stored intent and field
specifications, including supported server-normalized values; it does not rewrite
historical hashes or require current schema discovery to prove a past effect.

## Handoff and ownership

```sh
npx --no pom-harness test-case-design handoff --id sign-in --selected NEW-01
```

The handoff writes an ordinary validated local scenario source under
`.harness/sources/test-case-design/` and adjacent source/coverage/impact references.
Its mapping check numbers address the emitted source steps, including preparation;
the saved proposal keeps its original business-step numbers.
Use local sources through existing [automation](PIPELINE.md) intake; published ADO
cases use existing [execution](manual-execution.md) story/suite intake. Preserve
preparation, exact inputs and explicit variations, every ordered action/expectation
and necessary cleanup through parsing and refinement. An omitted action or result is
a handoff defect, not permission to invent one. No new intake route is introduced.
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
