import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync, readFileSync, unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createRun, defineOperation, registerEvidence} from '../scripts/lib/execution-core/index.mjs';
import {createApiRuntime} from '../scripts/lib/api/index.mjs';
import {fingerprint} from '../scripts/lib/execution-core/data.mjs';
import {fixture, operation, statusCheck} from './fixtures/api.mjs';
import {sanitizeApiObservation, storeApiCandidate, readApiCandidate, listApiCandidates,
  reviewApiCandidate, readReviewedApi, promoteObservedCollection} from '../scripts/lib/api/discovery.mjs';

const privateValue = 'CustomerAlicePrivateSentinel';
function raw(baseUrl, patch = {}) {
  return {method: 'GET', url: `${baseUrl}/items?search=${privateValue}`, resourceType: 'fetch',
    requestHeaders: [{name: 'authorization', value: 'Bearer session-private-sentinel'}, {name: 'accept', value: 'application/json'}],
    responseHeaders: [{name: 'set-cookie', value: 'session=private-session-sentinel'}, {name: 'content-type', value: 'application/json'}],
    requestBody: {state: 'omitted'}, responseBody: {state: 'known', contentType: 'application/json', text: JSON.stringify({items: [{id: privateValue, email: 'private@example.invalid', token: '<session-private-sentinel>'}]})}, status: 200, ...patch};
}
async function setup(t, {definition = operation('read-items', {request: {method: 'GET', path: '/items', query: {search: {$input: 'search'}}}}), auth = false, values = [['search', 'synthetic']], additionalOperations = [], handler = ({reply}) => reply(200, {items: []})} = {}) {
  const f = await fixture(t, handler, [definition, ...additionalOperations], {values, auth,
    runtime: auth ? {resolveCredential: () => ({authorization: 'Bearer synthetic-validation'})} : {}});
  const browser = defineOperation({id: 'browser-observe', family: 'browser', target: 'app', capability: 'browserReads', source: {kind: 'inline', reference: 'fixture', version: '1'}, definition: {intent: 'Observe items'}});
  const run = createRun({environment: {...f.environment, browserTargets: ['app'], targets: {...f.environment.targets, browser: {app: {origins: [new URL(f.environment.targets.api['fixture-api'].baseUrl).origin]}}}}, operations: [browser],
    scenarios: [{id: 'case', expectations: [{id: 'visible', description: 'Items visible', operationId: browser.id, invocationId: 'browse', requiredEvidence: ['observation']}]}]});
  const roots = {...f.roots, runRoot: join(f.roots.projectRoot, 'capture')}; mkdirSync(join(roots.runRoot, 'evidence'), {recursive: true});
  const identity = {runId: run.id, scenarioId: 'case', operationId: browser.id, invocationId: 'browse', attemptId: 'browser-attempt', phase: 'EXERCISE', number: 1};
  function capture(patch = {}, sequence = 1) {
    const observation = sanitizeApiObservation(raw(f.environment.targets.api['fixture-api'].baseUrl, {requestHeaders: [], ...patch}), {run, identity, browserTarget: 'app', sequence});
    const path = `evidence/discovery-${sequence}.json`; writeFileSync(join(roots.runRoot, path), JSON.stringify(observation));
    const evidence = registerEvidence(run, roots, {id: `discovery-${sequence}`, identity, kind: 'observation', path, sanitized: true});
    return storeApiCandidate(run, roots, {observation, evidence});
  }
  return {...f, captureRun: run, captureRoots: roots, identity, capture, definition};
}
async function review(f, candidate, changes = {}) {
  const attempt = await f.call(f.definition, {inputs: f.run.inputs.values}); const result = f.runtime.finish(); assert.equal(result.status, 'PASS');
  writeFileSync(join(f.roots.projectRoot, 'review.md'), 'Independent review: synthetic item lookup, parameterized search, configured target, read-only fixture contract; no resource is created.');
  return reviewApiCandidate(f.roots, {candidateId: candidate.id, operation: f.definition,
    review: {reviewer: 'fixture-reviewer', artifact: 'review.md', purpose: 'Read items', inputs: 'search is supplied by the selected case',
      authentication: {kind: f.environment.targets.api['fixture-api'].credentialRef ? 'configured' : 'none'}, responseExtraction: 'No output extraction is needed.', stateEffects: 'The fixture returns a response without persisting any resource.', cleanup: {kind: 'none', ...(f.definition.definition.effects.readOnlyContract ? {} : {reason: 'no-owned-resource'})}},
    validation: {run: f.run, roots: f.roots, observations: JSON.parse(readFileSync(join(f.roots.runRoot, 'observations.json'), 'utf8')), attemptId: attempt.identity.attemptId}, ...changes});
}

