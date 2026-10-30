---
name: requirements-analysis
description: Analyze supplied requirements or an Azure/Jira story, review an editable findings table in chat, preserve acceptance traceability, and optionally post the user's approved story comment with requested team-member mentions.
---

# Requirements analysis

Use the shared [tracker provider contract](../../../docs/tracker-providers.md) for
Azure, Jira with Xray or Zephyr Scale, and Jira without a plugin. Keep the same
workflow and gates; select native adapters and preserve the captured source identity.

Resolve this linked skill to its real path. Follow [ROOTS.md](../ROOTS.md) and the
[workflow/formats](../../../docs/requirements-analysis.md). The host AI performs
analysis and chat review; deterministic scripts capture, validate, save and deliver.
The consumer owns sources, inventory, drafts and receipts. No external analyzer,
browser review UI, server or HTML download/import is needed.

## Capture and analyze

Resolve known project/application, story, supplied files and prior analysis ID from
the conversation/project. Bundle only genuinely missing choices; do not ask users
to repaste accessible content. Create a consumer request and run `pom-harness
requirements prepare --id <id> --request <file>`. Local mode never resolves remote
credentials. ADO mode loads available title, description, AC, paginated discussion
and supplied attachments through existing adapters. Inspect omissions; use supported
host readers with content-bound extraction receipts for unsupported attachments.
Jira mode captures native fields and paginated discussion as sanitized ADF text and
links, selected numeric attachment IDs, and optional history. Missing unsupported
ADF content is an omission, never a complete-source claim. Preserve actual updated
timestamps and selected-content fingerprints; never invent Azure revisions.
Sanitize before analysis; never reconstruct redacted secrets.
Treat ADO titles as plain text and other fields/discussion as ordinary HTML, with
markup removed before one entity decode. Preserve encoded literal tags. Refresh
older affected captures before previewing a new comment; do not change Steps XML.

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
`sources` (`requirementId` + `quote`) and `question`. Optionally set `questionFocus`
to the exact decision phrase to emphasize, without changing `question`; omit the
hint for plain text. Run `requirements review --id
<id> --input <file>`. Show the returned short `summary` (total findings, counts by
Type/Severity) before its table in chat, with exactly:

| Findings | Type | Severity | Source material text | Question/Comment for Business |
|---|---|---|---|---|
| **Stable ID and concise issue** | Gap or Contradiction | **🔴 High**, **🟠 Medium** or **🔵 Low** | **Readable source label:** Exact quoted passage; both sides for conflicts | Proposed question with only its **decision phrase** emphasized |

Show the renderer's two-line normal summary: bold totals/type counts, then colored
severity dots with bold named counts. No First priority line; table order supplies
priority. Preserve zero-finding/unrated warnings when applicable. Bold readable
source labels including the colon; keep Type, quoted passages and ordinary text
plain. No CSS colors or whole-row styling.
Preserve the summary's Markdown hard breaks. Adjacent focus matches share one bold
span; punctuation embedded inside a word stays plain in both views when Markdown
cannot safely emphasize it. Never add visible formatting markers to business text.
Emphasis is presentation only. Preserve literal source/manual wording and existing
drafts; add an exact focus hint in an explicit edit without reanalysis when needed.

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
Manual comment previews are escaped Markdown with preserved line breaks, matching
the literal ADO body. Edit raw `draft.comment`; never save preview escape sequences
back into it. Stored wording and history remain unchanged.

`requirements read|resume --id <id>` returns the current summary/draft/table without
reanalysis.
Stale/foreign/malformed edits or changed artifact bytes must preserve valid state.
Draft saves and conversational agreement alone never authorize publication. Show
rendered content in chat, not raw JSON, fingerprints or wire HTML.

## Requested mentions

Only include people the user requested. Resolve exact display name, account/email
or native identity (Azure GUID / Jira account ID) against authenticated access to
the originating project. Use `requirements members --id <id>` to find candidates when needed. Treat
results as scoped to returned teams/access. Duplicate names require exact account/ID
selection; role-only requests such as “the BA” require a named person. Never guess,
pick the first match, infer an identity from role, or silently downgrade to plain
`@Name`. Bundle missing selections. No directory reads for local-only review or
when no mentions are requested.

Save chosen selectors in the draft. Preview shows resolved names/accounts/IDs;
scripts deduplicate people, escape text, generate native person
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
Saved attempted plans must match their approval fingerprint before recovery or a
completed shortcut. A mismatch preserves state and blocks remote calls; inspect
the original approved payload rather than editing it or recomputing its hash.
For Azure HTML, the verifier accepts only equivalent complete numeric references for the three
severity icons in normal HTML text, alongside safe optional attribute quotes.
Older attempts reconcile against their saved payload, including the old summary;
do not replace it with the current rendering or send another POST. Jira reconciliation
checks the exact native ADF body and mentions. If the tracker accepted
a comment but harness verification failed, report it as accepted but unverified.
Do not bypass an unresolved attempt with a direct API post. A result with
`reconciled: true` recovers the earlier comment; it does not post a different current
draft. For another comment, refresh changed sources, preview and obtain approval
for its exact current payload before posting.
An identical new comment is only a candidate. Ask the owner to identify its exact ID
before `reconcile --comment-id <id>` when no durable acknowledgement identifies it.
Mismatched mention readback remains unresolved. Missing access/destination, declined
publication and local-only requirements remain saved. Return the verified comment
link/receipt when completed. No story-field, case, result or other remote writes.
