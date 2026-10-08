> Historical record. Read the [current documentation](../../manual-execution.md) for present behavior. Statements and validation results below describe their original implementation period.

# M19 — standalone manual execution (3.2.0)

`/execute-test suite <id> [plan <id>] [on qa] [checkpoint]` or
`/execute-test story <id> [on qa]` runs captured ADO manual cases through the
existing runtimes, without generating POM code. The
[execute-test skill](../../../.agents/skills/execute-test/SKILL.md) drives the workflow.

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
Freeze returns scoped readiness and actionable missing bindings. Aggregate source,
refinement and freeze files are limited to 500 scenarios, 64 MiB, 2,000,000 nodes
and depth 32; ordinary evidence and mailbox limits are independent.

Execution uses the captured snapshot. Remote revisions are rechecked in batches
of at most 200 only before bug filing or result publication. Changes are flagged;
changed cases are excluded from results unless `--include-changed` is requested.
Delivery saves the last revision check for subsequent reports; dashboards label
its timestamp and executed/current revisions without making extra ADO requests.

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
reports/harness/<execution-id>-<report-uuid>/
```

Execution IDs already start with `execute-`, so the final report folder uses a
single prefix: `execute-<execution-uuid>-<report-uuid>`. Existing report folders
remain readable through their original paths.

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
Canonical request receipts are published atomically before sequence links. Consumed
inbox files are removed; retries keep their request ID. Slow startup reconnects to
the existing host; proven failed startup is recovered and remains selectable.
Routine commands use password-reference guards bound to the verified freeze and
host identity. Start/resume/report/delivery fully verify; old executions fall back
to full reads. Cooperative stop remains available if this small cache is corrupt.

Every check records its own snapshot and read output. Refs stale after agent
state changes; asynchronous UI updates do not silently replace observed evidence.
Final PASSes stale after later changes. Final FAILs and preconditions remain
historical. Supporting comparisons never decide a verdict. Direct output
self-comparisons and same-step typed-field readbacks are refused.
Grounded observations are reliable and labeled; ambiguity, insufficiency and
synthetic expectations remain INDETERMINATE. Registered evidence tampering causes
integrity failure with no verdict. See [verdicts](../../../.agents/skills/execute-test/references/verdicts.md).
End-step verifies registered files and hashes before assertions, effects or the
next step. Subject matching uses normalized full names; visual judgments require
screenshots even when the condition has no quoted or numeric literals.
Fixed DOM readers use rendered text and selected dropdown labels, traverse open
shadow roots/slots once and record unreadable frame gaps. `text` and form `value`
are distinct. Closed roots are outside coverage; evaluation is in the page's own
JavaScript world, so snapshot membership does not make DOM reads tamper-proof.
Incomplete coverage cannot prove absence, equality or exact counts.
Browser `execute-assertion/2` records reference verified read artifacts with digests
and bounded excerpts; report reassessment recomputes comparisons from those bytes.
Legacy `/1` remains readable but cannot supply new browser Bugs/attachments or a
case publication dependent on legacy browser evidence. API/DB defects remain eligible.

Failures poison new verdicts while preserving established FAILs. Automatic retries
need a read-only contract and are capped at three. Mutation retries require
confirmed no-effect reconciliation. Resource cleanup uses core resource/lifecycle
receipts, with identity outputs passed into cleanup attempts. Persistent and
no-obligation resources use not-required; existing/restore lifecycles are deferred.
The host finishes at 70% of the observation budget and bounds browser assertion
provenance to 64 KiB. Earlier finalized FAILs remain recorded; an observation too
large to retain stays unresolved. `FINISH_REQUIRED` means stop issuing commands
and inspect the report. API/DB assertion artifacts retain their runtime limits.
Business cleanup returns five minutes before its 10/20-minute window ends,
including cancellation of in-flight operations, reserving that time for owned
session shutdown. Shorter test windows reserve half their duration.
One attempt finalizer validates before committing. The library-only
`context.onBeforeExpire(handler)` closes dispatch, cancels/drains native work,
settles already-observed evidence and then makes the context inactive. Settlement
reserves at most min(5 seconds, cleanupReserveMs / 4, remaining cleanup time) inside
that deadline. It cannot launch browser actions, diagnostics or screenshots, and
late evidence/commits are refused. Reconciliation preserves the original uncertain
effect; identical repeats are idempotent and contradictory changes are refused.

## Login, diagnostics and reports

Browser targets support startUrl and user handles with usernameRef/passwordRef
environment references. Login steps use native secret names; values stay in
protected native config and memory. Usernames are public and resolved host-side;
only password aliases are native secret bindings. Save-login requires an observed landmark.
Saved state is reused across scenarios within an execution and its landmark must
be rechecked. SSO/MFA state can be imported. Report/stop removes saved state
unless --keep-login; normal browser cleanup always removes native private state.

Diagnostics default to end: once in the last browser step and in FAIL/INDETERMINATE
steps. Per-step and off are available. Delta captures retain console errors and
failed/400+ request origin/path, without query values. Command errors/OUTPUT_LIMIT
are notices; timeouts, cancellation and unavailability remain execution failures.
Diagnostics never determine a test verdict. The live probe records latency.
Per-step collection also captures before navigation clears logs. End collection
cannot promise historical coverage across earlier navigations. Uncaught exceptions
and request-number resets are handled without inventing missing history.

Report recreates each run from its frozen input snapshot and reassesses all hashed
evidence; result.json is never trusted. Output includes per-run core reports, a
dashboard, summary and grouped defects, with manifest.json written last. HTML is
escaped under a restrictive CSP. Only verified PNG/JPEG context is embedded,
bounded to 2 MiB each and 20 MiB total.

The final `index.html` counts authoritative case summary rows. Run attempts and
historical reviews are displayed separately; verification rollups count source
expectations in the selected assessed run, not individual assertion records.
Defect groups include failed/unresolved expectation findings and diagnostics
across assessed attempts. They are separate from failed-case counts.

The report is self-contained and works from `file://`. Search, case-outcome
filters, sorting and screenshot previews use a static inline script authorized
by its generated SHA-256 CSP hash. Without JavaScript, native disclosure controls
still expose results, assertion evidence, original JSON, cleanup and diagnostics.
Identical embedded images share one preview while retaining their run/evidence
references. Companion Summary, Defects and per-run Core report paths remain relative.

