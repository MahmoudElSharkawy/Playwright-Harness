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
confirmation. The selected story remains coverage authority; referenced rules are
supporting evidence mapped to its inventory, not new primary requirements.

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
changes require affected revalidation. Optional suggestions still need both the explicit
creation request and accepted expectations described in FR-4.

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
Show only useful suggestions outside the existing tables; no routine 22-area or N/A
matrix. An explicitly requested applicability assessment can explain feature-specific
exclusions. The checkout example below demonstrates selection and promotion without
changing the case schema or requiring reference-resolution capabilities from #128.

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
cases when their native preparation can be interpreted without guessing. Split setup,
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

#### Main proposal — existing format

**Total cases: 4 · Positive: 2 · Negative: 2**

| Test type | Total |
|---|---:|
| Functional | 3 |
| Accessibility | 0 |
| Compatibility | 0 |
| UIUX | 0 |
| Security | 1 |
| Performance | 0 |
| Responsiveness | 0 |
| Localization | 0 |

| ID | Proposed action | Title | Prerequisites | Final expected results | Coverage reference | Test type | Scenario type |
|---|---|---|---|---|---|---|---|
| NEW-01 | Create | Save the delivery address | Signed-in shopper with an editable cart | Replacement address appears in checkout after reload | AC-1 | Functional | Positive |
| NEW-02 | Create | Prevent saving without a postcode | Cart has an existing address | Required-field error appears; existing address remains saved | AC-2 | Functional | Negative |
| NEW-03 | Create | Cancel address changes | Cart has an existing address | Editor closes; existing address remains saved | AC-3 | Functional | Positive |
| NEW-04 | Create | Deny changes to another shopper's cart | Two shoppers with separate carts | Update is denied; target cart's address remains unchanged | Description: BR-1 | Security | Negative |

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

#### Optional quality suggestions

| Area | Suggested check | Decision or context needed |
|---|---|---|
| **Save recovery and unsaved work** | Check recovery after a lost save response or retry, and what happens when navigating away with unsaved edits. Cancel is already covered by AC-3. | Expected saved-state confirmation, retry behavior and treatment of unsaved edits. |
| **Lookup integration and feedback** | Check delayed, empty, failed or unexpected lookup responses and the user's next available action. | Loading/error behavior, fallback options and any response-time target. |
| **Privacy** | Check which address fields reach the lookup provider and whether personal data appears in diagnostics. | Applicable data-sharing, logging and retention policies. |
| **Accessibility** | Check keyboard operation, focus, labels and validation announcements for the custom controls. | Applicable accessibility target and supported assistive technologies. |
| **Layout and browser/input compatibility** | Check the form, selector and validation messages across supported viewports, zoom levels, browsers and input methods. | Supported combinations, design expectations and existing shared coverage. |

> Selected for the changed layout, custom control, external lookup and personal data; overlapping concerns are grouped. These suggestions add no cases: the proposal remains at four. Request selected additions under [FR-4](../.agents/skills/test-case-design/SKILL.md#fr-4-promote-only-requested-supported-suggestions).

#### User-controlled promotion

This exchange illustrates [FR-4](../.agents/skills/test-case-design/SKILL.md#fr-4-promote-only-requested-supported-suggestions);
it is not evidence of a completed evaluation, execution or publication.

1. **Context without a creation request.** The user says, “Approve the four cases.
   Supported viewports are 390×844, 768×1024 and 1440×900.” Keep the four cases,
   IDs, mappings and counts. Reuse those sizes if responsive coverage is requested;
   approval of the original proposal selects no suggestions and triggers no delivery.
2. **Request with unresolved expectations.** The user says, “Create responsive cases
   only; leave the other suggestions pending.” Retain that request and ask only the
   remaining layout decision: “Should controls avoid clipping and unintended overlap,
   with no horizontal page scrolling, and remain reachable and operable using vertical
   scrolling where necessary, for the initial form, expanded selector and postcode
   validation state at 100% zoom?” These are proposed expectations, not accepted rules;
   the proposal still has four cases.
3. **Request plus captured agreement.** The user accepts those expectations for all
   three states and sizes at 100% zoom and asks to record the accepted addition.
   Update the selected local source or capture the authorized owner decision through
   the existing requirements workflow, retain acceptance evidence, and prepare again
   before saving the new case. Do not invent an inventory ID or automatically edit
   a remote story. The earlier creation request remains valid; no repeated request
   or confirmation is needed. Only responsive coverage is selected.

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
Render the full summary, five-row overview and all five complete case tables again,
including the unchanged original four; this illustrative delta is not a replacement
for the normal review. The overview's final result comes from the last mapped
verification. Review NEW-05 independently; approval of the original four does not
approve the addition. Unselected suggestions remain advisory. Partial approval keeps
unapproved cases and required gaps visible, with existing publication safeguards.

If an accepted criterion instead requires an unavailable referenced rule, retain an
affected requirement gap while supported cases proceed through existing gates. If
only an optional suggestion lacks a design reference, keep that missing context
advisory. Supplied targets or languages alone add no suggestion-derived cases.
Already accepted accessibility requirements belong in the main proposal; adequate
shared coverage is proposed for reuse without cloning, merging or deleting cases.
When no material additional concern remains, omit the suggestions section entirely.

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
