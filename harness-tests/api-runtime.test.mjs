import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {writeFileSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {defineApiOperation, createApiRuntime} from '../scripts/lib/api/index.mjs';
import {defineOperation} from '../scripts/lib/execution-core/index.mjs';
import {fixture, operation, statusCheck, readEffects, writeEffects} from './fixtures/api.mjs';

test('known confidential values cannot become public JSON member names', async t => {
  const value = `synthetic-"${randomUUID()}\\key`, op = operation('key', {extract: [{name: 'payload', type: 'object', sensitivity: 'public', select: {from: 'json', path: []}}]});
  const f = await fixture(t, ({reply}) => reply(200, {[value]: 'public'}), [op], {auth: true, runtime: {resolveCredential: () => ({'x-api-key': value})}});
  const attempt = await f.call(); assert.equal(attempt.outputs.length, 0); assert.equal(f.runtime.finish().status, 'NEEDS_REVIEW');
});

for (const kind of ['catalog', 'helper', 'inline', 'exploration']) test(`${kind} performs the same real request, checks and typed extraction`, async t => {
  const op = operation('request', {kind, extract: [{name: 'recordId', type: 'number', sensitivity: 'public', select: {from: 'json', path: ['id']}}]});
  const f = await fixture(t, ({reply}) => reply(200, {id: 7}), [op]);
  const result = await f.call(); f.runtime.selectOutput(result, 'recordId');
  const assessed = f.runtime.finish(); assert.equal(assessed.status, 'PASS'); assert.equal(assessed.scenarios[0].outputs[0].value, 7); assert.equal(f.requests.length, 1);
  assert.equal(assessed.operations[0].source.kind, kind);
});

test('dynamic CRUD uses bound data and intentional persistence without mandatory before-state capture', async t => {
  const definitions = ['POST', 'GET', 'PUT', 'PATCH', 'DELETE'].map((method, index) => operation(`step-${index}`, {method, kind: 'exploration',
    request: {method, path: method === 'POST' ? '/items' : '/items/{recordId}', ...(method === 'GET' || method === 'DELETE' ? {} : {json: {label: {$input: 'label'}}})},
    checks: [statusCheck(`status-${index}`, method === 'POST' ? 201 : 200)], extract: method === 'POST' ? [{name: 'recordId', type: 'string', sensitivity: 'public', select: {from: 'json', path: ['id']}}] : []}));
  const f = await fixture(t, ({request, reply, items, effect}) => {
    if (request.method === 'POST') {items.set('row-1', request.body); effect(); reply(201, {id: 'row-1'});}
    else if (request.method === 'GET') reply(200, items.get('row-1'));
    else {effect(); if (request.method === 'DELETE') items.delete('row-1'); else items.set('row-1', request.body); reply(200);}
  }, definitions, {values: [['label', 'synthetic value']]});
  const created = await f.call(definitions[0], {phase: 'SETUP', inputs: f.run.inputs.values, resource: {id: 'row', output: 'recordId', ownership: 'harness', intent: 'persistent'}});
  for (const op of definitions.slice(1)) await f.call(op, {inputs: [...f.run.inputs.values, created.outputs[0]]});
  const result = f.runtime.finish(); assert.equal(result.status, 'PASS'); assert.equal(f.effects(), 4);
  assert.deepEqual(f.requests.map(request => request.method), ['POST', 'GET', 'PUT', 'PATCH', 'DELETE']);
  assert.equal(result.scenarios[0].resources[0].lifecycle.action, 'retain'); assert.equal(result.scenarios[0].resources[0].beforeStateRef, undefined);
});

for (const intent of ['temporary', 'persistent', 'no-obligation']) test(`resource intent ${intent} governs cleanup`, async t => {
  const create = operation('create', {method: 'POST', checks: [statusCheck('created', 201)], extract: [{name: 'recordId', type: 'string', sensitivity: 'public', select: {from: 'json', path: ['id']}}]});
  const remove = operation('remove', {method: 'DELETE', path: '/items/{recordId}', checks: intent === 'temporary' ? [statusCheck('removed', 204)] : []});
  const f = await fixture(t, ({request, reply, effect}) => {effect(); reply(request.method === 'POST' ? 201 : 204, {id: 'row-1'});}, intent === 'temporary' ? [create, remove] : [create]);
  const created = await f.call(create, {phase: 'SETUP', resource: {id: 'row', output: 'recordId', ownership: 'harness', intent}});
  if (intent === 'temporary') await f.call(remove, {phase: 'CLEANUP', inputs: created.outputs, lifecycle: {resourceId: 'row'}});
  const result = f.runtime.finish(); assert.equal(result.status, 'PASS'); assert.equal(result.scenarios[0].requiredLifecycleComplete, true); assert.equal(f.requests.length, intent === 'temporary' ? 2 : 1);
});

test('required cleanup left pending prevents a clean pass', async t => {
  const op = operation('create', {method: 'POST', extract: [{name: 'recordId', type: 'string', sensitivity: 'public', select: {from: 'json', path: ['id']}}]});
  const f = await fixture(t, ({reply}) => reply(200, {id: 'row-1'}), [op]);
  await f.call(op, {resource: {id: 'row', output: 'recordId', ownership: 'harness', intent: 'temporary'}});
  assert.equal(f.runtime.finish().status, 'NEEDS_REVIEW');
});

test('F8: ambiguous cleanup verification cannot complete a registered resource obligation', async t => {
  const create = operation('create', {method: 'POST', extract: [{name: 'recordId', type: 'string', sensitivity: 'public', select: {from: 'json', path: ['id']}}]});
  const remove = operation('remove', {method: 'DELETE', path: '/items/{recordId}', checks: [statusCheck('removed', 200)]});
  const f = await fixture(t, ({reply}) => reply(200, {id: 'row-1'}), [create, remove]);
  const created = await f.call(create, {phase: 'SETUP', resource: {id: 'row', output: 'recordId', ownership: 'harness', intent: 'temporary'}});
  await f.call(remove, {phase: 'CLEANUP', inputs: created.outputs, lifecycle: {resourceId: 'row'}, unresolvedChecks: ['removed']});
  const result = f.runtime.finish(); assert.equal(result.status, 'NEEDS_REVIEW'); const resource = result.scenarios[0].resources[0]; assert.equal(resource.lifecycle.status, 'failed');
  assert.equal(resource.lifecycle.evidenceIds.length, 1); assert.deepEqual(JSON.parse(readFileSync(join(f.roots.runRoot, result.evidence.find(item => item.id === resource.lifecycle.evidenceIds[0]).path), 'utf8')), {resourceId: 'row', complete: false});
});

test('expected non-2xx response is a reliable pass; unexpected status never retries to green', async t => {
  const op = operation('request', {method: 'POST', checks: [statusCheck('expected-rejection', 409)]});
  const f = await fixture(t, ({reply}) => reply(409), [op]); await f.call(); assert.equal(f.runtime.finish().status, 'PASS'); assert.equal(f.requests.length, 1);
  const bad = await fixture(t, ({reply}) => reply(200), [op]); await bad.call(); assert.equal(bad.runtime.finish().status, 'FAIL'); assert.equal(bad.requests.length, 1);
});

test('read-only transient disconnect recovers with complete attempt history', async t => {
  const op = operation(); const f = await fixture(t, ({req, requests, reply}) => {if (requests.length === 1) req.socket.destroy(); else reply(200);}, [op]);
  await f.call(); const result = f.runtime.finish(); assert.equal(result.status, 'PASS'); assert.equal(result.stability, 'recovered'); assert.equal(result.scenarios[0].attempts.length, 2);
});

test('GET alone does not prove safe replay', async t => {
  const op = operation('request', {effects: {}}); const f = await fixture(t, ({req}) => req.socket.destroy(), [op]);
  await f.call(); assert.equal(f.runtime.finish().status, 'NEEDS_REVIEW'); assert.equal(f.requests.length, 1);
});

test('mutation response lost after effect is uncertain and not replayed', async t => {
  const op = operation('request', {method: 'POST'}); const f = await fixture(t, ({req, effect}) => {effect(); req.socket.destroy();}, [op]);
  await f.call(); const result = f.runtime.finish(); assert.equal(result.status, 'NEEDS_REVIEW'); assert.equal(f.effects(), 1); assert.equal(result.scenarios[0].attempts[0].effect.certainty, 'uncertain');
});

test('reconciliation establishes no effect before a bounded mutation retry', async t => {
  const op = operation('request', {method: 'POST', recovery: {reconcile: {request: {method: 'GET', path: '/lookup'}, readOnlyContract: 'lookup-contract', status: 200, select: {from: 'json', path: ['exists']}, equals: false, whenEqual: 'confirmed-no-effect'}}});
  const f = await fixture(t, ({req, request, requests, reply, effect}) => {
    if (request.method === 'GET') reply(200, {exists: false}); else if (requests.length === 1) req.socket.destroy(); else {effect(); reply(200);}
  }, [op]);
  await f.call(); const result = f.runtime.finish(); assert.equal(result.status, 'PASS'); assert.equal(result.stability, 'recovered'); assert.equal(f.effects(), 1); assert.equal(f.requests.length, 3);
});

test('confirmed effect reconciliation never fabricates the lost response assertion', async t => {
  const op = operation('request', {method: 'POST', recovery: {reconcile: {request: {method: 'GET', path: '/lookup'}, readOnlyContract: 'lookup-contract', status: 200, select: {from: 'json', path: ['exists']}, equals: true, whenEqual: 'confirmed-effect'}}});
  const f = await fixture(t, ({req, request, reply, effect}) => {if (request.method === 'GET') reply(200, {exists: true}); else {effect(); req.socket.destroy();}}, [op]);
  await f.call(); const result = f.runtime.finish(); assert.equal(result.status, 'BLOCKED'); assert.equal(result.scenarios[0].counts.notEvaluated, 1); assert.equal(f.effects(), 1);
});

test('contract-supported idempotency retries the same key without duplicate effect', async t => {
  const op = operation('request', {method: 'POST', recovery: {idempotency: {contractRef: 'fixture-key-deduplication', input: 'requestKey'}}});
  const keys = new Set(); const f = await fixture(t, ({req, request, reply, effect}) => {
    const key = request.headers['idempotency-key']; if (!keys.has(key)) {keys.add(key); effect(); req.socket.destroy();} else reply(200);
  }, [op], {values: [['requestKey', randomUUID()]]});
  await f.call(op, {inputs: f.run.inputs.values}); assert.equal(f.runtime.finish().status, 'PASS'); assert.equal(f.effects(), 1); assert.equal(f.requests.length, 2);
});

test('an invented idempotency header does not enable replay', async t => {
  const op = operation('request', {method: 'POST', request: {method: 'POST', path: '/items', headers: {'idempotency-key': 'synthetic-key'}}});
  const f = await fixture(t, ({req, effect}) => {effect(); req.socket.destroy();}, [op]); await f.call(); assert.equal(f.runtime.finish().status, 'NEEDS_REVIEW'); assert.equal(f.effects(), 1);
});

test('credential refresh follows a no-effect rejection contract and does not duplicate a mutation', async t => {
  const first = randomUUID(), second = randomUUID(), resolved = [];
  const op = operation('request', {method: 'POST', recovery: {authentication: {statuses: [401], contractRef: 'auth-before-write'}}});
  const f = await fixture(t, ({request, reply, effect}) => {if (request.headers.authorization === `Bearer ${first}`) reply(401); else {effect(); reply(200);}}, [op], {auth: true,
    runtime: {resolveCredential: ({reference, target, refresh}) => {resolved.push({reference, target, refresh}); return {authorization: `Bearer ${refresh ? second : first}`};}}});
  await f.call(); const result = f.runtime.finish(); assert.equal(result.status, 'PASS'); assert.equal(result.stability, 'recovered'); assert.equal(f.effects(), 1); assert.equal(resolved.length, 2);
  assert.equal(resolved[1].refresh, true); assert(!f.allText().includes(first)); assert(!f.allText().includes(second));
});

test('401 without a refresh contract remains an assertion failure and is not replayed', async t => {
  const op = operation('request', {method: 'POST'}); let resolves = 0;
  const f = await fixture(t, ({reply}) => reply(401), [op], {auth: true, runtime: {resolveCredential: () => {resolves++; return {'x-api-key': randomUUID()};}}});
  await f.call(); assert.equal(f.runtime.finish().status, 'FAIL'); assert.equal(resolves, 1); assert.equal(f.requests.length, 1);
});

test('before-connection outage records no execution and exhausts a finite budget', async t => {
  const op = operation('request', {method: 'POST'}); const f = await fixture(t, ({reply}) => reply(200), [op]);
  const unused = createServer(); await new Promise(resolve => unused.listen(0, '127.0.0.1', resolve)); const port = unused.address().port; await new Promise(resolve => unused.close(resolve));
  // Build a separate run against the now-unavailable, explicitly configured destination.
  const {createRun} = await import('../scripts/lib/execution-core/index.mjs');
  const run = createRun({...{id: randomUUID(), environment: {...f.environment, targets: {api: {'fixture-api': {baseUrl: `http://127.0.0.1:${port}`}}, databases: {}}}, scenarios: f.run.inputs.scenarios, operations: [op]}});
  const runtime = createApiRuntime(run, {...f.roots, runRoot: join(f.roots.projectRoot, 'outage')});
  await runtime.execute({operation: op, invocationId: 'request-call'}); const result = runtime.finish(); assert.equal(result.status, 'BLOCKED'); assert.equal(result.scenarios[0].attempts.length, 2);
  assert(result.scenarios[0].attempts.every(attempt => attempt.effect.certainty === 'not-executed')); assert.equal(f.requests.length, 0);
});

for (const mode of ['protected', 'custom']) test(`${mode} denies dynamic writes before resolving credentials`, async t => {
  const op = operation('request', {method: 'POST', kind: 'exploration'}); let resolved = 0;
  const f = await fixture(t, ({reply}) => reply(200), [op], {mode, auth: true, runtime: {resolveCredential: () => {resolved++; throw new Error();}}});
  await f.call(); assert.equal(f.runtime.finish().status, 'BLOCKED'); assert.equal(resolved, 0); assert.equal(f.requests.length, 0);
});

test('catalog operations cannot bypass disabled targets', async t => {
  const op = defineApiOperation({...{id: 'request', target: 'unknown', source: {kind: 'catalog', reference: 'reviewed', version: '1'}}, request: {method: 'GET', path: '/items'}, checks: [statusCheck('status', 200)], effects: readEffects});
  const f = await fixture(t, ({reply}) => reply(200), [op]); await f.call(); assert.equal(f.runtime.finish().status, 'BLOCKED'); assert.equal(f.requests.length, 0);
});

test('selected environment and stable request definitions are immutable during a run', async t => {
  const op = operation(); const f = await fixture(t, ({reply}) => reply(200), [op]); f.environment.capabilities.apiReads = false; f.environment.targets.api['fixture-api'].baseUrl = 'https://outside.invalid';
  assert.throws(() => {op.definition.request.method = 'POST';}); assert.throws(() => {f.run.inputs.environment.capabilities.apiReads = false;});
  await f.call(); assert.equal(f.runtime.finish().status, 'PASS'); assert.equal(f.requests.length, 1);
});

for (const path of ['/../outside', '/%2e%2e/outside', '/%252e%252e/outside', '/%2foutside']) test(`path escape ${path} is refused before credential resolution`, async t => {
  const op = operation('request', {path}); let resolves = 0;
  const f = await fixture(t, ({reply}) => reply(200), [op], {basePath: '/scope', auth: true, runtime: {resolveCredential: () => {resolves++; throw new Error();}}});
  await f.call(); assert.equal(f.runtime.finish().status, 'BLOCKED'); assert.equal(resolves, 0); assert.equal(f.requests.length, 0);
});

test('redirects are refused and credentials never reach the other target', async t => {
  let leaked = 0; const other = createServer((req, res) => {leaked++; res.end();}); await new Promise(resolve => other.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => other.close(resolve)));
  const op = operation(); const f = await fixture(t, ({reply}) => reply(302, {}, {location: `http://127.0.0.1:${other.address().port}/outside`}), [op], {auth: true, runtime: {resolveCredential: () => ({authorization: `Bearer ${randomUUID()}`})}});
  await f.call(); assert.equal(f.runtime.finish().status, 'BLOCKED'); assert.equal(leaked, 0); assert.equal(f.requests.length, 1); assert.match(f.allText(), /REDIRECT_REFUSED/);
});

