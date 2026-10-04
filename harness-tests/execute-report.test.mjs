import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {executionFixture, executeApi} from './fixtures/execute.mjs';
import {collectExecution, writeExecutionReport, defectFingerprint, diagnosticSignature, executionDefects} from '../scripts/lib/execute/report.mjs';
import {executionOverview, renderExecutionHtml} from '../scripts/lib/execute/report-html.mjs';
import {executionReportView, reportCondition} from './fixtures/execute-report.mjs';
test('report ignores claimed result JSON, labels integrity failures, and accepts an explicit valid replacement', async t => {
  const f = await executionFixture(t); f.apiStep(); f.freeze(); const first = await executeApi(f);
  writeFileSync(join(first.roots.runRoot, 'result.json'), '{"status":"FAIL"}'); assert.equal(collectExecution(f.roots, f.executionId).scenarios[0].status, 'PASS');
  writeFileSync(join(first.roots.runRoot, first.result.evidence[0].path), 'tampered'); let view = collectExecution(f.roots, f.executionId); assert.deepEqual(view.integrityFailures, ['tc-101-r1']); assert.equal(view.scenarios[0].status, null);
  const report = writeExecutionReport(f.roots, f.executionId); assert(readFileSync(join(f.projectRoot, report.directory, 'index.html'), 'utf8').includes('INTEGRITY FAILURE (no verdict)'));
  await executeApi(f, {explicitRerun: true}); view = collectExecution(f.roots, f.executionId); assert.equal(view.scenarios[0].status, 'PASS'); assert.equal(view.integrityFailures.length, 0); assert(view.scenarios[0].history[0].supersededIntegrity);
});
test('valid historical FAIL dominates a later valid PASS and HTML is escaped with CSP', async t => {
  let status = 500; const f = await executionFixture(t, {handler: (req, res) => {res.writeHead(status); res.end('{}');}, cases: [{id: 101, rev: 1, title: '<script>window.bad=1</script>', parameters: null, steps: [{action: 'Read status', expected: 'Status is 200'}]}]}); f.apiStep(); f.freeze(); await executeApi(f); status = 200; await executeApi(f, {explicitRerun: true}); assert.equal(collectExecution(f.roots, f.executionId).scenarios[0].status, 'FAIL');
  const report = writeExecutionReport(f.roots, f.executionId), html = readFileSync(join(f.projectRoot, report.directory, 'index.html'), 'utf8'); assert(html.includes("default-src 'none'")); assert(!html.includes('<script>window.bad=1</script>')); assert(html.includes('&lt;script&gt;'));
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]; assert.equal(script.length, 1);
  assert(html.includes(`script-src 'sha256-${createHash('sha256').update(script[0][1]).digest('base64')}'`));
  assert(!/script-src[^;]*unsafe-inline/.test(html));
  assert(html.includes('Expected value')); assert(html.includes('500'));
});
test('defect identity is independent of iteration, environment, values and execution identity', () => {
  const source = {organizationUrl: 'https://ado.example.test', project: 'demo'}, base = {kind: 'expectation', caseId: 101, sourceStep: 1, expectedIndex: 1, conditionIndex: 1, conditionTemplate: 'Value is @name'};
  assert.equal(defectFingerprint(source, {...base, iteration: 1, value: 'A', runId: 'one'}), defectFingerprint(source, {...base, iteration: 2, value: 'B', runId: 'two'})); assert.notEqual(defectFingerprint(source, base), defectFingerprint(source, {...base, conditionIndex: 2}));
});

test('diagnostic grouping normalizes numeric and UUID path identities', () => {
  assert.equal(diagnosticSignature('/api/v1/records/123'), diagnosticSignature('/api/v1/records/456'));
  assert.equal(diagnosticSignature('/records/991a3162-b359-4362-ac88-76d0d6368f00'), diagnosticSignature('/records/ab7a3162-b359-4362-ac88-76d0d6368f01'));
});

