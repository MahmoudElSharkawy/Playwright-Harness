# Bug reporting

To remove an optional configured field default, edit `draft.omitFields` with its stable field reference. Required fields still fail validation when absent; narrative and durable identity fields cannot be omitted. `draft.fields` supplies explicit project-specific values and overrides ordinary configured defaults.

The [recorded synthetic model exercise](../harness-tests/fixtures/bug-report-model-outputs.json) retains five exact prompts, selected sources and actual generated answers. A separate reviewer [graded all five answers](../harness-tests/fixtures/bug-report-model-grading.json) against their evidence and the skill: five passed, with one nonblocking redundant clarification. This is bounded model-output evidence, not native-host discovery, live ADO acceptance or a statistical effectiveness claim. Exact model/client build and token/cost measurements were unavailable.

Use [bug-report](../.agents/skills/bug-report/SKILL.md) to turn a selected story and
an issue described in your own words into an editable bug draft, or to review a
defect found during manual execution. A prior harness run is not required. The
agent understands the selected context and refines the wording; deterministic
commands preserve the draft, validate the destination and deliver approved content.

## Start and refine a report

Provide the story reference or content, your description and relevant existing
evidence. The agent reuses available information and bundles essential missing
choices. It reads only selected sources. Missing or inaccessible requirements allow
a provisional draft, with unsupported expectations and reproduction details left
explicitly unresolved.

The review table contains:

| Detail | Review behavior |
|---|---|
| Title and description | Clear observable symptom, relevant context and supported impact; suspected causes remain hypotheses. |
| Prerequisites and numbered steps | Known setup and complete reproduction sequence; missing steps stay visible. |
| Expected result | Accepted story/requirement evidence, with source and revision or an explicit gap. |
| Actual result | The user's report and agent-observed findings, with their origins distinguished. |
| Environment and confirmation | Available build/environment; user confirmation and agent reproduction tracked separately. |
| Project fields | Actual supported standard/custom fields, proposed values, valid choices and unresolved requirements. |
| Attachments | Exact eligible files, raw/annotated image relationships and rejected evidence with reasons. |

Add, edit or remove draft details and optional fields in chat. The agent saves the
corrections and redisplays the revised table. Mandatory fields remain visible until
valid; system-managed fields are read-only. A changed expected result that conflicts
with the story needs a requirement decision. Draft edits never rewrite original
requirements, execution results, assertions or raw evidence.

ADO bug narratives show readable source references and separate user-confirmation
and agent-reproduction details. Internal source snapshots, run/evidence identities,
fingerprints and raw observation structures stay in consumer records rather than
being serialized into the Description or Repro Steps fields. Generated execution
defaults summarize recorded failure/inconclusive/diagnostic occurrences without
claiming a reproduction rate. This also applies to recognized older generated
defaults; saved intake and draft history remain unchanged. Deliberately reviewed
API JSON in a user's actual result remains part of that approved report. Existing
ADO correlation tags still support duplicate detection and delivery recovery.
Changed rendered content requires a current preview and approval before filing.

## Confirm only what needs confirmation

Existing adequate, current evidence avoids an unnecessary rerun. If confirmation
or evidence is insufficient, the agent explains the gap and offers guided user
reproduction or execution through [execute-test](../.agents/skills/execute-test/SKILL.md).
Uncertain causes return to [maintain-test](../.agents/skills/maintain-test/SKILL.md).
The existing execution authority, effect-reconciliation rules and repair budgets
still apply; drafting itself starts no new run.

User-reported and user-confirmed statements are distinct from agent reproduction.
Failed or inconclusive reproduction retains its actual outcome and any contrary
account. Reproduction frequency is X/N only for actual comparable attempts with a
known denominator. Selected failure reruns are not an unbiased historical rate.
Cleanup/reporting symptoms do not replace the primary failure.

Collect evidence appropriate to the issue: screenshots, API request/response
records, database observations or logs. Bind available capture time, origin,
build/environment and request/query/run identity. Check relevance, privacy,
ownership, size and hashes for every deliverable. Preserve originals and identify
any supported sanitized derivative separately. API/DB-only defects need no
screenshot. Missing evidence is a gap, never a reason to fabricate an attachment.

## Review screenshot pairs