test('response bounds close the request; raw payloads are never persisted', async t => {
  const marker = randomUUID(), op = operation('request', {maxResponseBytes: 64});
  const f = await fixture(t, ({reply}) => reply(200, {body: marker.repeat(20)}), [op]); await f.call(); assert.equal(f.runtime.finish().status, 'BLOCKED'); assert(!f.allText().includes(marker)); assert.match(f.allText(), /RESPONSE_LIMIT/);
});

test('mutation timeout records uncertainty and cancels the socket', async t => {
  const op = operation('request', {method: 'POST', timeoutMs: 60}); const f = await fixture(t, ({effect}) => effect(), [op]);
  await f.call(); const result = f.runtime.finish(); assert.equal(result.status, 'NEEDS_REVIEW'); assert.equal(f.effects(), 1); assert.equal(result.scenarios[0].attempts[0].failureClass, 'TIMEOUT');
});

test('a stalled credential resolver is bounded and cannot dispatch late', async t => {
  const op = operation('request', {timeoutMs: 50}); let release;
  const f = await fixture(t, ({reply}) => reply(200), [op], {auth: true, runtime: {resolveCredential: () => new Promise(resolve => {release = resolve;})}});
  await f.call(op, {retry: false}); assert.equal(f.runtime.finish().status, 'BLOCKED'); release({authorization: `Bearer ${randomUUID()}`});
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(f.requests.length, 0);
});

