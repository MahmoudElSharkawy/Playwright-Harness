---
name: service-classes
description: Use when creating, extending, or reviewing an Apis<Domain> class in apis/ or a Dbs<Domain> class in dbs/ — adding an API endpoint or SQL query for tests (source endpoints from the team collection library resources/apisCollections/ and SQL from the team query library resources/Queries/ first), declaring <operation>_serviceName / <operation>_query fields, wiring ApiActions/DBActions in the constructor, writing service actions or verify* validations, parameterizing SQL, or managing the DB close() lifecycle.
---

# Service Classes (`Apis<Domain>` / `Dbs<Domain>`)

Service classes are the non-GUI business layer: `src/apis/Apis<Domain>` exposes API business
operations, `src/dbs/Dbs<Domain>` exposes DB business operations. They mirror page classes —
constant fields instead of locators, `///// Actions` and `///// Validations` sections —
and delegate every technical concern (HTTP, pooling, logging, attachments, redaction) to
the `utils/` facades. A spec never calls `request.fetch()` or an mssql pool; it calls a
service method with a business name.

1. Read the shared law first: [design-conventions](../pom-architecture/references/design-conventions.md)
   — especially §2 (service-string field naming), §3 (class anatomy), §4 (iron laws).
2. Read and follow [references/playbook.md](references/playbook.md) — the numbered
   practices for anatomy, endpoint/query fields, facade wiring, step-wrapped actions,
   parameterized queries, validations, and the `close()` lifecycle. New SQL is sourced
   from the team query library `resources/Queries/` first (practice 3; contract in
   `resources/Queries/README.md`). New API endpoints are sourced from the team
   collection library `resources/apisCollections/` first (same practice 3; contract in
   `resources/apisCollections/README.md`).

## Boundaries

- Facade internals — `ApiActions`/`DBActions` step plumbing, `test.info().attach()`
  nesting, redaction, never-throw reporting, connection pooling →
  [utility-classes](../utility-classes/SKILL.md)
- Spec wiring — where to instantiate services (`beforeEach`/`beforeAll`) and call
  `close()` (`afterAll`) → [test-classes](../test-classes/SKILL.md)
- General action-method style (verb naming, step granularity, return policy) →
  [action-methods](../action-methods/SKILL.md); validation-method depth →
  [validation-methods](../validation-methods/SKILL.md)
- Where payloads, expected messages, and DB/env config values live →
  [test-data](../test-data/SKILL.md)
- GUI business layer (page classes) → [page-classes](../page-classes/SKILL.md)