test('passive observations preserve bounded structure and source identity without captured scalar values', async t => {
  const f = await setup(t); const input = raw(f.environment.targets.api['fixture-api'].baseUrl);
  const observation = sanitizeApiObservation(input, {run: f.captureRun, identity: f.identity, browserTarget: 'app', sequence: 1});
  assert.deepEqual(observation.identity, f.identity); assert.equal(observation.target, 'fixture-api');
  assert.equal(observation.observedPath, '/items'); assert.equal(observation.request.query[0].name, 'search');
  for (const secret of [privateValue, 'private@example.invalid', 'session-private-sentinel', 'private-session-sentinel', '127.0.0.1']) assert(!JSON.stringify(observation).includes(secret));
  const privatePath = sanitizeApiObservation({...input, url: `${f.environment.targets.api['fixture-api'].baseUrl}/items/${privateValue}`}, {run: f.captureRun, identity: f.identity, browserTarget: 'app', sequence: 3});
  assert.equal(privatePath.observedPath, '/items/{segment2}'); assert(!JSON.stringify(privatePath).includes(privateValue));
  assert.equal(observation.request.body.state, 'omitted'); assert.equal(observation.response.body.state, 'known');
  const dynamic = sanitizeApiObservation({...input, responseBody: {state: 'known', contentType: 'application/json', text: JSON.stringify({CustomerAlicePrivateSentinel: 42})}}, {run: f.captureRun, identity: f.identity, browserTarget: 'app', sequence: 2});
  assert(!JSON.stringify(dynamic).includes(privateValue)); assert(dynamic.gaps.includes('response-field-names-redacted'));
  assert(observation.gaps.includes('authentication-unverified')); assert(observation.gaps.includes('cleanup-unverified'));
  assert.equal(sanitizeApiObservation({...input, url: 'https://outside.invalid/items'}, {run: f.captureRun, identity: f.identity, browserTarget: 'app', sequence: 1}), null);
  assert.equal(sanitizeApiObservation({...input, resourceType: 'image'}, {run: f.captureRun, identity: f.identity, browserTarget: 'app', sequence: 1}), null);
});

test('Postman JSON preserves verified scalar input types when variables are substituted', async t => {
  const definition = operation('submit-items', {method: 'POST', request: {method: 'POST', path: '/items',
    json: {quantity: {$input: 'quantity'}, enabled: {$input: 'enabled'}, label: {$input: 'label'}, value: {$input: 'empty'}, items: [{price: {$input: 'price'}}]}}});
  const f = await setup(t, {definition, values: [['quantity', 2], ['enabled', true], ['label', 'synthetic'], ['empty', null], ['price', 4.5]]});
  const candidate = f.capture({method: 'POST', url: `${f.environment.targets.api['fixture-api'].baseUrl}/items`,
    requestBody: {state: 'known', contentType: 'application/json', text: JSON.stringify({quantity: 12, enabled: false, label: privateValue, value: null, items: [{price: 19.5}]})}});
  const reviewed = await review(f, candidate), exported = await promoteObservedCollection(f.roots, {application: 'orders', reviewedIds: [reviewed.id]});
  const collection = JSON.parse(readFileSync(exported.path, 'utf8')), rawBody = collection.item[0].request.body.raw;
  const variables = {quantity: '3', enabled: 'false', label: 'new-synthetic', empty: 'null', price: '2.25'};
  const parsed = JSON.parse(rawBody.replace(/\{\{([A-Za-z0-9_-]+)\}\}/g, (_, name) => variables[name]));
  assert.deepEqual(parsed, {quantity: 3, enabled: false, label: 'new-synthetic', value: null, items: [{price: 2.25}]});
  assert(!rawBody.includes(privateValue));
  const variantOperation = operation('submit-fixed-label', {method: 'POST', request: {...definition.definition.request, json: {...definition.definition.request.json, label: 'fixed-synthetic'}}});
  const variantCandidate = f.capture({method: 'POST', url: `${f.environment.targets.api['fixture-api'].baseUrl}/items`,
    requestBody: {state: 'known', contentType: 'application/json', text: JSON.stringify({quantity: 12, enabled: false, label: privateValue, value: null, items: [{price: 19.5}]})}}, 2);
  const variant = await review(await nextValidation(f, variantOperation), variantCandidate);
  await promoteObservedCollection(f.roots, {application: 'orders', reviewedIds: [variant.id]});
  const variants = JSON.parse(readFileSync(exported.path, 'utf8')).item; assert.equal(variants.length, 2);
  assert.equal(variants.filter(item => item.request.body.raw.includes('fixed-synthetic')).length, 1);
});

