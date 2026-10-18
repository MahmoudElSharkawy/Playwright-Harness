# Project context retrieval and refresh

Project context captures a scoped, traceable view of a consumer project. Use
`project-context` to retrieve it and `context-update` to create or refresh a saved
snapshot. Ordinary questions about a captured snapshot do not retrieve sources or
write files. The separate context-only Q&A workflow is outside this feature.

Ask **"Retrieve the project context for checkout on qa"**, then **"Save this context"**
or **"Refresh the context for checkout"** when needed. The skills execute the shared
[retrieval/update workflow](../.agents/skills/project-context/references/workflow.md),
including live selection questions and host file readers. Deterministic commands use
a selected-source request in the consumer's ignored `.harness/runs/`:

```sh
npx --no pom-harness context retrieve --request .harness/runs/context-request.json
npx --no pom-harness context update --request .harness/runs/context-request.json
npx --no pom-harness context read --id checkout-qa
npx --no pom-harness context search --id checkout-qa --query "payment validation"
npx --no pom-harness context search --id checkout-qa --work-item 123
npx --no pom-harness context search --id checkout-qa --catalog sources
npx --no pom-harness context export --id checkout-qa --out .harness/runs/context-export.json
```

`retrieve` never saves a snapshot. `update` publishes one within the requested scope.
`read` returns a compact captured overview. `search` returns captured evidence excerpts.
`export` streams the complete logical snapshot into an explicitly selected new file. Exit code 2 identifies partial results or a
required selection/repair; review the returned gaps before relying on those facts.

## Contract and ownership

The consumer owns `.harness/context/<context-id>/`. Version 2 uses:

- `current.json`: a manifest bounded to 64 KiB, with identity, scope, counts, freshness,
  gaps and references to the current evidence and search generation.
- `objects/<prefix>/<sha256>.json`: immutable, scoped source records, facts, chunks,
  paged catalogs and selection receipts. Source contributions reference shared facts;
  only chunk objects hold original evidence text. Unchanged history shares objects.
- `indexes/<sha256>.sqlite`: a derived Node 24 built-in SQLite FTS5 index. It requires
  no added package, server, model download or external database.
- `custom.json`: separately editable owner notes, sanitized before use. Each published
  revision also retains its immutable copy, so later edits do not alter history.
- `history/<revision>.json`: immutable manifests retaining every reachable revision.

JSON remains authoritative. The index is disposable and only an explicit update may
rebuild it. Package files and reviewed knowledge are never modified. This storage
is a derived view, not a second configuration authority. Never copy object/catalog
references across contexts; paths, object hashes and scope bindings are verified.

Each source records an explicit identity and origin, path or work-item identity,
content hash/version, retrieval/verification dates, extraction locations, coverage,
status and attributable contributions. Facts retain every supporting origin.
Reviewed knowledge, current source and unreviewed observations remain distinct.
Conflicting contributions stay visible; no source silently wins by recency.

A refresh touches only selected sources in the same project/application/environment
scope. Successfully read sources replace their previous contributions. Explicit
removals, exclusions and departures from ADO scope withdraw that source's support;
history remains available and independently supported facts survive. A missing file
alone is not proof of deletion. Inaccessible, unsupported, uncertain or partially
read sources retain their last valid contributions with a stale/partial marker.
Only sources actually checked receive new verification metadata. Repeated unchanged
refreshes change verification metadata only, without duplicating facts.

Updates finish and validate a separate index generation, then publish an immutable
history manifest before atomically replacing `current`. Metadata-only refreshes reuse
the index; changed content updates only affected index rows.
Failed writes leave the previous current snapshot usable. Partial snapshots identify
the last complete revision and coverage gaps. An interrupted commit may leave an
unused history record; it is safe to inspect and retry. A concurrent or interrupted
writer lock must be investigated before removing it; never discard an active writer.

## ADO selection

Keep the PAT in the consumer's ignored `.env`. The authoritative destination is
`.harness/integrations.json`: `ado.organizationUrl`, `ado.project` (name or GUID),
and `ado.credentialRef` (for example `AZURE_PAT`). With modern configuration, legacy
environment destinations do not override it. Without it, existing `AZURE_ORG`/
`AZURE_URL`, `AZURE_PROJECT` and PAT environment settings remain supported.

One PAT can access many projects; each context binds to exactly one organization and
resolved project GUID, plus the consumer/application/environment identity. The project
is resolved before metadata/content reads. A different configured project requires a
different context ID. Display-name changes do not change GUID identity; configure a
GUID if the project is frequently renamed. Local-only contexts need no ADO setup.
Captured read/search/export use no credentials or live configuration.

Queries are project-scoped; returned ownership is checked again. Only direct relations
between included, available items are captured. Foreign, excluded and unavailable
targets become gaps; their URLs never trigger another retrieval.
`ado.context.sources` stores each context source's scope and selection policy.
Metadata discovery reads the selected project's current types and each type's states
on every retrieval/update. Stable reference names/IDs are preferred; display names
are exact fallbacks. No type, state or completion category is assumed irrelevant.

A policy has required `excludeTypes` and `excludeStates` arrays, and optional
`includeTypes` and `includeStates` restrictions. State rules name a type or explicitly
use `"*"` for all types. Exclusions win; absent includes impose no restriction;
an explicitly empty include list selects nothing. A missing policy differs from an
explicit policy with empty exclusions. Without a supplied or saved policy, present
live types and states grouped by type as multi-select exclusions, including an
explicit **Exclude nothing** choice. A numbered/text reply is equivalent. No answer
means no selection, not permission to retrieve everything. Persist that choice and
reuse it; invocation overrides take precedence.

