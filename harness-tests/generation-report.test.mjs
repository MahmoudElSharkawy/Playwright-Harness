import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fixture} from './fixtures/execution-core.mjs';
import {source, put, prepared, recorded} from './fixtures/generation-report.mjs';
import {fingerprint, digest} from '../scripts/lib/execution-core/data.mjs';
import {createGenerationHandoff, generationStatus} from '../scripts/lib/generation/index.mjs';
import {transaction} from '../scripts/lib/generation/storage.mjs';
import {automationReportView, writeAutomationReport} from '../scripts/lib/generation/report.mjs';

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
    assert.match(body, /blocked\\-case/); assert.match(body, /Blocked/); assert.match(body, /Exploration/);
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

test('production automation outcomes explain readiness without internal gate wording', async t => {
  for (const [status, patch, expected] of [
    ['PASS', {}, 'The test passed. Further verification is needed before automation is ready.'],
    ['READY', {}, 'Automation is ready. The test passed verification and review.'],
    ['NEEDS_REVIEW', {assertions: {passed: 0, failed: 0}}, 'Some required checks were not completed. Review this case before using its result.'],
    ['SKIPPED', {status: 'skipped'}, 'This test was skipped.']
  ]) {
    const f = await prepared(t);
    await recorded(f, 'PASS', 'verification-first', patch);
    if (status === 'READY') await recorded(f, 'PASS', 'verification-second');
    const before = await generationStatus(f.roots, f.source.id), view = await automationReportView(f.roots, {sourceId: f.source.id});
    assert.equal(view.cases[0].status, status);
    const report = await writeAutomationReport(f.roots, {sourceId: f.source.id});
    assert.equal(report.status, 'WRITTEN');
    const html = readFileSync(join(f.roots.projectRoot, report.html), 'utf8');
    assert(html.includes(expected), `${status} needs a plain explanation`);
    assert.doesNotMatch(html, /scoped green|verification gate|register and independently review|native test/i);
    assert.equal(JSON.parse(readFileSync(join(f.roots.projectRoot, report.directory, 'result.json'))).cases[0].reason, view.cases[0].reason);
    assert.deepEqual(await generationStatus(f.roots, f.source.id), before);
  }
});

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
  assert(html.includes('id="status-filter"')); assert(html.includes('All test cases'));
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
  assert(!html.includes('Scoped verification history')); assert(!html.includes('verify-before-addition'));
  assert(!html.includes('verify-report')); assert(html.includes('1 check(s) failed.'));
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
