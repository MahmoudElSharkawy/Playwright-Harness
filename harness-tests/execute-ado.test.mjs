import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync, mkdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {adoFixture} from './fixtures/ado.mjs';
import {executionFixture, executeApi} from './fixtures/execute.mjs';
import {createAdoClient} from '../scripts/lib/integrations/ado-client.mjs';
import {deliverExecution} from '../scripts/lib/execute/delivery.mjs';
import {createRun} from '../scripts/lib/execution-core/index.mjs';
import {runInput} from '../scripts/lib/execute/host.mjs';
import {readFrozen, writeJson, ownedFile, saveExecution} from '../scripts/lib/execute/storage.mjs';
import {writeExecutionReport} from '../scripts/lib/execute/report.mjs';
const writes = f => f.state.requests.filter(request => request.method !== 'GET' && request.path !== 'wit/workitemsbatch' && request.path !== 'wit/wiql' && !request.query.includes('validateOnly=true'));
async function fixture(t, {fail = false} = {}) {
  const ado = await adoFixture(t), execution = await executionFixture(t, {organizationUrl: ado.config.organizationUrl, handler: fail ? (req, res) => {res.writeHead(500); res.end('{}');} : undefined}); execution.apiStep(); execution.freeze(); const run = await executeApi(execution);
  const client = () => createAdoClient({configuration: ado.config, roots: execution.roots, resolveCredential: () => ado.credential, fetchImpl: ado.fetchImpl});
  const deliver = (command, options = {}) => deliverExecution(execution.roots, execution.executionId, command, options, {client: client()}); return {ado, execution, run, deliver};
}
test('bug preview validates fully with zero writes; create identities are acknowledged and repeated filing resumes', async t => {
  const f = await fixture(t, {fail: true}), preview = await f.deliver('file-bugs'); assert.equal(preview.bugs.length, 1); assert.equal(writes(f.ado).length, 0); assert(f.ado.state.requests.some(request => request.query.includes('validateOnly=true')));
  const actual = await f.deliver('file-bugs', {execute: true}); assert.equal(actual.bugs[0].state, 'COMPLETED'); await f.deliver('file-bugs', {execute: true}); assert.equal(writes(f.ado).filter(request => request.path === 'wit/workitems/$bug').length, 1);
});
test('lost bug create response adopts its filing tag without creating twice', async t => {
  const f = await fixture(t, {fail: true}); f.ado.state.afterBugCreate = ({res}) => res.destroy(); await assert.rejects(f.deliver('file-bugs', {execute: true}), /incomplete/); f.ado.state.afterBugCreate = null;
  const resumed = await f.deliver('file-bugs', {execute: true}); assert.equal(resumed.bugs[0].state, 'COMPLETED'); assert.equal(writes(f.ado).filter(request => request.path === 'wit/workitems/$bug').length, 1);
});
test('publication preview is read-only, lost create reconciles using paged client-side names, and new-run is unique', async t => {
  const f = await fixture(t); const preview = await f.deliver('publish-results'); assert.equal(preview.cases[0].outcome, 'Passed'); assert.equal(writes(f.ado).length, 0);
  f.ado.state.afterRunCreate = ({res}) => res.destroy(); await assert.rejects(f.deliver('publish-results', {execute: true}), /incomplete/); f.ado.state.afterRunCreate = null;
  const resumed = await f.deliver('publish-results', {execute: true}); assert.equal(resumed.runId, 55); await f.deliver('publish-results', {execute: true, 'new-run': true}); assert.equal(f.ado.state.runs.size, 2); assert.notEqual(f.ado.state.runs.get(55).name, f.ado.state.runs.get(56).name); assert(f.ado.state.requests.some(request => request.path === 'test/runs' && request.method === 'GET' && request.query.includes('planId=1') && !request.query.includes('name=')));
});
test('integrity failures block both deliveries before reads; valid rerun repairs selection', async t => {
  const f = await fixture(t); writeFileSync(join(f.run.roots.runRoot, f.run.result.evidence[0].path), 'tampered'); const before = f.ado.state.requests.length;
  for (const command of ['file-bugs', 'publish-results']) await assert.rejects(f.deliver(command), /Integrity failure blocks/); assert.equal(f.ado.state.requests.length, before);
  await executeApi(f.execution, {explicitRerun: true}); assert.equal((await f.deliver('publish-results')).cases[0].outcome, 'Passed');
});
test('changed revisions are flagged and excluded unless explicitly included', async t => {
  const f = await fixture(t); f.ado.state.items.get(101).rev = 2; const preview = await f.deliver('publish-results'); assert.deepEqual(preview.omitted, [{caseId: 101, reason: 'source-changed'}]);
  const included = await f.deliver('publish-results', {execute: true, 'include-changed': true}); assert.equal(included.count, 1); assert(f.ado.state.results[0].comment.includes('revision=1/2; SOURCE CHANGED')); assert(f.ado.state.results[0].comment.length <= 400);
  const requests = f.ado.state.requests.length, report = writeExecutionReport(f.execution.roots, f.execution.executionId), html = readFileSync(join(f.execution.projectRoot, report.directory, 'index.html'), 'utf8');
  assert.match(html, /Last checked before delivery/); assert.match(html, /executed revision 1; current revision 2 — SOURCE CHANGED/); assert.equal(f.ado.state.requests.length, requests);
});

