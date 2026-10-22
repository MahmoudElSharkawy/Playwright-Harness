# Bug reporting

To remove an optional configured field default, edit `draft.omitFields` with its stable field reference. Required fields still fail validation when absent; narrative and durable identity fields cannot be omitted. `draft.fields` supplies explicit project-specific values and overrides ordinary configured defaults.

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
