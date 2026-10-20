---
name: requirements-analysis
description: Analyze supplied requirements or an ADO story, review an editable findings table in chat, preserve acceptance traceability, and optionally post the user's approved story comment with requested team-member mentions.
---

# Requirements analysis

Resolve this linked skill to its real path. Follow [ROOTS.md](../ROOTS.md) and the
[workflow/formats](../../../docs/requirements-analysis.md). The host AI performs
analysis and chat review; deterministic scripts capture, validate, save and deliver.
The consumer owns sources, inventory, drafts and receipts. No external analyzer,
browser review UI, server or HTML download/import is needed.

## Capture and analyze

Resolve known project/application, story, supplied files and prior analysis ID from
the conversation/project. Bundle only genuinely missing choices; do not ask users
to repaste accessible content. Create a consumer request and run `pom-harness
requirements prepare --id <id> --request <file>`. Local mode never resolves ADO
credentials. ADO mode loads available title, description, AC, paginated discussion
and supplied attachments through existing adapters. Inspect omissions; use supported
host readers with content-bound extraction receipts for unsupported attachments.
Sanitize before analysis; never reconstruct redacted secrets.

Read the captured source and single inventory. Before review, partition compound
statements into independent exact slices with `inventory`, covering every supplied
statement once and retaining stable IDs where appropriate. Source statements remain
source authority; inventory owns acceptance/trace mappings; chat drafts own findings
and final questions. Keep assumptions, constraints, dependencies and unanswered
discussion concerns on their inventory entries. Do not automatically repeat an
unanswered existing question in the outgoing comment.

Record `accepted` only with exact source-criterion evidence or an explicit current
owner decision bound to requirement content. Otherwise retain `proposed`, `unknown`
or `needs-decision`. Missing preconditions/data, nonfunctional targets, boundary
semantics and conflicts remain unresolved. A finding/question/plan approval never
accepts an unstated business rule or executable assertion. Preserve source and test
expectations; allowed spaces/special characters stay allowed.

Analyze the current snapshot once for evidenced gaps and contradictions. Zero
findings is valid; no quotas. Questions ask Business for missing decisions rather
than asserting invented defaults. A contradiction cites both conflicting passages.

## Review in chat

Save a version-1 draft with current `consumer`, `snapshot`, `head`, `findings`,
plain-text `comment` (null for the generated table) and requested `mentions`. Each
finding has stable `id`, `type` (Gap or Contradiction), `finding`, exact located
`sources` (`requirementId` + `quote`) and `question`. Run `requirements review --id
<id> --input <file>` and render its returned table directly in chat, with exactly:

| Findings | Type | Source material text | Question/Comment for Business |
|---|---|---|---|
| Stable ID and concise issue | Gap or Contradiction | Exact quoted description/AC/other passage and location; both sides for conflicts | Proposed business question/comment |

The row above describes the format, not an actual finding. Never present invented
source text as evidence. Keep IDs stable so “remove F-02” or “edit F-01” is clear.
User requests can add/remove/edit findings, questions, manual final text or mentions.
Re-read current state, save the full revised draft with `requirements edit --id <id>
--input <file>` and re-display the table/current final comment. Removing a row removes
it from the generated outgoing table. Preserve requested manual final text; do not
silently replace it when the table changes. Explain when an edit creates a mismatch.

`requirements resume --id <id>` restores the current draft/table without reanalysis.
Stale/foreign/malformed edits or changed artifact bytes must preserve valid state.
Draft saves and conversational agreement alone never authorize publication. Show
rendered content in chat, not raw JSON, fingerprints or wire HTML.

## Requested mentions

Only include people the user requested. Resolve exact display name, account/email
or ADO identity GUID against authenticated membership in the originating project's
teams. Use `requirements members --id <id>` to find candidates when needed. Treat
results as scoped to returned teams/access. Duplicate names require account/GUID
selection; role-only requests such as “the BA” require a named person. Never guess,
pick the first match, infer an identity from role, or silently downgrade to plain
`@Name`. Bundle missing selections. No directory reads for local-only review or
when no mentions are requested.

Save chosen selectors in the draft. Preview shows resolved names/accounts/IDs;
scripts deduplicate people across teams, escape text, generate supported ADO person
mentions and revalidate recipients before posting. Renamed/removed/inactive or
ambiguous identities require resolution and a new preview. A roster access failure
does not authorize a guessed recipient. Do not promise notification delivery from
synthetic readback alone.

## Refresh and handoff

Refresh using the original request before reusing acceptance or publishing. Changed
source/discussion invalidates current evidence and moves prior drafts to history.
Reassess referenced text and finding meaning; matching IDs do not prove freshness.
Preserve custom questions/manual comments as starting points, show relevant old/new
text and obtain approval for current replacement text. Do not carry approvals.

Earlier prerelease review artifacts remain intact. `read` exposes their references;
legacy exports/UI approvals cannot authorize chat publication. Inspect retained
text, propose any carryover in chat and save a new draft after review. No dependency
installation or legacy browser UI is required.

`requirements plan --id <id>` exposes the existing inventory, IDs/revisions,
acceptance evidence, constraints/dependencies and unresolved decisions read-only.
Link these records; do not duplicate acceptance authority, invoke another analysis
or let plan approval resolve a business-rule question.

## Optional story comment

When the user requests delivery, run `requirements preview --id <id>`. Show exact
returned final text/table, resolved mention recipients, originating story URL,
reviewed source and the single ordered comment POST. Resolve missing choices before
this final preview. An explicit “approve and post” for the unchanged preview is one
authorization; do not ask again when existing authorization covers that exact text,
destination and people. Pass its fingerprint to `requirements post --id <id>
--approval <hash>`. Any changed payload, source/discussion or recipient requires a
new preview and approval. A null comment with zero findings has nothing to post;
only an explicit user-requested manual comment can override that.

The adapter rechecks freshness and durably records dispatch, comment ID/URL and
mention readback. On uncertainty run `requirements reconcile`; never retry blindly.
An identical new comment is only a candidate. Ask the owner to identify its exact ID
before `reconcile --comment-id <id>` when no durable acknowledgement identifies it.
Mismatched mention readback remains unresolved. Missing access/destination, declined
publication and local-only requirements remain saved. Return the verified comment
link/receipt when completed. No story-field, case, result or other remote writes.
