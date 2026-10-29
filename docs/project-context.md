# Business context

Use `project-context` to build or refresh business understanding from selected
work items and supplied documents. Use `context-update` to refresh the saved
selection, and explicitly invoke `context-qa` to answer from its saved evidence.

Azure and Jira share this workflow. For Jira, save fixed issue keys or JQL, selected
attachments and explicit discussion/history options using [tracker providers](tracker-providers.md).
Refresh reuses that saved selection; permission failures remain unavailable or stale,
never proof that an issue was deleted or a criteria result is empty.

For example: "Build checkout context from stories 83, 90 and 91 plus this document,"
or "Build context from all User Stories in the Checkout area." Later:
"Refresh checkout context." The first selection stays fixed; the second discovers
new matching stories whenever it is refreshed.

## Skill behavior

| Skill | Behavior |
|---|---|
| project-context | Build/update with saved or new selection; save locally unless only a preview is requested. |
| context-update | Refresh the saved documents and exact IDs or criteria; accept an explicit narrower/new selection too. |
| context-qa | Answer a business question using only selected saved evidence, with readable citations. |

A new selection for an existing tracker collection replaces that collection's criteria
and reconciles its membership. Independently selected files/collections remain.
Neither skill creates duplicate facts on repeated refresh. Ordinary questions do
not silently retrieve, refresh or activate snapshot-only Q&A.

Context excludes repository/POM structure, code, configuration and harness
conventions. It does not automatically traverse linked work items or download
attachments. A business document must be explicitly supplied/selected; a tracker
attachment must be explicitly selected from the returned attachment metadata.
Read [the workflow](../.agents/skills/project-context/references/workflow.md) for
request examples, criteria, format readers and extraction receipts.

## Commands and saved selection

```sh
npx --no pom-harness context update --request .harness/runs/context-request.json
npx --no pom-harness context update --id checkout-qa
npx --no pom-harness context retrieve --id checkout-qa
npx --no pom-harness context read --id checkout-qa
npx --no pom-harness context search --id checkout-qa --work-item 83
npx --no pom-harness context search --id checkout-qa --catalog sources
```

`retrieve` is an unsaved preview; `update` publishes a recoverable snapshot.
`stage` stages only selected attachment bytes for host readers.
Use exactly one of `--request` or `--id` for these operations. Source browsing
and search are bounded, cursor-paged and read-only. Work-item/source/topic filters
restrict evidence. An ID query does not include neighboring or related items.

Exact selection uses `ado.scope.workItemIds` (distinct positive numeric IDs).
It skips project-wide enumeration and checks only those items. Missing selected
items remain unavailable/stale, rather than silently becoming a different selection.
Criteria use optional `scope.areaPath` plus the existing type/state policy.
They rerun on refresh, so new matches enter and confirmed departures leave.
Current metadata validates selectors; unknown names/IDs require repair.

Selection precedence is explicit request, saved context, then integration defaults
for a new collection. Saved scope/policy persists across sessions and configuration
drift. A supplied scope replaces the entire scope, so replacing an ID list with
criteria requires a scope without `workItemIds`. Supplying exact IDs without a
policy selects those IDs without inherited type/state restrictions.

Policies retain `includeTypes`, `excludeTypes`, `includeStates` and
`excludeStates`; exclusions win. Explicit empty includes mean none; absent
includes mean unrestricted. A missing policy is not an all-items choice. Query
criteria require explicit selection, while exact IDs already establish it.
Metadata discovery uses `context metadata --request <request>` and its cursors.
`context policy` saves defaults for new selections. No completion state is
automatically excluded. Membership remains bounded to 20,000 items.

Only full content of included work items is read. Revision checks reuse complete
unchanged content. Saved attachment selection is independent of parent revision:
adding an attachment requires its first read even when the parent is unchanged.
Omitted attachment selection reuses the saved list; an empty list clears it.
Unselected relationships are not missing business requirements or coverage gaps.

## Business knowledge and answers

The skills read descriptions, acceptance criteria and actual document content,
then explain business areas, actors, journeys, rules, terminology and dependencies
when supported. Original located passages remain authoritative. A summary may
connect supported facts but cannot invent missing rules or become an independent
source of evidence.

Search returns a human-readable `citation` alongside internal evidence IDs.
Answers use work-item titles/IDs and document names/locations, with relevant
uncertainty. They do not expose hashes, receipt dumps or irrelevant technical
gaps. See [Q&A examples and boundaries](context-qa.md).

Native Markdown captures heading ancestry and sections, preserving lists, tables,
fenced blocks and rule/exception order. Text captures paragraphs. Long sections
retain bounded overlapping chunks. Heading ancestry is location metadata, never
an invented topic or a reason to mark adjacent requirements as conflicting.
Missing and duplicate headings remain distinct located passages.

