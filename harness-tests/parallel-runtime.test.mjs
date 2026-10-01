import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as pause} from 'node:timers/promises';
import {existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {runScenarioBatch} from '../scripts/lib/parallel/index.mjs';
import {requireAssessedResult, assessRun, createRun} from '../scripts/lib/execution-core/index.mjs';
import {writeReports} from '../scripts/lib/reporting/index.mjs';
import {parallelFixture, read, step, call} from './fixtures/parallel.mjs';
import {operation, statusCheck} from './fixtures/api.mjs';

const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};};
const locked = f => existsSync(join(f.roots.projectRoot, '.harness/state/parallel/active.lock'));

test('default is sequential, including cleanup; results keep complete assessed histories', async t => {
  let active = 0, peak = 0; const order = [];
  const f = await parallelFixture(t, {handler: async ({request, reply}) => {active++; peak = Math.max(peak, active); order.push(request.path); await pause(10); reply(200); active--;}});
  const jobs = ['one', 'two', 'three'].map(id => {
    const exercise = read(`${id}-exercise`), clean = read(`${id}-cleanup`);
    return f.job(id, {resources: [], steps: [step(exercise), step(clean, 'CLEANUP')], callbacks: {exercise: ctx => call(ctx, exercise), cleanup: ctx => call(ctx, clean)}});
  });
  const batch = await runScenarioBatch(f.roots, jobs);
  assert.equal(batch.concurrency, 1); assert.equal(peak, 1); assert.equal(batch.completion, 'COMPLETE');
  assert.deepEqual(order, ['/one-exercise', '/one-cleanup', '/two-exercise', '/two-cleanup', '/three-exercise', '/three-cleanup']);
  for (const entry of batch.entries) {requireAssessedResult(entry.result); assert.equal(entry.result.status, 'PASS'); assert.equal(entry.result.scenarios[0].attempts.length, 2);}
  assert(!locked(f));
});

test('bounded overlap preserves input order, verdicts, outputs, evidence and report association', async t => {
  let active = 0, peak = 0; const finished = [];
  const f = await parallelFixture(t, {handler: async ({request, reply}) => {active++; peak = Math.max(peak, active); await pause(request.path === '/slow' ? 160 : 15); reply(200, {label: request.path}); finished.push(request.path); active--;}});
  const jobs = ['slow', 'fast', 'third', 'fourth', 'fifth'].map(id => {
    const observe = read(id, {extract: [{name: 'label', type: 'string', sensitivity: 'public', select: {from: 'json', path: ['label']}}]});
    return f.job(id, {steps: [step(observe)], callbacks: {exercise: async ctx => {const attempt = await call(ctx, observe); ctx.selectOutput(attempt, 'label');}}});
  });
  const batch = await runScenarioBatch(f.roots, jobs, {concurrency: 2});
  assert.equal(peak, 2); assert.equal(finished[0], '/fast'); assert.deepEqual(batch.entries.map(entry => entry.id), jobs.map(job => job.id));
  const paths = new Set(), attempts = new Set();
  for (const entry of batch.entries) {
    assert.equal(entry.result.status, 'PASS'); assert.equal(entry.result.runId, entry.run.id); assert.equal(entry.result.scenarios[0].outputs[0].value, `/${entry.id}`);
    assert(!paths.has(entry.roots.runRoot)); paths.add(entry.roots.runRoot);
    const observations = JSON.parse(readFileSync(join(entry.roots.runRoot, 'observations.json'), 'utf8'));
    assert.deepEqual(assessRun(entry.run, entry.roots, observations), entry.result);
    for (const attempt of entry.result.scenarios[0].attempts) {assert(!attempts.has(attempt.identity.attemptId)); attempts.add(attempt.identity.attemptId); assert.equal(attempt.identity.runId, entry.run.id);}
    const receipt = writeReports(f.roots, entry.result); assert.equal(receipt.status, 'WRITTEN'); assert.equal(receipt.runId, entry.run.id);
  }
  const manifest = JSON.parse(readFileSync(join(batch.batchRoot, 'batch.json'), 'utf8'));
  assert.deepEqual(manifest.entries.map(entry => entry.runId), jobs.map(job => job.run.id));
});

