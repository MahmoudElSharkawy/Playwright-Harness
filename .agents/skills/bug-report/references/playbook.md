# Bug-report review and evidence contract

The [skill](../SKILL.md) owns the conversational workflow. The
[user guide](../../../../docs/bug-reporting.md) describes command inputs and
consumer state. Use one report identity across edits and recovery.

## Intake and working draft

Accept a selected story reference/content and an informal description, or a
selected execution defect. Preserve the original account, source identities and
revision alongside the refined draft. A title describes the observable symptom
and affected context. The description explains supported circumstances and impact;
it does not announce an unproven root cause. Number steps in actual execution
order and name prerequisites/data only when known.

Expected behavior requires an accepted criterion or another accepted source.
Actual behavior labels the reporter and observed conditions. Missing steps,
unknown requirements, unavailable stories and contradictory evidence stay visible.
Questions resolve specific gaps; do not ask users to repeat available information.
Interpretation, table approval and an edited expected result cannot silently
accept a new business requirement.

Present one reviewable field/value table. Keep complete narrative and steps
visible, continuing long content rather than hiding it behind a summary. Required
custom fields and missing choices belong in this same review. Explain relevant
source conflicts outside the table. Apply requested changes to the working draft,
preserving original source/execution records, and repeat only affected checks.

## Report layout

Use the same layout for UI, API and DB defects, including any pair or all three.
Group observations only when evidence ties them to the same discrepancy and
record or transaction. Keep checks needed for reproduction in Steps and put
supporting checks under Technical details. Identify the observation at each
layer and describe the limits of any comparison.

1. **Summary**. Write one sentence naming the symptom, where it occurs and the
   requirement it breaks when established.
2. **Steps**. Number one action and the neutral cue the reader should see after
   it. Use screen labels for UI actions. Name the account type, record, page,
   row or section needed. For API or DB steps, identify the operation and
   record in plain language and point to the precise request or read-only query
   under Technical details. For a comparison, open the reference and compare
   the same part. Put warnings only where they prevent a wrong action or result.
   Put extra checks last and mark them **Optional**. Put verdicts in Actual Result.
3. **Expected Result**. State the behavior in one or two lines. Use short
   bullets for multiple parts. End with a `Source: [requirement ID, section]`
   line. State a gap when the source or section is unknown.
4. **Actual Result**. Open with the observable symptom. Use one short bullet per
   relevant screen or step, with the labels and values shown. Add `(image N)`
   where it helps. Close with a supported impact or what the difference means.
5. **Pictures**. Give each reviewed image one short, numbered caption. Number
   images in evidence selection order and update references when it changes.
   Use the existing red highlight on the annotated image. Use one reviewed
   side-by-side capture when the reference and actual can be shown together.
   Label the expected and actual sides. Omit this section when no picture applies.
6. **Technical details**. Use only the applicable labels below. Put each bold
   label on its own line, followed by short bullets, a fenced code block for a
   read-only query or captured request, or a small table for returned values.
   Explain internal names on first use. Say what the evidence proves and where
   it stops.
7. **Test configuration**. End with one line of available environment,
   build/version and browser or device. Omit report timestamps and dates of
   execution, observation, rechecks and verification throughout the narrative.
   Keep dates that are part of the issue and the supported date of a suspected
   change. Preserve capture times in the evidence record.

Use `draft.description` for the summary and `draft.steps` for the numbered list.
Use `draft.expected` and `draft.actual` for the result text, with lines starting
`- ` for bullets. Supply notes and test configuration through `draft.notes` and
`draft.configuration`. Give screenshot evidence a short `caption` and keep its
provenance in `context`. The Pictures section names the file in ADO Attachments.

```text
[Symptom, location and requirement in one sentence]

Steps
1. [Action] — [what should be visible]
2. Optional: [extra check] — [what should be visible]

Expected Result
[What should happen]
Source: [requirement ID, section]

Actual Result
[Observed symptom]
- [Screen or step and value shown] (image 1)
[Impact or size of the difference]

Pictures
Image 1 – [What the reviewed image shows]

Technical details
**[Applicable label]**
- [Evidence or its limit]

Test configuration: [environment, build/version, browser or device]
```

### Technical details labels

- **Requirement**. Quote the applicable wording with ID and section. Say when
  the requirement is silent.
- **Reference document**. Identify the template, design or specification and how
  to find the relevant part.
- **How it works today**. Give the request, response, setting or data and where
  it was read, such as the network tab, log or named database.
- **Evidence**. Show the request or query, a small result table and one to three
  bullets on what it establishes. Use a read-only query and limit large results.
- **Side-by-side comparison**. Show expected and actual values and say whether
  the difference is the only one within what was compared.
- **Scope**. Identify known affected and unaffected cases, one or two examples,
  exclusions and any separately tracked bug.
- **Related items**. Link relevant bugs, stories or tasks and explain the difference.
- **Probable cause**. Label it as a guess. Give plausible candidates and the
  likely change date when supported.
- **What needs to change**. Identify where the evidence points for a fix.
- **Open questions**. Number the decisions needed and name who should answer.
- **Own test data**. Give short setup steps when useful.

### Worked example

Invoice INV-42 shows a total $10 above the approved template, which breaks
requirement INV-200, Invoice totals.

**Steps**

1. Open INV-42 in Invoice details — the Total row is visible.
2. Open the approved invoice template — the example Total row is visible.
3. Compare the Total rows — both amounts are visible (image 1).

**Expected Result**

The Total matches the amount in the approved template.

Source: INV-200, Invoice totals

**Actual Result**

The totals differ for invoice INV-42.

- Invoice details shows **Total $110** (image 1).
- The approved template shows **Total $100** (image 1).

The invoice shows $10 more than the template.

