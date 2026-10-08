# Harness setup — playbook

The harness ships as a versioned release archive. `setup` installs it as an exact
development dependency, committed under `.harness/vendor/`, so teammates and CI get it
from `npm ci`. Skills reach Claude and Codex through links in `.claude/skills/` and
`.agents/skills/` that point into `node_modules/playwright-pom-harness`. Project data
lives under `.harness/`, and secret values only in the git-ignored `.env`.

## 1. Install or update

Prerequisites: Node 24, npm and git, run from the project folder (the folder with the
project's `package.json`, or the folder to adopt). In Codex, approve the network and
npm-cache prompts.

1. **Resolve one release tag.** Use the tag the user named. Otherwise read `tag_name`
   from `https://api.github.com/repos/MahmoudElSharkawy/Playwright-Harness/releases/latest`.
   The version is the tag without a leading `v`.
2. **Download both assets from that same tag** into the project folder:
   `https://github.com/MahmoudElSharkawy/Playwright-Harness/releases/download/<tag>/playwright-pom-harness-<version>.tgz`
   and the same URL with `.sha256` appended. Never combine files from different tags.
3. **Verify the checksum.** The SHA-256 of the archive must equal the first field of the
   `.sha256` file. Setup checks it again when the file sits next to the archive.
4. **Run setup** with the absolute archive path, quoted:

   ```sh
   npx --yes --package "<absolute path to playwright-pom-harness-<version>.tgz>" pom-harness setup
   ```

   Add `--dry-run` first to preview the plan without writing. Never run
   `npx <path to archive>`: npm exits successfully without running anything.
   Setup checks everything first, installs, then lets the installed copy adopt the
   project. It stops before writing on anything it cannot merge safely: an edited
   managed instruction block, a customized skill, foreign content at a link path, or a
   legacy skill folder holding unrecognized files. A legacy folder whose committed data
   would become per-machine is kept and reported; ask the user before moving that data.
5. **Report the result.**
   - `STOPPED`: show each stop as given and ask the user how to proceed.
   - `FAILED`: show the stops and the recovery steps.
   - `DONE` or `INCOMPLETE`: show the version change, the changed files, the link
     counts, each feature's readiness, the notes, the upgrade actions and the next steps.

   Then show `git status --short`.
6. **Commit.** The user reviews and commits the changes, or asks you to. The commit
   includes the archive under `.harness/vendor/`, `package.json`, `package-lock.json`,
   `.harness/links.json`, `.gitignore` and `.gitattributes`. Setup moves the downloaded
   archive out of the project folder after success.
7. **Discovery.** If the skills do not appear yet, the user runs `/reload-skills` in
   Claude Code, or restarts Codex.

**Update** to a newer release with the same steps. The summary lists the CHANGELOG
"Upgrade actions" of every version since the installed one: carry each out, and ask
before anything destructive. Re-verify generated suites when an upgrade action says so.

**Repair** missing or broken links with `npx --no pom-harness setup`; it is idempotent.

**Recovery** after a failed run: rerun `npx --no pom-harness setup` first. To return to
the state before the run instead, use `npx --no pom-harness setup --restore`. It puts back
the captured files, folders and links, including uncommitted edits made before setup.
It runs `npm ci` when a lockfile existed before; otherwise it removes what the run created.

## 2. Configure the project

Ask only for information that is not secret: the environment names, the application
URLs, the API base URLs, each database's engine, server, port and name, the optional
Azure DevOps organization, project and plan, and the CI system.

### 2.1 Environments: ask the mode question

For each environment, ask: **"May automated runs create, change or delete data in
<environment>?"** Never assume the answer from the environment's name.

| Answer | Mode | Runs may |
|---|---|---|
| Yes | `test` | read and change data through API, database and browser; never DDL or admin |
| No, read only | `protected` | read and explore; a mutation needs an explicit `capabilities` override |
| Only some operations | `custom` | only the capabilities set explicitly |

```sh
npx --no pom-harness setup --environment <name> --mode <test|protected|custom>
```

This creates `.harness/project.json` and `.harness/targets.json` when they are missing,
and adds the profile. The first environment becomes the default. Changing an existing
environment's mode is a reviewed edit of `.harness/project.json`: confirm it with the user.
Capability overrides are booleans under the environment's `capabilities`: `apiReads`,
`apiMutations`, `apiExploration`, `dbSelect`, `dbDml`, `dbExploration`, `ddl`, `admin`,
`browserReads`, `browserMutations`, `browserExploration`.

### 2.2 Targets

Add each destination to `.harness/targets.json`, then list its id in the environment's
`browserTargets`, `apiTargets` or `databaseTargets` in `.harness/project.json`.

```json
{
  "browser": {"app": {"origins": ["https://app.example.com"]}},
  "api": {"app": {"baseUrl": "https://app.example.com/api", "credentialRef": "env:APP_API_TOKEN"}},
  "databases": {"appDb": {"engine": "sqlserver", "connectionRef": "env:APP_DB", "server": "db.example.com", "port": 1433, "database": "App"}}
}
```

- Ids start with a letter or digit and use letters, digits, `_` and `-`.
- Browser origins are bare origins, with no path. API base URLs carry no credentials,
  query or fragment.
- `engine` is `sqlserver` or `postgresql`. Optional: `schema`, `encrypt`,
  `trustServerCertificate`.
- References are `env:NAME` with an uppercase name. An API variable holds a bearer token.
  A database variable holds `{"user":"<user>","password":"<password>"}` JSON.

**The starter** (added to projects without Playwright) reads the same file:
`src/config/applications.ts` uses the browser target `app`, and `src/config/databases.ts`
uses the database target `appDb`. Rename an entry and its target id together. A
per-machine override is named after the target: `APP_URL`, `APP_DB_SERVER`.

**An existing framework** keeps its own configuration. Use its current values for the
targets, and change its config modules only when the user asks. Map its folders to the
layer map in [pom-architecture](../../pom-architecture/SKILL.md), and raise mismatches
as decisions instead of renaming or replacing files.

### 2.3 Azure DevOps (optional)

Write `.harness/integrations.json` only when the user wants Azure DevOps:

```json
{"version": 1, "ado": {"organizationUrl": "https://dev.azure.com/your-org", "project": "Your Project", "credentialRef": "AZURE_PAT", "planId": 123}}
```

Here `credentialRef` is a bare variable name. Optional fields: `repository` and
`automationField` (`Custom.<Field>`). Local sources never need Azure DevOps.

When report linking is requested, populate existing Allure `links.tms` and
`links.issue` templates from configured coordinates or explicit destinations. Test
and bug destinations may differ. Formatting a work-item URL requires neither a PAT
nor a network call; destination validation is separate from authentication readiness.
Use the existing destination formatter, including encoded project names, modern and
legacy ADO hosts and on-premises collection paths. Preserve unrelated reporter options
and intentional custom templates. Remove the starter's example-only adjacent warning
exemption when configuring real links; do not activate placeholder URLs.

Await asynchronous public metadata APIs and pass known IDs directly. The scoped
verifier reads literal string templates with the existing tokenizer. Dynamic templates
remain valid consumer configuration, but scoped capture reports them unresolved and
uses raw IDs without changing the test verdict. Do not rewrite dynamic consumer
configuration just to satisfy static extraction; explicit reporter options take
precedence over internal environment transport.

### 2.4 Secrets

If the project has `.env.example` and no `.env`, copy it to `.env`; it holds only empty
keys. Then run:

```sh
npx --no pom-harness check --add-env-keys
```

This appends empty `NAME=` lines for missing API/database credential references in
the default environment and the Azure DevOps credential reference. Browser login
references are not included: add empty keys for the configured users' `usernameRef`
and `passwordRef` yourself, removing the `env:` prefix. Never read or print secret values.
Tell the user which keys to fill in `.env`; the file stays git-ignored.

### 2.5 Report readiness

Run `npx --no pom-harness check`. Report each feature with its status:

- **ready**;
- **unavailable**, with the reason;
- **waiting for project data**, with the missing names;
- **not configured**.

The command exits 1 only for a broken installation or invalid configuration; fix those
first. Then continue with the user's work. For example, automate a suite through the
`automate-test` skill.

Team libraries go into `resources/Queries/` and `resources/apisCollections/` as their
READMEs describe. They are derive-only.

## 3. CI pipelines

Check for `azure-pipelines.yml` and `.github/workflows/*.yml`.

An existing pipeline that runs the Playwright tests needs these steps, in order:

1. Node 24;
2. `npm ci`;
3. `npx playwright install --with-deps chromium`;
4. the test run.

`npx --no pom-harness check-conventions` is optional. Merge any missing steps; keep the
pipeline's other steps unchanged. `check` reports a pipeline that runs Playwright tests
without installing a browser.

Without a pipeline, offer a template, adapted to the default branch, runner and secrets:

- `node_modules/playwright-pom-harness/examples/azure-pipelines.yml` → `azure-pipelines.yml`;
- `node_modules/playwright-pom-harness/examples/github-actions-playwright.yml` → `.github/workflows/playwright.yml`.

Secrets become pipeline secrets mapped to the same variable names; never commit their
values. CI needs no harness browser unless the pipeline runs harness exploration.

## 4. Teammates

A teammate clones the repository and runs `npm ci`. Its postinstall step restores the
skill links from `.harness/links.json`. They then fill in their own `.env`.
`npm ci --omit=dev` skips the harness, so no links are restored, which is expected for
production installs.

## 5. Roll back

1. `npx --no pom-harness unlink`: removes only verified harness links and pointer files.
2. `git revert <the setup or update commit>`.
3. `npm ci`.

Unlink first. Git for Windows treats a junction as a folder, so restoring files at a link
path could write them into `node_modules`, or into an old package checkout.
To undo a run that is not committed, use `npx --no pom-harness setup --restore` instead.

## 6. Optional Claude hooks

Only when the user asks, merge the `hooks` entries from
`node_modules/playwright-pom-harness/scripts/hooks/claude-hooks.example.json` into
`.claude/settings.json`, preserving every existing setting. The hooks are advisory and
fail open.

## 7. Commands

| Command | Purpose |
|---|---|
| `npx --yes --package "<archive>" pom-harness setup` | Install or update from a downloaded release archive |
| `npx --no pom-harness setup [--dry-run]` | Repair links and re-merge; preview with `--dry-run` |
| `npx --no pom-harness setup --environment <name> --mode <mode>` | Add an environment profile |
| `npx --no pom-harness setup --restore` | Undo the last setup run |
| `npx --no pom-harness check [--add-env-keys] [--json]` | Per-feature readiness; add empty secret keys |
| `npx --no pom-harness unlink` | Detach the harness links before a rollback |
| `npx --no pom-harness check-conventions` | POM convention checks for the project |
| `npx --no pom-harness help` | All commands, including the workflow scripts the other skills use |

`npx --no` refuses to download a package. The harness commands also refuse to run unless
they are the project's own installation, at the version its lockfile records.

## Manual execution configuration (3.2.0)

Browser targets may declare startUrl and users handles with usernameRef/passwordRef environment references. Add empty keys to the ignored .env; never serialize values into targets.json. Optional ado.bugs defaults configure paths, assignment, tags, extra scalar fields and attachment bounds. Upgrade every teammate before committing these new keys. API/DB-only manual runs need no browser or unrelated login credentials; next enforces scoped readiness. See [manual execution](../../../../docs/manual-execution.md).