test('diagnostic signatures template string parameters, encoded values and environment origins', () => {
  for (const template of ['/users/VALUE', 'Request https://ENV.example.test/users/VALUE failed', 'Unable to load "VALUE"']) {
    const first = diagnosticSignature(template.replaceAll('VALUE', 'alice').replace('ENV', 'qa'), {bindings: {user: 'alice'}});
    const second = diagnosticSignature(template.replaceAll('VALUE', 'bob').replace('ENV', 'staging'), {bindings: {user: 'bob'}});
    assert.equal(first, second);
  }
  assert.equal(diagnosticSignature('/users/Alice%20Smith', {bindings: {user: 'Alice Smith'}}), diagnosticSignature('/users/Bob%20Jones', {bindings: {user: 'Bob Jones'}}));
  assert.equal(diagnosticSignature('/users/alice', {bindings: {user: 'a'}}), '/users/alice');
  assert.equal(diagnosticSignature('/records/created-one', {values: ['created-one']}), diagnosticSignature('/records/created-two', {values: ['created-two']}));
  assert.equal(diagnosticSignature('/reviewers/alice', {bindings: {owner: 'alice', reviewer: 'alice'}}), diagnosticSignature('/reviewers/carol', {bindings: {owner: 'bob', reviewer: 'carol'}}));
});

test('large valid API assertions remain assessed FAIL instead of an integrity failure', async t => {
  const f = await executionFixture(t, {steps: [{action: 'Read value', expected: 'Value is "ok"'}], handler: (req, res) => {res.writeHead(200, {'content-type': 'application/json'}); res.end(JSON.stringify({value: 'x'.repeat(100000)}));}}), step = f.apiStep();
  step.expectations[0].conditions[0].expected.value = 'ok'; Object.assign(step.operation.checks[0], {select: {from: 'json', path: ['value']}, equals: 'ok'});
  f.freeze(); const run = await executeApi(f); assert.equal(run.result.status, 'FAIL'); assert(run.result.evidence.some(record => record.kind === 'assertion' && record.bytes > 64 * 1024));
  const report = writeExecutionReport(f.roots, f.executionId); assert.equal(report.scenarios[0].status, 'FAIL'); assert.equal(report.scenarios[0].state, 'ASSESSED');
  assert(report.directory.startsWith(`reports/harness/${f.executionId}-`)); assert(!report.directory.includes('/execute-execute-'));
});

test('diagnostic defects merge parameterized iterations through the report caller', () => {
  const source = {organizationUrl: 'https://ado.example.test', project: 'demo', scenarios: ['alice', 'bob'].map((user, index) => ({id: `case-${index}`, caseId: 101, title: 'Read user', bindings: {user}}))};
  const freeze = {scenarios: source.scenarios.map(scenario => ({id: scenario.id, steps: [{id: 's1', sourceSteps: [1]}]}))};
  const runs = source.scenarios.map(scenario => ({scenarioId: scenario.id, runId: `run-${scenario.id}`, state: 'ASSESSED', conditions: [], result: {scenarios: [{attempts: []}]}, diagnostics: [{stepId: 's1', evidenceId: `e-${scenario.id}`, entries: [{kind: 'request', path: `/users/${scenario.bindings.user}`}]}]}));
  const groups = executionDefects({source, freeze, runs}); assert.equal(groups.length, 1); assert.equal(groups[0].occurrences.length, 2);
});

test('overview keeps historical review separate and uses supplied source-expectation rollups', () => {
  const view = executionReportView(['PASS', 'FAIL']);
  view.scenarios[0].methods = {checked: 0, observed: 0, mixed: 1, unresolved: 0};
  const historical = {...view.runs[0], runId: 'run-earlier', conditions: [reportCondition('INDETERMINATE')], result: {...view.runs[0].result, status: 'NEEDS_REVIEW'}};
  view.runs.unshift(historical); view.scenarios[0].history.unshift({runId: historical.runId, state: 'ASSESSED', verdict: 'NEEDS_REVIEW'});
  assert.deepEqual(executionOverview(view, 7), {total: 2, passed: 1, failed: 1, review: 0, attempts: 3, defectGroups: 7, passRate: 50,
    outcomes: [{status: 'PASS', count: 1, percentage: 50}, {status: 'FAIL', count: 1, percentage: 50}]});
  const before = JSON.stringify(view), html = renderExecutionHtml(view, {defectCount: 7});
  assert.equal(JSON.stringify(view), before); assert(html.includes('Historical')); assert(html.includes('run-earlier')); assert(html.includes('1 mixed'));
  assert.equal((html.match(/data-chart-status=/g) ?? []).length, 2); assert(!html.includes('data-chart-status="NEEDS_REVIEW"'));
  assert(html.includes('Insufficient evidence')); assert(html.includes('defects.md'));
});

