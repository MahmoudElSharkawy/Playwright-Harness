---
name: maintain-test
description: Diagnose and maintain failed, flaky, changed or blocked tests using existing execution, generation and tracker workflows. Reassess blockers, preserve failure history and repair budgets, and verify repairs against accepted requirements.
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
generated test. Investigate selected cases and resume their owning workflow.

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
2. Compare the executed source with the current source and accepted requirements.
   Keep the old snapshot; fetching a new ADO revision or observing changed behavior
   does not accept a new expectation. Map each affected step/expectation to its
   spec, page/service methods, locators and data, then search their callers. Record
   affected cases and verification scope before changing shared behavior.
3. Inspect traces, assertions, runtime failures, data ownership and cleanup. Where
   needed, reproduce through configured browser/API/DB runtimes or scoped existing
   tests, within their replay and effect-reconciliation rules. Preserve every
   diagnostic attempt. Diagnostics never count as generation greens and cannot
   bypass the failed-candidate rerun gate. Define a bounded investigation and stop
   when evidence or repair budget is exhausted.
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

For cases in an existing plan registry, follow [plan-tracker](../plan-tracker/SKILL.md)
to append evidence-backed transitions and regenerate the report. Unresolved blockers
stay `blocked`; resumed work is `doing`; `done` requires the existing automation
completion gate. A manual PASS alone cannot mark automation done. Neutral generation
does not use the legacy `_verify-state.json` sync: record a history event from its
verified status. Preserve non-automatable rulings. Local cases without a plan keep
their assessment and generation history without inventing an ADO plan.

Report unresolved items candidly. External bug filing/result publication still
requires its own authorization. Do not introduce quarantine or scheduled monitoring.