test('Postman response examples preserve captured null values at every nesting level', async t => {
  const f = await setup(t), candidate = f.capture({responseBody: {state: 'known', contentType: 'application/json', text: '{"value":null,"items":[null,{"value":null}]}'}});
  const reviewed = await review(f, candidate), exported = await promoteObservedCollection(f.roots, {application: 'orders', reviewedIds: [reviewed.id]});
  const collection = JSON.parse(readFileSync(exported.path, 'utf8'));
  assert.deepEqual(JSON.parse(collection.item[0].response[0].body), {value: null, items: [null, {value: null}]});
});

async function mutationValidation(t, {tracked = true, unrelated = false, secondResource = false} = {}) {
  const definition = operation('create-item', {method: 'POST', extract: [{name: 'recordId', type: 'string', sensitivity: 'public', select: {from: 'json', path: ['id']}}, ...(secondResource ? [{name: 'otherId', type: 'string', sensitivity: 'public', select: {from: 'json', path: ['orderId']}}] : [])]});
  const cleanup = unrelated ? operation('unrelated-read', {checks: [statusCheck('read', 200)]}) : operation('remove-item', {method: 'DELETE', path: '/items/{recordId}', checks: [statusCheck('removed', 200)]});
  const otherCleanup = operation('remove-other-item', {method: 'DELETE', path: '/items/{otherId}', checks: [statusCheck('other-removed', 200)]});
  const f = await setup(t, {definition, additionalOperations: [cleanup, ...(secondResource ? [otherCleanup] : [])], handler: ({request, reply, items}) => {
    if (request.method === 'POST') {items.set('synthetic-item', true); if (secondResource) items.set('other-item', true); reply(200, {id: 'synthetic-item', ...(secondResource ? {orderId: 'other-item'} : {})});}
    else {if (request.method === 'DELETE') items.delete(request.path.split('/').at(-1)); reply(200);}
  }});
  const candidate = f.capture({method: 'POST', url: `${f.environment.targets.api['fixture-api'].baseUrl}/items`, responseBody: {state: 'known', contentType: 'application/json', text: JSON.stringify({id: 'private-item', ...(secondResource ? {orderId: 'private-other-item'} : {})})}});
  const created = await f.call(definition, {...(tracked ? {resource: {id: 'owned-item', output: 'recordId', ownership: 'harness', intent: 'temporary'}} : {})});
  const removed = await f.call(cleanup, {phase: 'CLEANUP', inputs: created.outputs, ...(tracked && !unrelated ? {lifecycle: {resourceId: 'owned-item'}} : {})});
  const otherRemoved = secondResource && await f.call(otherCleanup, {phase: 'CLEANUP', inputs: created.outputs});
  assert.equal(f.runtime.finish().status, 'PASS');
  writeFileSync(join(f.roots.projectRoot, 'review.md'), 'Independent synthetic mutation and cleanup review.');
  const request = {candidateId: candidate.id, operation: definition, review: {reviewer: 'fixture-reviewer', artifact: 'review.md', purpose: 'Create item', inputs: 'No request inputs.', authentication: {kind: 'none'}, responseExtraction: 'Extract the created item identity.', stateEffects: 'Creates an owned item.', cleanup: {kind: 'verified', operationId: cleanup.id}},
    validation: {run: f.run, roots: f.roots, observations: JSON.parse(readFileSync(join(f.roots.runRoot, 'observations.json'), 'utf8')), attemptId: created.identity.attemptId}};
  if (secondResource) {
    // The API adapter tracks one resource per call; the core also accepts a bulk mutation's typed resource bindings.
    const observations = request.validation.observations, scenario = observations.scenarios[0];
    const origin = scenario.attempts.find(item => item.identity.attemptId === created.identity.attemptId), lifecycle = scenario.attempts.find(item => item.identity.attemptId === otherRemoved.identity.attemptId);
    origin.effect.resourceIds.push('other-owned-item'); lifecycle.effect.resourceIds.push('other-owned-item');
    const path = 'evidence/other-lifecycle.json'; writeFileSync(join(f.roots.runRoot, path), JSON.stringify({resourceId: 'other-owned-item', complete: true}));
    const proof = registerEvidence(f.run, f.roots, {id: 'other-lifecycle', identity: lifecycle.identity, kind: 'lifecycle', path, sanitized: true});
    observations.evidence.push(proof); lifecycle.evidenceIds.push(proof.id);
    scenario.resources.push({id: 'other-owned-item', originAttemptId: created.identity.attemptId, identity: {attemptId: created.identity.attemptId, name: 'otherId'}, ownership: 'harness', intent: 'temporary', lifecycle: {action: 'cleanup', status: 'completed', attemptId: lifecycle.identity.attemptId, evidenceIds: [proof.id]}});
  }
  return {...f, request, created, removed};
}

