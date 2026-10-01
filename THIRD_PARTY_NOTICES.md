# Third-party notices and references

M1 does not vendor AgenTeX or Playwright source. It retains links to the inspected
projects in the provenance inventory. If source is copied later, preserve its required
license/copyright notice and record the source revision and modifications.

The example framework depends on separately licensed npm packages. They are installed
separately and are not bundled or relicensed by the harness. The complete resolved
inventory is [scripts/dependency-licenses.json](scripts/dependency-licenses.json),
checked against the example lockfile by `npm run check:provenance`.

The resolved license declarations are MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause,
ISC, BlueOak-1.0.0 and 0BSD. This source distribution does not copy their implementations
or replace their copyright notices. Of 122 installed Windows packages, three did not
include a top-level license/notice file (`@napi-rs/canvas-win32-x64-msvc`,
`allure-js-commons`, `allure-playwright`). Before redistributing those packages, obtain
the applicable notices from their upstream distributions; the source-only package
does not bundle them. The 28 optional packages for other platforms were not installed.

Principal dependencies include Playwright, TypeScript, Allure and pdf-parse
(Apache-2.0), node-mssql and the CTRF reporter (MIT), and dotenv (BSD-2-Clause).
Consult the resolved versions' own license/notice files before redistributing them.

M4 installs `@playwright/cli` 0.1.22 and its exact Playwright/Playwright Core
1.64.0-alpha-1790635538000 dependencies for development only. These three Apache-2.0
packages and their registry integrity values are recorded in
[the CLI dependency inventory](scripts/cli-dependency-licenses.json), also checked
by `check:provenance`. Each installed package includes LICENSE; both Playwright
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
upstream implementation is copied into the harness or relicensed.

The real database probe uses Microsoft's SQL Server 2022 Developer container for
development/testing under Microsoft's terms, with explicit EULA acceptance. It is
not MIT software and is not bundled, published or cleared for redistribution here.
The pinned Node Linux client image is also an independent upstream distribution.
See [Microsoft's container guide](https://learn.microsoft.com/en-us/sql/linux/install-upgrade/quickstart-install-docker?view=sql-server-ver17)
and [the M8 guide](docs/M8-SQLSERVER.md) for the intended local validation use.
