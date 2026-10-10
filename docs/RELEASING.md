# Releasing

Ordinary `Harness validation` runs check temporary packages and retain sanitized
summaries. They do not upload harness archives, bump versions, tag commits or create
releases. Merge changes as they become ready; collect pending changelog entries under
`## Unreleased` until a release is needed.

Manually dispatched `Harness release` builds one npm 11 archive on `main`, validates
those exact bytes on Windows and Linux, and creates a **draft** GitHub release with
`playwright-pom-harness-<version>.tgz` and its `.tgz.sha256` file. Users and AIs continue
downloading both files from one published tag ([Get started](../README.md#get-started)).
The npm package stays private and is never published to the registry.

Dispatching `Harness release` authorizes creating the version tag and draft. It does
not publish the draft. Publication requires the owner's explicit authorization;
green validation alone is not publication authorization ([contributing](contributing.md)).

## 1. Prepare a release PR on the ongoing feature branch

- Set the new version in `VERSION`, `package.json`, `.claude-plugin/plugin.json`, and
  the root `version` fields of `npm-shrinkwrap.json`.
- Move pending changes into `## <version> — <title>` in `CHANGELOG.md`, with an
  `### Upgrade actions` list (at least one item, even when no action is needed).
  Setup shows that list to everyone who updates from an earlier version.
- If the managed instruction block changed, add its digest to `scripts/managed-digests.json`,
  so later versions can replace it.
- `npm run check:contracts` enforces the version, the upgrade actions and the block digest.
- Regular development PRs do not need a version bump.
- Pack with npm 11, the npm bundled with Node 24. npm 12 leaves `npm-shrinkwrap.json` out of
  the archive, and the release needs it. CI packs the release archive with npm 11.

## 2. Validate and merge

```sh
npm run check:ci
```

Installed validation and consumer flows are optional locally. The release pull request's `Harness validation`
run executes all of them on Windows and Linux with npm 11 and npm 12; when it passes, a
local run only repeats them. Run them locally when CI is unavailable, or to check a
change to setup, adoption or packaging before pushing:

```sh
npm run test:installed -- <new external folder>
node scripts/ci/consumer-flow.mjs <new external folder>
```

The consumer flows install the packed archive into fresh projects: an empty folder, a
project without Playwright and an existing framework. They then rerun setup, clone with
CRLF, update to the next version, run two versions side by side, roll back across the
old layout, stop on a preflight conflict, recover from a failure after install, check a
CI pipeline, and adopt a folder under a parent `package.json`. They need registry access
and about 2 GB of free disk space, and skip browser downloads.

Merge the reviewed release PR and wait for every `Harness validation` job on `main`
to pass: Windows/Linux installed-package and native checks, and npm 11/npm 12 consumer
flows. Missing or unexpectedly skipped checks are incomplete.

## 3. Run the release build

In **Actions → Harness release → Run workflow**, select `main` and enter the merged
version as `X.Y.Z`, without `v`. The dispatch commit stays fixed even if `main` moves.
Ordinary code changes can continue while validation runs. If `.github/workflows/`
differs from the current default branch, the workflow stops before creating a tag
and tells you to start a fresh release run on `main` after reconciling those changes.
GitHub requires workflow modification permission for that release target, which
the built-in `GITHUB_TOKEN` cannot receive. The workflow checks this before packing
and again before creating a draft or tag; it never substitutes an unvalidated commit.
CLI equivalent:

```sh
gh workflow run release.yml --ref main -f version=<version>
```

The workflow rejects other branches, inconsistent versions, missing upgrade actions,
and existing version tags/releases before packing. It verifies npm major 11; npm 12
is used for consumer compatibility checks, not release packing. Every release check
uses the same candidate archive.

The `release-candidate` artifact and sanitized summaries are retained for seven days.
A candidate from a failed run is not a validated release. The draft job requires all
four matrix jobs plus complete, matching evidence before it creates a tag or draft.
It creates the draft before the tag, so a rejected draft request leaves no new tag.
Raw logs, credentials, native transcripts and traces are not uploaded.

## 4. Review the draft and publish

Open the draft URL in the workflow summary. Confirm the version, source commit,
workflow link, changelog notes and two assets. Download both files and verify:

```sh
sha256sum -c playwright-pom-harness-<version>.tgz.sha256
```

From [provenance](PROVENANCE.md):

- Recheck any new third-party source.
- Retain the required notices.
- Inspect the archive: `npm pack --dry-run`.
- Resolve outstanding security remediation.
- Obtain the owner's explicit publication authorization.

With the owner's publication authorization, publish the existing draft in GitHub
after the release workflow finishes successfully, and mark the stable release as
latest. Never rebuild or replace its validated archive.

If draft creation or an upload fails, rerun the **failed jobs** in the same workflow
run while its artifacts are available. Missing uploads can finish when the run,
commit and existing asset bytes match; conflicting files are never overwritten and
published releases are never modified. A full new run stops if the version tag/draft
already exists. Resolve conflicting or expired partial drafts explicitly; the
workflow does not delete tags or releases automatically.
If workflow files change during the draft request, an owned draft can exist without
a tag. Review and remove that partial draft explicitly before starting a fresh run;
retrying the pinned candidate cannot add the permission GitHub requires. Existing
matching drafts with their tags can still finish missing uploads after `main` moves.

## 5. Verify the published release

- From an empty folder, follow "Without AI" in the README with the published assets.
- Manual check for each release: in that project, Claude Code and Codex each discover
  and use a skill in a running session, including reading its references. Claude needs
  `/reload-skills` when its skills folder is new.

Optional, owner only: register the `pom-harness` and `playwright-pom-harness` names on
npm as protection. Adoption does not depend on it. The archive is a local path,
`npx --no` refuses to download packages, and the CLI runs only as the project's own
verified installation.
