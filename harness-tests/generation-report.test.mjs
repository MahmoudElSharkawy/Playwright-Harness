import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync, readFileSync, readdirSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fixture} from './fixtures/execution-core.mjs';
import {fingerprint, digest} from '../scripts/lib/execution-core/data.mjs';
import {createGenerationHandoff, sourceExpectations, beginGeneration, registerCandidate, recordGenerationReview, generationStatus} from '../scripts/lib/generation/index.mjs';
import {transaction} from '../scripts/lib/generation/storage.mjs';
import {automationReportView, writeAutomationReport} from '../scripts/lib/generation/report.mjs';

const source = (ids = ['source-case']) => ({version: 1, id: 'report-suite', title: 'Synthetic report source', scenarios: ids.map(id => ({id, title: id, steps: [{action: 'Read observation', expected: ['The expected observation is visible']}]}))});
const put = (root, path, value) => {mkdirSync(dirname(join(root, path)), {recursive: true}); writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value));};
const notes = input => ({version: 1, sourceFingerprint: fingerprint(input), cases: [{scenarioId: input.scenarios[0].id, stage: 'EXPLORE', reason: 'The required fixture is unavailable.', nextAction: 'Provision the fixture before exploration.'}]});

test('automation Summary and Defects navigation points to complete, manifested companions', async t => {
  const f = fixture(t), input = source(['blocked-case', 'pending-case']), blockerNotes = notes(input);
  const report = await writeAutomationReport(f.roots, {source: input, notes: blockerNotes});
  assert.equal(report.status, 'WRITTEN');
  const html = readFileSync(join(f.roots.projectRoot, report.html), 'utf8');
  assert.match(html, /<a href="summary.md">Summary/); assert.match(html, /<a href="defects.md">Defects/);
  const summary = readFileSync(join(f.roots.projectRoot, report.directory, 'summary.md'), 'utf8');
  const defects = readFileSync(join(f.roots.projectRoot, report.directory, 'defects.md'), 'utf8');
  for (const body of [summary, defects]) {
    assert.match(body, /blocked\\-case/); assert.match(body, /BLOCKED/); assert.match(body, /EXPLORE/);
    assert.match(body, /required fixture is unavailable/); assert.match(body, /Provision the fixture/);
  }
  assert.match(summary, /pending\\-case/); assert.doesNotMatch(defects, /pending\\-case/);
  assert.match(defects, /not filed product bugs/);
  for (const name of ['summary.md', 'defects.md']) {
    const artifact = report.artifacts.find(file => file.path === name); assert(artifact);
    const bytes = readFileSync(join(f.roots.projectRoot, report.directory, name));
    assert.equal(bytes.length, artifact.bytes); assert.equal(digest(bytes), artifact.sha256);
  }
});