for (const accesses of [['read', 'write'], ['write', 'read'], ['write', 'write']]) test(`shared ${accesses.join('/')} conflict rejects the entire batch before dispatch`, async t => {
  const f = await parallelFixture(t), jobs = accesses.map((access, index) => f.job(`job-${index}`, {resources: [{key: 'same-business-row', access}]}));
  await assert.rejects(runScenarioBatch(f.roots, jobs, {concurrency: 2}), /conflicting/); assert.equal(f.requests.length, 0); assert(!existsSync(join(f.roots.projectRoot, '.harness')));
});

test('shared read/read is allowed; sequential callers may intentionally share writes', async t => {
  const f = await parallelFixture(t);
  const shared = access => ['one', 'two'].map(id => f.job(id, {resources: [{key: 'shared', access}]}));
  assert((await runScenarioBatch(f.roots, shared('read'), {concurrency: 2})).entries.every(entry => entry.result.status === 'PASS'));
  assert((await runScenarioBatch(f.roots, shared('write'))).entries.every(entry => entry.result.status === 'PASS'));
});

for (const [name, change, pattern] of [
  ['empty scope', () => [], /1 to 500/],
  ['duplicate job', jobs => [jobs[0], {...jobs[1], id: jobs[0].id.toUpperCase()}], /Duplicate batch job/],
  ['duplicate run', jobs => [jobs[0], {...jobs[1], run: jobs[0].run}], /Duplicate batch run/],
  ['unbranded run', jobs => [jobs[0], {...jobs[1], run: JSON.parse(JSON.stringify(jobs[1].run))}], /immutable run/],
  ['missing access', jobs => [jobs[0], {...jobs[1], resources: []}], /explicit shared/],
  ['ambiguous access key', jobs => [jobs[0], {...jobs[1], resources: [{key: 'Shared', access: 'read'}]}], /lowercase/],
  ['invalid callback', jobs => [jobs[0], {...jobs[1], callbacks: {exercise: false}}], /functions/],
  ['invalid resolver', jobs => [jobs[0], {...jobs[1], options: {api: {resolveCredential: false}}}], /resolvers/],
  ['unknown option', jobs => [jobs[0], {...jobs[1], options: {unknown: true}}], /unknown/i],
  ['individual cancellation', jobs => [jobs[0], {...jobs[1], options: {signal: new AbortController().signal}}], /batch cancellation/]
]) test(`preflight rejects ${name} before earlier valid jobs execute`, async t => {
  const f = await parallelFixture(t); await assert.rejects(runScenarioBatch(f.roots, change([f.job('one'), f.job('two')]), {concurrency: 2}), pattern);
  assert.equal(f.requests.length, 0); assert(!locked(f));
});

test('finite concurrency and independent consumer storage are required', async t => {
  const f = await parallelFixture(t);
  for (const concurrency of [0, -1, 1.5, 9, Infinity, '2']) await assert.rejects(runScenarioBatch(f.roots, [f.job('one')], {concurrency}), /Concurrency/);
  await assert.rejects(runScenarioBatch({projectRoot: f.roots.packageRoot, packageRoot: f.roots.packageRoot}, [f.job('one')]), /consumer/);
  assert.equal(f.requests.length, 0);
});

test('predeclared mutations require write access regardless of source', async t => {
  const f = await parallelFixture(t);
  for (const kind of ['catalog', 'helper', 'inline', 'exploration']) {
    const write = operation('change', {method: 'POST', kind}), job = f.job('one', {steps: [step(write)], callbacks: {exercise: ctx => call(ctx, write)}});
    await assert.rejects(runScenarioBatch(f.roots, [job], {concurrency: 2}), /write access/);
  }
  assert.equal(f.requests.length, 0);
});

