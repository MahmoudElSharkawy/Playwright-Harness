---
name: test-methods
description: Use when writing, reviewing, or refactoring an individual test case inside a spec file — its title, Allure metadata (feature/tms/issue), tags, the flow of business-method calls in the body, validation coverage, test independence, or unique per-case/per-run data usage.
---

# Test Methods

An individual `test(...)` block is pure orchestration: a descriptive title, Allure
metadata on the first lines, a short sequence of business-method calls on page/service
objects, and at least one validation. Nothing else — no locators, no logic, no raw
API/DB calls, no hardcoded data.

1. Read the shared law first: [design-conventions](../pom-architecture/references/design-conventions.md)
   — especially §4 iron laws 3, 4, 5, 8, 9 and the §5 Java→TS mapping for titles, tags,
   and Allure links.
2. Then read and follow this skill's [playbook](references/playbook.md) — numbered
   practices with real examples from `tests/LoginTests.spec.ts` and
   `tests/User Management/DbUserManagementTests.spec.ts`.

## Boundaries

- Spec file skeleton — imports, module-level `let` state, `test.describe`, hook
  placement and responsibilities → [test-classes](../test-classes/SKILL.md)
- What happens inside a `verify*` method (web-first assertions, step wrapping) →
  [validation-methods](../validation-methods/SKILL.md)
- What happens inside an action method (step titles, secrets, granularity) →
  [action-methods](../action-methods/SKILL.md)
- Where test data and expected values live, JSON file shape, per-environment data →
  [test-data](../test-data/SKILL.md)
- Unsure this is the right skill? Start at the router:
  [pom-architecture](../pom-architecture/SKILL.md)
