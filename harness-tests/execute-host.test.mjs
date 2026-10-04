import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {mkdirSync, rmSync, writeFileSync, existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {executionFixture} from './fixtures/execute.mjs';
import {startScenario, runHostedScenario, runInput} from '../scripts/lib/execute/host.mjs';
import {controlDirectory, sendCommand, delay, HostMailbox} from '../scripts/lib/execute/mailbox.mjs';
import {readBounded, readFrozen, ownedFile, writeJson, saveExecution} from '../scripts/lib/execute/storage.mjs';
import {collectExecution, writeExecutionReport} from '../scripts/lib/execute/report.mjs';
import {processInventory} from '../scripts/lib/browser/processes.mjs';
import {createRun} from '../scripts/lib/execution-core/index.mjs';
import {acquireLauncher, claimHost, lockStatus, releaseHost} from '../scripts/lib/execute/lock.mjs';
import {fingerprint} from '../scripts/lib/execution-core/data.mjs';
import {commandFixture} from './fixtures/execute-commands.mjs';
import {fixture as coreFixture} from './fixtures/execution-core.mjs';
import {runSequentialScenario} from '../scripts/lib/sequential/index.mjs';
import {fakeNative} from './fixtures/fake-native.mjs';
import {executeMain} from '../scripts/execute-test.mjs';

async function hostedFixture(f, runId, ownership = {}) {
  f.freeze(); const loaded = readFrozen(f.roots, f.executionId), scenario = loaded.freeze.scenarios[0];
  const input = runInput(loaded.freeze, loaded.source.scenarios[0], scenario, runId), run = createRun(input);
  writeJson(ownedFile(f.roots, f.executionId, `snapshots/${runId}.json`), {version: 1, executionId: f.executionId, runId, scenarioId: scenario.id, freezeFingerprint: loaded.execution.freezeFingerprint, inputFingerprint: run.inputFingerprint, input}, {exclusive: true});
  saveExecution(f.roots, f.executionId, {...loaded.execution, runs: [{runId, scenarioId: scenario.id, state: 'STARTING', startedAt: input.startedAt}]});
  return {owner: await acquireLauncher(f.roots, {executionId: f.executionId, runId}, ownership), scenario};
}

test('H1: a policy-denied browser begin settles without entering its callback or retaining the lock', {timeout: 15000}, async t => {
  const f = await executionFixture(t, {browser: true}), runId = 'run-policy-denied';
  const project = f.read('.harness/project.json'); project.environments.qa.environmentMode = 'protected'; f.put('.harness/project.json', project);
  const inventory = async () => [{pid: process.pid, identity: '101'}], {owner} = await hostedFixture(f, runId, {inventory}), native = fakeNative(), state = {}, replies = [], queue = [['begin-step', 's001']];
  const mailboxFactory = () => ({state, save(patch) {Object.assign(state, patch);}, take() {return state.state === 'READY' && state.step === 's001' && queue.length ? {args: queue.shift()} : null;}, reply(_, result) {replies.push(result);}});
  const runtime = (run, roots, options, callbacks) => runSequentialScenario(run, roots, {...options, browser: {...options.browser, nativeSession: native.factory}}, callbacks);
  await runHostedScenario(f.roots, f.executionId, runId, owner.nonce, {inventory, runtime, mailboxFactory});
  assert.equal(replies[0].status, 'STEP_COMPLETE'); assert.equal(replies[0].outcome, 'BLOCKED'); assert.equal(await lockStatus(f.roots), null); assert.equal(native.calls.length, 0);
});

test('H1 C8: synchronous runtime startup failure ends the host and releases ownership', async t => {
  const f = await executionFixture(t), runId = 'run-sync-failure'; f.apiStep();
  const inventory = async () => [{pid: process.pid, identity: '102'}], {owner} = await hostedFixture(f, runId, {inventory});
  await runHostedScenario(f.roots, f.executionId, runId, owner.nonce, {inventory, runtime() {throw new Error('startup');}});
  assert.equal(await lockStatus(f.roots), null); assert.equal(readBounded(join(controlDirectory(f.roots, f.executionId, runId), 'host.json')).state, 'INTERRUPTED');
  assert.equal((await executeMain(f.roots, ['do', f.executionId, 'finish-scenario'])).status, 'INTERRUPTED');
});

test('H2 S6: delayed READY reconnects to the same launch; absent startup leaves the scenario selectable', async t => {
  const f = await executionFixture(t); f.apiStep(); f.freeze(); let launches = 0, live = true;
  saveExecution(f.roots, f.executionId, {...readFrozen(f.roots, f.executionId).execution, checkpoint: true});
  const inventory = async () => [{pid: process.pid, identity: '103'}, ...(live ? [{pid: 987654, identity: '104'}] : [])];
  const spawnHost = () => {launches++; return {pid: 987654, exitCode: null, on() {}, unref() {}};};
  const first = await startScenario(f.roots, f.executionId, {inventory, spawnHost, readyTimeoutMs: 1}); assert.equal(first.status, 'HOST_STARTING_SLOW');
  const second = await startScenario(f.roots, f.executionId, {inventory, spawnHost}); assert.equal(second.runId, first.runId); assert.equal(launches, 1);
  const owner = await lockStatus(f.roots); writeJson(join(controlDirectory(f.roots, f.executionId, first.runId), 'host.json'), {runId: first.runId, state: 'READY', step: 's001', startUrl: f.origin});
  const ready = await startScenario(f.roots, f.executionId, {inventory, spawnHost}); assert.equal(ready.status, 'READY'); assert.equal(ready.startUrl, f.origin); assert.equal(ready.checkpoint, true);
  // A host that reached READY must never be relabeled as an unexecuted startup.
  live = false; const died = await startScenario(f.roots, f.executionId, {inventory, spawnHost}); assert.equal(died.status, 'INTERRUPTED'); assert.equal(died.runId, first.runId); assert.equal(await lockStatus(f.roots), null);
  assert.equal(readFrozen(f.roots, f.executionId).execution.runs[0].state, 'INTERRUPTED'); assert.equal((await startScenario(f.roots, f.executionId, {inventory, spawnHost})).status, 'EXECUTION_COMPLETE'); assert.equal(launches, 1);
  const early = await executionFixture(t); early.apiStep(); early.freeze(); live = true;
  const pending = await startScenario(early.roots, early.executionId, {inventory, spawnHost, readyTimeoutMs: 1}); live = false;
  const absent = await startScenario(early.roots, early.executionId, {inventory, spawnHost}); assert.equal(absent.status, 'START_FAILED'); assert.equal(absent.runId, pending.runId);
  const other = await executionFixture(t); other.apiStep(); other.freeze(); live = false;
  const failed = await startScenario(other.roots, other.executionId, {inventory, spawnHost() {throw new Error('spawn refused');}, readyTimeoutMs: 1}); assert.equal(failed.status, 'START_FAILED');
  assert.equal(await lockStatus(other.roots), null); const again = await startScenario(other.roots, other.executionId, {inventory, spawnHost() {throw new Error('spawn refused');}, readyTimeoutMs: 1});
  assert.equal(again.status, 'START_FAILED'); assert.notEqual(again.runId, failed.runId); assert.equal(again.scenarioId, failed.scenarioId);
});

test('F3 F8: missing first resource skips its bindings while independent API cleanup completes', async t => {
  const f = await executionFixture(t, {steps: [201, 201, 200, 200].map((status, i) => ({action: `Operation ${i}`, expected: `Status is ${status}`})), handler: (req, res) => {res.writeHead(req.url === '/first' ? 500 : req.method === 'POST' ? 201 : 200, {'content-type': 'application/json'}); res.end(JSON.stringify(req.url === '/second' ? {id: 'row-2'} : {}));}}), runId = 'run-independent-cleanup';
  const steps = f.refinement.scenarios[0].steps;
  for (let i = 0; i < steps.length; i++) {
    const step = f.apiStep(i), status = i < 2 ? 201 : 200; step.capability = 'mutations'; delete step.readOnlyContract; step.phase = i < 2 ? 'SETUP' : 'CLEANUP';
    step.expectations[0].conditions[0].expected.value = status;
    step.operation = {request: {method: i < 2 ? 'POST' : 'DELETE', path: i < 2 ? i === 0 ? '/first' : '/second' : '/remove/{recordId}'}, checks: [{id: 'status-0', select: {from: 'status', path: []}, equals: status}], effects: {confirmedStatuses: [200, 201], noEffectStatuses: [409], contractRef: 'fixture-write'}};
    if (i < 2) {step.operation.extract = [{name: `identity${i}`, select: {from: 'json', path: ['id']}, type: 'string', sensitivity: 'public'}]; step.creates = [{resource: `resource${i}`, identityOutput: `identity${i}`, intent: 'temporary', cleanupStep: steps[i + 2].id}];}
    else {step.cleanupResource = `resource${i - 2}`; step.inputs = [{name: 'recordId', source: `output:identity${i - 2}`}];}
  }
  const inventory = async () => [{pid: process.pid, identity: '105'}], {owner} = await hostedFixture(f, runId, {inventory}), queue = steps.map(step => ['begin-step', step.id]), state = {}, replies = [];
  const mailboxFactory = () => ({state, save(patch) {Object.assign(state, patch);}, take() {return state.state === 'READY' && queue.length && state.step === queue[0][1] ? {args: queue.shift()} : null;}, reply(_, result) {replies.push(result);}});
  await runHostedScenario(f.roots, f.executionId, runId, owner.nonce, {inventory, mailboxFactory});
  assert.equal(replies[2].reason, 'RESOURCE_NOT_REGISTERED'); assert.equal(f.requests.length, 3); assert.equal(f.requests[2].path, '/remove/row-2');
  const result = collectExecution(f.roots, f.executionId).runs[0].result; assert.equal(result.status, 'FAIL'); assert.equal(result.scenarios[0].resources[0].lifecycle.status, 'completed');
});

test('H2: unknown spawned identity stays explicitly unresolved without declaring completion or relaunching', async t => {
  const f = await executionFixture(t); f.apiStep(); f.freeze(); let launches = 0;
  const inventory = async () => [{pid: process.pid, identity: 'unresolved-start'}], spawnHost = () => {launches++; return {pid: 987654, exitCode: null, on() {}, unref() {}};};
  const first = await startScenario(f.roots, f.executionId, {inventory, spawnHost, readyTimeoutMs: 1});
  const second = await startScenario(f.roots, f.executionId, {inventory, spawnHost, readyTimeoutMs: 1});
  assert.equal(first.status, 'STARTING'); assert.equal(second.status, 'STARTING'); assert.equal(second.runId, first.runId); assert.equal(launches, 1);
});

test('H2: explicit rerun preserves the recovered terminal state of the previous host', async t => {
  const f = await executionFixture(t); f.apiStep(); f.freeze(); let live = true;
  const inventory = async () => [{pid: process.pid, identity: 'rerun-launcher'}, ...(live ? [{pid: 987654, identity: 'previous-host'}] : [])];
  const first = await startScenario(f.roots, f.executionId, {inventory, readyTimeoutMs: 1, spawnHost: () => ({pid: 987654, exitCode: null, on() {}, unref() {}})});
  writeJson(join(controlDirectory(f.roots, f.executionId, first.runId), 'host.json'), {runId: first.runId, state: 'READY'}); live = false;
  const next = await startScenario(f.roots, f.executionId, {inventory, rerun: f.refinement.scenarios[0].id, readyTimeoutMs: 1, spawnHost() {throw new Error('Injected replacement startup failure');}});
  assert.equal(next.status, 'START_FAILED'); assert.notEqual(next.runId, first.runId);
  assert.deepEqual(readFrozen(f.roots, f.executionId).execution.runs.map(row => row.state), ['INTERRUPTED', 'START_FAILED']);
});

test('L4: CLI await preserves the original request identity when a terminal host has no receipt', async t => {
  const f = await executionFixture(t), runId = 'run-await-uncertain'; f.apiStep();
  const inventory = async () => [{pid: process.pid, identity: 'await-uncertain'}], {owner} = await hostedFixture(f, runId, {inventory});
  const box = new HostMailbox(controlDirectory(f.roots, f.executionId, runId), runId, owner.nonce), requestId = randomUUID();
  box.save({state: 'INTERRUPTED', inFlight: {seq: 1, requestId, cmd: 'native'}});
  const result = await executeMain(f.roots, ['do', f.executionId, '--await', '1']);
  assert.equal(result.status, 'COMMAND_UNCERTAIN'); assert.equal(result.requestId, requestId); assert.equal(result.seq, 1); assert.equal(box.state.nextSeq, 1);
});

test('S1: guard cache is host-bound; legacy executions verify the freeze; corrupt cache still permits cooperative stop', async t => {
  const f = await executionFixture(t), runId = 'run-guard-cache'; f.apiStep();
  const inventory = async () => [{pid: process.pid, identity: 'guard-cache'}], {owner} = await hostedFixture(f, runId, {inventory}); await claimHost(f.roots, owner.nonce, {inventory});
  const loaded = readFrozen(f.roots, f.executionId), directory = controlDirectory(f.roots, f.executionId, runId), box = new HostMailbox(directory, runId, owner.nonce), requestId = randomUUID();
  box.save({state: 'READY', pid: process.pid, freezeFingerprint: loaded.execution.freezeFingerprint, guardRefsFingerprint: fingerprint(loaded.execution.guardRefs)});
  box.reply({seq: 1, requestId}, {status: 'OK'});
  const args = ['do', f.executionId, '--request-id', requestId, 'status']; assert.equal((await executeMain(f.roots, args)).status, 'OK');
  saveExecution(f.roots, f.executionId, {...loaded.execution, guardRefs: ['env:ADDED_PRIVATE_BINDING']});
  await assert.rejects(executeMain(f.roots, args), /guard cache differs/);
  const legacy = {...loaded.execution}; delete legacy.guardRefs; saveExecution(f.roots, f.executionId, legacy);
  assert.equal((await executeMain(f.roots, args)).status, 'OK');
  const corrupted = {...loaded.freeze, sourceFingerprint: 'altered'}; writeJson(ownedFile(f.roots, f.executionId, 'freeze.json'), corrupted);
  await assert.rejects(executeMain(f.roots, args), /receipt changed/);
  saveExecution(f.roots, f.executionId, {...loaded.execution, guardRefs: ['env:ADDED_PRIVATE_BINDING']});
  setTimeout(() => box.save({state: 'INTERRUPTED'}), 50);
  assert.equal((await executeMain(f.roots, ['stop', f.executionId])).status, 'INTERRUPTED'); assert(existsSync(join(directory, 'stop.request')));
  await releaseHost(f.roots, owner.nonce, {inventory});
});

for (const mode of ['near-limit', 'oversized', 'post-dispatch']) test(`H3 H5 L4: ${mode} command replies retain dispatch facts and do not replay a duplicate request`, async t => {
  const f = await executionFixture(t, {browser: true}), runId = `run-${mode}`, inventory = async () => [{pid: process.pid, identity: mode}], {owner} = await hostedFixture(f, runId, {inventory});
  let clicked = false, faulted = false; const payload = 'x'.repeat((mode === 'near-limit' ? 250 : 270) * 1024), native = fakeNative({command(args) {if (args[0] === 'click') {clicked = true; return {stdout: JSON.stringify({result: mode === 'post-dispatch' ? 'OK' : payload}), exitCode: 0, dispatched: true};}}});
  const duplicateId = randomUUID(), queue = [['begin-step', 's001'], ['look'], ['native', 'click', 'e1'], ['native', 'click', 'e1'], ['end-step', '--effect', 'confirmed']], replies = [];
  let box;
  const mailboxFactory = (directory, id, nonce) => {
    box = new HostMailbox(directory, id, nonce); const take = box.take.bind(box), reply = box.reply.bind(box); let index = 0;
    box.take = () => {if (box.state.state === 'READY' && index < queue.length) {const seq = box.state.nextSeq, requestId = [2, 3].includes(index) ? duplicateId : randomUUID(); writeJson(join(directory, 'inbox', `${seq}.json`), {seq, requestId, runId, channel: nonce, args: queue[index++]}, {exclusive: true}); return take();} return null;};
    box.reply = (request, result) => {replies.push(result); reply(request, result);}; return box;
  };
  const runtime = (run, roots, options, callbacks) => {
    if (mode === 'post-dispatch') {const exercise = callbacks.exercise; callbacks = {...callbacks, exercise: ctx => exercise({...ctx, browser: {...ctx.browser, attempt: (input, action) => ctx.browser.attempt(input, context => action({...context, observationBudgetReached() {if (clicked && !faulted) {faulted = true; throw new Error('Injected post-dispatch persistence failure');} return false;}}))}})};}
    return runSequentialScenario(run, roots, {...options, browser: {...options.browser, nativeSession: native.factory}}, callbacks);
  };
  await runHostedScenario(f.roots, f.executionId, runId, owner.nonce, {inventory, runtime, mailboxFactory});
  assert.equal(native.calls.filter(args => args[0] === 'click').length, 1);
  const receipt = await sendCommand(box.directory, runId, ['native', 'click', 'e1'], {requestId: duplicateId});
  if (mode === 'near-limit') {assert.equal(receipt.status, 'OK'); assert.equal(receipt.reply.result.length, payload.length);}
  else {assert.equal(receipt.status, mode === 'oversized' ? 'REPLY_OMITTED' : 'ERROR'); assert.equal(receipt.dispatch.dispatched, true); assert.equal(receipt.dispatch.nativeCommand, 'click');}
  assert.equal(receipt.requestId, duplicateId); assert.equal(collectExecution(f.roots, f.executionId).runs[0].state, 'ASSESSED');
});
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
  const mailboxFactory = () => ({state, save(patch) {Object.assign(state, patch);}, take() {return state.state === 'READY' && queue.length ? {args: queue.shift()} : null;}, reply(request, reply) {
    replies.push(reply); if (request.args[0] === 'check') {const record = core.report.evidence.find(item => item.id === reply.result.evidenceIds[0]); writeFileSync(join(core.roots.runRoot, record.path), 'tampered');}
  }});
  await runHostedScenario(f.roots, f.executionId, runId, owner.nonce, {runtime, mailboxFactory});
  assert.deepEqual(begun, ['s001']); assert(replies.some(reply => reply.reason === 'EVIDENCE_INTEGRITY_FAILURE')); assert.equal(state.stopReason, 'EVIDENCE_INTEGRITY_FAILURE'); assert.equal(native.assertions.length, 0);
});

test('H4: runtime owns the cleanup deadline with time reserved for owned shutdown', async t => {
  const f = await executionFixture(t), runId = 'run-cleanup-reserve'; f.apiStep().phase = 'CLEANUP'; f.refinement.limits.cleanupTimeoutMs = 2000;
  const {owner} = await hostedFixture(f, runId), state = {}; let elapsed, aborted;
  const runtime = async (run, roots, options, callbacks) => {const started = Date.now(); const result = await runSequentialScenario(run, roots, options, callbacks); elapsed = Date.now() - started; aborted = options.signal.aborted; return result;};
  const mailboxFactory = () => ({state, save(patch) {Object.assign(state, patch);}, take() {return null;}});
  await runHostedScenario(f.roots, f.executionId, runId, owner.nonce, {runtime, mailboxFactory});
  assert.equal(state.state, 'FINISHED'); assert.equal(aborted, false); assert(elapsed >= 900 && elapsed < 1800, `Cleanup consumed ${elapsed} ms of its 2000 ms window`);
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
