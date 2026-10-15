import {mkdirSync, writeFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fixture} from './execution-core.mjs';
import {fingerprint} from '../../scripts/lib/execution-core/data.mjs';
import {createGenerationHandoff, sourceExpectations, beginGeneration, registerCandidate, recordGenerationReview} from '../../scripts/lib/generation/index.mjs';
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
export async function prepared(t) {
  const f = fixture(t), input = source();
  put(f.roots.projectRoot, 'playwright.config.mjs', 'export default {};');
  put(f.roots.projectRoot, 'tests/ObservationTests.spec.ts', '// Synthetic report-contract candidate.');
  const key = sourceExpectations(input)[0].key;
  await beginGeneration(f.roots, createGenerationHandoff(input, [{run: f.run, roots: f.roots, observations: f.report}], [{key, runId: f.run.id, scenarioId: 'case-1', expectationId: 'visible'}]), 'report-author');
  const candidate = await registerCandidate(f.roots, input.id, {config: 'playwright.config.mjs', tests: [{scenarioId: 'source-case', spec: 'tests/ObservationTests.spec.ts', project: 'report', titlePath: ['Observation'], mapping: [{step: 1, actions: ['ObservationPage.read'], expectations: [{key, validations: ['ObservationPage.verify']}]}]}]});
  put(f.roots.projectRoot, '.harness/state/review.md', 'Synthetic report-contract approval; no independent task review claimed.');
  await recordGenerationReview(f.roots, input.id, {revision: candidate.revision, reviewer: 'report-reviewer', verdict: 'APPROVE', findings: [], artifact: '.harness/state/review.md'});
  return {...f, source: input, candidate};
}

export async function recorded(f, status = 'FAIL', runId = 'verify-report', resultPatch = {}) {
  // Synthetic native receipt exercises presentation/integrity; real native failure is tested separately.
  const path = `.harness/state/generation/${f.source.id}/${runId}/execution.json`;
  const receipt = {version: 2, invocation: runId, tests: [{...f.candidate.tests[0], results: [{status: status === 'PASS' ? 'passed' : 'failed', retry: 0, errors: status === 'PASS' ? 0 : 1, assertions: {passed: 1, failed: status === 'PASS' ? 0 : 1}, skippedSteps: 0, failedChecks: status === 'PASS' ? [] : ['toBe']}]}]};
  Object.assign(receipt.tests[0].results[0], resultPatch);
  put(f.roots.projectRoot, path, receipt);
  await transaction(f.roots, f.source.id, (state, save) => {state.runs.push({id: runId, revision: f.candidate.revision, gate: 'case-assertions', status, failureClass: 'ASSERTION_COVERAGE', reason: 'A case assertion failed.', receipt: {path, fingerprint: fingerprint(receipt)}}); save(state);});
  return {path, receipt};
}

