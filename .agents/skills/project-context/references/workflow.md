# Business-source selection and capture

Use the installed runtime from the selected consumer. Examples use
`npx --no pom-harness context ...`; direct package execution is
`node "<package-root>/scripts/project-context.mjs" ... --project-root "<consumer>"`.
Q&A always uses the direct runner and only read/search.

## Select the sources

A context is a saved business-source collection, not a repository inventory.
Resolve the consumer and project/application/environment identity from the request
or established scope. Read connection configuration only as necessary for the
selected ADO destination. Do not scan POM/code, harness skills, root configuration,
reviewed automation knowledge or unrelated files for business evidence.

Create a request under ignored `.harness/runs/`:
```json
{
  "version": 1,
  "contextId": "checkout-qa",
  "identity": {"project": "shop"},
  "scope": {"application": "checkout", "environment": "qa"},
  "sources": [
    {"id": "checkout-guide", "kind": "file", "path": "requirements/checkout.docx"}
  ],
  "ado": {
    "sourceId": "backlog",
    "scope": {"workItemIds": [83, 90, 91]}
  }
}
```

Files may be explicitly supplied absolute paths or consumer-relative paths.
Stable source IDs identify origins across refreshes; do not reassign them.
Repository/POM/code/configuration sources are rejected. File and attachment
observations cannot promote themselves to reviewed knowledge.

Choose either exact work-item IDs or criteria:
- `ado.scope.workItemIds` fixes membership and bypasses project-wide WIQL.
  An empty list deliberately selects none. Optional area/type/state restrictions
  can further narrow that list.
- For criteria, omit `workItemIds`, optionally supply `scope.areaPath`, and
  select live types/states with `ado.policy`. The same criteria run again on
  refresh, admitting new matches.

An explicit request's scope/policy overrides the saved context selection;
otherwise the saved selection wins. Existing integration configuration initializes
a new collection. Supplying a new exact-ID list without a policy means those IDs,
without inheriting old type/state exclusions. To switch back to criteria, supply
the new scope (for example `{"areaPath":"shop\\Checkout"}`) and desired policy.
Other independently selected documents/collections remain until explicitly removed.

## Live ADO criteria

Keep organization/project and credential references in the existing
`.harness/integrations.json`; never put secrets in requests.
The resolved organization and project GUID must match the context. Another
project requires a different context ID.

When criteria are not supplied/saved, run `context metadata --request <request>`
and page every cursor before presenting the relevant live type/state choices.
Reuse valid user choices. Ask only for missing criteria or unknown/removed
selectors; unanswered prompts never mean "all items." Exact IDs already establish
selection and do not require a type/state exclusion interview.

A criteria policy looks like:
```json
{
  "includeTypes": ["<live type referenceName>"],
  "excludeTypes": [],
  "excludeStates": [{"type":"<live type referenceName>","states":["<live state ID>"]}]
}
```
Exclusions win. Absent includes impose no restriction; empty includes select none.
State rules may explicitly use `"type":"*"`. Do not assume standard/localized
names or exclude completed work automatically. An explicit all-items choice uses
empty exclusion arrays. The runtime revalidates metadata on every refresh.

The effective scope/policy is saved with each captured collection. Optional
`context policy --source <name> --policy <json>` sets integration defaults for
new selections; it does not silently overwrite a context's saved criteria.

## Documents and explicit attachments

Read actual business content, including acceptance criteria, conditions, exceptions
and domain terms. Native readers support text, JSON and CSV/TSV. For Word, Excel,
PDF and images use the available host reader and precise section/page/sheet/cell
or image-region locations. Unsupported, password-protected, partial or uncertain
sources remain visible gaps. Never execute embedded content.

`context retrieve --request <request>` previews evidence and byte hashes without
saving. For format-reader extraction, supply:
```json
{
  "hash": "<hash of current bytes>",
  "reader": "<actual reader>",
  "coverage": "complete",
  "parts": [
    {"location":"section Checkout, table 1 row 2","topic":"orders.retention","text":"Submitted orders remain available."}
  ]
}
```
Add this as the selected file's `extraction`. Use complete/partial/uncertain
honestly. Preserve source meaning; never invent rules. Use a shared `topic`
only for the same business question across sources, so disagreements stay visible.
Receipts are hash-bound. When bytes change, use `attemptedHash ?? hash` and
read the new bytes; an old receipt cannot certify new content. For CSV, specify
`encoding` or `delimiter` when needed; these choices persist for refresh.