For an eligible screenshot, deterministic HTML/CSS rendering adds a readable
summary, expected/actual labels and a red defect highlight to a separate image.
An optional green comparison must also be evidence-backed. Relative coordinates
support different sizes; text is escaped and supports Unicode/RTL. Raw bytes and
source assertions remain unchanged.

The agent must inspect the exact raw and annotated images for relevance, readable
text and correct placement before recording visual review. Render success or an
image header alone is insufficient. Preparation has a deadline, owned-resource
cleanup and at most two placement corrections against the same source. Missing
renderer, invalid placement or render/cleanup failure permits an eligible raw-only
fallback with a visible reason. Ineligible sources remain ineligible.

Successful annotation delivers both eligible versions to the same bug. The final
preview shows their relationship and exact text alongside other attachments.
Draft/source/evidence changes affecting the annotation require affected checks and
a new preview. Unrelated project-field edits need not re-render valid images.
Unchanged approved resumes reuse byte-identical artifacts.

## Adapt to the destination project

The configured project's actual defect work-item type and metadata determine the
submission. Projects can use different required/custom fields, display labels,
types, defaults, allowed values, identities and process rules. The workflow uses
stable field identifiers internally and readable labels in review. It does not
assume a universal Bug type, Severity field or priority scale.

Configure an explicit `bugs.workItemType` and `bugs.fieldMap` when the project's
semantic fields differ. Supported mapping keys are `title`, `description`,
`reproSteps`, `expected` and `actual`; values are the destination's stable field
references. Existing `bugs.fields` supplies validated project-specific scalar
defaults. A mapped field must actually exist and be writable. No field is created
by this configuration.

Known values come from verified context, validated configuration or supported
project defaults, with their source disclosed. Missing mandatory choices appear
together. Values are checked for type and permitted options; identities, paths and
links must resolve in the configured scope. Required fields cannot be guessed,
omitted or copied from another company to make submission pass.

Use non-creating server validation where supported. Field metadata does not prove
that every conditional rule is known. Partial metadata, rejected access or
unsupported validation preserves the draft with precise limitations. Resolve
material readiness gaps before claiming the report can be filed. Never create a
temporary bug or bypass server rules to validate a draft.

## Commands and final approval

Run commands through the consumer's installed package. The input JSON is local
consumer data; start from the [draft template](../.agents/skills/bug-report/assets/draft-template.json),
which deliberately contains unresolved empty values.

```text
npx --no pom-harness bug-report prepare <report> --input <input.json>
npx --no pom-harness bug-report show <report>
npx --no pom-harness bug-report edit <report> --input <revision.json>
npx --no pom-harness bug-report preview <report>
npx --no pom-harness bug-report approve <report> --preview <fingerprint>
npx --no pom-harness bug-report file <report> --approved <fingerprint> --execute
```

## Post-run review

Both execute-test and automate-test prepare bug drafts as part of completing a
failed, blocked or partial run. The agent classifies the findings; the runtime
reassesses saved records, binds that classification to the run and persists the
editable drafts. No additional bug-report invocation from the user is needed.
Generating an HTML report alone does not perform this conversational review.

1. Read the final run report and inspect its selected source, actual observations,
   failed checks and available evidence. Do not infer a product defect from a red
   assertion alone. Use maintain-test for uncertain attribution within the existing
   investigation and repair budget; retain the original failure and later attempts.
2. Run `bug-report failures <review> --input <run.json>`. The input is
   `{"workflow":"execute-test","executionId":"<exec>"}` or
   `{"workflow":"automate-test","sourceId":"<source-id>"}`. Before generation
   starts, use `source` with the consumer-relative source JSON path and optional
   `notes` with the same source-bound blocker notes used for reporting. Findings
   include supported failures and unresolved/blocked items; the returned `hash`
   binds the current source and observations.
   For exploration before a generation handoff exists, also pass `observed` with
   the existing reporting-observation JSON path (`source`, `executions`, `bindings`).
   The shared loader reassesses those native snapshots and evidence; imported
   summary verdicts cannot establish a failure.
3. Classify every finding exactly once as `application`, `test`, `environment` or
   `unknown`, with a grounded reason and next action. Prepare a complete refined
   draft for each supported application issue. Keep test/environment causes in
   the attention list. An unknown cause may have a provisional draft; it cannot
   be filed as a confirmed application defect.
