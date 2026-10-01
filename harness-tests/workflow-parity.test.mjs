import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync, readFileSync, unlinkSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fixture} from './fixtures/execution-core.mjs';
import {createRun, assessRun} from '../scripts/lib/execution-core/index.mjs';
import {digest, fingerprint} from '../scripts/lib/execution-core/data.mjs';
import {createGenerationHandoff, sourceExpectations, beginGeneration, registerCandidate, recordGenerationReview} from '../scripts/lib/generation/index.mjs';
import {transaction} from '../scripts/lib/generation/storage.mjs';
import {reportView, renderJson, renderHtml, writeReports} from '../scripts/lib/reporting/index.mjs';
import {allureInventory} from '../scripts/lib/reporting/allure.mjs';
import {workflowNotes, workflowSemantics, compareWorkflows} from '../scripts/lib/workflow-parity.mjs';

const put = (root, path, value) => {mkdirSync(dirname(join(root, path)), {recursive: true}); writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value));};
const source = {version: 1, id: 'workflow', title: 'Synthetic contract fixture', scenarios: [{id: 'case-1', title: 'Observe', steps: [{action: 'Observe the fixture', expected: ['The observation matches']}]}]};
const key = sourceExpectations(source)[0].key;
const expected = {source, executionIds: ['observe'], generatedIds: ['case-1']};
function notes(handoff) {
  return {refinement: {version: 1, sourceFingerprint: fingerprint(source), scenarios: [{id: 'case-1', expectationKeys: [key], notes: 'Preserve the source assertion using the observed fixture.'}]},
    knowledge: {version: 1, sourceFingerprint: fingerprint(source), status: 'UNREVIEWED', facts: [{key, scenarioId: 'case-1', runId: 'run-1', evidenceIds: handoff.observations[0].evidence.map(e => e.id), assertionStatuses: ['PASS']}]}};
}
function handoff(f) {return createGenerationHandoff(source, [{run: f.run, roots: f.roots, observations: f.report}], [{key, runId: f.run.id, scenarioId: 'case-1', expectationId: 'visible'}]);}

