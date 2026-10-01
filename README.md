# Playwright POM Harness

A portable convention library and adoption toolkit for Playwright/TypeScript
Page Object Model projects, shared by Claude Code and Codex.

All 13 skills live in `.agents/skills`. Claude's plugin manifest and native Codex
consumer links resolve to the same maintained files. Legacy `.claude/skills`
Markdown files are compatibility redirects. Package version: see [VERSION](VERSION)
and [CHANGELOG.md](CHANGELOG.md).

M3 adds safe adoption into a separate consumer, consumer-owned state, local scenario
loading and deliberate environment-profile selection. It does not implement browser,
API or database executors or claim full workflow parity. The representative native
host behavior proof is described in [M2 validation](docs/M2-VALIDATION.md).

M4 adds a separate pinned official Playwright CLI viability spike. Its fixed
synthetic probes validate owned browser sessions on Windows and Linux without
implementing a harness executor. See [the spike guide](docs/M4-PLAYWRIGHT-CLI.md)
and [actual M4 validation](docs/M4-VALIDATION.md).

M5 adds [minimal execution contracts](docs/M5-EXECUTION-CORE.md): frozen inputs,
capability decisions, typed bindings, effects, recovery, required lifecycle results
and verified evidence. These are deterministic library functions; they do not
dispatch browser, API or database operations. Run their focused tests with
`npm run test:core`. See [M5 validation](docs/M5-VALIDATION.md) for acceptance status.

M6 connects those records to [sequential native browser execution](docs/M6-BROWSER.md),
including owned cleanup, effect-aware recovery and sanitized evidence. Browser actions
use official CLI arguments. See [M6 validation](docs/M6-VALIDATION.md) for current gates.

M7 adds the [shared API runtime](docs/M7-API.md) for configured CRUD, typed inputs and
outputs, sanitized evidence and effect-aware recovery. Catalogs, helpers, inline
definitions and dynamic exploration share the same controls. See
[M7 validation](docs/M7-VALIDATION.md) for its acceptance status.

M8 adds the [SQL Server runtime](docs/M8-SQLSERVER.md) with real driver binding,
configured scope, affected-row expectations, protected evidence and optional guarded
restoration. See [M8 validation](docs/M8-VALIDATION.md) for acceptance and real-instance
coverage.

M9 adds [sequential mixed execution](docs/M9-SEQUENTIAL.md): one scenario can prepare
data through SQL/API, exercise the UI/API, verify through API/SQL and perform only
its required cleanup/restoration. See [M9 validation](docs/M9-VALIDATION.md).

M10 adds [native PostgreSQL execution and database neutrality](docs/M10-POSTGRESQL.md)
through the same database interface, with engine-specific SQL and types. See
[M10 validation](docs/M10-VALIDATION.md).

M11 adds [execution and host parity](docs/M11-HOST-PARITY.md): semantic comparison
of validated results, thin native hook payload adapters and fixed Claude/Codex
execution probes. See [M11 validation](docs/M11-VALIDATION.md) for the actual gate
status. Full generation/review/verification parity is the separate M15 gate.

M12 adds [optional ADO adapters](docs/M12-ADO.md) for retrieval, outcome publication,
work-item linking and source-control delivery. Compatibility commands use explicit
consumer configuration, preview remote mutations by default and retain write
receipts. Local sources remain independent of ADO. See [M12 validation](docs/M12-VALIDATION.md).

M13 connects assessed execution to durable POM automation through
[generation, independent review and two scoped green runs](docs/M13-GENERATION.md). See
[M13 validation](docs/M13-VALIDATION.md) for actual evidence and limits.

M14 adds [validated JSON, Markdown and static HTML reports, plus Allure integration](docs/M14-REPORTING.md).
Reports preserve execution verdicts, recovery and intent-driven lifecycle outcomes.
Generated verification can capture native Allure detail in isolated consumer folders;
report generation runs after native flush. See [M14 validation](docs/M14-VALIDATION.md).
The reporting follow-up uses Allure Report 3.19.1 on Node, without Java or changes
to test/action code. See [Allure 3 validation](docs/ALLURE3-VALIDATION.md).

M15 adds the [complete sequential Claude/Codex lifecycle proof](docs/M15-WORKFLOW-PARITY.md),
from local source and actual native POM authoring through independent review, two
scoped green runs, Allure 3 reporting and delivery readiness. See
[M15 validation](docs/M15-VALIDATION.md) for actual gate status.

