// Fixed M11 scenarios, not a scenario language. Both hosts run these same callbacks.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdirSync, readFileSync, writeFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {randomInt, randomUUID} from 'node:crypto';
import sql from 'mssql';
import {createRun, defineOperation} from '../../scripts/lib/execution-core/index.mjs';
import {browserLifecycleOperations} from '../../scripts/lib/browser/index.mjs';
import {runSequentialScenario} from '../../scripts/lib/sequential/index.mjs';
import {packageRoot} from '../../scripts/lib/consumer-paths.mjs';
import {operation as api, statusCheck} from './api.mjs';
import {operation as db, param, output, check} from './database.mjs';

export const hostCaseIds = Object.freeze(['api-temporary', 'api-persistent', 'api-no-obligation', 'api-restore', 'api-restore-conflict',
  'assertion-failure', 'cleanup-failure', 'partial-setup', 'safe-read-recovery', 'uncertain-mutation', 'reconciled-mutation', 'lost-required-response',
  'protected-mutation', 'unselected-target', 'sqlserver-crud', 'postgresql-crud', 'browser-observation', 'browser-assertion-failure', 'mixed-lifecycle']);
const step = (operation, phase, checks = operation.definition.checks ?? []) => ({operation, phase, checks});
const opts = operation => ({operation, invocationId: operation.id});
const identity = ctx => ctx.resource('row')?.outputs.find(v => v.name === 'recordId');
const resource = intent => ({id: 'row', output: 'recordId', ownership: intent === 'restore' ? 'existing' : 'harness', intent});
const recordSymbol = outputs => ({name: 'fixture-record', slots: [{scenarioId: 'case', name: 'recordId'}, ...outputs.map(invocationId => ({scenarioId: 'case', invocationId, number: 1, name: 'recordId'}))]});
const create = () => api('create', {method: 'POST', kind: 'exploration', request: {method: 'POST', path: '/items', json: {id: {$input: 'recordId'}, label: {$input: 'initial'}}},
  checks: [statusCheck('created', 201)], extract: [{name: 'recordId', type: 'number', sensitivity: 'public', select: {from: 'json', path: ['id']}}]});
const verify = (expected = 'updated') => api('verify', {kind: 'helper', request: {method: 'GET', path: '/items/{recordId}'},
  checks: [{id: 'label', select: {from: 'json', path: ['label']}, equals: expected}], extract: [{name: 'label', type: 'string', sensitivity: 'public', select: {from: 'json', path: ['label']}}]});
const change = (extra = {}) => api('change', {method: 'PATCH', request: {method: 'PATCH', path: '/items/{recordId}', json: {label: {$input: 'label'}}}, checks: [statusCheck('changed', 200)], ...extra});
const clean = () => api('clean', {method: 'DELETE', kind: 'catalog', request: {method: 'DELETE', path: '/items/{recordId}'}, checks: [],
  effects: {confirmedStatuses: [204], noEffectStatuses: [503], contractRef: 'fixture-delete'}});