// Synthetic protocol records exercise the assessor, not actual host/browser/report-generator integration.
async function completed(t, {businessValue = 'row-1', duration = 10} = {}) {
  const f = fixture(t), root = f.roots.projectRoot; f.current.outputs[0].value = businessValue; f.current.endedAt = f.current.startedAt + duration;
  const h = handoff(f), n = notes(h), result = f.assess();
  put(root, 'source.json', source); put(root, 'refinement.json', n.refinement); put(root, '.harness/knowledge-candidates/workflow.json', n.knowledge);
  put(root, '.harness/workflow/refinement-receipt.json', {version: 1, phase: 'BEFORE_EXPLORATION', sourceFingerprint: fingerprint(source), sha256: digest(readFileSync(join(root, 'refinement.json')))});
  put(root, 'playwright.config.mjs', '// Synthetic protocol fixture only'); put(root, 'tests/ObservationTests.spec.ts', '// Synthetic protocol fixture only');
  put(root, '.harness/workflow/exploration.json', [{id: 'observe', run: f.run, roots: f.roots, observations: f.report, result}]);
  assert.equal(writeReports(f.roots, result, {directory: 'reports/exploration/observe'}).status, 'WRITTEN');
  await beginGeneration(f.roots, h, 'fixture-author');
  const selected = {scenarioId: 'case-1', spec: 'tests/ObservationTests.spec.ts', project: 'proof', titlePath: ['Fixture', 'Observe']};
  const candidate = await registerCandidate(f.roots, source.id, {config: 'playwright.config.mjs', tests: [selected]});
  put(root, '.harness/state/review.md', 'Synthetic approval for contract tests only; not an independent review.');
  await recordGenerationReview(f.roots, source.id, {revision: candidate.revision, reviewer: 'fixture-reviewer', verdict: 'APPROVE', findings: [], artifact: '.harness/state/review.md'});
  for (let number = 0; number < 2; number++) {
    const invocation = `verify-${number}`, recordPath = `.harness/state/generation/${source.id}/${invocation}`;
    const native = {version: 1, invocation, status: 'passed', errors: 0, workers: 1, forbidOnly: true, tests: [{...selected, id: 'native', nativeFile: 'ObservationTests.spec.ts', expectedStatus: 'passed', retries: 0, repeatEachIndex: 0,
      results: [{status: 'passed', retry: 0, errors: 0, expectations: [{key, assertions: 1, failed: false}]}]}]};
    put(root, `${recordPath}/collection.json`, native); put(root, `${recordPath}/execution.json`, native);
    const run = createRun({id: `generated-${number}`, startedAt: f.run.startedAt, ...f.run.inputs});
    const observations = JSON.parse(JSON.stringify(f.report).replaceAll('"run-1"', JSON.stringify(run.id)));
    const generatedResult = assessRun(run, f.roots, observations), reporting = writeReports(f.roots, generatedResult, {directory: `reports/execution/${invocation}/case-1`});
    put(root, `.harness/workflow/generated/${invocation}/case-1.json`, {id: 'case-1', invocation, execution: {id: 'case-1', run, roots: f.roots, observations, result: generatedResult}, reporting});
    const directory = `reports/generation/${invocation}`, view = reportView(generatedResult), json = renderJson(view), html = renderHtml(view);
    put(root, `${directory}/allure-results/attachment.json`, json); put(root, `${directory}/allure-results/attachment.html`, html);
    put(root, `${directory}/allure-results/case-result.json`, {name: 'Observe', status: 'passed', steps: [{name: 'Business', steps: [{name: 'Technical', attachments: [{name: 'Harness execution result', type: 'application/json', source: 'attachment.json'}, {name: 'Harness execution report', type: 'text/html', source: 'attachment.html'}]}]}]});
    put(root, `${directory}/capture.json`, {status: 'CAPTURED', tests: 1, nativeStatus: 'passed', artifacts: allureInventory(join(root, directory, 'allure-results'))});
    put(root, `${directory}/verification.json`, {sourceId: source.id, invocation, revision: candidate.revision, status: 'PASS'});
    const converted = {name: 'Observe', status: 'passed', steps: [{name: 'Business', steps: [{name: 'Technical', steps: [
      {type: 'attachment', link: {name: 'Harness execution result', contentType: 'application/json', id: 'a', ext: '.json', missed: false}},
      {type: 'attachment', link: {name: 'Harness execution report', contentType: 'text/html', id: 'b', ext: '.html', missed: false}},
    ]}]}]};
    const landing = 'Recorded outcome: <strong>PASS</strong>', nativeHtml = `Content-Security-Policy d("data/attachments/a.json","${Buffer.from(json).toString('base64')}"); d("data/attachments/b.html","${Buffer.from(html).toString('base64')}"); d("data/test-results/case.json","${Buffer.from(JSON.stringify(converted)).toString('base64')}");`;
    put(root, `${directory}/index.html`, landing); put(root, `${directory}/allure-report/index.html`, nativeHtml);
    const artifact = (path, text) => ({path, bytes: Buffer.byteLength(text), sha256: digest(text)});
    put(root, `${directory}/generation.json`, {status: 'GENERATED', generator: 'allure', commandline: '3.19.1', reporter: '3.13.0', tests: 1,
      configuration: digest(readFileSync(join(f.roots.packageRoot, 'scripts/lib/reporting/allurerc.json'))), verification: {id: invocation, revision: candidate.revision, status: 'PASS'},
      artifact: artifact(`${directory}/index.html`, landing), nativeArtifact: artifact(`${directory}/allure-report/index.html`, nativeHtml)});
    await transaction(f.roots, source.id, (state, save) => {state.runs.push({id: invocation, revision: candidate.revision, status: 'PASS', receipt: {path: `${recordPath}/execution.json`, fingerprint: fingerprint(native)}, reporting: {status: 'CAPTURED', directory}}); save(state);});
  }
  return {...f, h, n};
}

