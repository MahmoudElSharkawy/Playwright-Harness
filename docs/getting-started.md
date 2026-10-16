# Getting started

Install the harness into the project where you want to write Playwright tests.
This repository supplies the reusable skills and tools; your project owns the
application-specific automation. See [architecture](architecture.md) for both layouts.

## Prerequisites

Use Node 24, git, and Claude Code or Codex. Setup can add a minimal Playwright
starter to a new project or preserve an existing framework. You need access to
the application and only the API, database or Azure DevOps services your scenarios use.
Local automation does not require Azure DevOps.

## Install with an agent

Open your project and ask:

> Install the harness from https://github.com/MahmoudElSharkawy/Playwright-Harness.

The agent follows the [installation protocol](../README.md#for-ai-agents): resolve
one release tag, download its archive and checksum, verify the checksum, then run
setup from that archive. Review the resulting diff and setup summary.

Next ask:

> Here is my project information; configure the harness and use it.

Provide environment names, application URLs, and any API/DB targets needed.
Choose each environment's operation mode deliberately. The `harness-setup` skill
creates secret references and empty local `.env` keys for you to fill in;
secret values do not belong in chat or committed configuration.
See [configuration](configuration.md) for complete examples.

## Install manually

Download `playwright-pom-harness-<version>.tgz` and its `.sha256` from the same
[release tag](https://github.com/MahmoudElSharkawy/Playwright-Harness/releases/latest).
Verify the archive against the checksum, then run from your project:

```sh
npx --yes --package "<absolute path to the .tgz>" pom-harness setup
npx --no pom-harness setup --environment qa --mode test
npx --no pom-harness check
```

Keep the adjacent checksum for setup's own verification. A bare archive path to
`npx` can exit without running setup; name the package and command as shown.
`npx --no` refuses installation but may still contact npm. Harness commands also
verify that they are running as your project's installed, lockfile-recorded version.

The first profile starts with empty target lists. Add target definitions and
environment references together before execution. Rerunning setup with a different
mode does not silently change an existing profile.

After installation, set up [ChaosEngine Core](https://github.com/ShaftHQ/SHAFT_ENGINE/tree/main/chaos-engine#install)
in the same project if you have not already. Setup includes this reminder in its next steps.

## What setup adds

| Item | Purpose |
|---|---|
| Exact development dependency and `.harness/vendor/` archive | Reproducible project installation |
| Per-skill links under `.agents/skills/` and `.claude/skills/` | One canonical library for both hosts |
| `.harness/links.json` and a guarded `postinstall` | Restore managed links after `npm ci` |
| Managed blocks in `AGENTS.md` and `CLAUDE.md` | Routing, ownership and branch rules |
| Missing ignore entries | Keep secrets, runtime state and reports out of git |
| Setup journal under `.harness/state/setup/` | Recover or restore an interrupted setup |

On Windows the skill links are directory junctions; elsewhere they are relative
symbolic links. A shared `ROOTS.md` pointer explains package and consumer roots.
Resolve linked skills to their real path before following package references.

If Playwright is absent, setup supplies missing configuration, lifecycle scripts,
technical utilities, `.env.example`, and README when none exists, plus the starter's
exact development dependencies. It creates no demo pages or tests. The starter's
`src/config/targets.ts` reads `.harness/targets.json`, so destinations are entered once.
Existing code, instructions, host settings and imported team libraries are preserved.
Optional host hooks are not enabled by setup.

### Windows junction readability

Setup, readiness checks, restore and unlink require a filesystem location where
Node can read the stored target of a directory junction, including after that
target is removed. Some Windows locations do not meet this requirement. On the
maintainer's Windows 11 host, the user Temp folder fails with Node 24.15.0 and
24.21.0, while a normal workspace or short external scratch folder works. A Node
upgrade alone is not a verified remedy.

If a command reports `Cannot read existing discovery entry`, it preserves that
entry and refuses to infer ownership from `.harness/links.json`. Restore the
original target from your known previous installation, or move the project
outside the affected directory tree and rerun the command. Preserve custom or
unknown entries; do not delete them merely because inspection failed. Adoption
plans discovery changes before writing instructions or configuration. Restore and
unlink can have completed earlier operations before reaching an unreadable entry.

Maintainers can compare locations with the [junction probe and recorded evidence](reference/windows-junctions.md).
For validation fixtures, set both `TEMP` and `TMP` to a short existing directory
outside any harness installation or consumer project, after verifying it with
the probe. Changing test temp does not repair existing project links.

## Check readiness and choose a workflow

`npx --no pom-harness check` reports readiness by feature: ready, unavailable,
waiting for project data, or not configured. Broken installation or invalid
configuration makes it exit with status 1. An unrelated optional feature does
not prevent a workflow that needs no such target. Configuration validation
does not prove connectivity or successful application execution. A link is also
not proof that a host loaded a skill: confirm discovery in the actual host. Reload
skills in Claude Code or restart Codex if discovery needs refreshing.

For automation, start with one small local source or configured ADO suite/story:

```text
/automate-test local .harness/sources/<name>.json on qa
/automate-test suite <id> [plan <id>] on qa
/automate-test story <id> on qa
```

Follow the [automation workflow](PIPELINE.md) through exploration, authoring,
independent review and two scoped green runs. The convention checker must report
nonzero file and rule counts. Use the [manual execution guide](manual-execution.md)
for ADO cases you want to execute without generating code.

## Teammates and CI

Commit the release archive, dependency declarations/lockfile, link manifest and
reviewed consumer configuration. Teammates and CI run `npm ci`; the guarded
postinstall restores links without requiring a sibling harness checkout or plugin
launch flag. Each machine fills its own ignored secret values. Public package
configuration must never contain private project destinations. Production installs
with `--omit=dev` skip the harness and its links.

Consumer CI uses Node 24, `npm ci`, matching browser installation, and the test run
in that order. For the consumer's Playwright tests:

```sh
npx playwright install --with-deps chromium
```

Map CI secrets to the same variable names used locally. The setup skill can adapt
the supplied GitHub Actions or Azure Pipelines templates while preserving existing
steps; setup does not enable a pipeline automatically.

### Selective Git ignore policy

Do not ignore the entire `.harness/` directory. It holds both shared project inputs
and machine-local output. A blanket `.harness/` ignore hides the release archive
needed by `npm ci` and the configuration and link manifest needed by fresh clones.

| Consumer path | Git policy | Purpose |
|---|---|---|
| `.harness/runs/` | Ignore | Generated execution evidence |
| `.harness/state/` | Ignore | Local workflow state, locks, tracker state and setup journals |
| `.harness/knowledge-candidates/` | Ignore | Unreviewed observations |
| `.harness/installation.json` | Ignore | Local installation receipt |
| `.harness/vendor/` | Commit | Release archive required by teammates and CI |
| `.harness/sources/` | Commit | Versioned local test scenarios |
| `.harness/knowledge/` | Commit | Reviewed, reusable project knowledge |
| `.harness/project.json` | Commit | Environment configuration |
| `.harness/targets.json` | Commit | Targets and secret references |
| `.harness/integrations.json` | Commit when present | Optional integration configuration |
| `.harness/links.json` | Commit | Manifest used to restore managed skill links |

Setup adds these selective rules to the consumer's `.gitignore`:

```gitignore
/.harness/runs/
/.harness/state/
/.harness/knowledge-candidates/
/.harness/installation.json
```

If a team rule ignores `.harness/` or `.harness/vendor/`, replace that blanket rule
with the selective rules above. A file exception cannot reopen an ignored parent
directory. For a broad `*.tgz` rule, setup adds `!/.harness/vendor/*.tgz`; readiness
still reports an error if an ignored parent prevents that exception from working.
Setup preserves team rules, so review and correct the conflicting rule yourself.

Configuration stores secret references; actual secret values remain in the ignored
`.env`. Committed scenarios and reviewed knowledge must be suitable for the repository's
audience. Ignore rules do not untrack existing files, and setup does not remove them;
any decision to stop sharing already tracked state needs a separate team review.
See [consumer-owned state](configuration.md#consumer-owned-state) for storage ownership.

## Update, recover and roll back

Ask an agent to **update the harness and preserve project customizations**, or run
setup from a newer verified release archive. Read its
[upgrade actions](../CHANGELOG.md) and review the proposed diff. The consumer does
not bump the harness's `VERSION` or `CHANGELOG.md`.

Setup preflights the complete plan and reports conflicts before writing. It repairs
only recognized managed links, replaces only recognized released instruction blocks,
and preserves customized skills, foreign links and edited blocks. Move useful local
rules into consumer instructions or distinctly named project skills after reviewing
the collision, then retry. Do not overwrite custom content to bypass a conflict.

Legacy state migrates with source fingerprints. Conflicting destinations require
review, and unchanged legacy sources do not overwrite newer consumer state. Tracked
data that would become ignored is kept and reported for a team decision.

An interrupted setup can be rerun idempotently or restored from its journal:

```sh
npx --no pom-harness setup --restore
```

Restoration replays previous files and link targets; it runs `npm ci` only when a
lockfile existed before the setup run. For a deliberate version rollback, preserve
your current work, detach managed links with `npx --no pom-harness unlink`, restore
the reviewed dependency/lockfile/archive state, then run `npm ci` and readiness again.
The [setup playbook](../.agents/skills/harness-setup/references/playbook.md) owns
the detailed recovery procedure.