test('cancellation prevents dispatch and future attempts', async t => {
  const controller = new AbortController(); const f = await fixture(t, ({reply}) => reply(200), [operation()], {runtime: {signal: controller.signal}}); controller.abort();
  await f.call(); const result = f.runtime.finish(); assert.equal(result.status, 'BLOCKED'); assert.equal(result.scenarios[0].attempts.length, 1); assert.equal(f.requests.length, 0);
});

test('selected secret output is refused and credential-shaped response fields never enter artifacts', async t => {
  const value = randomUUID(), op = operation('request', {extract: [{name: 'leak', type: 'string', sensitivity: 'public', select: {from: 'json', path: ['echo']}}]});
  const f = await fixture(t, ({reply}) => reply(200, {echo: value, password: value}), [op], {auth: true, runtime: {resolveCredential: () => ({'x-api-key': value})}});
  await f.call(); assert.equal(f.runtime.finish().status, 'NEEDS_REVIEW'); assert(!f.allText().includes(value)); assert.equal(f.requests.length, 1);
});

test('sensitive extraction serializes only a protected reference', async t => {
  const value = randomUUID(), protectedValues = new Map();
  const op = operation('request', {extract: [{name: 'confidential', type: 'string', sensitivity: 'sensitive', select: {from: 'json', path: ['access_token']}}]});
  const f = await fixture(t, ({reply}) => reply(200, {access_token: value}), [op], {runtime: {storeSensitive: item => {protectedValues.set('protected:fixture', item); return 'protected:fixture';}}});
  const attempt = await f.call(); f.runtime.selectOutput(attempt, 'confidential'); const result = f.runtime.finish(); assert.equal(result.status, 'PASS'); assert.equal(protectedValues.get('protected:fixture'), value); assert(!f.allText().includes(value));
});

