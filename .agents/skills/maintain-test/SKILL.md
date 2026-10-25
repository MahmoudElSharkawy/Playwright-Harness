---
name: maintain-test
description: Diagnose failed, flaky, changed or blocked tests. Support diagnose only (findings and next actions) and diagnose and fix (supported automation repair, review and verification), with bounded experiments, existing workflows and preserved history and budgets.
---

# Maintain tests

Resolve this skill to its real path and read [ROOTS](../ROOTS.md). Work in the
consumer, preserving its instructions and customizations. Accept existing case IDs,
source files, run IDs or failure reports, for example:

```text
/maintain-test suite <id> [plan <id>] on <environment>
/maintain-test story <id> on <environment>
/maintain-test local <source.json> on <environment>
/maintain-test cases <ids> from <run-or-report> on <environment>
```

Resolve requested cases from existing sources and history first. Confirm only missing
scope/environment information that cannot be inferred. A blocked case may have no
generated test. Investigate selected cases; resume their owning workflow when
repair or resumption is requested.

## Choose the requested outcome

Use the request and existing authorized context to choose the stopping point; these
phrases are ordinary request wording, not new commands or flags.

| Requested outcome | Work and stopping point |
| --- | --- |
| **Diagnose only** | Assess evidence, supported causes/hypotheses, uncertainty and next checks/actions in the existing assessment. Stop there; do not apply repairs, register candidates, resume blocked work or change tracker status. Recommendations do not start another workflow. |
| **Diagnose and fix** | Diagnose first, then repair supported automation defects or resume work through the existing owning workflow. Preserve accepted expectations, cumulative history/budgets, independent review and verification gates. |

