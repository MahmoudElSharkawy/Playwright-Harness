import test from 'node:test';
import assert from 'node:assert/strict';
import {createRun, defineOperation, authorizeOperation, checkExecutionWindow, typedValue} from '../scripts/lib/execution-core/index.mjs';
import {environment, operation, runInput} from './fixtures/execution-core.mjs';
import {data} from '../scripts/lib/execution-core/data.mjs';

test('sensitive wire-field definitions permit only exact plain data binding references', () => {
  assert.deepEqual(data({password: {$input: 'credentialValue'}}), {password: {$input: 'credentialValue'}});
  for (const invalid of [String(1234), 1234, null, {$input: ''}, {$input: 'bad identifier'}, {$input: 'safe', extra: true}, {nested: {$input: 'safe'}}, [{$input: 'safe'}]]) {
    assert.throws(() => data({password: invalid}), /protected reference/);
  }
  let reads = 0; const accessor = {};
  Object.defineProperty(accessor, '$input', {enumerable: true, get: () => {reads++; return 'safe';}});
  assert.throws(() => data({password: accessor}), /protected reference/); assert.equal(reads, 0);
  const inherited = Object.create({$input: 'safe'}); assert.throws(() => data({password: inherited}), /protected reference/);
});

test('run freezes capabilities, target/credential references, definitions, knowledge and limits without aliasing inputs', () => {
  const input = runInput({knowledge: [{id: 'fact', version: 'v1', reviewed: true, content: {heading: 'Synthetic'}}]});
  const run = createRun(input); input.environment.targets.api['qa-api'].credentialRef = 'env:NEXT_TOKEN'; input.knowledge[0].content.heading = 'Changed';
  assert.equal(run.inputs.environment.targets.api['qa-api'].credentialRef, 'env:API_TOKEN'); assert.equal(run.inputs.knowledge[0].content.heading, 'Synthetic');
  assert.throws(() => { run.inputs.environment.capabilities.apiMutations = false; }); assert.throws(() => { run.inputs.operations[0].definition.intent = 'changed'; });
  assert.equal(JSON.stringify(run).includes('NEXT_TOKEN'), false); assert.match(run.inputFingerprint, /^[a-f0-9]{64}$/);
  assert.notEqual(createRun(input).inputFingerprint, run.inputFingerprint);
});
for (const kind of ['catalog', 'helper', 'inline']) test(`${kind} operations receive identical ordinary mutation capability checks`, () => {
  const op = operation({capability: 'apiMutations', source: {kind, reference: 'create-fixture', version: 'v1'}});
  const run = createRun(runInput({operations: [op]})); assert.equal(authorizeOperation(run, op, ['apiMutations']).allowed, true);
  const protectedRun = createRun(runInput({environment: environment('protected'), operations: [op]}));
  assert.equal(authorizeOperation(protectedRun, op, ['apiMutations']).reason, 'CAPABILITY_DISABLED');
});
for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) test(`uncataloged dynamic API ${method} is permitted by the test profile`, () => {
  const run = createRun(runInput({operations: []}));
  const op = operation({capability: method === 'GET' ? 'apiReads' : 'apiMutations', source: {kind: 'exploration', reference: 'run-local', version: 'v1'}, definition: {method, intent: 'Synthetic API operation'}});
  assert.equal(authorizeOperation(run, op, [op.capability]).allowed, true); assert.deepEqual(run.inputs.operations, []);
});
for (const statement of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) test(`uncataloged dynamic database ${statement} needs capability and driver support, not a parser`, () => {
  const run = createRun(runInput({operations: []}));
  const op = operation({family: 'database', target: 'qa-db', capability: statement === 'SELECT' ? 'dbSelect' : 'dbDml', source: {kind: 'exploration', reference: 'run-local', version: 'v1'}, definition: {statementClass: statement, parameterNames: ['fixtureId']}});
  assert.equal(authorizeOperation(run, op, [op.capability]).allowed, true); assert.equal(authorizeOperation(run, op).reason, 'UNSUPPORTED_CAPABILITY');
});
test('protected permits explicit mutations; custom grants only configured classes; environment names do not grant access', () => {
  const op = operation({capability: 'apiMutations'});
  for (const mode of ['protected', 'custom']) {
    const config = environment(mode, {apiMutations: true}); config.name = 'production';
    assert.equal(authorizeOperation(createRun(runInput({environment: config, operations: [op]})), op, ['apiMutations']).allowed, true);
  }
  const read = operation(); assert.equal(authorizeOperation(createRun(runInput({environment: environment('custom')})), read, ['apiReads']).reason, 'CAPABILITY_DISABLED');
});
test('protected exploration stays read-oriented unless mutation is enabled, and exploration can be disabled independently', () => {
  const source = {kind: 'exploration', reference: 'local', version: 'v1'}, read = operation({source}), write = operation({source, capability: 'apiMutations'});
  const protectedRun = createRun(runInput({environment: environment('protected'), operations: []}));
  assert.equal(authorizeOperation(protectedRun, read, ['apiReads']).allowed, true);
  assert.equal(authorizeOperation(protectedRun, write, ['apiMutations']).reason, 'CAPABILITY_DISABLED');
  const enabled = createRun(runInput({environment: environment('protected', {apiMutations: true}), operations: []}));
  assert.equal(authorizeOperation(enabled, write, ['apiMutations']).allowed, true);
  const disabled = createRun(runInput({environment: environment('test', {apiExploration: false}), operations: []}));
  assert.equal(authorizeOperation(disabled, read, ['apiReads']).reason, 'CAPABILITY_DISABLED');
});
test('catalog entries cannot enable unknown targets, unsupported DDL/admin or disabled operation classes', () => {
  const outside = operation({target: 'unlisted'}), run = createRun(runInput({operations: [outside]}));
  assert.equal(authorizeOperation(run, outside, ['apiReads']).reason, 'TARGET_NOT_ENABLED');
  for (const capability of ['ddl', 'admin']) {
    const op = operation({family: 'database', target: 'qa-db', capability});
    assert.equal(authorizeOperation(createRun(runInput({operations: [op]})), op, [capability]).reason, 'CAPABILITY_DISABLED');
    assert.equal(authorizeOperation(createRun(runInput({environment: environment('test', {[capability]: true}), operations: [op]})), op, []).reason, 'UNSUPPORTED_CAPABILITY');
  }
});
test('unfrozen helper/inline/catalog changes and exploration collisions are refused', () => {
  const run = createRun(runInput()), changed = operation({definition: {intent: 'Changed'}});
  assert.equal(authorizeOperation(run, changed, ['apiReads']).reason, 'DEFINITION_NOT_FROZEN');
  const collision = operation({source: {kind: 'exploration', reference: 'local', version: 'v1'}});
  assert.equal(authorizeOperation(run, collision, ['apiReads']).reason, 'DEFINITION_NOT_FROZEN');
  assert.throws(() => authorizeOperation(run, {...operation(), fingerprint: '0'.repeat(64)}, ['apiReads']));
});
test('zero scope, unknown profiles, malformed limits and unreviewed knowledge fail at initialization', () => {
  for (const patch of [{scenarios: []}, {scenarios: [{id: 'empty', expectations: []}]}, {limits: {maxAttempts: 0}}, {limits: {timeoutMs: Infinity}}, {limits: {newEngine: true}}, {environment: environment('unknown')}, {knowledge: [{id: 'candidate', version: 'v1', reviewed: false, content: {}}]}]) assert.throws(() => createRun(runInput(patch)));
  const config = environment(); config.apiTargets = ['unknown']; assert.throws(() => createRun(runInput({environment: config})));
});
test('definitions reject live handles, getters, cycles, hidden/symbol properties, sparse arrays and oversized values', () => {
  const cyclic = {}; cyclic.self = cyclic; const getter = {}; Object.defineProperty(getter, 'value', {enumerable: true, get() { throw new Error('getter must not execute'); }});
  const hidden = {}; Object.defineProperty(hidden, 'hidden', {value: 1}); const weirdArray = Array(1); weirdArray.other = true;
  for (const definition of [{live: new Date()}, {callback: () => {}}, cyclic, getter, hidden, {items: weirdArray}, {[Symbol('x')]: 1}, {value: 'x'.repeat(1024 * 1024 + 1)}]) assert.throws(() => operation({definition}));
});
test('typed values validate public types and keep sensitive material as opaque references', () => {
  const producer = {runId: 'run-1', scenarioId: 'case-1', attemptId: 'attempt-1', name: 'result'};
  const sensitive = typedValue({name: 'result', type: 'object', sensitivity: 'sensitive', protectedRef: 'protected:fixture-before', producer}, 1024);
  assert.equal(Object.hasOwn(sensitive, 'value'), false); assert.throws(() => typedValue({...sensitive, value: {private: 'must-not-persist'}}, 1024));
  assert.throws(() => typedValue({name: 'result', type: 'number', sensitivity: 'public', value: '7', producer}, 1024));
  assert.throws(() => typedValue({...sensitive, protectedRef: '../outside'}, 1024));
  assert.throws(() => typedValue({name: 'result', type: 'object', sensitivity: 'public', value: {['pass' + 'word']: 'synthetic-fixture-only'}, producer}, 1024));
});
test('deadline and cancellation stop ordinary phases while required cleanup has a separate finite budget', () => {
  const run = createRun(runInput({limits: {timeoutMs: 10, cleanupTimeoutMs: 20}})), controller = new AbortController(); controller.abort();
  assert.equal(checkExecutionWindow(run, {phase: 'EXERCISE', now: 1005, signal: controller.signal}).reason, 'CANCELLED');
  assert.equal(checkExecutionWindow(run, {phase: 'VERIFY', now: 1010}).reason, 'DEADLINE_EXCEEDED');
  assert.equal(checkExecutionWindow(run, {phase: 'CLEANUP', now: 1020, cleanupStartedAt: 1015, signal: controller.signal}).remainingMs, 15);
  assert.equal(checkExecutionWindow(run, {phase: 'RESTORE', now: 1035, cleanupStartedAt: 1015}).allowed, false);
  assert.throws(() => checkExecutionWindow(run, {phase: 'CLEANUP', now: 1020}));
});
test('operation and knowledge revisions accept semantic versions without relaxing execution identifiers', () => {
  for (const version of ['1.2.3', '1.2.3-beta.1+build.7', 'a'.repeat(40)]) {
    const op = operation({source: {kind: 'helper', reference: 'service', version}});
    const run = createRun(runInput({operations: [op], knowledge: [{id: 'fact', version, reviewed: true, content: {}}]}));
    assert.equal(run.inputs.operations[0].source.version, version); assert.equal(run.inputs.knowledge[0].version, version);
  }
  for (const version of ['../revision', '/revision', 'one\ntwo', 'v'.repeat(129)]) {
    assert.throws(() => operation({source: {kind: 'inline', reference: 'fixture', version}}), /revision/);
    assert.throws(() => createRun(runInput({knowledge: [{id: 'fact', version, reviewed: true, content: {}}]})), /revision/);
  }
  assert.throws(() => operation({id: '1.2.3'}), /identifier/);
});
