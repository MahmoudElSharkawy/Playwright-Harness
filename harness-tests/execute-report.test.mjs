import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {executionFixture, executeApi} from './fixtures/execute.mjs';
import {collectExecution, writeExecutionReport, defectFingerprint, diagnosticSignature} from '../scripts/lib/execute/report.mjs';
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