test('evidence tampering prevents result publication', async t => {
  const f = await fixture(t, ({reply}) => reply(200), [operation()]); const attempt = await f.call();
  writeFileSync(join(f.roots.runRoot, `evidence/${attempt.evidenceIds[0]}.json`), '{}'); assert.throws(() => f.runtime.finish(), /integrity/);
});

test('incorrect extraction type does not retry to green or pass despite reliable status', async t => {
  const op = operation('request', {extract: [{name: 'id', type: 'number', sensitivity: 'public', select: {from: 'json', path: ['id']}}]});
  const f = await fixture(t, ({reply}) => reply(200, {id: 'wrong-type'}), [op]); await f.call(); assert.equal(f.runtime.finish().status, 'NEEDS_REVIEW'); assert.equal(f.requests.length, 1);
});

test('definition validation prevents capability spoofing and raw credential headers', () => {
  assert.throws(() => operation('request', {request: {method: 'POST', path: '/items', headers: {authorization: 'Bearer <placeholder>'}}}));
  assert.throws(() => operation('request', {effects: {readOnlyContract: 'contract', confirmedStatuses: [200], contractRef: 'write'}}));
  const bad = defineOperation({id: 'request', family: 'api', target: 'fixture-api', capability: 'apiReads', source: {kind: 'inline', reference: 'fixture', version: '1'}, definition: {request: {method: 'POST', path: '/items'}, effects: writeEffects, checks: []}});
  // validate on the public entry path, not just the convenience constructor.
  return import('../scripts/lib/api/definition.mjs').then(({validateApiOperation}) => assert.throws(() => validateApiOperation(bad), /capability/));
});

