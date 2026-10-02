# Changelog

## Unreleased — automation pipeline guide

- Add `docs/PIPELINE.md`, one guide to the automation pipeline in execution order: ten named phases with their inputs, outputs, commands and gates, the repair loop, consumer state paths and a mapping from the legacy ADO phase names. It summarizes and links the M3–M16 contracts, which remain authoritative. The README gains a short "How automation works" section pointing to it. No script, test or example change.

## Unreleased — Windows owned-process trees

- Record a process as an owned descendant only when it was created no earlier than its parent. Windows keeps an exited parent's PID on its children and reuses PIDs, so browser cleanup could adopt older, unrelated processes and terminate them; this explains the intermittent Windows native browser gate failures, including a supervisor exit 1 with no summary. Creation identities compare exactly as integers, and a process without a readable identity is never adopted. A regression test covers the reused-PID case.
- Apply the same rule to the development-only M4 CLI spike's own tree helpers. Its Windows probe re-run passes 13/13 checks; Linux was not re-run.

## Unreleased — consumer seeding guidance

- Document seeding a fresh consumer from `examples` in the adoption guide: repoint the six copied harness shortcuts to the installed package location and keep `--root .` on `check:conventions`, which otherwise targets the package. The README links it from installation and the agent adoption protocol. No script, test or example change.

## Unreleased — installed validation repair

- Constrain the fresh CI consumer to the existing cleared dependency versions when npm relocates the shrinkwrap; retain exact provenance checks without changing dependencies or notices.
- Parse npm JSON from stdout while preserving combined, hashed diagnostics; add three CI regression tests.
- Correct the bundled example's `fetch:story` shortcut to resolve the parent package script; document its explicit external consumer and adoption path requirements.
- Correct the remaining five bundled harness shortcuts; exercise all six through actual npm invocations from the package root and example directory in the adoption tests.

## Unreleased — ADO story retrieval

- Add read-only `fetch-ado-story.mjs --story <id>`: retrieve the test cases linked to a user story without plan or suite IDs. Tested By links by default; `--links tested-by,child,related` selects others per run.
- Bind link targets to the configured collection, take test-case types from the project's test-case category, and report non-test or other-project items by ID without reading their content.
- Reuse the suite case reader and bounds; write the suite contract under `test/ado-story-<id>/` and an `ado-story-<id>` neutral source. Suite fetch output is pinned unchanged; exclusions are recorded but not fingerprinted.
- Include `ado-story-<id>` folders in convention, metrics and tracker scans. A case held by several folders counts once in metrics totals, from its newest verification; recorded results that disagree count it as no-state, and tracker sync skips it with a warning, in deterministic folder order. Library changes refresh consumers' M13 runtime fingerprints; re-verify after upgrading.
- No story-scoped publication or automation marking, automate-suite skill route, version bump or live-tenant validation.

## Unreleased — final-review corrections

- Guarantee owned-browser cleanup after interrupted bodies or failed result recording, preserving frozen phases, assertion failures and the shared cleanup deadline.
- Accept genuinely empty ADO metadata consistently through retrieval, conversion and legacy rendering; retain refinement for nonempty or malformed metadata.
- Add identifying context and assessed-status wording to the four API/database reference-fixture business steps; verify actual Allure nesting and attachment associations.
- Extend the installed browser gate to 38 exact native checks. Preserve public interfaces, dependency versions and normal execution policy.

## 3.0.17 — M17 CI and installed-package validation

- Validate actual npm archives in fresh Windows/Linux installations, with pinned dependency provenance and package immutability checks.
- Publish the existing dependency lock as `npm-shrinkwrap.json`; exclude nested installed dependencies when repacking and use the distributed lock for generation fingerprints.
- Add a fixed CI checklist that rejects missing, skipped and zero-scope checks, plus real native browser and Linux API/database/parallel proofs.
- Allow the existing host and full-workflow acceptance probes to use a separate consumer with the actual installed package.
- Drain cancellation and recover exact owned native resources after a proof timeout, with protected atomic ownership receipts and real fault evaluations.
- Resolve Windows consumer paths for native allowlists, retain private compiler diagnostics, and support the explicit local Docker Desktop fixture route.
- Supply the generated-test fixture's Chrome prerequisite in the Linux client and recognize exact literal native consumer-directory prefixes without accepting shell additions.
- Keep authenticated host evidence separate from public CI artifacts and retain explicit readiness gates. No runtime dependency upgrade, execution-policy change or release authorization.

## 3.0.16 — M16 bounded parallel execution

- Add opt-in batches of independent complete sequential lifecycles, with concurrency 1 by default and an explicit maximum of 8.
- Reject shared-data conflicts before execution; isolate run storage and assessed results, retain queued cancellation/deadline outcomes and drain required cleanup.
- Keep one active batch per consumer, immutable queued inputs and guarded runtime exploration. Preserve uncertain effects and incomplete execution without inventing verdicts.
- Prove real session isolation, API lifecycle behavior and both database drivers against sequential semantic outcomes. No new dependency, browser language, general scheduler or generated-test worker change.

