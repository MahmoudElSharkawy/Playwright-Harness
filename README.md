# Playwright POM Harness

Conventions, skills and tools that let Claude Code and Codex write and maintain
Playwright/TypeScript Page Object Model test automation in your project, with
reviewed code and verified runs. Version: see [VERSION](VERSION) and [CHANGELOG.md](CHANGELOG.md).

For live manual execution, ask `/execute-test suite <id> [plan <id>] [on qa]`
or `/execute-test story <id>`. The agent runs browser/API/DB cases, produces a
verified dashboard and defect list, and can preview ADO bug filing and suite
outcomes. See [manual execution](docs/M19-EXECUTE.md). No POM code is generated.

## Get started

You need Node 24, git, and Claude Code or Codex. Open your project folder and ask the AI:

1. **"Install the harness from https://github.com/MahmoudElSharkawy/Playwright-Harness."**
   The AI downloads the latest release, verifies its checksum, runs setup, and shows
   you a summary and the diff. Review the changes and commit them. If the skills do
   not appear yet, run `/reload-skills` in Claude Code, or restart Codex.
2. **"Here is my project information; configure the harness and use it."** Give it
   your application URLs, databases and environments. The AI asks whether test runs
   may change data in each environment, writes the configuration, and adds empty
   keys to `.env` for you to fill in. It then reports what is ready and continues
   with your request.
3. **Later: "Update the harness and preserve my project customizations."**

