# M14 reporting and Allure

Reporting presents results already decided by the execution core or generation
verifier. It never infers a verdict from HTTP status, row counts, native test totals
or cleanup observations. Required cleanup failures and reliable assertion failures
remain visible; intentional retention is a normal lifecycle disposition. A recovered
PASS remains PASS with `stability=recovered` and its complete attempt history.

## Validated execution reports

Use `scripts/lib/reporting/index.mjs` with an in-process `assessRun` or runtime
`finish()` result. These immutable results carry a process-local validation mark;
fabricated or deserialized claimed verdicts are refused. This is an API misuse
guard, not isolation from trusted automation code. The core verdict algorithm and
serialized result format are unchanged.

```js
import {writeReports} from 'playwright-pom-harness/scripts/lib/reporting/index.mjs';
const delivery = writeReports(roots, result);
// Inspect delivery.status independently of result.status.
```

For saved runs, reconstruct frozen inputs and reassess original observations and
artifact bytes through the CLI. A stored `result.json` is never trusted as proof:

```text
node <packageRoot>/scripts/render-results.mjs --project-root <consumer> --snapshot .harness/runs/<run-id>/inputs.json --run-root .harness/runs/<run-id> --output reports/harness/<new-name>
```

The output defaults to a fresh `reports/harness/<run-id>-<unique-id>/` directory.
An explicit output must also be a fresh consumer-relative directory under `reports/`.
Existing output, source paths and links outside the consumer are refused. The manifest
is written last, recording all three artifact lengths and SHA256 hashes; a partial
directory without its manifest is incomplete. There is no automatic overwrite or
deletion of previous reports.

| File | Purpose |
|---|---|
| `result.json` | Sanitized report view, exact recorded status/stability/counts and report fingerprint |
| `report.md` | Escaped readable view of phases, attempts, effects, assertions, resources and outputs |
| `index.html` | Self-contained responsive static view; no script or network dependency |
| `manifest.json` | Successful delivery receipt with relative artifacts and integrity metadata |

Every view includes operation source/version/fingerprint and evidence associations.
Evidence paths are relative to the original run directory; report bundles contain
the inventory, not raw artifact bodies. Keep that run when original evidence is
needed. Selected public output values are JSON-encoded for display and explicitly
clipped above 4096 characters. Sensitive values are redacted; protected restoration
and output references, inputs and operation definitions are omitted. Public values
still require correct sensitivity classification by the producing automation.
HTML/Markdown escape consumer text; HTML also restricts active content with CSP.

Reporting delivers `WRITTEN` or `FAILED`, independently of the recorded test verdict.
The CLI exits 0 for successful delivery even when the report describes FAIL; invalid
inputs exit 2 and output failure exits 1. CI must use validated execution outcomes
for its test gate and report delivery status for its reporting gate. Do not interpret
a report command's successful exit as a test pass.

## Generated Playwright tests and Allure

In a consumer technical step, attach the validated execution result with:

```js
const delivery = await attachResult(test, result);
```

Import it from `scripts/lib/reporting/index.mjs`. It uses the current native
`test.info().attach()` and stable names `Harness execution result` (JSON) and
`Harness execution report` (HTML). Call inside the operation's `test.step` so Allure
nests the attachments under that technical operation. `ATTACHED`, `NOT_IN_TEST` and
`FAILED` are presentation outcomes; inspect them without changing the test verdict.
The generated RuntimeActions fixture demonstrates this shared API/DB integration.

For reviewed generation verification:

```text
node <packageRoot>/scripts/generate-tests.mjs verify --project-root <consumer> --id <source-id> --allure
node <packageRoot>/scripts/generate-allure.mjs --project-root <consumer> --input reports/generation/<verification-id>
```

Run the second command after verification returns. Repeat verification in a new
process for the required second green. Optional reporting failure does not grant or
revoke a green. The M13 gate still requires independent approval, exact source
assertions and two fresh successful processes for the same frozen candidate.

The concrete adapter uses separately installed `allure-playwright` **3.13.0**,
`allure-commandline` **2.46.1** and a working `java` on PATH. Keep consumer dependency
declarations/lockfiles accurate. Other versions fail explicitly as unavailable until
validated. Configuration follows the official [Playwright configuration reference](https://allurereport.org/docs/playwright-configuration/):
`resultsDir`, `detail` and `suiteTitle`. Native reporter interfaces were also checked
against the installed version. No reporter registry or copied Allure implementation
is included. The retained example configuration and its legacy report paths remain
unchanged; do not copy the unsupported `outputFolder` key into new configurations.

For ordinary native tests outside generation verification, configure the concrete
`scripts/lib/reporting/allure-reporter.mjs` reporter by its resolved installed path.
Its optional `directory` must be a fresh consumer `reports/` directory; otherwise
it uses `reports/allure/<unique-id>/`. It does not forward Allure test-plan filtering
or return status overrides. Native scope stays with Playwright. Generation always
uses its own mandatory verification reporter plus this optional adapter.

| Consumer location | Content and authority |
|---|---|
| `reports/generation/<verification-id>/allure-results/` | Native Allure result files and attachments, one invocation only |
| Same folder's `capture.json` | Post-flush capture status, test count, native status and artifact hashes |
| Same folder's `verification.json` | Reference to the recorded generation verification outcome |
| Same folder's `index.html` | Recorded verifier status and link to explicitly native detail |
| Same folder's `allure-report/index.html` | Official generated single-file Allure report |
| Same folder's `generation.json` | Separate report job receipt and generated artifact hashes |

Allure generation checks the captured file inventory and count, rejects empty,
changed or incomplete capture, and rereads the hash-linked verification history and
review artifact for generation captures. A missing verification reference fails
closed. The generation landing page shows that recorded verifier outcome above
native details. For example, a helper may catch a failed assertion so native
Playwright reports passed while the source-coverage verifier records FAIL. The
landing page preserves FAIL; it never promotes native status to readiness. Each
embedded harness execution report similarly retains its own core verdict.

Java generation is a separate bounded job after reporter flush. It passes arguments
without a shell and never opens a browser. Fresh output is required; failure returns
`FAILED` with its stage, leaves test history unchanged and writes no success receipt.
Raw diagnostics are withheld. `capture.json` and `generation.json` are completeness
and integrity records, not tamper-proof attestations against the filesystem owner.

These report directories are consumer runtime artifacts and stay ignored. Native
Playwright/Allure also records consumer test titles, logs, errors and attachments;
the harness does not promise a general sanitizer for arbitrary third-party test
code. Keep secrets out of those sources, use existing redacting utilities and review
artifacts before sharing. Nothing here publishes or automatically exports artifacts.

## Validation and limits

`test:reporting` covers report contracts and integrity failures; `test:generation`
includes real native reporter captures. `probe:reporting` extends the owned live
consumer proof with reports and two Allure generations, waiting for an actual
independent review before generated tests execute. It is interactive development
validation, not an unattended CI command. The small native failure control can also
run with `HARNESS_ALLURE_HTML_PROOF=1` and the `Allure capture preserves` test-name
filter; this requires Java and validates actual FAIL landing-page generation.

See [actual M14 validation](M14-VALIDATION.md) for passed, failed and unperformed
checks. Full sequential host workflow parity is M15, bounded parallel execution
is M16 and installed cross-platform/CI readiness is M17. Sequential remains default.