test('verified mutation cleanup cannot be replaced by an unrelated successful cleanup-phase read', async t => {
  const f = await mutationValidation(t, {tracked: false, unrelated: true});
  assert.equal(f.items.size, 1);
  assert.throws(() => reviewApiCandidate(f.roots, f.request), /cleanup|lifecycle|resource/i);
});

test('verified cleanup must cover every applicable resource of the validated mutation', async t => {
  const f = await mutationValidation(t, {secondResource: true});
  assert.equal(f.items.size, 0);
  assert.throws(() => reviewApiCandidate(f.roots, f.request), /every.*resource|named.*lifecycle/i);
});

for (const tamper of ['delete', 'change']) test(`reviewed mutation reuse and promotion reject ${tamper}d cleanup evidence`, async t => {
  const f = await mutationValidation(t), reviewed = reviewApiCandidate(f.roots, f.request);
  assert.equal(f.items.size, 0);
  assert.equal(readReviewedApi(f.roots, reviewed.id).id, reviewed.id);
  const exported = await promoteObservedCollection(f.roots, {application: 'orders', reviewedIds: [reviewed.id]}), before = readFileSync(exported.path, 'utf8');
  const dependent = f.request.validation.observations.evidence.filter(item => f.removed.evidenceIds.includes(item.id));
  assert.equal(dependent.length, 5);
  assert(dependent.every(item => reviewed.verification.evidence.some(saved => saved.id === item.id && saved.sha256 === item.sha256)));
  assert.equal(reviewed.verification.cleanup[0].resource.originAttemptId, f.created.identity.attemptId);
  assert.deepEqual(reviewed.verification.cleanup[0].attempt.identity, f.removed.identity);
  for (const item of dependent) {
    const path = join(f.roots.runRoot, item.path);
    if (tamper === 'delete') unlinkSync(path); else writeFileSync(path, Buffer.alloc(item.bytes, 'x'));
  }
  assert.throws(() => readReviewedApi(f.roots, reviewed.id));
  await assert.rejects(promoteObservedCollection(f.roots, {application: 'orders', reviewedIds: [reviewed.id]}));
  assert.equal(readFileSync(exported.path, 'utf8'), before);
});

test('legacy verified cleanup without bound lifecycle dependencies requires a new review', async t => {
  const f = await mutationValidation(t), reviewed = reviewApiCandidate(f.roots, f.request);
  const {id: _id, path: _path, ...legacy} = structuredClone(reviewed);
  delete legacy.verification.cleanup;
  legacy.verification.evidence = legacy.verification.evidence.filter(item => item.identity.attemptId === f.created.identity.attemptId).map(({path, sha256, bytes}) => ({path, sha256, bytes}));
  const legacyId = fingerprint(legacy);
  writeFileSync(join(f.roots.projectRoot, '.harness/knowledge/api/records', `${legacyId}.json`), JSON.stringify({id: legacyId, ...legacy}));
  assert.throws(() => readReviewedApi(f.roots, legacyId), /dependencies are unavailable.*review.*again/i);
  await assert.rejects(promoteObservedCollection(f.roots, {application: 'orders', reviewedIds: [legacyId]}), /dependencies are unavailable.*review.*again/i);
});

