import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fixture, resource} from './fixtures/execution-core.mjs';
import {source, put, observed, prepared, recorded, productionBlockers} from './fixtures/generation-report.mjs';
import {fingerprint, digest} from '../scripts/lib/execution-core/data.mjs';
import {createGenerationHandoff, createReportingAssessment, beginGeneration, reviseGeneration, recordGenerationReview, recordGenerationReporting, generationStatus} from '../scripts/lib/generation/index.mjs';
import {transaction} from '../scripts/lib/generation/storage.mjs';
import {automationReportView, writeAutomationReport} from '../scripts/lib/generation/report.mjs';

const notes = input => ({version: 1, sourceFingerprint: fingerprint(input), cases: [{scenarioId: input.scenarios[0].id, stage: 'EXPLORE', reason: 'The required fixture is unavailable.', nextAction: 'Provision the fixture before exploration.'}]});

const mixedScope = () => {
  const original = {...source(Array.from({length: 20}, (_, index) => `case${String(index + 1).padStart(2, '0')}`)), id: 'requested-report-suite'};
  original.scenarios.at(-1).steps[0].expected = [];
  const selected = {...original, id: 'report-suite', scenarios: original.scenarios.slice(0, 6)};
  const blockers = {version: 1, sourceFingerprint: fingerprint(original), cases: original.scenarios.slice(6).map(scenario => ({scenarioId: scenario.id, stage: 'EXPLORE', reason: `Prerequisite for ${scenario.id} is unavailable.`, nextAction: `Provision the fixture for ${scenario.id}.`}))};
  return {original, selected, blockers};
};