Diagnosis only may include permitted bounded diagnostic checks. Honor narrower
requests such as **"Review existing evidence only; do not run tests or experiments."**
When execution is excluded or unavailable, propose the next check as unperformed.
See [usage examples](../../../docs/maintenance.md#choose-the-requested-outcome).

For impact-only requests to identify affected areas and recommend regression scope,
use [impact-analysis](../impact-analysis/SKILL.md). Route by requested outcome, not
by story/bug ID or the presence of failure evidence. Combined analysis-and-repair
requests stay here, with one maintenance assessment/history and the existing gates.
For routing-only questions, return owners and next actions without creating an
assessment or investigating co-located cases/history.

For direct requests to update original ADO case titles, actions, expected results
or step order, follow [case editing](../../../docs/ado-case-editing.md) first. That
workflow edits only selected source cases. Refetch with `--revisions` into a fresh
output folder; preserve old snapshots/failures and record accepted requirement
evidence before maintaining changed expectations. A source edit never verifies
automation or resets repair budgets.

## Assess before editing

1. Capture case/scenario IDs, source identity and revisions, consumer commit and
   relevant working-tree changes, environment/application build when available,
   prior run/evidence paths, current stage and tracker status. Read existing
   generation status/history and manual reports as applicable. Record missing or
   stale evidence explicitly. Create a fresh consumer-owned assessment following
   the [report contract](../../../docs/maintenance.md#assessment-record).
2. Apply the [shared source/caller comparison](../../../docs/impact-analysis.md#source-and-caller-comparison)
   to the executed/current source and accepted requirements. Keep the old snapshot;
   record affected steps/expectations, dependencies, callers and verification scope
   in this assessment before changing shared behavior. Reuse current impact findings
   and reassess stale evidence; no standalone impact run or second assessment is
   required. A new revision or observed behavior does not accept an expectation.
3. Inspect traces, assertions, runtime failures, data ownership and cleanup. Where
   needed, reproduce through configured browser/API/DB runtimes or scoped existing
   tests, within their replay and effect-reconciliation rules. Preserve every
   diagnostic attempt. Diagnostics never count as generation greens and cannot
   bypass the failed-candidate rerun gate. Define a bounded investigation and stop
   when evidence or repair budget is exhausted.
   For intermittent failures or CI investigations, use the maintenance-owned
   [controlled-experiment guidance](references/controlled-experiments.md). Reuse
   sufficient evidence; record hypotheses, controls, attempts and outcomes in this
   assessment/history, not a separate flaky-test workflow.
4. Classify with linked evidence: application defect, test/framework defect,
   intermittent behavior, environment/dependency problem, accepted requirement
   change, or unknown/needs-investigation. Record mixed causes separately.
   A single later pass does not establish a flake or erase a failure; intermittency
   alone does not identify whether the cause is the application or test.
   Insufficient evidence requires a next investigation action, not a guessed fix.

## Reassess blocked cases

For every blocker, retain its reason, evidence, exact unblock condition, current
observation and next action/owner when known. Verify all applicable conditions;
partial recovery leaves the case blocked. Apply the [recovery matrix](../../../docs/maintenance.md#blocked-case-recovery).

- Application defect: verify the claimed fix against the unchanged expectation.
  A closed bug or deployment alone is not a passing retest.
- Environment/access/fixture/collection: verify the prerequisite for the selected
  environment and case before resuming. Follow existing configuration and imported
  library ownership rules; never invent credentials or a replacement expectation.
- Requirement: wait for an explicitly accepted expectation and record its source.
- Exhausted repair budget: keep the case blocked and request an owner decision.
  No new source ID, deleted state or automatic budget reset can authorize another
  round. An owner decision does not itself bypass the existing generation gate.

When conditions are met, resume the saved stage. Cases without a spec return to
refinement, observed execution or authoring through the existing workflow. Clearing
a blocker is not evidence that a case passed or that automation is done.

## Repair and verify

Route edits through [pom-architecture](../pom-architecture/SKILL.md) and the owning
specialists. Repair diagnosed test/framework defects only. For genuine application
failures, preserve assertions and failure results; resume after evidence of an
external fix. Change expected outcomes only for an explicitly accepted revision.

Use the [existing command routes](../../../docs/maintenance.md#resume-and-verify):

- Existing generated automation: continue its source ID and cumulative history.
  Register the classified candidate, obtain fresh independent
  [framework review](../framework-review/SKILL.md), then require two independent
  scoped green processes after the final repair. Skips/flakes/retries are not greens.
- Accepted source change: reassess observations, map revised expectations and use
  `generate revise` with the prior source fingerprint and acceptance artifact.
  For an external application fix with unchanged requirements, register an
  `application-change` candidate with deployment/retest evidence. Both consume the
  existing repair budget. Artifacts record decisions/evidence; their mere presence
  does not authenticate acceptance or prove a fix.
- Manual execution: use [execute-test](../execute-test/SKILL.md) recovery commands.
  Preserve its historical FAIL aggregation. Changed frozen inputs require a new
  linked execution; a new run never deletes the previous report or failure.
- No generation history: use [automate-test](../automate-test/SKILL.md) when durable
  automation is requested. Do not create a replacement batch to evade existing history.

## Record the outcome

Record classification, source/caller impact, attempts, remaining blockers,
resolution and validation receipts. Retain earlier assessments; create a new file
when evidence changes, especially after an artifact has been bound to a candidate.

For diagnose only, save and return the assessment and recommendations here. Do not
perform the tracker transitions or downstream handoffs below; diagnosis does not
mark automation repaired, verified or done.

For cases in an existing plan registry, follow [plan-tracker](../plan-tracker/SKILL.md)
to append evidence-backed transitions and regenerate the report. Unresolved blockers
stay `blocked`; resumed work is `doing`; `done` requires the existing automation
completion gate. A manual PASS alone cannot mark automation done. Neutral generation
does not use the legacy `_verify-state.json` sync: record a history event from its
verified status. Preserve non-automatable rulings. Local cases without a plan keep
their assessment and generation history without inventing an ADO plan.

For a supported application-defect diagnosis or a user-described issue, use
[bug-report](../bug-report/SKILL.md) for the editable source-grounded draft,
project-specific fields and evidence review. Preserve this assessment, attempt
provenance and uncertainty. A suspected test/environment fault must not become a
confirmed product defect; any further reproduction stays within existing authority
and cumulative budgets.

Report unresolved items candidly. External bug filing/result publication still
requires its own authorization. Do not introduce quarantine or scheduled monitoring.
