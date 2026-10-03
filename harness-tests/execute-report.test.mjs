import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {executionFixture, executeApi} from './fixtures/execute.mjs';
import {collectExecution, writeExecutionReport, defectFingerprint, diagnosticSignature, executionDefects} from '../scripts/lib/execute/report.mjs';
test('report ignores claimed result JSON, labels integrity failures, and accepts an explicit valid replacement', async t => {
  const f = await executionFixture(t); f.apiStep(); f.freeze(); const first = await executeApi(f);
  writeFileSync(join(first.roots.runRoot, 'result.json'), '{"status":"FAIL"}'); assert.equal(collectExecution(f.roots, f.executionId).scenarios[0].status, 'PASS');
  writeFileSync(join(first.roots.runRoot, first.result.evidence[0].path), 'tampered'); let view = collectExecution(f.roots, f.executionId); assert.deepEqual(view.integrityFailures, ['tc-101-r1']); assert.equal(view.scenarios[0].status, null);
  const report = writeExecutionReport(f.roots, f.executionId); assert(readFileSync(join(f.projectRoot, report.directory, 'index.html'), 'utf8').includes('INTEGRITY FAILURE (no verdict)'));
  await executeApi(f, {explicitRerun: true}); view = collectExecution(f.roots, f.executionId); assert.equal(view.scenarios[0].status, 'PASS'); assert.equal(view.integrityFailures.length, 0); assert(view.scenarios[0].history[0].supersededIntegrity);
});
test('valid historical FAIL dominates a later valid PASS and HTML is escaped with CSP', async t => {
  let status = 500; const f = await executionFixture(t, {handler: (req, res) => {res.writeHead(status); res.end('{}');}, cases: [{id: 101, rev: 1, title: '<script>window.bad=1</script>', parameters: null, steps: [{action: 'Read status', expected: 'Status is 200'}]}]}); f.apiStep(); f.freeze(); await executeApi(f); status = 200; await executeApi(f, {explicitRerun: true}); assert.equal(collectExecution(f.roots, f.executionId).scenarios[0].status, 'FAIL');
  const report = writeExecutionReport(f.roots, f.executionId), html = readFileSync(join(f.projectRoot, report.directory, 'index.html'), 'utf8'); assert(html.includes("default-src 'none'")); assert(!html.includes('<script>')); assert(html.includes('&lt;script&gt;'));
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
});

test('diagnostic defects merge parameterized iterations through the report caller', () => {
  const source = {organizationUrl: 'https://ado.example.test', project: 'demo', scenarios: ['alice', 'bob'].map((user, index) => ({id: `case-${index}`, caseId: 101, title: 'Read user', bindings: {user}}))};
  const freeze = {scenarios: source.scenarios.map(scenario => ({id: scenario.id, steps: [{id: 's1', sourceSteps: [1]}]}))};
  const runs = source.scenarios.map(scenario => ({scenarioId: scenario.id, runId: `run-${scenario.id}`, state: 'ASSESSED', conditions: [], result: {scenarios: [{attempts: []}]}, diagnostics: [{stepId: 's1', evidenceId: `e-${scenario.id}`, entries: [{kind: 'request', path: `/users/${scenario.bindings.user}`}]}]}));
  const groups = executionDefects({source, freeze, runs}); assert.equal(groups.length, 1); assert.equal(groups[0].occurrences.length, 2);
});