for (const conflict of [false, true]) test(`conditional restoration ${conflict ? 'preserves a concurrent update' : 'restores only the owned version'}`, async t => {
  const change = operation('change', {method: 'PATCH', checks: [statusCheck('changed', 200)], extract: [
    {name: 'recordId', type: 'string', sensitivity: 'public', select: {from: 'json', path: ['id']}},
    {name: 'revision', type: 'string', sensitivity: 'public', select: {from: 'header', path: ['etag']}}
  ]});
  const restore = operation('restore', {method: 'PUT', request: {method: 'PUT', path: '/items/{recordId}', headers: {'if-match': {$input: 'revision'}}, json: {label: {$input: 'original'}}}, checks: [statusCheck('restored', conflict ? 412 : 200)]});
  let current = 'original', revision = '"v1"';
  const f = await fixture(t, ({request, reply, effect}) => {
    if (request.method === 'PATCH') {current = 'temporary'; revision = '"v2"'; effect(); reply(200, {id: 'row-1'}, {etag: revision});}
    else if (request.headers['if-match'] !== revision) reply(412);
    else {current = request.body.label; effect(); reply(200);}
  }, [change, restore], {values: [['original', 'original']]});
  const changed = await f.call(change, {phase: 'SETUP', resource: {id: 'row', output: 'recordId', ownership: 'existing', intent: 'restore'}});
  if (conflict) {current = 'concurrent-change'; revision = '"v3"';}
  await f.call(restore, {phase: 'RESTORE', inputs: [...changed.outputs, ...f.run.inputs.values], lifecycle: {resourceId: 'row', guard: 'version'}});
  const result = f.runtime.finish(); assert.equal(result.status, conflict ? 'NEEDS_REVIEW' : 'PASS'); assert.equal(current, conflict ? 'concurrent-change' : 'original');
  assert.equal(result.scenarios[0].resources[0].lifecycle.status, conflict ? 'conflict' : 'completed');
});