A valid explicit rerun replaces an earlier integrity-invalid run for delivery
selection, retaining the old audit record. Earlier valid FAILs still dominate.
Unrepaired integrity failures block all ADO delivery.

## Delivery

Preview fully validates ADO process metadata, fields, paths, duplicates and
validateOnly requests for bugs, or test points for results. --execute authorizes
external writes. Stable defect tags group iterations and reruns without timestamps,
run IDs, environments or actual values. Open duplicates are skipped; closed ones
get Related links. Configurable defaults live in ado.bugs.
Default Bug candidates are reliable matching FAILs; `--include needs-review,diagnostics`
is explicit, and drafts can set `file: false`. Acknowledgement recovery matches the
operation and exact fingerprint. Uncertain attachments are isolated and only an
explicit fingerprint/hash recreation repeats an upload. Publication resume retains
its saved run selection, comments and identity after reassessment.

## Command-name compatibility

This harness owns `/execute-test`; AgenTeX or a consumer skill with the same name
must use a distinct name. Setup preserves consumer-owned skill folders and reports
how to rename the folder and frontmatter (for example `execute-test-team`).

Create intents are flushed before dispatch. Acknowledgements carry returned
identities in the same fsynced record. Bugs reconcile by filing tag; runs reconcile
by plan-scoped paged List Runs and exact client-side names. No match means
UNCERTAIN and requires explicit recreation/new-run authorization. Ledgers make
repeated commands resume. See [delivery](../../../.agents/skills/execute-test/references/delivery.md).
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
