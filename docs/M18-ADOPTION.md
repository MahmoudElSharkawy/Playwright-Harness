# M18 archive adoption

M18 replaces the sibling-checkout installation with a versioned release archive that a
project installs with one command. Users and AIs follow
[Get started](../README.md#get-started); the `harness-setup` skill holds the AI procedure.

## The adoption model

- **Install.** `npx --yes --package "<archive>" pom-harness setup` runs the archive's own
  code. It finds the archive: `--archive`, then the spec npx recorded, then one matching
  file in the project. It verifies an adjacent `.sha256` and previews the new version's
  whole adoption plan before writing. It then copies the archive to `.harness/vendor/`
  and installs it with `npm install --save-dev --save-exact file:.harness/vendor/<archive>`,
  adding the starter's exact dependencies in a project without Playwright. Finally it
  hands over to the installed copy, which adopts the project.
- **Links.** Each skill is linked into `.claude/skills/` and `.agents/skills/`, with a
  `ROOTS.md` pointer in each folder. Links are junctions on Windows and relative symbolic
  links elsewhere. `.harness/links.json` records them without machine paths, and a guarded
  root `postinstall` restores them after `npm ci`. Per-link ignore lines keep them out of git.
- **Ownership.** Setup creates a link only where nothing exists. It repairs only links
  that hold no content: a link into a harness package, or a dangling recorded link.
  Anything else is preserved and stops the run, with all conflicts listed together.
- **Journal.** Each run records, under `.harness/state/setup/<run>/`:
  - the previous bytes of every file it writes;
  - every folder it removes;
  - every link target it replaces.

  `setup --restore` replays the journal in reverse. It runs `npm ci` only when a lockfile
  existed before the run.
- **Commands** act only as the project's own installation. The CLI refuses to run unless
  it sits at `<project>/node_modules/playwright-pom-harness`, at the version the lockfile
  records. `check` reports per-feature readiness, and `unlink` detaches the links before
  a rollback.
- **Starter configuration.** `src/config/targets.ts` reads `.harness/targets.json`, so
  destinations are entered once for both the harness and the tests.

## npm 12 results

Recorded 2026-10-02 in CI with npm 12.2.0 on Linux and Windows, consuming an archive packed
with npm 11. Install, rerun, CRLF clone, rollback, conflict, failure recovery and parent-folder
flows pass. npm 12 changes two things:

- `npm pack --json` returns an object keyed by package name, not an array. The consumer flows
  find the archive by its `<name>-<version>.tgz` name instead.
- npm 12 leaves `npm-shrinkwrap.json` out of the archives it packs. Releases are therefore packed
  with npm 11. On an installation without the file, `check` reports that dependency versions
  were not compared, instead of failing.

## Phase 0 spike results

Recorded 2026-10-02 on Windows 11 with Node 24.15.0. These results decide the M18
implementation; see the plan in the PR description. Linux and npm 12 results are
not recorded here yet and are covered by the planned CI consumer flow.

### Claude Code: per-skill project links

Claude Code 2.1.286, a `--print` session on the smallest model, in a temporary git project.
Each `.claude/skills/<name>` was a directory junction to
`node_modules/playwright-pom-harness/.agents/skills/<name>`, with per-link ignore lines.

| Check | Result |
|---|---|
| All 13 skills listed in the session's init event | PASS, 13/13, under plain names (no plugin prefix) |
| A skill invoked and its references followed | PASS: invoked `element-locators`, then read `pom-architecture/references/design-conventions.md` through the neighbouring link and its own `references/playbook.md` |
| Cost of the two sessions | USD 0.052 |

Decision: per-skill links replace the plugin and marketplace route. One gap found: every
skill also links `../ROOTS.md`, and the design conventions link `../../ROOTS.md`. Only skill
folders are linked, so setup must also provide the shared `ROOTS.md` and skill index
`README.md` next to the links. They will be git-ignored copies, refreshed by setup and
`postinstall`, and owned through a content digest.

Not yet checked: Linux symlinks, a skill install during a running session
(`/reload-skills`), and two projects on different harness versions.

### Codex: per-skill project links

Codex CLI 0.155.0-alpha.16.3, `app-server` `skills/list` (no model call). The same layout
as above, under `.agents/skills/`.

| Check | Result |
|---|---|
| Harness skills discovered with the per-link ignore lines | PASS, 13/13, reported at their real `node_modules` paths, no errors |
| Harness skills discovered without them | PASS, 13/13. Ignore lines do not affect discovery |
| A real folder and a link to a package outside `node_modules` | Both discovered |
| `git status` without the per-link ignore lines | 34 skill files appear through the junctions |

Decision: keep links for Codex. The per-link ignore lines are required.
Not yet checked: Linux symlinks.

### npx with a local archive

npm 11.12.1, the npm bundled with Node 24.15.0. A throwaway package with one `bin`.

| Command form | Empty folder | Folder under a parent `package.json` |
|---|---|---|
| `npx --yes <absolute path>` (either slash style) | **Exits 0 without running anything** | Same |
| `npx --yes ./archive.tgz` | Runs | `ENOENT`: resolved against the parent's prefix |
| `npx --yes file:<absolute path with forward slashes>` | Runs | Runs |
| `npx --yes file:///…` URL | `ENOENT` | `ENOENT` |
| `npx --yes --package <absolute path> <bin> …` | Runs | Runs |

- The running command gets its arguments, and `INIT_CWD` is the folder npx was started in.
- npx records the archive spec in its own install folder's `package.json`, relative to that folder. So the command can find the archive it was started from.
- `npx --no <name>`, with nothing installed, still queries the registry (404). It refuses to install, but it does contact npm.

Decisions:
- The documented command is `npx --yes --package "<absolute path to the archive>" pom-harness setup`. It accepts Windows paths as pasted and names the command explicitly.
- A bare path must never be used: it silently does nothing.
- Archive discovery order: `--archive`, then the spec npx recorded for its own installation, then a single version-matching archive in the project root.
- Docs must not say `npx --no` avoids npm. Commands verify they are the project's own installation instead.

Not yet checked: npm 12 (installing it locally was declined; the CI npm 12 job covers it).

### Dependency drift on a plain install

npm 11.12.1. The packed harness was installed into a fresh project with
`npm install --save-dev --save-exact file:<archive>`, with no overrides and the default strategy.

| Result | Value |
|---|---|
| Cleared packages installed | 87/87, all hoisted, none nested under the harness |
| Re-resolved despite the shipped shrinkwrap | `@js-joda/core` 6.1.0 → 6.2.0 (required by `tedious` as `^6.0.1`); `@types/node` 26.6.3 → 26.6.4 (required by `tedious` as `>=22` and `@types/readable-stream` as `*`) |
| Extra or missing packages | None |

Decisions:
- Pin `@js-joda/core` 6.1.0 as an exact direct dependency, with its existing provenance record.
- Pin `tedious` 20.0.0 the same way. With npm 11.19.0 (CI, and Linux in Docker), a plain install
  re-resolved `tedious` itself to 20.3.3, which `mssql` 12.7.2 accepts (`^19.2.2 || ^20.0.0`).
  npm 11.12.1 kept 20.0.0, so the drift showed only on the newer npm. The consumer flows caught it.
- Do not pin `@types/node`. Projects bring their own (the examples use `^24`), so a pin would only add a second copy. It contains type declarations only. `check` reports its drift as information rather than as a failure.
