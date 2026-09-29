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