M16 adds [bounded parallel execution](docs/M16-PARALLEL.md) around whole sequential
scenario lifecycles. Sequential remains the default; explicit parallel batches require
independent resources and preserve isolated evidence, cleanup and verdicts. See
[M16 validation](docs/M16-VALIDATION.md).

## Install into a project

Keep this package in its own directory; do not overlay it on application code.
From the consumer, run the installed package's adoption command with an explicit
profile, inspect its preview, then apply the same command without `--dry-run`:

```sh
node ../playwright-pom-harness/scripts/adopt-project.mjs --project-root . --environment qa --mode test --dry-run
node ../playwright-pom-harness/scripts/adopt-project.mjs --project-root . --environment qa --mode test
```

Use the actual relative package location. Choose `test`, `protected` or `custom`
deliberately; environment names do not grant permissions. The package may also be
installed inside the consumer in a dedicated directory. Consumers cannot be inside
the package. Node 24 is the validated runtime.

The command links 13 canonical skills for Codex, merges small instruction blocks
and ignore entries, initializes configuration and consumer state, and preserves
application code, host settings and imported libraries. Customized existing skills
require a reviewed merge; the command refuses to overwrite them. It does not install
dependencies, seed application code, enable hooks, or configure external services.

For Claude, start the native host in the consumer with the installed package:

```sh
claude --plugin-dir ../playwright-pom-harness
```

Read [the adoption guide](docs/M3-ADOPTION.md) for configuration, migration receipts,
local-source format, hook wiring and validation. No ADO account or AgenTeX plugin is
needed to adopt the skills or load local scenarios.

## For AI agents: adoption protocol

**Step 0 — orient.** Read this README, [the architecture reference](docs/HARNESS.md)
and [the adoption guide](docs/M3-ADOPTION.md). Distinguish package maintenance from
consumer adoption. Determine the consumer's current framework and installed package:

- **Fresh repository:** adopt the harness, then seed appropriate files from `examples`
  only as part of the requested framework setup. Fill in the consumer's names,
  destinations and reporter choices. Examples are optional starting points, not live
  tests against a supplied application.
- **Existing framework:** adopt only the harness integration. Preserve application
  and framework code; map existing folders to the canonical layer map. Surface
  mismatches as decisions instead of silently renaming or replacing files.

**Hard rules:**

1. Merge instructions, configuration, settings and ignore files; never overwrite
   consumer customizations. Inspect the adoption preview and report its actual diff.
2. Keep credentials out of committed files. Use secret references; `.env` and private
   host settings remain ignored. Do not place consumer data in the package.
3. Package `VERSION` and `CHANGELOG.md` belong to the package. Compare versions and
   changelog changes when upgrading; do not bump them from an adopting project.
   A new package location requires reviewed relinking, not deletion of custom skills.
4. Imported files in `resources/Queries` and `resources/apisCollections` are immutable
   sources for derived assets. Do not copy private sample identities into test data.
5. Consumer `scripts/conventions-baseline.json` changes require a team decision.
   Do not expand it to hide newly introduced violations or narrow validation scope.
6. Route framework work through the canonical skills and the consumer's instructions.
   Reuse the current suitable feature branch and add commits. Deliver through review;
   external pushes, publishing and release actions require the user's authorization.

**Verify before reporting adoption complete:**

- Confirm the preview/apply results, configuration, existing-file preservation and
  all 13 links. Repeat adoption should produce no changes.
- Verify native discovery for each intended host in the actual consumer. A link or
  valid manifest alone is not proof that the host loaded it.
- Run consumer dependency installation and typechecking when framework code is present.
  Run the installed convention checker with `--root <consumer>` and inspect its
  nonzero file/rule counts. Empty framework scope is incomplete, not a clean pass.
- List the consumer's Playwright tests; run scoped tests only with configured targets.
  Listing/typechecking does not prove browser or database integration.
- If hooks are explicitly enabled, verify their startup and consumer state paths.
  The adopter preserves existing host settings and does not enable permissive defaults.

**Report:** copied/merged/linked files, preserved customizations, remaining values or
manual merges, and passed/failed/blocked/unperformed checks. Do not claim unavailable
hosts or external integration tests passed.

## Components and compatibility

