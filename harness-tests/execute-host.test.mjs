import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {executionFixture} from './fixtures/execute.mjs';
import {startScenario, runHostedScenario, runInput} from '../scripts/lib/execute/host.mjs';
import {controlDirectory, sendCommand, delay} from '../scripts/lib/execute/mailbox.mjs';
import {readBounded, readFrozen, ownedFile, writeJson, saveExecution} from '../scripts/lib/execute/storage.mjs';
import {collectExecution, writeExecutionReport} from '../scripts/lib/execute/report.mjs';
import {processInventory} from '../scripts/lib/browser/processes.mjs';
import {createRun} from '../scripts/lib/execution-core/index.mjs';
import {acquireLauncher, lockStatus, releaseHost} from '../scripts/lib/execute/lock.mjs';
import {commandFixture} from './fixtures/execute-commands.mjs';
import {fixture as coreFixture} from './fixtures/execution-core.mjs';

async function hostedFixture(f, runId) {
  f.freeze(); const loaded = readFrozen(f.roots, f.executionId), scenario = loaded.freeze.scenarios[0];
  const input = runInput(loaded.freeze, loaded.source.scenarios[0], scenario, runId), run = createRun(input);
  writeJson(ownedFile(f.roots, f.executionId, `snapshots/${runId}.json`), {version: 1, executionId: f.executionId, runId, scenarioId: scenario.id, freezeFingerprint: loaded.execution.freezeFingerprint, inputFingerprint: run.inputFingerprint, input}, {exclusive: true});
  saveExecution(f.roots, f.executionId, {...loaded.execution, runs: [{runId, scenarioId: scenario.id, state: 'STARTING', startedAt: input.startedAt}]});
  return {owner: await acquireLauncher(f.roots, {executionId: f.executionId, runId}), scenario};
}
test('detached API-only host completes, reassesses, reports, and needs no browser or unrelated secrets', async t => {
  const f = await executionFixture(t); f.apiStep(); f.freeze(); const started = await startScenario(f.roots, f.executionId, {readyTimeoutMs: 15000}); assert.equal(started.status, 'READY');
  const directory = controlDirectory(f.roots, f.executionId, started.runId), reply = await sendCommand(directory, started.runId, ['begin-step', 's001'], {timeoutMs: 10000}); assert.equal(reply.status, 'STEP_COMPLETE'); assert.equal(reply.assertions[0].status, 'PASS');
  for (let i = 0; i < 100 && readBounded(join(directory, 'host.json')).state !== 'FINISHED'; i++) await delay(50);
  const view = collectExecution(f.roots, f.executionId); assert.equal(view.scenarios[0].status, 'PASS'); assert.equal(view.runs[0].result.scenarios[0].resources.length, 0); assert.equal(f.requests.length, 1);
  const report = writeExecutionReport(f.roots, f.executionId); assert.equal(report.status, 'WRITTEN'); assert.equal(report.scenarios[0].methods.checked, 1);
  const pid = readBounded(join(directory, 'host.json')).pid; for (let i = 0; i < 10 && (await processInventory()).some(item => item.pid === pid); i++) await delay(100);
});

for (const retain of [false, true]) test(`mailbox persistence failure aborts runtime before ${retain ? 'retaining incomplete cleanup ownership' : 'releasing cleaned ownership'}`, async t => {
  const f = await executionFixture(t); f.apiStep(); f.freeze(); const loaded = readFrozen(f.roots, f.executionId), runId = 'run-mailbox-fault';
  const input = runInput(loaded.freeze, loaded.source.scenarios[0], loaded.freeze.scenarios[0], runId), run = createRun(input);
  writeJson(ownedFile(f.roots, f.executionId, `snapshots/${runId}.json`), {version: 1, executionId: f.executionId, runId, scenarioId: loaded.source.scenarios[0].id, freezeFingerprint: loaded.execution.freezeFingerprint, inputFingerprint: run.inputFingerprint, input}, {exclusive: true});
  saveExecution(f.roots, f.executionId, {...loaded.execution, runs: [{runId, scenarioId: loaded.source.scenarios[0].id, state: 'STARTING', startedAt: input.startedAt}]});
  const owner = await acquireLauncher(f.roots, {executionId: f.executionId, runId}); let signal, settled = false;
  const protectedPath = ownedFile(f.roots, f.executionId, `${runId}/protected`);
  const runtime = async (run, roots, options) => {signal = options.signal; mkdirSync(protectedPath, {recursive: true}); return new Promise(resolve => {signal.addEventListener('abort', () => {setTimeout(() => {if (!retain) rmSync(protectedPath, {recursive: true}); settled = true; resolve({status: 'BLOCKED'});}, 20);}, {once: true});});};
  const mailboxFactory = () => ({save() {}, take() {throw new Error('Mailbox persistence failure');}});
  await assert.rejects(runHostedScenario(f.roots, f.executionId, runId, owner.nonce, {runtime, mailboxFactory}), /Mailbox persistence failure/);
  assert.equal(signal.aborted, true); assert.equal(settled, true);
  const remaining = await lockStatus(f.roots); assert.equal(Boolean(remaining), retain);
  if (retain) {assert.equal(remaining.nonce, owner.nonce); rmSync(protectedPath, {recursive: true}); await releaseHost(f.roots, owner.nonce);}
});