/** Retain validated records and evidence in the consumer, including failing scenarios. */
export async function executeHostCases(projectRoot, targets = {}, {only} = {}) {
  const cases = [], selected = only ?? hostCaseIds;
  assert(selected.length && selected.every(id => hostCaseIds.includes(id)) && new Set(selected).size === selected.length);
  async function execute(id, steps, callbacks, settings = {}) {
    if (!selected.includes(id)) return;
    let requests = 0, writes = 0, item;
    const recordId = randomInt(100000, 2000000000);
    let application, server;
    try {
    if (settings.mixed) {
      const target = targets.sqlserver; assert(target, 'Mixed proof needs SQL Server.');
      application = new sql.ConnectionPool({server: target.server, port: target.port, database: target.database, ...JSON.parse(process.env[target.connectionRef.slice(4)]),
        options: {encrypt: target.encrypt, trustServerCertificate: target.trustServerCertificate}, connectionTimeout: 5000, requestTimeout: 10000});
      await application.connect();
    }
    if (settings.existing) item = {id: recordId, label: 'initial', version: 1};
    server = createServer(async (req, res) => {
      try {
        requests++; const chunks = []; for await (const chunk of req) chunks.push(chunk);
        let body; try {body = JSON.parse(Buffer.concat(chunks).toString());} catch { /* Optional fixture body. */ }
        const reply = (status, value = {}) => {res.writeHead(status, {'content-type': 'application/json'}); res.end(JSON.stringify(value));};
        if (req.url === '/ui') {res.writeHead(200, {'content-type': 'text/html'}); res.end('<!doctype html><title>Host parity fixture</title><h1>Ready</h1>' + (settings.mixed
          ? '<label>Record<input id="record"></label><label>Label<input id="label"></label><button id="save">Save</button><div id="status"></div><script>document.querySelector("#save").onclick=async()=>{const id=document.querySelector("#record").value;const r=await fetch("/items/"+id,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({label:document.querySelector("#label").value})});document.querySelector("#status").textContent=r.ok?"saved":"failed";};</script>' : '')); return;}
        if (application) {
          const request = application.request().input('id', sql.Int, Number(req.url.split('/')[2]));
          if (req.method === 'PATCH') {await request.input('label', sql.NVarChar(500), body.label).query('UPDATE m11.Items SET Label=@label WHERE Id=@id'); writes++; reply(200);}
          else {const row = (await request.query('SELECT Id,Label FROM m11.Items WHERE Id=@id')).recordset[0]; reply(row ? 200 : 404, row ? {id: row.Id, label: row.Label} : {});}
          return;
        }
        if (req.url === '/fail') {reply(503); return;}
        if (req.method === 'POST') {item = {id: body.id, label: body.label, version: 1}; writes++; reply(201, item); return;}
        if (req.method === 'PATCH') {
          if (req.headers['if-match'] && req.headers['if-match'] !== `"${item.version}"`) {reply(412); return;}
          item.label = body.label; item.version++; writes++;
          if (settings.dropMutation) {req.socket.destroy(); return;} reply(200, item); return;
        }
        if (req.method === 'DELETE') {
          if (settings.failCleanup) {reply(503); return;} item = undefined; writes++; reply(204); return;
        }
        if (settings.dropRead && requests === 1) {req.socket.destroy(); return;}
        reply(200, item ?? {label: 'updated'});
      } catch {res.writeHead(500); res.end();}
    });
    await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
    const origin = `http://127.0.0.1:${server.address().port}`, roots = {packageRoot, projectRoot, runRoot: join(projectRoot, '.harness', 'runs', id)};
    const definitions = [...new Map(steps.map(s => [s.operation.id, s.operation])).values()], runId = randomUUID();
    const run = createRun({id: runId, environment: {name: 'qa', environmentMode: settings.mode ?? 'test', capabilities: settings.capabilities ?? {},
      apiTargets: settings.disabledTarget ? [] : ['fixture-api'], databaseTargets: settings.engine ? ['db'] : [], browserTargets: settings.browser ? ['ui'] : [],
      targets: {api: {'fixture-api': {baseUrl: origin}}, databases: settings.engine ? {db: targets[settings.engine]} : {}, browser: {ui: {origins: [origin]}}}},
      values: [['recordId', recordId], ['initial', 'initial'], ['label', 'updated']].map(([name, value]) => ({name, value, type: typeof value, sensitivity: 'public', producer: {runId, scenarioId: 'case', name}})),
      operations: [...definitions.filter(o => o.source.kind !== 'exploration'), ...(settings.browser ? browserLifecycleOperations('ui') : [])],
      scenarios: [{id: 'case', expectations: steps.flatMap(s => s.checks.map(c => ({id: c.id, description: `Host parity ${id}: ${c.id}`, operationId: s.operation.id, invocationId: s.operation.id, phase: s.phase,
        requiredEvidence: s.operation.family === 'browser' ? ['observation', 'snapshot'] : ['response', 'assertion']})))}],
      limits: {timeoutMs: settings.browser ? 120000 : 30000, cleanupTimeoutMs: settings.browser ? 60000 : 10000}});
      const f = {origin, mutate: () => {item.label = 'concurrent'; item.version++;}, state: () => ({requests, writes, label: item?.label ?? null})};
      const result = await runSequentialScenario(run, roots, {explorations: definitions.filter(o => o.source.kind === 'exploration'), ...(settings.browser ? {browser: {target: 'ui'}} : {}), ...settings.runtime}, callbacks(f));
      assert.equal(result.status, settings.status ?? 'PASS', id); assert.equal(result.stability, settings.stability ?? (result.status === 'NEEDS_REVIEW' ? 'unstable' : 'stable'), id);
      if (settings.finalLabel !== undefined) assert.equal(item?.label ?? null, settings.finalLabel, id);
      if (settings.writes !== undefined) assert.equal(writes, settings.writes, id);
      if (settings.requests !== undefined) assert.equal(requests, settings.requests, id);
      if (application) assert.equal((await application.request().input('id', sql.Int, recordId).query('SELECT Id FROM m11.Items WHERE Id=@id')).recordset.length, 0, 'Mixed owned fixture removed');
      assert(!existsSync(join(roots.runRoot, 'protected')), 'Owned browser runtime material must be removed.');
      const symbols = [recordSymbol(settings.symbolOutputs ?? [])];
      if (settings.browser) symbols.push({name: 'owned-browser-session', slots: [{scenarioId: 'case', invocationId: 'browser-session-setup', number: 1, name: 'sessionIdentity'}]});
      writeFileSync(join(roots.runRoot, 'run.json'), JSON.stringify(run, null, 2), {flag: 'wx'});
      cases.push({id, run, observations: JSON.parse(readFileSync(join(roots.runRoot, 'observations.json'), 'utf8')), result, roots, symbols});
    } finally {server?.closeAllConnections(); if (server?.listening) await new Promise(resolve => server.close(resolve)); await application?.close();}
  }

  for (const intent of ['temporary', 'persistent', 'no-obligation']) {
    const seed = create(), update = change(), read = verify(), cleanup = clean();
    await execute(`api-${intent}`, [step(seed, 'SETUP'), step(update, 'EXERCISE'), step(read, 'VERIFY'), ...(intent === 'temporary' ? [step(cleanup, 'CLEANUP')] : [])], () => ({
      setup: ctx => ctx.api.execute({...opts(seed), inputs: [ctx.value('recordId'), ctx.value('initial')], resource: resource(intent)}),
      exercise: ctx => ctx.api.execute({...opts(update), inputs: [identity(ctx), ctx.value('label')]}),
      verify: async ctx => {const a = await ctx.api.execute({...opts(read), inputs: [identity(ctx)]}); ctx.selectOutput(a, 'label');},
      ...(intent === 'temporary' ? {cleanup: ctx => ctx.api.execute({...opts(cleanup), inputs: [identity(ctx)], lifecycle: {resourceId: 'row'}})} : {})
    }), {symbolOutputs: ['create'], finalLabel: intent === 'temporary' ? null : 'updated', writes: intent === 'temporary' ? 3 : 2});
  }
  for (const conflict of [false, true]) {
    const update = change({extract: [{name: 'recordId', type: 'number', sensitivity: 'public', select: {from: 'json', path: ['id']}}]}), read = verify();
    const restore = api('restore', {method: 'PATCH', request: {method: 'PATCH', path: '/items/{recordId}', headers: {'if-match': '"2"'}, json: {label: {$input: 'initial'}}},
      checks: [], effects: {confirmedStatuses: [200], noEffectStatuses: [412], contractRef: 'fixture-restore'}});
    await execute(conflict ? 'api-restore-conflict' : 'api-restore', [step(update, 'EXERCISE'), step(read, 'VERIFY'), step(restore, 'RESTORE')], f => ({
      exercise: ctx => ctx.api.execute({...opts(update), inputs: [ctx.value('recordId'), ctx.value('label')], resource: resource('restore')}),
      verify: async ctx => {await ctx.api.execute({...opts(read), inputs: [identity(ctx)]}); if (conflict) f.mutate();},
      cleanup: ctx => ctx.api.execute({...opts(restore), phase: 'RESTORE', inputs: [identity(ctx), ctx.value('initial')], lifecycle: {resourceId: 'row', guard: 'version'}})
    }), {existing: true, symbolOutputs: ['change'], status: conflict ? 'NEEDS_REVIEW' : 'PASS', finalLabel: conflict ? 'concurrent' : 'initial'});
  }
  for (const id of ['assertion-failure', 'cleanup-failure', 'partial-setup']) {
    const seed = create(), read = verify(id === 'assertion-failure' ? 'wrong' : 'initial'), cleanup = clean(), fail = api('fail', {path: '/fail', checks: [statusCheck('setup-ready', 200)]});
    await execute(id, [step(seed, 'SETUP'), ...(id === 'partial-setup' ? [step(fail, 'SETUP')] : []), step(read, 'VERIFY'), step(cleanup, 'CLEANUP')], () => ({
      setup: async ctx => {await ctx.api.execute({...opts(seed), inputs: [ctx.value('recordId'), ctx.value('initial')], resource: resource('temporary')}); if (id === 'partial-setup') await ctx.api.execute(opts(fail));},
      verify: ctx => ctx.api.execute({...opts(read), inputs: [identity(ctx)]}),
      cleanup: ctx => ctx.api.execute({...opts(cleanup), inputs: [identity(ctx)], lifecycle: {resourceId: 'row'}})
    }), {symbolOutputs: ['create'], status: id === 'cleanup-failure' ? 'NEEDS_REVIEW' : 'FAIL', failCleanup: id === 'cleanup-failure', finalLabel: id === 'cleanup-failure' ? 'initial' : null});
  }
  const retryRead = verify();
  await execute('safe-read-recovery', [step(retryRead, 'VERIFY')], () => ({verify: async ctx => {const a = await ctx.api.execute({...opts(retryRead), inputs: [ctx.value('recordId')]}); ctx.selectOutput(a, 'label');}}), {dropRead: true, stability: 'recovered', requests: 2});
  for (const id of ['uncertain-mutation', 'reconciled-mutation', 'lost-required-response']) {
    const seed = create(), cleanup = clean(), read = verify();
    const update = change({checks: id === 'lost-required-response' ? [statusCheck('changed', 200)] : [], ...(id !== 'uncertain-mutation' ? {recovery: {reconcile: {request: {method: 'GET', path: '/items/{recordId}'}, readOnlyContract: 'fixture-read', status: 200, select: {from: 'json', path: ['label']}, equals: {$input: 'label'}, whenEqual: 'confirmed-effect'}}} : {})});
    await execute(id, [step(seed, 'SETUP'), step(update, 'EXERCISE'), step(read, 'VERIFY'), step(cleanup, 'CLEANUP')], () => ({
      setup: ctx => ctx.api.execute({...opts(seed), inputs: [ctx.value('recordId'), ctx.value('initial')], resource: resource('temporary')}),
      exercise: ctx => ctx.api.execute({...opts(update), inputs: [identity(ctx), ctx.value('label')]}),
      verify: ctx => ctx.api.execute({...opts(read), inputs: [identity(ctx)]}),
      cleanup: ctx => ctx.api.execute({...opts(cleanup), inputs: [identity(ctx)], lifecycle: {resourceId: 'row'}})
    }), {symbolOutputs: ['create'], dropMutation: true, writes: 3, finalLabel: null,
      status: id === 'uncertain-mutation' ? 'NEEDS_REVIEW' : id === 'lost-required-response' ? 'BLOCKED' : 'PASS', stability: id === 'reconciled-mutation' ? 'recovered' : 'unstable'});
  }
  for (const id of ['protected-mutation', 'unselected-target']) {
    const seed = create(); await execute(id, [step(seed, 'SETUP')], () => ({setup: ctx => ctx.api.execute({...opts(seed), inputs: [ctx.value('recordId'), ctx.value('initial')]})}),
      {mode: id === 'protected-mutation' ? 'protected' : 'test', disabledTarget: id === 'unselected-target', status: 'BLOCKED', requests: 0, writes: 0});
  }
  for (const engine of ['sqlserver', 'postgresql']) {
    if (!selected.includes(`${engine}-crud`)) continue;
    assert(targets[engine], 'Native database target required.'); const pg = engine === 'postgresql';
    const query = (id, definition) => db(id, {engine, ...definition, parameters: definition.parameters?.map(p => ({...p, type: pg ? p.type === 'int' ? 'integer' : 'text' : p.type}))});
    const seed = query('seed', {kind: 'exploration', sql: pg ? 'INSERT INTO m11."Items" ("Id","Label") VALUES ($1,$2) RETURNING "Id"' : 'INSERT INTO m11.Items (Id,Label) OUTPUT INSERTED.Id VALUES (@recordId,@initial)',
      parameters: [param('recordId'), param('initial', pg ? 'varchar' : 'nvarchar', {length: 500})], affectedRows: {min: 1, max: 1}, checks: [check('seeded', 'affectedRows')], extract: [output()]});
    const update = query('update', {kind: 'helper', sql: pg ? 'UPDATE m11."Items" SET "Label"=$1 WHERE "Id"=$2' : 'UPDATE m11.Items SET Label=@label WHERE Id=@recordId',
      parameters: [param('label', pg ? 'varchar' : 'nvarchar', {length: 500}), param('recordId')], affectedRows: {min: 1, max: 1}, checks: [check('updated', 'affectedRows')]});
    const read = query('read', {kind: 'inline', sql: pg ? 'SELECT "Label" FROM m11."Items" WHERE "Id"=$1' : 'SELECT Label FROM m11.Items WHERE Id=@recordId', parameters: [param('recordId')],
      checks: [check('read-label', 'rows', 'updated', [0, 'Label'])], extract: [output('label', 'string', 'Label')]});
    const cleanup = query('cleanup', {kind: 'catalog', sql: pg ? 'DELETE FROM m11."Items" WHERE "Id"=$1' : 'DELETE FROM m11.Items WHERE Id=@recordId', parameters: [param('recordId')], affectedRows: {min: 1, max: 1}, checks: [check('removed', 'affectedRows')]});
    await execute(`${engine}-crud`, [step(seed, 'SETUP'), step(update, 'EXERCISE'), step(read, 'VERIFY'), step(cleanup, 'CLEANUP')], () => ({
      setup: ctx => ctx.database.execute({...opts(seed), inputs: [ctx.value('recordId'), ctx.value('initial')], resource: resource('temporary')}),
      exercise: ctx => ctx.database.execute({...opts(update), inputs: [ctx.value('label'), identity(ctx)]}),
      verify: async ctx => {const a = await ctx.database.execute({...opts(read), inputs: [identity(ctx)]}); ctx.selectOutput(a, 'label');},
      cleanup: ctx => ctx.database.execute({...opts(cleanup), inputs: [identity(ctx)], lifecycle: {resourceId: 'row'}})
    }), {engine, symbolOutputs: ['seed']});
  }
  for (const failing of [false, true]) {
    const id = failing ? 'browser-assertion-failure' : 'browser-observation';
    const operation = defineOperation({id: 'observe', family: 'browser', target: 'ui', capability: 'browserReads', source: {kind: 'helper', reference: 'host-ui-observation', version: '1'}, definition: {intent: 'Observe the synthetic heading', expected: failing ? 'Different' : 'Ready'}});
    await execute(id, [step(operation, 'VERIFY', [{id: 'heading'}])], f => ({verify: ctx => ctx.browser.attempt(opts(operation), async browser => {
      await browser.native(['goto', `${f.origin}/ui`]); await browser.native(['snapshot', '--filename=page.yml']);
      const snapshot = await browser.artifact('snapshot', 'page.yml', bytes => Buffer.from(bytes.toString().replaceAll(f.origin, 'http://fixture.test')));
      const actual = JSON.parse((await browser.native(['run-code', 'async page => await page.locator("h1").textContent()'])).result);
      const observation = await browser.evidence('observation', {actual, expected: operation.definition.expected});
      browser.assertion({id: 'heading', status: actual === operation.definition.expected ? 'PASS' : 'FAIL', reliable: true, evidenceIds: [snapshot, observation]});
    })}), {browser: true, status: failing ? 'FAIL' : 'PASS'});
  }
  if (selected.includes('mixed-lifecycle')) {
    const seed = db('mixed-seed', {sql: 'INSERT INTO m11.Items (Id,Label) OUTPUT INSERTED.Id VALUES (@recordId,@initial)', parameters: [param('recordId'), param('initial', 'nvarchar', {length: 500})],
      checks: [check('mixed-seeded', 'affectedRows')], affectedRows: {min: 1, max: 1}, extract: [output()]});
    const cleanup = db('mixed-clean', {sql: 'DELETE FROM m11.Items WHERE Id=@recordId', parameters: [param('recordId')], checks: [check('mixed-removed', 'affectedRows')], affectedRows: {min: 1, max: 1}});
    const read = verify(), ui = defineOperation({id: 'ui-edit', family: 'browser', target: 'ui', capability: 'browserMutations', source: {kind: 'helper', reference: 'mixed-ui-fixture', version: '1'}, definition: {intent: 'Change the SQL fixture through its UI'}});
    await execute('mixed-lifecycle', [step(seed, 'SETUP'), step(ui, 'EXERCISE', [{id: 'ui-saved'}]), step(read, 'VERIFY'), step(cleanup, 'CLEANUP')], f => ({
      setup: ctx => ctx.database.execute({...opts(seed), inputs: [ctx.value('recordId'), ctx.value('initial')], resource: resource('temporary')}),
      exercise: ctx => ctx.browser.attempt({...opts(ui), inputs: [identity(ctx), ctx.value('label')]}, async browser => {
        await browser.native(['goto', `${f.origin}/ui`]); await browser.native(['snapshot', '--filename=page.yml']);
        const snapshot = await browser.artifact('snapshot', 'page.yml', bytes => Buffer.from(bytes.toString().replaceAll(f.origin, 'http://fixture.test')));
        await browser.native(['run-code', `async page => {await page.getByLabel('Record', {exact:true}).fill(${JSON.stringify(String(identity(ctx).value))}); await page.getByLabel('Label', {exact:true}).fill(${JSON.stringify(ctx.value('label').value)}); await page.getByRole('button', {name:'Save', exact:true}).click();}`]);
        const actual = JSON.parse((await browser.native(['run-code', 'async page => {await page.locator("#status").filter({hasText:"saved"}).waitFor(); return await page.locator("#status").textContent();}'])).result);
        const observed = await browser.evidence('observation', {actual, expected: 'saved'});
        browser.assertion({id: 'ui-saved', status: actual === 'saved' ? 'PASS' : 'FAIL', reliable: true, evidenceIds: [snapshot, observed]}); browser.effect({certainty: 'confirmed', resourceIds: ['row']});
      }),
      verify: async ctx => {const a = await ctx.api.execute({...opts(read), inputs: [identity(ctx)]}); ctx.selectOutput(a, 'label');},
      cleanup: ctx => ctx.database.execute({...opts(cleanup), inputs: [identity(ctx)], lifecycle: {resourceId: 'row'}})
    }), {browser: true, engine: 'sqlserver', mixed: true, symbolOutputs: ['mixed-seed'], writes: 1});
  }
  assert.deepEqual(cases.map(c => c.id), [...selected]);
  mkdirSync(join(projectRoot, '.harness'), {recursive: true});
  writeFileSync(join(projectRoot, '.harness', 'execution-cases.json'), JSON.stringify(cases, null, 2), {flag: 'wx'});
  return cases;
}
