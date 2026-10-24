# Controlled experiments within maintenance

Use this reference from [maintain-test](../SKILL.md) when intermittent failures or
CI evidence need discrimination between plausible causes. It extends the existing
[assessment](../../../../docs/maintenance.md#assessment-record), not the skill list,
commands, diagnosis store or repair gates. Reuse adequate current evidence before
running another diagnostic. A deterministic or unsupported failure need not be
called flaky because the request uses that word.

## Bind evidence and limits

Resolve the selected case/source and revision, parameter set, project/browser,
consumer commit and relevant uncommitted changes, application build, environment,
configuration and fixture. Retain run/job/shard identities, artifact timestamps,
duration and failure signatures where available. Matching case IDs alone do not
make parameterized or project-specific observations interchangeable. Select evidence
for the requested case; co-location in a capture does not select other histories.
Use the [shared source/caller comparison](../../../../docs/impact-analysis.md#source-and-caller-comparison)
for changed requirements, callers or comparison inputs, in this same assessment.

For CI, bind the exact run, job and commit to populated native results and inspect
shard completeness. Follow the first actionable failure through its trace/assertion
and runtime evidence. Distinguish provider/image/setup/access failures before tests
from an observed case failure. Empty, stale or missing results and a green job label
cannot establish a current passing test. Keep the primary failure and subsequent
cleanup/reporting errors separately; a cleanup error does not replace the original.

Read retained assessments and generation/manual history before planning replay.
Record the existing investigation scope, attempt/time bound and consumption, plus
the cumulative repair count. If no investigation bound exists, establish a small
case-scoped attempt/time limit before the first experiment, accounting for prior
attempts. Unknown prior consumption is not zero. Read-only artifact review can
continue while the remaining execution allowance is unresolved.

A new experiment, assessment, run or source ID cannot restart exhausted limits.
At the recorded bound, stop experiments, retain uncertainty and name the next
information/action and owner. Follow existing blocked/budget rules for any owner
decision; no new investigation or repair gate is introduced here. Before allowed
replay, reconcile uncertain effects, resource ownership, collisions and cleanup
through the configured runtime. Its authority and failed-candidate restrictions apply.

## Account for observations

Apply the single canonical [comparable-attempt, denominator and cohort rules](../../bug-report/references/playbook.md#confirmation-and-evidence).
Use those rules for eligibility; do not create another rate definition here.
In the existing assessment:

- Retain first attempts, retries and every diagnostic attempt with identities,
  conditions, durations and signatures. Keep a recovered retry beside its original
  failure. Do not replace the failure with the final launch status.
- Distinguish within-launch retry recovery from transitions between launches.
  State which attempt/status defines a transition and retain the paired launch IDs.
- For any observed X/N, name the eligible unit/set, selection and conditions.
  Keep historical launches, failures-only reruns and controlled contrasts visibly
  separate; selected diagnostic counts are not a pooled historical failure rate.
  Leave unavailable denominators unknown and identify incomplete shard evidence.
- A deliberately changed factor supports a labeled diagnostic contrast. It does
  not make those observations eligible for a combined historical cohort or accept
  changed requirements. Reassess stale inputs without erasing history.

## Choose the smallest discriminating check

Use competing hypotheses supported by the evidence, including contradictory facts.
For the next useful check, record these facts in the same assessment; a compact table
is sufficient and no additional state schema or experiment runner is required:

| Fact | Record |
| --- | --- |
| Baseline | Exact selected source/test, conditions, observed failure and evidence reference. |
| Hypotheses | Suspected cause and plausible alternatives; supporting and contradictory observations. |
| Prediction | What each hypothesis predicts and an observation that could disprove the suspected cause. |
| Controlled check | One suspected factor to change; conditions held constant, scope, runtime authority and remaining attempt/time allowance. |
| Observation | Actual result/receipt, signature and duration when executed. Label proposed or unperformed checks explicitly; do not invent an outcome. |
| Interpretation | Which hypotheses gained/lost support, confounding or missing evidence, confidence, impact and residual risk. |
| Next action | Stop/continue within the existing bound, request specific evidence, or recommend the owning repair/external action. |

Change one suspected factor at a time. Useful contrasts can involve order,
parallelism, readiness, shared state/data, clock/randomness, dependency behavior
or cleanup. Keep the other relevant inputs fixed and record anything that could not
be held constant. Changing build, fixtures and execution mode together cannot isolate
which factor mattered. A run-alone pass is one observation, not a categorical cause.
Prefer a check that can reject a hypothesis over repetitions that merely seek a pass.
Do not add sleeps, broad timeouts, retries, assertion changes or quarantine as a
substitute for causal evidence.

For example, to distinguish ordering from resource collision, retain order/workers
while varying only owned resource identity, or retain the resource while varying
only order. If both change, record a confounded comparison and choose a smaller
contrast. For a readiness hypothesis, use a source-supported readiness observable;
record what a failure after that observable would mean. A later pass alone does not
verify the hypothesis or establish statistical stability.

## Classify and continue the existing workflow

Use maintenance's existing classifications, including mixed causes and
unknown/needs-investigation. Distinguish evidence for a mechanism from an unproven
deeper cause. Report confidence and residual risk against the selected conditions;
do not infer test/framework fault from intermittency alone or accept new behavior
from an observed build change. Inconclusive evidence at the bound remains inconclusive.

Supported automation repair continues the same source/history and three cumulative
repair rounds, with independent framework review and two fresh scoped green
processes after the final repair. Diagnostics award no greens and cannot bypass
failed-candidate restrictions. The two greens meet the existing acceptance gate;
they are not proof of statistical stability. Further stability experiments, if
requested, remain bounded diagnostics rather than another completion requirement.

A supported product-defect diagnosis may go to [bug-report](../../bug-report/SKILL.md),
preserving attempt provenance and uncertainty. A proposed handoff does not file a
bug or authorize publication. Preserve existing execution results and tracker rules;
do not introduce muting, quarantine, scheduling or a parallel maintenance workflow.