test('an integrity failure at end-step prevents dispatch of the next frozen mutation', async t => {
  const f = await executionFixture(t, {browser: true, steps: [{action: '', expected: 'Save is disabled'}, {action: 'Submit change', expected: 'Save is disabled'}]}), runId = 'run-integrity-stop';
  for (const step of f.refinement.scenarios[0].steps) Object.assign(step.expectations[0].conditions[0], {predicate: 'state:disabled', subject: {element: {role: 'button', name: 'Save'}}});
  const {owner, scenario} = await hostedFixture(f, runId), core = coreFixture(t), native = commandFixture(core.roots.projectRoot, {core}), begun = [], replies = [], state = {};
  const key = scenario.steps[0].contracts[0].key, queue = [['begin-step', 's001'], ['check', key, '--read', 'state e1'], ['end-step', '--effect', 'confirmed'], ['begin-step', 's002']];
  const runtime = async (run, roots, options, callbacks) => {
    await callbacks.exercise({browser: {attempt: async (input, action) => {begun.push(input.invocationId); await action(native.context); return {outputs: []};}}});
    return {status: 'BLOCKED'};
  };
  const mailboxFactory = () => ({state, save(patch) {Object.assign(state, patch);}, take() {return queue.length ? {args: queue.shift()} : null;}, reply(request, reply) {
    replies.push(reply); if (request.args[0] === 'check') {const record = core.report.evidence.find(item => item.id === reply.result.evidenceIds[0]); writeFileSync(join(core.roots.runRoot, record.path), 'tampered');}
  }});
  await runHostedScenario(f.roots, f.executionId, runId, owner.nonce, {runtime, mailboxFactory});
  assert.deepEqual(begun, ['s001']); assert(replies.some(reply => reply.reason === 'EVIDENCE_INTEGRITY_FAILURE')); assert.equal(state.stopReason, 'EVIDENCE_INTEGRITY_FAILURE'); assert.equal(native.assertions.length, 0);
});

test('cleanup returns before its deadline with time reserved for owned shutdown', async t => {
  const f = await executionFixture(t), runId = 'run-cleanup-reserve'; f.apiStep().phase = 'CLEANUP'; f.refinement.limits.cleanupTimeoutMs = 2000;
  const {owner} = await hostedFixture(f, runId), state = {}; let elapsed, aborted;
  const runtime = async (run, roots, options, callbacks) => {const started = Date.now(); await callbacks.cleanup({}); elapsed = Date.now() - started; aborted = options.signal.aborted; return {status: 'BLOCKED'};};
  const mailboxFactory = () => ({state, save(patch) {Object.assign(state, patch);}, take() {return null;}});
  await runHostedScenario(f.roots, f.executionId, runId, owner.nonce, {runtime, mailboxFactory});
  assert.equal(state.stopReason, 'CLEANUP_RESERVE'); assert(aborted); assert(elapsed >= 900 && elapsed < 1800, `Cleanup consumed ${elapsed} ms of its 2000 ms window`);
});

test('in-flight API cleanup is cancelled within the reserved work window', async t => {
  let requestedAt, repliedAt; const f = await executionFixture(t, {handler: (req, res) => {requestedAt = Date.now(); setTimeout(() => {if (!res.destroyed) {res.writeHead(200); res.end('{}');}}, 2100);}}), runId = 'run-cleanup-inflight';
  f.apiStep().phase = 'CLEANUP'; f.refinement.limits.cleanupTimeoutMs = 2400; const {owner} = await hostedFixture(f, runId), state = {}, queue = [['begin-step', 's001']], replies = [];
  const mailboxFactory = () => ({state, save(patch) {Object.assign(state, patch);}, take() {return queue.length && state.state === 'READY' && state.step === queue[0][1] ? {args: queue.shift()} : null;}, reply(request, result) {repliedAt = Date.now(); replies.push(result);}});
  await runHostedScenario(f.roots, f.executionId, runId, owner.nonce, {mailboxFactory});
  assert(requestedAt); assert(repliedAt - requestedAt < 1800, `Request consumed ${repliedAt - requestedAt} ms`); assert.equal(replies[0].outcome, 'INFRASTRUCTURE_FAILURE');
  assert.equal(collectExecution(f.roots, f.executionId).runs[0].state, 'ASSESSED');
});

test('API-only output accumulation stops before corrupting bounded observations or dispatching later steps', async t => {
  const f = await executionFixture(t, {steps: Array.from({length: 6}, () => ({action: 'Read large value', expected: 'Status is 200'})), handler: (req, res) => {res.writeHead(200, {'content-type': 'application/json'}); res.end(JSON.stringify({value: 'x'.repeat(180000)}));}}), runId = 'run-api-budget';
  for (let i = 0; i < 6; i++) f.apiStep(i).operation.extract = [{name: `output${i}`, select: {from: 'json', path: ['value']}, type: 'string', sensitivity: 'public'}];
  const {owner, scenario} = await hostedFixture(f, runId), queue = scenario.steps.map(step => ['begin-step', step.id]), state = {}, replies = [];
  const mailboxFactory = () => ({state, save(patch) {Object.assign(state, patch);}, take() {return queue.length && state.state === 'READY' && state.step === queue[0][1] ? {args: queue.shift()} : null;}, reply(request, result) {replies.push(result);}});
  await runHostedScenario(f.roots, f.executionId, runId, owner.nonce, {mailboxFactory});
  assert(f.requests.length < 6); assert(replies.some(reply => reply.status === 'FINISH_REQUIRED')); assert.equal(state.stopReason, 'OBSERVATION_LIMIT');
  const view = collectExecution(f.roots, f.executionId); assert.equal(view.runs[0].state, 'ASSESSED'); assert.notEqual(view.scenarios[0].status, 'PASS');
  assert.equal(writeExecutionReport(f.roots, f.executionId).scenarios[0].state, 'ASSESSED');
});
