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

Save a version-2 draft with current `consumer`, `snapshot`, `head`, `findings`,
plain-text `comment` (null for the generated table) and requested `mentions`. Each
finding has stable `id`, `type` (Gap or Contradiction), explicit `severity` (High,
Medium or Low), `finding`, exact located
`sources` (`requirementId` + `quote`) and `question`. Run `requirements review --id
<id> --input <file>`. Show the returned short `summary` (total findings, counts by
Type/Severity and first priority concern) before its table in chat, with exactly:

| Findings | Type | Severity | Source material text | Question/Comment for Business |
|---|---|---|---|---|
| Stable ID and concise issue | Gap or Contradiction | High, Medium or Low | Exact quoted description/AC/other passage and location; both sides for conflicts | Proposed business question/comment |

Use evidenced business impact: High blocks a core decision or has clear security/
data-integrity impact; Medium affects a supported scenario/expected outcome; Low
is localized ambiguity with limited impact. Explain the basis in the finding when
needed; do not rate by Type alone or invent risk. Resolve unclear impact with the
user before saving. Scripts sort High → Medium → Low, preserving input order for
ties and finding IDs. The summary is derived, not separately editable authority.
Zero findings describes only reviewed material and leaves acceptance/omissions open.

The row above describes the format, not an actual finding. Never present invented
source text as evidence. Keep IDs stable so “remove F-02” or “edit F-01” is clear.
Show readable source labels: Title, Description, Acceptance Criteria, Discussion
comment, or a supplied filename and located passage. ADO field paths, generated
requirement/source IDs and revision hashes belong only in internal trace records.
Keep `sources.requirementId` intact in JSON. Use readable finding labels such as
`F-01`; generated `req-...` labels are omitted from the rendered table and summary
without changing stored IDs. Preserve source quotations and requested free-form
wording. Do not scan or reject manual comments or older drafts for internal-looking
terms; normal schema, freshness and exact-approval checks still apply.
User requests can add/remove/edit findings, severity, questions, manual final text
or mentions.
Re-read current state, save the full revised draft with `requirements edit --id <id>
--input <file>` and re-display the recalculated summary, sorted table/current final
comment. Removing a row removes it from the generated outgoing table. Preserve
requested manual final text; do not
silently replace it when the table changes. The current summary is automatically
prepended to generated tables or manual final bodies in preview/post. Explain when
an edit creates a mismatch.

`requirements read|resume --id <id>` returns the current summary/draft/table without
reanalysis.
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
Reassess severity and regenerate the summary. Preserve custom questions/manual
comments as starting points, show relevant old/new
text and obtain approval for current replacement text. Do not carry approvals.

Earlier chat-v1 drafts remain byte-identical and readable, with missing severities
shown as Unrated. Inspect them and assign explicit severity in a version-2 edit
before preview/post, preserving manual text/mentions and review history. Do not
invent default ratings; rating the same saved review does not repeat analysis.

Earlier prerelease UI artifacts remain intact. `read` exposes their references;
legacy exports/UI approvals cannot authorize chat publication. Inspect retained
text, propose any carryover in chat and save a new draft after review. No dependency
installation or legacy browser UI is required.

`requirements plan --id <id>` exposes the existing inventory, IDs/revisions,
acceptance evidence, constraints/dependencies and unresolved decisions read-only.
Link these records; do not duplicate acceptance authority, invoke another analysis
or let plan approval resolve a business-rule question.

## Optional story comment

When the user requests delivery, run `requirements preview --id <id>`. Show exact
returned summary and final text/table, resolved mention recipients, originating
story URL,
reviewed source and the single ordered comment POST. Resolve missing choices before
this final preview. An explicit “approve and post” for the unchanged preview is one
authorization; do not ask again when existing authorization covers that exact text,
destination and people. Pass its fingerprint to `requirements post --id <id>
--approval <hash>`. Any changed summary, severity/order, payload, source/discussion
or recipient requires a new preview and approval. A null comment with zero findings
has nothing to post;
only an explicit user-requested manual comment can override that.

The adapter rechecks freshness and durably records dispatch, comment ID/URL and
mention readback. On uncertainty run `requirements reconcile`; never retry blindly.
An identical new comment is only a candidate. Ask the owner to identify its exact ID
before `reconcile --comment-id <id>` when no durable acknowledgement identifies it.
Mismatched mention readback remains unresolved. Missing access/destination, declined
publication and local-only requirements remain saved. Return the verified comment
link/receipt when completed. No story-field, case, result or other remote writes.
