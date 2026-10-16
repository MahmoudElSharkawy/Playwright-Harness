import {data, fingerprint, frozen, id, keys, requireThat, unique} from '../execution-core/data.mjs';
import {assessRun} from '../execution-core/index.mjs';
import {caseNotes} from '../reporting/case-notes.mjs';
const ASSESSMENTS = new WeakSet();

/** Reporting may inventory an incomplete draft; generation still requires validateLocalSource. */
export function reportSource(input) {
  const source = data(input, 2 * 1024 * 1024, {maxNodes: 200000});
  const text = value => typeof value === 'string' && value.trim();
  keys(source, ['version', 'id', 'title', 'scenarios'], 'report source'); id(source.id);
  requireThat(source.version === 1 && text(source.title) && Array.isArray(source.scenarios) && source.scenarios.length > 0 && source.scenarios.length <= 500, 'Report source needs a known case inventory.');
  unique(source.scenarios.map(row => row.id), 'report source cases');
  for (const scenario of source.scenarios) {
    keys(scenario, ['id', 'title', 'steps', 'externalReferences'], 'report source case'); id(scenario.id);
    requireThat(text(scenario.title) && Array.isArray(scenario.steps) && scenario.steps.length <= 1000, 'Report cases need titles and bounded source steps.');
    for (const step of scenario.steps) {
      keys(step, ['action', 'expected'], 'report source step');
      requireThat(typeof step.action === 'string' && Array.isArray(step.expected) && step.expected.every(value => typeof value === 'string'), 'Report source steps must retain textual actions and expectations.');
    }
    if (scenario.externalReferences !== undefined) {
      requireThat(Array.isArray(scenario.externalReferences), 'Report external references must be an array.');
      for (const ref of scenario.externalReferences) {keys(ref, ['system', 'id'], 'report external reference'); requireThat(text(ref.system) && text(ref.id), 'Report external references need a system and ID.');}
    }
  }
  return source;
}

function observationDetails(scenario) {
  const issueReasons = {'assertion-instability': 'Assertion instability was recorded.', 'contradictory-evidence': 'Contradictory evidence was recorded.', 'indeterminate-outcome': 'An indeterminate outcome was recorded.'};
  const failureReasons = {ASSERTION: 'An assertion failure was recorded.', POLICY: 'The execution policy refused an operation.', UNAVAILABLE: 'A required dependency or prerequisite was unavailable.',
    TIMEOUT: 'An operation timeout was recorded.', TRANSPORT: 'A connection or transport failure was recorded.', CANCELLED: 'Execution was cancelled.', EXECUTOR: 'The execution adapter failed.',
    NOT_SELECTED: 'An operation was not selected.', DEPENDENCY: 'An operation was skipped because its dependency was unavailable.'};
  const failures = [...new Set(scenario.attempts.map(attempt => attempt.failureClass).filter(value => value !== 'NONE'))];
  const pending = [...new Set(scenario.resources.filter(resource => ['cleanup', 'restore'].includes(resource.lifecycle.action) && resource.lifecycle.status !== 'completed')
    .map(resource => resource.lifecycle.action === 'restore' ? 'restoration' : 'cleanup'))];
  const uncertainEffect = scenario.attempts.some(attempt => attempt.effect.certainty === 'uncertain');
  const reasons = [...scenario.issues.map(issue => issueReasons[issue]), ...failures.map(failure => failureReasons[failure])];
  for (const [count, label] of [[scenario.counts.failed, 'Failed expectations'], [scenario.counts.indeterminate, 'Indeterminate expectations'], [scenario.counts.notEvaluated, 'Unevaluated expectations']]) if (count) reasons.push(`${label}: ${count}.`);
  if (uncertainEffect) reasons.push('An uncertain operation effect was recorded.');
  for (const action of pending) reasons.push(`Required ${action} is incomplete.`);
  if (scenario.status !== 'PASS' && !scenario.issues.length && !failures.length && !pending.length && !uncertainEffect) reasons.push('The cause of the recorded exploration outcome is unknown; investigation is required.');
  const reason = scenario.reason ?? (reasons.length ? reasons.join(' ') : 'Exploration passed; no automated test has been recorded for this case.');
  let nextAction = scenario.status === 'PASS' ? 'Create and independently review the automated test, then complete scoped verification.'
    : scenario.status === 'SKIPPED' ? 'Review the recorded selection or dependency and resume exploration before generation.'
      : scenario.status === 'BLOCKED' && failures.some(value => ['UNAVAILABLE', 'DEPENDENCY'].includes(value)) ? 'Restore the unavailable dependency or prerequisite and resume exploration.'
        : scenario.status === 'BLOCKED' && failures.includes('POLICY') ? 'Resolve the recorded execution policy restriction before resuming exploration.'
          : scenario.status === 'FAIL' ? 'Investigate the recorded failed expectations and resolve their cause before generation.'
            : 'Investigate the recorded cause and review the evidence before resuming exploration or generation.';
  if (pending.length) nextAction += ` Complete and verify the recorded ${pending.join(' and ')} before resuming.`;
  return {reason, nextAction};
}