4. Group only when the recorded evidence supports the same observable defect and
   compatible expected behavior, environment/build and circumstances. Record why
   the cases belong together; the same error text or an assumed shared root cause
   is insufficient. Keep distinct symptoms separate. Preserve every member and
   occurrence, including differing attempts. Explain grouping in chat and split
   or regroup with a new review identity if the user corrects it.
   One case may reveal distinct defects. Give each such group a unique `key` and
   its own symptom/evidence rationale; these groups may share the same finding
   while retaining separate drafts and approvals. Never invent distinct defects
   from a native assertion count alone.
5. Save the classification input below and run
   `bug-report from-run <review> --input <classified.json>`. Reuse the same review
   identity/input when resuming; existing draft edits and approvals are retained.
   New observations or classifications require a new reviewed snapshot. Empty
   findings produce no drafts and no ADO calls.

```json
{
  "version": 1,
  "run": {"workflow": "execute-test", "executionId": "<exec>"},
  "hash": "<hash from failures>",
  "classifications": [
    {"finding": "<finding-id>", "classification": "application",
     "reason": "Explain the source/evidence comparison establishing the defect.",
     "nextAction": "Review the bug draft."}
  ],
  "groups": [
    {"members": ["<finding-id>"], "reason": "Explain why these occurrences belong together.",
     "draft": {"title": "Refined symptom", "description": "Supported circumstances and impact",
       "prerequisites": [], "steps": ["Observed action"], "expected": "Accepted behavior",
       "actual": "Recorded discrepancy", "fields": {}}, "evidence": []}
  ]
}
```

For ADO-backed automation, include `adoSnapshot` in `run`, pointing to the original
`execution-tests/ado-story-<id>/_suite.json` or `execution-tests/ado-suite-<id>/_suite.json`
captured with `fetch-story|fetch-suite --revisions`. The snapshot must match the
executed neutral source and retain the case, shared-step and story revisions.
Review and filing check all selected bindings against the destination. Missing
original revisions leave an editable draft with a visible source gap; a new fetch
does not retroactively supply the executed revision. Explicitly refined sources
whose actions/expectations no longer match that snapshot need provenance resolution
before filing. Local sources need no ADO snapshot or credentials to draft.

Use the existing evidence input contract for each group's reviewed screenshots,
API/DB observations or logs. The inventory lists execution evidence candidates;
verify relevance/privacy before selecting them. Automation receipts establish what
the generated tests did, not an independent manual reproduction. Add precise
observations from the native results or maintenance assessment; do not substitute
raw assertion counts for the user's readable actual result. Preserve uncertain
or mixed reproduction outcomes in the draft's confirmation details.

Present the complete editable field/value table for **each** returned draft, its
affected cases, grouping reason, confirmation limits, attachments and unresolved
project fields. Include attention items and their next actions alongside drafts.
Users may edit individual drafts, choose a subset, or defer all filing. For example,
three cases showing the same supported invoice defect plus a locator fault and an
unavailable environment produce one grouped draft and two attention items.

Each selected draft then uses the existing `edit`, `preview`, `approve` and `file`
commands. Validate the destination's actual fields and evidence and obtain explicit
approval for that exact preview before `file --execute`. Selecting a draft or
approving its wording alone is not approval to file. Changed sources, group
membership, content or attachments require an updated preview and approval.
Grouped drafts recheck every captured member's case/source revision. Configured
case-derived paths use the first member (sorted by finding identity); expose those
paths in review or set explicit project fields when they are unsuitable. Drafting
never changes test verdicts, assertions, generation repair counts or green runs.

### Single execution defect

For an existing execution defect, retain its native identity and evidence:

```text
npx --no pom-harness bug-report from-execution <report> --execution <execution-id> --fingerprint <defect-fingerprint>
```

Prepare screenshot annotation from its source-bound specification:

```text
npx --no pom-harness bug-report annotate <report> --input <annotation.json>
npx --no pom-harness bug-report review-annotation <report> --input <visual-review.json>
```

`show` returns the current `head`. An edit input supplies that exact head and a
draft patch, for example `{ "head": "<current-head>", "draft": { "title":
"<corrected title>" } }`; it may also supply revised confirmation/evidence.
The original captured source is immutable. Changed source requirements need a new
linked report capture rather than editing the original source record.

