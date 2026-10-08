# Execute manual test cases

Use the [execute-test skill](../.agents/skills/execute-test/SKILL.md) to run captured
Azure DevOps cases through browser, API and database runtimes, retaining evidence,
reports and defects. This workflow generates no POM code. Use
[automation](PIPELINE.md) when you want durable tests.

Manual execution currently accepts ADO suites/stories and runs sequentially.
API/DB-only cases start no browser. Configure the selected
[environment](configuration.md) and [ADO connection](azure-devops.md) first.

## Start, refine and freeze

Ask for `/execute-test suite <id> [plan <id>] [on qa] [checkpoint]` or
`/execute-test story <id> [on qa]`. CLI equivalents run from the consumer:

```sh
npx --no pom-harness execute prepare suite 4521 --plan 4500 --environment qa
# Review the returned .harness/runs/<exec>/refinement.json.
npx --no pom-harness execute freeze <exec>
npx --no pom-harness execute next <exec>
npx --no pom-harness execute do <exec> status
npx --no pom-harness execute do <exec> begin-step s001
npx --no pom-harness execute do <exec> look
# Observe, act and check through the skill's live protocol.
npx --no pom-harness execute do <exec> end-step --effect confirmed
npx --no pom-harness execute report <exec>
```

Use the execution ID from `prepare`. Story preparation uses Tested By links; suites
need a plan argument or configured default. Options include `--checkpoint` and
`--diagnostics end|per-step|off`. Preparation retains templates and case/shared-step
revisions. Unusable case content is explicitly excluded; auth, transport and ownership
failures are fatal. Local parameter tables expand into at most 100 iterations per
case and 500 scenarios overall. Substitution is declared, bounded, case-insensitive
and longest-first. Sensitive values are withheld; shared parameter sets are unsupported.
Synthesized missing expectations always require review.

Refine source actions into ordered conditions, bind checks to expected source data,
identify targets/credentials, and declare read-only and cleanup contracts. Freeze
checks exact coverage, condition segmentation, monotonic phases and traceable expected
values. Each condition gets a distinct core expectation retaining its source key;
API/DB checks map one-to-one. The receipt binds source, refinement, environment and
compiled operations. Readiness is scoped to selected targets/secret references.

Source/refinement/freeze aggregate limits are 500 scenarios, 64 MiB, 2,000,000 nodes
and depth 32. Execution uses the captured snapshot, not later edits. Revisions are
checked again only for bug/result delivery, in batches of at most 200; reports show
the saved check's timestamp and executed/current revisions without another remote read.
Changed cases are excluded from publication unless `--include-changed` is selected.

## Observe and verify

Follow the [verdict rules](../.agents/skills/execute-test/references/verdicts.md).
Each check retains its own snapshot/read output. State changes stale refs and finalized
PASSes; established FAILs/preconditions remain historical. Supporting comparisons do
not determine a verdict. Direct self-comparisons and same-step typed-field readbacks
are refused. Grounded reliable observations decide outcomes; ambiguity, insufficient
coverage and synthetic expectations remain INDETERMINATE.

`end-step` verifies evidence bytes/hashes before committing assertions/effects or
advancing. Tampering produces integrity failure with no verdict. Visual judgment
requires screenshots, including conditions without quoted/numeric literals; subject
matching uses normalized full names. Readers distinguish rendered text, form values
and selected labels, traverse open shadow roots/slots and retain frame gaps. Closed
roots/incomplete coverage cannot prove absence, equality or exact counts. Page-world
reads are not tamper-proof.

Browser `execute-assertion/2` binds bounded excerpts to verified reads/digests;
reassessment recomputes comparisons. Historical `/1` is readable but cannot support
new browser bug attachments or dependent case publication. API/DB defects remain eligible.
Execution failures prevent new verdicts while retaining established FAILs. Automatic
read recovery needs a read-only contract and allows at most three attempts; mutation
replay requires confirmed no-effect reconciliation.

Cleanup receives recorded originating identities and follows core receipts.
Persistent/no-obligation resources use `not-required`. Borrowed-state restoration
is not supported by this workflow. Shared runtime capabilities do not imply every
manual workflow supports them.

## Host lifecycle and recovery

One owned host runs the sequential runtime once per scenario. Its curated native
allowlist excludes raw JavaScript and session/global controls. The single-flight
mailbox uses durable UUID deduplication: wait by sequence, keep a request ID when
retrying transport, and never resend a pending mutation as a new command. Redacted
private replies are not evidence. Canonical receipts precede sequence links atomically;
consumed inbox files are removed.

