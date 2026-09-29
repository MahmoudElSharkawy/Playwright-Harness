---
name: element-locators
description: Use when finding, naming, declaring, or repairing an element locator in this framework — choosing a selector strategy (id, name, data-qa attribute, relative XPath, relative CSS), naming a locator field, writing a dynamic parameterized Locator method, fixing a strict-mode violation, handling element collections, or reviewing locator quality in an MR.
---

# Element Locators

Locators are the most fragile layer of the framework: a bad selector fails silently
until the DOM shifts. This skill owns how a locator is **named**, **declared**, and
**built** — the selector evaluation order, dynamic parameterized `Locator` methods,
strict-mode awareness, collections, and the full anti-pattern list. Locators live only
inside page classes and never leak out.

1. Read the shared law first: [design-conventions](../pom-architecture/references/design-conventions.md)
   — especially §2 (naming + suffix vocabulary), §4 law 2 (encapsulation), and §5
   (settled Java → Playwright adaptations).
2. Then read and follow [references/playbook.md](references/playbook.md) — the numbered
   practices, real project examples, and the locator review checklist.

## Boundaries

- **Where locator fields and dynamic locator methods sit inside the class** (member
  order, `// Locators` banner, constructor wiring, when a new page class is justified)
  → [page-classes](../page-classes/SKILL.md)
- **What action methods do with locators** (click/fill flows, Allure steps)
  → [action-methods](../action-methods/SKILL.md)
- **Assertions against located elements** (`toBeVisible`, `toHaveText`)
  → [validation-methods](../validation-methods/SKILL.md)
- **`<op>_serviceName` / `<op>_query` string fields** — same postfix naming, different
  layer → [service-classes](../service-classes/SKILL.md)