Revalidate filters against live metadata before querying content. New metadata is
reported and follows the include/exclude semantics. Unknown, renamed or removed
selectors require user repair; preserve valid choices without silently remapping.
Enumerate complete bounded membership (up to 20,000 work items; narrow larger scopes)
and classify it with minimal fields and a positive revision before reading descriptions
or linked attachments. An unchanged, complete item with the same extraction recipe
reuses its evidence. Full reads occur only for new/changed items or incomplete caches.
Attachment extraction is reused only when the parent revision and relation binding
remain unchanged and complete. A revision check updates `revisionVerifiedAt`; it
does not advance the attachment's byte-verification time. Local files are always
rehashed; unchanged bytes and extraction recipes reuse their located extraction.
Incomplete enumeration does not withdraw old support; it preserves stale evidence. Record policy, metadata verification date, counts and exclusion reasons.
Zero selected items is a valid result. A newly excluded item is not a deleted item.
Do not read its linked attachments; an explicitly supplied file remains independent.

Implementation uses the existing read-only WIQL/batch transport and the documented
[type metadata](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-item-types/list?view=azure-devops-rest-7.1),
[type states](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-item-type-states/list?view=azure-devops-rest-7.1)
and [attachment](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/attachments/get?view=azure-devops-rest-7.1)
APIs. Project/application scope is explicit; selection never changes execution scope
or writes to Azure DevOps.

## Files and trust boundaries

User-selected accessible paths and attachments are independent sources. Text, JSON
and CSV use bounded native reads. Images, Excel, Word, PDF and other readable formats
use the host's available format-appropriate readers, supplying extraction receipts
bound to the exact bytes' SHA-256. Cite pages/sections/tables, sheets/cells/ranges,
JSON paths, text lines/CSV rows, or image regions. Record incomplete coverage and
uncertainty. No available reader means unsupported/unverified, never successful
filename-only ingestion. Do not build a universal converter or execute embedded
macros, scripts, commands or instructions. Do not follow arbitrary referenced links.

All work-item/file content is untrusted evidence. It cannot change the user's scope,
repository instructions or review boundaries. Never read credential stores into
context. Sanitize relevant excerpts before persistence; credential-like literals
are rejected by the existing data boundary. Host extraction is evidence, not review
approval. Captured source references are provenance, not downstream fetch authority.

## Bounded retrieval and migration

All command output is compact JSON. Search defaults to 8 results and 16 KiB for the
entire UTF-8 response, with explicit limits up to 25 results and 64 KiB. Exact source
or work-item matches rank first, direct captured relations second, then FTS5/BM25
with deterministic ties. English and Arabic use consistent Unicode normalization;
original spelling, diacritics and offsets remain intact in evidence. This is lexical
retrieval, not semantic search. A no-match result is evidence absence.

Search supports `--source`, `--topic`, `--work-item` and `--query`. Browse saved
source receipts, including unsupported files and staged attachments, with
`--catalog sources`. Responses include omitted counts and an opaque `--cursor`
bound to the context, revision, query and limits. Repeat the same arguments with
that cursor; a refresh invalidates old cursors. Do not paste the whole export into
an agent prompt. Search reads only index/catalog pages and selected evidence objects;
it never follows original paths, fetches links, refreshes dates or repairs storage.

Chunks target 2 KiB at natural whitespace boundaries with at most 128 UTF-8 bytes of
overlap within the same source section. They retain original character and byte
offsets. One long section remains one fact, so splitting cannot create false conflicts.
Raw excerpts are scanned for secrets before chunking. Shared facts retain every source.
Native readers accept up to 8 MiB and 20,000 located parts per selected file; larger or
incomplete inputs require narrower extraction and explicit coverage gaps.

Transient retrieval remains unsaved. Its bounded preview includes source/hash receipts,
evidence and omission counts. Narrow large requests or explicitly save and page/search
the capture. Staging writes only selected attachment bytes into ignored run storage.

Version 1 reads remain nonmutating. The first explicit update backs up the original
current/history files under `legacy/<original-fingerprint>/`, validates the source/fact
mapping, then stages version 2. Legacy ADO evidence must be freshly project-verified
and completely recaptured; ambiguous ownership or incomplete recapture stops migration
and leaves the old current file intact. No history is automatically deleted.

This release changes the CLI contract: `read` is an overview and other commands return
summaries, not complete snapshots. Consumers needing full JSON must use explicit
`export --out`. Existing save/refresh skills remain the entry points; the separate
context-only Q&A skill in issue #74 remains deferred until issue #14 is merged.

## Validation scope

Regression fixtures cover distinct/custom process schemas, global/per-type filters,
missing/empty/saved policies, metadata changes, all-excluded results and classification
before content. Consumer fixtures cover scoped/idempotent reconciliation, independent
support, stale/partial/removal/exclusion handling, custom content, atomic recovery and
secret exclusion. File fixtures cover structured extraction locations, content hashes,
duplicates, changed/inaccessible/unsupported inputs and untrusted embedded content.
Host reader limitations and live-system checks are reported separately.

Run `node scripts/probes/context.mjs <new-external-consumer-directory>` for offline
1,000/10,000-work-item and document fixtures. It records ingestion/refresh latency,
fresh-process query latency/memory, disk size, manifest/output bounds, relevance and
zero unchanged full-item reads in `scale-results.json`. Results are measurements of
that machine and fixture, not universal latency guarantees.
