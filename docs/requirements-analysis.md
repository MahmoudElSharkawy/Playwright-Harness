# Requirements analysis and chat review

Invoke `requirements-analysis` to analyze supplied requirements or an Azure DevOps
story. The host AI reads the sources, identifies evidenced gaps and contradictions,
and reviews them with the user in chat. No external analysis skill, browser server,
HTML review page or download/import step is required.

The package owns the skill and deterministic capture, validation, persistence,
rendering and delivery scripts. The consumer owns `.harness/state/requirements/`:
sanitized source snapshots, one acceptance inventory, chat drafts and comment
attempts/receipts. Resolve package files through [ROOTS](../.agents/skills/ROOTS.md).

## User workflow

1. Resolve the project/application, story or supplied files from known context.
   Capture available title, description, AC, discussion and supplied attachments.
   Disclose omissions; never ask the user to repaste accessible content.
2. Analyze the current snapshot once. Show a Markdown table in chat with exactly
   **Findings**, **Type**, **Source material text**, and **Question/Comment for
   Business** columns. Use stable IDs inside Findings. Quote exact source passages
   and their locations; contradictions quote both sides. Zero findings is valid.
3. Let the user add/remove/edit findings, questions, final text and requested
   mentions by conversation. Save edits and re-display the current table. Resume
   the saved draft in a fresh session without another analysis pass.
4. When publication is requested, resolve selected people, preview the exact final
   comment, recipients, destination story and reviewed source, then obtain one
   explicit **approve and post** instruction for that unchanged payload. Saving
   edits or approving a question never authorizes a remote write.
5. Post one discussion comment through the authenticated adapter and return its
   comment link/receipt. Changed content, recipients, source or discussion needs a
   new preview and approval. Reconcile uncertain outcomes before another attempt.

An illustrative table, for a story containing the quoted text:

| Findings | Type | Source material text | Question/Comment for Business |
|---|---|---|---|
| F-01: Expiry duration unspecified | Gap | Description: “The link expires.” | How long should the link remain valid? |
| F-02: Conflicting retry limits | Contradiction | Description: “Three attempts”; AC 2: “Five attempts” | Which retry limit applies? |

The agent presents rendered text and recipient names in chat, not raw JSON,
fingerprints or wire HTML. The commands/formats below are its deterministic tools.

## Capture and acceptance inventory

From an installed consumer, use `npx --no pom-harness requirements ...`. From source,
use `node /path/to/harness/scripts/requirements-analysis.mjs ... --project-root
/path/to/consumer`. Input paths are consumer paths. Keep mutable files out of the
installed package.

```json
{
  "version": 1,
  "project": "sample-shop",
  "application": "checkout",
  "storyId": 200,
  "sources": [
    {"id": "notes", "kind": "file", "path": "requirements.md"}
  ]
}
```

Omit `storyId` for local-only review; local capture never resolves credentials.
The configured [ADO adapter](azure-devops.md) reads the story and paginated
discussion, validates project ownership and handles supplied attachments with the
existing bounded context readers. Unsupported attachments can use host extraction
receipts bound to the exact bytes, reader and location. Missing/redacted/incomplete
material stays explicit. Local sources do not acquire a fictional ADO destination.

```sh
pom-harness requirements prepare --id checkout --request request.json
pom-harness requirements read --id checkout
pom-harness requirements inventory --id checkout --input inventory-decisions.json
```

Each located requirement has one stable ID, source part, UTF-16 slice boundaries,
revision/content identity, acceptance disposition/evidence, assumptions, questions,
constraints and dependencies. Split compound source parts before starting review:

```json
{
  "version": 1,
  "snapshot": "<current snapshot>",
  "partitions": [
    {"partId": "<source part>", "entries": [
      {"id": "req-size", "start": 0, "end": 28},
      {"id": "req-performance", "start": 29, "end": 53}
    ]}
  ],
  "changes": []
}
```

Boundaries must cover the actual source once without overlap or splitting Unicode
characters. The numeric boundaries above illustrate the shape; derive real ones
from the captured text. Acceptance uses an exact full-slice source criterion or a
separate recorded owner decision bound to consumer, snapshot, requirement ID,
content, disposition and statement. Otherwise retain `proposed`, `unknown` or
`needs-decision`. Accepting a review/question/plan does not accept a business rule.
Missing data/preconditions, measurable nonfunctional targets, unspecified boundary
semantics and contradictions remain unresolved. Keep unanswered existing discussion
concerns in the inventory without automatically repeating them in the BA comment.

## Chat draft format and editing

Use the returned current `consumer`, `snapshot` and `head`; do not invent them.

```json
{
  "version": 1,
  "consumer": "<current consumer fingerprint>",
  "snapshot": "<current source fingerprint>",
  "head": "<current state head>",
  "findings": [
    {
      "id": "F-01",
      "type": "Gap",
      "finding": "Expiry duration unspecified",
      "sources": [
        {"requirementId": "<existing inventory ID>", "quote": "The link expires."}
      ],
      "question": "How long should the link remain valid?"
    }
  ],
  "comment": null,
  "mentions": []
}
```

`type` is exactly `Gap` or `Contradiction`. Every source quote must occur within
its current inventory slice. Contradictions require two distinct source passages.
Finding IDs are unique and stable across edits. Scripts validate evidence binding;
the AI/user still judge whether a gap or contradiction is meaningful.

```sh
pom-harness requirements review --id checkout --input draft.json
pom-harness requirements edit --id checkout --input edited-draft.json
pom-harness requirements resume --id checkout
```

