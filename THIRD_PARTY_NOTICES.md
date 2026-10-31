# Third-party notices and references

Current release archives bundle the runtime dependencies listed in
[scripts/runtime-dependency-licenses.json](scripts/runtime-dependency-licenses.json)
at their locked versions. Their upstream LICENSE, NOTICE, ThirdPartyNotices and
applicable README license texts remain with the packages. They retain their
upstream licenses and copyright ownership; harness MIT licensing does not replace
them. Example and spike dependencies, browser binaries and container images remain
separate distributions. The milestone notes below describe how dependencies were
introduced, including earlier releases that installed runtime packages separately.

The requirements-analysis workflow is project-authored and has no external analysis
integration or new npm dependency. The prerelease GapCue integration was removed
before release; no GapCue implementation is copied or bundled. AgenTeX and SHAFT
links in issue #62 are design references, not runtime dependencies or quality
comparisons; no implementation is copied from them.

The dependency security refresh uses Handlebars 4.7.10 (MIT) through the example's
Allure tools and Tedious 20.3.8 (MIT) in the runtime and example graphs. Both
distributions retain their upstream license notices. Tedious no longer depends
on `sprintf-js`; its record is removed from both inventories. No dependency
implementation is copied or relicensed by this update.

Issue #57 consumes [mysql2](https://github.com/sidorares/node-mysql2) 3.24.5 (MIT)
as a separately installed runtime dependency. Its eight added packages are mysql2,
aws-ssl-profiles, generate-function, is-property, long, lru.min, named-placeholders
and sql-escaper. `long` 5.3.2 declares Apache-2.0; the other seven declare MIT.
All eight installed distributions include full license files, which must remain
with redistributed dependencies. Exact versions and integrity values are recorded
in [the runtime inventory](scripts/runtime-dependency-licenses.json), then 98 records.
No upstream implementation is copied or relicensed. The pinned official MySQL 8.4
container used by the development probe is distributed separately under its own
upstream terms and is not bundled or cleared for redistribution by this source audit.

Release 3.6.0 updates `@azure/identity` to 4.14.0, `open` to 11.0.4 and
`wsl-utils` to 1.0.1, and adds `is-in-ssh` 1.0.0 and `powershell-utils` 0.2.1.
These distributions declare MIT and include full license files. Preserve those
files with redistributed dependencies. The runtime inventory now has 100 records;
that release installed their implementations separately and retained their notices.

M17 preserves the root dependency graph in the publishable `npm-shrinkwrap.json`.
M18 adds the three native CLI packages described below, for 90 package identities;
the existing identities and notices are unchanged. npm may duplicate or
relocate dependency nodes during installation; the installed validation checks
their exact identities, registry origins, integrity and on-disk package metadata.

CI references the official `actions/checkout`, `actions/setup-node`,
`actions/upload-artifact` and `actions/download-artifact` repositories at immutable commits. Their implementations
are downloaded by GitHub Actions, not copied or relicensed here. The local Linux
acceptance client separately installs Claude Code 2.1.285 and Codex CLI 0.159.2.
They are external host tools, not dependencies included in the harness archive;
their respective upstream terms still apply. The local client also uses the
official Docker CLI image. Neither the client image, its installed software nor
authenticated runtime material is published by this source distribution.

M1 does not vendor AgenTeX or Playwright source. It retains links to the inspected
projects in the provenance inventory. If source is copied later, preserve its required
license/copyright notice and record the source revision and modifications.

The example framework depends on separately licensed npm packages. They are installed
separately and are not bundled or relicensed by the harness. The complete resolved
inventory is [scripts/dependency-licenses.json](scripts/dependency-licenses.json),
checked against the example lockfile by `npm run check:provenance`.

The resolved license declarations are MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause,
ISC, BlueOak-1.0.0, 0BSD, Python-2.0 and `(MPL-2.0 OR Apache-2.0)`.
This source distribution does not copy their implementations
or replace their copyright notices. In the original M1 audit of 122 installed Windows packages, three did not
include a top-level license/notice file (`@napi-rs/canvas-win32-x64-msvc`,
`allure-js-commons`, `allure-playwright`). Before redistributing those packages, obtain
the applicable notices from their upstream distributions; the source-only package
does not bundle them. The 28 optional packages for other platforms were not installed.

Principal dependencies include Playwright, TypeScript, Allure and pdf-parse
(Apache-2.0), node-mssql and the CTRF reporter (MIT), and dotenv (BSD-2-Clause).
Consult the resolved versions' own license/notice files before redistributing them.

