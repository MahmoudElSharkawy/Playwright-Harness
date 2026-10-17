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
```

`retrieve` never saves a snapshot. `update` publishes one within the requested scope.
`read` consumes captured content only. Exit code 2 identifies partial results or a
required selection/repair; review the returned gaps before relying on those facts.

## Contract and ownership

The consumer owns `.harness/context/<context-id>/current.json` and immutable
`history/<revision>.json` snapshots. Package files and reviewed knowledge are never
modified. Snapshots contain version, project identity, application/environment scope,
revision, capture/update dates, source records, deduplicated facts and ADO selection
receipts. `custom` content is preserved verbatim during refresh. This storage is a
derived view, not a second configuration authority.

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

Updates publish an immutable history record before atomically replacing `current`.
Failed writes leave the previous current snapshot usable. Partial snapshots identify
the last complete revision and coverage gaps. An interrupted commit may leave an
unused history record; it is safe to inspect and retry. A concurrent or interrupted
writer lock must be investigated before removing it; never discard an active writer.

## ADO selection

Use the existing `.harness/integrations.json` ADO destination and credentials.
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
Classify in-scope items with minimal fields before reading descriptions or linked
attachments. Record policy, metadata verification date, counts and exclusion reasons.
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

## Validation scope

Regression fixtures cover distinct/custom process schemas, global/per-type filters,
missing/empty/saved policies, metadata changes, all-excluded results and classification
before content. Consumer fixtures cover scoped/idempotent reconciliation, independent
support, stale/partial/removal/exclusion handling, custom content, atomic recovery and
secret exclusion. File fixtures cover structured extraction locations, content hashes,
duplicates, changed/inaccessible/unsupported inputs and untrusted embedded content.
Host reader limitations and live-system checks are reported separately.