Search hits include `passageId` and `topic`. When additional conditions, exceptions
or process steps are needed, retrieve a bounded surrounding window:

```sh
npx --no pom-harness context search --id checkout-qa --around <passageId> --source <sourceId> --revision <capture-revision> --before 2 --after 2
```

Use the response/overview capture revision, not a hit's source revision. Before
and after accept 0–5 passages each. Results follow original source order and keep
strict source/item/topic filters; they never traverse related items or another
context. Existing result/byte limits and cursors apply. `omitted` and `cursor`
describe remaining results inside the chosen window. `surrounding.omittedBefore`
and `omittedAfter` count passages beyond it; `excludedByFilters` identifies filtered
neighbors. To extend the window, use another returned passage as the new anchor.
An old revision, foreign source anchor or changed cursor options fails explicitly.

Every evidence hit also includes `section: {chunkIndex, chunkCount, omittedBefore,
omittedAfter, complete}`. Indexes are zero-based; counts refer to that single hit
within its captured contribution, not missing query results or the entire source.
This is available on existing supported captures without refresh or index repair.
It uses immutable chunk references without hydrating the rest of a section.
Search-level `omitted: 0` does not establish section completeness. Even a complete
contribution may be a legacy line, partial host receipt or redacted fragment;
relevant conditions elsewhere and source coverage still need consideration.

`offsets` remain relative to the captured section in UTF-16 characters and UTF-8
bytes. New native documents also return `documentOffsets` relative to the decoded
original and readable section/line locations. Original byte offsets are returned
for UTF-8 inputs (including BOM/CRLF); other encodings return character offsets.
Bounded heading labels can be shortened; original text stays in the capture.

## Storage, provenance and recovery

The consumer owns `.harness/context/<context-id>/`. The existing version-2
storage layout and SQLite FTS5 schema are retained:
- `current.json`: bounded 64 KiB manifest, identity/scope and catalog/index references.
- `objects/<prefix>/<sha256>.json`: immutable sources, facts, chunks, catalogs and selections.
- `indexes/<sha256>.sqlite`: rebuildable local Node 24 SQLite FTS5 index.
- `custom.json`: editable owner notes, preserved with sanitized revision history.
- `history/<revision>.json`: immutable recoverable manifests.

JSON remains authoritative. No server, vector store or model download is required.
Only an explicit update can rebuild an absent/corrupt/old-recipe index. Source
records identify selected business evidence; selection records retain exact IDs
or criteria and explicit attachment selection. Existing unrelated evidence cannot
enter business searches or source catalogs. Older mixed captures require explicit
business-source selection before a full refresh; superseded history stays intact.
The v1 migration path backs up original current/history before publishing v2.

The selected organization and resolved project GUID bind ADO context before
content reads. Credentials remain in existing ignored configuration/environment
mechanisms. A different project requires a different context ID. Captured
read/search/export use no credentials or live source configuration.

Successful reads replace prior contributions. Confirmed exclusions/removals
withdraw support; independent supporting sources survive. Inaccessible, uncertain
or partial sources retain last valid evidence as stale. Extraction receipts bind
to current bytes and precise locations. Local documents are rehashed; unchanged
bytes/reader recipes reuse extraction. Owner notes are not automatically Q&A evidence.

Captures made before section extraction remain usable with the supported business
index recipe; reads/searches perform no migration. Explicit refresh detects the
new native Markdown/text recipe even when file bytes are unchanged. Unaffected
formats and saved host-reader receipts retain their recipes and reusable evidence;
an unavailable original retains stale evidence. JSON storage, index schema and
index recipe stay unchanged. Older unsupported/mixed indexes still require their
existing explicit selection/update path.

The corrected `native-document-sections-v2` reader preserves list-contained fenced
examples, full multiline setext headings and literal separators in plain text.
Explicit refresh upgrades both the original native line reader and sections-v1;
read/search alone never reparses documents. The index recipe remains unchanged.

Regrouping can change fact/chunk/passage IDs, result counts and ranking without
changing business requirements. History remains immutable; new citations/cursors
bind to the refreshed revision. Q&A discards retained old evidence bindings while
preserving the conversational referent. Publication failure keeps the prior usable
snapshot and source selections intact.

Updates build a separate index generation and history manifest, then atomically
switch current under a writer lock. Failed publication leaves current usable.
A changed selection that cannot be verified preserves the previous selection.
Partial updates report gaps and the last complete revision. Investigate interrupted
locks before retrying; never discard an active writer. `context export --id <id>
--out <new-file>` is an explicit diagnostic export, not a Q&A retrieval method.

## Verification

Offline acceptance tests cover exact-ID scope, saved criteria/new matches,
revision reuse, explicit attachment selection, strict filters, old mixed captures,
stale/conflicting evidence, source/project isolation, bounded pagination and
read-only Q&A. Host-answer review separately checks readability; unit tests alone
do not establish model behavior or live ADO access.
