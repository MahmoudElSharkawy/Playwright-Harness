> Historical record. Read the [current documentation](../../contributing.md) for present behavior. Statements and validation results below describe their original implementation period.

# M15 — Final sequential end-to-end host parity

M15 connects the accepted execution, generation, review, verification and reporting
components in a fixed acceptance proof. It does not add a workflow engine, production
host adapter, browser command language or parallel dispatcher. See
[actual validation](M15-VALIDATION.md) for completed and outstanding gates.

## Scope and ownership

Each actual authenticated Claude Code and Codex host receives a separate synthetic
consumer and the same immutable installed package. Native Codex skill links and
Claude plugin packaging resolve the canonical `.agents/skills` content. Consumer
code, source refinement, knowledge candidates, artifacts and history remain outside
the installed package. Package contents, dependencies and supplied scaffolds are
hashed before and after native work.

The fixed source contains 16 scenarios: the M13 UI observation and nine API/SQL
Server/PostgreSQL observations covering catalog, helper and inline sources; plus
temporary, persistent, no-obligation and restored API state, and bound CRUD with
temporary fixtures on both databases. Native hosts author the page, API service,
database service and 16 explicit test bodies. Technical scaffolds are supplied and
immutable. The six lifecycle scenarios reuse the previously accepted M11 callbacks
through a **test-only** helper; normal consumer automation does not depend on these
acceptance fixtures.

Exploration runs 29 cases: the ten M13 observations and all 19 M11 control cases.
Reliable failures, refused capabilities, uncertain effects, restoration conflicts
and recovered outcomes retain their original classifications. Only the 16 positive
source cases enter generation. Negative controls are neither discarded from the
evidence nor relabeled as successful scenarios.

## Complete sequential lifecycle

1. Load the unchanged local source without ADO. The actual host reads the full source
   and canonical automation skill through native tools.
2. Refine each original scenario without changing its expectation keys. Validate and
   freeze that source-bound refinement before any exploration is dispatched.
3. Execute the fixed observations with the existing official browser CLI integration,
   shared API runtime and actual SQL Server/PostgreSQL drivers. Save assessed results,
   original attempts, effects, assertions, lifecycle dispositions and reports.
   Produce unreviewed knowledge candidates bound to the current observed assertions and
   evidence. Reviewed knowledge remains immutable.
4. Author source-specific POM code through native file tools. Run meaningful convention
   and TypeScript checks. Freeze the candidate with the existing M13 snapshot gate.
5. A different reviewer examines the original source, handoff, generated code,
   bindings, checks and lifecycle intent. A recorded identity alone is insufficient;
   an actual independent review artifact must accompany the verdict. Rejection goes
   back to the author; the existing three cumulative repair limit applies.
6. After approval, the native host invokes two independent sequential Playwright
   processes, each with one worker and zero retries. Every source expectation must
   execute a real native assertion. Failures remain failures; an unchanged candidate
   cannot be rerun until it happens to turn green.
7. Each verification saves 15 fresh API/DB runtime executions and their validated
   JSON, Markdown and HTML reports. The UI case uses the actual native browser
   assertion receipt. Capture native Allure and render the pinned Allure 3 report
   after flush. Inspect both raw and rendered attachment association and bytes.
8. Reassess both complete histories and compare semantic outcomes. `READY` requires
   the current approved candidate and two scoped greens, independent of reporter
   presentation. No external delivery is performed by this proof.

## Semantic comparison and evidence

Compare source selection and intent, source-to-assertion coverage, observed outcomes,
typed outputs and binding relationships, status/stability, failure classifications,
recovery decisions, required cleanup/restoration, intentional retention and evidence
coverage. Native source markers require evaluated assertions; independent review
checks that their actual meaning preserves source intent.

Normalize execution IDs, timestamps, durations, report paths/hashes and native
diagnostic wording only after checking each run's own integrity. Generated resource
identities use the existing correspondence mapping, preserving producer/consumer
relationships and business values. Do not strip business differences to obtain parity.

The assessor reconstructs execution records, reassesses results, validates the
generation handoff, re-renders expected reports and checks native verification
receipts. Each Allure test must exist once and remain passed; its JSON/HTML harness
attachments must remain under technical steps in the right test, with identical
content in the captured and rendered report. Agent prose is not execution evidence:
successful native command events must contain the exact receipt digest and scope.

## Autonomy, cleanup and permissions

The fixture selects `test` once and configures only its owned targets. Dynamic API
CRUD and bound database DML run without per-mutation harness approval. Catalog,
helper and inline definitions remain peers. Database safety uses the existing driver
bindings, restricted privileges, configured scope and lightweight classification;
no SQL parser/compiler is added.

Temporary fixtures clean up; defined temporary changes restore with guards;
intentionally persistent outcomes remain; no-obligation mutations do not acquire
automatic before-state capture. The later teardown of a disposable fixture server
or database is infrastructure ownership, not an invented scenario restoration duty.

Native host permissions remain different. Claude receives explicit read, supplied
Node-command and consumer-file authoring allowances. Codex retains native automatic
approval review for owned proof commands. The probe does not bypass permissions or
override hook trust. Hook behavior was covered separately in M11; this proof disables
optional hooks only for its own native processes. Process-tree inspection must prove
owned descendants stopped; unknown inspection is not clean shutdown.

Database credentials exist only in runtime environment references. Private proof
directories restrict access; public documentation records sanitized counts and
outcomes rather than transcripts, local paths or machine identifiers.

## Running the opt-in proof

Use Node 24, the pinned installed dependencies and authenticated native hosts. Real
Docker-backed database fixtures, supported browsers and native process inspection
must be available. Run the two hosts sequentially.

```sh
npm run test:workflow
npm run check:workflow-conventions
npm run probe:workflow -- prepare
npm run probe:workflow -- run <state-file> claude <native-cli> <available-model>
npm run probe:workflow -- run <state-file> codex <native-cli>
npm run probe:workflow -- assess <state-file>
```

Preparation returns a private state-file location. At `AWAITING_INDEPENDENT_REVIEW`,
the parent supplies a fresh independent reviewer with the exact candidate and the
descriptor's review destination. Write the review artifact before its JSON verdict;
the waiting native run then records it through the M13 gate. Do not fabricate a
review or write an approval based only on successful checks.

Interrupted or failed attempts retain their history. Prepare fresh owned roots for
an infrastructure rerun; report the failed attempt and any actual code correction.
Never overwrite old receipts or retry a reliable failed assertion to green. Unit
fixtures are synthetic assessor tests, not proof of authenticated host integration.

M15 establishes sequential parity on the actually tested host/platform versions.
The broader installed-platform matrix remains M17. M16 concurrency is not started;
sequential execution remains the default even after this proof succeeds.