test('later dynamic mutation cannot bypass a read-only declaration', async t => {
  const f = await parallelFixture(t), observe = read('observe'), write = operation('late-write', {kind: 'exploration', method: 'POST', checks: []});
  const job = f.job('one', {steps: [step(observe)], callbacks: {exercise: async ctx => {await call(ctx, observe); await call(ctx, write);}}});
  const batch = await runScenarioBatch(f.roots, [job], {concurrency: 2});
  assert.equal(batch.entries[0].result.status, 'NEEDS_REVIEW'); assert.deepEqual(f.requests.map(request => request.method), ['GET']);
});

test('queued callback/options/access mappings are captured before callers change them', async t => {
  const reached = deferred(), release = deferred(); let substituted = false;
  const f = await parallelFixture(t, {handler: async ({request, reply}) => {if (request.path === '/hold') {reached.resolve(); await release.promise;} reply(200);}});
  const hold = read('hold'), first = f.job('first', {steps: [step(hold)], callbacks: {exercise: ctx => call(ctx, hold)}}), second = f.job('second');
  const pending = runScenarioBatch(f.roots, [first, second]); await reached.promise;
  second.callbacks.exercise = () => {substituted = true;}; second.options.api = {resolveCredential: false}; second.resources[0].key = 'changed';
  release.resolve(); const batch = await pending; assert.equal(substituted, false); assert.equal(batch.entries[1].result.status, 'PASS');
  assert.equal(JSON.parse(readFileSync(join(batch.batchRoot, 'batch.json'), 'utf8')).entries[1].resources[0].key, 'second');
});

test('cancellation drains active cleanup and records queued cases as unstarted BLOCKED', async t => {
  const controller = new AbortController(), reached = deferred(), release = deferred(); let queued = 0;
  const f = await parallelFixture(t, {handler: async ({request, reply}) => {if (request.path === '/cleanup') {reached.resolve(); await release.promise;} reply(200);}});
  const observe = read('observe'), clean = read('cleanup');
  const first = f.job('first', {steps: [step(observe), step(clean, 'CLEANUP')], callbacks: {exercise: async ctx => {await call(ctx, observe); controller.abort();}, cleanup: ctx => call(ctx, clean)}});
  const second = f.job('second', {callbacks: {exercise: () => {queued++;}}});
  const pending = runScenarioBatch(f.roots, [first, second], {signal: controller.signal}); await reached.promise;
  assert(locked(f)); assert.equal(queued, 0); release.resolve(); const batch = await pending;
  assert.equal(batch.entries[0].result.scenarios[0].attempts.at(-1).identity.phase, 'CLEANUP');
  assert.equal(batch.entries[0].result.scenarios[0].attempts.at(-1).outcome, 'SUCCESS');
  assert.equal(batch.entries[1].dispatch, 'NOT_STARTED'); assert.equal(batch.entries[1].result.status, 'BLOCKED');
  assert.equal(batch.entries[1].result.scenarios[0].reason, 'CANCELLED'); assert.equal(batch.entries[1].result.scenarios[0].attempts.length, 0); assert(!locked(f));
});

test('a pre-cancelled batch never acquires executor resources', async t => {
  const f = await parallelFixture(t), controller = new AbortController(); controller.abort();
  const batch = await runScenarioBatch(f.roots, [f.job('one'), f.job('two')], {concurrency: 2, signal: controller.signal});
  assert.equal(f.requests.length, 0); assert(batch.entries.every(entry => entry.dispatch === 'NOT_STARTED' && entry.result.status === 'BLOCKED'));
});

test('queued time counts toward the immutable deadline instead of restarting it', async t => {
  const f = await parallelFixture(t, {handler: async ({reply}) => {await pause(140); reply(200);}});
  const expired = f.job('expired', {limits: {timeoutMs: 80}}), batch = await runScenarioBatch(f.roots, [f.job('first'), expired]);
  assert.equal(batch.entries[0].result.status, 'PASS'); assert.equal(batch.entries[1].dispatch, 'NOT_STARTED'); assert.equal(batch.entries[1].result.scenarios[0].reason, 'DEADLINE_EXCEEDED'); assert.equal(f.requests.length, 1);
});