test('bug paths support real structural roots and nested nodes without accepting another node', async t => {
  const f = await fixture(t, {fail: true}); f.ado.config.bugs = {areaPath: 'demo\\Area\\Team A', iterationPath: 'demo\\Release 1'};
  assert.equal((await f.deliver('file-bugs')).bugs.length, 1); assert.equal(writes(f.ado).length, 0);
  f.ado.state.fault = ({path, send}) => {if (path.startsWith('wit/classificationnodes/areas')) {send({path: '\\demo\\Area\\Other'}); return true;}};
  await assert.rejects(f.deliver('file-bugs'), /path did not match/); assert.equal(writes(f.ado).length, 0);
});

for (const omit of ['source-changed', 'no-verdict']) test(`point-map entries for ${omit} cases do not block eligible publication`, async t => {
  const ado = await adoFixture(t), execution = await executionFixture(t, {organizationUrl: ado.config.organizationUrl, cases: [101, 102].map(id => ({id, rev: 1, title: `Case ${id}`, parameters: null, steps: [{action: 'Read status', expected: 'Status is 200'}]}))});
  execution.apiStep(0, 0); execution.apiStep(0, 1); execution.freeze(); await executeApi(execution, {scenarioIndex: 1});
  if (omit === 'source-changed') {await executeApi(execution); ado.state.items.get(101).rev = 2;}
  const map = join(execution.projectRoot, 'points.json'); writeJson(map, {101: 11, 102: 12});
  const client = () => createAdoClient({configuration: ado.config, roots: execution.roots, resolveCredential: () => ado.credential, fetchImpl: ado.fetchImpl});
  const deliver = () => deliverExecution(execution.roots, execution.executionId, 'publish-results', {'point-map': map}, {client: client()});
  const preview = await deliver(); assert.deepEqual(preview.cases.map(tc => tc.caseId), [102]); assert.deepEqual(preview.omitted, [{caseId: 101, reason: omit}]);
  writeJson(map, {999: 11, 102: 12}); await assert.rejects(deliver(), /outside captured scope/); assert.equal(writes(ado).length, 0);
});

test('concurrent bug deliveries have one owner and cannot create duplicate work items', async t => {
  const f = await fixture(t, {fail: true});
  const deliveries = await Promise.allSettled([f.deliver('file-bugs', {execute: true}), f.deliver('file-bugs', {execute: true})]);
  assert.equal(deliveries.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(deliveries.find(result => result.status === 'rejected').reason.message, /BUSY/);
  assert.equal(writes(f.ado).filter(request => request.path === 'wit/workitems/$bug').length, 1);
});

test('a valid historical FAIL remains publishable after an interrupted rerun', async t => {
  const f = await fixture(t, {fail: true}), {roots, executionId} = f.execution, loaded = readFrozen(roots, executionId), runId = 'run-interrupted';
  const input = runInput(loaded.freeze, loaded.source.scenarios[0], loaded.freeze.scenarios[0], runId), run = createRun(input);
  writeJson(ownedFile(roots, executionId, `snapshots/${runId}.json`), {version: 1, executionId, scenarioId: loaded.source.scenarios[0].id, runId, freezeFingerprint: loaded.execution.freezeFingerprint, inputFingerprint: run.inputFingerprint, input, explicitRerun: true}, {exclusive: true});
  mkdirSync(ownedFile(roots, executionId, runId)); saveExecution(roots, executionId, {...loaded.execution, runs: [...loaded.execution.runs, {runId, scenarioId: loaded.source.scenarios[0].id, state: 'INTERRUPTED', startedAt: input.startedAt, explicitRerun: true}]});
  const preview = await f.deliver('publish-results'); assert.equal(preview.cases[0].outcome, 'Failed'); assert.equal(preview.omitted.length, 0);
});
