<!-- Runbook skeleton — copy to README.md at the repo root and fill the placeholders (ships with the harness package). -->

# <your-repo>

Playwright/TypeScript POM test automation for **<your application>**
(https://your-app.example.com). This README is the runbook: setup, how to run,
the env flags the framework consumes, and where every report lands.

## Setup

```bash
git clone <your-repo-url>
cd <your-repo>
npm ci                                # always via the lockfile — never per-package installs
npx playwright install --with-deps    # browsers (first time / CI)
```

Use Node 24. Destinations — application URLs, database servers — live in
`.harness/targets.json` (read by `src/config/targets.ts`). Copy `.env.example` to `.env`
(gitignored) and fill in the secrets — externally provisioned credentials and DB
passwords come from environment variables, loaded by dotenv in `playwright.config.ts`.
Fixed synthetic signup passwords belong in the paired test-data JSON; the shipped
values are placeholders.

Adapt the example endpoints to the application before running them. In particular,
`ApisUserManagement.cleanupUserIfOwned` reports a missing ownership/absence contract
until the application's observed checks are implemented. Its existing `deleteUser(email)`
needs no new password parameter. See the lifecycle rules in design-conventions §4a.

## Running tests

```bash
npx playwright test                                          # full run
npx playwright test tests/LoginTests.spec.ts                 # single spec
npx playwright test "tests/User Management/DbUserManagementTests.spec.ts" # spec in a nested suite folder (quote paths with spaces)
npx playwright test -g "Test Case 12345:"                     # filter by test title
npx playwright test --headed                                 # watch the browser
npx playwright test --project=chromium                       # one browser project
```

Tag filters: `npx playwright test -g "@smoke"` / `-g "@regression"`.

## Environment flags

Consumed by the `utils/` facades and the root lifecycle scripts
(`global-setup.ts` / `src/utils/AllureReport.ts`):

| Flag | Consumed by | Default | Effect |
|---|---|---|---|
| `AUTO_ALLURE_OPEN` | `src/utils/AllureReport.ts` | on (opt-out) | Set to `false` to skip auto-opening the generated Allure report after the run. |
| `HARNESS_ALLURE_HISTORY` | Ordinary and scoped Allure reporters | `reports/allure-history` | Older HTML archive root under `reports/`; separate from current report and raw staging. |
| `ALLURE_ATTACH_VIDEO` | Ordinary and scoped Allure reporters | off | Set to `true` to include video attachments in Allure; Playwright recording remains independent. |
| `API_CONSOLE_LOGS` | `utils/ApiActions.ts` | off (opt-in) | Set to `true` to mirror every API request/response to the console (report attachments are always written). |
| `DB_CONSOLE_LOGS` | `utils/DBActions.ts` | off (opt-in) | Set to `true` to mirror every SQL query/result to the console (report attachments are always written). |

PowerShell sets these as `$env:AUTO_ALLURE_OPEN='false'`; bash inline as
`AUTO_ALLURE_OPEN=false npx playwright test`.

**CI runs** must stay headless and non-interactive: set `CI=true`
(disables desktop behavior and enables retries/`forbidOnly` in the config),
`AUTO_ALLURE_OPEN=false`, and `PW_TEST_HTML_REPORT_OPEN=never` (suppresses the
HTML reporter's `open: 'always'` server) — exactly as the shipped
`azure-pipelines.yml` / `github-actions-playwright.yml` do:

```bash
CI=true AUTO_ALLURE_OPEN=false PW_TEST_HTML_REPORT_OPEN=never npx playwright test --project=chromium
```

## Report locations

One run produces (mirrors the `reporter` array in `playwright.config.ts`):

| Report | Location | Produced by |
|---|---|---|
| Console list | terminal output | `list` reporter |
| Playwright HTML report | `reports/playwright-report/` | `html` reporter (`open: 'always'` locally) |
| Allure raw results | `reports/allure-results/` (explicit `resultsDir`; `outputFolder` is unsupported) | `src/utils/AllureReport.ts`, extending `allure-playwright` |
| Current Allure single-file HTML | `reports/allure-report/index.html` | Published after all reporters flush and report generation succeeds |
| Older Allure HTML | `reports/allure-history/YYYY-MM-DD_HH-mm-ssZ[-NNN].html` | Previous current report archived when its replacement completes |
| JSON results | `reports/json-report/test-results.json` | `json` reporter |
| JUnit XML (CI Tests tab) | `reports/junit/results.xml` | `junit` reporter |
| CTRF JSON | `ctrf/ctrf-report.json` | `playwright-ctrf-json-reporter` |

Allure archive names use UTC seconds with `Z`, without milliseconds. Collisions
add a numeric suffix without overwriting older files. Raw staging is copied after
reporter flush to immutable capture evidence under `.harness/runs/allure/`, then
the next setup can clear staging safely. Failed tests still produce reports;
failed generation preserves the previous current HTML. Consumer CI uploads only
`reports/allure-report/index.html` and `reports/playwright-report/`, including
Playwright supporting assets. History and raw results remain local.

Allure video attachments default off. Enable with `ALLURE_ATTACH_VIDEO=true` or
reporter option `attachVideo: true`; an explicit option takes precedence. This
leaves Playwright's recording policy and its HTML attachments unchanged. Disable
Playwright recording separately with `video: 'off'` when desired. Screenshots and
other Allure attachments remain available.

The optional harness workflows use the same current/archive publication for
standalone and generation verification captures. Pass the returned recording directory to
`npx --no pom-harness generate-allure --input <recording-directory>` after the run.
Two independent verification runs retain two native reports. Harness QA reports
remain separate under `reports/harness/automation-<timestamp>[-NNN]/` and
`reports/harness/execution-<timestamp>[-NNN]/`; they include blocked and ungenerated
cases that never appear in native results. See the [complete harness report
inventory](https://github.com/MahmoudElSharkawy/Playwright-Harness/blob/main/docs/reporting.md#locations-and-authority)
for tracker, metrics, evidence and legacy locations.

> **Keep this table honest:** any reporter or path change in
> `playwright.config.ts` lands in lockstep — same MR — across the config,
> `global-setup.ts`/`src/utils/AllureReport.ts`, this table, and the CI artifact steps
> (design-conventions, *Report output contract*).

The report generator is pinned to `allure` 3.19.1 and configured in `allurerc.json`.
The `AllureReport.ts` reporter retains the official reporter's options and appends
public locator metadata to native action/assertion titles. Locator assertions read
`Expect … → locator('…')`; count comparisons include the reference locator too.
To adopt this in an existing project, merge the updated utility. Its locator handling
is contained in the class. Replace the separate `allure-playwright` and generator
entries with one `./src/utils/AllureReport.ts` entry before the HTML reporter,
preserving the official reporter's options. Apply the count-comparison message update
in `Expects.ts`; setup does not overwrite consumer customizations.
Merge `historyDir`, `resultsDir` and `attachVideo` from `src/config/reporting.ts`
and remove old `reportDir`,
`keepHistory` and `ALLURE_HISTORY` settings. `ALLURE_HISTORY=false` no longer skips
the canonical report. To disable optional Allure output, remove its ordinary
reporter or omit `--allure` for verification. Old `allure-report/` and scoped
report directories remain untouched; new CI uploads contain only current reports.
It runs on Node, without Java. Tests and action methods retain their existing
`allure-js-commons` calls. The report keeps epic/feature/story grouping, embedded
attachments and native outcomes. Generation occurs in the reporter's
`onExit`, not `globalTeardown`, so environment details and results have finished
writing. Keep this reporter before the HTML viewer, which can hold its exit hook
open in a local terminal. It cannot override native test outcomes. The generated HTML blocks
outbound requests, including the upstream template's analytics script.
