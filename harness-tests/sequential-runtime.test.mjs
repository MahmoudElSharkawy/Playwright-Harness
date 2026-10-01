import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as pause} from 'node:timers/promises';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fixture} from './fixtures/sequential.mjs';
import {operation as api, statusCheck} from './fixtures/api.mjs';
import {operation as db, check} from './fixtures/database.mjs';
import {createApiRuntime} from '../scripts/lib/api/index.mjs';
import {createDatabaseRuntime} from '../scripts/lib/database/index.mjs';
import {createScenarioState, initializeStorage} from '../scripts/lib/sequential/state.mjs';
import {runSequentialScenario} from '../scripts/lib/sequential/index.mjs';
import {createRun, attemptRecord} from '../scripts/lib/execution-core/index.mjs';

const read = (id, extra = {}) => api(id, {checks: [statusCheck(`${id}-ok`, 200)], ...extra});
const step = (operation, phase) => ({operation, phase});
const call = (ctx, operation, extra = {}) => ctx.api.execute({operation, invocationId: operation.id, ...extra});

test('fixed phases share one record and preserve API output-to-input provenance', async t => {
  const seed = read('seed', {extract: [{name: 'value', type: 'number', sensitivity: 'public', select: {from: 'json', path: ['value']}}]});
  const verify = read('verify', {request: {method: 'GET', path: '/items', query: {id: {$input: 'id'}}}});
  const f = await fixture(t, [step(seed, 'SETUP'), step(verify, 'VERIFY')]); let created;
  const result = await f.start({setup: async ctx => {created = await call(ctx, seed);}, verify: async ctx => {await call(ctx, verify, {inputs: [ctx.output(created, 'value', 'id')]}); ctx.selectOutput(created, 'value');}});
  assert.equal(result.status, 'PASS'); assert.equal(result.scenarios[0].outputs[0].value, 1);
  assert.equal(result.scenarios[0].attempts[1].inputs[0].producer.attemptId, created.identity.attemptId); assert.equal(f.requests[1].path, '/items?id=1');
});

test('partial setup stops later phases, records missing checks and still runs required cleanup', async t => {
  const seed = read('seed'), fail = read('fail'), exercise = read('exercise'), clean = read('clean'); let exercised = false;
  const f = await fixture(t, [step(seed, 'SETUP'), step(fail, 'SETUP'), step(exercise, 'EXERCISE'), step(clean, 'CLEANUP')], {handler: ({request, reply}) => reply(request.path === '/fail' ? 503 : 200)});
  const failing = api('fail', {path: '/fail', checks: fail.definition.checks});
  // Freeze the actual failing definition in a separate consumer run.
  const run = createRun({...{id: f.run.id, environment: f.run.inputs.environment, scenarios: f.run.inputs.scenarios}, operations: [seed, failing, exercise, clean]});
  const result = await runSequentialScenario(run, f.roots, {}, {setup: async ctx => {await call(ctx, seed); await call(ctx, failing);}, exercise: async () => {exercised = true;}, cleanup: async ctx => {await call(ctx, clean);}});
  assert.equal(result.status, 'FAIL'); assert.equal(exercised, false); assert.equal(f.requests.length, 3);
  assert.equal(result.scenarios[0].attempts.find(item => item.identity.operationId === 'exercise').effect.certainty, 'not-executed');
});

test('a configured database policy refusal blocks downstream API without resolving credentials', async t => {
  const select = db('select'), exercise = read('exercise'); let credentials = 0, exercised = false;
  const f = await fixture(t, [step(select, 'SETUP'), step(exercise, 'EXERCISE')], {capabilities: {dbSelect: false}});
  const result = await f.start({setup: async ctx => {await ctx.database.execute({operation: select, invocationId: select.id});}, exercise: async () => {exercised = true;}}, {database: {resolveCredential: () => {credentials++; throw new Error();}}});
  assert.equal(result.status, 'BLOCKED'); assert.equal(credentials, 0); assert.equal(exercised, false); assert.equal(f.requests.length, 0);
});

test('cross-family concurrency is refused before a database connection starts', async t => {
  const request = read('request'), select = db('select'); let release, entered;
  const waiting = new Promise(resolve => {entered = resolve;});
  const f = await fixture(t, [step(request, 'EXERCISE'), step(select, 'EXERCISE')], {handler: async ({reply}) => {entered(); await new Promise(resolve => {release = resolve;}); reply(200);}});
  const state = createScenarioState(f.run, f.roots); initializeStorage(state);
  const a = createApiRuntime(f.run, f.roots, {execution: state}), d = createDatabaseRuntime(f.run, f.roots, {execution: state});
  const pending = a.execute({operation: request, invocationId: request.id}); await waiting;
  await assert.rejects(d.execute({operation: select, invocationId: select.id}), /sequential/); assert.throws(() => a.finish(), /standalone/);
  release(); await pending;
});