**Pictures**

Image 1 – Approved template (left), Invoice details (right)

**Technical details**

**Side-by-side comparison**

| Record | UI Total | API total | Stored total |
| --- | --- | --- | --- |
| INV-42 | $110 | $110 | $100 |

- The API response and stored total differ for this invoice.

**Test configuration**: QA, build 5.2, Chromium

## Severity and priority advice

Read the destination's actual Severity/Priority fields and allowed values from
the full preview (`bugs[].review`, or `fieldReview` when validation is blocked).
The compact preview omits some optional-field metadata; read its saved preview
file when needed. If metadata is unavailable, explain the gap without guessing.

Use the following rubric only when the project's exposed values and meanings
match. These labels describe the standard scale; they are not universal defaults.

| Observed impact | Suggested Severity | Suggested Priority |
|---|---|---|
| Blocks the flow with no workaround | `1 - Critical` | `1` |
| Wrong or missing data in an issued artifact, or a broken core path with a workaround | `2 - High` | `1` or `2` |
| Localized functional error, visible but non-blocking | `3 - Medium` | `2` or `3` |
| Minor cosmetic or edge polish | `4 - Low` | `3` or `4` |

- Base impact on the user's account and verified evidence. Within a priority
  range, choose only when evidenced urgency supports it; otherwise leave priority
  unresolved. Do not invent a workaround, business impact or urgency.
- Give no suggestion for a field whose impact, availability, allowed values or
  scale is unclear. Show available choices and the gap. Missing Severity does not
  prevent supported Priority advice. Never translate unfamiliar labels by guess.
- Preserve user-entered values and configured `bugs.fields` defaults instead of
  replacing them automatically with advice. Explicit user edits still win.
- Otherwise use existing draft `severity` and `priority` keys (the same keys in
  `file-bugs --drafts`). Show each proposed value with a one-line reason in the
  editable chat table. The user may change or decline it before approval; save
  the retained values and redisplay edits through the existing workflow.

Examples, when these standard choices are exposed: checkout blocked without a
workaround suggests Critical/1; a cosmetic alignment issue explicitly described
as low urgency suggests Low/4. "Sometimes the screen behaves strangely" supplies
too little impact evidence for a suggestion. A configured Priority of 2 remains
2 unless the user changes it. Keep reasons in chat; add no advice object or
provenance fields. Existing validation and approval cover final filed values.

## Confirmation and evidence

Retain user confirmation separately from agent reproduction and record uncertain
or contrary outcomes. Existing adequate evidence avoids another reproduction.
Otherwise propose the smallest check that can resolve the gap and collect the
needed evidence. Guided user reproduction remains user-origin evidence; agent
execution uses existing configured runtimes, authority, effect reconciliation and
maintenance budgets. Neither creates a separate verdict or reproduction engine.

Use comparable attempt identities and X/N only with a real denominator. Failed-only
reruns do not establish an unbiased historical rate. Keep changed builds,
environments and fixtures in separate cohorts. Uncertain attribution returns to
maintenance; suspected test/environment faults are not confirmed product defects.

Each attachment requires verified bytes/hash, safe consumer ownership, bounded
size and an identified relationship to the report. Keep available capture time,
build/environment and request/query/run correlation. Privacy and eligibility apply
independently to every artifact, including approved sanitized derivatives. Preserve
original bytes and truthful origins. No screenshot is necessary for an API/DB-only
report. A user report without enough confirmation may remain a provisional draft;
any filing request must explicitly cover its disclosed gaps and satisfy existing
delivery eligibility.

## Screenshot pairs

Use deterministic HTML/CSS overlays with the installed renderer. Never install
tools during filing or generate substitute evidence. Bind verified source
dimensions/hash, meaningful relative boxes, escaped summary/expected/actual text,
annotation specification and derived hash. Preserve Unicode/RTL text. Reject
materially invalid geometry; harmless bounded edge rounding cannot relocate the
highlight to invent support.

Inspect the exact raw and derived images for relevance, readable text and correct
placement. A successful render/header is not visual proof. Record visual review
against those exact hashes and the specification. At most two placement
corrections may use the same source; edits/resume do not reset that limit. Renderer,
deadline, invalid-placement or cleanup failure permits only an eligible raw-only
fallback with its reason. Invalid/stale/private raw sources remain ineligible.
Successful annotation previews and delivers both eligible versions to one bug.

Draft/source/evidence edits affecting annotation meaning require affected
revalidation and a revised preview. Unrelated field edits do not force a new
render. Unchanged approved resumes reuse exact bytes/specification.

## Destination schema and final approval

Discover the selected project's actual work-item type and field metadata; use
stable identifiers internally and readable labels in review. Resolve standard and
custom mappings, types, supported defaults, allowed values, required/read-only
fields, identities, paths and links. Defaults come from the selected project and
validated configuration, never another company's conventions. Required choices
cannot be guessed or removed from the payload. Unsupported mappings remain gaps.

Check exposed conditional rules and run non-creating server validation where
supported. Metadata alone is not complete process-rule proof. Partial metadata,
access failures and unsupported validation preserve the draft with explicit
limitations. Do not create a temporary bug, bypass server rules or claim a check
passed when it did not run.

The final approval binds the destination/type, complete field payload, accepted
source revision, confirmation limits, exact attachment set and ordered operations.
Recheck relevant source and destination rules before dispatch; material changes
require affected corrections/revalidation and renewed approval. Approval to draft
does not authorize execution or filing.

The shared delivery path persists intent before dispatch, reads back results and
keeps known work-item/attachment IDs. A lost response is uncertain until reconciled;
titles alone cannot identify a prior write. Resume only missing unchanged approved
operations. Report partial delivery honestly and preserve the prior receipts.