The Allure 3 follow-up replaces `allure-commandline` 2.46.1 with `allure` 3.19.1
(Apache-2.0), adding 131 resolved packages and removing one. All pre-existing
surviving dependency versions remain unchanged; the example inventory now contains
280 records. New dependency licenses were inspected from installed manifests and
license/notice files. `argparse` 2.0.1 carries the Python-2.0 license and historical
PSF/CNRI/CWI notices in its LICENSE. `dompurify` 3.4.16 offers MPL-2.0 or Apache-2.0;
the Apache-2.0 alternative is used, with its LICENSE retained by installation.
The complete MIT texts for `clipanion`, `typanion`, and Axios's nested `agent-base`
and `https-proxy-agent` are in their README files rather than top-level LICENSE files.

The 29 new Allure-family packages and `@nodable/entities` declare Apache-2.0 and
MIT respectively but omit full top-level license files. They remain separately
installed dependencies, not vendored source. Before redistributing installed
packages or generated report bundles, preserve their upstream notices and the
embedded asset notices; this source-only audit does not authorize such distribution.
No dependency source or copyright is relicensed as harness MIT material.

M4 installed `@playwright/cli` 0.1.22 and its exact Playwright/Playwright Core
1.64.0-alpha-1790635538000 dependencies for a development spike. M18 makes the same
three Apache-2.0 packages exact runtime dependencies of the harness. Current archives
bundle them with their upstream notices. Their registry
integrity values are recorded in [the runtime inventory](scripts/runtime-dependency-licenses.json);
the spike keeps [its own CLI dependency inventory](scripts/cli-dependency-licenses.json).
Both are checked by `check:provenance`. Each installed package includes LICENSE; both Playwright
packages also include NOTICE and ThirdPartyNotices.txt. Keep those files when
redistributing the dependencies. The official CLI skill is read from the installed
package, not copied or relicensed as a canonical harness skill.

The Linux spike builds on the pinned official Node Debian container and downloads
the pinned Chromium/browser components using Playwright's installer. Container OS
packages and browser binaries are separate upstream distributions, not bundled in
this source package. This audit does not clear redistribution of the image or
browser binaries; preserve their upstream notices and audit that distribution before
sharing it. No container image has been published.

M8 consumes [node-mssql](https://github.com/tediousjs/node-mssql) 12.7.2 under MIT
as a separately installed runtime dependency. Its 73 resolved dependency packages
are recorded in [the runtime inventory](scripts/runtime-dependency-licenses.json)
and checked against the root lockfile. Their declarations are MIT, Apache-2.0,
BSD-3-Clause, ISC and 0BSD. Every installed package includes a top-level license or
notice file; preserve those files when redistributing installed dependencies. No
upstream implementation is relicensed as harness code.

The real database probe uses Microsoft's SQL Server 2022 Developer container for
development/testing under Microsoft's terms, with explicit EULA acceptance. It is
not MIT software and is not bundled, published or cleared for redistribution here.
The pinned Node Linux client image is also an independent upstream distribution.
See [Microsoft's container guide](https://learn.microsoft.com/en-us/sql/linux/install-upgrade/quickstart-install-docker?view=sql-server-ver17)
and [the archived SQL Server guide](docs/archive/milestones/M8-SQLSERVER.md) for the intended local validation use.

M10 consumes [node-postgres](https://node-postgres.com/) (`pg` 8.23.1, MIT) as a
separately installed runtime dependency. It adds 14 packages: `pg`, `pg-cloudflare`,
`pg-connection-string`, `pg-int8`, `pg-pool`, `pg-protocol`, `pg-types`, `pgpass`,
`postgres-array`, `postgres-bytea`, `postgres-date`, `postgres-interval`, `split2`
and `xtend`. Their exact versions, MIT/ISC declarations and registry integrity
values are recorded in the runtime inventory, then 87 records (90 since M18). All 14 installed
packages were inspected for complete notices. Twelve include license files;
`pg-types` includes its MIT notice in README.md (Brian M. Carlson, 2014), and
`pgpass` includes its MIT notice in README.md (Hannes Hoerl, 2013-2016). Preserve
those README license sections when redistributing installed dependencies. This
distribution preserves those notices and does not transfer license ownership.

The local M10 proof uses a pinned official PostgreSQL 16 container. PostgreSQL uses
[the PostgreSQL License](https://www.postgresql.org/about/licence/); its container
OS and supporting software have their own terms. The image is not bundled,
published or cleared for redistribution by this source-only audit. Consult the
[archived PostgreSQL guide](docs/archive/milestones/M10-POSTGRESQL.md) for the validation scope.
