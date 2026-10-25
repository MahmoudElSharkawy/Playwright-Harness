# Maintain failed, changed and blocked tests

Use [maintain-test](../.agents/skills/maintain-test/SKILL.md) to **diagnose only** or
**diagnose and fix** existing failed, flaky, changed or blocked cases. It accepts
local sources, ADO suites/stories, or case IDs with run evidence. Configure the relevant environment
as for [automation](PIPELINE.md) or [manual execution](manual-execution.md).
The skill uses their commands and evidence; there is no separate maintenance engine.

For identifying affected areas and recommending regression scope only, use
[change impact analysis](impact-analysis.md). A selected story/bug or failure report
does not itself request diagnosis. Combined analysis-and-repair stays in maintenance,
which uses the [shared source/caller comparison](impact-analysis.md#source-and-caller-comparison)
inside its existing assessment/history. Reuse current findings and reassess stale
evidence; no compulsory standalone impact run or second assessment is required.

```text
/maintain-test local .harness/sources/orders.json on qa
/maintain-test suite 4521 plan 4500 on qa
/maintain-test cases 701,702 from <run-or-report> on qa
```

## Choose the requested outcome

State the outcome in ordinary language when requesting maintenance. Both outcomes
use this skill and the same consumer-owned assessment/history; they are not separate
commands, flags or persistence formats. The agent uses the request and authorized
context to determine where to stop.

| Outcome | Result |
| --- | --- |
| **Diagnose only** | An assessment of supported causes/hypotheses, evidence, uncertainty and recommended next checks/actions. Stop before repairs, candidate registration, blocked-work resumption, repair verification, tracker transitions or downstream handoffs. |
| **Diagnose and fix** | The same diagnosis followed by supported automation repair or workflow resumption, independent review and the existing verification gates. An application/environment cause may require its responsible owner rather than a test-code change. |

For diagnosis without repairs:

```text
Use maintain-test to diagnose only CASE-701 from <run-or-report> on qa.
Return supported causes, evidence, uncertainty and next actions. Do not apply repairs.
```

Diagnosis only can include authorized bounded diagnostic checks. To restrict it to
existing artifacts, add:

```text
Review existing evidence only; do not run tests or experiments.
```

For diagnosis followed by a supported fix:

```text
Use maintain-test to diagnose and fix CASE-701 from <run-or-report> on qa.
Diagnose first, apply a supported automation repair and complete normal review and verification.
```

Record the requested outcome and execution restrictions in the same assessment.
An evidence-only request still permits that assessment record; it does not authorize
runtime execution. When a check cannot be run, label it proposed/unperformed.
Diagnosis does not mark automation repaired, verified or done. Diagnostic passes
award no verification greens; repairs still require fresh independent review and
two fresh scoped green processes after the final repair, within the same limits.

## Assessment record

Create sanitized Markdown under
`.harness/state/maintenance/<source-id>/<assessment-id>.md` in the consumer. Choose
a fresh assessment ID and preserve prior files. A report is an audit record, not a
verifier receipt. Include these facts, with `unknown` and a next action where missing:

| Section | Required content |
| --- | --- |
| Scope | Case/scenario IDs; source file/ADO identity; executed/current revisions or fingerprints; consumer commit and relevant uncommitted changes; environment and known application build; saved stage and generated spec, if any |
| Evidence | Run IDs, trace/report/assertion/cleanup paths; each diagnostic attempt and outcome; freshness and gaps. Link artifacts instead of copying secrets or payloads |
| Experiments, when needed | Baseline, competing hypotheses/predictions, one controlled factor, controls, disconfirming check, existing limits/consumption, actual observations and comparison limits; follow the [controlled-experiment reference](../.agents/skills/maintain-test/references/controlled-experiments.md) |
| Diagnosis | Supported classification and causal evidence; mixed causes, confidence, impact, residual risk and next owner/action. Intermittency does not establish its root cause |
| Source and caller impact | Old/new action and expectation, accepted revision reference, spec, page/service method, locator/data dependency, other callers/affected cases, and scoped regression selection |
| Blockers | One row per blocker: reason, evidence, unblock condition, current verified observation, unresolved/resolved disposition, next action and known owner |
| Resolution | Diagnosed repair or external fix, accepted expectation, resumption stage, prior repair count, new candidate/review/verification IDs, tracker transition and remaining action |

Retain source snapshots and all attempts, including irreproducible failures.
Diagnostics never award generation greens. Before replay, reconcile uncertain
mutations, data collisions and required cleanup through the owning runtime.
Stop when a bounded investigation cannot establish a cause.

An acceptance artifact identifies the actual owner decision, accepted revision,
old/new expectation and affected scope. An application-change artifact identifies
the observed build/fix and retest evidence against unchanged expectations. Hashing
the file establishes which artifact was reviewed; it does not prove the decision
or classify the root cause. Independent review checks those meanings.

## Intermittent failures and CI investigations

Requests such as **"Why does this test sometimes fail in CI?"** continue to use
`maintain-test`, with the same source identity, assessment files and retained history.
Use its [controlled-experiment guidance](../.agents/skills/maintain-test/references/controlled-experiments.md)
to select the smallest discriminating check within existing investigation limits.
Read exact CI/native evidence before experimenting; a job label or empty report is
not a case result. Record first attempts, retries and launch transitions separately,
applying the existing [comparable-evidence rules](../.agents/skills/bug-report/references/playbook.md#confirmation-and-evidence).

For example, a pass after changing both build and fixture leaves cause unresolved;
record those changed inputs and a single-factor next check. A primary assertion
failure followed by a cleanup failure retains both events and their separate roles.
Neither example erases the first failure or authorizes changing an expectation.

Experiments are diagnostic attempts, not generation verification. New assessments
inherit recorded attempt/time consumption and repair history; exhausted limits do
not restart. At the bound, record uncertainty and a concrete next action/owner.
Repairs retain independent review and two fresh scoped green processes after the
final repair; those greens satisfy acceptance, not a statistical stability claim.

## Blocked-case recovery

| Blocker | Required evidence | Resume route |
| --- | --- | --- |
| Application defect | Claimed fix is available in the selected environment; retest addresses the original expectation | Existing candidate: `application-change`, review and verify. No candidate: continue observed execution/authoring |
| Environment/access | Readiness and the required target operation succeed for this case | Resume execution; failed/blocked generation candidates need an `environment` repair and fresh gates |
| Missing fixture/collection | Required case data/operation exists and is usable; imported libraries remain derive-only | Continue refinement, execution or authoring where interrupted |
| Unclear/changed requirement | Responsible owner explicitly accepted the expectation/revision | Compare impact; use accepted-source revision if generation history exists |
| Exhausted budget | Owner decides the next action within the existing contract | Stay blocked while the gate refuses another round; never reset history or rename the source |
| Multiple/stale/unknown blockers | Fresh evidence verifies every prerequisite needed for resumption | Partial recovery remains blocked; record the next action |

A case without a generated spec is valid maintenance input. Resume its saved stage;
do not invent a test command. Manual `readiness.ready: false` must be resolved before
dispatch. Frozen source/refinement changes require a fresh linked execution. Manual
reruns cannot erase earlier valid FAILs.

## Resume and verify

### Unchanged requirements

Read existing status and inspect the candidate/history before authoring:

```sh
npx --no pom-harness generate status --id <source-id>
```

Keep the candidate mapping from [CANDIDATE](PIPELINE.md#6-candidate). Test defects,
environment repairs and review findings retain `script-defect`, `environment` and
`review-findings`. An externally fixed application with unchanged requirements uses
`application-change`. Add these fields to the complete candidate JSON:

```json
{
  "repair": "application-change",
  "change": {
    "previousSourceFingerprint": "<current handoff fingerprint>",
    "artifact": ".harness/state/maintenance/orders/application-fix.md"
  }
}
```

The complete input still needs `config` and actual `tests` mapping objects. Read
the fingerprint from generation status or the last immutable history snapshot when
status is `NEEDS_REVIEW`. The artifact is a nonempty consumer-relative file. Create
a new artifact rather than changing one already bound to a candidate.

```sh
npx --no pom-harness generate candidate --id <source-id> --input .harness/state/candidate.json
npx --no pom-harness generate review --id <source-id> --input .harness/state/review.json
npx --no pom-harness generate verify --id <source-id>
npx --no pom-harness generate verify --id <source-id>
npx --no pom-harness generate status --id <source-id>
```

The review must come from a fresh independent reviewer under
[REVIEW](PIPELINE.md#7-review). Failed/interrupted candidates cannot be retried until
green. Register a supported change, reconcile effects and follow the existing gates.
Application revalidation consumes one of the same three cumulative rounds; original
failures and assertions remain intact.

### Accepted source revision

Retain the source ID and old snapshot. Observe the accepted new source through the
same runtimes. Start with the preparation input from [PREPARE](PIPELINE.md#4-prepare),
keeping `source`, `executions` and `bindings`, and replace `author` with `candidate`.
The candidate contains the complete revised `config`/`tests` mapping plus:

```json
{
  "repair": "requirement-change",
  "change": {
    "previousSourceFingerprint": "<handoff fingerprint before the revision>",
    "artifact": ".harness/state/maintenance/orders/accepted-revision.md"
  }
}
```

Source/case IDs retain identity. Changed, added or removed steps/cases require
explicit acceptance and caller-impact review. A new ID is not a budget reset.

```sh
npx --no pom-harness generate revise --id <existing-source-id> --input .harness/state/revise.json
```

`revise` reassesses evidence and atomically appends the changed handoff and candidate
to the same history. It requires a changed source, matching prior fingerprint and
acceptance artifact. Stale fingerprints, invalid mapping, missing evidence or
exhausted budget leave history unchanged. Old snapshots, candidates, reviews and
runs remain available. A source revision consumes one round even when the prior
handoff had no candidate, and requires fresh review and two new scoped greens.
The library equivalent is `reviseGeneration(roots, sourceId, handoff, candidate)`
in `scripts/lib/generation/index.mjs`.

If the source changes again, reassess the diff and acceptance rather than replaying
stale input. `requirement-change` is accepted only through `revise`; ordinary
candidate registration cannot replace the handoff. Acceptance evidence is bound
to the candidate and checked again before review/verification.

### Manual execution or no generation history

Use `execute status <exec> --readiness`, `execute resume <exec>` or
`execute next <exec> --rerun <scenario>` according to
[manual recovery](manual-execution.md#host-lifecycle-and-recovery). Regenerate the
report and preserve historical FAIL aggregation. If changed inputs or a new build
need a new execution, link both runs in the assessment. Durable automation follows
[automate-test](../.agents/skills/automate-test/SKILL.md). Only a source without
generation history starts with `generate prepare`.

## Tracker and delivery

For registered ADO cases, follow [plan-tracker](../.agents/skills/plan-tracker/SKILL.md)
to append status events referencing the assessment and actual verification evidence.
Statuses remain `todo`, `doing`, `done` and `blocked`; uncertainty belongs in the note.

- Unresolved blockers stay `blocked`, including partial recovery and exhausted budgets.
- Verified prerequisites plus resumed work permit `doing`, never `done` on unblocking alone.
- `done` requires current automation acceptance, including review and two greens.
  A manual PASS alone does not meet that condition.
- Preserve manual/non-automatable rulings and newer team decisions.

Legacy `tracker --sync` reads `_verify-state.json` only: preview with `--dry-run`
before applying. Neutral generation uses an explicit append-only event based on
`generate status` and its receipts; do not manufacture a legacy verify-state file.
Regenerate the tracker and read its summary. Local sources without a plan retain
their maintenance report and generation history. External bug/result delivery
requires separate authorization through the existing ADO workflow.
