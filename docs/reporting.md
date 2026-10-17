# Reports, Allure and progress tracking

Case reports share one layout for execution and automation. Execution aggregates
cases/attempts; generation records readiness after independent review and scoped
verification. Ordinary Playwright/Allure reports show native detail, while tracker/
metrics summarize consumer progress. Report delivery is separate from test success.

## Locations and authority

| Report | Default consumer location | Purpose and authority |
|---|---|---|
| Validated runtime case report | `reports/harness/<run-id>-<unique-id>/` | Reassessed observations/evidence |
| Execution QA case report | `reports/harness/execution-<timestamp>[-NNN]/index.html` | Assessed cases, attempts and defects |
| Automation QA case report | `reports/harness/automation-<timestamp>[-NNN]/index.html` | Generation history, source-bound blockers and hash-bound native receipts |
| Current Allure report | `reports/allure-report/index.html` | Latest completed native invocation; standalone single-file HTML |
| Older Allure reports | `reports/allure-history/<timestamp>[-NNN].html` | Previously published HTML only; no latest link or raw evidence |
| Starter Playwright HTML | `reports/playwright-report/` | Native results |
| Starter JSON | `reports/json-report/test-results.json` | Native results |
| Starter JUnit XML | `reports/junit/results.xml` | Native outcomes for CI test-result ingestion |
| Starter CTRF | `ctrf/ctrf-report.json` | Native summary |
| Plan tracker | `reports/tracker/plan-<planId>-tracker.html` | Registry plus dated history |
| Archived plan tracker | `reports/tracker/archive/plan-<planId>-tracker-<YYYYMMDD-HHmmss>.html` | Snapshot requested with `tracker --archive`; existing local-time naming |
| Harness metrics | Terminal output; `metrics --json` emits JSON | Coverage, verification rounds, review queue and drift |
| Console test list | Terminal output | Live native progress and outcomes |

All paths are relative to the consuming project. `<timestamp>` is
`YYYY-MM-DD_HH-mm-ssZ`, for example `2026-10-17_14-05-09Z`: UTC, seconds, no
milliseconds, and characters safe on Windows, Linux and macOS. New automation and
execution QA folders use this format; `execution-` replaces `execute-`. Exclusive
directory creation adds `-001`, `-002`, and so on only for same-second collisions,
including parallel processes. Existing folders are never overwritten or renamed.
Internal execution, report and verification IDs remain unchanged in their records;
the generic validated-runtime report location also remains unchanged.