test('standard QA reporting produces one complete twenty-case bundle with subset receipts as supporting evidence', async t => {
  const {original, selected, blockers} = mixedScope(), f = await prepared(t, {source: selected, reporting: {source: original, notes: blockers}});
  const receipts = [await recorded(f, 'PASS', 'verification-first'), await recorded(f, 'PASS', 'verification-second')];
  const evidence = receipts.map(receipt => ({path: receipt.path, bytes: readFileSync(join(f.roots.projectRoot, receipt.path))}));
  for (const receipt of receipts) assert.deepEqual(receipt.receipt.tests.map(row => row.scenarioId), selected.scenarios.map(row => row.id));
  const before = await generationStatus(f.roots, selected.id), view = await automationReportView(f.roots, {sourceId: selected.id});
  assert.equal(view.cases.length, 20);
  assert.equal(new Set(view.cases.map(row => row.id)).size, 20);
  assert.deepEqual(view.cases.map(row => row.id), original.scenarios.map(row => row.id));
  assert.equal(view.status, 'READY'); assert.equal(view.greens, 2);
  assert.deepEqual(view.coverage, {total: 20, selected: 6, ready: 6, blocked: 14, complete: false, scopeKnown: true});
  assert.equal(view.sourceId, selected.id); assert.deepEqual(view.source, original); assert.equal(view.sourceFingerprint, fingerprint(original));
  assert.deepEqual(view.cases.slice(0, 6).map(row => row.status), Array(6).fill('READY'));
  for (const [index, row] of view.cases.slice(6).entries()) {
    assert.equal(row.status, 'BLOCKED'); assert.equal(row.stage, 'EXPLORE');
    assert.equal(row.reason, blockers.cases[index].reason); assert.equal(row.nextAction, blockers.cases[index].nextAction);
    assert.deepEqual(row.history, []); assert.equal(row.observedStatus, 'Not recorded');
  }
  const deliveries = [];
  for (let render = 0; render < 2; render++) {
    let report;
    if (render === 0) report = await writeAutomationReport(f.roots, {sourceId: selected.id});
    else {
      const result = spawnSync(process.execPath, [join(f.roots.packageRoot, 'scripts/generate-tests.mjs'), 'report', '--project-root', f.roots.projectRoot, '--id', selected.id], {encoding: 'utf8', windowsHide: true});
      assert.equal(result.status, 0, result.stderr); report = JSON.parse(result.stdout);
    }
    assert.equal(report.status, 'WRITTEN');
    deliveries.push(report.directory.split('/').at(-1));
    assert.deepEqual(readdirSync(join(f.roots.projectRoot, 'reports/harness')).sort(), deliveries.slice().sort(), 'Each invocation produces one complete QA bundle, without another subset-only report.');
    assert.deepEqual(readdirSync(join(f.roots.projectRoot, report.directory)).sort(), ['defects.md', 'index.html', 'manifest.json', 'result.json', 'summary.md']);
    for (const receipt of evidence) assert.deepEqual(readFileSync(join(f.roots.projectRoot, receipt.path)), receipt.bytes, 'QA reporting must preserve verification evidence byte for byte.');
    assert.equal(report.cases, 20);
    const saved = JSON.parse(readFileSync(join(f.roots.projectRoot, report.directory, 'result.json')));
    assert.deepEqual(saved.cases, view.cases); assert.deepEqual(saved.coverage, view.coverage);
    const html = readFileSync(join(f.roots.projectRoot, report.html), 'utf8');
    assert.match(html, /Showing 20 of 20 test cases/); assert.match(html, /data-metric="total">20</);
    assert.match(html, /data-chart-status="READY" data-count="6"/); assert.match(html, /data-chart-status="BLOCKED" data-count="14"/);
    assert.equal((html.match(/data-case data-order=/g) ?? []).length, 20);
    assert.match(html, /value="READY"/); assert.match(html, /value="BLOCKED"/);
    for (const name of ['index.html', 'summary.md', 'defects.md']) {
      const body = readFileSync(join(f.roots.projectRoot, report.directory, name), 'utf8');
      assert.match(body, /6 of 20.*ready/i, name); assert.match(body, /14 blocked/i, name); assert.match(body, /requested scope.*incomplete/i, name);
      const readable = body.replaceAll('\\.', '.');
      for (const row of blockers.cases) {assert(readable.includes(row.scenarioId), name); assert(readable.includes(row.reason), name); assert(readable.includes(row.nextAction), name);}
    }
    const summary = readFileSync(join(f.roots.projectRoot, report.directory, 'summary.md'), 'utf8'), defects = readFileSync(join(f.roots.projectRoot, report.directory, 'defects.md'), 'utf8');
    assert.equal((summary.match(/^## case\d{2} — /gm) ?? []).length, 20); assert.equal((defects.match(/^## case\d{2} — /gm) ?? []).length, 14);
    const manifest = JSON.parse(readFileSync(join(f.roots.projectRoot, report.directory, 'manifest.json')));
    assert.equal(manifest.cases, 20); assert.equal(manifest.sourceFingerprint, fingerprint(original));
    for (const artifact of manifest.artifacts) assert.equal(digest(readFileSync(join(f.roots.projectRoot, report.directory, artifact.path))), artifact.sha256);
  }
  assert.deepEqual(await generationStatus(f.roots, selected.id), before);
});

test('reporting context rejects changed selection, stale fingerprints and verdict overrides without changing generation gates', async t => {
  const {original, selected, blockers} = mixedScope(), f = await prepared(t, {source: selected}), untouched = fixture(t);
  const before = await generationStatus(f.roots, selected.id);
  const invalid = [
    input => input.source.scenarios.splice(0, 1),
    input => input.source.scenarios[0].title = 'An altered requested title',
    input => input.source.scenarios[0].steps[0].action = 'A different action',
    input => input.source.scenarios[0].steps[0].expected[0] = 'A different expectation',
    input => input.source.scenarios[0].externalReferences = [{system: 'ado', id: 'invented'}],
    input => input.sourceFingerprint = 'stale',
    input => input.selectedSourceFingerprint = 'stale',
    input => input.notes.sourceFingerprint = 'stale',
    input => input.notes.cases.push({...input.notes.cases[0]}),
    input => input.notes.cases[0].scenarioId = 'unknown',
    input => input.notes.cases[0].scenarioId = selected.scenarios[0].id,
    input => input.notes.cases[0].status = 'PASS',
    input => input.notes.cases[0].status = 'READY',
    input => input.notes.cases[0].reason = ['password', 'secret-value'].join('=')
  ];
  for (const mutate of invalid) {
    const reporting = structuredClone({source: original, notes: blockers}); mutate(reporting);
    await assert.rejects(() => recordGenerationReporting(f.roots, selected.id, reporting));
    await assert.rejects(() => beginGeneration(untouched.roots, f.handoff, 'report-author', reporting));
    assert.deepEqual(await generationStatus(f.roots, selected.id), before);
  }
  await beginGeneration(untouched.roots, f.handoff, 'report-author', {source: original, notes: blockers});
  assert.equal((await automationReportView(untouched.roots, {sourceId: selected.id})).cases.length, 20);
  assert.deepEqual(await generationStatus(f.roots, selected.id), before);
});

test('captured original scope and blocker notes survive input mutation and explicit refresh preserves verification', async t => {
  const {original, selected, blockers} = mixedScope(), reporting = structuredClone({source: original, notes: blockers});
  const f = await prepared(t, {source: selected, reporting});
  await recorded(f, 'PASS', 'verification-first'); await recorded(f, 'PASS', 'verification-second');
  const before = await generationStatus(f.roots, selected.id);
  reporting.source.scenarios.pop(); reporting.notes.cases[0].reason = 'Mutated caller input';
  let view = await automationReportView(f.roots, {sourceId: selected.id});
  assert.deepEqual(view.source, original); assert.equal(view.cases[6].reason, blockers.cases[0].reason);
  const refreshed = structuredClone(blockers); refreshed.cases[0].reason = 'The requested prerequisite still needs owner approval.';
  await recordGenerationReporting(f.roots, selected.id, {source: original, notes: refreshed});
  await recordGenerationReporting(f.roots, selected.id, {source: original});
  view = await automationReportView(f.roots, {sourceId: selected.id});
  assert.equal(view.cases[6].reason, refreshed.cases[0].reason); assert.deepEqual(view.coverage, {total: 20, selected: 6, ready: 6, blocked: 14, complete: false, scopeKnown: true});
  assert.deepEqual(await generationStatus(f.roots, selected.id), before);
  const changed = structuredClone(original); changed.scenarios[6].title = 'Rewritten original request';
  await assert.rejects(() => recordGenerationReporting(f.roots, selected.id, {source: changed}));
  assert.deepEqual(await generationStatus(f.roots, selected.id), before);
  assert.equal((await writeAutomationReport(f.roots, {sourceId: selected.id, source: changed})).status, 'FAILED');
});

test('full-scope reporting cannot turn one green or a changed prior receipt into ready cases', async t => {
  const {original, selected, blockers} = mixedScope(), f = await prepared(t, {source: selected, reporting: {source: original, notes: blockers}});
  const first = await recorded(f, 'PASS', 'verification-first');
  let view = await automationReportView(f.roots, {sourceId: selected.id});
  assert.equal(view.greens, 1); assert.equal(view.status, 'PASS'); assert.equal(view.coverage.ready, 0); assert.equal(view.coverage.complete, false);
  assert.deepEqual(view.cases.slice(0, 6).map(row => row.status), Array(6).fill('PASS'));
  const second = await recorded(f, 'PASS', 'verification-second');
  first.receipt.tests[0].results[0].assertions.passed = 0; put(f.roots.projectRoot, first.path, first.receipt);
  view = await automationReportView(f.roots, {sourceId: selected.id});
  assert.equal(view.status, 'NEEDS_REVIEW'); assert.equal(view.coverage.ready, 0); assert.equal(view.coverage.complete, false);
  assert(view.cases.slice(0, 6).every(row => row.status !== 'READY')); assert.equal(view.cases.filter(row => row.status === 'BLOCKED').length, 14);
  second.receipt.tests.pop(); put(f.roots.projectRoot, second.path, second.receipt);
  view = await automationReportView(f.roots, {sourceId: selected.id});
  assert(view.cases.slice(0, 6).every(row => row.status === 'NEEDS_REVIEW')); assert.equal(view.cases.filter(row => row.status === 'BLOCKED').length, 14);
  const report = await writeAutomationReport(f.roots, {sourceId: selected.id}); assert.equal(report.status, 'WRITTEN'); assert.equal(report.cases, 20);
});

test('legacy subset history identifies unknown original scope until an explicit CLI scope binding is persisted', async t => {
  const {original, selected, blockers} = mixedScope(), f = await prepared(t, {source: selected});
  await recorded(f, 'PASS', 'verification-first'); await recorded(f, 'PASS', 'verification-second');
  let view = await automationReportView(f.roots, {sourceId: selected.id});
  assert.equal(view.status, 'READY'); assert.equal(view.coverage.scopeKnown, false); assert.equal(view.coverage.complete, false);
  const legacy = await writeAutomationReport(f.roots, {sourceId: selected.id});
  for (const name of ['index.html', 'summary.md', 'defects.md']) assert.match(readFileSync(join(f.roots.projectRoot, legacy.directory, name), 'utf8'), /original.*scope.*unknown/i, name);
  put(f.roots.projectRoot, '.harness/state/original-source.json', original); put(f.roots.projectRoot, '.harness/state/blocker-notes.json', blockers);
  const cli = (...args) => spawnSync(process.execPath, [join(f.roots.packageRoot, 'scripts/generate-tests.mjs'), 'report', '--project-root', f.roots.projectRoot, '--id', selected.id, ...args], {encoding: 'utf8', windowsHide: true});
  const before = await generationStatus(f.roots, selected.id);
  const wrongSource = cli('--source', '.harness/state/original-source.json'); assert.notEqual(wrongSource.status, 0, 'Existing --source must not silently accept an arbitrary superset.');
  for (const option of ['--observed', '--input']) {
    const rejected = cli('--scope', '.harness/state/original-source.json', option, '.harness/state/missing-report-input.json');
    assert.equal(rejected.status, 2, rejected.stderr);
    const failed = JSON.parse(rejected.stderr); assert.equal(failed.reporting.status, 'WRITTEN'); assert.equal(failed.reporting.cases, 20);
    assert.deepEqual(await generationStatus(f.roots, selected.id), before);
  }
  const bound = cli('--scope', '.harness/state/original-source.json', '--input', '.harness/state/blocker-notes.json'); assert.equal(bound.status, 0, bound.stderr);
  assert.equal(JSON.parse(bound.stdout).cases, 20);
  const rerendered = cli(); assert.equal(rerendered.status, 0, rerendered.stderr); assert.equal(JSON.parse(rerendered.stdout).cases, 20);
  view = await automationReportView(f.roots, {sourceId: selected.id});
  assert.deepEqual(view.source, original); assert.deepEqual(view.coverage, {total: 20, selected: 6, ready: 6, blocked: 14, complete: false, scopeKnown: true});
  assert.deepEqual(await generationStatus(f.roots, selected.id), before);
});

test('CLI prepare captures full reporting scope and following standard commands retain it automatically', async t => {
  const {original, selected, blockers} = mixedScope(), f = await prepared(t, {source: selected});
  const cliSource = {...selected, id: 'cli-report-suite'}, paths = '.harness/state/cli-report';
  put(f.roots.projectRoot, `${paths}/selected.json`, cliSource); put(f.roots.projectRoot, `${paths}/original.json`, original); put(f.roots.projectRoot, `${paths}/notes.json`, blockers);
  const executions = f.executions.map(observed => {
    const runRoot = `${paths}/observations/${observed.run.id}`, snapshot = `${runRoot}/inputs.json`;
    put(f.roots.projectRoot, snapshot, observed.run); put(f.roots.projectRoot, `${runRoot}/observations.json`, observed.report);
    for (const evidence of observed.report.evidence) put(f.roots.projectRoot, `${runRoot}/${evidence.path}`, readFileSync(join(observed.roots.runRoot, evidence.path), 'utf8'));
    return {snapshot, runRoot};
  });
  put(f.roots.projectRoot, `${paths}/prepare.json`, {source: `${paths}/selected.json`, author: 'cli-report-author', executions, bindings: f.handoff.bindings, reporting: {source: `${paths}/original.json`, notes: `${paths}/notes.json`}});
  const cli = (...args) => spawnSync(process.execPath, [join(f.roots.packageRoot, 'scripts/generate-tests.mjs'), ...args, '--project-root', f.roots.projectRoot], {encoding: 'utf8', windowsHide: true});
  const preparation = cli('prepare', '--input', `${paths}/prepare.json`); assert.equal(preparation.status, 0, preparation.stderr);
  const started = JSON.parse(preparation.stdout); assert.equal(started.status, 'PREPARED'); assert.equal(started.reporting.cases, 20);
  const status = cli('status', '--id', cliSource.id); assert.equal(status.status, 0, status.stderr);
  const continued = JSON.parse(status.stdout); assert.equal(continued.reporting.cases, 20);
  for (const report of [started.reporting, continued.reporting]) {
    const view = JSON.parse(readFileSync(join(f.roots.projectRoot, report.directory, 'result.json')));
    assert.equal(view.sourceId, cliSource.id); assert.deepEqual(view.source, original);
    assert.deepEqual(view.coverage, {total: 20, selected: 6, ready: 0, blocked: 14, complete: false, scopeKnown: true});
    assert.deepEqual(view.cases.slice(6).map(row => row.reason), blockers.cases.map(row => row.reason));
  }
});

for (const failure of ['handoff', 'observations']) test(`CLI preparation failure retains full reporting scope and recorded blockers without generation progress (${failure})`, t => {
  const {original, selected, blockers} = mixedScope(), f = fixture(t), paths = '.harness/state/blocked-prepare';
  put(f.roots.projectRoot, `${paths}/selected.json`, selected); put(f.roots.projectRoot, `${paths}/original.json`, original); put(f.roots.projectRoot, `${paths}/notes.json`, blockers);
  put(f.roots.projectRoot, `${paths}/observed.json`, {source: `${paths}/original.json`, executions: [], bindings: []});
  put(f.roots.projectRoot, `${paths}/prepare.json`, {source: `${paths}/selected.json`, author: 'blocked-report-author', executions: [], bindings: [], reporting: {source: `${paths}/original.json`, notes: `${paths}/notes.json`, ...(failure === 'observations' ? {observed: `${paths}/observed.json`} : {})}});
  const result = spawnSync(process.execPath, [join(f.roots.packageRoot, 'scripts/generate-tests.mjs'), 'prepare', '--project-root', f.roots.projectRoot, '--input', `${paths}/prepare.json`], {encoding: 'utf8', windowsHide: true});
  assert.equal(result.status, 2, result.stderr);
  const blocked = JSON.parse(result.stderr); assert.equal(blocked.status, 'BLOCKED'); assert.equal(blocked.reporting.status, 'WRITTEN'); assert.equal(blocked.reporting.cases, 20);
  const view = JSON.parse(readFileSync(join(f.roots.projectRoot, blocked.reporting.directory, 'result.json')));
  assert.equal(view.status, 'NOT_STARTED'); assert.equal(view.greens, 0); assert.equal(view.sourceId, selected.id); assert.deepEqual(view.source, original);
  assert.deepEqual(view.notes, blockers); assert.deepEqual(view.coverage, {total: 20, selected: 6, ready: 0, blocked: 20, complete: false, scopeKnown: true});
  assert.equal(new Set(view.cases.map(row => row.id)).size, 20);
  for (const row of view.cases.slice(0, 6)) {assert.equal(row.status, 'BLOCKED'); assert.equal(row.stage, 'PREPARE'); assert.equal(row.observedStatus, 'Not recorded'); assert.deepEqual(row.history, []);}
  for (const [index, row] of view.cases.slice(6).entries()) {assert.equal(row.status, 'BLOCKED'); assert.equal(row.stage, blockers.cases[index].stage); assert.equal(row.reason, blockers.cases[index].reason); assert.equal(row.nextAction, blockers.cases[index].nextAction);}
  assert.equal(readdirSync(join(f.roots.projectRoot, '.harness/state/generation', selected.id)).filter(name => /^\d{6}\.json$/.test(name)).length, 0);
});

for (const context of ['implicit', 'explicit']) test(`a later assessed subset expansion retains original scope and history while newly selected cases need fresh review and verification (${context} reporting)`, async t => {
  const {original, selected, blockers} = mixedScope(), f = await prepared(t, {source: selected, reporting: {source: original, notes: blockers}});
  await recorded(f, 'PASS', 'verification-first'); await recorded(f, 'PASS', 'verification-second');
  const before = await transaction(f.roots, selected.id, state => structuredClone(state));
  const expanded = {...selected, scenarios: original.scenarios.slice(0, 7)}, observation = await prepared(t, {source: expanded});
  put(f.roots.projectRoot, '.harness/state/accepted-expansion.md', 'Synthetic owner acceptance: the seventh case prerequisite is available; include its assessed execution.');
  const changed = await reviseGeneration(f.roots, selected.id, observation.handoff, {config: f.candidate.config, tests: observation.candidate.tests, repair: 'requirement-change', change: {previousSourceFingerprint: before.handoff.fingerprint, artifact: '.harness/state/accepted-expansion.md'}}, context === 'explicit' ? {source: original} : undefined);
  const automatic = await automationReportView(f.roots, {sourceId: selected.id, reporting: {source: original}});
  assert.equal(automatic.coverage.blocked, 13); assert.equal(automatic.cases[7].reason, blockers.cases[1].reason);
  let view = await automationReportView(f.roots, {sourceId: selected.id});
  assert.deepEqual(view.source, original); assert.equal(view.cases.length, 20); assert.equal(view.coverage.selected, 7); assert.equal(view.coverage.blocked, 13); assert.equal(view.coverage.ready, 0);
  assert.equal(view.status, 'NEEDS_REVIEW'); assert.equal(view.greens, 0); assert.equal(view.cases[6].status, 'NEEDS_REVIEW');
  assert.deepEqual(view.cases[6].history, []); assert.equal(view.cases[0].history.length, 2);
  for (const [index, row] of view.cases.slice(7).entries()) {assert.equal(row.status, 'BLOCKED'); assert.equal(row.stage, blockers.cases[index + 1].stage); assert.equal(row.reason, blockers.cases[index + 1].reason); assert.equal(row.nextAction, blockers.cases[index + 1].nextAction);}
  await recordGenerationReview(f.roots, selected.id, {revision: changed.revision, reviewer: 'expanded-report-reviewer', verdict: 'APPROVE', findings: [], artifact: '.harness/state/review.md'});
  const updated = {...f, source: expanded, candidate: changed}; await recorded(updated, 'PASS', 'expanded-first');
  assert.equal((await automationReportView(f.roots, {sourceId: selected.id})).coverage.ready, 0);
  await recorded(updated, 'PASS', 'expanded-second');
  view = await automationReportView(f.roots, {sourceId: selected.id});
  assert.deepEqual(view.coverage, {total: 20, selected: 7, ready: 7, blocked: 13, complete: false, scopeKnown: true});
  assert.equal(view.cases[6].status, 'READY'); assert.equal(view.cases[6].history.length, 2); assert.equal(view.cases[0].history.length, 4);
  const after = await transaction(f.roots, selected.id, state => state);
  assert.equal(after.rounds, 1); assert.deepEqual(after.runs.slice(0, 2), before.runs); assert.deepEqual(after.candidates[0], before.candidates[0]);
});

test('unselected exploration outcomes remain source-bound observations without awarding automation readiness', async t => {
  const original = source(['selected', 'observed-pass', 'observed-fail']), selected = {...original, scenarios: original.scenarios.slice(0, 1)};
  const exploration = observed(t, {...original, id: 'explored-scope', scenarios: original.scenarios.slice(1)}, {statuses: ['PASS', 'FAIL']});
  const f = await prepared(t, {source: selected, reporting: {source: original, observed: exploration.assessment}});
  await recorded(f, 'PASS', 'selected-first'); await recorded(f, 'PASS', 'selected-second');
  const before = await generationStatus(f.roots, selected.id), view = await automationReportView(f.roots, {sourceId: selected.id});
  assert.deepEqual(view.cases.map(row => row.id), original.scenarios.map(row => row.id));
  assert.deepEqual(view.cases.map(row => row.status), ['READY', 'NOT_GENERATED', 'NOT_GENERATED']);
  assert.deepEqual(view.cases.slice(1).map(row => row.observedStatus), ['PASS', 'FAIL']);
  for (const row of view.cases.slice(1)) {assert.equal(row.stage, 'EXPLORE'); assert.equal(row.nativeStatus, undefined); assert.deepEqual(row.history, []); assert(row.reason); assert(row.nextAction);}
  assert.equal(view.coverage.ready, 1); assert.equal(view.coverage.complete, false); assert.equal(view.coverage.blocked, 0);
  await recordGenerationReporting(f.roots, selected.id, {source: original});
  assert.deepEqual((await automationReportView(f.roots, {sourceId: selected.id})).cases, view.cases);
  assert.deepEqual(await generationStatus(f.roots, selected.id), before);
  const replacement = observed(t, {...original, id: 'explored-scope', scenarios: original.scenarios.slice(1)}, {statuses: ['PASS', 'PASS']});
  await recordGenerationReporting(f.roots, selected.id, {source: original, observed: replacement.assessment});
  const refreshed = await automationReportView(f.roots, {sourceId: selected.id});
  assert.deepEqual(refreshed.cases.map(row => row.status), ['READY', 'NOT_GENERATED', 'NOT_GENERATED']);
  assert.deepEqual(refreshed.cases.slice(1).map(row => row.observedStatus), ['PASS', 'PASS']);
  assert.deepEqual(await generationStatus(f.roots, selected.id), before);
});

test('incremental observation refresh retains other case outcomes and defects while replacing only reassessed cases', async t => {
  const original = source(['selected', 'observed-a', 'observed-b']), selected = {...original, scenarios: original.scenarios.slice(0, 1)};
  const assessment = (index, status) => observed(t, {...original, id: `explored-${index}`, scenarios: [original.scenarios[index]]}, {statuses: [status], first: fixture(t, {id: `incremental-${index}-${status.toLowerCase()}`})}).assessment;
  const first = assessment(1, 'FAIL'), second = assessment(2, 'PASS');
  const blockers = {version: 1, sourceFingerprint: fingerprint(original), cases: [{scenarioId: 'observed-b', stage: 'EXPLORE', reason: 'The prerequisite was unavailable.', nextAction: 'Provision the prerequisite before assessment.'}]};
  const f = await prepared(t, {source: selected, reporting: {source: original, observed: first, notes: blockers}}), before = await generationStatus(f.roots, selected.id);
  const duplicate = observed(t, {...original, id: 'duplicate-observation', scenarios: [original.scenarios[2]]}, {first: fixture(t, {id: first.cases[0].runId})}).assessment;
  await assert.rejects(() => recordGenerationReporting(f.roots, selected.id, {source: original, observed: duplicate}), /duplicate.*execution bindings/i);
  const changed = structuredClone(original); changed.scenarios[1].steps[0].expected[0] = 'A changed accepted expectation';
  await assert.rejects(() => recordGenerationReporting(f.roots, selected.id, {source: changed, observed: second}), /Retained observed cases must be exact members/);
  await recordGenerationReporting(f.roots, selected.id, {source: original, observed: second});
  for (const reporting of [undefined, {source: original}, {source: original, observed: second}]) {
    const view = await automationReportView(f.roots, {sourceId: selected.id, ...(reporting ? {reporting} : {})});
    assert.deepEqual(view.cases.slice(1).map(row => row.observedStatus), ['FAIL', 'PASS']);
    assert.deepEqual(view.notes.cases, []);
  }
  const report = await writeAutomationReport(f.roots, {sourceId: selected.id}); assert.equal(report.status, 'WRITTEN');
  const summary = readFileSync(join(f.roots.projectRoot, report.directory, 'summary.md'), 'utf8').replaceAll('\\-', '-'), defects = readFileSync(join(f.roots.projectRoot, report.directory, 'defects.md'), 'utf8').replaceAll('\\-', '-');
  assert.match(summary, /observed-a/); assert.match(summary, /observed-b/); assert.match(defects, /observed-a/); assert.doesNotMatch(defects, /observed-b/);
  const saved = await transaction(f.roots, selected.id, state => state.reporting);
  assert.deepEqual(saved.observed.source.scenarios.map(row => row.id), ['observed-a', 'observed-b']);
  assert.deepEqual(saved.observed.cases.map(row => row.status), ['FAIL', 'PASS']);
  await assert.rejects(() => recordGenerationReporting(f.roots, selected.id, {source: original, observed: second, notes: {version: 1, sourceFingerprint: fingerprint(original), cases: [{scenarioId: 'observed-a', stage: 'EXPLORE', reason: 'An annotation attempts to replace retained evidence.'}]}}));
  await recordGenerationReporting(f.roots, selected.id, {source: original, observed: assessment(1, 'PASS')});
  assert.deepEqual((await automationReportView(f.roots, {sourceId: selected.id})).cases.slice(1).map(row => row.observedStatus), ['PASS', 'PASS']);
  assert.deepEqual(await generationStatus(f.roots, selected.id), before);
});

test('all assessed exploration statuses remain visible while unresolved assessments cannot enter generation', async t => {
  const statuses = ['PASS', 'FAIL', 'BLOCKED', 'SKIPPED', 'NEEDS_REVIEW'], original = source(['selected', ...statuses.map(status => `explored-${status.toLowerCase()}`)]);
  const selected = {...original, scenarios: original.scenarios.slice(0, 1)}, exploredSource = {...original, id: 'explored-scope', scenarios: original.scenarios.slice(1)};
  const exploration = observed(t, exploredSource, {statuses});
  const blocked = exploration.executions[2];
  Object.assign(blocked.scenario, {disposition: 'executed', attempts: [blocked.current]}); delete blocked.scenario.reason;
  Object.assign(blocked.current, {outcome: 'BLOCKED', failureClass: 'UNAVAILABLE', effect: {certainty: 'not-executed', resourceIds: []}, outputs: [], evidenceIds: [], assertions: [{id: 'visible', status: 'NOT_EVALUATED', reliable: false, evidenceIds: []}]});
  const uncertain = exploration.executions[4]; resource(uncertain, 'temporary');
  uncertain.scenario.issues = ['assertion-instability', 'contradictory-evidence', 'indeterminate-outcome'];
  const assessment = createReportingAssessment(exploredSource, exploration.executions.map(execution => ({run: execution.run, roots: execution.roots, observations: execution.report})), exploredSource.scenarios.map((scenario, index) => ({sourceScenarioId: scenario.id, runId: exploration.executions[index].run.id, scenarioId: 'case-1'})));
  assert.throws(() => createGenerationHandoff(exploredSource, exploration.executions.map(execution => ({run: execution.run, roots: execution.roots, observations: execution.report})), []), /Resolve indeterminate execution and lifecycle obligations/);
  const f = await prepared(t, {source: selected, reporting: {source: original, observed: assessment}}), before = await generationStatus(f.roots, selected.id);
  const view = await automationReportView(f.roots, {sourceId: selected.id});
  assert.deepEqual(view.cases.slice(1).map(row => row.observedStatus), statuses);
  for (const row of view.cases.slice(1)) {assert.equal(row.status, 'NOT_GENERATED'); assert.equal(row.stage, 'EXPLORE'); assert.equal(row.nativeStatus, undefined); assert.deepEqual(row.history, []); assert(row.reason); assert(row.nextAction);}
  assert.match(view.cases[3].reason, /unavailable/i); assert.match(view.cases[3].nextAction, /prerequisite|dependency/i);
  for (const cause of [/unstable|instability/i, /contradictory/i, /indeterminate/i, /cleanup/i]) assert.match(view.cases[5].reason, cause);
  assert.match(view.cases[5].nextAction, /cleanup/i);
  assert.equal(view.coverage.ready, 0); assert.equal(view.coverage.complete, false);
  const report = await writeAutomationReport(f.roots, {sourceId: selected.id}); assert.equal(report.status, 'WRITTEN');
  const html = readFileSync(join(f.roots.projectRoot, report.html), 'utf8'), summary = readFileSync(join(f.roots.projectRoot, report.directory, 'summary.md'), 'utf8'), defects = readFileSync(join(f.roots.projectRoot, report.directory, 'defects.md'), 'utf8');
  assert.match(html, /Exploration result/i); assert.match(summary, /Exploration result/i);
  const readable = summary.replaceAll('\\_', '_');
  for (const status of statuses) assert(readable.includes(`Exploration result: ${status}`));
  for (const status of ['fail', 'blocked', 'needs_review']) assert(defects.replaceAll('\\-', '-').replaceAll('\\_', '_').includes(`explored-${status}`));
  for (const body of [html, summary, defects]) {assert.match(body, /unavailable/i); assert.match(body, /indeterminate/i); assert.match(body, /cleanup/i);}
  assert.equal((summary.match(/^## /gm) ?? []).length, 6); assert.equal((defects.match(/^## /gm) ?? []).length, 3);
  assert.deepEqual(await generationStatus(f.roots, selected.id), before);
});

test('reporting observations reject fabricated verdicts, changed source membership and blocker overrides', async t => {
  const original = source(['selected', 'observed']), selected = {...original, scenarios: original.scenarios.slice(0, 1)};
  const exploration = observed(t, {...original, id: 'explored-scope', scenarios: original.scenarios.slice(1)});
  const f = await prepared(t, {source: selected}), before = await generationStatus(f.roots, selected.id);
  const altered = structuredClone(original); altered.scenarios[1].steps[0].expected[0] = 'A different accepted result';
  const other = observed(t, {...original, id: 'other-scope', scenarios: source(['unknown']).scenarios});
  for (const reporting of [
    {source: original, observed: structuredClone(exploration.assessment)},
    {source: altered, observed: exploration.assessment},
    {source: original, observed: other.assessment},
    {source: original, observed: exploration.assessment, notes: {version: 1, sourceFingerprint: fingerprint(original), cases: [{scenarioId: 'observed', stage: 'EXPLORE', reason: 'An annotation attempts to replace assessed evidence.', nextAction: 'Check the actual observation.'}]}}
  ]) {
    await assert.rejects(() => recordGenerationReporting(f.roots, selected.id, reporting));
    assert.deepEqual(await generationStatus(f.roots, selected.id), before);
  }
  await recordGenerationReporting(f.roots, selected.id, {source: original, notes: {version: 1, sourceFingerprint: fingerprint(original), cases: [{scenarioId: 'observed', stage: 'EXPLORE', reason: 'The prerequisite was previously unavailable.', nextAction: 'Provision the prerequisite before assessment.'}]}});
  assert.equal((await automationReportView(f.roots, {sourceId: selected.id})).cases[1].status, 'BLOCKED');
  await recordGenerationReporting(f.roots, selected.id, {source: original, observed: exploration.assessment});
  const assessed = await automationReportView(f.roots, {sourceId: selected.id});
  assert.equal(assessed.cases[1].observedStatus, 'PASS'); assert.equal(assessed.cases[1].status, 'NOT_GENERATED'); assert.deepEqual(assessed.notes.cases, []);
  assert.deepEqual(await generationStatus(f.roots, selected.id), before);
});

test('CLI prepare and following status reports retain reassessed observations outside the selected subset', async t => {
  const original = source(['selected', 'observed-pass', 'observed-fail', 'blocked']), selected = {...original, id: 'cli-observed-suite', scenarios: original.scenarios.slice(0, 1)};
  const f = await prepared(t, {source: {...selected, id: 'fixture-selected-suite'}}), paths = '.harness/state/cli-observed';
  const exploredSource = {...original, id: 'explored-scope', scenarios: original.scenarios.slice(1, 3)}, exploration = observed(t, exploredSource, {statuses: ['PASS', 'FAIL']});
  const blockerNotes = {version: 1, sourceFingerprint: fingerprint(original), cases: [{scenarioId: 'blocked', stage: 'REFINE', reason: 'The accepted outcome needs clarification.', nextAction: 'Obtain the approved acceptance rule.'}]};
  for (const [name, value] of [['selected', selected], ['original', original], ['explored', exploredSource], ['notes', blockerNotes]]) put(f.roots.projectRoot, `${paths}/${name}.json`, value);
  const persist = (executions, folder) => executions.map(execution => {
    const runRoot = `${paths}/${folder}/${execution.run.id}`, snapshot = `${runRoot}/inputs.json`;
    put(f.roots.projectRoot, snapshot, execution.run); put(f.roots.projectRoot, `${runRoot}/observations.json`, execution.report);
    for (const evidence of execution.report.evidence) put(f.roots.projectRoot, `${runRoot}/${evidence.path}`, readFileSync(join(execution.roots.runRoot, evidence.path), 'utf8'));
    return {snapshot, runRoot};
  });
  put(f.roots.projectRoot, `${paths}/observed.json`, {source: `${paths}/explored.json`, executions: persist(exploration.executions, 'exploration'), bindings: exploredSource.scenarios.map((scenario, index) => ({sourceScenarioId: scenario.id, runId: exploration.executions[index].run.id, scenarioId: 'case-1'}))});
  put(f.roots.projectRoot, `${paths}/prepare.json`, {source: `${paths}/selected.json`, author: 'cli-observation-author', executions: persist(f.executions, 'selection'), bindings: f.handoff.bindings, reporting: {source: `${paths}/original.json`, notes: `${paths}/notes.json`, observed: `${paths}/observed.json`}});
  const cli = (...args) => spawnSync(process.execPath, [join(f.roots.packageRoot, 'scripts/generate-tests.mjs'), ...args, '--project-root', f.roots.projectRoot], {encoding: 'utf8', windowsHide: true});
  const preparation = cli('prepare', '--input', `${paths}/prepare.json`); assert.equal(preparation.status, 0, preparation.stderr);
  const status = cli('status', '--id', selected.id); assert.equal(status.status, 0, status.stderr);
  for (const result of [preparation, status]) {
    const report = JSON.parse(result.stdout).reporting; assert.equal(report.status, 'WRITTEN'); assert.equal(report.cases, 4);
    const view = JSON.parse(readFileSync(join(f.roots.projectRoot, report.directory, 'result.json')));
    assert.deepEqual(view.cases.map(row => row.id), original.scenarios.map(row => row.id));
    assert.deepEqual(view.cases.map(row => row.status), ['NOT_GENERATED', 'NOT_GENERATED', 'NOT_GENERATED', 'BLOCKED']);
    assert.deepEqual(view.cases.slice(1, 3).map(row => row.observedStatus), ['PASS', 'FAIL']);
    assert.equal(view.cases[3].reason, blockerNotes.cases[0].reason); assert.equal(view.coverage.ready, 0); assert.equal(view.coverage.complete, false);
  }
  const unbound = cli('report', '--id', selected.id, '--observed', `${paths}/observed.json`); assert.notEqual(unbound.status, 0);
  const bound = cli('report', '--id', selected.id, '--scope', `${paths}/original.json`, '--observed', `${paths}/observed.json`); assert.equal(bound.status, 0, bound.stderr);
  const continued = cli('status', '--id', selected.id); assert.equal(continued.status, 0, continued.stderr); assert.equal(JSON.parse(continued.stdout).reporting.cases, 4);
});

async function contractScope(t, f, original = f.source) {
  const selected = {...f.source, scenarios: f.source.scenarios.slice(0, 1)}, exploration = observed(t, selected);
  const before = await transaction(f.roots, f.source.id, state => structuredClone(state));
  put(f.roots.projectRoot, '.harness/state/accepted-contraction.md', 'Synthetic owner acceptance: defer the remaining cases while retaining the original reporting inventory.');
  const candidate = await reviseGeneration(f.roots, f.source.id, exploration.handoff, {config: f.candidate.config, tests: f.candidate.tests.slice(0, 1), repair: 'requirement-change', change: {previousSourceFingerprint: before.handoff.fingerprint, artifact: '.harness/state/accepted-contraction.md'}}, {source: original});
  return {...f, source: selected, candidate};
}

for (const retainedStatus of ['FAIL', 'SKIPPED', 'PASS']) test(`a contracted subset retains the prior ${retainedStatus} case result without carrying readiness forward`, async t => {
  const original = source(['selected', 'deferred']), f = await prepared(t, {source: original, reporting: {source: original}});
  const patch = (_test, index) => index === 0 || retainedStatus === 'PASS' ? {status: 'passed', errors: 0, assertions: {passed: 1, failed: 0}, failedChecks: []} : retainedStatus === 'SKIPPED' ? {status: 'skipped', errors: 0, assertions: {passed: 0, failed: 0}, failedChecks: []} : {};
  await recorded(f, retainedStatus === 'PASS' ? 'PASS' : 'FAIL', 'prior-first', patch);
  if (retainedStatus === 'PASS') {await recorded(f, 'PASS', 'prior-second'); assert.equal((await automationReportView(f.roots, {sourceId: f.source.id})).cases[1].status, 'READY');}
  await contractScope(t, f);
  const view = await automationReportView(f.roots, {sourceId: f.source.id}), deferred = view.cases[1];
  assert.equal(view.cases.length, 2); assert.equal(deferred.id, 'deferred'); assert.equal(deferred.status, retainedStatus);
  assert.equal(deferred.stage, 'VERIFY'); assert.equal(deferred.nativeStatus, retainedStatus === 'FAIL' ? 'failed' : retainedStatus === 'SKIPPED' ? 'skipped' : 'passed');
  assert.equal(deferred.observedStatus, 'PASS'); assert.equal(deferred.history.length, retainedStatus === 'PASS' ? 2 : 1);
  assert.equal(view.coverage.selected, 1); assert.equal(view.coverage.ready, 0); assert.equal(view.coverage.complete, false); assert.equal(view.greens, 0);
  const report = await writeAutomationReport(f.roots, {sourceId: f.source.id}); assert.equal(report.status, 'WRITTEN');
  const summary = readFileSync(join(f.roots.projectRoot, report.directory, 'summary.md'), 'utf8'), defects = readFileSync(join(f.roots.projectRoot, report.directory, 'defects.md'), 'utf8');
  assert.match(summary, new RegExp(`## deferred — ${retainedStatus === 'FAIL' ? 'Failed' : retainedStatus === 'SKIPPED' ? 'Skipped' : 'Passed'}`));
  if (retainedStatus === 'FAIL') assert.match(defects, /## deferred — Failed/);
});

test('not-run, pending and blocked verification records survive a later subset selection', async t => {
  for (const [recordedStatus, expected] of [[undefined, 'NOT_RUN'], ['STARTED', 'PENDING'], ['BLOCKED', 'BLOCKED']]) {
    const original = source(['selected', 'deferred']), f = await prepared(t, {source: original, reporting: {source: original}});
    if (recordedStatus) await transaction(f.roots, f.source.id, (state, save) => {
      state.runs.push({id: `prior-${recordedStatus.toLowerCase()}`, revision: f.candidate.revision, status: recordedStatus, reason: `The recorded verification is ${expected.toLowerCase()}.`, nextAction: 'Inspect the recorded execution before continuing.'}); save(state);
    });
    assert.equal((await automationReportView(f.roots, {sourceId: f.source.id})).cases[1].status, expected);
    await contractScope(t, f);
    const view = await automationReportView(f.roots, {sourceId: f.source.id}), deferred = view.cases[1];
    assert.equal(deferred.status, expected); assert.equal(deferred.stage, 'VERIFY'); assert.equal(view.coverage.ready, 0); assert.equal(view.coverage.complete, false);
    assert(deferred.reason); assert(deferred.nextAction); assert.equal(deferred.nativeStatus, undefined);
  }
});

test('a historical pass retains a later exploration failure and its explanation in attention outputs', async t => {
  const original = source(['selected', 'deferred']), f = await prepared(t, {source: original, reporting: {source: original}});
  await recorded(f, 'PASS', 'prior-pass'); await contractScope(t, f);
  const assessment = observed(t, {...original, id: 'deferred-exploration', scenarios: original.scenarios.slice(1)}, {statuses: ['FAIL']}).assessment;
  await recordGenerationReporting(f.roots, original.id, {source: original, observed: assessment});
  const before = await generationStatus(f.roots, original.id), view = await automationReportView(f.roots, {sourceId: original.id});
  assert.equal(view.cases[1].status, 'PASS'); assert.equal(view.cases[1].historical, true); assert.equal(view.cases[1].observedStatus, 'FAIL');
  assert.match(view.cases[1].observedReason, /failed|failure/i); assert(view.cases[1].observedNextAction);
  const report = await writeAutomationReport(f.roots, {sourceId: original.id}); assert.equal(report.status, 'WRITTEN');
  for (const name of ['index.html', 'summary.md', 'defects.md']) {
    const body = readFileSync(join(f.roots.projectRoot, report.directory, name), 'utf8');
    assert.match(body, /deferred/); assert.match(body, /Exploration result[^\n]*FAIL/); assert.match(body, /Exploration reason/); assert.match(body, /Exploration next action/);
  }
  assert.equal(view.coverage.ready, 0); assert.equal(view.coverage.complete, false); assert.deepEqual(await generationStatus(f.roots, original.id), before);
});

test('a changed deferred expectation cannot inherit an old pass and changed prior receipts require review', async t => {
  for (const changed of ['source', 'receipt']) {
    const original = source(['selected', 'deferred']), f = await prepared(t, {source: original, reporting: {source: original}});
    const saved = await recorded(f, 'PASS', 'prior-pass');
    const updated = structuredClone(original);
    if (changed === 'source') updated.scenarios[1].steps[0].expected[0] = 'A newly accepted expectation';
    await contractScope(t, f, updated);
    if (changed === 'receipt') {saved.receipt.tests[1].results[0].assertions.passed = 0; put(f.roots.projectRoot, saved.path, saved.receipt);}
    const view = await automationReportView(f.roots, {sourceId: f.source.id});
    assert.equal(view.cases[1].status, 'NEEDS_REVIEW', changed); assert.equal(view.coverage.ready, 0); assert.equal(view.coverage.complete, false);
    assert.equal(view.cases[1].nativeStatus, undefined, changed); assert(view.cases[1].reason); assert(view.cases[1].nextAction);
  }
});

test('heterogeneous requested outcomes agree across totals, filters and standard companions', async t => {
  const original = source(['native-pass', 'native-fail', 'native-skip', 'native-timeout', 'native-review', 'observed-pass', 'observed-fail', 'blocked', 'not-generated']);
  const selected = {...original, scenarios: original.scenarios.slice(0, 5)}, exploration = observed(t, {...original, id: 'explored-scope', scenarios: original.scenarios.slice(5, 7)}, {statuses: ['PASS', 'FAIL']});
  const blockerNotes = {version: 1, sourceFingerprint: fingerprint(original), cases: [{scenarioId: 'blocked', stage: 'REFINE', reason: 'The requested acceptance rule remains unresolved.', nextAction: 'Obtain the accepted expected result.'}]};
  const f = await prepared(t, {source: selected, reporting: {source: original, observed: exploration.assessment, notes: blockerNotes}});
  await recorded(f, 'FAIL', 'mixed-outcomes', (_test, index) => [
    {status: 'passed', errors: 0, assertions: {passed: 1, failed: 0}, failedChecks: []}, {},
    {status: 'skipped', errors: 0, assertions: {passed: 0, failed: 0}, failedChecks: []},
    {status: 'timedOut', errors: 1, assertions: {passed: 0, failed: 0}, failedChecks: []},
    {status: 'passed', errors: 0, assertions: {passed: 0, failed: 0}, failedChecks: []}
  ][index]);
  const view = await automationReportView(f.roots, {sourceId: f.source.id});
  assert.deepEqual(view.cases.map(row => row.status), ['PASS', 'FAIL', 'SKIPPED', 'BLOCKED', 'NEEDS_REVIEW', 'NOT_GENERATED', 'NOT_GENERATED', 'BLOCKED', 'NOT_GENERATED']);
  assert.deepEqual(view.cases.slice(5, 7).map(row => row.observedStatus), ['PASS', 'FAIL']);
  assert.equal(new Set(view.cases.map(row => row.id)).size, 9); assert.equal(view.coverage.total, 9); assert.equal(view.coverage.blocked, 2); assert.equal(view.coverage.ready, 0); assert.equal(view.coverage.complete, false);
  const report = await writeAutomationReport(f.roots, {sourceId: f.source.id}); assert.equal(report.status, 'WRITTEN');
  const saved = JSON.parse(readFileSync(join(f.roots.projectRoot, report.directory, 'result.json'))); assert.deepEqual(saved.cases, view.cases); assert.deepEqual(saved.coverage, view.coverage);
  const html = readFileSync(join(f.roots.projectRoot, report.html), 'utf8'); assert.match(html, /Showing 9 of 9 test cases/); assert.equal((html.match(/data-case data-order=/g) ?? []).length, 9);
  for (const [status, count] of [['PASS', 1], ['FAIL', 1], ['SKIPPED', 1], ['BLOCKED', 2], ['NEEDS_REVIEW', 1], ['NOT_GENERATED', 3]]) {
    assert(html.includes(`data-chart-status="${status}" data-count="${count}"`)); assert(html.includes(`value="${status}"`));
  }
  const summary = readFileSync(join(f.roots.projectRoot, report.directory, 'summary.md'), 'utf8'), defects = readFileSync(join(f.roots.projectRoot, report.directory, 'defects.md'), 'utf8');
  assert.equal((summary.match(/^## /gm) ?? []).length, 9); assert.equal((defects.match(/^## /gm) ?? []).length, 5);
  for (const id of ['native-fail', 'native-timeout', 'native-review', 'observed-fail', 'blocked']) assert(defects.replaceAll('\\-', '-').includes(id));
  assert.match(summary, /## native\\-skip — Skipped/); assert.match(summary, /## observed\\-pass — Not generated/);
});

test('all known production command blockers use plain report explanations and preserve original records', async t => {
  const f = fixture(t), input = source();
  for (const blocker of productionBlockers()) {
    const report = await writeAutomationReport(f.roots, {source: input, blocker}); assert.equal(report.status, 'WRITTEN');
    const view = JSON.parse(readFileSync(join(f.roots.projectRoot, report.directory, 'result.json')));
    assert.deepEqual(view.blocker, blocker); assert.equal(view.cases[0].reason, blocker.reason);
    assert.equal(view.cases[0].nextAction, blocker.nextAction); assert.equal(view.cases[0].status, 'BLOCKED');
    for (const name of ['index.html', 'summary.md', 'defects.md']) {
      const content = readFileSync(join(f.roots.projectRoot, report.directory, name), 'utf8');
      assert.doesNotMatch(content, /scoped green|fingerprint|repair classification|repair count|three.round|candidate|receipt|handoff|frozen|native.runner|native test|native verification|assertion counts|pinned consumer|protected diagnostics/i, name);
      assert(content.includes('Reason') || content.includes('reason'));
      assert.doesNotMatch(content, /The cases have not been executed yet|after they were reviewed/);
    }
  }
});

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
  assert(html.includes('id="status-filter"')); assert(html.includes('Complete requested scope'));
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
