---
name: test-data
description: "Use when creating or editing a test data JSON file, deciding where an input, expected value, environment setting, or secret should live, replacing a hardcoded value, generating unique per-case and per-run data (TC-id clusters + timestamp), or planning seed-and-cleanup so tests stay independent, parallel-safe, and re-runnable."
---

# Test Data

Resolve this skill to its real path before following references. Read the
[package and consumer boundaries](../ROOTS.md); mutable state belongs to the consumer.

Every input and expected value in this framework is externalized (iron law: no hardcoded
data anywhere — not even assertion messages). Data has exactly three homes: business
inputs and expected values in one JSON per spec under `resources/testData/` (binary
upload fixtures beside them in `resources/testData/fixtures/<Feature>/`, their paths
stored as JSON keys); environment data in `src/config/*.ts` and
`playwright.config.ts`; secrets in `process.env` only. This skill owns what goes where,
how the JSON is shaped and loaded (including the per-case `tc<id>` clusters), and how
data stays unique and clean across cases, parallel workers, and repeated runs.

1. Read the shared law first: [design-conventions](../pom-architecture/references/design-conventions.md)
   — especially §2 (file naming), §4 laws 5 and 8 (externalized data, independence), and
   the §5 adaptation table (properties files → config TS + `process.env`).
2. Then read and follow [references/playbook.md](references/playbook.md) — numbered
   practices with real project examples.

## Boundaries

- Where the loading code sits (hook order, module-level `let` state, `afterAll` teardown
  mechanics) → [test-classes](../test-classes/SKILL.md)
- How a test consumes the data in its flow and title → [test-methods](../test-methods/SKILL.md)
- Validation methods that receive expected values as parameters → [validation-methods](../validation-methods/SKILL.md)
- The seeding/cleanup service methods themselves (`Apis<Domain>` / `Dbs<Domain>`) → [service-classes](../service-classes/SKILL.md)
- `DBConnectionConfig` and other facade contracts consumed by config files → [utility-classes](../utility-classes/SKILL.md)
