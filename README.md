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
| `scripts/check-conventions.mjs` | Mechanical POM convention checks |
| `scripts/hooks/guard.mjs` | Optional advisory Claude hooks |
| `scripts/generate-tracker.mjs`, `scripts/harness-metrics.mjs` | Consumer reporting tools |
| `examples` | Synthetic POM examples and dependency manifest |
| `resources` | Derive-only team-library contracts |

The legacy ADO suite workflow and its fetch, PR and result-publication commands remain
compatibility facilities. They require explicit ADO configuration and the legacy
AgenTeX integration for exploration. They are separate from local-source onboarding;
neutral execution and optional ADO adapter restructuring are later milestones.
Existing service/helper patterns remain valid. Catalogs are optional reuse assets.

The old `.claude/settings.json` is a permissive compatibility template, not an
installation default. Hooks remain advisory and fail open; they do not replace host
permissions, reliable test verdicts or remote branch policies.

## Package validation and release

```sh
npm run check:syntax
npm run check:json
npm run check:links
npm run check:conventions
npm test
npm run test:fetch
npm run check:privacy
npm run check:secrets
npm run check:provenance
npm run check:publication
npm ci --prefix examples --ignore-scripts
npm run typecheck:examples
```

The convention gate checks `examples` with warnings treated as errors. Zero scope or
an unresolved Git base fails. JSON parsing is not schema validation; link checks cover
local files, not remote URLs or anchors. Publication inspection is an offline package
dry run, not a publication action.

See [M1 validation](docs/M1-VALIDATION.md), [provenance](docs/PROVENANCE.md) and
[security guidance](SECURITY.md). Original rights are owner-cleared and required
notices retained. Historical credential revocation/rotation remains unresolved.
The package is private; a clean validation run is not public-release authorization.

See [M3 validation](docs/M3-VALIDATION.md) for actual adoption, local-source and
native-host results. [M4 validation](docs/M4-VALIDATION.md) records the focused CLI
gate and the stopping point before execution-core implementation.
