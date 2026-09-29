# Playwright POM Harness — portable Claude Code harness for test-automation repos

A project-agnostic packaging of a battle-tested Claude Code harness for
Playwright/TypeScript Page-Object-Model test frameworks. It ships three things:

1. **A convention skill library** — 13 skills: ten that encode the
   framework's design law (folder layout, naming, POM layering, locators, actions,
   validations, test data, service classes, utils) plus three process skills:
   `framework-review` (independent convention review with a verdict), `automate-suite`
   (an end-to-end Azure DevOps suite → refined specs → executed runs → generated POM
   automation pipeline), and `plan-tracker` (a plan-scope progress dashboard rendered
   from a committed registry + append-only history ledger).
   M2 moves only `element-locators` into `.agents/skills/`; its old Claude path is a
   redirect. The other twelve skills remain in `.claude/skills/`.
2. **Lifecycle hooks** (`.claude/settings.json` + `scripts/hooks/guard.mjs`) —
   session-start reminders, advisory checks for direct master/main pushes and
   re-running an identical failed `npx playwright test` command until something
   is edited, and an automatic warn-only conventions lint after every file edit.
3. **Pipeline & enforcement scripts** (`scripts/`) — `check-conventions.mjs`
   (mechanical linter for the grep-able conventions, including a conservative
   `secret-literal` scan), `fetch-ado-suite.mjs`
   (pull an ADO test suite's cases to disk), `ado-pr.mjs` (create the delivery PR),
   `publish-ado-results.mjs` (publish outcomes to ADO test points and mark cases
   automated), and `harness-metrics.mjs` (aggregate coverage / fix-round /
   classification / drift metrics plus the needs-human queue, straight from the
   pipeline's on-disk state — `npm run harness:metrics` once wired), and
   `generate-tracker.mjs` (render the plan-tracker HTML dashboard from the
   plan-tracker skill's registry + history — `npm run tracker` once wired).

The package is versioned: see `VERSION` and `CHANGELOG.md`. Every change to the
package bumps the version with a changelog entry, so adopting repos can compare
their copy's `VERSION` against the source and read exactly what changed.

M1 sanitizes the supplied baseline and adds repeatable validation. This is a private
publication candidate until the provenance and owner-dependent items in
[docs/M1-VALIDATION.md](docs/M1-VALIDATION.md) are cleared. Do not interpret a
clean syntax or convention result as a public-release approval.

M2's representative skill proof and its current host gates are documented in
[the proof guide](docs/M2-SKILL-PROOF.md) and [validation record](docs/M2-VALIDATION.md).
This is not full workflow parity or authorization to migrate the other skills.

## Package contents

```
playwright-pom-harness/
├── README.md                  ← this file
├── AGENTS.md                  ← AI-agent entry point → the adoption protocol below
├── VERSION                    ← package version — bump with every package change
├── CHANGELOG.md               ← what changed in each version (drift check for adopters)
├── CLAUDE.md                  ← project-instructions template (edit the title, adopt the rest)
├── .env.example               ← keys the scripts and configs read (copy to .env, fill in)
├── .gitignore                 ← ready-made ignores: .env, run artifacts, personal settings
├── docs/HARNESS.md            ← the full architecture reference — read this first
├── .agents/skills/element-locators/ ← one canonical skill and its maintained playbook
├── .claude-plugin/plugin.json ← Claude plugin manifest exposing that canonical skill
├── .claude/
│   ├── settings.json          ← permissions + hook wiring (review before adopting — see note)
│   └── skills/                ← the 13-skill convention library + library index (README.md)
├── .agentex/page-map/         ← page-map contract (README.md + _template.md); entries grow per app
├── resources/
│   ├── Queries/README.md          ← team DB-query library contract — index starts empty
│   └── apisCollections/README.md  ← team API-collection library contract — index starts empty
├── scripts/
│   ├── hooks/guard.mjs        ← SessionStart / PreToolUse / PostToolUse lifecycle hook
│   ├── check-conventions.mjs  ← mechanical convention linter (`--changed` for diff scope)
│   ├── conventions-baseline.json  ← starts empty; only team decisions may add entries
│   ├── harness-metrics.mjs    ← coverage / fix-round / drift metrics + needs-human queue
│   ├── generate-tracker.mjs   ← plan-tracker renderer: registry + history → HTML dashboard
│   ├── fetch-ado-suite.mjs    ← ADO plan/suite → test/ado-suite-<id>/ case files
│   ├── ado-pr.mjs             ← create the pull request for a delivery branch
│   └── publish-ado-results.mjs← outcomes → ADO test points; mark cases automated
└── examples/                  ← OPTIONAL reference implementations (see below)
    ├── src/utils/ApiActions.ts    ← the API facade the service-classes skill assumes
    ├── src/utils/DBActions.ts     ← the DB facade (mssql) the service-classes skill assumes
    ├── src/utils/Expects.ts       ← the assertion-message facade (self-describing Allure expect steps)
    ├── src/pages/LoginPage.ts     ← example page class (banners, locators, actions, verify*)
    ├── src/apis/ApisUserManagement.ts ← example Apis<Domain> service class
    ├── src/dbs/DbsUserManagement.ts   ← example Dbs<Domain> service class
    ├── tests/                 ← example specs: LoginTests (flat), User Management/DbUserManagementTests (one folder deep — see the spec-folder convention)
    ├── resources/testData/    ← their paired <Feature>TestJsonFile.json data files
    ├── src/config/            ← skeletons: applications.ts, databases.ts, reporting.ts (allure paths + env info, single source)
    ├── global-setup.ts        ← run-lifecycle scripts ("honorary utils" — run hygiene only)
    ├── global-teardown.ts     ←   env props → generate → archive history copy → open
    ├── playwright.config.ts   ← skeleton: reporters, projects, dotenv wiring
    ├── tsconfig.json          ← TypeScript config the framework layers compile under
    ├── package.json           ← npm skeleton: scripts + devDependencies (name = your repo)
    ├── README.runbook.md      ← project-README runbook skeleton (env flags, report table)
    ├── azure-pipelines.yml    ← CI skeleton: headless run, report artifacts, Tests tab
    └── github-actions-playwright.yml ← same CI as GitHub Actions (validation only — delivery is ADO)
```

## Install into a project

1. **Copy/merge** `.claude/`, `.agents/skills/element-locators/`, `scripts/`, `docs/`, `.agentex/`, `resources/`, `CLAUDE.md`,
   and `.gitignore` to the repo root. If the repo already has a `CLAUDE.md`,
   `.claude/settings.json`, an existing skill, or `.gitignore`, merge instead of overwrite.
   Keep the canonical locator directory with its Claude redirects; copying only
   `.claude/` would leave those references broken. The separate immutable-package
   experiment in the M2 guide is not yet a general adoption installer.
2. **Edit `CLAUDE.md`**: replace `<your-repo>` in the title. The rest is
   project-agnostic and works as-is.
3. **Wire npm scripts** (optional convenience — the scripts also run via `node` directly;
   they use only Node 24 built-ins, no packages):

   ```json
   "scripts": {
     "fetch:suite": "node scripts/fetch-ado-suite.mjs",
     "check:conventions": "node scripts/check-conventions.mjs",
     "publish:results": "node scripts/publish-ado-results.mjs",
     "harness:metrics": "node scripts/harness-metrics.mjs",
     "tracker": "node scripts/generate-tracker.mjs"
   }
   ```

4. **Copy `.env.example` → `.env`** and fill in the Azure DevOps org/project/plan/PAT
   keys (used by the pipeline scripts) and whatever DB/app keys your framework consumes.
   Never commit `.env`.
5. **Scaffold the AgenTeX per-project files** (needed by the `automate-suite`
   pipeline): run the AgenTeX `/init-test` skill to create `config/project.json`,
   `environments/<env>.json`, and the `integration/` catalog — those are deliberately
   NOT part of this package, they are yours to fill.
6. **Examples folder**: if the repo is new, seed it from `examples/` — the skills assume
   `src/utils/ApiActions.ts`, `src/utils/DBActions.ts`, and root-level
   `global-setup.ts`/`global-teardown.ts` exist (copy them WITHOUT the `examples/`
   prefix: `examples/src/utils/ApiActions.ts` → `src/utils/ApiActions.ts`). The
   `playwright.config.ts`, `tsconfig.json`, `package.json`, `azure-pipelines.yml`,
   `README.runbook.md`, and `src/config/*.ts` files are skeletons — fill in
   your names, URLs, servers, and reporter choices (GitHub-hosted repos use
   `github-actions-playwright.yml` instead of the Azure pipeline — copy it to
   `.github/workflows/`; note the delivery scripts remain ADO-only). The `src/pages/`,
   `src/apis/`, `src/dbs/`, `tests/`, and `resources/testData/` files are complete,
   reference scripts validated by the package checks —
   meant to be read as living style references and copied as starting points. If
   the repo already has these layers, keep its versions and delete `examples/`.
7. **Restart Claude Code** in the repo so the SessionStart hook and skills load.

## For AI agents: adoption protocol

You are an AI coding agent, and this package (or its extracted tree) is in a repo
that wants to adopt it. Follow this protocol exactly; do not improvise.

**Step 0 — orient.** Read this README fully, then `docs/HARNESS.md`. Determine
which case applies:

- **Case A — fresh repo** (no Playwright framework yet): run install steps 1–7
  above in full, seeding the code layers from `examples/`.
- **Case B — existing framework**: install only the harness layers (`.claude/`, `.agents/skills/element-locators/`,
  `scripts/`, `docs/`, `.agentex/`, the `resources/` library contracts,
  `CLAUDE.md`, `.gitignore`) and do NOT copy `examples/` over existing code. Map
  the repo's existing folders to the skill library's layer map (`src/pages`,
  `src/apis`, `src/dbs`, `src/utils`, `src/config`, top-level `tests/`) and
  surface every mismatch to the user as a decision — never a silent rename.

**Hard rules — non-negotiable:**

1. **Merge, never overwrite.** If `CLAUDE.md`, `.claude/settings.json`, or
   `.gitignore` already exist, merge the content and show the user what changed.
2. **No credentials in committed files.** `.env` is gitignored and stays that way;
   extend `.env.example` with keys only, never values.
3. **`VERSION` and `CHANGELOG.md` belong to the package**, not the adopting repo —
   never bump them from a project. To check for updates, compare the copied
   `VERSION` against the source package and read the changelog delta down to your
   version; apply changes file-by-file, never by blind re-extract over local edits.
4. **The team libraries are derive-only.** Never edit documents imported into
   `resources/Queries/` or `resources/apisCollections/`, and never copy their
   sample literals (ids, IBANs, phone numbers, emails) into test data — the full
   contracts are in their READMEs.
5. **`scripts/conventions-baseline.json` grows only by human team decision** —
   never add an entry to silence a violation you introduced.
6. **After install, the repo's `CLAUDE.md` is your operating contract**: route
   every framework task through the skill library (skill-first rule), work on a
   purposefully-named feature branch, deliver through a pull request.

**Verify — every gate must pass before you report the install done:**

- `npm install` (or `npm ci`) succeeds; `npx tsc --noEmit` is clean.
- `node scripts/check-conventions.mjs` exits clean or legacy-only.
- `npx playwright test --list` discovers the specs (fresh repos: the example specs).
- Claude Code restarted (ask the user) so hooks and skills load — the SessionStart
  reminder printing is the proof.

**Report to the user:** what was copied, what was merged (with the diff), which
skeletons still need real values (`.env` keys, config URLs/servers, the
`package.json` name), and the verification results — including anything that
failed and why.

## Per-project files you fill in over time

| File | Starts as | Filled by |
|---|---|---|
| `.claude/skills/automate-suite/references/prerequisite-dictionary.md` | structural template | the pipeline's EXPLORE/analysis phase — it catalogs YOUR application's seedable states, data pools, and access dependencies |
| `.claude/skills/framework-review/class-ledger.md` | empty ledger | every framework review appends its finding classes |
| `scripts/conventions-baseline.json` | empty | team decisions only — never to silence a new violation |
| `resources/Queries/README.md` index | template contract, empty index | one row per DB-query document your team imports into `resources/Queries/` |
| `resources/apisCollections/README.md` index | template contract, empty index | one row per API collection your team imports into `resources/apisCollections/` |
| `.agentex/page-map/` | contract README + blank `_template.md` only | the pipeline's EXPLORE runs append verified page facts (one file per page) |
| `.claude/skills/plan-tracker/data/plan-<planId>.json` | `_registry-template.json` template only | you — copy the template to `plan-<planId>.json` and fill in your plan's branches, suites, cases, rulings, and filed bugs |
| `.claude/skills/plan-tracker/data/history.jsonl` | empty ledger | append-only dated status events — every automation wave, re-test, or team ruling that flips a case's status (`--sync` can append them from pipeline state) |

## Dependencies and assumptions

- **Claude Code** (skills, hooks, and the Skill tool are the delivery mechanism).
- **Node 24** (the scripts use the built-in `fetch`).
- The test framework itself: `@playwright/test`, `allure-playwright` +
  `allure-commandline`, `dotenv`, and `mssql` if you use the DB facade.
- **Azure DevOps** for the `automate-suite` pipeline scripts (a PAT with work-item,
  test-management, and code scopes). The skill library works without ADO — only the
  pipeline scripts and the `automate-suite` skill need it.
- `publish-ado-results.mjs` writes ADO **custom process fields** (e.g. an
  automation-status field) — field names are org-specific; check the header comment
  in that script and adjust to your ADO process template.
- **AgenTeX plugin** — required by the `automate-suite` pipeline: its EXPLORE
  (execution) phase runs every refined spec through the AgenTeX `/execute-test`
  skill, and GENERATE consumes that run's `codegen-notes/` harvest. Preflight
  verifies the plugin is available and STOPS if it is not — execution is never
  silently skipped; only an explicit user "generate directly" bypasses it (recorded
  in the suite manifest as `explore.skipped: true`). The convention skill library
  itself (everything outside `automate-suite`) works without AgenTeX. AgenTeX's
  per-project files (`config/project.json`, `environments/<env>.json`,
  `integration/` catalogs) are not shipped here — scaffold them with `/init-test`
  (install step 5).

## Security notes for adopters

- `.claude/settings.json` is deliberately **permissive** (broad allow-list, no
  approval prompts for most tools) — that is a team preference inherited from the
  source package. Review the `permissions` block against your own risk tolerance
  before adopting it.
- Personal/local settings (`.claude/settings.local.json`) are intentionally NOT part
  of this package — keep tokens and machine-local env there, gitignored.
- The skills enforce a credentials rule: pre-existing credentials live only in `.env`
  (via `process.env`), never in committed files; see the `test-data` skill.

## M1 validation and publication

Run the package checks with Node 24. Source rights have been confirmed and MIT
applied; the root package remains private pending explicit publication authorization
and outstanding security remediation. Read [the validation record](docs/M1-VALIDATION.md),
[provenance](docs/PROVENANCE.md), and [security guidance](SECURITY.md).

Consumer configuration, manual source cases, populated knowledge/tracker records,
authentication state and runtime evidence do not belong in the public package.
The supplied historical incident records were replaced with clean templates.

M1 does not relocate skills, implement provider-neutral executors or claim Claude/Codex
parity. Existing AgenTeX/ADO dependencies of automate-suite remain until later work.

Package maintenance commands (from this directory):

```sh
npm run check:syntax
npm run check:json
npm run check:links
npm run check:conventions
npm run test:conventions
npm run test:validation
npm run test:roots
npm run test:skill-proof
npm run test:fetch
npm run check:privacy
npm run check:secrets
npm run check:provenance
npm run check:publication
npm ci --prefix examples --ignore-scripts
npm run typecheck:examples
```

The package convention command checks `examples/` with warnings treated as errors.
For an adopted framework, use `node scripts/check-conventions.mjs --root <project>`.
An empty scope or unresolved Git base exits with an error; `--changed --base-ref <ref>`
selects committed, staged, unstaged and untracked changes against a real reference.
Baseline entries identify an individual finding by rule, file, line and fingerprint.
Old broad entries require manual review, and secrets cannot be baselined. Never extend
a baseline just to suppress a new finding. JSON checks parse syntax; local link checks
verify file targets, not anchors or remote availability. Publication inspection is an
offline npm pack dry run and does not publish anything.
