# Reports, Allure and progress tracking

Execution reports explain validated runtime outcomes; manual dashboards aggregate
cases/attempts; generation records readiness after independent review and scoped
verification. Ordinary Playwright/Allure reports show native detail, while tracker/
metrics summarize consumer progress. Report delivery is separate from test success.

## Locations and authority

| Report | Default consumer location | Authority |
|---|---|---|
| Shared execution | `reports/harness/<run-id>-<unique-id>/` | Reassessed observations/evidence |
| Manual dashboard | `reports/harness/execute-<execution-uuid>-<report-uuid>/` | Assessed cases, attempts and defects |
| Generated verification/Allure | `reports/generation/<verification-id>/` | Verifier outcome with separate native detail |
| Standalone scoped Allure | `reports/allure/<unique-id>/` | Native results |
| Starter Playwright HTML | `reports/playwright-report/` | Native results |
| Starter JSON | `reports/json-report/test-results.json` | Native results |
| Starter CTRF | `ctrf/ctrf-report.json` | Native summary |
| Starter Allure | `allure-results/`, `allure-report/` | Native capture/generated detail |
| Plan tracker | `reports/tracker/plan-<planId>-tracker.html` | Registry plus dated history |

Artifacts stay ignored. Existing consumers can retain custom paths. Update reporter
configuration, lifecycle scripts, consumer README and CI uploads together.

## Validated execution reports

Import `writeReports` from `playwright-pom-harness/scripts/lib/reporting/index.mjs`
and supply an in-process assessRun/runtime finish result:

```js
const delivery = writeReports(roots, result);
// Inspect delivery.status separately from result.status.
```

Results carry a process-local validation mark; fabricated/deserialized verdicts fail.
This guards API misuse, not trusted-code isolation. Saved runs instead reconstruct
frozen inputs and reassess original evidence:

```sh
npx --no pom-harness render-results --snapshot .harness/runs/<run-id>/inputs.json --run-root .harness/runs/<run-id> --output reports/harness/<new-name>
```

Default output is fresh; explicit output is a new consumer-relative directory under
reports. Existing outputs/source paths/escaping links fail. Nothing is overwritten.
`manifest.json` is written last with relative lengths/hashes; missing manifest means incomplete.

| File | Contents |
|---|---|
| result.json | Sanitized status, stability, counts and report fingerprint |
| report.md | Escaped phases, attempts, effects, assertions, resources and outputs |
| index.html | Self-contained responsive view without script/network dependency |
| manifest.json | Report delivery/integrity receipt |

Reports inventory original evidence, not raw bodies; retain the run for inspection.
Source/version/fingerprint and evidence associations remain visible. Public outputs
are JSON-encoded/clipped above 4,096 characters. Sensitive values are redacted;
protected refs, inputs and definitions omitted. Correct classification remains the
producer's responsibility. HTML/Markdown escape text and HTML uses CSP.

Delivery is WRITTEN/FAILED separately from verdict. render-results exits 0 for a
written FAIL report, 2 for invalid input, 1 for write failure. Gate tests on assessed
outcomes, not render success. Cleanup problems, reliable failures, intentional retention
and recovered stability/history stay visible.

Manual `execute report <exec>` reassesses every snapshot/evidence file and writes
dashboard, Summary, grouped Defects, per-run reports and final manifest. Counts use
case summaries; history/attempts remain separate. Rollups count source expectations
in the selected assessed run. Defects span attempts independently of case counts.
CSP permits the generated hashed script for filters/search/sorting/previews, while
disclosures work without JavaScript. Verified PNG/JPEG previews cap at 2 MiB each/
20 MiB total and deduplicate identical bytes; companion links stay relative.
See [manual execution](manual-execution.md) for selection/staleness/delivery.

## Allure capture and generation

```sh
npx --no pom-harness generate verify --id <source-id> --allure
npx --no pom-harness generate-allure --input reports/generation/<verification-id>
```

Generate only after verification returns and reporters flush. A second green needs
a second process for the same approved candidate. Allure failure neither grants nor
revokes a green. Case-level assertion receipts establish the mechanical verification
gate; independent review assesses full scenario semantics. See [automation](PIPELINE.md).

The validated consumer adapter uses allure-playwright/allure-js-commons 3.13.0 and
Node-based allure 3.19.1; Java is unnecessary. Accurate consumer declarations/locks
are required; other versions remain unavailable until validated. Options use
resultsDir/detail/suiteTitle, not unsupported outputFolder.

| Scoped artifact | Purpose |
|---|---|
| allure-results/ | One invocation's native results/attachments |
| capture.json | Post-flush counts/status/hashes |
| verification.json | Recorded generation reference |
| index.html | Verifier outcome above native-detail link |
| allure-report/index.html | Official single-file generated report |
| generation.json | Separate report-job receipt/hashes |

Generation rejects empty/changed/incomplete captures and rechecks hash-linked history
and review artifacts. Missing verification references fail. Native success may coexist
with verifier FAIL when a helper catches a failed assertion; the landing page preserves
verifier FAIL. Reports never upgrade readiness or replace core verdicts.