test('required cleanup failure preserves an established assertion failure', async t => {
  const create = operation('create', {method: 'POST', checks: [statusCheck('created', 201)], extract: [{name: 'recordId', type: 'string', sensitivity: 'public', select: {from: 'json', path: ['id']}}]});
  const remove = operation('remove', {method: 'DELETE', path: '/items/{recordId}', checks: [statusCheck('removed', 204)]});
  const f = await fixture(t, ({request, reply}) => reply(request.method === 'POST' ? 200 : 503, {id: 'row-1'}), [create, remove]);
  const created = await f.call(create, {phase: 'SETUP', resource: {id: 'row', output: 'recordId', ownership: 'harness', intent: 'temporary'}});
  await f.call(remove, {phase: 'CLEANUP', inputs: created.outputs, lifecycle: {resourceId: 'row'}});
  const result = f.runtime.finish(); assert.equal(result.status, 'FAIL'); assert.equal(result.scenarios[0].requiredLifecycleComplete, false); assert.equal(f.requests.length, 2);
});

test('required cleanup retains its independent deadline after ordinary cancellation', async t => {
  const controller = new AbortController();
  const create = operation('create', {method: 'POST', extract: [{name: 'recordId', type: 'string', sensitivity: 'public', select: {from: 'json', path: ['id']}}]});
  const remove = operation('remove', {method: 'DELETE', path: '/items/{recordId}', checks: [statusCheck('removed', 204)]});
  const f = await fixture(t, ({request, reply}) => reply(request.method === 'POST' ? 200 : 204, {id: 'row-1'}), [create, remove], {runtime: {signal: controller.signal}});
  const created = await f.call(create, {phase: 'SETUP', resource: {id: 'row', output: 'recordId', ownership: 'harness', intent: 'temporary'}}); controller.abort();
  await f.call(remove, {phase: 'CLEANUP', inputs: created.outputs, lifecycle: {resourceId: 'row'}}); assert.equal(f.runtime.finish().status, 'PASS');
});

test('typed query/body binding preserves structured values and escapes query text', async t => {
  const op = operation('request', {method: 'POST', request: {method: 'POST', path: '/items', query: {filter: {$input: 'filter'}}, json: {payload: {$input: 'payload'}}},
    checks: [statusCheck('status', 200), {id: 'echo', select: {from: 'json', path: []}, equals: {$input: 'payload'}}]});
  const payload = {active: true, count: 3, tags: ['one', 'two']};
  const f = await fixture(t, ({request, reply}) => reply(200, request.body.payload), [op], {values: [['filter', 'a&b=#x'], ['payload', payload]]});
  await f.call(op, {inputs: f.run.inputs.values}); assert.equal(f.runtime.finish().status, 'PASS'); assert.equal(f.requests[0].path, '/items?filter=a%26b%3D%23x'); assert.deepEqual(f.requests[0].body.payload, payload);
});

test('inconclusive or denied reconciliation cannot authorize replay', async t => {
  const op = operation('request', {method: 'POST', recovery: {reconcile: {request: {method: 'GET', path: '/lookup'}, readOnlyContract: 'lookup-contract', status: 200, select: {from: 'json', path: ['exists']}, equals: false, whenEqual: 'confirmed-no-effect'}}});
  for (const allowRead of [true, false]) {
    const f = await fixture(t, ({req, request, reply}) => {if (request.method === 'GET') reply(503); else req.socket.destroy();}, [op], {capabilities: {apiReads: allowRead}});
    await f.call(); assert.equal(f.runtime.finish().status, 'NEEDS_REVIEW'); assert.equal(f.requests.length, allowRead ? 2 : 1);
  }
});

test('expired run is recorded without dispatch, and runtime cannot be reused after finish', async t => {
  const f = await fixture(t, ({reply}) => reply(200), [operation()], {limits: {timeoutMs: 20}});
  await new Promise(resolve => setTimeout(resolve, 30)); await f.call(); assert.equal(f.runtime.finish().status, 'BLOCKED'); assert.equal(f.requests.length, 0);
  await assert.rejects(f.call(), /active runtime/); assert.throws(() => f.runtime.finish(), /idle active/);
});