async function prepared(t) {
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

async function recorded(f, status = 'FAIL') {
  // Synthetic native receipt exercises presentation/integrity; real native failure is tested separately.
  const runId = 'verify-report', path = `.harness/state/generation/${f.source.id}/${runId}/execution.json`;
  const receipt = {version: 2, invocation: runId, tests: [{...f.candidate.tests[0], results: [{status: status === 'PASS' ? 'passed' : 'failed', retry: 0, errors: status === 'PASS' ? 0 : 1, assertions: {passed: 1, failed: status === 'PASS' ? 0 : 1}, skippedSteps: 0, failedChecks: status === 'PASS' ? [] : ['toBe']}]}]};
  put(f.roots.projectRoot, path, receipt);
  await transaction(f.roots, f.source.id, (state, save) => {state.runs.push({id: runId, revision: f.candidate.revision, gate: 'case-assertions', status, failureClass: 'ASSERTION_COVERAGE', reason: 'A case assertion failed.', receipt: {path, fingerprint: fingerprint(receipt)}}); save(state);});
  return {path, receipt};
}

test('pre-candidate blockers produce a complete report without awarding generation progress', async t => {
  const f = fixture(t), input = source(['blocked-case', 'pending-case']), blockerNotes = notes(input);
  const report = await writeAutomationReport(f.roots, {source: input, notes: blockerNotes});
  assert.equal(report.status, 'WRITTEN', JSON.stringify(report));
  const view = JSON.parse(readFileSync(join(f.roots.projectRoot, report.directory, 'result.json')));
  assert.equal(view.status, 'NOT_STARTED'); assert.equal(view.greens, 0);
  assert.deepEqual(view.cases.map(row => row.status), ['BLOCKED', 'NOT_GENERATED']);
  assert.equal(view.cases[0].stage, 'EXPLORE'); assert.equal(view.cases[0].reason, blockerNotes.cases[0].reason);
  assert.equal(readdirSync(join(f.roots.projectRoot, '.harness/state/generation', input.id)).filter(file => /^\d{6}\.json$/.test(file)).length, 0);
  const manifest = JSON.parse(readFileSync(join(f.roots.projectRoot, report.directory, 'manifest.json')));
  for (const artifact of manifest.artifacts) assert.equal(digest(readFileSync(join(f.roots.projectRoot, report.directory, artifact.path))), artifact.sha256);
  const html = readFileSync(join(f.roots.projectRoot, report.html), 'utf8');
  assert(html.includes('data-chart-status="BLOCKED" data-count="1"')); assert(html.includes('Provision the fixture before exploration.'));
  assert(html.includes('id="status-filter"')); assert(html.includes('Complete source · full report'));
});

test('incomplete source drafts remain reportable while generation preparation stays blocked', async t => {
  const f = fixture(t), input = source(['incomplete-case', 'complete-case']); input.scenarios[0].steps[0].expected = [];
  const report = await writeAutomationReport(f.roots, {source: input}); assert.equal(report.status, 'WRITTEN');
  const view = JSON.parse(readFileSync(join(f.roots.projectRoot, report.directory, 'result.json')));
  assert.deepEqual(view.cases.map(row => row.status), ['BLOCKED', 'NOT_GENERATED']); assert.equal(view.cases[0].stage, 'REFINE');
  assert(view.cases[0].reason.includes('expected results')); assert.deepEqual(view.source, input);
  assert.throws(() => createGenerationHandoff(input, [], []), /incomplete/);
  assert.equal(view.greens, 0);
});

test('blocker notes reject stale sources, invented verdicts, unknown or duplicate cases and credentials', async t => {
  const f = fixture(t), input = source();
  for (const mutate of [n => n.sourceFingerprint = 'stale', n => n.cases[0].status = 'PASS', n => n.cases[0].scenarioId = 'unknown', n => n.cases.push(n.cases[0]), n => n.cases[0].reason = ['password', 'secret-value'].join('=')]) {
    const blockerNotes = notes(input); mutate(blockerNotes);
    assert.equal((await writeAutomationReport(f.roots, {source: input, notes: blockerNotes})).status, 'FAILED');
  }
});

test('command blocker inputs cannot invent per-case verdicts', async t => {
  const f = fixture(t), input = source();
  for (const status of ['PASS', 'FAIL', 'READY']) {
    const report = await writeAutomationReport(f.roots, {source: input, blocker: {stage: 'PREPARE', reason: 'A prerequisite is unavailable.', status}});
    assert.equal(report.status, 'FAILED', 'A command blocker must not override a case verdict.');
  }
});

test('generation reports preserve binding attribution, failed native outcomes and readiness', async t => {
  const f = await prepared(t); await recorded(f);
  const before = await generationStatus(f.roots, f.source.id), view = await automationReportView(f.roots, {sourceId: f.source.id});
  assert.equal(view.environment, 'qa'); assert.equal(view.cases[0].observedStatus, 'PASS');
  assert.equal(view.cases[0].status, 'FAIL'); assert(view.cases[0].reason.includes('toBe'));
  assert.equal(view.cases[0].nativeStatus, 'failed'); assert.equal(view.status, 'FAIL');
  assert.deepEqual(await generationStatus(f.roots, f.source.id), before);
  assert.equal((await writeAutomationReport(f.roots, {source: f.source, notes: notes(f.source)})).status, 'FAILED');
});

test('one native green never becomes READY through report generation', async t => {
  const f = await prepared(t); await recorded(f, 'PASS');
  const view = await automationReportView(f.roots, {sourceId: f.source.id});
  assert.equal(view.greens, 1); assert.equal(view.status, 'PASS'); assert.equal(view.cases[0].status, 'PASS');
  assert.notEqual(view.cases[0].status, 'READY');
});

test('case history excludes verification scopes before its source membership and labels retained suite outcomes', async t => {
  const f = await prepared(t); await recorded(f);
  await transaction(f.roots, f.source.id, (state, save) => {
    // Synthetic prior-source metadata: the current case did not belong to that candidate.
    const previous = structuredClone(state.candidates[0]); previous.revision = 'revision-before-addition'; previous.tests[0].scenarioId = 'earlier-source-case';
    state.candidates.unshift(previous);
    state.runs.unshift({id: 'verify-before-addition', revision: previous.revision, status: 'FAIL', reason: 'An earlier source scope failed.'}); save(state);
  });
  const view = await automationReportView(f.roots, {sourceId: f.source.id});
  assert.deepEqual(view.cases[0].history.map(run => run.id), ['verify-report']);
  assert.equal(view.cases[0].history[0].reason, 'A case assertion failed.');
  const report = await writeAutomationReport(f.roots, {sourceId: f.source.id});
  const html = readFileSync(join(f.roots.projectRoot, report.html), 'utf8');
  assert(html.includes('Scoped verification history')); assert(html.includes('not individual case verdicts'));
});

test('changed or unbound native receipts cannot supply a case verdict', async t => {
  const f = await prepared(t), saved = await recorded(f);
  const changed = {...saved.receipt, tests: []}; put(f.roots.projectRoot, saved.path, changed);
  let view = await automationReportView(f.roots, {sourceId: f.source.id});
  assert.equal(view.status, 'FAIL'); assert.equal(view.cases[0].status, 'NEEDS_REVIEW'); assert(view.cases[0].reason.includes('receipt'));
  await transaction(f.roots, f.source.id, (state, save) => {delete state.runs[0].receipt; save(state);});
  view = await automationReportView(f.roots, {sourceId: f.source.id}); assert.equal(view.cases[0].status, 'NEEDS_REVIEW');
});

test('report output failure does not alter recorded outcomes or repair counts', async t => {
  const f = await prepared(t); await recorded(f);
  const before = await generationStatus(f.roots, f.source.id);
  put(f.roots.projectRoot, 'reports/harness', 'Occupied report output.');
  assert.equal((await writeAutomationReport(f.roots, {sourceId: f.source.id})).status, 'FAILED');
  assert.deepEqual(await generationStatus(f.roots, f.source.id), before);
});

test('explicit report CLI supports blockers before generation starts', t => {
  const f = fixture(t), input = source(); put(f.roots.projectRoot, 'source.json', input); put(f.roots.projectRoot, '.harness/state/blockers.json', notes(input));
  const result = spawnSync(process.execPath, [join(f.roots.packageRoot, 'scripts/generate-tests.mjs'), 'report', '--project-root', f.roots.projectRoot, '--source', 'source.json', '--input', '.harness/state/blockers.json'], {encoding: 'utf8', windowsHide: true});
  assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).status, 'WRITTEN'); assert(JSON.parse(result.stdout).html.endsWith('/index.html'));
});