Evidence inputs identify a consumer-relative `path`, `kind` (`screenshot`, `api`,
`database` or `log`), `origin` (`user` or `agent`), available capture/build/environment
`context`, `sanitized: true` and a `verification` object containing `privacy: true`
and `relevance: true`. These declarations must follow actual inspection, not
replace it. Eligible bytes are copied into owned consumer run artifacts and bound
by hash. Annotation preparation returns `PREPARED`; record visual review only
after inspecting its exact output. `preview` returns readiness, problems and a
content-bound hash; approval and filing require that exact latest preview hash.

Approval covers the exact complete table and field payload, configured
destination/type, selected source revisions, confirmation limits, eligible
attachments and ordered writes. Resolve known choices before this single final
approval. Reuse explicit authorization that already covers the unchanged plan.
Drafting does not authorize filing, and filing approval does not grant additional
execution or requirement-change authority.

Before dispatch, recheck relevant source and destination rules. A material change
or validation rejection preserves the draft and identifies the affected fields.
Correct and revalidate those inputs and renew affected approval. Do not silently
change the submitted payload.

Consumer state belongs under `.harness/runs/<report>/bug-report/`, with
`current.json` pointing to immutable `revisions/` and saved previews/artifact
bindings. Delivery receipts remain consumer-owned. This state never
changes installed package bytes. Partial delivery retains known bug/attachment
IDs and accurate completed, failed, pending or uncertain outcomes. Reconcile
uncertain writes before resuming only missing unchanged approved operations;
never recreate based on a title match or replay a confirmed upload. Return the
verified bug link and explain any remaining delivery limits.

## Evaluation scenarios

These are synthetic evaluation inputs, not claims of executed product behavior.
Evaluate actual generated drafts and edits independently; mechanical schema and
routing checks alone do not establish understanding or output quality. Retain
prompts, selected sources, actual outputs, model/client versions, grading and
unavailable native/live checks separately.

| Input or request | Expected reviewed behavior |
|---|---|
| Explicit bug-report invocation. Story S1: cancelling a pending order releases reserved stock and leaves paid invoices unchanged. User: “I cancelled a pending order that already had a paid invoice; the invoice disappeared.” No prior run. | Refined draft describes the disappeared invoice, traces expected invoice preservation to S1 and labels actual behavior user-reported. It does not claim stock was released, invent an environment or claim agent reproduction. |
| Natural request: “Report the invoice disappearing when I cancel; use S1.” | Routes to bug-report and produces the same source-grounded draft without requiring a harness run. |
| User changes the title, adds a missing setup step and corrects actual wording. | Saved revision and complete table reflect edits; original story/account and execution evidence remain intact. |
| User changes expected behavior to deleting the paid invoice, contradicting S1. | Exposes the conflict and keeps the proposed requirement change unresolved; approval of wording does not change S1. |
| Current comparable evidence already confirms the observation. | Reuses that evidence without forcing another run; origins, build/environment and attempt context remain visible. |
| User-guided or authorized agent reproduction does not reproduce the issue. | Preserves the report and actual reproduction result separately, with no invented confirmation or silent dismissal of the user's account. |
| API/DB-only defect with relevant eligible request/query logs. | Uses those attachments without inventing or requiring a screenshot; sensitive content remains excluded. |
| Eligible screenshot plus long Arabic labels and edge-position boxes. | Readable, escaped, correctly placed annotation passes actual image inspection; raw bytes stay unchanged and the preview includes the pair. |
| Invalid/private screenshot, missing renderer or exhausted placement corrections. | Invalid sources cannot upload; a still-eligible source may use explicit raw-only fallback under the existing bounds. |
| Project A requires Custom.Component; project B has no Severity and uses different priority choices. | Actual field tables and payloads follow each destination. Missing mandatory values remain unresolved, with no invented default or copied priority. |
| Conditional requirement, renamed label, read-only field, invalid assignee or unavailable metadata. | Uses stable mappings, surfaces applicable validation failures/limits and makes no unperformed validation claim or temporary create. |
| Source, field rule, draft or attachment changes after approval; then an upload response is lost. | Affected review/approval is renewed; durable identities reconcile uncertainty and completed operations are not replayed. |
| “Execute these cases,” “automate this case,” “why does this test fail in CI?” or “analyze this story's ambiguities.” | Routes to execute-test, automate-test, maintain-test or requirements-analysis respectively, without unauthorized bug filing. |