## 3.0.15 — M15 sequential workflow parity

- Connect native Claude/Codex source refinement, observed execution, unreviewed knowledge candidates, actual POM authorship, independent review, two scoped green processes and Allure 3 reporting in a fixed acceptance proof.
- Compare semantic outcomes and binding relationships while revalidating each run's original evidence, generated execution records and reports.
- Include normal mutation autonomy, required cleanup/restoration and intentional persistence; retain controlled negative outcomes and sequential execution.
- No new execution engine, browser command language, dependency or automatic external delivery.

## 3.0.14 — M14 reporting and Allure integration

- Reporting follow-up: replace the Java generator with pinned Allure Report 3.19.1; retain test/action APIs, report locations, native status and harness verdict authority.
- Use explicit local single-file configuration and post-flush example generation; preserve nested attachments and block outbound report analytics.
- Render validated execution results as JSON, Markdown and self-contained static HTML, preserving verdicts, attempts, effects and lifecycle intent.
- Attach sanitized execution views inside native technical steps; isolate native Allure captures per verification invocation.
- Generate Allure after reporter flush with integrity checks and a visible recorded verification outcome above native detail.
- Keep reporting failures separate from test verdicts and two-green readiness; preserve sequential execution.
- Add report contract checks and extend the reviewed live consumer proof. No new root dependency or release authorization.

## 3.0.13 — M13 generation, review and verification

- Bind neutral source intent to reassessed execution, durable POM files and independent review.
- Enforce three cumulative repair rounds and two independent exact-scope native green runs, with executed source assertions and intact receipts.
- Reuse shared deterministic API/DB libraries across catalog, helper and inline definitions; keep sequential execution and intent-driven lifecycle policy.
- Add a separate consumer proof and native runner failure fixtures. Local case metadata no longer requires an invented ADO link.
- Refresh the canonical automation route without adding AgenTeX, a browser DSL or a workflow engine.


Package versions belong to this package, not to adopting applications. Historical
private incidents and delivery identifiers are intentionally not retained here.

## 3.0.12 — Unreleased

- M12: separate optional ADO test retrieval, outcome/work-item management and
  source-control delivery behind concrete adapters with shared bounded transport.
- Keep all five compatibility entrypoints consumer-rooted, make external mutations
  explicitly executable, and retain flushed receipts without credentials/payloads.
- Preserve local-only operation, validate publication scope and source identity,
  guard work-item revisions, and verify writes without automatic replay.
- Remove private field/branch defaults and silent missing-case/result handling;
  document compatibility changes and the limits of synthetic contract validation.

## 3.0.11 — Unreleased

- M11: compare validated execution semantics across native Claude and Codex runs,
  preserving business values, producer bindings, recovery and lifecycle decisions.
- Add thin native hook payload translation and fixed browser/API/database host
  proofs with native command receipts, immutable package checks and owned cleanup.
- Verify 19 native Windows execution cases through Claude and Codex, including
  mixed lifecycle behavior and structured Codex denial across the Windows shell.
- Keep host permissions separate from harness capabilities. Full workflow parity
  and parallel execution remain deferred.

## 3.0.10 — Unreleased

- M10: add PostgreSQL through the shared database runtime, using native positional
  binding, scoped privileges, read-only reads and precise native result conversion.
- Preserve catalog/helper/inline/exploration peers, conditional restoration and
  persistent outcomes; keep SQL syntax and version tokens inside concrete drivers.
- Add real PostgreSQL safety/failure probes and semantic comparison of 12 shared
  SQL Server/PostgreSQL scenarios on Windows and Linux clients.
- Pin pg and its dependency graph and record the separate upstream notices.

## 3.0.9 — Unreleased

- M9: share sequential scenario identities, bindings, effects and required lifecycle
  records across the existing browser, API and SQL Server runtimes.
- Add fixed setup/exercise/verify/cleanup callbacks, cross-runtime concurrency refusal,
  shared cleanup deadlines and protected-value screening, and explicit unreached results.
- Prove real mixed scenarios, partial setup, reconciliation, conditional restoration,
  cleanup failures and intentional retention without new dependencies or a workflow DSL.

## 3.0.8 — Unreleased

- M8: add sequential SQL Server execution with actual typed driver bindings,
  lightweight statement classification and dedicated database/schema principals.
- Support dynamic SELECT/INSERT/UPDATE/DELETE, peer catalog/helper/inline sources,
  bounded results, effect accounting, sanitized evidence and safe read recovery.
- Keep lifecycle obligations optional; require conditional identity/version checks
  for restoration, and preserve intentionally persistent outcomes.
- Pin node-mssql and its dependencies, record third-party provenance, and add
  disposable real SQL Server validation for Windows and Linux clients.

## 3.0.7 — Unreleased

- M7: add one deterministic API runtime for catalog, helper, inline and dynamic
  exploratory operations under the same frozen environment capabilities.
