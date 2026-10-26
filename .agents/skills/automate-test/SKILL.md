---
name: automate-test
description: Automate test cases from a user story, an ADO suite or local scenarios into durable POM code through observed execution, independent review and two scoped green runs.
---

# Automate Tests

Resolve this skill to its real path and read [package and consumer boundaries](../ROOTS.md).
Mutable state and generated code belong to the consumer; installed skills stay immutable.

For existing failed, flaky, changed or blocked cases, start with
[maintain-test](../maintain-test/SKILL.md) to diagnose and resume this workflow
without resetting source history or repair counts.

Choose the source explicitly:

```text
/automate-test story <id> on <environment>
/automate-test suite <id> [plan <id>] on <environment>
/automate-test local <source.json> on <environment>
```

ADO is optional and must be explicitly configured. For a story, use the existing
`npx --no pom-harness fetch-story --story <id> --revisions --source-out <consumer-path.json>`
route; no suite or plan is required. Follow Tested By links by default; select other
link types only when requested. For a suite, use `fetch-suite --suite <id> --revisions
--plan <id> --source-out <consumer-path.json>`, resolving the plan from the request
or the configured ADO default. If neither supplies it, ask for the plan ID.
Preserve fetch/refinement behavior for parameterized or incomplete cases: explicitly
refine them into neutral input before generation. Pass the neutral source through
the same workflow below. Local input requires no ADO configuration.
Preserve the original revision-bearing `_suite.json` snapshot for post-run bug
review. A later fetch cannot establish which source revision the run exercised.

Read the
[generation procedure](../../../docs/PIPELINE.md) for the executable handoff,
review and verification contracts before running the pipeline:

```text
Source → refinement → observed execution → durable POM generation
       → independent review → two independent scoped green runs → delivery readiness
```

- Preserve every source action and expectation. Refinement, observed facts and reviewed
  knowledge are distinct. Never weaken assertions or silently promote runtime candidates.
- Browser mechanics use the official Playwright CLI skill through the existing browser
  ownership/evidence boundary. API/DB operations use the shared deterministic runtimes.
- That browser boundary also saves bounded, sanitized API candidates and an
  `api-discovery.json` summary. Reuse business methods and applicable supplied
  collections first; review and verify missing operations through the configured API
  runtime before reuse. Follow [observed API knowledge](../../../docs/reference/api.md#observed-api-knowledge),
  including authentication, extraction, effects and cleanup gaps. A collection is not
  required; observations do not change expectations or authorize new destinations.
  Promote reviewed knowledge/optional observed collections before CANDIDATE, and
  summarize discovered, reused/verified and unresolved operations in the handoff.
- For specific list records, apply [search-first targeting (§4b)](../pom-architecture/references/design-conventions.md#4b-record-targeting-on-list-pages) during exploration and generation. Observe supported keys, scope and asynchronous completion before choosing search; reuse page business methods, verify exact row identity and uniqueness, and define scoped absence/ambiguity or a documented fallback. Preserve every frozen pagination, sorting or browsing journey; never insert raw selectors, waits or lookup loops into specs.
- Follow configured environment capabilities. Catalogs, deterministic helpers and fixed
  inline parameterized definitions are peers. Imported team libraries are derive-only.
  Ordinary permitted mutations need no repeated harness approval.
- Determine cleanup/restoration from scenario intent and ownership. Intentionally persistent
  outcomes may remain; required lifecycle failures prevent a clean pass. Do not add a
  universal before-image or restoration step.
- Generation follows [test-data ownership and disposable inputs (§4a)](../pom-architecture/references/design-conventions.md#4a-test-data-ownership-method-contracts-and-disposable-inputs).
- Route generation through [pom-architecture](../pom-architecture/SKILL.md), then only the
  specialist skills needed by the changed layers. Reuse existing business methods first.
  Classify page entry and require public async `navigate()` on directly routable pages
  under [page-classes practice 3](../page-classes/references/playbook.md#3-every-directly-routable-page-exposes-navigate); preserve source link/menu journeys and prerequisites.
  Generated services can call shared API/DB library interfaces without loading an AI host.
- Freeze the candidate and dispatch a fresh independent reviewer following
  [framework-review](../framework-review/SKILL.md), prompted to REFUTE. Resolve findings or
  record the user's explicit acceptance. A self-review cannot release verification.
- Preserve source-to-observation bindings and supply the candidate step/expectation
  mapping. Generate ordinary validations without marker wrappers, source-key parameters
  or tracing-only JSON. The case-assertions gate uses completed native assertions;
  independent review establishes full scenario coverage and semantic equivalence.
- Allow three cumulative repair rounds per source batch. Repairs reset review/greens;
  they never reset history. Require two new, independent scoped green processes after
  the last repair. The explicit one-time legacy migration preserves the repair count
  but still requires fresh review and two v2 runs; unrelated repairs consume a round.
  No skipped, flaky, empty or unscoped run earns a green.
- Preserve existing application code and consumer customizations. Use the user's ongoing
  branch/delivery instructions; do not infer authorization for external writes from READY.

Use [reporting](../../../docs/reporting.md) for validated execution reports and optional Allure capture during verification. Keep the recorded verifier outcome visible above native test detail; report generation never grants delivery readiness.

Always finish with `npx --no pom-harness generate report --source <source.json>`
(optionally `--id <source-id>`), including failed, blocked and partial work. If a case
stops before a candidate exists, record its actual stage, reason and known next action
in source-bound notes, then pass `--input <consumer-notes.json>` under the
[reporting contract](../../../docs/reporting.md#case-results-and-blocker-notes).
If accepted actions or expectations are missing, retain a draft inventory with the
known case IDs/titles and original empty slots for reporting. Never invent an oracle
or prepare generation from that incomplete draft.
Use existing generation history and bound native receipts for generated cases;
notes cannot overwrite them or create passes. Link the returned `html` in the final
response with a brief status/count summary and clear failure/blocker reasons. When
delivering the work through a PR, also follow the
[report handoff](../../../docs/reporting.md#skill-report-handoff) to attach its report.
Share this single case report with its Summary and Defects companions. Keep the
HTML focused on case outcomes, expectations, reasons and next actions; internal IDs,
hashes, raw records and verification-gate metadata stay in execution storage.
Generation commands also return a separate `reporting` delivery result. Report failure
must remain visible without changing the workflow verdict, repair count or greens.

Before finishing failed, blocked or partial exploration or verification, perform the
[post-run bug review](../../../docs/bug-reporting.md#post-run-review) through
[bug-report](../bug-report/SKILL.md), without waiting for another invocation.
Classify application, test, environment and unknown causes using the recorded source
and evidence; use maintain-test for unresolved diagnosis within existing budgets.
Prepare editable drafts for supported application defects, grouping related failures
only with an evidence-backed reason. Present complete drafts and remaining attention
items for edits, selection or deferral. Keep assertions, verdicts and repair/green
counts intact. A failed automated assertion alone does not prove an application bug
or an independent reproduction. Only explicitly approved previews may be filed in ADO.

Use [Azure DevOps](../../../docs/azure-devops.md) for explicitly authorized external delivery.
Local sources support the complete generation/review/verification path without ADO.
Legacy ADO artifact layouts remain documented in [the compatibility playbook](references/playbook.md).
Its historical host, catalog, parallelism and cleanup assumptions do not override the
current generation procedure or approved execution policy. Do not run legacy AgenTeX
commands as a prerequisite for the neutral pipeline.