Selected work items expose `availableAttachments` metadata without downloading
the files. Only explicitly chosen attachment IDs enter `ado.attachments`:
```json
{
  "id": "backlog-attachment-83-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "attachmentId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
}
```
Use the returned identity; do not invent one or select all links automatically.
`context stage --request <request>` downloads only those chosen attachments into
ignored `.harness/runs/context/<id>/`. Saved-source catalog pages expose staged
`localPath` and hashes when the compact preview omits them. Read through the host
format reader and add `extraction` to the selected attachment entry.
The full attachment list replaces that collection's prior attachment selection;
omitting it reuses the saved list. An explicit empty list withdraws all attachment
support. Removed links withdraw old support after successful reconciliation.
An independently supplied file remains independent of its originating work item.

## Build and refresh

`project-context` builds/updates a saved collection by default.
`context-update` refreshes it. Both use the same reconciliation:
```sh
npx --no pom-harness context update --request .harness/runs/context-request.json
npx --no pom-harness context update --id checkout-qa
```
The second form reuses all saved documents and ADO collections. `retrieve` and
`stage` also accept `--id`. Supplying `sources: []` alongside an ADO request
refreshes only that collection. A request containing only version/contextId is
equivalent to `--id`. Explicit removal is `{"id":"checkout-guide","status":"removed"}`.
A missing document alone is not confirmed deletion.

New matches are added, changed evidence replaced and unchanged evidence reused.
Unavailable selected sources retain last valid contributions as stale. Confirmed
exclusions/departures withdraw support without erasing history or independent
origins. Failed selection changes preserve the previous context instead of
publishing evidence under unverified new criteria.

Inspect `saved`, changes and gaps internally. Exit code 2 means selection/repair
is required or the capture is partial. Verify the published overview and retrieve
the passages needed for a readable business explanation. Do not present CLI JSON
as the answer. A transient preview is bounded; save or narrow the request to read
beyond it, according to the user's save preference.

## Saved evidence and recovery

Start with `context read --id <id>`; use `search --query`, `--work-item`,
`--source`, `--topic`, or `--catalog sources` for bounded evidence.
Item/source/topic filters are strict. Defaults are 8 results / 16 KiB; maxima
are 25 / 64 KiB. Continue with the same arguments and returned cursor.
No search reads original sources, changes dates or repairs storage.

Native Markdown groups content by headings (including setext headings); text
groups paragraphs. Conditions, exceptions, lists, tables and fenced blocks retain
their original section and order. Long sections use the existing bounded chunks.
Locations include heading ancestry and original line ranges; `documentOffsets`
locates an excerpt in the decoded original, with original UTF-8 byte offsets for
UTF-8 inputs. Other encodings expose character offsets only. Heading labels are
bounded; full heading text remains in the captured content. Do not assign a shared
business topic merely because different passages have the same heading.

For missing conditions, exceptions or sequence steps, use
`search --around <passageId> --source <sourceId> --revision <capture-revision>`.
The revision is the response/overview revision, not the hit's source revision.
`--before`/`--after` default to 2 and accept 0–5 passages each. Results stay in
source order; existing item/topic filters stay strict. `omitted`/`cursor` page the
selected window; `surrounding.omittedBefore`/`omittedAfter` count passages outside
it, and `excludedByFilters` counts filtered neighbors. A next window needs a new
returned anchor. Adjacency does not establish a business relationship.

The SQLite FTS5 tables and immutable JSON layout stay the same. Source/selection
metadata records the business boundary. Older mixed captures require an explicit
business-source request; old repository evidence is excluded and history remains.
Old index recipes require an explicit update. Owner notes in `custom.json` are
preserved, not automatically treated as business evidence.

Pre-section native captures using the supported business index recipe remain
readable/searchable without migration. Only explicit refresh upgrades selected
native Markdown/text even when bytes are unchanged. Other formats and saved host
extraction receipts keep their contracts; unavailable sources retain stale support.
Regrouping may change fact/chunk/passage IDs, result counts and ranking without a
business requirement change. Keep old history and bind new citations to the new
capture revision. No blanket index recipe bump is needed for this reader change.

Atomic publication preserves current on failure. Inspect an interrupted writer
lock before retrying; never remove an active lock. Use `context export --out`
only when a complete logical snapshot is explicitly requested, never for Q&A.
See the [storage contract](../../../../docs/project-context.md).
