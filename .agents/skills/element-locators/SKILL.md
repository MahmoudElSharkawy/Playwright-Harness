---
name: element-locators
description: Choose or repair Playwright POM locators, including selector priority, field naming, dynamic locators, strict-mode ambiguity, and locator review.
---

# Element Locators

Locators are the most fragile layer of the framework: a bad selector fails silently
until the DOM shifts. This skill owns how a locator is **named**, **declared**, and
**built** — the selector evaluation order, dynamic parameterized `Locator` methods,
strict-mode awareness, collections, and the full anti-pattern list. Locators live only
inside page classes and never leak out.

1. Read the shared law first: [design-conventions](../../../.claude/skills/pom-architecture/references/design-conventions.md)
   — especially §2 (naming + suffix vocabulary), §4 law 2 (encapsulation), and §5
   (settled Java → Playwright adaptations).
2. Then read and follow [references/playbook.md](references/playbook.md) — the numbered
   practices, synthetic examples, and the locator review checklist.

## Package and project roots

Treat this skill and its references as immutable package content. Resolve the real
location of a linked skill before following relative references. Consumer page files
belong to the working project, not to this package. Runtime observations and outputs
belong to the consumer run directory; do not record them in this skill.

## Boundaries

- **Where locator fields and dynamic locator methods sit inside the class** (member
  order, `// Locators` banner, constructor wiring, when a new page class is justified)
  → [page-classes](../../../.claude/skills/page-classes/SKILL.md)
- **What action methods do with locators** (click/fill flows, Allure steps)
  → [action-methods](../../../.claude/skills/action-methods/SKILL.md)
- **Assertions against located elements** (`toBeVisible`, `toHaveText`)
  → [validation-methods](../../../.claude/skills/validation-methods/SKILL.md)
- **`<op>_serviceName` / `<op>_query` string fields** — same postfix naming, different
  layer → [service-classes](../../../.claude/skills/service-classes/SKILL.md)