/** Reassess all execution statuses for reporting only; never relax generation gates. */
export function createReportingAssessment(sourceInput, executions, bindingsInput) {
  const source = reportSource(sourceInput), bindings = data(bindingsInput);
  requireThat(Array.isArray(executions) && executions.length > 0, 'Reporting observations need assessed execution.');
  const runs = executions.map(({run, roots, observations}) => ({run, result: assessRun(run, roots, observations)}));
  unique(runs.map(({run}) => run.id), 'reporting observed runs');
  requireThat(Array.isArray(bindings) && bindings.length === source.scenarios.length, 'Bind every observed source case exactly once.');
  unique(bindings.map(row => row.sourceScenarioId), 'reporting source bindings');
  unique(bindings.map(row => fingerprint([row.runId, row.scenarioId])), 'reporting execution bindings');
  const cases = bindings.map(binding => {
    keys(binding, ['sourceScenarioId', 'runId', 'scenarioId'], 'reporting case binding');
    for (const name of ['sourceScenarioId', 'runId', 'scenarioId']) id(binding[name]);
    const observed = runs.find(({run}) => run.id === binding.runId), scenario = observed?.result.scenarios.find(row => row.id === binding.scenarioId);
    requireThat(source.scenarios.some(row => row.id === binding.sourceScenarioId) && scenario, 'Reporting case binding needs a known source case and assessed execution case.');
    return {id: binding.sourceScenarioId, runId: observed.run.id, scenarioId: scenario.id, inputFingerprint: observed.run.inputFingerprint,
      environment: observed.run.inputs.environment.name, status: scenario.status, stability: scenario.stability, counts: scenario.counts, issues: scenario.issues,
      ...observationDetails(scenario),
      ...(scenario.requiredLifecycleComplete === undefined ? {} : {requiredLifecycleComplete: scenario.requiredLifecycleComplete})};
  });
  const content = data({version: 1, source, cases}), assessment = frozen({...content, fingerprint: fingerprint(content)});
  ASSESSMENTS.add(assessment); return assessment;
}

/** Only for previously hash-validated history; new observations require a live assessment. */
export function validateReportingObserved(source, input) {
  const {fingerprint: claimed, ...content} = data(input);
  keys(content, ['version', 'source', 'cases'], 'reporting observations');
  requireThat(content.version === 1 && fingerprint(content) === claimed, 'Reporting observation integrity mismatch.');
  reportSource(content.source);
  requireThat(content.source.scenarios.every(row => source.scenarios.some(original => original.id === row.id && fingerprint(original) === fingerprint(row))), 'Observed cases must be exact members of the requested source.');
  requireThat(Array.isArray(content.cases) && content.cases.length === content.source.scenarios.length, 'Reporting observations must retain every bound source case.');
  unique(content.cases.map(row => row.id), 'reporting observed cases');
  unique(content.cases.map(row => fingerprint([row.runId, row.scenarioId])), 'reporting execution bindings');
  for (const row of content.cases) {
    keys(row, ['id', 'runId', 'scenarioId', 'inputFingerprint', 'environment', 'status', 'stability', 'counts', 'issues', 'reason', 'nextAction', 'requiredLifecycleComplete'], 'reporting observed case');
    requireThat(content.source.scenarios.some(scenario => scenario.id === row.id) && ['PASS', 'FAIL', 'BLOCKED', 'SKIPPED', 'NEEDS_REVIEW'].includes(row.status), 'Unknown reporting observed case or status.');
  }
  return {...content, fingerprint: claimed};
}

/** Original scope is an explicit association, never an inferred superset or a verdict. */
export function reportingContext(selected, input, trustedContext) {
  const context = data(input, 2 * 1024 * 1024, {maxNodes: 200000});
  keys(context, ['source', 'notes', 'observed', 'sourceFingerprint', 'selectedSourceFingerprint'], 'generation reporting context');
  const source = reportSource(context.source), sourceFingerprint = fingerprint(source), selectedSourceFingerprint = fingerprint(selected);
  requireThat(context.sourceFingerprint === undefined || context.sourceFingerprint === sourceFingerprint, 'Requested source fingerprint changed.');
  requireThat(context.selectedSourceFingerprint === undefined || context.selectedSourceFingerprint === selectedSourceFingerprint, 'Selected source fingerprint changed.');
  requireThat(selected.scenarios.every(row => source.scenarios.some(original => original.id === row.id && fingerprint(original) === fingerprint(row))), 'Selected cases must be exact members of the requested source.');
  let observed;
  if (context.observed !== undefined) {
    if (!trustedContext?.observed || fingerprint(context.observed) !== fingerprint(trustedContext.observed)) requireThat(ASSESSMENTS.has(input.observed), 'Create reporting observations by assessing execution, not by importing a claimed verdict.');
    observed = validateReportingObserved(source, context.observed);
  }
  if (trustedContext?.observed || observed) {
    const previous = trustedContext?.observed && validateReportingObserved(trustedContext.source, trustedContext.observed);
    const replaced = new Set(observed?.cases.map(row => row.id) ?? []);
    requireThat((previous?.source.scenarios ?? []).filter(row => !replaced.has(row.id)).every(row => source.scenarios.some(original => original.id === row.id && fingerprint(original) === fingerprint(row))), 'Retained observed cases must be exact members of the requested source.');
    const cases = new Map([...(previous?.cases ?? []), ...(observed?.cases ?? [])].map(row => [row.id, row]));
    const scenarios = source.scenarios.filter(row => cases.has(row.id));
    const content = data({version: 1, source: {...source, scenarios}, cases: scenarios.map(row => cases.get(row.id))});
    observed = validateReportingObserved(source, {...content, fingerprint: fingerprint(content)});
  }
  caseNotes(source, context.notes, [...selected.scenarios, ...(observed?.source.scenarios ?? [])].map(row => row.id));
  return {source, sourceFingerprint, selectedSourceFingerprint, ...(context.notes === undefined ? {} : {notes: context.notes}), ...(observed === undefined ? {} : {observed})};
}
