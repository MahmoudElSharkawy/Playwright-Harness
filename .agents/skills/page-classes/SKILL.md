---
name: page-classes
description: "Use when creating, extending, refactoring, or reviewing a page class in pages/ — a new HTML page object, a skeleton-area class (header/footer/side menu), class member order and section banners, constructors, dynamic locator methods, or deciding whether a new page class is justified at all."
---

# Page Classes

Resolve this skill to its real path before following references. Read the
[package and consumer boundaries](../ROOTS.md); mutable state belongs to the consumer.

A page class is the GUI business layer for exactly one HTML page or one shared skeleton
area. It owns that page's locators, actions, and validations behind intent-named methods —
no base classes, no exception handling, no logic. The existing files in `pages/`
(`LoginPage.ts`, `HomePage.ts`, `HeaderPage.ts`) are the living style reference.

Work in this order:

1. Read the shared law: [design-conventions](../pom-architecture/references/design-conventions.md)
   — especially §1 (architecture), §3 (class anatomy), §4 (iron laws), §5 (legacy mappings).
2. Read and follow [references/playbook.md](references/playbook.md) — page-class anatomy,
   skeleton-area classes, constructors, dynamic locator methods, and when a new page
   class is justified.

## Boundaries

This skill owns the **class shell**: file placement, member order, constructor, dynamic
locator methods, banners, and class-creation decisions. Route everything else:

- Locator strategy, naming suffixes, selector syntax → [element-locators](../element-locators/SKILL.md)
- What goes inside an action method (steps, titles, granularity) → [action-methods](../action-methods/SKILL.md)
- What goes inside a validation method (`verify*`, web-first assertions) → [validation-methods](../validation-methods/SKILL.md)
- Where page objects are instantiated (spec hooks, `beforeEach` wiring) → [test-classes](../test-classes/SKILL.md)
- `Apis<Domain>` / `Dbs<Domain>` classes → [service-classes](../service-classes/SKILL.md)