test('parallel invocations are refused while a real request is pending', async t => {
  let release, arrived; const arrival = new Promise(resolve => {arrived = resolve;});
  const f = await fixture(t, ({reply}) => {release = () => reply(200); arrived();}, [operation()]); const first = f.call(); await arrival;
  await assert.rejects(f.call(), /sequential/); assert.throws(() => f.runtime.finish(), /idle active/); release(); await first; assert.equal(f.runtime.finish().status, 'PASS');
});

for (const scheme of ['cookie', 'basic']) test(`credential components from ${scheme} are screened even under neutral response fields`, async t => {
  const confidential = randomUUID();
  const op = operation('request', {checks: [statusCheck('status', 200), {id: 'echo-check', select: {from: 'json', path: ['echo']}, equals: null}],
    extract: [{name: 'echo', type: 'string', sensitivity: 'public', select: {from: 'json', path: ['echo']}}]});
  const f = await fixture(t, ({reply}) => reply(200, {echo: confidential}), [op], {auth: true, runtime: {resolveCredential: () => scheme === 'cookie'
    ? {cookie: `session=${confidential}`} : {authorization: `Basic ${Buffer.from(`fixture:${confidential}`).toString('base64')}`}}});
  await f.call(); assert.equal(f.runtime.finish().status, 'FAIL'); assert(!f.allText().includes(confidential));
});

for (const datum of [randomUUID(), 719483]) test(`declared sensitive ${typeof datum} is classified before assertion evidence`, async t => {
  const op = operation('request', {checks: [statusCheck('status', 200), {id: 'private-check', select: {from: 'json', path: ['datum']}, equals: null}],
    extract: [{name: 'datum', type: typeof datum, sensitivity: 'sensitive', select: {from: 'json', path: ['datum']}}]});
  const f = await fixture(t, ({reply}) => reply(200, {datum}), [op], {runtime: {storeSensitive: () => 'protected:datum'}});
  await f.call(); assert.equal(f.runtime.finish().status, 'FAIL'); assert(!f.allText().includes(String(datum)));
});

test('idempotent replay snapshots sensitive request inputs once despite changing protected storage', async t => {
  let resolutions = 0; const seen = new Set();
  const op = operation('request', {method: 'POST', request: {method: 'POST', path: '/items', json: {payload: {$input: 'payload'}}}, recovery: {idempotency: {contractRef: 'fixture-deduplication', input: 'requestKey'}}});
  const f = await fixture(t, ({req, request, requests, reply, effect}) => {
    const key = request.headers['idempotency-key']; if (!seen.has(key)) {seen.add(key); effect();} if (requests.length === 1) req.socket.destroy(); else reply(200);
  }, [op], {sensitiveValues: [['requestKey', 'string', 'protected:request-key'], ['payload', 'object', 'protected:payload']], runtime: {
    resolveSensitive: reference => {resolutions++; return reference.endsWith('request-key') ? randomUUID() : {value: randomUUID()};}
  }});
  await f.call(op, {inputs: f.run.inputs.values}); const result = f.runtime.finish(); assert.equal(result.status, 'PASS'); assert.equal(result.stability, 'recovered');
  assert.equal(f.effects(), 1); assert.equal(resolutions, 2); assert.deepEqual(f.requests[0].body, f.requests[1].body); assert.equal(f.requests[0].headers['idempotency-key'], f.requests[1].headers['idempotency-key']);
});

test('a declared GET mutation uses mutation permission even in a reviewed catalog', async t => {
  const op = operation('request', {kind: 'catalog', effects: {confirmedStatuses: [200], contractRef: 'declared-write'}});
  const f = await fixture(t, ({reply, effect}) => {effect(); reply(200);}, [op], {mode: 'protected'});
  await f.call(); assert.equal(f.runtime.finish().status, 'BLOCKED'); assert.equal(op.capability, 'apiMutations'); assert.equal(f.effects(), 0);
});

test('sensitive wire fields accept reference-only JSON templates and bind only in memory', async t => {
  const confidential = randomUUID();
  const op = operation('request', {method: 'POST', request: {method: 'POST', path: '/items', json: {password: {$input: 'credentialValue'}}}});
  const f = await fixture(t, ({request, reply}) => {const received = request.body.password; reply(received === confidential ? 200 : 400);}, [op], {
    sensitiveValues: [['credentialValue', 'string', 'protected:credential-value']], runtime: {resolveSensitive: () => confidential}
  });
  await f.call(op, {inputs: f.run.inputs.values}); assert.equal(f.runtime.finish().status, 'PASS'); assert.equal(f.requests[0].body.password, confidential); assert(!f.allText().includes(confidential));
});

