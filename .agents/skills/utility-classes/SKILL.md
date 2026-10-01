---
name: utility-classes
description: "Use when writing, extending, or reviewing anything in utils/ — a technical facade like ApiActions/DBActions, report logging, Allure attachments, secret redaction, connection/pool handling, retries — the root-level globalSetup/globalTeardown lifecycle scripts (honorary utils for run hygiene and report generation) — or when deciding whether complex code (a loop, conditional, or try/catch) belongs in utils versus a business class."
---

# Utility Classes (`utils/` — the technical layer)

Resolve this skill to its real path before following references. Read the
[package and consumer boundaries](../ROOTS.md); mutable state belongs to the consumer.

`utils/` is the framework's only technically complex layer. It hosts facades
(`ApiActions`, `DBActions`) that make every external interaction visible in the Allure
report, redact secrets, and guarantee that reporting failures never alter a test's
outcome. Business meaning never enters this layer. The root-level `global-setup.ts` /
`global-teardown.ts` lifecycle scripts are honorary members — run hygiene only
(playbook practices 14–17).

1. Read the shared law first: [design-conventions](../pom-architecture/references/design-conventions.md)
   — especially §1 (business/technical split), §4 iron laws 1, 3, 4, 7, 10, 12.
2. Then read and follow [references/playbook.md](references/playbook.md) for the facade
   contract: step-per-operation, attachment nesting, never-throw reporting, redaction,
   options resolution, lifecycle scripts, and how to extend or add a facade.

The living canonical models are `src/utils/ApiActions.ts` and `src/utils/DBActions.ts` —
pattern-match every new facade on them. Three narrower facades round out the family and
are worth pattern-matching for their own shape: `UiControls.ts` (async-widget-race
helpers — bounded retry until a gate signal confirms a flaky third-party control has
settled), `PdfDocuments.ts` (an external-library facade — transport and parsing stay out
of business/page classes, same shape as ApiActions/DBActions but wrapping a parsing
library instead of a network/DB driver), and `IdentityNumbers.ts` (format-constrained
synthetic-data generation — a checksum-valid value that isn't externally registry-checked
and gets consumed permanently on use, so it's generated fresh per run instead of drawn
from a reused pool).

For shared-runtime outcomes, follow [M14 reporting](../../../docs/M14-REPORTING.md). Attach the validated JSON/HTML through `attachResult(test, result)` inside the technical step, inspect its delivery status, and keep reporting failures separate from test outcomes. Generate Allure only after native execution and reporter flush; never infer a harness verdict from native test counts.
The example uses `src/utils/AllureReport.ts` in reporter `onExit` with the pinned
Node-based Allure 3 generator; do not generate during `globalTeardown`. Register
this reporter before the HTML viewer, which can keep its `onExit` hook open.

## Boundaries

- Business wrappers around these facades (`Apis<Domain>`, `Dbs<Domain>` classes) →
  [service-classes](../service-classes/SKILL.md)
- Business-titled Allure steps on page/service actions → [action-methods](../action-methods/SKILL.md)
- `expect()` assertions and `verify*` methods → [validation-methods](../validation-methods/SKILL.md)
- Test data files, environment config, secrets sourcing → [test-data](../test-data/SKILL.md)
- Where facades are instantiated and closed in spec hooks → [test-classes](../test-classes/SKILL.md)