test('empty and uniform outcome reports have meaningful rates and actual chart categories', () => {
  const empty = executionReportView([]), emptyHtml = renderExecutionHtml(empty);
  assert.equal(executionOverview(empty, 0).passRate, null); assert(emptyHtml.includes('No test cases recorded')); assert(emptyHtml.includes('data-metric="pass-rate">—'));
  assert(!emptyHtml.includes('data-chart-status=')); assert(!emptyHtml.includes('NaN')); assert(!emptyHtml.includes('Infinity'));
  for (const [status, rate] of [['PASS', '100.0%'], ['FAIL', '0.0%']]) {
    const html = renderExecutionHtml(executionReportView([status, status]));
    assert(html.includes(`data-metric="pass-rate">${rate}`)); assert.equal((html.match(/data-chart-status=/g) ?? []).length, 1);
    assert(html.includes(`data-chart-status="${status}" data-count="2"`));
  }
  const mixed = renderExecutionHtml(executionReportView(['PASS', 'FAIL', 'NEEDS_REVIEW', 'BLOCKED', 'NOT_RUN', 'INTEGRITY_FAILURE', 'SKIPPED']));
  assert.equal((mixed.match(/data-chart-status=/g) ?? []).length, 7); assert(mixed.includes('INTEGRITY FAILURE (no verdict)')); assert(mixed.includes('data-metric="pass-rate">14.3%'));
});

test('raw payloads stay complete and escaped; screenshots deduplicate without losing run references', () => {
  const view = executionReportView(['FAIL']);
  const payload = '</script><img src=x onerror=alert(1)>' + 'long '.repeat(200);
  view.scenarios[0].title = payload; view.runs[0].conditions[0].provenance.results[0].actual = payload;
  const entry = {kind: 'request', path: '/records/1', status: 500, notice: false};
  view.runs[0].diagnostics = [{stepId: 'step-1', evidenceId: 'd1', entries: [entry, {...entry}], family: 'browser', legacy: false}];
  const src = 'data:image/png;base64,iVBORw0KGgo=';
  const screenshots = new Map([['run-1', [{id: 'artifact-1', src}, {id: 'artifact-2', src}]]]);
  const html = renderExecutionHtml(view, {screenshots});
  assert(!html.includes('<img src=x')); assert(html.includes('&lt;/script&gt;&lt;img'));
  assert.equal((html.match(/data:image\/png;base64,/g) ?? []).length, 1);
  assert(html.includes('artifact-1')); assert(html.includes('artifact-2')); assert(html.includes('2 recorded occurrences · 1 distinct message'));
  assert(html.includes('2 occurrences')); assert(html.includes('Screenshot 1')); assert(html.includes('Screenshot 2'));
  const raws = [...html.matchAll(/<pre data-raw-json>([\s\S]*?)<\/pre>/g)].map(match => JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')));
  assert.deepEqual(raws[0], view.runs[0].conditions[0].provenance); assert.deepEqual(raws[2], view.runs[0].diagnostics);
  assert(!html.includes('<time')); assert(!html.includes('Environment <strong>'));
});

test('API proof presentation preserves false, zero, null, redaction and original proof fields', () => {
  const view = executionReportView(['FAIL']); view.runs[0].conditions[0].provenance = null;
  for (const actual of [false, 0, null, '[REDACTED]']) {
    const proof = {check: 'status', expected: true, actual, passed: false, method: 'original-field'};
    const html = renderExecutionHtml(view, {assertionEvidence: new Map([['run-1:artifact-1', proof]])});
    assert(html.includes('Actual result')); assert(html.includes('original-field')); assert(html.includes('&quot;passed&quot;: false'));
    assert(!html.includes('No actual value is recorded'));
    assert(html.includes(`<strong>Recorded result:</strong> ${actual === null ? 'null' : String(actual)}`));
  }
});