test('a public value cannot be mislabeled as a protected wire-field input', async t => {
  const op = operation('request', {method: 'POST', request: {method: 'POST', path: '/items', json: {password: {$input: 'credentialValue'}}}});
  const f = await fixture(t, ({reply}) => reply(200), [op], {values: [['credentialValue', randomUUID()]]});
  await assert.rejects(f.call(op, {inputs: f.run.inputs.values}), /protected input/); assert.equal(f.requests.length, 0);
});

test('simultaneous cancellation and deadline expiry produces a normalized refused attempt', async t => {
  const controller = new AbortController(); const f = await fixture(t, ({reply}) => reply(200), [operation()], {limits: {timeoutMs: 20}, runtime: {signal: controller.signal}});
  await new Promise(resolve => setTimeout(resolve, 30)); controller.abort(); await f.call(); const result = f.runtime.finish();
  assert.equal(result.status, 'BLOCKED'); assert.equal(result.scenarios[0].attempts[0].failureClass, 'TIMEOUT'); assert.equal(f.requests.length, 0);
});

for (const representation of ['text', 'ancestor', 'descendant', 'header']) test(`sensitive ${representation} selector overlap cannot enter assertions or public outputs`, async t => {
  const datum = 719483, confidential = representation === 'header' ? {from: 'header', path: ['X-FIXTURE']} : {from: 'json', path: representation === 'descendant' ? ['nested'] : ['nested', 'datum']};
  const exposed = representation === 'text' ? {from: 'text', path: []} : representation === 'ancestor' ? {from: 'json', path: []} : representation === 'descendant' ? {from: 'json', path: ['nested', 'datum']} : {from: 'header', path: ['x-fixture']};
  const op = operation('request', {checks: [statusCheck('status', 200), {id: 'overlap', select: exposed, equals: null}], extract: [
    {name: 'confidential', type: representation === 'descendant' ? 'object' : representation === 'header' ? 'string' : 'number', sensitivity: 'sensitive', select: confidential},
    {name: 'overlap', type: representation === 'text' || representation === 'header' ? 'string' : representation === 'ancestor' ? 'object' : 'number', sensitivity: 'public', select: exposed}
  ]});
  const f = await fixture(t, ({reply}) => reply(200, {nested: {datum}}, {'x-fixture': String(datum)}), [op], {runtime: {storeSensitive: () => 'protected:datum'}});
  const attempt = await f.call(); assert.equal(f.runtime.finish().status, 'FAIL'); assert(!attempt.outputs.some(output => output.name === 'overlap')); assert(!f.allText().includes(String(datum)));
});

test('public raw-text extraction cannot bypass credential field screening even without an explicit sensitive selector', async t => {
  const datum = randomUUID(), op = operation('request', {extract: [{name: 'text', type: 'string', sensitivity: 'public', select: {from: 'text', path: []}}]});
  const f = await fixture(t, ({reply}) => reply(200, {password: datum}), [op]); await f.call(); assert.equal(f.runtime.finish().status, 'NEEDS_REVIEW'); assert(!f.allText().includes(datum));
});

// The default resolver reads the shell first and the consumer's ignored .env second.
function shellCredential(t, value) {
  const previous = process.env.FIXTURE_ACCESS;
  if (value === undefined) delete process.env.FIXTURE_ACCESS; else process.env.FIXTURE_ACCESS = value;
  t.after(() => {if (previous === undefined) delete process.env.FIXTURE_ACCESS; else process.env.FIXTURE_ACCESS = previous;});
}
test('default credentials fall back to the consumer .env without changing process.env', async t => {
  shellCredential(t, undefined);
  const f = await fixture(t, ({reply}) => reply(200, {}), [operation()], {auth: true});
  writeFileSync(join(f.roots.projectRoot, '.env'), 'FIXTURE_ACCESS="synthetic-dotenv"\n');
  await f.call(); assert.equal(f.requests[0].headers.authorization, 'Bearer synthetic-dotenv'); assert.equal(process.env.FIXTURE_ACCESS, undefined);
});
test('a shell credential wins over the consumer .env', async t => {
  shellCredential(t, 'synthetic-shell');
  const f = await fixture(t, ({reply}) => reply(200, {}), [operation()], {auth: true});
  writeFileSync(join(f.roots.projectRoot, '.env'), 'FIXTURE_ACCESS=synthetic-dotenv\n');
  await f.call(); assert.equal(f.requests[0].headers.authorization, 'Bearer synthetic-shell');
});