test('independent assertion failures are retained while other scenarios finish', async t => {
  const f = await parallelFixture(t), fail = read('fail', {checks: [statusCheck('wrong-status', 201)]});
  const batch = await runScenarioBatch(f.roots, [f.job('bad', {steps: [step(fail)], callbacks: {exercise: ctx => call(ctx, fail)}}), f.job('good')], {concurrency: 2});
  assert.equal(batch.completion, 'COMPLETE'); assert.deepEqual(batch.entries.map(entry => entry.result.status), ['FAIL', 'PASS']);
  assert.equal(batch.entries[0].result.scenarios[0].attempts.length, 1);
});

test('another batch cannot bypass the bound, even during cleanup; the lock then releases', async t => {
  const reached = deferred(), release = deferred(), f = await parallelFixture(t);
  const first = f.job('first', {callbacks: {exercise: ctx => call(ctx, read('observe')), cleanup: async () => {reached.resolve(); await release.promise;}}});
  const pending = runScenarioBatch(f.roots, [first]); await reached.promise;
  await assert.rejects(runScenarioBatch(f.roots, [f.job('second')]), /EEXIST/); assert.equal(f.requests.length, 1);
  release.resolve(); await pending; assert(!locked(f)); assert.equal((await runScenarioBatch(f.roots, [f.job('third')])).entries[0].result.status, 'PASS');
});

test('incomplete execution never invents a verdict and other active work is drained', async t => {
  const reached = deferred(), release = deferred(), f = await parallelFixture(t);
  const corrupt = f.job('corrupt'); corrupt.callbacks.exercise = async ctx => {
    await call(ctx, read('observe'));
    const batchId = readdirSync(join(f.roots.projectRoot, '.harness/runs'))[0];
    writeFileSync(join(f.roots.projectRoot, '.harness/runs', batchId, corrupt.run.id, 'result.json'), '{}', {flag: 'wx'});
  };
  const slow = f.job('slow', {callbacks: {exercise: ctx => call(ctx, read('observe')), cleanup: async () => {reached.resolve(); await release.promise;}}});
  const pending = runScenarioBatch(f.roots, [corrupt, slow], {concurrency: 2}); await reached.promise;
  await assert.rejects(runScenarioBatch(f.roots, [f.job('extra')]), /EEXIST/);
  release.resolve(); const batch = await pending;
  assert.equal(batch.completion, 'INCOMPLETE'); assert.equal(batch.entries[0].dispatch, 'ERROR'); assert.equal(batch.entries[0].result, undefined);
  assert.equal(batch.entries[1].result.status, 'PASS'); assert(existsSync(join(batch.entries[0].roots.runRoot, 'observations.json'))); assert(!locked(f));
  const manifest = JSON.parse(readFileSync(join(batch.batchRoot, 'batch.json'), 'utf8')); assert.equal(manifest.entries[0].resultPath, undefined);
});

test('cross-scenario output substitution cannot contaminate another result', async t => {
  const produced = deferred(), f = await parallelFixture(t);
  const observe = read('observe', {extract: [{name: 'label', type: 'string', sensitivity: 'public', select: {from: 'json', path: ['label']}}]});
  const consume = read('consume', {request: {method: 'GET', path: '/consume', query: {value: {$input: 'label'}}}});
  const one = f.job('one', {steps: [step(observe)], callbacks: {exercise: async ctx => {const attempt = await call(ctx, observe); produced.resolve(ctx.output(attempt, 'label'));}}});
  const two = f.job('two', {steps: [step(consume)], callbacks: {exercise: async ctx => {await call(ctx, consume, {inputs: [await produced.promise]});}}});
  const batch = await runScenarioBatch(f.roots, [one, two], {concurrency: 2});
  assert.equal(batch.entries[0].result.status, 'PASS'); assert.notEqual(batch.entries[1].result?.status, 'PASS'); assert.equal(f.requests.length, 1);
});