test('callback errors preserve honest missing scope and still invoke cleanup', async t => {
  const exercise = read('exercise'), clean = read('clean');
  const f = await fixture(t, [step(exercise, 'EXERCISE'), step(clean, 'CLEANUP')]);
  const result = await f.start({exercise: () => {throw new Error('Synthetic callback failure');}, cleanup: ctx => call(ctx, clean)});
  assert.equal(result.status, 'NEEDS_REVIEW'); assert.equal(f.requests.length, 1); assert.equal(result.scenarios[0].counts.notEvaluated, 1);
});

test('phase deadline ends a stalled callback and expired handles cannot dispatch', async t => {
  const exercise = read('exercise'), clean = read('clean'); let expired;
  const f = await fixture(t, [step(exercise, 'EXERCISE'), step(clean, 'CLEANUP')], {limits: {timeoutMs: 120, cleanupTimeoutMs: 2000}});
  const result = await f.start({exercise: ctx => {expired = ctx; return new Promise(() => {});}, cleanup: ctx => call(ctx, clean)});
  assert.equal(result.status, 'NEEDS_REVIEW'); assert.equal(f.requests.length, 1); assert.throws(() => expired.api.execute({operation: exercise, invocationId: exercise.id}), /ended/);
});

test('external cancellation interrupts stalled callbacks but leaves cleanup usable', async t => {
  const exercise = read('exercise'), clean = read('clean'), controller = new AbortController();
  const f = await fixture(t, [step(exercise, 'EXERCISE'), step(clean, 'CLEANUP')]);
  const result = await f.start({exercise: () => {setTimeout(() => controller.abort(), 40); return new Promise(() => {});}, cleanup: ctx => call(ctx, clean)}, {signal: controller.signal});
  assert.equal(result.status, 'NEEDS_REVIEW'); assert.equal(f.requests.length, 1); assert.equal(result.scenarios[0].attempts[0].failureClass, 'CANCELLED');
});

test('unawaited work is drained and prevents a clean pass', async t => {
  const exercise = read('exercise'); const f = await fixture(t, [step(exercise, 'EXERCISE')], {handler: async ({reply}) => {await pause(40); reply(200);}});
  const result = await f.start({exercise: ctx => {void call(ctx, exercise);}});
  assert.equal(result.status, 'NEEDS_REVIEW'); assert.equal(result.scenarios[0].attempts.length, 1);
});

test('cleanup/restoration share one finite budget across API and database', async t => {
  const observe = read('observe'), clean = read('clean'), restore = db('restore', {checks: [check('restore-ok')]});
  const f = await fixture(t, [step(observe, 'VERIFY'), step(clean, 'CLEANUP'), step(restore, 'RESTORE')], {limits: {cleanupTimeoutMs: 80}, handler: async ({request, reply}) => {if (request.path === '/items') await pause(45); reply(200);}});
  const result = await f.start({verify: ctx => call(ctx, observe), cleanup: async ctx => {await call(ctx, clean); await pause(65); await ctx.database.execute({operation: restore, invocationId: restore.id, phase: 'RESTORE'});}});
  const last = result.scenarios[0].attempts.at(-1); assert.equal(last.failureClass, 'TIMEOUT'); assert.equal(last.effect.certainty, 'not-executed'); assert.notEqual(result.status, 'PASS');
});

test('known exploratory definitions need no catalog and retain run-local provenance', async t => {
  const operation = read('explore', {kind: 'exploration'}), f = await fixture(t, [step(operation, 'EXERCISE')]);
  const result = await f.start({exercise: ctx => call(ctx, operation)});
  assert.equal(result.status, 'PASS'); assert.equal(f.run.inputs.operations.length, 0); assert.equal(result.operations[0].source.kind, 'exploration');
});

test('missing callback results are BLOCKED rather than an empty pass', async t => {
  const operation = read('observe'), f = await fixture(t, [step(operation, 'VERIFY')]); const result = await f.start({});
  assert.equal(result.status, 'BLOCKED'); assert.equal(result.scenarios[0].counts.notEvaluated, 1); assert.equal(f.requests.length, 0);
});

test('a frozen phase cannot be changed at dispatch or in result records', async t => {
  const operation = read('observe'), f = await fixture(t, [step(operation, 'VERIFY')]);
  const result = await f.start({exercise: ctx => call(ctx, operation)});
  assert.equal(result.status, 'NEEDS_REVIEW'); assert.equal(f.requests.length, 0);
  const stored = JSON.parse(readFileSync(join(f.roots.runRoot, 'observations.json'), 'utf8')).scenarios[0].attempts[0];
  assert.throws(() => attemptRecord(f.run, {...stored, identity: {...stored.identity, phase: 'EXERCISE'}}), /phase/);
});

test('an assertion-free mutation cannot take the identity of a required read', async t => {
  const observe = read('observe'), change = api('change', {method: 'POST', checks: []});
  const f = await fixture(t, [step(observe, 'EXERCISE'), step(change, 'EXERCISE')]);
  const result = await f.start({exercise: ctx => ctx.api.execute({operation: change, invocationId: observe.id})});
  assert.equal(result.status, 'NEEDS_REVIEW'); assert.equal(f.requests.length, 0);
  assert.equal(result.scenarios[0].attempts[0].identity.operationId, observe.id);
});