The separate bounded generator uses argument arrays without a shell, fresh output
and no browser opening. Failures retain test history, withhold raw diagnostics and
write no success receipt. Receipts record version/config hash and completeness, not
tamper-proof attestation against the owner. Explicit package allurerc.json uses
Awesome UI/single-file assets and epic/feature/story grouping. Ambient consumer config,
remote publishing, status reclassification, gates, reruns and history aggregation are
not enabled. Timestamped HTML archives are not Allure JSONL history. CSP blocks outbound
analytics/scripts/connections while retaining embedded assets before hashing.

## Normal consumer reports and upgrades

The starter's `src/utils/AllureReport.ts` extends the official reporter, preserving
options and appending public TestStep.params.locator to native titles. Its onExit
generates after all reporter onEnd calls. Register it before the HTML viewer, which
can block later exit hooks; do not generate from globalTeardown.

Existing projects merge the updated utility while preserving customizations and use
`['./src/utils/AllureReport.ts', existingAllureOptions]` before HTML in place of separate
capture/generator entries. Merge Expects.ts count-comparison messaging for actual/
reference locators. Setup does not overwrite existing code; business methods/test
bodies/Allure steps/attachments need no migration. Scoped capture uses maintained
capture only without its onExit, or official capture when the utility is absent.

Native non-generation tests may resolve `scripts/lib/reporting/allure-reporter.mjs`
from the installed package. Optional directory must be fresh under reports; otherwise
`reports/allure/<unique-id>` is used. It does not forward test-plan filtering/status overrides.
Ordinary native scope stays with Playwright; generation adds mandatory verification.

Run the consumer's own script or `npx playwright test`, optionally with a quoted spec
and existing browser project. Starter flags AUTO_ALLURE_OPEN, API_CONSOLE_LOGS and
DB_CONSOLE_LOGS are technical controls, not scenario data or capabilities.
CI sets AUTO_ALLURE_OPEN=false.

## Attachments, links and protection

`await attachResult(test, result)` inside the owning technical test.step uses stable
JSON/HTML names `Harness execution result` and `Harness execution report`.
ATTACHED/NOT_IN_TEST/FAILED are presentation outcomes, never verdict changes. Preserve
step nesting, titles and attachment names when refactoring.

Await public Allure metadata APIs and use literal real case/bug identities. Local
cases retain testCaseId; external cases retain tms. Configure links.tms/links.issue
from real coordinates and preserve unrelated options. Link formatting needs no PAT.
Encoded project names, separate destinations, modern/legacy ADO and on-prem collections
are supported; the starter has no active placeholder destinations.

Scoped capture extracts literal candidate templates; explicit options take precedence.
Receipts distinguish configured/absent/placeholder/unresolved. Dynamic templates work
in normal Allure but cannot be statically extracted; capture keeps raw IDs, reports
the limitation and does not rewrite config or verdicts.

Utilities redact selected headers/structured keys only. Arbitrary URLs/strings/errors,
native actions, screenshots, traces, video and Allure artifacts are not comprehensively
sanitized. Value-free titles protect titles only. Restrict access/retention, avoid
unnecessary sensitive attachments and review before sharing. Reports are not automatically published.

## Tracker and metrics

The [plan-tracker skill](../.agents/skills/plan-tracker/SKILL.md) renders consumer truth:
`.harness/state/tracker/plan-<planId>.json` holds branches/suites/cases, consolidation
k/d/f/t verdicts/notes, manual rulings, bugs and owners; history.jsonl is append-only
dated progress. Later events win. Correct errors through newer events, not deletion.

```sh
npx --no pom-harness tracker --plan <planId>
npx --no pom-harness tracker --sync --dry-run
npx --no pom-harness tracker --sync
npx --no pom-harness tracker --archive
npx --no pom-harness tracker --json
npx --no pom-harness metrics --json
```

Run from the consumer or pass project-root. Inspect sync dry-run first. Suite/story
legacy verification maps passed→done, fixme/blocked→blocked, failed at repair cap→blocked
(otherwise doing), pending-confirmation→doing. Conflicts/manual rulings/newer history
are skipped with warnings. Sync appends events and renders; archive adds a dated copy.

Events use ISO at, source, explanatory note and set entries for todo/doing/done/blocked,
optionally assign registered owners. Done requires two scoped greens. Filed bugs are
registry data, not status; non-automatable rulings belong in the manual map. Unknown
cases warn; malformed lines/statuses fail. Regenerate and inspect the summary.

Browser clicks are local triage reset by regeneration; assignees persist unless history
overrides them. To persist exported browser changes, translate them into a dated
history event with evidence. Never treat generated HTML as project truth.

Metrics reads verification/drift/review histories, showing coverage (passed+fixme),
rounds/greens, classifications, NEEDS-HUMAN and drift flags at three entries/element.
Malformed files warn/skip, absent state gives empty sections, exit is 0; metrics is
triage, not success gating. Manual execution creates no tracker events.

Run test:reporting/test:allure/generation tests in the harness checkout. probe:reporting
needs actual independent review, not unattended CI. Archived
[reporting validation](archive/milestones/M14-VALIDATION.md) and
[Allure validation](archive/validation/ALLURE3-VALIDATION.md) retain exact platforms
and the historical Allure 2 baseline. See [contributing](contributing.md).