| Package content | Purpose |
|---|---|
| `.agents/skills` | Canonical conventions, routing, review and process skills |
| `.claude-plugin/plugin.json` | Native Claude packaging of the canonical library |
| `.claude/skills` | Legacy Markdown redirects |
| `scripts/adopt-project.mjs` | Consumer onboarding and known-legacy migration |
| `scripts/load-local-source.mjs` | Validate local scenarios and record source provenance |
| `scripts/spikes/playwright-cli` | Development-only pinned native CLI viability probes |
| `scripts/lib/execution-core` | Shared execution records, policy decisions and result/evidence validation |
| `scripts/lib/api` | Shared sequential API execution, credential binding, evidence and recovery |
| `scripts/lib/database` | Scoped SQL Server/PostgreSQL execution with actual driver binding and optional restoration |
| `scripts/lib/sequential` | Fixed mixed lifecycle using one shared scenario record and the existing runtimes |
| `scripts/lib/parallel` | Opt-in bounded batches of independent sequential scenarios |
| `scripts/lib/integrations` | Optional ADO sources, outcome/work-item management, source-control delivery and receipts |
| `scripts/check-conventions.mjs` | Mechanical POM convention checks |
| `scripts/hooks/guard.mjs` | Optional advisory Claude hooks |
| `scripts/generate-tracker.mjs`, `scripts/harness-metrics.mjs` | Consumer reporting tools |
| `examples` | Synthetic POM examples and dependency manifest |
| `resources` | Derive-only team-library contracts |

The legacy ADO suite workflow retains its fetch, PR and result-publication entrypoints
over the M12 adapters. Those commands require explicit ADO configuration and do not
depend on AgenTeX. Current generation, review and verification use the M13 procedure
and shared runtimes. Historical plugin commands remain compatibility reference only.
Existing service/helper patterns remain valid. Catalogs are optional reuse assets.

The old `.claude/settings.json` is a permissive compatibility template, not an
installation default. Hooks remain advisory and fail open; they do not replace host
permissions, reliable test verdicts or remote branch policies.

## Package validation and release

[M17](docs/M17-CI.md) defines the installed-package/platform gates and the
[actual validation status](docs/M17-VALIDATION.md). Root dependencies are frozen in
the distributed `npm-shrinkwrap.json`; the two development fixtures retain their
own lockfiles. A passing source checkout alone does not prove an installed package.

```sh
npm ci --ignore-scripts
npm ci --prefix scripts/spikes/playwright-cli --ignore-scripts
npm run check:syntax
npm run check:json
npm run check:contracts
npm run check:links
npm run check:conventions
npm run test:api
npm run test:database
npm run test:sequential
npm run test:postgresql
npm test
npm run test:fetch
npm run check:privacy
npm run check:secrets
npm run check:provenance
npm run check:publication
npm ci --prefix examples --ignore-scripts
npm run typecheck:examples
```

`npm run check:ci` runs the fixed local checklist with private check logs.
`npm run test:installed -- <new-external-directory>` builds the actual archive,
installs it and its locked development fixtures, checks its dependency graph,
runs that checklist and verifies installation immutability. See M17 for the
separate native proofs and authenticated host prerequisites.

The package tests inspect the separately installed, pinned CLI configuration resolver.
They do not require a browser download; live M4 probes have separate prerequisites.
The SQL Server runtime uses the root lockfile's pinned driver. `npm run probe:database`
separately provisions, tests and removes a disposable development SQL Server through
Docker; it fails if the required real instance cannot run. See the M8 guide for its
requirements and the Linux-client option.
`npm run probe:mixed` adds a synthetic SQL-backed HTTP/UI application and the pinned
native browser to that real fixture. Its prerequisites and pinned Linux-client option
are documented in the M9 guide.
`npm run probe:postgresql` validates a disposable PostgreSQL instance.
`npm run probe:database-neutrality` compares the same 12 scenarios on SQL Server and
PostgreSQL; add `-- --linux-client` for pinned Linux clients. These probes require
Docker and fail when a required instance or check is unavailable.

The convention gate checks `examples` with warnings treated as errors. Zero scope or
an unresolved Git base fails. JSON parsing is not schema validation; link checks cover
local files, not remote URLs or anchors. Publication inspection is an offline package
dry run, not a publication action.

See [M1 validation](docs/M1-VALIDATION.md), [provenance](docs/PROVENANCE.md) and
[security guidance](SECURITY.md). Original rights are owner-cleared and required
notices retained. The owner confirmed historical credential revocation/rotation on
2026-10-01; the credential was not tested or reproduced.
The package is private; a clean validation run is not public-release authorization.

See [M3 validation](docs/M3-VALIDATION.md) for actual adoption, local-source and
native-host results. [M4 validation](docs/M4-VALIDATION.md) records the focused CLI
gate and the stopping point before execution-core implementation.
