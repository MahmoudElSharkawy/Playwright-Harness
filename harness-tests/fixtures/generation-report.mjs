import {mkdirSync, writeFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fixture} from './execution-core.mjs';
import {fingerprint} from '../../scripts/lib/execution-core/data.mjs';
import {createGenerationHandoff, createReportingAssessment, sourceExpectations, beginGeneration, registerCandidate, recordGenerationReview} from '../../scripts/lib/generation/index.mjs';
import {transaction} from '../../scripts/lib/generation/storage.mjs';
import {generationBlocker} from '../../scripts/lib/generation/reasons.mjs';

export function productionBlockers() {
  const messages = ['No generated candidate.', 'Generation has not started.', 'Begin from a validated handoff.',
    'Resolve indeterminate execution and lifecycle obligations before generation.', 'Generation needs observed execution.',
    'Run snapshot differs from assessed inputs.', 'An intact independent approval is required.',
    'Consumer files changed; register and review a repair before verification.',
    'Three cumulative repair rounds maximum; classify a repair before continuing.', 'Native test collection failed.',
    'Native verification did not complete cleanly.', 'Native test failed or retried.', 'Case assertions were missing, failed or skipped.',
    'Execution changed files or exceeded its deadline.',
    'Repair/review the failed or interrupted candidate before another verification; no retry-to-green.',
    'Two independent green runs are already recorded.'];
  return [...messages.map(message => new Error(message)),
    ...['MAPPING_STEPS', 'MAPPING_KEYS', 'MAPPING_REFERENCES', 'MODULE_NOT_FOUND'].map(code => Object.assign(new Error('Synthetic report blocker'), {code})),
    new Error('Synthetic unknown blocker')].map(error => generationBlocker(error, 'VERIFY'));
}

export const source = (ids = ['source-case']) => ({version: 1, id: 'report-suite', title: 'Synthetic report source', scenarios: ids.map(id => ({id, title: id, steps: [{action: 'Read observation', expected: ['The expected observation is visible']}]}))});
export const put = (root, path, value) => {mkdirSync(dirname(join(root, path)), {recursive: true}); writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value));};
export function observed(t, input, {statuses = [], first} = {}) {
  const expectations = sourceExpectations(input);
  const executions = expectations.map((_, index) => index === 0 && first ? first : fixture(t, {id: `report-observation-${index + 1}`}));
  executions.forEach((execution, index) => {
    const status = statuses[index] ?? 'PASS';
    if (status === 'BLOCKED' || status === 'SKIPPED') {
      Object.assign(execution.scenario, {disposition: status.toLowerCase(), reason: status === 'BLOCKED' ? 'prerequisite-unavailable' : 'deferred-selection', attempts: [], resources: [], outputRefs: []});
      execution.report.evidence = [];
    } else if (status === 'NEEDS_REVIEW') execution.scenario.issues = ['indeterminate-outcome'];
    else {
      execution.current.assertions[0].status = status;
      if (status === 'FAIL') {execution.current.outcome = 'ASSERTION_FAILURE'; execution.current.failureClass = 'ASSERTION';}
    }
  });
  const assessed = executions.map(execution => ({run: execution.run, roots: execution.roots, observations: execution.report}));
  const assessment = createReportingAssessment(input, assessed, input.scenarios.map((scenario, index) => ({sourceScenarioId: scenario.id, runId: executions[index].run.id, scenarioId: 'case-1'})));
  const handoff = statuses.some(status => !['PASS', 'FAIL'].includes(status)) ? undefined : createGenerationHandoff(input, assessed, expectations.map(({key}, index) => ({key, runId: executions[index].run.id, scenarioId: 'case-1', expectationId: 'visible'})));
  return {handoff, assessment, executions};
}
export async function prepared(t, {source: input = source(), reporting} = {}) {
  const f = fixture(t), expectations = sourceExpectations(input);
  put(f.roots.projectRoot, 'playwright.config.mjs', 'export default {};');
  put(f.roots.projectRoot, 'tests/ObservationTests.spec.ts', '// Synthetic report-contract candidate.');
  const {handoff, executions} = observed(t, input, {first: f});
  await beginGeneration(f.roots, handoff, 'report-author', reporting);
  const candidate = await registerCandidate(f.roots, input.id, {config: 'playwright.config.mjs', tests: input.scenarios.map(scenario => ({scenarioId: scenario.id, spec: 'tests/ObservationTests.spec.ts', project: 'report', titlePath: ['Observation', scenario.id], mapping: scenario.steps.map((_, index) => ({step: index + 1, actions: ['ObservationPage.read'], expectations: expectations.filter(expected => expected.scenarioId === scenario.id && expected.step === index + 1).map(({key}) => ({key, validations: ['ObservationPage.verify']}))}))}))});
  put(f.roots.projectRoot, '.harness/state/review.md', 'Synthetic report-contract approval; no independent task review claimed.');
  await recordGenerationReview(f.roots, input.id, {revision: candidate.revision, reviewer: 'report-reviewer', verdict: 'APPROVE', findings: [], artifact: '.harness/state/review.md'});
  return {...f, source: input, candidate, handoff, executions};
}

export async function recorded(f, status = 'FAIL', runId = 'verify-report', resultPatch = {}) {
  // Synthetic native receipt exercises presentation/integrity; real native failure is tested separately.
  const path = `.harness/state/generation/${f.source.id}/${runId}/execution.json`;
  const receipt = {version: 2, invocation: runId, tests: f.candidate.tests.map((test, index) => ({...test, results: [{status: status === 'PASS' ? 'passed' : 'failed', retry: 0, errors: status === 'PASS' ? 0 : 1, assertions: {passed: 1, failed: status === 'PASS' ? 0 : 1}, skippedSteps: 0, failedChecks: status === 'PASS' ? [] : ['toBe'], ...(typeof resultPatch === 'function' ? resultPatch(test, index) : resultPatch)}]}))};
  put(f.roots.projectRoot, path, receipt);
  await transaction(f.roots, f.source.id, (state, save) => {state.runs.push({id: runId, revision: f.candidate.revision, gate: 'case-assertions', status, failureClass: 'ASSERTION_COVERAGE', reason: 'A case assertion failed.', receipt: {path, fingerprint: fingerprint(receipt)}}); save(state);});
  return {path, receipt};
}

