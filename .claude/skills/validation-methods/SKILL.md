---
name: validation-methods
description: Use when writing, naming, reviewing, or refactoring a validation method on a page, API, or DB service class — verify* naming, choosing the validation layer (GUI vs API vs DB), the ///// Validations section, Allure step titles for checks, web-first assertions (toBeVisible/toHaveText/toHaveTitle/toHaveURL), choosing toHaveText vs toContainText, API status+body validation, DB row-count validation, or migrating legacy assert*/assertOn*/validate* methods.
---

# Validation Methods

A validation method is the oracle of a test: a `verify*`-named, Allure-step-wrapped
method that sits last in its business class and asserts one business condition using
Playwright's web-first assertions (GUI) or `expect` on responses/rows (API/DB). It
observes and judges — it never acts, never loops, never swallows failures.

1. Read the shared law first: [design-conventions](../pom-architecture/references/design-conventions.md)
   — especially §3 (member order), §4 iron laws 3–7 & 9, and §5 (`Validate`→`verify` mapping).
2. Then read and follow [references/playbook.md](references/playbook.md) — the numbered
   practices, canonical-vs-legacy examples from this repo, and the review checklist.

## Boundaries

- Where expected values are stored and loaded (JSON files, env config, enums) →
  [test-data](../test-data/SKILL.md). This skill only requires they arrive as parameters.
- Action method internals (no assertions inside actions, step titles for actions) →
  [action-methods](../action-methods/SKILL.md).
- Which locator a page validation asserts against → [element-locators](../element-locators/SKILL.md);
  where the locator field lives → [page-classes](../page-classes/SKILL.md).
- Service class anatomy (query/endpoint constants, facades, `close()`) →
  [service-classes](../service-classes/SKILL.md).
- "Every test needs ≥1 validation" and test flow/scope → [test-methods](../test-methods/SKILL.md).
- Hook wiring and the no-assertions-in-hooks rule (hooks — before and after — contain
  no assertions at all) → [test-classes](../test-classes/SKILL.md).
- Step/attachment plumbing and never-throw reporting → [utility-classes](../utility-classes/SKILL.md).