test('complete protocol validates its own artifacts while ignoring execution timing and report hashes for parity', async t => {
  const a = await completed(t), b = await completed(t, {duration: 77});
  assert.equal((await compareWorkflows(a.roots, b.roots, expected)).status, 'PASS');
});
test('meaningful business outputs remain semantic differences', async t => {
  const a = await completed(t), b = await completed(t, {businessValue: 'different-business-record'});
  const comparison = await compareWorkflows(a.roots, b.roots, expected); assert.equal(comparison.status, 'FAIL'); assert(comparison.stages.some(s => !s.equivalent));
});
for (const [name, mutate] of [
  ['empty refinement', n => n.refinement.scenarios = []],
  ['source drift', n => n.refinement.sourceFingerprint = 'different'],
  ['expectation omission', n => n.refinement.scenarios[0].expectationKeys = []],
  ['silent knowledge promotion', n => n.knowledge.status = 'REVIEWED'],
  ['foreign evidence', n => n.knowledge.facts[0].evidenceIds = ['other']],
  ['changed observed status', n => n.knowledge.facts[0].assertionStatuses = ['FAIL']],
  ['other run lineage', n => n.knowledge.facts[0].runId = 'foreign'],
]) test(`workflow notes reject ${name}`, t => {const f = fixture(t), h = handoff(f), n = notes(h); mutate(n); assert.throws(() => workflowNotes(source, h, n.refinement, n.knowledge));});
for (const [name, change] of [
  ['missing exploration', f => put(f.roots.projectRoot, '.harness/workflow/exploration.json', [])],
  ['missing prior refinement', f => unlinkSync(join(f.roots.projectRoot, '.harness/workflow/refinement-receipt.json'))],
  ['refinement changed after exploration', f => put(f.roots.projectRoot, 'refinement.json', {...f.n.refinement, scenarios: [{...f.n.refinement.scenarios[0], notes: 'Changed after execution'}]})],
  ['report content change', f => put(f.roots.projectRoot, 'reports/exploration/observe/index.html', 'changed')],
  ['missing generated execution', f => unlinkSync(join(f.roots.projectRoot, '.harness/workflow/generated/verify-0/case-1.json'))],
  ['missing rendered Allure', f => unlinkSync(join(f.roots.projectRoot, 'reports/generation/verify-0/allure-report/index.html'))],
  ['modified native attachment', f => put(f.roots.projectRoot, 'reports/generation/verify-0/allure-results/attachment.json', '{}')],
  ['review drift', f => put(f.roots.projectRoot, '.harness/state/review.md', 'modified')],
  ['frozen generated code change', f => put(f.roots.projectRoot, 'tests/ObservationTests.spec.ts', '// changed')],
]) test(`full workflow refuses ${name}`, async t => {const f = await completed(t); change(f); await assert.rejects(workflowSemantics(f.roots, expected));});
test('a single green cannot establish end-to-end readiness', async t => {
  const f = await completed(t); await transaction(f.roots, source.id, (state, save) => {state.runs.pop(); save(state);});
  await assert.rejects(workflowSemantics(f.roots, expected), /not delivery ready/);
});
test('different native invocations cannot reuse one recorded runtime execution', async t => {
  const f = await completed(t), first = JSON.parse(readFileSync(join(f.roots.projectRoot, '.harness/workflow/generated/verify-0/case-1.json')));
  put(f.roots.projectRoot, '.harness/workflow/generated/verify-1/case-1.json', first);
  await assert.rejects(workflowSemantics(f.roots, expected), /another test\/invocation/);
});
test('zero expected parity scope is rejected', async t => {const f = await completed(t); await assert.rejects(workflowSemantics(f.roots, {...expected, executionIds: []}));});

for (const [name, change] of [
  ['missing attachment link', result => result.steps[0].steps[0].steps[0].link.missed = true],
  ['wrong attachment association', result => result.steps[0].steps[0].steps[0].link.id = 'b'],
  ['attachment outside technical step', result => result.steps = result.steps[0].steps],
]) test(`rendered Allure rejects ${name} even when the report hash is updated`, async t => {
  const f = await completed(t), directory = 'reports/generation/verify-0', path = `${directory}/allure-report/index.html`;
  const html = readFileSync(join(f.roots.projectRoot, path), 'utf8').replace(/d\("data\/test-results\/case.json","([^"]+)"\)/, (_, encoded) => {
    const result = JSON.parse(Buffer.from(encoded, 'base64')); change(result);
    return `d("data/test-results/case.json","${Buffer.from(JSON.stringify(result)).toString('base64')}")`;
  });
  put(f.roots.projectRoot, path, html);
  const receipt = JSON.parse(readFileSync(join(f.roots.projectRoot, directory, 'generation.json')));
  receipt.nativeArtifact.bytes = Buffer.byteLength(html); receipt.nativeArtifact.sha256 = digest(html); put(f.roots.projectRoot, `${directory}/generation.json`, receipt);
  await assert.rejects(workflowSemantics(f.roots, expected), /attachment/);
});
