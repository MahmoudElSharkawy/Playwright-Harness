---
name: context-update
description: "Create or refresh consumer-owned project context when explicitly invoked or asked to update the project context, refresh context for an application, or save a retrieved context map. Reconcile selected repository, ADO and file sources with provenance while preserving custom content and the last valid snapshot. Ordinary context questions do not activate refresh."
---

# Update project context

An invocation authorizes this scoped context update. Perform it; do not stop at a plan
or ask for duplicate approval. Resolve the real skill path and consumer roots using
[ROOTS](../ROOTS.md). Follow the same [retrieval workflow](../project-context/references/workflow.md)
and [context contract](../../../docs/project-context.md). This skill owns refresh;
it does not promote reviewed knowledge, change test scope or deliver to external systems.

Read the compact overview first with `context read --id <id>`. Page source receipts
with `context search --id <id> --catalog sources` when rebuilding the refresh request. Match consumer,
application and environment identity. For missing initial context, retrieve the requested
sources and create it. Otherwise refresh only requested sources, preserving unrelated
sources and custom content. When no narrower scope is requested, reuse the snapshot's
selected repository/file sources and configured ADO context sources. Rehash local
bytes and revalidate live metadata/membership/revisions. Reuse complete unchanged
extraction; old receipts are not proof for changed bytes. Verify the configured ADO
organization and resolved project GUID before retrieval; never reuse another project
under the same context ID. Owner notes live in `custom.json` and retain history.

Before ADO content reads, refresh metadata and validate supplied/saved filters. Reuse
valid choices. Missing policy requires live multi-select/text exclusions with **Exclude
nothing**; unanswered prompts do not select everything. Request repair for unknown or
removed selectors without discarding valid choices. New values follow the include/exclude
semantics. Exclusions win, including conflicting includes; completion alone excludes nothing.

Extract relevant supplied files and included work-item attachments through available
readers, with hash-bound locations and coverage. Reconcile changed files, duplicate origins,
newly excluded items and removed attachments. An independently supplied file remains
selected even if its originating work item is excluded. Do not download excluded attachments.

Run `context update --request <consumer-json>` after collecting current extraction
receipts. Verify the returned `saved`, snapshot status, changes, checked sources and
gaps, then read the published snapshot. Report added/changed/removed facts, withdrawals
due to exclusion or scope, verification dates and unresolved conflicts. An unchanged
refresh must not duplicate facts or rewrite unrelated verification metadata.

Inaccessible or partial sources retain last valid contributions as stale/partial;
do not invent replacements. Remove source support only after confirmed deletion or an
explicit source removal, or a successful ADO scope/selection reconciliation. Retain
independent support and history. Failed publication leaves current intact; inspect
recovery state before retrying an interrupted writer. Present partial results honestly.

Ordinary questions about captured context use its saved content and references only.
They do not invoke this workflow, fetch original sources or write verification dates.