test('review refuses JSON input bindings whose verified types differ from the observation', async t => {
  const definition = operation('submit-items', {method: 'POST', request: {method: 'POST', path: '/items', json: {quantity: {$input: 'quantity'}}}});
  const f = await setup(t, {definition, values: [['quantity', '2']]});
  const candidate = f.capture({method: 'POST', url: `${f.environment.targets.api['fixture-api'].baseUrl}/items`, requestBody: {state: 'known', contentType: 'application/json', text: '{"quantity":12}'}});
  await assert.rejects(review(f, candidate), /input.*type|type.*input/i);
});

test('review refuses changing an observed safe route literal despite matching segment count', async t => {
  const definition = operation('read-items', {request: {method: 'GET', path: '/records', query: {search: {$input: 'search'}}}});
  const f = await setup(t, {definition}), candidate = f.capture();
  await assert.rejects(review(f, candidate), /route.*literal|literal.*route/i);
});

async function nextValidation(f, definition) {
  const runId = randomUUID(), roots = {...f.roots, runRoot: join(f.roots.projectRoot, runId)};
  const run = createRun({id: runId, environment: f.environment, operations: [definition],
    values: f.run.inputs.values.map(value => ({...value, producer: {...value.producer, runId}})),
    scenarios: [{id: 'case', expectations: definition.definition.checks.map(check => ({id: check.id, description: 'Synthetic API expectation', operationId: definition.id, invocationId: `${definition.id}-call`, requiredEvidence: ['response', 'assertion', 'observation']}))}]});
  const runtime = createApiRuntime(run, roots);
  return {...f, run, roots, runtime, definition, call: (op, patch) => runtime.execute({operation: op, invocationId: `${op.id}-call`, ...patch})};
}

test('equivalent reviewed requests deduplicate while query variants and conflicting contracts remain distinct', async t => {
  const firstOperation = operation('read-items', {request: {method: 'GET', path: '/items', query: {view: 'summary'}}});
  const f = await setup(t, {definition: firstOperation}), url = f.environment.targets.api['fixture-api'].baseUrl;
  const first = await review(f, f.capture({url: `${url}/items?view=summary`}));
  const sameOperation = operation('read-items-again', {source: {kind: 'helper', reference: 'another-source', version: '2'}, request: {method: 'GET', path: '/items', query: {view: 'summary'}}});
  const equivalent = await review(await nextValidation(f, sameOperation), f.capture({url: `${url}/items?view=summary`}, 2));
  const [later, earlier] = [first, equivalent].sort((left, right) => left.id.localeCompare(right.id));
  const initial = await promoteObservedCollection(f.roots, {application: 'orders', reviewedIds: [earlier.id]});
  const initialItem = JSON.parse(readFileSync(initial.path, 'utf8')).item[0];
  await promoteObservedCollection(f.roots, {application: 'orders', reviewedIds: [later.id]});
  let collection = JSON.parse(readFileSync(initial.path, 'utf8')); assert.equal(collection.item.length, 1);
  assert.equal(collection.item[0].name, initialItem.name, 'Later equivalent evidence must not rename a stable request.');
  assert.deepEqual(collection.item[0].request, initialItem.request, 'Later equivalent evidence must preserve the selected representative.');
  assert.deepEqual(collection.item[0]['x-harness-observed'].provenance.map(item => item.reviewedId), [earlier.id, later.id]);
  assert.equal(collection.item[0]['x-harness-observed'].provenance.length, 2);
  const detailedOperation = operation('read-item-details', {request: {method: 'GET', path: '/items', query: {view: 'details'}}});
  const detailed = await review(await nextValidation(f, detailedOperation), f.capture({url: `${url}/items?view=details`}, 3));
  await promoteObservedCollection(f.roots, {application: 'orders', reviewedIds: [detailed.id]});
  collection = JSON.parse(readFileSync(initial.path, 'utf8')); assert.equal(collection.item.length, 2);
  assert.deepEqual(collection.item.map(item => item.request.url.query[0].value).sort(), ['details', 'summary']);
  const conflictingOperation = operation('read-items', {request: {method: 'GET', path: '/items', query: {view: 'other'}}});
  const conflicting = await review(await nextValidation(f, conflictingOperation), f.capture({url: `${url}/items?view=other`}, 4));
  const before = readFileSync(initial.path, 'utf8');
  await assert.rejects(promoteObservedCollection(f.roots, {application: 'orders', reviewedIds: [conflicting.id]}), /conflict/i);
  assert.equal(readFileSync(initial.path, 'utf8'), before);
});

