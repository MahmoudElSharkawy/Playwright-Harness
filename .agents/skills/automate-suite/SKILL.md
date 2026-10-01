---
name: automate-suite
description: Turn a local or explicitly configured ADO scenario suite into durable POM automation through observed execution, independent review and two scoped green runs.
---

# Automate a Scenario Suite

Resolve this skill to its real path and read [package and consumer boundaries](../ROOTS.md).
Mutable state and generated code belong to the consumer; installed skills stay immutable.

For local input, use `/automate-suite local <source.json> on <environment>`.
ADO is optional and must be explicitly configured. Read the
[generation procedure](../../../docs/M13-GENERATION.md) for the executable handoff,
review and verification contracts before running the pipeline:

```text
Source → refinement → observed execution → durable POM generation
       → independent review → two independent scoped green runs → delivery readiness
```

- Preserve every source action and expectation. Refinement, observed facts and reviewed
  knowledge are distinct. Never weaken assertions or silently promote runtime candidates.
- Browser mechanics use the official Playwright CLI skill through the existing browser
  ownership/evidence boundary. API/DB operations use the shared deterministic runtimes.
  AgenTeX is an architectural reference, not a required host or runtime.
- Follow configured environment capabilities. Catalogs, deterministic helpers and fixed
  inline parameterized definitions are peers. Imported team libraries are derive-only.
  Ordinary permitted mutations need no repeated harness approval.
- Determine cleanup/restoration from scenario intent and ownership. Intentionally persistent
  outcomes may remain; required lifecycle failures prevent a clean pass. Do not add a
  universal before-image or restoration step.
- Route generation through [pom-architecture](../pom-architecture/SKILL.md), then only the
  specialist skills needed by the changed layers. Reuse existing business methods first.
  Generated services can call shared API/DB library interfaces without loading an AI host.
- Freeze the candidate and dispatch a fresh independent reviewer following
  [framework-review](../framework-review/SKILL.md), prompted to REFUTE. Resolve findings or
  record the user's explicit acceptance. A self-review cannot release verification.
- Preserve source-to-assertion bindings. Source IDs and native assertion execution are
  mechanical gates; the independent reviewer must verify semantic equivalence.
- Allow three cumulative repair rounds per source batch. Repairs reset review/greens;
  they never reset history. Require two new, independent scoped green processes after
  the last repair. No skipped, flaky, empty or unscoped run earns a green.
- Preserve existing application code and consumer customizations. Use the user's ongoing
  branch/delivery instructions; do not infer authorization for external writes from READY.

Use [M12 adapters](../../../docs/M12-ADO.md) for explicitly authorized external delivery.
Local sources support the complete generation/review/verification path without ADO.
Legacy ADO artifact layouts remain documented in [the compatibility playbook](references/playbook.md).
Its historical host, catalog, parallelism and cleanup assumptions do not override the
current generation procedure or approved execution policy. Do not run legacy AgenTeX
commands as a prerequisite for the neutral pipeline.
