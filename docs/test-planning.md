# Plan a testing cycle

See [tracker providers](tracker-providers.md) for shared Azure/Jira selection,
Xray/Zephyr Scale capabilities, and local cases without a plugin. The same source, review and readiness rules apply to every selected mode.

Use [test-planning](../.agents/skills/test-planning/SKILL.md) to decide a cycle's
objectives, selected scope, risk priorities, strategy, feasibility and measurable
criteria. It accepts local sources and existing evidence without a tracker. Plans
are consumer-owned Markdown under
`.harness/runs/test-planning/<plan-id>/<version>.md`; previous versions remain intact.

Ask in ordinary language, or invoke the host skill with the selected sources:

```text
Plan a two-day checkout testing cycle from <requirements> and <existing cases>.
Use the supplied browser matrix, capacity and risk decisions; identify missing evidence.

Use test-planning for the accepted API revision in <source>.
Plan contract, migration and data-integrity coverage with effort ranges and measurable criteria.

Revise <existing plan> for the selected source change and shorter timebox.
Preserve its identities and prior baseline, and show which decisions need review.
```

Planning is optional. Designing or executing an individual test does not require a
new planning ceremony. The result is one compact plan and unresolved decisions;
unknown readiness, capacity or targets permit a useful partial draft rather than
invented commitments. The [playbook](../.agents/skills/test-planning/references/playbook.md)
owns the procedure; the [template](../.agents/skills/test-planning/assets/test-plan-template.md)
is a reusable starting format, not a required storage schema.

## Baseline and criteria contract

This is the shared meaning of a planning baseline and its criteria. A later
completion review can use this contract from the named plan or an equivalent
accepted consumer plan; invoking this skill or migrating an existing plan into its
template is not a prerequisite. This feature does not implement cycle completion.

| Baseline fact | Meaning |
| --- | --- |
| Identity and version | Stable plan/cycle identity, this version and artifact reference; distinguish it from any ADO/test-management plan ID. Link the previous version. |
| Source and conditions | Selected requirement/case identities, revisions/fingerprints, readable locations and acceptance basis; build, environment/configuration and required cohorts where known. Missing/stale evidence remains explicit. |
| Selected scope | Objectives, included coverage and exclusions with rationale/decision status; distinguish the cycle from wider project scope and retain proposed reductions visibly. |
| Risks and criteria | Stable IDs with explicit requirement/risk/scope parent links. Reordering preserves identity; a revised meaning is bound to its plan version with old/new lineage. |
| Decision basis | Draft, accepted or needs-review with the actual authorized decision, owner, content/scope and version it covers. A generated file or planning request alone proves no acceptance. |
| Handoff | Scope/exclusions, versioned source/plan references, risk/criterion IDs, evidence locations and remaining owners/actions. A handoff recommendation performs no downstream work. |

Define entry, exit, suspension and resumption criteria using these facts:

| Criterion fact | Required meaning |
| --- | --- |
| Identity / type / parents | Stable criterion ID, relevant plan version, one of the four types and links to selected scope, requirements or risks. |
| Condition / basis | Observable condition or threshold with its accepted or proposed source. An unmeasurable target stays a decision; no invented SLO or waiver. |
| Population | Applicable units/set and denominator where relevant; include accepted required browsers/platforms/roles and exclusions without counting duplicate references or retries as more coverage. Missing populations stay unknown. |
| Window / conditions | Applicable observation window and build/environment/cohort binding; incompatible or stale evidence cannot establish success. |
| Evidence | Intended source and required observation, with current supplied references where available. Planned and designed coverage are not executed outcomes. |
| Owner / gaps | Actual decision owner or unresolved ownership, missing facts and next action. Prerequisites/readiness remain separate from passing results. |

An equivalent accepted plan can supply these facts through located references; it
does not need identical headings or new fields in case/tracker records. Missing
approval, conditions or evidence remains a visible decision/unavailable basis,
not an invented passing criterion. The planning artifact defines criteria; it does
not evaluate them as a completed cycle.

Acceptance covers actual decisions and the relevant version/content. Changed
source, constraints or scope identify the affected decisions for review before the
old approval can be applied. Retain previous files and accepted facts; do not rename
a changed version to inherit acceptance or fabricate a new requirement expectation.
Reuse the [source/caller comparison](impact-analysis.md#source-and-caller-comparison)
for baseline changes and translate findings into plan revisions.

## Useful outcomes and boundaries

| Selected evidence | Useful planning outcome |
| --- | --- |
| Complete checkout requirements and two required browsers, but limited capacity | Prioritized risk-to-coverage strategy, explicit browser populations, effort/elapsed estimates with basis and a visible capacity shortfall or uncertainty. Reuse existing cases; proposed reductions await their actual decision. |
| Accepted API revision with a changed contract or migration dependency | Source-bound contract/data-integrity strategy, dependencies and evidence needs. Missing external-contract evidence remains a gap, not guessed compatibility. |
| No environment receipt, owner availability or measurable performance target | Partial draft with readiness, estimate and target decisions. Do not invent access, capacity, response-time thresholds or completion. |
| Same draft reordered, then an accepted source changes | Preserve risk/criterion IDs by meaning, save the new version, link prior baseline and expose affected decisions. The earlier approval does not silently cover changed scope or criteria. |

Planning estimates separate person-effort from elapsed time, with explicit basis,
range and contingency. A two-day timebox alone supplies no person-hour capacity.
Planned work, actual designed mappings and compatible executed evidence remain
separate views; risk suggestions do not count as accepted coverage or new cases.

| Requested work | Owner |
| --- | --- |
| Cycle objectives, scope, strategy, feasibility and criteria | This planning workflow |
| Individual cases, expectations and their review/publication | [Test case design](test-case-design.md); plan approval does not accept unstated behavior |
| Actual automation progress | [plan-tracker](../.agents/skills/plan-tracker/SKILL.md); a plan is not a tracker event |
| Changed areas and regression recommendations only | [Impact analysis](impact-analysis.md); planning reuses its comparison rather than duplicating caller analysis |
| Case execution, automation or repair | [Manual execution](manual-execution.md), [automation](PIPELINE.md) or [maintenance](maintenance.md), under their existing authority and gates |

Planning runs no tests or readiness probes, creates no cases, publishes nothing,
books no resources and updates no source, tracker or generation state. Intended
cadence is planning information, not scheduled automation. Runtime authority,
source acceptance, ownership/cleanup, cumulative repair limits, independent review
and two fresh scoped green processes remain authoritative. A plan or cycle
recommendation cannot make failed automation READY or erase prior failures.

Deferred broader gap analysis is optional future analysis, not a planning or design
prerequisite. Planning's scoped coverage view must not create another story-level
coverage authority. Future completion can evaluate this accepted baseline; no new
completion skill, report engine or automatic closure is added here.