```sh
npx --no pom-harness execute status <exec> --readiness
npx --no pom-harness execute resume <exec>
npx --no pom-harness execute next <exec> --rerun <scenario-id>
npx --no pom-harness execute stop <exec>
```

`resume` selects interrupted/integrity-invalid work when applicable; next/resume accept
`--foreground`. Slow startup reconnects to the existing host. Reclaiming a creation-
identity lock requires recorded owners absent and successful owned browser recovery.
Nonce checks protect replacement locks; slow READY does not authorize launcher cleanup
after ownership transfers. Mailbox persistence failure aborts and settles cleanup;
incomplete cleanup retains recovery records. Cached password-reference guards bind to
freeze/host identity, while start/resume/report/delivery fully verify them. Cooperative
stop remains available when that cache is corrupt.

On `FINISH_REQUIRED`, stop commands and inspect the report. The host finishes at 70%
of observation budget; browser assertion provenance caps at 64 KiB. Oversize evidence
stays unresolved while existing finalized FAILs remain. Business cleanup returns five
minutes before the end of its 10/20-minute window for session shutdown; shorter test
windows reserve half. In-flight operations cancel within the window.

Library `context.onBeforeExpire` closes dispatch, drains native work and settles
already-observed evidence. Reserve is at most five seconds, a quarter of cleanup
reserve, or remaining cleanup time, whichever is smallest. It starts no actions,
diagnostics or screenshots; late evidence/commits are refused. Reconciliation preserves
the original uncertain effect: identical repeats are idempotent and contradictions fail.

## Login and diagnostics

Browser targets can supply startUrl and named username/password refs. Usernames resolve
host-side; password aliases bind protected native secrets. Never send raw passwords
through the mailbox. Save/reuse needs an observed landmark rechecked per scenario.
Reuse stays within the execution; imported SSO/MFA state is supported:

```sh
npx --no pom-harness execute login-state <exec> import <target> <user> <file>
```

Report/stop removes saved state unless `--keep-login`; browser cleanup always removes
native private state. Diagnostics default to end: last browser step plus failed/
indeterminate steps. Per-step captures before navigation clears logs; off disables it.
Deltas retain console errors and failed/400+ request origin/path, without query values.
End capture cannot recover cleared history. Command errors/OUTPUT_LIMIT are notices;
timeout/cancellation/unavailability are execution failures. Diagnostics never decide verdicts.

## Reports and delivery

Ignored consumer storage includes `.harness/runs/<exec>/` source, refinement, freeze,
execution records, `snapshots/`, `control/<runId>/`, runtime run directories, `auth/`
and `delivery/`. Control/snapshots stay outside the runtime's fresh run root.
Windows ACLs/Linux modes protect private state.

Report creation reassesses frozen inputs and evidence, never trusting saved result
JSON. It writes per-run reports, a self-contained dashboard, Summary, grouped Defects
and final manifest under a fresh `reports/harness/execute-<execution-uuid>-<report-uuid>/`.
Verified PNG/JPEG context is limited to 2 MiB each/20 MiB total. Counts come from
case summaries; attempts/history are separate, and expectation rollups use source
expectations from the selected assessed run. Defect groups span assessed attempts
independently of failed-case counts. CSP/escaping protects HTML; filters/search/sorting
and deduplicated previews work from file://, with disclosures without JavaScript.
Companion links stay relative. See [reporting](reporting.md).

An explicit valid rerun can replace an integrity-invalid attempt for delivery while
retaining history. Earlier valid FAILs still dominate; unrepaired integrity failures
block delivery. Bug preview validates process metadata/fields/paths/duplicates and
validateOnly requests; result preview validates suite points:

```sh
npx --no pom-harness execute file-bugs <exec>
npx --no pom-harness execute publish-results <exec>
```

After concrete preview and authorization, repeat with `--execute`. Story executions
can file bugs; suite executions can also publish manual results. See
[ADO delivery](azure-devops.md#manual-execution-delivery) for revision controls,
aggregation, duplicate handling and uncertain writes. Manual execution neither
updates tracker events nor promotes reviewed knowledge.

## Limits and validation

Parallel/local manual sources, file upload/download, per-step ADO outcomes, shared
parameter sets, existing/restore lifecycles, visual baselines and cross-execution
login are deferred. Existing consumer execute-test skills are preserved; rename a
conflicting team skill folder/frontmatter rather than overwriting it.

[Dated validation](archive/milestones/M19-VALIDATION.md) distinguishes offline and
installed proofs from live ADO acceptance/agent adaptation. Authenticated Claude/
Codex acceptance remains a separate gate; see [contributing](contributing.md).
