---
name: action-methods
description: "Use when writing, refactoring, or reviewing an action method on a page or service class — naming a business operation, wrapping it in its Allure step, choosing what to interpolate into the step title, deciding parameters and return type, judging granularity (compose vs split), handling native dialogs, file uploads, and per-control interaction verbs, or checking an existing action for redundancy."
---

# Action Methods

Resolve this skill to its real path before following references. Read the
[package and consumer boundaries](../ROOTS.md); mutable state belongs to the consumer.

Action methods are the verbs of the business layer: intent-named operations on
`pages/`, `apis/`, and `dbs/` classes that hide mechanics behind one
business-readable Allure step. They perform; they never assert, branch, or catch.

1. Read the shared law first: [design-conventions](../pom-architecture/references/design-conventions.md)
   — especially §2 (method naming), §4.6 (one Allure step per method), §4.7 (no
   secrets in step titles), and §5 (return policy: no `return this`).
2. Then read and follow this skill's [playbook](references/playbook.md) — numbered
   practices with verbatim project examples and the canonical-vs-legacy calls.

## Boundaries

- Assertions and anything starting with `verify` → [validation-methods](../validation-methods/SKILL.md)
- Where actions sit in the class (banners, member order, when a new page is justified) → [page-classes](../page-classes/SKILL.md)
- Finding/naming the locators an action uses → [element-locators](../element-locators/SKILL.md)
- Service-class shape (`Apis<Domain>`/`Dbs<Domain>` fields, constructor, `close()`) → [service-classes](../service-classes/SKILL.md)
- `step()`/attachment plumbing, redaction, retries in `utils/` → [utility-classes](../utility-classes/SKILL.md)
- The data an action receives (JSON files, env config, enums) → [test-data](../test-data/SKILL.md)
- Which actions a test calls and in what order → [test-methods](../test-methods/SKILL.md)
