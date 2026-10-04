import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync, mkdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {adoFixture} from './fixtures/ado.mjs';
import {executionFixture, executeApi} from './fixtures/execute.mjs';
import {createAdoClient} from '../scripts/lib/integrations/ado-client.mjs';
import {deliverExecution, publicationIndexes} from '../scripts/lib/execute/delivery.mjs';
import {createRun, registerEvidence} from '../scripts/lib/execution-core/index.mjs';
import {runInput} from '../scripts/lib/execute/host.mjs';
import {readFrozen, writeJson, ownedFile, saveExecution} from '../scripts/lib/execute/storage.mjs';
import {writeExecutionReport, collectExecution, deliverableDefects, legacyCase} from '../scripts/lib/execute/report.mjs';
const writes = f => f.state.requests.filter(request => request.method !== 'GET' && request.path !== 'wit/workitemsbatch' && request.path !== 'wit/wiql' && !request.query.includes('validateOnly=true'));
async function fixture(t, {fail = false} = {}) {
  const ado = await adoFixture(t), execution = await executionFixture(t, {organizationUrl: ado.config.organizationUrl, handler: fail ? (req, res) => {res.writeHead(500); res.end('{}');} : undefined}); execution.apiStep(); execution.freeze(); const run = await executeApi(execution);
  const client = () => createAdoClient({configuration: ado.config, roots: execution.roots, resolveCredential: () => ado.credential, fetchImpl: ado.fetchImpl});
  const inventory = async () => [{pid: process.pid, identity: '1'}];
  const deliver = (command, options = {}) => deliverExecution(execution.roots, execution.executionId, command, options, {client: client(), inventory}); return {ado, execution, run, deliver};
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
  const deliver = () => deliverExecution(execution.roots, execution.executionId, 'publish-results', {'point-map': map}, {client: client(), inventory: async () => [{pid: process.pid, identity: '1'}]});
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

test('D5: unresolved cases need explicit inclusion and draft file:false excludes individual defects', async t => {
  const ado = await adoFixture(t), execution = await executionFixture(t, {organizationUrl: ado.config.organizationUrl}); const step = execution.apiStep(); step.expectations[0].conditions[0].ambiguous = true; execution.freeze(); await executeApi(execution);
  const deliver = options => deliverExecution(execution.roots, execution.executionId, 'file-bugs', options, {client: createAdoClient({configuration: ado.config, roots: execution.roots, resolveCredential: () => ado.credential, fetchImpl: ado.fetchImpl}), inventory: async () => [{pid: process.pid, identity: '1'}]});
  assert.equal((await deliver({execute: true})).bugs.length, 0); assert.equal(writes(ado).length, 0);
  const preview = await deliver({include: 'needs-review'}); assert.equal(preview.bugs.length, 1);
  const drafts = join(execution.projectRoot, 'drafts.json'); writeJson(drafts, {[preview.bugs[0].fingerprint]: {file: false}}); assert.equal((await deliver({include: 'needs-review', drafts, execute: true})).bugs.length, 0); assert.equal(writes(ado).length, 0);
});

test('D5: legacy browser occurrences do not exclude a valid API defect but do exclude historical publication', async t => {
  const f = await fixture(t, {fail: true}), view = collectExecution(f.execution.roots, f.execution.executionId), run = view.runs[0];
  const legacy = {...run.conditions[0], id: 'legacy', index: 2, family: 'browser', legacy: true}; run.conditions.push(legacy);
  assert.equal(deliverableDefects(view).defects.length, 1); assert.equal(deliverableDefects(view).defects[0].occurrences.length, 1); assert(legacyCase(view, 101));
  view.scenarios[0].selectedRunId = 'later'; assert(legacyCase(view, 101));
  run.diagnostics = [{stepId: run.conditions[0].stepId, evidenceId: 'diag', family: 'browser', legacy: true, entries: [{kind: 'console', detail: 'Old diagnostic'}]}];
  assert.equal(deliverableDefects(view, 'diagnostics').defects.length, 1);
  run.diagnostics[0].legacy = false; assert.equal(deliverableDefects(view, 'diagnostics').defects.length, 2);
});

test('D8: interrupted publication resumes its original identity and comments after Bug filing', async t => {
  const f = await fixture(t, {fail: true}); f.ado.state.afterRunCreate = ({res}) => res.destroy(); await assert.rejects(f.deliver('publish-results', {execute: true}), /incomplete/); f.ado.state.afterRunCreate = null;
  await f.deliver('file-bugs', {execute: true}); const resumed = await f.deliver('publish-results', {execute: true}); assert.equal(resumed.runId, 55); assert.equal(f.ado.state.runs.size, 1); assert.equal(f.ado.state.runs.get(55).state, 'Completed'); assert.match(f.ado.state.results[0].comment, /bugs=none/);
});

for (const stage of ['results', 'complete']) test(`D8 S7: lost ${stage} acknowledgement resumes the same publication without recreating its run`, async t => {
  const f = await fixture(t); let lost = false;
  f.ado.state.fault = ({req, res, path, body}) => {
    if (lost || req.method !== 'PATCH' || path !== (stage === 'results' ? 'test/runs/55/results' : 'test/runs/55')) return;
    lost = true;
    if (stage === 'results') for (const row of body) Object.assign(f.ado.state.results.find(item => item.id === row.id), row);
    else Object.assign(f.ado.state.runs.get(55), body);
    res.destroy(); return true;
  };
  await assert.rejects(f.deliver('publish-results', {execute: true}), /incomplete/); assert(lost); f.ado.state.fault = null;
  const resumed = await f.deliver('publish-results', {execute: true}); assert.equal(resumed.runId, 55); assert.equal(f.ado.state.runs.size, 1); assert.equal(f.ado.state.runs.get(55).state, 'Completed');
  assert.equal(writes(f.ado).filter(row => row.path === 'test/runs' && row.method === 'POST').length, 1);
});

test('D8 S7: lost attachment-link acknowledgement reuses the verified upload and existing relation', async t => {
  const f = await fixture(t, {fail: true}), observations = JSON.parse(readFileSync(join(f.run.roots.runRoot, 'observations.json'))), attempt = observations.scenarios[0].attempts[0], path = 'evidence/context.png';
  writeFileSync(join(f.run.roots.runRoot, path), Buffer.from('89504e470d0a1a0a', 'hex'));
  const record = registerEvidence(f.run.run, f.run.roots, {id: 'context', kind: 'screenshot', identity: attempt.identity, path, sanitized: true}); observations.evidence.push(record); attempt.evidenceIds.push(record.id); writeJson(join(f.run.roots.runRoot, 'observations.json'), observations);
  let lost = false; f.ado.state.fault = ({req, res, path, body}) => {
    if (lost || req.method !== 'PATCH' || path !== 'wit/workitems/800' || !body.some(row => row.value?.rel === 'AttachedFile')) return;
    lost = true; const item = f.ado.state.items.get(800); item.relations ??= []; item.relations.push(body.find(row => row.value?.rel === 'AttachedFile').value); item.rev++; res.destroy(); return true;
  };
  await assert.rejects(f.deliver('file-bugs', {execute: true}), /incomplete/); assert(lost); f.ado.state.fault = null;
  assert.equal((await f.deliver('file-bugs', {execute: true})).bugs[0].state, 'COMPLETED');
  assert.equal(f.ado.state.attachments.size, 1); assert.equal(f.ado.state.items.get(800).relations.filter(row => row.rel === 'AttachedFile').length, 1);
});

test('D8: an uncertain upload does not block another defect; recreation is scoped to its exact hash', async t => {
  const ado = await adoFixture(t), execution = await executionFixture(t, {organizationUrl: ado.config.organizationUrl, cases: [101, 102].map(id => ({id, rev: 1, title: `Case ${id}`, parameters: null, steps: [{action: 'Read status', expected: 'Status is 200'}]})), handler: (_, res) => {res.writeHead(500); res.end('{}');}});
  execution.apiStep(0, 0); execution.apiStep(0, 1); execution.freeze();
  for (let i = 0; i < 2; i++) {
    const executed = await executeApi(execution, {scenarioIndex: i}), observations = JSON.parse(readFileSync(join(executed.roots.runRoot, 'observations.json'), 'utf8')), attempt = observations.scenarios[0].attempts[0];
    const path = 'evidence/context.png'; writeFileSync(join(executed.roots.runRoot, path), Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from(String(i))]));
    const record = registerEvidence(executed.run, executed.roots, {id: 'context', kind: 'screenshot', identity: attempt.identity, path, sanitized: true}); observations.evidence.push(record); attempt.evidenceIds.push(record.id); writeJson(join(executed.roots.runRoot, 'observations.json'), observations);
  }
  let uploads = 0; ado.state.fault = ({path, res}) => {if (path === 'wit/attachments' && ++uploads === 1) {res.destroy(); return true;}};
  const deliver = options => deliverExecution(execution.roots, execution.executionId, 'file-bugs', options, {client: createAdoClient({configuration: ado.config, roots: execution.roots, resolveCredential: () => ado.credential, fetchImpl: ado.fetchImpl}), inventory: async () => [{pid: process.pid, identity: '1'}]});
  const first = await deliver({execute: true}); assert.deepEqual(first.bugs.map(item => item.state), ['ATTACHMENTS_PENDING', 'COMPLETED']); assert.equal(uploads, 2);
  const second = await deliver({execute: true}); assert.equal(second.bugs[0].state, 'ATTACHMENTS_PENDING'); assert.equal(uploads, 2);
  const third = await deliver({execute: true, recreate: first.bugs[0].uncertainAttachments[0]}); assert(third.bugs.every(item => item.state === 'COMPLETED')); assert.equal(uploads, 3); assert.equal(writes(ado).filter(item => item.path === 'wit/workitems/$bug').length, 2);
});