test('all jobs require valid frozen phase scope before dispatch', async t => {
  const f = await parallelFixture(t), valid = f.job('valid'), second = f.job('second');
  const scenario = structuredClone(second.run.inputs.scenarios[0]); delete scenario.expectations[0].phase;
  second.run = createRun({id: second.run.id, environment: second.run.inputs.environment, operations: second.run.inputs.operations, scenarios: [scenario]});
  await assert.rejects(runScenarioBatch(f.roots, [valid, second]), /frozen phases/); assert.equal(f.requests.length, 0);
});

test('cancelling two active mutations completes both owned obligations without starting queued jobs', async t => {
  const controller = new AbortController(), created = new Set(); let arrivals = 0;
  const f = await parallelFixture(t, {handler: ({request, reply}) => {
    if (request.method === 'POST') {created.add(request.body.id); reply(201, {id: request.body.id});}
    else {created.delete(Number(request.path.split('/')[2])); reply(204);}
  }});
  const seed = operation('seed', {method: 'POST', request: {method: 'POST', path: '/items', json: {id: {$input: 'recordId'}}}, checks: [statusCheck('created', 201)],
    extract: [{name: 'recordId', type: 'number', sensitivity: 'public', select: {from: 'json', path: ['id']}}]});
  const cleanup = operation('cleanup', {method: 'DELETE', request: {method: 'DELETE', path: '/items/{recordId}'}, checks: [statusCheck('removed', 204)]});
  const jobs = [1, 2, 3, 4].map(recordId => f.job(`job-${recordId}`, {values: {recordId}, resources: [{key: `row-${recordId}`, access: 'write'}], steps: [step(seed, 'SETUP'), step(cleanup, 'CLEANUP')], callbacks: {
    setup: async ctx => {await call(ctx, seed, {inputs: [ctx.value('recordId')], resource: {id: 'row', output: 'recordId', ownership: 'harness', intent: 'temporary'}}); if (++arrivals === 2) controller.abort(); else await new Promise(() => {});},
    cleanup: ctx => call(ctx, cleanup, {inputs: [ctx.resource('row').outputs[0]], lifecycle: {resourceId: 'row'}})
  }}));
  const batch = await runScenarioBatch(f.roots, jobs, {concurrency: 2, signal: controller.signal});
  assert.equal(batch.completion, 'COMPLETE'); assert.equal(created.size, 0); assert.equal(f.requests.length, 4);
  assert(batch.entries.slice(0, 2).every(entry => entry.result.scenarios[0].resources[0].lifecycle.status === 'completed'));
  assert(batch.entries.slice(2).every(entry => entry.dispatch === 'NOT_STARTED' && entry.result.scenarios[0].attempts.length === 0));
});

test('a stale consumer lock is preserved and never taken over automatically', async t => {
  const f = await parallelFixture(t), directory = join(f.roots.projectRoot, '.harness/state/parallel'); mkdirSync(directory, {recursive: true});
  const file = join(directory, 'active.lock'); writeFileSync(file, 'existing-owner', {flag: 'wx'});
  await assert.rejects(runScenarioBatch(f.roots, [f.job('one')]), /EEXIST/); assert.equal(readFileSync(file, 'utf8'), 'existing-owner'); assert.equal(f.requests.length, 0);
});

test('a separate consumer has independent batch ownership', async t => {
  const reached = deferred(), release = deferred(), left = await parallelFixture(t), right = await parallelFixture(t);
  const first = left.job('one', {callbacks: {exercise: async ctx => {reached.resolve(); await release.promise; await call(ctx, read('observe'));}}});
  const pending = runScenarioBatch(left.roots, [first]); await reached.promise;
  assert.equal((await runScenarioBatch(right.roots, [right.job('two')])).entries[0].result.status, 'PASS');
  assert(locked(left)); release.resolve(); await pending; assert(!locked(left));
});
