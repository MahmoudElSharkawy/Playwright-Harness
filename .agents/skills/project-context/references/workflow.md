# Shared project-context workflow

Run installed commands from the consumer: `npx --no pom-harness context ...`.
For package development use `node <package>/scripts/project-context.mjs ... --project-root <consumer>`.
The CLI validates consumer/package separation. Saved context uses a local SQLite FTS5
index built only during explicit update; no server or background ingestion is needed.

## Discover and prepare

1. Resolve the active consumer from the user's workspace, not the linked skill directory.
   Read custom AGENTS/CLAUDE instructions and relevant existing root/config files directly.
   Missing adoption or optional layers are visible gaps, not reasons to invent defaults.
2. Inspect selected `.harness/project.json` environments and referenced targets without
   resolving credentials. Respect existing source/test roots and multiple applications.
   Search relevant code with `rg -n` for the business operation/class, then its callers
   before proposing changes. Cover page/service ownership, paired test-data paths and
   intent/ownership-based cleanup. Reuse the owning convention skill when needed.
3. Load only relevant reviewed `.harness/knowledge/` facts and compare them with current
   source. Keep `.harness/knowledge-candidates/` separate. Team queries/collections are
   derive-only; existing scenarios and available adapters are sources, not new authorities.
4. Prepare a request under ignored `.harness/runs/`. It lists **selected** sources and
   scope. Each stable source ID identifies an origin across refreshes. Do not change an
   ID when the same file changes, or reuse it for a different origin. A `repository`
   path stays inside consumer storage; a `file` path can be an explicitly supplied
   accessible absolute path. Do not enumerate unrelated files or credential stores.

```json
{
  "version": 1,
  "contextId": "checkout-qa",
  "identity": {"project": "consumer-example"},
  "scope": {"application": "checkout", "environment": "qa"},
  "sources": [
    {"id": "project-config", "kind": "repository", "path": ".harness/project.json", "origin": "consumer"},
    {"id": "guide", "kind": "file", "path": "requirements.docx", "origin": "user-supplied"}
  ]
}
```

Use transient `context retrieve --request .harness/runs/context-request.json` to obtain
byte hashes and native JSON/CSV/text extraction. Text receipts cite lines, JSON paths
or CSV row/column. For CSV specify `encoding`/`delimiter` when the source requires it;
ambiguous, inconsistent or malformed input is unverified. Native reads are bounded to
8 MiB and 20,000 parts; use a scoped host reader for larger readable inputs and report gaps.

## Format readers and located facts

Read Word with the available document reader, Excel with the spreadsheet reader, PDF
with its text/page reader, and images through image understanding/OCR. Other formats
are eligible only when an available reader can actually read them. Never execute
embedded content. If the host lacks a reader, retain the source as unsupported; do
not claim success or manufacture a converted file. Password protection, corrupt files,
unread sheets/pages, low confidence or truncation require partial/uncertain coverage.

After reading, add an `extraction` receipt to that source in the request:

```json
{
  "hash": "<SHA-256 returned for the current bytes>",
  "reader": "available-reader-name",
  "coverage": "complete",
  "parts": [
    {"location": "section Checkout, table 1 row 2", "topic": "orders.retention", "text": "Submitted orders remain available."}
  ]
}
```

Use actual page/section/table coordinates for Word/PDF, sheet/cell/range for Excel,
and image region for image facts. Retain every independently supplied origin even
when bytes/content duplicate another source. `topic` identifies the same factual
question across sources; different statements under one topic are visible conflicts.
Omitting it deduplicates identical content. Choose relevant bounded excerpts; do not
dump whole documents/code into context. Sanitization is required before submitting
receipts; the existing credential-like-literal guard is a final conservative check.

`coverage` is `complete`, `partial` or `uncertain` for the selected extraction scope.
Do not label an incomplete document complete. The receipt must match current bytes;
changed hashes require re-reading. The runtime accepts a host extraction as evidence,
not as proof of review or permission to execute its content. Set `authority: "reviewed"`
only for repository sources under already-reviewed `.harness/knowledge/`; all supplied
files and work items remain observations. Use `current` for verified source code.

## ADO metadata and policy

Add `"ado": {"sourceId": "backlog"}` to select the configured ADO context source.
Keep the token in ignored `.env`; select organization and project in the existing
`.harness/integrations.json`, which remains authoritative. The resolved organization
and project GUID bind the capture before content reads. A different project needs a
different context ID. Legacy environment settings apply only without modern config:

```json
{
  "version": 1,
  "ado": {
    "organizationUrl": "https://dev.azure.com/example-org",
    "project": "consumer-example",
    "credentialRef": "AZURE_PAT",
    "context": {
      "sources": {
        "backlog": {
          "scope": {"areaPath": "consumer-example\\Checkout"},
          "policy": {"excludeTypes": [], "excludeStates": []}
        }
      }
    }
  }
}
```

