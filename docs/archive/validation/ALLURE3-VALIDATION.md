> Historical record. Read the [current documentation](../../reporting.md) for present behavior. Statements and validation results below describe their original implementation period.

# Allure 3 reporting follow-up

Status: accepted after validation and independent re-review. This is an M14
follow-up; M15 is not started.

The report generator changes from `allure-commandline` 2.46.1 (Java) to `allure`
3.19.1 (Node). Existing Playwright, `allure-playwright` and `allure-js-commons`
versions are retained. Test bodies, page/service action and validation methods,
executors, assertions and verifier readiness rules are unchanged.

The explicit Awesome configuration retains epic/feature/story grouping and
single-file output. The example report job moves from global teardown to reporter
onExit, after results and environment metadata flush and before the local HTML
viewer can block later exit hooks. Required cleanup failures,
intentional retention, recovered outcomes and source-coverage failures remain
authoritative in the attached harness reports and verification landing page.

## Windows checks

Node 24.15.0, Allure generator 3.19.1, reporter/commons 3.13.0. All 15 commands
passed. Native HTML generation was enabled with `HARNESS_ALLURE_HTML_PROOF=1`
for the existing caught-assertion control. Focused counts are subsets of the full
suite, not additional coverage claims.

| Command | Actual outcome |
|---|---|
| `check:syntax` | PASS: 123 JavaScript files |
| `check:json` | PASS: 23 files, 22 parsed records; not schema validation |
| `check:links` | PASS: 102 Markdown files, 405 local links; anchors/remote links unperformed |
| `check:conventions` | PASS: 16 example files, 61 rule applications, zero findings |
| `check:generation-conventions` | PASS: 7 files, 40 applications, zero findings |
| `typecheck:examples` | PASS: configured example TypeScript project |
| `test:reporting` | PASS: 34 contract tests |
| `test:allure` | PASS: 8 new generator/native-example controls |
| `test:generation` | PASS: 59 tests, including actual Allure HTML with verifier FAIL preserved |
| `test` | PASS: 638 tests; zero failed, skipped or cancelled |
| `test:fetch` | PASS: 15 retained parser/renderer checks |
| `check:privacy` / `check:secrets` | PASS: 286 candidate files each |
| `check:provenance` | PASS: 370 dependency records across all three inventories |
| `check:publication` | PASS: 286 candidate / 283 packed files; offline inspection only |

The two narrowly updated skills passed `quick_validate.py` with the existing
development YAML dependency. No convention rule was weakened or baseline expanded.
Provenance additionally reviewed the new license expressions and two exact upstream
funding URLs in the lockfile. Surviving dependency versions did not change.

## Linux and rendered results

A disposable Linux container used the existing pinned Node image
`node@sha256:5711a0d445a1af54af9589066c646df387d1831a608226f4cd694fc59e745059`.
Both root and example lockfiles installed cleanly with `npm ci --ignore-scripts
--no-audit --no-fund`. After disconnecting the container's network, these passed:

- `node --test harness-tests/reporting.test.mjs harness-tests/allure-generation.test.mjs`: 42/42.
- `HARNESS_ALLURE_HTML_PROOF=1 node --test --test-name-pattern 'Allure capture preserves' harness-tests/generation-native.test.mjs`: 1/1.

The owned container was removed. This proves Linux generation and native reporter
controls, not full Linux browser/database execution or M15 host-workflow parity.

Two original M14 captures were copied to fresh protected consumer directories and
rendered with v3. Both contained ten cases; the original inventories remained intact.
These are new renderings of existing evidence, not new live tests or verification
greens. The generated single-file bytes, receipt hashes and native statuses passed
inspection. The eight new controls separately cover all five native Allure statuses,
business/technical step nesting, exact JSON/HTML attachment contents, generation
without Java on PATH, ambient-config isolation, unsupported versions, nonzero exits,
missing HTML, and actual example runs that pass, fail, or lack a generator.
Every synthetic case retained both attachments with exact embedded bytes. Example
environment metadata was present after flush and archived HTML matched the latest
file exactly. Reporting failure never changed the native outcome. The new ordering
control loads the shipped example configuration and confirms Allure already exists
when the HTML viewer's exit hook is entered, without opening a desktop viewer.

An additional controlled stalled-child proof reached the 60-second generation
deadline (60,020 ms), terminated the child and produced no success receipt.

The official pinned Playwright CLI inspected the real ten-case dashboard, expanded
business and technical steps, and rendered the attached harness HTML. The report
also opened directly from disk in a separate owned session using the CLI's documented
file-access option. The ordinary executor's policy was not changed. A 390-pixel
viewport had a 390-pixel document width. The browser recorded the template's analytics
request as blocked by CSP; no successful external request was observed. Both owned
sessions and the loopback report server were closed.

Development checks exposed the CLI's interpretation of bracketed input paths as
globs; invoking it from the capture directory with a fixed relative input fixed
that case. Initial output-path and inline-data assumptions were corrected. The
first CSP blocked embedded data scripts; the corrected policy allows embedded
assets while blocking network scripts/connections. Final checks passed after these
repairs without changing test expectations or business code.

## Review and boundaries

Base: `ae9c663eee4a079fa160574db2f709d78be00e43`, on the user's existing main branch.
The final diff and source hashes are recorded in ignored validation storage for
independent review. Historical [M14 validation](../milestones/M14-VALIDATION.md) remains a record
of the original Allure 2 baseline. ADO publishing, Allure remote services, JSONL
trend migration, macOS validation and full host parity are unperformed here.
No public package release or external test-management write is part of this change.

The independent review found one blocking lifecycle issue: a local HTML viewer
could prevent a later Allure exit hook from running. The generator now precedes
that viewer. The order regression and stronger per-case attachment checks passed
on Windows and Linux; all 15 Windows commands were repeated after the correction.
The original 637-test and 41-test receipts remain accounted for as earlier checks,
not additional final coverage. Independent re-review returned **APPROVE** with
no open findings. The reviewer reran all eight Allure controls and both nonzero
convention scopes, and proved an isolated negative control detects the original
reporter-order defect. No finding was waived.

An explicit Git inventory confirmed 35 tracked business and execution files were
unchanged, including existing tests, page/API/DB methods, technical assertion and
action utilities, the execution core, all executors, and generation verification.
