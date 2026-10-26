import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import vm from 'node:vm';
import {readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {nativeCaptureCode, readApiDiscoverySummary} from '../scripts/lib/browser/api-capture.mjs';
import {defineOperation} from '../scripts/lib/execution-core/index.mjs';
import {runBrowserScenario} from '../scripts/lib/browser/index.mjs';
import {listApiCandidates} from '../scripts/lib/api/discovery.mjs';
import {fixture} from './fixtures/sequential.mjs';
import {fakeNative} from './fixtures/fake-native.mjs';

const identity = {runId: 'run', scenarioId: 'case', operationId: 'open', invocationId: 'open-call', attemptId: 'attempt-one', phase: 'EXERCISE', number: 1};
test('native capture passively binds request-start ownership across pages, redacts header values and bounds bodies', async () => {
  const context = new EventEmitter(), page = {context: () => context};
  const invoke = (action, owner = identity) => vm.runInNewContext(`(${nativeCaptureCode(action, owner, ['https://app.test'])})`, {URL, Buffer})(page);
  invoke('begin');
  const request = {resourceType: () => 'fetch', url: () => 'https://app.test/api/orders', method: () => 'POST', headers: () => ({'content-type': 'application/json'}), allHeaders: async () => ({'content-type': 'application/json', cookie: 'private-sentinel'}), postData: () => JSON.stringify({name: 'private-person'})};
  context.emit('request', request);
  context.emit('response', {request: () => request, status: () => 201, allHeaders: async () => ({'content-type': 'application/json'}), body: async () => Buffer.from('{"id":"private-id"}')});
  await new Promise(resolve => setImmediate(resolve));
  const captured = JSON.parse(JSON.stringify(invoke('end')));
  assert.deepEqual(captured.records[0].identity, identity);
  assert.equal(captured.records[0].responseBody.state, 'known');
  assert(captured.records[0].requestHeaders.some(header => header.name === 'cookie'));
  assert.equal(captured.records[0].requestHeadersState, 'known');
  assert(!JSON.stringify(captured).includes('private-sentinel'));
  const next = {...identity, attemptId: 'attempt-two'}; invoke('begin', next);
  context.emit('request', {...request, postData: () => 'x'.repeat(17000)});
  context.emit('request', {...request, url: () => 'https://analytics.test/collect'});
  const later = JSON.parse(JSON.stringify(invoke('end', next)));
  assert.equal(later.records.length, 1);
  assert.equal(later.records[0].requestBody.state, 'truncated');
  assert.equal(later.records[0].responseBody.state, 'unknown');
  assert.equal(later.records[0].identity.attemptId, next.attemptId);
});

for (const route of ['execution', 'exploration']) test(`${route} saves source-bound sanitized discoveries without changing verdict or generating code`, async t => {
  const operation = defineOperation({id: 'observe', family: 'browser', target: 'ui', capability: 'browserReads', source: {kind: 'inline', reference: 'fixture', version: '1'}, definition: {intent: 'Observe order'}});
  const f = await fixture(t, [{operation, phase: 'EXERCISE', checks: [{id: 'visible'}]}], {browser: true});
  const native = fakeNative(), captureCalls = [];
  const factory = async roots => {
    const session = await native.factory(roots);
    session.capture = async (action, owner) => {
      captureCalls.push(action);
      return action === 'begin' ? {ready: true} : {records: [{identity: owner, resourceType: 'fetch', method: 'GET', url: `${f.origin}/api/orders/private-id`,
        requestHeaders: [{name: 'cookie', value: 'credential-sentinel'}], responseHeaders: [], requestBody: {state: 'omitted'}, responseBody: {state: 'known', contentType: 'application/json', text: '{"name":"personal-sentinel","id":"private-id"}'}, status: 200}], gaps: []};
    };
    return session;
  };
  const action = async context => {
    await context.native(['tab-list']);
    const evidence = await context.evidence('observation', {visible: true});
    context.assertion({id: 'visible', status: 'PASS', reliable: true, evidenceIds: [evidence]});
  };
  const result = route === 'execution'
    ? await f.start({exercise: phase => phase.browser.attempt({operation, invocationId: 'observe'}, action)}, {browser: {target: 'ui', nativeSession: factory}})
    : await runBrowserScenario(f.run, f.roots, {target: 'ui', nativeSession: factory}, browser => browser.attempt({operation, invocationId: 'observe'}, action));
  assert.equal(result.status, 'PASS');
  assert.deepEqual(captureCalls, ['begin', 'end']);
  const candidates = listApiCandidates(f.roots, {runId: f.run.id}); assert.equal(candidates.length, 1);
  assert.equal(candidates[0].observation.identity.invocationId, 'observe');
  assert.equal(candidates[0].observation.status, 'unreviewed');
  const summary = readFileSync(join(f.roots.runRoot, 'api-discovery.json'), 'utf8');
  assert.equal(JSON.parse(summary).candidates.length, 1);
  assert.equal(readApiDiscoverySummary(f.roots, f.roots.runRoot, f.run.id).candidates.length, 1);
  for (const sentinel of ['credential-sentinel', 'personal-sentinel', 'private-id']) assert(!JSON.stringify(candidates).includes(sentinel) && !summary.includes(sentinel));
  assert(!existsSync(join(f.roots.runRoot, 'protected')));
  assert(!existsSync(join(f.roots.projectRoot, 'src')));
});

test('unavailable optional capture leaves the native business outcome intact and reports a gap', async t => {
  const operation = defineOperation({id: 'observe', family: 'browser', target: 'ui', capability: 'browserReads', source: {kind: 'inline', reference: 'fixture', version: '1'}, definition: {intent: 'Observe order'}});
  const f = await fixture(t, [{operation, phase: 'EXERCISE', checks: [{id: 'visible'}]}], {browser: true});
  const native = fakeNative(), factory = async roots => {const session = await native.factory(roots); session.capture = async () => {throw new Error('private-native-diagnostic');}; return session;};
  const result = await f.start({exercise: phase => phase.browser.attempt({operation, invocationId: 'observe'}, async context => {
    await context.native(['tab-list']); const evidence = await context.evidence('observation', {visible: true});
    context.assertion({id: 'visible', status: 'PASS', reliable: true, evidenceIds: [evidence]});
  })}, {browser: {target: 'ui', nativeSession: factory}});
  assert.equal(result.status, 'PASS');
  const summary = readApiDiscoverySummary(f.roots, f.roots.runRoot, f.run.id);
  assert.deepEqual(summary.gaps, ['capture-unavailable']); assert(!JSON.stringify(summary).includes('private-native-diagnostic'));
});