test('unknown, truncated, omitted, unsupported and meaningful variants remain distinct', async t => {
  const f = await setup(t);
  const states = ['unknown', 'truncated', 'omitted', 'unsupported'];
  for (const state of states) {
    const candidate = f.capture({responseBody: {state}}, states.indexOf(state) + 1);
    assert.equal(readApiCandidate(f.roots, candidate.id).observation.response.body.state, state);
  }
  const first = f.capture({}, 10), second = f.capture({url: `${f.environment.targets.api['fixture-api'].baseUrl}/items?search=another-input`}, 11);
  assert.notEqual(first.id, second.id); assert.equal(listApiCandidates(f.roots).length, 6);
  assert.throws(() => sanitizeApiObservation(raw(f.environment.targets.api['fixture-api'].baseUrl), {run: f.captureRun, identity: f.identity, browserTarget: 'app', sequence: 101}), /limit/i);
  const links = [{fromSequence: 1, fromPath: ['id'], toPath: ['body', 'orderId']}, {fromSequence: 1, fromPath: ['id'], toPath: ['path', 1]}];
  const chained = sanitizeApiObservation(raw(f.environment.targets.api['fixture-api'].baseUrl), {run: f.captureRun, identity: f.identity, browserTarget: 'app', sequence: 2, relationships: links});
  assert.deepEqual(chained.relationships, links);
});

