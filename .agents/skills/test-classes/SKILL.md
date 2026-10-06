---
name: test-classes
description: "Use when creating, restructuring, or reviewing a spec file in tests/ — file naming, folder placement, imports, module-level state, the test.describe block, hook wiring (beforeAll/beforeEach/afterEach/afterAll), setup/teardown responsibilities, or fresh-context-per-test plumbing."
---

# Test Classes (Spec File Skeleton)

Resolve this skill to its real path before following references. Read the
[package and consumer boundaries](../ROOTS.md); mutable state belongs to the consumer.

A spec file is pure orchestration: one `test.describe` per feature, tests written
first, hooks grouped at the bottom, and every hook doing exactly one kind of wiring
(data load, service init, seeding, context lifecycle, connection close). Hooks
establish state; test bodies prove scenarios. Cleanup postconditions may run in teardown
under [design-conventions §4a](../pom-architecture/references/design-conventions.md#4a-test-data-ownership-method-contracts-and-disposable-inputs).
Use the standard Playwright import and built-in isolated page by default. Specs have
no raw locators/requests or general control flow; small teardown guards cover partial
setup, and justified public fixtures remain valid.

1. Read the shared law first: [design-conventions](../pom-architecture/references/design-conventions.md)
   — especially §1 (specs orchestrate, never implement), §4 iron laws 3–5 and 8, and
   the §5 adaptation table (file naming, tags, Allure links).
2. Then read and follow [references/playbook.md](references/playbook.md) — the numbered
   practices for the spec skeleton, with the project's own spec files as models.

## Boundaries

This skill owns the file's **skeleton only**. Route neighboring concerns:

- What goes **inside** an individual test — title, `allure.feature`/`tms`/`issue`
  lines, flow, scope, tags → [test-methods](../test-methods/SKILL.md)
- The paired JSON file's shape, clustering, env/config data, seed-and-cleanup
  ownership → [test-data](../test-data/SKILL.md)
- The `Apis<Domain>` / `Dbs<Domain>` classes the hooks instantiate →
  [service-classes](../service-classes/SKILL.md)
- The page classes the hooks instantiate → [page-classes](../page-classes/SKILL.md)
- Anything structural you are unsure about → start at the router,
  [pom-architecture](../pom-architecture/SKILL.md)
