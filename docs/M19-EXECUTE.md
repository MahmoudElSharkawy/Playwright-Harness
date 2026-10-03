# M19 — standalone manual execution (3.2.0)

`/execute-test suite <id> [plan <id>] [on qa] [checkpoint]` or
`/execute-test story <id> [on qa]` runs captured ADO manual cases through the
existing runtimes, without generating POM code. The
[execute-test skill](../.agents/skills/execute-test/SKILL.md) drives the workflow.

```sh
npx --no pom-harness execute prepare suite 4521 --plan 4500 --environment qa
# Edit the returned consumer refinement.json.
npx --no pom-harness execute freeze <exec>
npx --no pom-harness execute next <exec>
npx --no pom-harness execute do <exec> status
npx --no pom-harness execute do <exec> begin-step s001
npx --no pom-harness execute do <exec> look
# Observe, act and verify using the live protocol.
npx --no pom-harness execute do <exec> end-step --effect confirmed
npx --no pom-harness execute report <exec>
npx --no pom-harness execute file-bugs <exec>
npx --no pom-harness execute publish-results <exec>
```

## Source and freeze

Prepare reads ADO tolerantly, retaining case/shared-step revisions and source
templates. Authentication, transport and project-ownership failures stay fatal.
Unusable cases appear as exclusions. ADO local-table rows become separate
iterations (100 per case, 500 total). Declared parameter substitution is bounded,
case-insensitive and longest-first. Sensitive values are withheld. Shared
parameter sets remain deferred. Synthetic missing expectations always need review.

Freeze checks exact source coverage, condition segmentation, monotonic phases,
traceable expected data, explicit read-only contracts and cleanup declarations.
Its receipt covers source, refinement, environment and compiled operations.
Each condition gets a distinct core expectation ID, retaining its source key.
API/DB checks map one-to-one to those IDs. Scoped readiness requires only targets
and credential references actually used by the selected scenario.

Execution uses the captured snapshot. Remote revisions are rechecked in batches
of at most 200 only before bug filing or result publication. Changes are flagged;
changed cases are excluded from results unless `--include-changed` is requested.

## Host ownership and evidence

One host calls `runSequentialScenario` once. API/DB-only scenarios omit the
browser. Storage is consumer-owned and ignored:

```text
.harness/runs/<exec>/
  source.json, refinement.json, freeze.json, execution.json
  snapshots/<runId>.json
  control/<runId>/{host.json,inbox/,replies/,host.log}
  <runId>/{observations.json,evidence/,protected/}
  auth/, delivery/
reports/harness/execute-<exec>-<uuid>/
```

Control/snapshots sit outside runRoot so native runtimes acquire a fresh runRoot.
Windows ACLs and Linux modes protect state. A creation-identity lock guards the
launcher/host handoff. All recorded owners must be absent and owned browser
recovery must succeed before reclaiming it. Nonce checks stop stale hosts from
changing a replacement lock. Slow READY does not authorize launcher cleanup
after the host claims ownership. `--foreground` is available.

The mailbox is single-flight with durable UUID deduplication. Pending replies are
awaited by sequence, never replayed as mutations. Replies are redacted private
communications, not evidence. Native commands use a curated allow-list; raw
JavaScript and session/global controls are unavailable to the agent.
Mailbox persistence failures abort and settle runtime cleanup before ownership
is released; incomplete cleanup retains the recovery record.

Every check records its own snapshot and read output. Refs stale after agent
state changes; asynchronous UI updates do not silently replace observed evidence.
Final PASSes stale after later changes. Final FAILs and preconditions remain
historical. Supporting comparisons never decide a verdict. Direct output
self-comparisons and same-step typed-field readbacks are refused.
Grounded observations are reliable and labeled; ambiguity, insufficiency and
synthetic expectations remain INDETERMINATE. Registered evidence tampering causes
integrity failure with no verdict. See [verdicts](../.agents/skills/execute-test/references/verdicts.md).

Failures poison new verdicts while preserving established FAILs. Automatic retries
need a read-only contract and are capped at three. Mutation retries require
confirmed no-effect reconciliation. Resource cleanup uses core resource/lifecycle
receipts, with identity outputs passed into cleanup attempts. Persistent and
no-obligation resources use not-required; existing/restore lifecycles are deferred.

## Login, diagnostics and reports

Browser targets support startUrl and user handles with usernameRef/passwordRef
environment references. Login steps use native secret names; values stay in
protected native config and memory. Save-login requires an observed landmark.
Saved state is reused across scenarios within an execution and its landmark must
be rechecked. SSO/MFA state can be imported. Report/stop removes saved state
unless --keep-login; normal browser cleanup always removes native private state.

Diagnostics default to end: once in the last browser step and in FAIL/INDETERMINATE
steps. Per-step and off are available. Delta captures retain console errors and
failed/400+ request origin/path, without query values. Command errors/OUTPUT_LIMIT
are notices; timeouts, cancellation and unavailability remain execution failures.
Diagnostics never determine a test verdict. The live probe records latency.

Report recreates each run from its frozen input snapshot and reassesses all hashed
evidence; result.json is never trusted. Output includes per-run core reports, a
dashboard, summary and grouped defects, with manifest.json written last. HTML is
escaped under a restrictive CSP. Only verified PNG/JPEG context is embedded,
bounded to 2 MiB each and 20 MiB total.

A valid explicit rerun replaces an earlier integrity-invalid run for delivery
selection, retaining the old audit record. Earlier valid FAILs still dominate.
Unrepaired integrity failures block all ADO delivery.

## Delivery

Preview fully validates ADO process metadata, fields, paths, duplicates and
validateOnly requests for bugs, or test points for results. --execute authorizes
external writes. Stable defect tags group iterations and reruns without timestamps,
run IDs, environments or actual values. Open duplicates are skipped; closed ones
get Related links. Configurable defaults live in ado.bugs.

Create intents are flushed before dispatch. Acknowledgements carry returned
identities in the same fsynced record. Bugs reconcile by filing tag; runs reconcile
by plan-scoped paged List Runs and exact client-side names. No match means
UNCERTAIN and requires explicit recreation/new-run authorization. Ledgers make
repeated commands resume. See [delivery](../.agents/skills/execute-test/references/delivery.md).
One delivery operation owns an execution at a time; concurrent delivery is BUSY.

Suite outcomes group the full iteration scope with FAIL > NEEDS_REVIEW > BLOCKED
> all-SKIPPED > PASS. Review maps to ADO Blocked. Omitted cases are listed.
Runs are manual (automated:false) with bounded ASCII comments carrying method
counts, bug IDs and executed/current revisions. Story executions file bugs only.

## Validation and deferred work

[M19 validation](M19-VALIDATION.md) records local checks and outstanding live
acceptance. Windows/Linux CI runs the offline tests and installed-archive probe.
Real Claude/Codex runs against an ADO sandbox and changed UI remain a distinct
acceptance gate; scripted fixture runs do not claim to prove agent adaptation.

Deferred: parallel scenarios, local sources, upload/download, per-step ADO outcomes,
existing/restore lifecycles, cross-execution login, shared parameter sets, tracker
events, knowledge promotion and visual baselines. Dependencies are unchanged.

ADO reference contracts: [validateOnly creation](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/create?view=azure-devops-rest-7.1),
[List Runs pagination](https://learn.microsoft.com/en-us/rest/api/azure/devops/test/runs/list?view=azure-devops-rest-7.1).
