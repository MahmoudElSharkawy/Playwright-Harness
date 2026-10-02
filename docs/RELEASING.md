# Releasing

A release publishes one file pair on GitHub: `playwright-pom-harness-<version>.tgz` and
`playwright-pom-harness-<version>.tgz.sha256`. They are exactly the archive and checksum
that the `Harness validation` workflow validated on `main`. Users and AIs resolve the
latest release tag and download both files from that tag ([Get started](../README.md#get-started)).
The npm package stays private and is never published to the registry.

Tagging, pushing the tag and creating the release require the owner's explicit
authorization. A green workflow is not that authorization ([M17](M17-CI.md#acceptance-and-release-boundary)).

## 1. Prepare the version on a feature branch

- Set the new version in `VERSION`, `package.json`, `.claude-plugin/plugin.json`, and
  the root `version` fields of `npm-shrinkwrap.json`.
- Add `## <version> — <title>` to `CHANGELOG.md`, with an `### Upgrade actions` list.
  Setup shows that list to everyone who updates from an earlier version.
- If the managed instruction block changed, add its digest to `scripts/managed-digests.json`,
  so later versions can replace it.
- `npm run check:contracts` enforces the version, the upgrade actions and the block digest.

## 2. Validate locally

```sh
npm run check:ci
npm run test:installed -- <new external folder>
node scripts/ci/consumer-flow.mjs <new external folder>
```

The consumer flows install the packed archive into fresh projects: an empty folder, a
project without Playwright and an existing framework. They then rerun setup, clone with
CRLF, update to the next version, run two versions side by side, roll back across the
old layout, stop on a preflight conflict, recover from a failure after install, check a
CI pipeline, and adopt a folder under a parent `package.json`. They need registry access
and skip browser downloads.

## 3. Pre-publication checklist

From [provenance](PROVENANCE.md):

- Recheck any new third-party source.
- Retain the required notices.
- Inspect the archive: `npm pack --dry-run`.
- Resolve outstanding security remediation.
- Obtain the owner's explicit publication authorization.

## 4. Merge and wait for `main`

Merge the pull request. On `main`, `Harness validation` must pass every job: installed
package and consumer flows on Windows and Linux, and the npm 12 consumer flows. Treat
unavailable or skipped checks as failures.

## 5. Publish the validated files

Download the `release-archive` artifact from that `main` run, verify the checksum, then,
with the owner's go-ahead, tag the validated commit and attach exactly those files:

```sh
sha256sum -c playwright-pom-harness-<version>.tgz.sha256
git tag v<version> <validated commit> && git push origin v<version>
gh release create v<version> --verify-tag --latest --title "<version>" --notes-file <release notes> \
  playwright-pom-harness-<version>.tgz playwright-pom-harness-<version>.tgz.sha256
```

Use the CHANGELOG section as the release notes. Never rebuild the archive for the release.

## 6. Verify the published release

- From an empty folder, follow "Without AI" in the README with the published assets.
- Manual check for each release: in that project, Claude Code and Codex each discover
  and use a skill in a running session, including reading its references. Claude needs
  `/reload-skills` when its skills folder is new.

Optional, owner only: register the `pom-harness` and `playwright-pom-harness` names on
npm as protection. Adoption does not depend on it. The archive is a local path,
`npx --no` refuses to download packages, and the CLI runs only as the project's own
verified installation.
