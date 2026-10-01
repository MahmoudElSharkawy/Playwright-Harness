// Fixed M16 acceptance cases using native browser/API/database runtimes.
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {randomInt} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {defineOperation} from '../../scripts/lib/execution-core/index.mjs';
import {defineDatabaseOperation} from '../../scripts/lib/database/index.mjs';
import {runScenarioBatch} from '../../scripts/lib/parallel/index.mjs';
import {writeReports} from '../../scripts/lib/reporting/index.mjs';
import {parallelFixture, step, call} from './parallel.mjs';
import {operation as api, statusCheck} from './api.mjs';
import {param, check, output} from './database.mjs';

const options = operation => ({operation, invocationId: operation.id});
const identity = ctx => ctx.resource('row').outputs.find(value => value.name === 'recordId');
const resource = intent => ({id: 'row', output: 'recordId', ownership: intent === 'restore' ? 'existing' : 'harness', intent});
const recordSymbol = invocationId => ({name: 'record', slots: [{scenarioId: 'case', name: 'recordId'}, {scenarioId: 'case', invocationId, number: 1, name: 'recordId'}]});

export async function executeParallelCases(projectRoot, databases, concurrency, signal) {
  const items = new Map(), jobs = [], metadata = new Map(), base = randomInt(100000, 1000000000);
  let browserArrivals = 0, browserOverlap = false, survivorAfterClose = false;
  const f = await parallelFixture(undefined, {projectRoot, targets: databases.targets, handler: async ({request, reply, res}) => {
    if (request.path === '/ui') {res.writeHead(200, {'content-type': 'text/html'}); res.end('<!doctype html><title>Bounded execution</title><h1>Independent session</h1>'); return;}
    const recordId = Number(request.path.split('/')[2]), item = items.get(recordId);
    if (request.method === 'POST') {const value = {...request.body, version: 1}; items.set(value.id, value); reply(201, value); return;}
    if (!item) {reply(404); return;}
    if (request.method === 'PATCH') {
      if (request.headers['if-match'] && request.headers['if-match'] !== `"${item.version}"`) {reply(412); return;}
      item.label = request.body.label; item.version++; reply(200, item); return;
    }
    if (request.method === 'DELETE') {
      if (item.failCleanup) {reply(503); return;} items.delete(recordId); reply(204); return;
    }
    reply(200, item);
  }});
  const limits = {timeoutMs: 600000, cleanupTimeoutMs: 60000};
  function add(id, settings, facts) {
    const job = f.job(id, {limits, resources: [{key: id, access: 'write'}], ...settings}); jobs.push(job); metadata.set(id, facts); return job;
  }
  async function until(predicate) {
    const deadline = Date.now() + 90000;
    while (!predicate()) {assert(Date.now() < deadline, 'Parallel native rendezvous timed out.'); await pause(50);}
  }
  try {
    for (const id of ['browser-first', 'browser-survivor']) {
      const observe = defineOperation({id: 'observe', family: 'browser', target: 'ui', capability: 'browserMutations', source: {kind: 'helper', reference: 'bounded-native-observation', version: '1'}, definition: {intent: 'Keep synthetic local state isolated in this owned session'}});
      add(id, {browser: true, values: {marker: id}, steps: [step(observe, 'EXERCISE', [{id: 'isolated-marker'}])], callbacks: {exercise: ctx => ctx.browser.attempt(options(observe), async browser => {
        await browser.native(['goto', `${f.origin}/ui`]);
        const marker = ctx.value('marker').value;
        await browser.native(['run-code', `async page => {await page.evaluate(value => localStorage.setItem('marker', value), ${JSON.stringify(marker)});}`]);
        if (concurrency > 1) {
          browserArrivals++; await until(() => browserArrivals === 2); browserOverlap = true;
          if (id === 'browser-survivor') {
            const first = jobs[0];
            await until(() => readdirSync(join(projectRoot, '.harness/runs')).some(batchId => existsSync(join(projectRoot, '.harness/runs', batchId, first.run.id, 'result.json'))));
            survivorAfterClose = true;
          }
        }
        const actual = JSON.parse((await browser.native(['run-code', 'async page => await page.evaluate(() => localStorage.getItem("marker"))'])).result);
        await browser.native(['snapshot', '--filename=page.yml']);
        const snapshot = await browser.artifact('snapshot', 'page.yml', bytes => Buffer.from(bytes.toString().replaceAll(f.origin, 'http://fixture.test')));
        await browser.native(['screenshot', '--filename=page.png']);
        const screenshot = await browser.artifact('screenshot', 'page.png', bytes => bytes);
        const evidence = await browser.evidence('observation', {actual, expected: marker});
        browser.assertion({id: 'isolated-marker', status: actual === marker ? 'PASS' : 'FAIL', reliable: true, evidenceIds: [snapshot, screenshot, evidence]});
        browser.effect({certainty: 'confirmed', resourceIds: []});
      })}}, {status: 'PASS', symbols: [{name: 'owned-session', slots: [{scenarioId: 'case', invocationId: 'browser-session-setup', number: 1, name: 'sessionIdentity'}]}]});
    }
    for (const disposition of ['temporary', 'persistent', 'no-obligation', 'restore', 'restore-conflict', 'cleanup-failure', 'assertion-failure']) {
      const id = `api-${disposition}`, recordId = base + jobs.length;
      const restoring = disposition.startsWith('restore'), intent = restoring ? 'restore' : ['persistent', 'no-obligation'].includes(disposition) ? disposition : 'temporary';
      if (restoring) items.set(recordId, {id: recordId, label: 'initial', version: 1});
      const seed = api('create', {kind: 'exploration', method: 'POST', request: {method: 'POST', path: '/items', json: {id: {$input: 'recordId'}, label: {$input: 'initial'}, failCleanup: disposition === 'cleanup-failure'}},
        checks: [statusCheck('created', 201)], extract: [{name: 'recordId', type: 'number', sensitivity: 'public', select: {from: 'json', path: ['id']}}]});
      const change = api('change', {kind: 'helper', method: 'PATCH', request: {method: 'PATCH', path: '/items/{recordId}', json: {label: {$input: 'label'}}},
        checks: [statusCheck('changed', 200)], extract: [{name: 'recordId', type: 'number', sensitivity: 'public', select: {from: 'json', path: ['id']}}]});
      const observe = api('verify', {request: {method: 'GET', path: '/items/{recordId}'}, checks: [{id: 'label', select: {from: 'json', path: ['label']}, equals: disposition === 'assertion-failure' ? 'wrong' : 'updated'}],
        extract: [{name: 'label', type: 'string', sensitivity: 'public', select: {from: 'json', path: ['label']}}]});
      const cleanup = api('cleanup', {kind: 'catalog', method: 'DELETE', request: {method: 'DELETE', path: '/items/{recordId}'}, checks: [], effects: {confirmedStatuses: [204], noEffectStatuses: [503], contractRef: 'bounded-fixture-delete'}});
      const restore = api('restore', {kind: 'inline', method: 'PATCH', request: {method: 'PATCH', path: '/items/{recordId}', headers: {'if-match': '"2"'}, json: {label: {$input: 'initial'}}}, checks: [], effects: {confirmedStatuses: [200], noEffectStatuses: [412], contractRef: 'bounded-fixture-restore'}});
      add(id, {values: {recordId, initial: 'initial', label: 'updated'},
        steps: [...(restoring ? [] : [step(seed, 'SETUP')]), step(change), step(observe, 'VERIFY'), ...(intent === 'temporary' ? [step(cleanup, 'CLEANUP')] : restoring ? [step(restore, 'RESTORE')] : [])],
        callbacks: {
          ...(!restoring ? {setup: ctx => call(ctx, seed, {inputs: [ctx.value('recordId'), ctx.value('initial')], resource: resource(intent)})} : {}),
          exercise: ctx => call(ctx, change, {inputs: [restoring ? ctx.value('recordId') : identity(ctx), ctx.value('label')], ...(restoring ? {resource: resource(intent)} : {})}),
          verify: async ctx => {const attempt = await call(ctx, observe, {inputs: [identity(ctx)]}); ctx.selectOutput(attempt, 'label'); if (disposition === 'restore-conflict') {items.get(recordId).label = 'concurrent'; items.get(recordId).version++;}},
          ...(intent === 'temporary' ? {cleanup: ctx => call(ctx, cleanup, {inputs: [identity(ctx)], lifecycle: {resourceId: 'row'}})}
            : restoring ? {cleanup: ctx => call(ctx, restore, {phase: 'RESTORE', inputs: [identity(ctx), ctx.value('initial')], lifecycle: {resourceId: 'row', guard: 'version'}})} : {})
        }}, {status: disposition === 'assertion-failure' ? 'FAIL' : ['restore-conflict', 'cleanup-failure'].includes(disposition) ? 'NEEDS_REVIEW' : 'PASS',
        finalLabel: disposition === 'restore-conflict' ? 'concurrent' : restoring ? 'initial' : intent === 'temporary' && disposition !== 'cleanup-failure' ? null : 'updated', recordId,
        symbols: [{name: 'record', slots: [...recordSymbol(restoring ? 'change' : 'create').slots, ...(!restoring ? [{scenarioId: 'case', invocationId: 'change', number: 1, name: 'recordId'}] : [])]}]});
    }
    for (const engine of ['sqlserver', 'postgresql']) for (const intent of ['temporary', 'persistent']) {
      const id = `${engine}-${intent}`, recordId = base + jobs.length, pg = engine === 'postgresql';
      const query = (id, kind, definition) => defineDatabaseOperation({id, target: engine, source: {kind, reference: 'bounded-fixture-dml', version: '1'}, engine, ...definition});
      const number = name => param(name, pg ? 'integer' : 'int'), string = name => param(name, pg ? 'text' : 'nvarchar', {length: 500});
      const seed = query('seed', 'exploration', {sql: pg ? 'INSERT INTO m11."Items" ("Id","Label") VALUES ($1,$2) RETURNING "Id"' : 'INSERT INTO m11.Items (Id,Label) OUTPUT INSERTED.Id VALUES (@recordId,@initial)',
        parameters: [number('recordId'), string('initial')], affectedRows: {min: 1, max: 1}, checks: [check('seeded', 'affectedRows')], extract: [output()]});
      const change = query('change', 'helper', {sql: pg ? 'UPDATE m11."Items" SET "Label"=$1 WHERE "Id"=$2' : 'UPDATE m11.Items SET Label=@label WHERE Id=@recordId',
        parameters: [string('label'), number('recordId')], affectedRows: {min: 1, max: 1}, checks: [check('changed', 'affectedRows')]});
      const observe = query('verify', 'inline', {sql: pg ? 'SELECT "Label" FROM m11."Items" WHERE "Id"=$1' : 'SELECT Label FROM m11.Items WHERE Id=@recordId',
        parameters: [number('recordId')], checks: [check('label', 'rows', 'updated', [0, 'Label'])], extract: [output('label', 'string', 'Label')]});
      const cleanup = query('cleanup', 'catalog', {sql: pg ? 'DELETE FROM m11."Items" WHERE "Id"=$1' : 'DELETE FROM m11.Items WHERE Id=@recordId',
        parameters: [number('recordId')], affectedRows: {min: 1, max: 1}, checks: [check('removed', 'affectedRows')]});
      add(id, {values: {recordId, initial: 'initial', label: 'updated'}, steps: [step(seed, 'SETUP'), step(change), step(observe, 'VERIFY'), ...(intent === 'temporary' ? [step(cleanup, 'CLEANUP')] : [])],
        options: {explorations: [seed], database: {resolveCredential: ({reference}) => JSON.parse(databases.environment[reference.slice(4)])}}, callbacks: {
          setup: ctx => ctx.database.execute({...options(seed), inputs: [ctx.value('recordId'), ctx.value('initial')], resource: resource(intent)}),
          exercise: ctx => ctx.database.execute({...options(change), inputs: [ctx.value('label'), identity(ctx)]}),
          verify: async ctx => {const attempt = await ctx.database.execute({...options(observe), inputs: [identity(ctx)]}); ctx.selectOutput(attempt, 'label');},
          ...(intent === 'temporary' ? {cleanup: ctx => ctx.database.execute({...options(cleanup), inputs: [identity(ctx)], lifecycle: {resourceId: 'row'}})} : {})
        }}, {status: 'PASS', recordId, engine, intent, symbols: [recordSymbol('seed')]});
    }
    // Same row represented by different scenario sources is a conflict before I/O.
    const requestsBefore = f.requests.length;
    await assert.rejects(runScenarioBatch(f.roots, jobs.slice(2, 4).map(job => ({...job, resources: [{key: 'same-business-row', access: 'write'}]})), {concurrency: 2}), /conflicting/);
    assert.equal(f.requests.length, requestsBefore);
    const batch = await runScenarioBatch(f.roots, jobs, {concurrency, ...(signal ? {signal} : {})});
    assert.equal(batch.completion, 'COMPLETE'); assert.equal(batch.entries.length, 13);
    const cases = [], sessions = [];
    for (const entry of batch.entries) {
      const expected = metadata.get(entry.id); assert.equal(entry.dispatch, 'EXECUTED', entry.id); assert.equal(entry.result.status, expected.status, entry.id);
      if (Object.hasOwn(expected, 'finalLabel')) assert.equal(items.get(expected.recordId)?.label ?? null, expected.finalLabel, entry.id);
      assert(!existsSync(join(entry.roots.runRoot, 'protected')), 'Owned authentication/process material must be removed.');
      if (entry.id.startsWith('browser-')) {
        const setup = entry.result.scenarios[0].attempts.find(attempt => attempt.identity.invocationId === 'browser-session-setup');
        sessions.push(setup.outputs.find(output => output.name === 'sessionIdentity').value);
        assert(entry.result.scenarios[0].resources.every(resource => resource.lifecycle.status === 'completed'));
      }
      const receipt = writeReports(f.roots, entry.result); assert.equal(receipt.status, 'WRITTEN'); assert.equal(receipt.runId, entry.run.id);
      cases.push({id: entry.id, run: entry.run, roots: entry.roots, result: entry.result, observations: JSON.parse(readFileSync(join(entry.roots.runRoot, 'observations.json'), 'utf8')), symbols: expected.symbols});
    }
    assert.equal(new Set(sessions).size, 2); if (concurrency > 1) {assert(browserOverlap); assert(survivorAfterClose);}
    return {batch, cases, facts: {cases: cases.length, reports: cases.length, browserSessions: sessions.length, browserOverlap, survivorAfterClose, conflictRejected: true,
      databases: [...metadata.values()].filter(facts => facts.engine).map(({recordId, engine, intent}) => ({recordId, engine, intent}))}};
  } finally {await f.close();}
}