test('reviewed API reuse needs real configured validation; promotion is incremental and preserves team exports', async t => {
  const f = await setup(t);
  const folder = join(f.roots.projectRoot, 'resources/apisCollections'); mkdirSync(folder, {recursive: true});
  const supplied = JSON.stringify({info: {name: 'Team item API', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'},
    item: [{name: 'Read item summary', request: {method: 'GET', header: [], url: {raw: '{{baseUrl}}/items?view=summary', host: ['{{baseUrl}}'], path: ['items'], query: [{key: 'view', value: 'summary'}]}}}], variable: [{key: 'baseUrl', value: ''}]}, null, 2) + '\n';
  const suppliedPath = join(folder, 'team.postman_collection.json'); writeFileSync(suppliedPath, supplied);
  const source = '{"action":"Read the item summary, then look up the selected item by search.","expected":"Both lookups succeed."}\n';
  const sourcePath = join(f.roots.projectRoot, 'selected-source.json'); writeFileSync(sourcePath, source);
  const suppliedRequest = JSON.parse(readFileSync(suppliedPath, 'utf8')).item.find(item => item.name === 'Read item summary').request;
  const suppliedOperation = operation('read-supplied-summary', {source: {kind: 'catalog', reference: 'team-item-api', version: '1'},
    request: {method: suppliedRequest.method, path: '/' + suppliedRequest.url.path.join('/'), query: Object.fromEntries(suppliedRequest.url.query.map(({key, value}) => [key, value]))}});
  const suppliedExecution = await nextValidation(f, suppliedOperation); await suppliedExecution.call(suppliedOperation, {});
  assert.equal(suppliedExecution.runtime.finish().status, 'PASS'); assert.equal(suppliedOperation.source.kind, 'catalog');
  assert.equal(f.requests.at(-1).path, '/items?view=summary');
  const candidate = f.capture(); assert.throws(() => readReviewedApi(f.roots, candidate.id));
  const reviewed = await review(f, candidate); assert.equal(readReviewedApi(f.roots, reviewed.id).operation.fingerprint, f.definition.fingerprint);
  assert.equal(f.requests.at(-1).path, '/items?search=synthetic');
  const exported = await promoteObservedCollection(f.roots, {application: 'orders', reviewedIds: [reviewed.id]});
  const original = readFileSync(exported.path, 'utf8'), collection = JSON.parse(original);
  assert.equal(collection.info.schema, 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'); assert.equal(collection.item.length, 1);
  assert(collection.item[0].request.url.raw.includes('{{fixture-apiBaseUrl}}/items')); assert(collection.item[0].request.url.raw.includes('{{search}}'));
  assert(!original.includes(privateValue)); assert(!original.includes('synthetic-validation')); assert(!original.includes('127.0.0.1'));
  assert(!original.includes('"event"')); await promoteObservedCollection(f.roots, {application: 'orders', reviewedIds: [reviewed.id]});
  assert.equal(readFileSync(exported.path, 'utf8'), original); assert.equal(readFileSync(join(folder, 'team.postman_collection.json'), 'utf8'), supplied);
  assert.equal(readFileSync(sourcePath, 'utf8'), source); assert.equal(collection['x-harness-observed'].suppliedCollectionsPresent, true);
  collection.item[0].name = 'User changed'; writeFileSync(exported.path, JSON.stringify(collection));
  await assert.rejects(promoteObservedCollection(f.roots, {application: 'orders', reviewedIds: [reviewed.id]}), /changed|integrity|drift/i);
});

test('tampered candidate, review and unowned collection files cannot become reusable knowledge', async t => {
  const f = await setup(t), candidate = f.capture(), reviewed = await review(f, candidate);
  const folder = join(f.roots.projectRoot, 'resources/apisCollections'); mkdirSync(folder, {recursive: true});
  const supplied = '{"info":{"name":"team supplied"},"item":[]}'; writeFileSync(join(folder, 'orders-observed.postman_collection.json'), supplied);
  await assert.rejects(promoteObservedCollection(f.roots, {application: 'orders', reviewedIds: [reviewed.id]}), /owned|origin/i);
  assert.equal(readFileSync(join(folder, 'orders-observed.postman_collection.json'), 'utf8'), supplied);
  writeFileSync(join(f.roots.projectRoot, 'review.md'), 'Changed independent review.'); assert.throws(() => readReviewedApi(f.roots, reviewed.id), /review|changed/i);
  const persisted = JSON.parse(readFileSync(candidate.path, 'utf8')); persisted.observation.sequence = 20; writeFileSync(candidate.path, JSON.stringify(persisted));
  assert.throws(() => readApiCandidate(f.roots, candidate.id), /integrity|changed/i);
});

test('unreadable requests, unknown targets and unresolved observed authentication block reuse', async t => {
  for (const patch of [{requestBody: {state: 'unknown'}}, {requestHeaders: [{name: 'cookie', value: 'session=private'}]}]) {
    const f = await setup(t), candidate = f.capture(patch); await assert.rejects(review(f, candidate), /body|authentication/i);
  }
  const differentMethod = await setup(t), candidate = differentMethod.capture({method: 'POST'});
  await assert.rejects(review(differentMethod, candidate), /target\/method/i);
});

test('capture evidence and reviewed route/body contracts remain immutable', async t => {
  const f = await setup(t), candidate = f.capture({requestBody: {state: 'known', contentType: 'application/json', text: '{"name":"private"}'}});
  await assert.rejects(review(f, candidate), /body structure/i);
  const clean = await setup(t), cleanCandidate = clean.capture(), reviewed = await review(clean, cleanCandidate);
  writeFileSync(join(clean.captureRoots.runRoot, cleanCandidate.evidence.path), '{}');
  assert.throws(() => readReviewedApi(clean.roots, reviewed.id), /capture evidence integrity/i);
});

test('collection promotion refuses concurrent writers without touching the prior collection', async t => {
  const f = await setup(t), candidate = f.capture(), reviewed = await review(f, candidate);
  const first = await promoteObservedCollection(f.roots, {application: 'orders', reviewedIds: [reviewed.id]}); const before = readFileSync(first.path, 'utf8');
  writeFileSync(first.path + '.lock', 'existing writer');
  await assert.rejects(promoteObservedCollection(f.roots, {application: 'orders', reviewedIds: [reviewed.id]})); assert.equal(readFileSync(first.path, 'utf8'), before);
});