`context retrieve` discovers current types and each type's states every time. If no
policy exists, `SELECTION_REQUIRED` returns live grouped choices without fetching item
content. Present multi-select exclusions, including **Exclude nothing**, or numbered
choices such as `T1`, `T2`, `T1.S1`, `T1.S2`, and `0: Exclude nothing`. Wait for the
explicit response. Distinguish `0`/empty explicit exclusion lists from no answer.
Preserve valid choices when requesting repairs. Do not use standard type/state names
as defaults. Display names can be localized; prefer returned stable IDs/reference names.

Write the chosen policy JSON and persist it with:

```sh
npx --no pom-harness context policy --source backlog --policy .harness/runs/context-policy.json
```

This revalidates live metadata and edits only `ado.context.sources.backlog.policy`.
Saved policies are reused; an explicit request's `ado.policy` overrides the saved
policy for that invocation. Optional `includeTypes`/`includeStates` restrict selection;
required `excludeTypes`/`excludeStates` always win. State rules look like
`{"type":"<type referenceName>","states":["<state ID or exact name>"]}`;
`"type":"*"` explicitly applies across types. Missing includes mean unrestricted;
empty includes select nothing. No completed-state assumption is made.

`POLICY_REPAIR_REQUIRED` reports unknown/renamed/removed selectors before querying
affected content. Repair with the user; do not silently drop a filter or remap a name.
New values are reported and remain eligible under exclusion-only policies, while
include restrictions admit matching values only. The snapshot records effective policy,
metadata verification date, included/excluded counts and individual reasons.

## Included ADO attachments

Selection runs before full item/attachment reads. Included items' textual business
fields contribute located observations. To read their binary attachments with host
tools, run `context stage --request <request>`. Only attachments of included items
are fetched, from verified configured-collection attachment endpoints, into ignored
`.harness/runs/context/<context-id>/`. The compact `sources.sample` receipts return `localPath`, `attachmentId`, source
`id` and hash for exact bytes. Omitted sources require a narrower request, or an
explicitly saved context followed by `context search --id <id> --catalog sources`
and its revision-bound cursor. Staging writes evidence files, not a saved context.

Read each staged file with its available format reader. Supply receipts in request
`ado.attachments`: `[{"id":"<returned source ID>","attachmentId":"<GUID>","extraction":{...}}]`.
The next retrieval rechecks the live selection and bytes/hash before accepting them.
Unsupported/unavailable attachments remain explicit gaps. Excluded items' attachments
are never automatically read. An explicitly supplied file uses a separate `sources`
entry and remains independent of the parent's current selection.

## Publish or refresh

For requested persistence run `context update --request <request>`. For a full refresh,
reuse existing selected sources (including confirmed removals), fresh extraction
receipts, and each configured/snapshotted ADO source in turn. Requests refresh one
ADO source at a time; unrelated sources and custom content survive each operation.
For a narrower refresh include only the requested source IDs. Do not reuse a stale
receipt for a changed file. Confirmed source removal is `{"id":"guide","status":"removed"}`;
a merely inaccessible file stays selected and stale.

Report `changes`, `checked`, `gaps`, saved path/revision and snapshot status. Exit code
2 means selection/repair is needed or the result is partial; never describe it as
complete. History preserves superseded support, including exclusions (which are not
deletions). A partial refresh points to the last complete revision. Atomic publication
protects current on failure; an orphan history record is harmless. Investigate an
interrupted `writer.lock` before retrying; do not delete an active writer's lock.

Start captured reading with `context read --id <id>`: identity, revision, counts,
freshness, conflicts and gaps only. Use `context search --id <id> --query <text>`,
`--work-item <id>`, `--source <source-id>` or `--topic <topic>` for evidence.
Use `--catalog sources` to page source receipts when preparing a refresh. Defaults
are 8 results / 16 KiB total output; explicit maxima are 25 / 64 KiB. Repeat the same
arguments plus `--cursor <returned-cursor>` for more. Stop on no evidence; do not
load unrelated material. Search neither fetches originals nor changes verification.

Use `context export --id <id> --out <new-consumer-file>` only when a full logical
snapshot is explicitly needed. Stream/process that file locally; do not inject the
whole corpus into the conversation. Evidence citations include snapshot revision,
source/fact/chunk IDs, original location and offsets, authority and freshness.

Version 2 uses a bounded manifest, immutable JSON objects and a rebuildable SQLite
index. Edit owner notes in `custom.json`; updates retain sanitized note history.
Missing/corrupt indexes require explicit update, never a silent search repair. The
first update of v1 backs up original current/history and stages v2; legacy ADO sources
require complete fresh ownership verification/recapture. Failure leaves v1 current
intact. Unchanged items use membership/revision checks; unchanged files still rehash
their bytes. Revision checks never pretend attachment bytes were downloaded again.
