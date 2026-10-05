import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {mkdirSync, readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createProtectedInputs, protectedInputReference} from '../scripts/lib/protected-inputs.mjs';
import {data} from '../scripts/lib/execution-core/data.mjs';
import {createRun} from '../scripts/lib/execution-core/index.mjs';
import {runInput, runHostedScenario} from '../scripts/lib/execute/host.mjs';
import {readFrozen, ownedFile, writeJson, saveExecution} from '../scripts/lib/execute/storage.mjs';
import {acquireLauncher} from '../scripts/lib/execute/lock.mjs';
import {collectExecution} from '../scripts/lib/execute/report.mjs';
import {executionFixture} from './fixtures/execute.mjs';
import {commandFixture} from './fixtures/execute-commands.mjs';
import {fixture as apiFixture, operation} from './fixtures/api.mjs';

const binding = {name: 'account', source: 'generated:account', generation: {bytes: 24}};
const hash = value => createHash('sha256').update(value).digest('hex');

test('protected sources reuse one generated value per account, refresh per run and clear on completion', () => {
  const first = createProtectedInputs([binding, {...binding, name: 'login'}]);
  const reference = protectedInputReference(binding.source), value = first.resolveSensitive(reference);
  assert.match(value, /^[a-f0-9]{48}$/); assert.equal(first.privateValues.length, 1);
  const next = createProtectedInputs([binding]); assert.notEqual(next.resolveSensitive(reference), value);
  const provisioned = randomUUID(), synthetic = '<deliberately-invalid-input>';
  const other = createProtectedInputs([{source: 'env:EXISTING_ACCESS'}, {source: 'synthetic:wrong'}], {
    environment: {EXISTING_ACCESS: provisioned}, references: {wrong: {value: synthetic, assumed: false}},
  });
  assert.equal(other.resolveSensitive('protected:EXISTING_ACCESS'), provisioned);
  assert.equal(other.resolveSensitive(protectedInputReference('synthetic:wrong')), synthetic);
  const outputRef = first.storeSensitive({confidential: value}); assert.deepEqual(first.resolveSensitive(outputRef), {confidential: value});
  for (const store of [first, next, other]) store.clear();
  assert.throws(() => first.resolveSensitive(reference), /unavailable/); assert.equal(first.privateValues.length, 0);
});

test('protected sources reject unapproved synthetic input, malformed generation and conflicting rules', () => {
  for (const bytes of [undefined, 0, 15, 257, 24.5]) assert.throws(() => createProtectedInputs([{...binding, generation: {bytes}}]));
  assert.throws(() => createProtectedInputs([{source: 'env:MISSING_ACCESS'}]), /unavailable/);
  assert.throws(() => createProtectedInputs([{source: 'synthetic:wrong'}], {references: {wrong: {value: '<invalid-input>', assumed: true}}}), /approved/);
  assert.throws(() => createProtectedInputs([binding, {...binding, generation: {bytes: 32}}]), /conflict/);
  const rules = {bytes: 24, prefix: 'A!', suffix: '9z'}, store = createProtectedInputs([{...binding, generation: rules}, {...binding, generation: {suffix: '9z', bytes: 24, prefix: 'A!'}}]);
  assert.match(store.resolveSensitive(protectedInputReference(binding.source)), /^A![a-f0-9]{48}9z$/); store.clear();
  assert.deepEqual(data({password: {$input: 'account'}}), {password: {$input: 'account'}});
  assert.throws(() => data({password: randomUUID()}), /protected reference/);
});

test('API exploration resolves generated and fixed synthetic credentials without environment keys', async t => {
  const store = createProtectedInputs([binding, {source: 'synthetic:wrong'}], {references: {wrong: {value: '<invalid-input>', assumed: false}}});
  t.after(() => store.clear()); const actual = store.resolveSensitive(protectedInputReference(binding.source));
  const op = operation('request', {method: 'POST', kind: 'exploration', request: {method: 'POST', path: '/items', json: {password: {$input: 'account'}, wrongPassword: {$input: 'wrong'}}}});
  const f = await apiFixture(t, ({request, reply}) => reply(request.body.password === actual && request.body.wrongPassword !== actual ? 200 : 400, {echo: actual}), [op], {
    sensitiveValues: [['account', 'string', protectedInputReference(binding.source)], ['wrong', 'string', protectedInputReference('synthetic:wrong')]], runtime: store,
  });
  await f.call(op, {inputs: f.run.inputs.values}); assert.equal(f.runtime.finish().status, 'PASS');
  assert.equal(f.requests[0].body.password, actual); assert(!f.allText().includes(actual));
});

