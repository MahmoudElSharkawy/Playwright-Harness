---
name: project-context
description: "Build, retrieve or update business context from explicitly selected work items and supplied documents. Accept exact IDs or reusable criteria; save the selection for later refresh. Use context-qa only for explicitly invoked questions against saved context."
---

# Build business context

Turn the selected requirements into an understandable account of the application:
its purpose, users, capabilities, workflows, rules and domain terms. Read the
actual requirements and acceptance criteria, not just titles or filenames.

Resolve the real package path and consumer using [ROOTS](../ROOTS.md), then follow
the [source selection and capture workflow](references/workflow.md).
Context includes only business work items selected by explicit IDs or criteria,
and documents/attachments the user supplies or explicitly selects. Repository
structure, POM methods, harness conventions, configuration and automation coverage
are outside this collection. Connection configuration may resolve the selected
ADO destination; it does not become business evidence.

## Select, capture and explain

1. Reuse the established context ID, project and application scope. Ask only for
   missing or ambiguous selection. A saved ID list is fixed; saved criteria are
   rerun to discover new matching items. Both are explicit source selections.
2. For the same context, reuse saved criteria or apply the user's new criteria.
   A changed selection replaces membership of that named ADO collection;
   independently selected documents and other collections remain. Do not turn
   an item link or attachment link into permission to fetch it.
3. Read the selected content through the existing runtime and appropriate file
   readers. Preserve conditions, amounts, limits, exceptions and named actors.
   Keep unresolved contradictions and unreadable portions attributable to sources.
   Native Markdown/text capture preserves sections/paragraphs, heading ancestry,
   lists, tables and fenced content with original locations. Headings describe
   locations, not shared business topics or proof of a contradiction.
4. Build or refresh the saved context with `context update --request <request>`,
   or reuse its complete saved selection with `context update --id <id>`.
   An invocation to build/update context authorizes this local save. If the user
   asks only for a preview or explicitly says not to save, use `context retrieve`.
5. Read relevant saved evidence with `context read` and bounded `context search`.
   For an overview, page the selected source catalog and read descriptions,
   acceptance criteria and relevant document sections across the selected scope.
   A preview sample is not the full source set. Narrow detail questions to the
   supporting passages instead of loading the corpus.

Organize the understanding around business topics. Combine repeated requirements,
connect steps only when sources support the connection, and distinguish a stated
rule from your synthesis. Useful topics include functional areas, user journeys,
business rules, terms/entities and dependencies. Omit unsupported topics instead
of filling them with assumptions or empty headings. The saved original passages
remain the authority; generated prose does not become independent evidence.

## Respond for the reader

Lead with what the application does and the part relevant to the request. Use
ordinary prose, a short list or a table only when helpful. Cite coherent claims
with work-item titles/IDs or document names and locations. Use the returned
`citation` labels; retain full fact/chunk/revision identifiers internally.

After capture, briefly explain what was included or changed and any business
question affected by missing/conflicting evidence. Do not dump hashes, selection
receipts, command history, authority labels, storage paths or unrelated missing
technical information. Show technical diagnostics only when requested.
Never call partial extraction complete or describe saved evidence as live truth.

`project-context` can build and refresh with old or new criteria.
[context-update](../context-update/SKILL.md) is the shortcut for syncing a saved
selection. [context-qa](../context-qa/SKILL.md) answers only from saved evidence
when explicitly invoked; ordinary questions do not silently run these workflows.