- Support bound JSON requests, typed extraction, reliable checks, bounded native
  HTTP(S), credential refresh, effect-aware recovery and sanitized evidence.
- Record optional fixture cleanup, conditional restoration and intentional retention;
  validate CRUD, transport failures and policy controls with local HTTP fixtures.
- Align the root lockfile's package version with the manifest; dependency graph unchanged.

## 3.0.6 — Unreleased

- M6: integrate owned sequential browser sessions with the proven native Playwright
  CLI, shared result validation, finite recovery and intent-driven resource lifecycle.
- Add optional browser target/capability configuration and protected evidence promotion.
- Preserve native commands, failure history and scoped process cleanup; add live
  browser acceptance fixtures without API/DB executors or parallel scheduling.

## 3.0.5 — Unreleased

- M5 only: add deterministic execution records and validators for frozen run inputs,
  environment capabilities, operation provenance and typed value bindings.
- Track invocation/attempt identities, phases, effect certainty, finite recovery,
  affected-row expectations and optional lifecycle obligations according to intent.
- Validate required observations, artifact ownership/integrity and complete results;
  preserve assertion failures and allow safely recovered passes with full history.
- Keep catalogs, helpers and inline definitions as peers, and allow permitted
  uncataloged exploration. No executor, SQL parser, browser command language or
  generic workflow engine is introduced.

## 3.0.4 — Unreleased

- M4 only: pin the official Playwright CLI and resolved dependencies in a separate
  development spike, with fixed synthetic Windows/Linux browser probes.
- Assess native session isolation, current snapshot references, authentication state,
  evidence, error/timeout/crash handling and scoped resource cleanup. Preserve failed
  attempts and require both platforms before a viable gate can pass.
- Record the required noninteractive invocation profile and version-specific output
  behavior without creating a second browser command language or a harness executor.
- Extend provenance checking to the spike's separately installed dependencies.
- Resolve M4 review findings with a neutral native-profile preflight, complete
  package output protection and mandatory evidence-category validation. Preserve
  the original review and run history; acceptance requires fresh independent review.

## 3.0.3 — Unreleased

- M3: migrate all thirteen skills into the canonical `.agents/skills` library;
  retain thin legacy redirects and expose the same content to both native hosts.
- Add consumer adoption with conflict preflight, instruction/configuration merges,
  explicit environment selection, immutable package links and migration receipts.
- Move review, prerequisite, tracker and hook state to consumer storage; preserve
  imported team libraries and existing application/framework code.
- Add bounded local-source validation with assertions, optional external references
  and source fingerprints, without ADO configuration or operation execution.
- Update installed tracker, metrics, hooks and legacy ADO root selection. Keep
  sequential execution and reviewed knowledge promotion explicit.
- No M4 spike, host adapter, executor, public push or release is included.

## 3.0.2 — Unreleased

- M2 only: maintain `element-locators` in `.agents/skills` and retain thin redirects
  at its existing Claude paths. The other twelve skills remain in place.
- Add a Claude plugin manifest pointing directly to the canonical skill directory.
- Add separate package, consumer and run roots with overwrite/escape refusal fixtures.
- Add native discovery and six-case host proof tooling with reference-read evidence,
  immutable-package checks and semantic comparison. See the M2 validation record for
  actual host outcomes; packaging or process exit alone is not a behavior proof.
- Complete the six-case Windows proof through both native hosts. Record an explicit
  available Claude model per attempt when its configured alias is unsupported; normalize
  native Windows path escaping without relaxing file-content evidence requirements.
- No bulk migration, production host adapters or executors are included.

## 3.0.1 — Unreleased

- M1: replace private ledgers and prerequisites with clean templates; sanitize
  documentation, examples and private script defaults.
- Add repeatable syntax, JSON, link, convention, privacy, secret and provenance gates.
- Require meaningful convention scope; expose applied-rule counts and fail-on-warning mode.
- Correct example assertion reporting, dependencies and runtime support documentation.
- Apply MIT after owner rights confirmation; inventory dependency licenses and source provenance.
- Inspect npm package contents and exclude installed dependencies and protected recovery data.
- Publication remains blocked by unresolved credential remediation and requires explicit authorization.
- No skill relocation, new host adapter or executor implementation is included.

## 3.0.0

Added reusable technical example utilities, richer locator/validation guidance,
independent review conventions and per-case test-data guidance.

## 2.6.0

Added traceability/verification artifact checks and additional mechanical conventions.

## 2.5.0

Expanded technical utility guidance and generated-test validation practices.

## 2.4.x

Added named timeout tiers, assertion-message helpers and reporting conventions.

## 2.3.0

Expanded progress tracking and pipeline observability.

## 2.2.0

Refined reusable workflow and example guidance.

## 2.1.0

Standardized the framework's source-layer layout.

## 2.0.x

Separated convention skills and process responsibilities.

## 1.x

Initial versioned package structure and adoption protocol.