test('U4: publication indexes visit 500 cases and 50 defects once', () => {
  const view = {scenarios: [], source: {organizationUrl: 'https://ado.example.test', project: 'demo', scenarios: []}, freeze: {scenarios: []}, runs: []};
  for (let i = 0; i < 500; i++) {const id = `s${i}`, key = `k${i}`; view.scenarios.push({id, caseId: i + 1}); view.source.scenarios.push({id, caseId: i + 1, title: id, expectations: [{key, step: 1, expected: 1, template: 'expected'}]}); view.freeze.scenarios.push({id, steps: []}); view.runs.push({runId: `r${i}`, scenarioId: id, state: 'ASSESSED', conditions: i < 50 ? [{key, index: 1, status: 'FAIL', method: 'checked', condition: {text: 'expected'}, evidenceIds: [], family: 'api'}] : [], diagnostics: []});}
  const counters = {}, indexes = publicationIndexes(view, view.scenarios.map(item => ({id: item.caseId, testCase: {id: item.caseId}})), counters);
  assert.deepEqual(counters, {points: 500, scenarios: 500, runs: 500, defectPasses: 1}); assert.equal(indexes.defectCases.size, 50);
  const bugs = [...indexes.defectCases].map(([fingerprint], i) => ({fingerprint, workItemId: i + 1000})), measured = {}, withBugs = publicationIndexes(view, [], measured, {bugs});
  assert.equal(measured.bugs, 50); assert.equal(withBugs.bugIds.size, 50); assert.equal(measured.defectPasses, 1);
});