The current Allure report is published at `reports/allure-report/index.html`.
When a new report completes, the previous current HTML is archived under
`reports/allure-history/<timestamp>[-NNN].html`. The history root may be selected
with `HARNESS_ALLURE_HISTORY` (or the starter's `allureConfig.historyDir`); it must
remain separate from the current report and raw staging. Consumer GitHub Actions
uploads only the current Allure HTML and `reports/playwright-report/`, including
Playwright's supporting assets. It does not upload or restore report history or raw
Allure results. The harness's own validation/release workflows are unchanged.

Supporting artifacts are retained separately from the report inventory:

| Artifact | Default consumer location | Purpose |
|---|---|---|
| QA companions | Beside each QA `index.html` | `summary.md`, `defects.md`, internal result records and final integrity `manifest.json` |
| Ordinary Allure raw staging | `reports/allure-results/`, or the configured `resultsDir` | Native reporter output; copied into the run bundle after flush before the next setup clears staging |
| Preserved Allure run evidence | `.harness/runs/allure/<timestamp>[-NNN]/` | Immutable native HTML, `run.json`, `allure-results/`, `capture.json`, optional `verification.json`, and `generation.json`; not a CI upload |
| Native Playwright evidence | `test-results/`, according to configuration | Traces, screenshots and videos |
| Generation verification receipts | `.harness/state/generation/<source-id>/<verification-id>/` | Collection/execution receipts, selected scope and native verification evidence |

Harness QA reports remain separate from native Allure. They include blocked,
ungenerated and partial cases outside the native invocation; Allure cannot replace
their case inventory or determine automation readiness. Consumer sharing folders
such as `reports/delivery/` and maintainer audit outputs use caller-selected paths.

Legacy `allure-report/`, `reports/allure/<unique-id>/`,
`reports/generation/verify-<uuid>/` and older timestamped Allure copies remain
untouched. Existing captures and their recorded report paths remain readable;
pass a legacy capture's recorded directory to `generate-allure` when needed.
New runs keep internal evidence outside the published report folders. Existing
3.7.0 timestamped history bundles and their `latest.html` remain untouched; new
history entries contain only older HTML files. No verification wrapper is created.

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
| index.html | Shared case layout with chart, status groups and optional offline filters; native disclosures work without JavaScript |
| manifest.json | Report delivery/integrity receipt |

Internal JSON/Markdown adapters retain the evidence inventory, source/version/hash
associations and selected public outputs for diagnosis; keep the original run for
inspection. These details are not presented in user-facing HTML. Public outputs
in those internal records are JSON-encoded/clipped above 4,096 characters. Sensitive values are redacted;
protected refs, inputs and definitions omitted. Correct classification remains the
producer's responsibility. HTML/Markdown escape text and HTML uses CSP.

Delivery is WRITTEN/FAILED separately from verdict. render-results exits 0 for a
written FAIL report, 2 for invalid input, 1 for write failure. Gate tests on assessed
outcomes, not render success. The internal formats retain lifecycle and stability
facts; HTML shows relevant cleanup problems as a plain next-action notice.

Manual `execute report <exec>` reassesses every snapshot/evidence file and writes
one case report, Summary, grouped Defects and final manifest. Case details show
expected/actual results, reasons, next actions, plain attempt numbers and screenshots.
Raw JSON, diagnostic inventories, operation provenance, lifecycle counters, internal
run/attempt/evidence IDs and hashes are excluded from HTML, including expanded details.
They remain in authoritative execution storage and internal adapters. No separate per-attempt HTML is generated. Counts use
case summaries; history/attempts remain separate. Rollups count source expectations
in the selected assessed run. Defects span attempts independently of case counts.
CSP permits the generated hashed script for filters/search/sorting/previews, while
disclosures work without JavaScript. Verified PNG/JPEG previews cap at 2 MiB each/
20 MiB total and deduplicate identical bytes; companion links stay relative.
Automation reports use the same Summary and Defects navigation and write both
companions beside `index.html`. Summary covers every case; Defects lists failures,
blockers and review findings with stage, reason and next action. These findings
are not a claim that product bugs were filed. Both files are included in the final
integrity manifest. Keep the complete directory when sharing or attaching a ZIP.

Source cases excluded before execution appear only when present, with readable
case IDs and reasons. Internal verification-counting guidance is not displayed.
The validated runtime writer and native Allure attachment APIs keep their existing
names and delivery receipts, and use the same case layout. Their self-contained
attachments omit companion-file navigation because attachment files have no siblings.
See [manual execution](manual-execution.md) for selection/staleness/delivery.

## Case results and blocker notes

Both execution and automation finish with an offline HTML case report and a direct
`html` link. The overview pie/donut chart counts each case once; its textual legend
shows full-report counts and percentages. Select multiple status checkboxes to show
their combined cases; search narrows that selection. All statuses clears the status
selection while preserving search, and Clear filters resets both. The chart remains
the full-report overview. Cases appear in collapsed status groups with compact rows
and 10 cases per group page. Filtering opens matching groups; expand/collapse controls
and keyboard navigation support browsing. Without JavaScript, native disclosures
still expose every case. Light and dark themes use the plan tracker's palette.
An icon-only sun/moon switch sits at the top right of the report header, with an
accessible label and keyboard operation.
Failed and blocked case rows show their reason before opening details. Details retain the stage, known
next action, expected/actual checks and useful retry outcomes. Automation does not
display internal verification-scope history, gate counters or report fingerprints. Missing reasons explicitly say
that investigation is needed.
Known automation readiness messages and retry instructions use plain wording in the
report and its companions; original reasons remain in the internal result records.
Runtime attachments explain recorded timeouts, unavailable dependencies and other
blockers without displaying their internal classification codes.

```sh
npx --no pom-harness execute report <exec> [--input .harness/state/blockers.json]
npx --no pom-harness generate report --source .harness/sources/<name>.json [--input .harness/state/blockers.json]
npx --no pom-harness generate report --id <source-id>
npx --no pom-harness generate report --id <subset-source-id> --scope .harness/sources/<full-source>.json [--input .harness/state/blockers.json]
npx --no pom-harness generate report --id <subset-source-id> --scope .harness/sources/<full-source>.json --observed .harness/state/observed-scope.json [--input .harness/state/blockers.json]
```

Execution can report a captured source before freeze. Missing environment references
are named for unexecuted frozen cases; their values are omitted. Interrupted attempts
remain blocked, assessed failures retain their authority, and original history stays
visible. An explicit blocker note cannot replace an assessed case.

Automation reports work before a candidate exists. Without a recorded blocker,
such cases are `NOT_GENERATED`, with no inferred execution result. Reports can also
inventory a draft with known IDs/titles and missing actions or
expectations; incomplete cases appear BLOCKED at REFINE. The original empty slots
are retained, and generation preparation still rejects the draft.
Before selecting cases for generation, preserve the original requested source and
record every blocker against that source's fingerprint. Add `reporting` to the
preparation JSON alongside the executable subset's `source`:

```json
{
  "reporting": {
    "source": ".harness/sources/full-source.json",
    "notes": ".harness/state/blockers.json",
    "observed": ".harness/state/observed-scope.json"
  }
}
```

`notes` and `observed` are optional. The original inventory may contain incomplete blocked cases;
the selected subset must still pass normal preparation checks and match its cases
in that inventory exactly. Reporting context is stored in the generation history,
separately from the executable handoff. Automatic reports and later `report --id`
commands reuse it, including recorded blockers, without an extra full-scope document.
For existing histories, `--scope` explicitly associates the original inventory;
combine it with `--input` to persist or refresh its blocker notes. `--input` alone
applies only to the current report. `--source` continues to require an exact match
to the generation source; it does not select the original reporting scope.

When exploration assessed cases outside the generated subset, `observed` preserves
those outcomes through a separate report-only assessment of the actual evidence. Its
descriptor uses consumer-relative paths:

```json
{
  "source": ".harness/sources/observed-source.json",
  "executions": [
    {"snapshot": ".harness/runs/observed-run/inputs.json", "runRoot": ".harness/runs/observed-run"}
  ],
  "bindings": [
    {"sourceScenarioId": "case-1", "runId": "observed-run", "scenarioId": "case-1"}
  ]
}
```

The observed source contains exactly the assessed cases, unchanged from the original
inventory; it can differ from the executable subset. Bind every observed source case
exactly once to one assessed execution case. The command reconstructs runs and
reassesses their evidence; a saved claimed result or arbitrary status annotation is rejected.
`report --observed` requires both `--id` and `--scope` and persists this context for
later reports. PASS, FAIL, BLOCKED, SKIPPED and NEEDS_REVIEW remain exploration outcomes. A case with
no generated test remains NOT_GENERATED and cannot gain an automation pass or READY
from exploration alone.

The report includes every original case exactly once and identifies partial coverage.
For example, a READY six-case subset of a 20-case request reports six verified cases
and fourteen blockers with their recorded stages, reasons and next actions. READY
describes the selected candidate; the original request remains incomplete. HTML
counts and filters, Summary and Defects use the same full inventory. Histories
without explicit original scope show completeness as unknown; the report never
infers the full request from neighboring files or matching IDs.
This applies to every recorded workflow status, including failed, skipped, pending,
not-run and review-needed cases. Cases excluded from a later subset retain their
source-bound historical results with their recorded stage and follow-up work.
Historical outcomes do not grant readiness to the current candidate. Unrecorded
outcomes are not inferred.
Case totals and status filters describe automation dispositions. Exploration results
are listed separately; a case outside the current candidate with a failed, blocked or review-needed
exploration result also appears in Needs attention and Defects.
Generation commands automatically return a separate `reporting` delivery result when their source is
known. The final skill response still renders the current report and links its `html`.
Native outcomes, exploration outcomes and automation readiness appear separately;
one scoped green cannot become READY through report generation. Current candidate
drift, missing approval and changed/missing receipts remain visible as review work.
Failed native receipts are bound to their invocation and fingerprint before supplying
case results. Older unbound receipts cannot establish a case verdict. Native failure
summaries retain matcher names and counts, without copying raw errors or expected values.

For an observed blocker before execution or generation, write consumer-owned notes:

```json
{
  "version": 1,
  "sourceFingerprint": "<fingerprint of the captured source>",
  "cases": [
    {
      "scenarioId": "case-1",
      "stage": "EXPLORE",
      "reason": "The required customer fixture and QA account are unavailable.",
      "nextAction": "Provision the fixture and account, then resume exploration."
    }
  ]
}
```

Compute `fingerprint(source)` with the execution-core helper. For execution, use the
captured `readExecution(...).source`; for automation, use the neutral source or its
reportable draft inventory (or `state.handoff.source`). This is the source fingerprint, not the generation handoff
fingerprint or a hash of the raw JSON file. Notes must name unique known case IDs,
use SOURCE/REFINE/EXPLORE/PREPARE/AUTHOR, and contain bounded reasons and optional next
actions. Each entry records BLOCKED only; there is no status override. Preserve all
observed obstacles in the reason. Notes for assessed/generated cases, changed sources,
unknown IDs or credential-like content fail validation. Titles and arbitrary prose
still require correct classification by the producer.
For subset reporting, bind notes to the original source fingerprint. A later report
reuses saved notes unless a validated replacement is supplied. Preparation and
`generate revise` accept the same optional `reporting` paths. An accepted source
revision may explicitly revise the original inventory while retaining its case IDs;
newly selected cases need reassessed generation evidence and no longer retain their
pre-generation blocker notes. Saved observations are also retained when omitted
from a refresh. Incremental captures replace only reassessed cases and retain the
other source-bound outcomes, including their recorded causes and next actions.
Newly assessed cases lose their retained blocker notes; explicit
notes conflicting with assessed outcomes are rejected. If an observed case's source
changes in an accepted revision, supply freshly reassessed observations rather than
reusing its old outcome.

Automation output contains `result.json` (including the frozen reporting context),
`index.html`, `summary.md`, `defects.md`, and a final integrity `manifest.json`. Report delivery is WRITTEN/FAILED
separately from workflow outcomes; write failure neither resets history nor grants
greens. Explicit report commands exit nonzero when delivery fails.

Each report invocation produces one complete QA bundle: `index.html` is the main
report, and JSON, Summary and Defects use the same full-scope case data. There is
no separate passed-only QA report. Collection and verification receipts remain
unchanged supporting evidence for the tests actually executed; their selected
scope does not replace the QA inventory. Optional native Allure capture is also
run-level evidence. Earlier report snapshots remain historical output.

The synthetic browser proof is `npm run probe:results-report -- <fresh-directory>`.
It checks both skill reports with 120 synthetic cases each, combined status/search
filtering, pagination/reset, deep links, keyboard and no-script access, no external
requests, five viewport sizes in both themes and horizontal reflow from 320 to 3840 pixels.
It also checks validated-runtime attachments, the shared case controls and no missing
companion links. All reports are checked with disclosures open to reject technical
metadata hidden inside details. PR
validation runs the same proof against the installed archive after browser setup.

## Skill report handoff

Share the current HTML report directly with the user after `execute-test` or
`automate-test` finishes, including failed, blocked and partial work. Include a brief
case-count summary and the main failure or blocker reasons in the final response.

When the work is delivered through a related PR, also attach the generated report
directory using the host's supported file-attachment mechanism, archiving it when
needed to preserve companion-file links. If uploads are unavailable through the
authorized CLI or connector, include a sanitized report archive as a file in that
PR, outside installed package or release outputs, and link its immutable revision.
Keep ordinary generated report storage ignored. Link the downloadable report in the
PR description with its outcome summary and identify the reported source/run and
candidate revision where applicable. A local filesystem link in a PR is not a
shared attachment. If attachment delivery is unavailable or fails, state that
limitation separately; keep the local report available to the user and do not claim
it was attached. This handoff does not require a PR for execution-only work.

The case report explains the skill session's scope, outcomes and unfinished work.
It is not added to the consumer's GitHub Actions test-report uploads. Those runs
execute existing automated specs and retain their native Playwright and Allure
reports. Report-browser checks in this harness's validation workflow test the
report feature itself; they do not publish a consumer session report.

## Allure capture and generation

```sh
npx --no pom-harness generate verify --id <source-id> --allure
npx --no pom-harness generate-allure --input .harness/runs/allure/<timestamp>[-NNN]
```

Use the exact recording directory returned by `verify` as `--input`; do not derive
it from the internal verification ID. Generate only after verification returns and
reporters flush. A second green needs a second process for the same approved
candidate and keeps its own Allure directory. Allure failure neither grants nor
revokes a green. Case-level assertion receipts establish the mechanical verification
gate; independent review assesses full scenario semantics. See [automation](PIPELINE.md).

The validated consumer adapter uses allure-playwright/allure-js-commons 3.13.0 and
Node-based allure 3.19.1; Java is unnecessary. Accurate consumer declarations/locks
are required; other versions remain unavailable until validated. Options use
resultsDir/detail/suiteTitle, not unsupported outputFolder.

| Scoped artifact | Purpose |
|---|---|
| run.json | Persisted invocation ID, directory and history-root ownership |
| allure-results/ | One invocation's native results/attachments |
| capture.json | Post-flush counts/status/hashes |
| verification.json | Recorded generation reference |
| index.html | Official single-file native Allure report |
| generation.json | Separate report-job receipt/hashes |
| publication.json | Successful publication receipt; permits retry after delivery failure without republishing older reports |

Generation rejects empty/changed/incomplete captures and rechecks hash-linked history
and review artifacts. Missing verification references fail. Native success may coexist
with verifier FAIL when a helper catches a failed assertion; `verification.json`, the
generation receipt and the separate QA report preserve that outcome. No wrapper page
reclassifies native results. Reports never upgrade readiness or replace core verdicts.

Each invocation retains immutable HTML and receipts in its capture directory,
including failed tests with a complete capture. Repeating generation validates and
reuses that receipt; reopening an older report never republishes it as current.
After HTML and receipt completion, a serialized publisher archives the previous
current HTML and atomically replaces `reports/allure-report/index.html`. The
published file is a complete report, not a redirect. History filenames never
replace existing files. Concurrent completion order determines latest; failed
generation leaves the previous current report intact. Publication failure retains
the immutable evidence and reports delivery separately. Publication uses a bounded
`.harness/runs/allure/.publication.lock`; inspect owner PID before removing a
lock left by an interrupted process.

Rendering uses an exclusive per-invocation `.generation.lock`; completion is rechecked
after acquiring it. A job terminated without cleanup can leave its PID/invocation
lock record. Inspect that recorded ownership and confirm the generator is no longer
running before removing the stale lock and retrying the same captured directory.
The harness never steals a live or unknown writer's lock.

The separate bounded generator uses argument arrays without a shell, fresh output
and no browser opening. Failures retain test history, withhold raw diagnostics and
write no success receipt. Receipts record version/config hash and completeness, not
tamper-proof attestation against the owner. Explicit package allurerc.json uses
Awesome UI/single-file assets and epic/feature/story grouping. Ambient consumer config,
remote publishing, status reclassification, gates, reruns and history aggregation are
not enabled. Timestamped native run bundles are not Allure JSONL trend history. CSP blocks outbound
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

Merge `allureConfig.historyDir`, `resultsDir: 'reports/allure-results'` and
`attachVideo` from the starter. Remove obsolete `reportDir`/`keepHistory` and
`ALLURE_HISTORY` settings. To disable optional Allure output, remove the ordinary
reporter or omit verification's `--allure`. The reporter preserves raw results in
immutable evidence after flush before the next setup clears staging. Setup preserves
customized consumer code and configuration; merge the updated utility explicitly.
Update consumer CI to upload `reports/allure-report/index.html` and the current
Playwright HTML folder only. Existing report folders are not migrated or deleted.

Allure excludes `video/*` attachments by default, both at step and test level.
Set `ALLURE_ATTACH_VIDEO=true` or reporter option `attachVideo: true` to include
them; an explicit reporter option takes precedence. Screenshots and other
attachments remain. Playwright's `use.video` setting and its original attachment
arrays are unchanged, so its HTML report can still contain recorded videos. This
reduces Allure copies and embedded report size; it does not disable recording or
remove Playwright's videos. Use `video: 'off'` separately when recording is unwanted.

Native non-generation tests may resolve `scripts/lib/reporting/allure-reporter.mjs`
from the installed package. An explicit directory must be fresh under `reports/`;
otherwise `.harness/runs/allure/<timestamp>[-NNN]` is used. Generate from that returned
recording directory with `generate-allure --input <recording-directory>` after
Playwright returns. It does not forward test-plan filtering/status overrides.
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