function publicArtifacts(root) {
  return readdirSync(root, {withFileTypes: true}).filter(item => !['.git', 'protected'].includes(item.name)).flatMap(item => item.isDirectory()
    ? publicArtifacts(join(root, item.name)) : [readFileSync(join(root, item.name), 'utf8')]).join('\n');
}
function approveFile(root, file) {
  for (const args of [['init', '--quiet'], ['add', '--', file], ['-c', 'user.name=Harness fixture', '-c', 'user.email=fixture@example.test', 'commit', '--quiet', '-m', 'Approve synthetic fixture']]) {
    const result = spawnSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, ...args], {cwd: root, encoding: 'utf8', windowsHide: true});
    assert.equal(result.status, 0, result.stderr);
  }
}

test('native execution freezes generated/synthetic sources and retains the same generated value through failed login cleanup', {timeout: 20000}, async t => {
  const accounts = new Map(), audit = [], observedValues = []; let failLogin = false;
  const f = await executionFixture(t, {steps: ['Create account', 'Reject wrong input', 'Sign in', 'Remove account'].map(action => ({action, expected: 'Status is 200'})), handler: async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk); const body = JSON.parse(Buffer.concat(chunks).toString());
    let status = 200; const digest = hash(body.password); audit.push({path: req.url, digest}); observedValues.push(body.password);
    if (req.url === '/create') accounts.set('owned-account', digest);
    else if (req.url === '/wrong') status = accounts.get('owned-account') !== digest ? 200 : 400;
    else if (req.url === '/login') status = failLogin ? 500 : accounts.get('owned-account') === digest ? 200 : 401;
    else if (req.method === 'DELETE') {status = accounts.get(body.recordId) === digest ? 200 : 404; if (status === 200) accounts.delete(body.recordId);}
    // Echoing a credential also exercises response redaction.
    res.writeHead(status, {'content-type': 'application/json'}); res.end(JSON.stringify({id: 'owned-account', echo: body.password}));
  }});
  const file = 'resources/testData/ProtectedInputTestJsonFile.json'; mkdirSync(join(f.projectRoot, 'resources/testData'), {recursive: true});
  f.put(file, {invalidInput: '<invalid-input>'}); approveFile(f.projectRoot, file);
  f.refinement.references = {wrong: {file, path: ['invalidInput']}};
  const steps = f.refinement.scenarios[0].steps;
  for (let i = 0; i < steps.length; i++) {
    const step = f.apiStep(i); step.capability = 'mutations'; delete step.readOnlyContract;
    step.phase = i === 0 ? 'SETUP' : i === 3 ? 'CLEANUP' : 'EXERCISE';
    step.inputs = i === 1 ? [{name: 'wrong', source: 'synthetic:wrong'}] : [{...binding}];
    step.operation = {request: {method: i === 3 ? 'DELETE' : 'POST', path: ['/create', '/wrong', '/login', '/remove'][i], json: {password: {$input: i === 1 ? 'wrong' : 'account'}, ...(i === 3 ? {recordId: {$input: 'recordId'}} : {})}}, checks: [{id: 'status-0', select: {from: 'status', path: []}, equals: 200}], effects: {confirmedStatuses: [200], noEffectStatuses: [400, 401, 404], contractRef: 'fixture-write'}};
    if (i === 0) {step.operation.extract = [{name: 'recordId', select: {from: 'json', path: ['id']}, type: 'string', sensitivity: 'public'}]; step.creates = [{resource: 'account', identityOutput: 'recordId', intent: 'temporary', cleanupStep: steps[3].id}];}
    if (i === 3) {step.inputs.push({name: 'recordId', source: 'output:recordId'}); step.cleanupResource = 'account';}
  }
  assert.deepEqual(f.freeze().readiness, {ready: true, missing: []});
  const loaded = readFrozen(f.roots, f.executionId), scenario = loaded.freeze.scenarios[0];
  for (const failing of [false, true]) {
    failLogin = failing; const runId = `protected-${randomUUID()}`, input = runInput(loaded.freeze, loaded.source.scenarios[0], scenario, runId), run = createRun(input);
    assert(input.values.every(value => value.sensitivity === 'sensitive' && !Object.hasOwn(value, 'value')));
    writeJson(ownedFile(f.roots, f.executionId, `snapshots/${runId}.json`), {version: 1, executionId: f.executionId, runId, scenarioId: scenario.id, freezeFingerprint: loaded.execution.freezeFingerprint, inputFingerprint: run.inputFingerprint, input}, {exclusive: true});
    const execution = f.read(`.harness/runs/${f.executionId}/execution.json`);
    saveExecution(f.roots, f.executionId, {...execution, runs: [...execution.runs, {runId, scenarioId: scenario.id, state: 'STARTING', startedAt: input.startedAt}]});
    const inventory = async () => [{pid: process.pid, identity: 'protected-input-host'}];
    const owner = await acquireLauncher(f.roots, {executionId: f.executionId, runId}, {inventory});
    const queue = steps.map(step => ['begin-step', step.id]), state = {}, mailboxFactory = () => ({state, save(patch) {Object.assign(state, patch);}, take() {return state.state === 'READY' && queue.length && state.step === queue[0][1] ? {args: queue.shift()} : null;}, reply() {}});
    await runHostedScenario(f.roots, f.executionId, runId, owner.nonce, {inventory, mailboxFactory});
    const result = collectExecution(f.roots, f.executionId).runs.find(item => item.runId === runId).result;
    assert.equal(result.status, failing ? 'FAIL' : 'PASS'); assert.equal(result.scenarios[0].resources[0].lifecycle.status, 'completed'); assert.equal(accounts.size, 0);
    const calls = audit.slice(-4); assert.equal(calls.length, 4); assert.equal(calls[0].digest, calls[2].digest); assert.equal(calls[0].digest, calls[3].digest); assert.notEqual(calls[0].digest, calls[1].digest);
    const all = publicArtifacts(join(f.projectRoot, '.harness/runs', f.executionId));
    for (const actual of observedValues.filter(value => /^[a-f0-9]{48}$/.test(value))) assert(!all.includes(actual), 'Generated values stay out of snapshots, evidence and results.');
  }
  assert.notEqual(audit[0].digest, audit[4].digest);
});