`review` and `edit` save the full current selection, so removing a finding removes
its row. Re-read before editing and pass the latest head; stale/foreign/malformed
edits cannot overwrite valid state. `comment: null` generates the outgoing table.
A nonempty plain-text `comment` replaces that body with the user's manually edited
final text. It is escaped, not interpreted as HTML/Markdown. An empty findings array
has no generated outgoing comment; an explicit manual comment needs user intent.

Drafts are immutable, content-addressed files linked by parent revision under
`reviews/<review-id>/`. The current record links the latest draft. History retains
manual text, deleted findings and prior questions; edits do not increment the
analysis count. No draft status silently represents publication approval.

## Requested team-member mentions

Only look up and include mentions requested by the user. `mentions` contains exact
display names, account names/emails or ADO identity GUIDs. Use this read-only command
to show candidate names/account identifiers when clarification is needed:

```sh
pom-harness requirements members --id checkout
```

The existing authenticated transport lists the configured project's teams and their
paginated members. It never follows identity URLs into another host or scans other
projects. The documented endpoints require project/team read access (`vso.project`
or `vso.profile`); posting also needs the existing work-item write permission.
API visibility limits which teams can be returned. Results are scoped candidates,
not proof that a person is absent from the entire organization. Inaccessible,
malformed, nonadvancing or oversized returned rosters fail closed. Bounds are 100
teams, 10,000 members per team and 10,000 distinct people.

Deduplicate a person across teams and multiple selectors. Match only exact values,
case-insensitively. Duplicate display names require the user's account/GUID choice;
never pick the first match. Requests such as “the BA” require a named recipient;
roles are not identities. Missing, inactive, deleted and group identities cannot be
silently converted into plain `@Name` text. Preview each selected display name,
account and identity ID; a changed selection/name invalidates approval.

The adapter generates Microsoft's native person-mention markup only from resolved
identities. All source, question, manual-comment and display-name text is escaped.
Roster resolution is repeated before dispatch and exact person IDs must appear in
comment readback. A changed/missing mention leaves delivery uncertain until
reconciled; do not repost just to fix readback. Notification delivery itself depends
on ADO/user settings and is not proven by synthetic API fixtures.

Official contracts: [person mentions](https://learn.microsoft.com/en-us/azure/devops/organizations/notifications/at-mentions?view=azure-devops),
[project teams](https://learn.microsoft.com/en-us/rest/api/azure/devops/core/teams/get-teams?view=azure-devops-rest-7.1),
[team members](https://learn.microsoft.com/en-us/rest/api/azure/devops/core/teams/get-team-members-with-extended-properties?view=azure-devops-rest-7.1),
and [comment creation/readback](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/comments/add-work-item-comment?view=azure-devops-rest-7.1).

## Preview, post and recovery

```sh
pom-harness requirements preview --id checkout
# Show exact returned comment/table, resolved people, story URL and ordered write.
# Only after explicit user approval of that unchanged preview:
pom-harness requirements post --id checkout --approval <preview-fingerprint>
pom-harness requirements reconcile --id checkout
# If no durable acknowledgement identifies the exact candidate, ask the owner:
pom-harness requirements reconcile --id checkout --comment-id <identified-id>
```

The fingerprint binds draft/state, source snapshot, final text, resolved people,
origin story and ordered single POST. Only `post` can issue that write. The API's
HTML comment format carries the escaped table/text and generated mention anchors;
it is never a separate review UI. Before dispatch the adapter rechecks originating
project, source/discussion and recipients. ADO offers no atomic conditional comment
POST: changes after the last read remain a documented race.

Durable attempts and authenticated delivery receipts retain request identity and
acknowledged comment IDs. Uncertain outcomes cannot be automatically replayed.
Reconciliation verifies exact destination/text/mention IDs and never treats an
identical new comment alone as proof of authorship. Declined publication, missing
access and local-only review keep their saved drafts. No story fields, cases,
results or test expectations are modified.

## Refresh, legacy artifacts and planning

Refresh through `prepare` with the original request. A changed source/discussion
invalidates current acceptance evidence and moves the prior review into history.
Reassess source and finding meaning, even with reused IDs. Preserve manual text as
the starting point and show changes before approving replacement final text. Old
decisions never automatically carry into the current draft.

Earlier PR builds used GapCue. Their source/inventory/exports/pages are preserved,
but the new workflow neither executes nor imports that integration. `read` exposes
legacy artifact references; `resume` gives an actionable legacy disposition. Inspect
retained files, present any proposed carryover text in chat and save a newly reviewed
draft. A legacy UI approval never grants publication permission. Installation repair
does not delete those consumer files.

`pom-harness requirements plan --id checkout` returns read-only references to the
single inventory, stable IDs, source revisions/evidence, unresolved decisions and
current review. A caller can detect stale snapshot/inventory references without
another analysis or remote write. Future test design can follow the same chat
review/approval convention; this change does not implement that skill or a generic
review framework.

## Validation and limits

Run `npm run test:requirements` for source/inventory, chat edit/resume, seven-story
quality-corpus boundaries, exact approval, mention resolution/readback and durable
reconciliation regressions. The quality corpus is an authored acceptance fixture,
not an automated benchmark of arbitrary AI analysis. Independent review must assess
its questions and absence of invented expectations separately from transport tests.
Run the affected ADO, root/adoption and package checks before delivery.

Team lookup/post/readback tests use authenticated synthetic API fixtures. A live
comment or delivered notification is not claimed without an authorized live check.
