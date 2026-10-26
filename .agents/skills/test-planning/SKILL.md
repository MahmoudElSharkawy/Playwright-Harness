---
name: test-planning
description: Plan a testing cycle's objectives, scope, risk priorities, strategy, prerequisites, effort and measurable entry, exit, suspension and resumption criteria from selected sources. Use for planning decisions, not individual case design, progress tracking, execution or repairs.
---

# Test planning

Resolve this linked skill to its real package path and read [ROOTS](../ROOTS.md).
The host prepares a source-grounded plan using the [playbook](references/playbook.md)
and [template](assets/test-plan-template.md). The consumer owns the resulting
Markdown and its history; package assets remain unchanged.

## Select the requested outcome

Use this skill when the user wants a testing cycle's scope, priorities, strategy,
feasibility or criteria. Accept selected local documents, requirement inventories,
exact work items, existing cases and a previous plan; no tracker is required.
Resolve known sources and constraints from the request and authorized context.
Ask only for essential missing choices; useful partial planning can proceed with
explicit unknowns. Co-located material does not expand the selected scope.

- Design/create/revise individual cases: [test-case-design](../test-case-design/SKILL.md).
- Record actual automation progress: [plan-tracker](../plan-tracker/SKILL.md).
- Execute cases or generate automation: [execute-test](../execute-test/SKILL.md) or
  [automate-test](../automate-test/SKILL.md).
- Diagnose, repair or recover blocked tests: [maintain-test](../maintain-test/SKILL.md).
- Identify affected areas/regression scope for a change only:
  [impact-analysis](../impact-analysis/SKILL.md).

For routing-only questions, return owners and next actions without creating a plan
or analyzing other supplied histories. A single test request does not acquire a
compulsory planning step. A plan is optional input to the other workflows, not
execution authority or a replacement for their gates.

## Build the plan

1. Bind plan/cycle identity and version to selected source identities, revisions
   and located acceptance evidence, known build/environment and prior baseline.
   Reuse existing requirement/case IDs; link stable risk/criterion IDs to them.
   Keep accepted facts separate from proposals, assumptions and missing evidence.
2. State objectives, in/out scope and exclusion rationale. Map material risks to
   likelihood/impact rationale, accepted requirements and existing/proposed coverage.
   Choose suitable test levels/layers/types, techniques, regression depth and cadence.
   Distinguish planned work, current designed coverage and compatible executed evidence.
3. Make feasibility visible: sequence activities and dependencies, owners or ownership
   gaps, capacity/skills, data/access/environment/observability and evidence-retention
   needs. Separate person-effort from elapsed time; ground ranges and contingency in
   an explicit basis. Unknown capacity or history is not a precise commitment.
4. Define entry, exit, suspension and resumption criteria through the single
   [baseline and criteria contract](../../../docs/test-planning.md#baseline-and-criteria-contract).
   Missing targets, populations, windows or owners remain decisions; never invent SLOs.
   Readiness prerequisites are not passing test outcomes.
5. Present one compact plan with unresolved decisions and next owners/actions. Record
   acceptance only from an actual authorized decision bound to this version/content.
   Preserve older versions. Reordering preserves identities; changed sources or
   constraints expose affected decisions and the review needed for the new baseline.

For a changed baseline, reuse the
[shared source/caller comparison](../../../docs/impact-analysis.md#source-and-caller-comparison)
to identify affected scope, estimates, risks and criteria within this plan. Reuse
current impact findings when suitable; do not create a compulsory standalone
impact assessment or duplicate technical caller analysis. Deferred gap-analysis
work is not a prerequisite or another coverage authority.

## Save and hand off

Save a sanitized plan under the consumer's
`.harness/runs/test-planning/<plan-id>/<version>.md`; choose a fresh version file
and link the previous baseline rather than overwriting it. Show the compact plan,
material limitations and artifact location to the user.

Carry accepted scope/exclusions, plan/source versions, risk/criterion IDs, evidence
pointers and unresolved decisions to a separately requested downstream workflow.
An accepted equivalent consumer plan can supply the same contract; this template
or prior invocation of this skill is not mandatory.

Planning writes only the requested plan artifact. It executes no tests, creates no
cases, changes no sources, tracker or generation state, publishes nothing and books
no resources or schedules. Plan approval does not accept unstated product behavior,
authorize a handoff, clear blockers or replace independent review, two scoped greens
or cumulative repair/replay limits. Planned coverage never establishes a passing result.