**Without AI:** download `playwright-pom-harness-<version>.tgz` from the
[latest release](https://github.com/MahmoudElSharkawy/Playwright-Harness/releases/latest)
into your project folder, with its `.sha256` file if you want setup to verify it. Run the
command below, then commit the changes.

```sh
npx --yes --package "<full path to the .tgz>" pom-harness setup
```

Pass the archive through `--package`: `npx <path>` alone exits without running setup.
Afterwards, `npx --no pom-harness check` reports what is ready, and
`npx --no pom-harness help` lists the commands.

**Teammates and CI:** `npm ci`. It installs the harness from the archive committed under
`.harness/vendor/` and restores the skill links. Configuration (step 2) adds the
browser install step to your CI pipeline.

**Roll back:** ask the AI to "roll back the harness update", or run
`npx --no pom-harness unlink`, then `git revert <the update commit>`, then `npm ci`.

Setup installs the harness as an exact development dependency and links its skills
into `.claude/skills/` and `.agents/skills/`. It merges a short block into `AGENTS.md`
and `CLAUDE.md` and adds ignore lines. In a project without Playwright, it also adds
a minimal starter: configuration and utilities, with no demo pages or tests. It never
overwrites your files. If it cannot merge something safely, it stops before changing
anything and says why.

## For AI agents

Once installed, follow the `harness-setup` skill. To install or update:

1. Resolve "latest" to one release tag: `tag_name` from
   `https://api.github.com/repos/MahmoudElSharkawy/Playwright-Harness/releases/latest`,
   or the tag the user named.
2. From that same tag, download `playwright-pom-harness-<version>.tgz` and
   `playwright-pom-harness-<version>.tgz.sha256` into the project folder:
   `https://github.com/MahmoudElSharkawy/Playwright-Harness/releases/download/<tag>/<file>`.
3. Verify the archive's SHA-256 against the `.sha256` file.
4. From the project folder, run `npx --yes --package "<absolute path to the .tgz>" pom-harness setup`.
   Never use a bare path.
5. Show the summary and `git status`. If setup stopped, show its reasons and ask the
   user; never work around them.
6. If the skills are not listed yet, ask the user to run `/reload-skills` in Claude Code,
   or to restart Codex.

Rules:

- Never extract the archive or copy package files by hand. Never ask for secret values:
  secrets go into empty `.env` keys that the user fills in.
- In Codex, approve network access and the npm cache for the download and the install.
- Preserve the project's instructions, code, settings and imported team libraries.
  Files in `resources/Queries` and `resources/apisCollections` are derive-only sources.
- `VERSION` and `CHANGELOG.md` belong to the harness; a project never bumps them.
- Changes to a project's `scripts/conventions-baseline.json` need a team decision.
- `npx --no pom-harness check` reports readiness. A link is not proof that a host loaded
  a skill: confirm that the skill is discovered in the actual host.
- Commit, push, publish or deliver only with the user's authorization.

## How automation works

The harness turns a scenario suite into reviewed Playwright POM automation:

```text
SOURCE → REFINE → EXPLORE → PREPARE → AUTHOR → CANDIDATE → REVIEW → VERIFY ×2 → READY → DELIVER
```

A local JSON source, or an explicitly configured ADO suite or story, is refined without
changing its expectations and run against the configured application to collect
evidence. Agents then write or reuse POM code. A fresh independent reviewer must approve
it, and two separate scoped Playwright runs of the same candidate must pass. Repairs are
limited to three rounds per source batch. READY does not authorize delivery; PRs and ADO
publishing are optional and need explicit authorization.

See [the automation pipeline](docs/PIPELINE.md) for each phase's inputs, outputs,
commands and contract documents. Agents run it through the `automate-suite` skill.

## Capabilities

The skills live in `.agents/skills`; setup links them for Claude Code and Codex.
Each milestone below has a guide and a validation record.

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
Test cases can also be fetched read-only from the user story they test, without plan
or suite IDs: see [story retrieval](docs/M12-ADO.md#story-scoped-retrieval) and its
[validation](docs/ADO-STORY-VALIDATION.md).

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

## Components and compatibility

| Package content | Purpose |
|---|---|
| `.agents/skills` | Canonical conventions, routing, review, process and setup skills |
| `.claude-plugin/plugin.json` | Claude plugin packaging of the same library, for development and proofs |
| `scripts/cli.mjs` | The `pom-harness` command: setup, check, unlink and the workflow scripts |
| `scripts/adopt-project.mjs` | The adoption engine setup uses, including known-legacy migration |
| `scripts/load-local-source.mjs` | Validate local scenarios and record source provenance |
| `scripts/spikes/playwright-cli` | Development-only pinned native CLI viability probes |
| `scripts/lib/execution-core` | Shared execution records, policy decisions and result/evidence validation |
| `scripts/lib/api` | Shared sequential API execution, credential binding, evidence and recovery |
| `scripts/lib/database` | Scoped SQL Server/PostgreSQL execution with actual driver binding and optional restoration |
| `scripts/lib/sequential` | Fixed mixed lifecycle using one shared scenario record and the existing runtimes |
| `scripts/lib/parallel` | Opt-in bounded batches of independent sequential scenarios |
| `scripts/lib/integrations` | Optional ADO sources, outcome/work-item management, source-control delivery and receipts |
| `scripts/check-conventions.mjs` | Mechanical POM convention checks |
| `scripts/hooks/guard.mjs` | Optional advisory Claude hooks, wired by `scripts/hooks/claude-hooks.example.json` |
| `scripts/generate-tracker.mjs`, `scripts/harness-metrics.mjs` | Consumer reporting tools |
| `examples` | The starter's source, synthetic POM examples and the dependency manifest |
| `resources` | Derive-only team-library contracts |

The legacy ADO suite workflow retains its fetch, PR and result-publication entrypoints
over the M12 adapters. Those commands require explicit ADO configuration and do not
depend on AgenTeX. Current generation, review and verification use the M13 procedure
and shared runtimes. Historical plugin commands remain compatibility reference only.
Existing service/helper patterns remain valid. Catalogs are optional reuse assets.

Hooks are optional and never enabled by setup. They remain advisory and fail open; they do not replace host
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

The package tests inspect the pinned native CLI installed with the root dependencies.
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
The npm package stays private. A release attaches the validated archive and its checksum to a
GitHub release, as [the release guide](docs/RELEASING.md) describes, and requires the owner's
authorization; a clean validation run is not that authorization.

See [M3 validation](docs/M3-VALIDATION.md) for actual adoption, local-source and
native-host results. [M4 validation](docs/M4-VALIDATION.md) records the focused CLI
gate and the stopping point before execution-core implementation.
