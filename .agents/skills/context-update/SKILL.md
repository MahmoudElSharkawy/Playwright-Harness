---
name: context-update
description: "Refresh saved business context using its selected documents, exact work-item IDs or saved criteria. Discover newly matching items, update changed evidence and preserve history. Ordinary questions do not trigger refresh."
---

# Refresh business context

An invocation authorizes the scoped local update. Resolve the consumer and established
context ID using [ROOTS](../ROOTS.md). Follow the shared
[selection/capture workflow](../project-context/references/workflow.md).

Use `context update --id <id>` to refresh the saved selection:
- Exact IDs stay fixed, even when other work items are created.
- Criteria rerun against the selected project. New matches enter context; changed
  items update; unchanged content is reused; confirmed departures lose active support.
- Explicitly selected documents are rehashed. Only selected ADO attachments are
  eligible for download, including on later refreshes.
- An explicit refresh also checks the native Markdown/text reader recipe, so
  unchanged bytes can receive section extraction. Unaffected formats and saved
  host receipts retain their contracts. Regrouped IDs/counts/ranking do not alone
  indicate changed business requirements; bind citations to the new revision.

For a user-specified narrower refresh or new criteria, use a request with those
sources and the same context ID. [project-context](../project-context/SKILL.md)
also supports this. Explicit request criteria replace that collection's saved
criteria after successful capture. Config changes do not silently replace a
context's saved selection. Omission of other selected collections/documents
preserves them; source removal is explicit.

Inspect the published receipt and verify `saved`, then use `context read` and
bounded `context search` to explain meaningful business changes. Read relevant
acceptance criteria as well as descriptions. Reuse source titles/document names
for citations. Report added or changed capabilities/rules and relevant open
questions; counts may supplement the explanation. Keep storage hashes, full
revisions, receipts and execution notes out of ordinary answers.

Unavailable or partial selected sources retain their last valid evidence as
stale. Changed document bytes require current extraction. Do not resolve a
contradiction by guessing, reinterpret an outage as deletion, or describe a
failed save as successful. Publication and history safeguards remain in force.

Older captures may contain repository/POM evidence. A full refresh of those
captures requires explicit business-source selection; do not automatically
carry technical sources forward. Existing history and owner notes are preserved.
The [context contract](../../../docs/project-context.md) covers recovery.

This workflow does not modify external work items. A later snapshot-only question
uses an explicit [context-qa](../context-qa/SKILL.md) invocation.