test('freeze refuses generated source conflicts and synthetic references without approved JSON', async t => {
  const f = await executionFixture(t, {steps: [{action: 'Read one', expected: 'Status is 200'}, {action: 'Read two', expected: 'Status is 200'}]});
  f.apiStep(0).inputs = [binding]; f.apiStep(1).inputs = [{...binding, generation: {bytes: 32}}];
  assert.throws(() => f.freeze(), /generation rules conflict/);
  f.refinement.scenarios[0].steps[1].inputs = [{name: 'wrong', source: 'synthetic:wrong'}];
  f.refinement.references = {wrong: {file: 'missing.json'}}; assert.throws(() => f.freeze(), /approved JSON/);
});

test('browser fills accept protected input aliases only for bindings on the active step', async t => {
  const fixture = await executionFixture(t), f = commandFixture(fixture.projectRoot);
  f.step.inputs = [binding]; f.commands.inputAliases = {account: 'HARNESS_INPUT_ACCOUNT', other: 'HARNESS_INPUT_OTHER'};
  await f.commands.dispatch(['look']); await f.commands.dispatch(['native', 'fill', 'e2', 'HARNESS_INPUT_ACCOUNT']);
  assert.equal(f.calls.filter(call => call[1] === 'fill').length, 1);
  await assert.rejects(f.commands.dispatch(['native', 'fill', 'e2', 'HARNESS_INPUT_OTHER']), /bound to this fill step/);
  await assert.rejects(f.commands.dispatch(['native', 'type', 'HARNESS_INPUT_ACCOUNT']), /bound to this fill step/);
  assert.equal(f.calls.filter(call => call[1] === 'fill').length, 1);
});
