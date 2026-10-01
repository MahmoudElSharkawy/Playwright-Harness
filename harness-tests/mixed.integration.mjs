import test, {before, after, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import sql from 'mssql';
import {fixture} from './fixtures/sequential.mjs';
import {operation as api, statusCheck} from './fixtures/api.mjs';
import {operation as db, param, output, check} from './fixtures/database.mjs';
import {defineOperation} from '../scripts/lib/execution-core/index.mjs';
import './mixed-browser.integration.mjs';

const target = JSON.parse(process.env.HARNESS_M8_TARGET ?? 'null');
assert(target, 'Run the mixed real-instance suite through probe:mixed.');
let admin, application;
before(async () => {
  admin = await new sql.ConnectionPool(JSON.parse(process.env.HARNESS_M8_ADMIN)).connect();
  application = await new sql.ConnectionPool({server: target.server, port: target.port, database: target.database, ...JSON.parse(process.env.M8_DB_CREDENTIAL), options: {encrypt: target.encrypt, trustServerCertificate: target.trustServerCertificate}}).connect();
});
after(async () => {await application?.close(); await admin?.close();});
beforeEach(async () => {await admin.request().query('DELETE FROM m8.Items');});
const rows = async () => (await admin.request().query('SELECT Id,Label,Revision FROM m8.Items ORDER BY Id')).recordset;
const step = (operation, phase, checks) => ({operation, phase, ...(checks ? {checks} : {})});
const options = operation => ({operation, invocationId: operation.id});
const idInput = ctx => ctx.value('recordId');
const insert = (id = 'db-create') => db(id, {sql: 'INSERT INTO m8.Items (Id,Label) OUTPUT INSERTED.Id,INSERTED.Revision VALUES (@recordId,@label)', parameters: [param('recordId'),param('label','nvarchar',{length:500})], checks: [check(`${id}-ok`,'affectedRows')], affectedRows:{min:1,max:1}, extract:[output(),output('revision','string','Revision')]});
const remove = () => db('db-clean', {sql:'DELETE FROM m8.Items WHERE Id=@recordId',parameters:[param('recordId')],checks:[check('db-clean-ok','affectedRows')],affectedRows:{min:1,max:1}});
const select = (id = 'db-verify') => db(id, {sql:'SELECT Id,Label FROM m8.Items WHERE Id=@recordId',parameters:[param('recordId')],checks:[check(`${id}-ok`,'rows',{$input:'label'},[0,'Label'])],extract:[output()]});
const create = () => api('api-create', {method:'POST',request:{method:'POST',path:'/items',json:{id:{$input:'recordId'},label:{$input:'label'}}},checks:[statusCheck('api-create-ok',201)],extract:[{name:'recordId',type:'number',sensitivity:'public',select:{from:'json',path:['id']}}]});
const update = (extra = {}) => api('api-update', {method:'PATCH',request:{method:'PATCH',path:'/items/{recordId}',json:{label:{$input:'label'}}},checks:[statusCheck('api-update-ok',200)],...extra});
const verify = (extra = {}) => api('api-verify', {request:{method:'GET',path:'/items/{recordId}'},checks:[{id:'api-label',select:{from:'json',path:['label']},equals:{$input:'label'}}],...extra});
const clean = (extra = {}) => api('api-clean',{method:'DELETE',request:{method:'DELETE',path:'/items/{recordId}'},checks:[statusCheck('api-clean-ok',204)],...extra});
const resource = (intent = 'temporary') => ({id:'row',output:'recordId',ownership:'harness',intent});
const identity = ctx => ctx.resource('row')?.outputs.find(item=>item.name==='recordId');

// Synthetic application under test. Its HTTP/UI front ends persist through real SQL.
// This application driver is separate from the harness execution driver.
function app({dropUpdate = false, failCreate = false, failCleanup = false} = {}) {
  let writes = 0;
  return {writes:()=>writes, handler:async ({req,res,request,reply}) => {
    const url = new URL(request.path,'http://fixture.test');
    if (url.pathname === '/ui') {
      res.writeHead(200,{'content-type':'text/html'}); res.end(`<!doctype html><title>Synthetic mixed fixture</title><label>Record<input id="record"></label><label>Label<input id="label"></label><button id="save">Save</button><div id="status"></div><script>document.querySelector('#save').onclick=async()=>{const id=Number(document.querySelector('#record').value);const response=await fetch('/items/'+id,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({label:document.querySelector('#label').value})});document.querySelector('#status').textContent=response.ok?'saved':'failed';};</script>`); return;
    }
    const id = Number(url.pathname.split('/')[2] ?? request.body?.id), requestSql = application.request().input('id',sql.Int,id);
    if (request.method === 'GET') {
      const row=(await requestSql.query('SELECT Id,Label,Revision FROM m8.Items WHERE Id=@id')).recordset[0];
      reply(row?200:404,row?{id:row.Id,label:row.Label,revision:row.Revision.toString('hex')}:{absent:true}); return;
    }
    if (request.method === 'POST') {
      if(failCreate){reply(503);return;} await requestSql.input('label',sql.NVarChar(500),request.body.label).query('INSERT m8.Items (Id,Label) VALUES (@id,@label)'); writes++; reply(201,{id}); return;
    }
    if (request.method === 'PATCH') {
      await requestSql.input('label',sql.NVarChar(500),request.body.label).query('UPDATE m8.Items SET Label=@label WHERE Id=@id'); writes++;
      if(dropUpdate){req.socket.destroy();return;} reply(200,{id}); return;
    }
    if(request.method==='DELETE') {if(failCleanup){reply(503);return;} await requestSql.query('DELETE m8.Items WHERE Id=@id'); writes++; reply(204); return;}
    reply(404);
  }};
}
const live = (t,steps,settings={}) => fixture(t,steps,{target,values:[['recordId',1],['label','updated'],['initial','initial']],...settings});
async function uiExercise(ctx,operation,f) {
  const bound=identity(ctx), label=ctx.value('label');
  return ctx.browser.attempt({...options(operation),inputs:[bound,label]},async browser=>{
    await browser.native(['goto',`${f.origin}/ui`]); await browser.native(['snapshot','--filename=page.yml']);
    await browser.artifact('snapshot','page.yml',bytes=>Buffer.from(bytes.toString().replaceAll(f.origin,'http://fixture.test')));
    await browser.native(['fill','#record',String(bound.value)]); await browser.native(['fill','#label',label.value]); await browser.native(['click','#save']);
    const actual=JSON.parse((await browser.native(['run-code','async page => {await page.locator("#status").filter({hasText:"saved"}).waitFor(); return await page.locator("#status").textContent();}'])).result);
    const proof=await browser.evidence('observation',{actual,expected:'saved'});
    browser.assertion({id:'ui-saved',status:actual==='saved'?'PASS':'FAIL',reliable:true,evidenceIds:[proof]});
    browser.effect({certainty:'confirmed',resourceIds:['row']});
  });
}
for(const setupFamily of ['database','api']) test(`real ${setupFamily} setup -> native UI -> ${setupFamily==='database'?'API':'DB'} verification -> owned cleanup`,async t=>{
  const seed=setupFamily==='database'?insert():create(), verification=setupFamily==='database'?verify():select(), cleanup=setupFamily==='database'?remove():clean();
  const ui=defineOperation({id:'ui-edit',family:'browser',target:'ui',capability:'browserMutations',source:{kind:'helper',reference:'synthetic-ui-edit',version:'1'},definition:{intent:'Change the fixture label through the UI'}});
  const backend=app(),f=await live(t,[step(seed,'SETUP'),step(ui,'EXERCISE',[{id:'ui-saved'}]),step(verification,'VERIFY'),step(cleanup,'CLEANUP')],{browser:true,handler:backend.handler});
  const result=await f.start({setup:ctx=>ctx[setupFamily].execute({...options(seed),inputs:[idInput(ctx),{...ctx.value('initial'),name:'label'}],resource:resource()}),
    exercise:ctx=>uiExercise(ctx,ui,f), verify:ctx=>ctx[setupFamily==='database'?'api':'database'].execute({...options(verification),inputs:[identity(ctx),ctx.value('label')]}),
    cleanup:ctx=>ctx[setupFamily].execute({...options(cleanup),inputs:[identity(ctx)],lifecycle:{resourceId:'row'}})});
  assert.equal(result.status,'PASS');assert.equal(result.scenarios[0].requiredLifecycleComplete,true);assert.equal((await rows()).length,0);assert.equal(existsSync(join(f.roots.runRoot,'protected')),false);
  assert(result.evidence.some(item=>item.kind==='snapshot'));assert(result.scenarios[0].attempts.some(item=>item.identity.operationId===ui.id));
});

test('real API setup and exercise -> DB verification retains the intended result without before-image',async t=>{
  const seed=create(),change=update(),read=select(),backend=app(),f=await live(t,[step(seed,'SETUP'),step(change,'EXERCISE'),step(read,'VERIFY')],{handler:backend.handler});
  const result=await f.start({setup:ctx=>ctx.api.execute({...options(seed),inputs:[idInput(ctx),{...ctx.value('initial'),name:'label'}],resource:resource('persistent')}),
    exercise:ctx=>ctx.api.execute({...options(change),inputs:[identity(ctx),ctx.value('label')]}),verify:async ctx=>{const observed=await ctx.database.execute({...options(read),inputs:[identity(ctx),ctx.value('label')]});ctx.selectOutput(observed,'recordId');}});
  assert.equal(result.status,'PASS');assert.equal((await rows())[0].Label,'updated');assert.equal(result.scenarios[0].resources[0].beforeStateRef,undefined);assert.equal(result.scenarios[0].resources[0].lifecycle.action,'retain');
});

for(const conflict of [false,true]) test(`real protected API before-state -> DB change -> API check -> ${conflict?'restoration conflict':'conditional restoration'}`,async t=>{
  const beforeValue=randomUUID();await admin.request().input('before',sql.NVarChar(500),beforeValue).query('INSERT m8.Items (Id,Label) VALUES (1,@before)');
  const beforeOp=api('before',{path:'/items/1',checks:[statusCheck('before-ok',200)],extract:[{name:'before',type:'string',sensitivity:'sensitive',select:{from:'json',path:['label']}}]});
  const change=db('change',{sql:'UPDATE m8.Items SET Label=@label OUTPUT INSERTED.Id,INSERTED.Revision WHERE Id=@recordId',parameters:[param('recordId'),param('label','nvarchar',{length:500})],checks:[check('change-ok','affectedRows')],affectedRows:{min:1,max:1},extract:[output(),output('revision','string','Revision')]});
  const restore=db('restore',{sql:'UPDATE m8.Items SET Label=@before WHERE Id=@recordId AND Revision=@revision',parameters:[param('before','nvarchar',{length:500}),param('recordId'),param('revision','varbinary',{length:8})],restorationGuard:{identityParameter:'recordId',versionParameter:'revision'},affectedRows:{min:1,max:1},checks:[]});
  const read=verify(),backend=app(),f=await live(t,[step(beforeOp,'SETUP'),step(change,'EXERCISE'),step(read,'VERIFY'),step(restore,'RESTORE')],{handler:backend.handler});let captured;
  const result=await f.start({setup:async ctx=>{captured=await ctx.api.execute(options(beforeOp));},exercise:ctx=>ctx.database.execute({...options(change),inputs:[idInput(ctx),ctx.value('label')],resource:{...resource('restore'),ownership:'existing',beforeStateRef:'protected:before'}}),
    verify:async ctx=>{await ctx.api.execute({...options(read),inputs:[identity(ctx),ctx.value('label')]});if(conflict)await admin.request().query("UPDATE m8.Items SET Label=N'concurrent' WHERE Id=1");},
    cleanup:ctx=>ctx.database.execute({...options(restore),phase:'RESTORE',inputs:[identity(ctx),ctx.resource('row').outputs.find(item=>item.name==='revision'),ctx.output(captured,'before')],lifecycle:{resourceId:'row'}})},
    {api:{storeSensitive:value=>{assert.equal(value,beforeValue);return 'protected:before';}},database:{resolveSensitive:reference=>{assert.equal(reference,'protected:before');return beforeValue;}}});
  assert.equal(result.status,conflict?'FAIL':'PASS');assert.equal((await rows())[0].Label,conflict?'concurrent':beforeValue);assert.equal(result.scenarios[0].resources[0].lifecycle.status,conflict?'conflict':'completed');assert(!f.allText().includes(beforeValue));
});

test('real partial DB/API setup failure blocks exercise and cleans only the created fixture',async t=>{
  const seed=insert(),second=create(),read=select(),cleanup=remove(),backend=app({failCreate:true}),f=await live(t,[step(seed,'SETUP'),step(second,'SETUP'),step(read,'VERIFY'),step(cleanup,'CLEANUP')],{handler:backend.handler});let verified=false;
  const result=await f.start({setup:async ctx=>{await ctx.database.execute({...options(seed),inputs:[idInput(ctx),ctx.value('label')],resource:resource()});await ctx.api.execute({...options(second),inputs:[idInput(ctx),ctx.value('label')]});},verify:()=>{verified=true;},
    cleanup:ctx=>ctx.database.execute({...options(cleanup),inputs:[identity(ctx)],lifecycle:{resourceId:'row'}})});
  assert.equal(result.status,'FAIL');assert.equal(verified,false);assert.equal((await rows()).length,0);assert.equal(result.scenarios[0].requiredLifecycleComplete,true);
});

for(const mode of ['confirmed','required-response','inconclusive']) test(`real uncertain API mutation with ${mode} reconciliation preserves effects and DB cleanup`,async t=>{
  const seed=insert(),cleanup=remove(),read=select(),backend=app({dropUpdate:true});
  const change=update({checks:mode==='required-response'?[statusCheck('api-update-ok',200)]:[],recovery:{reconcile:{request:{method:'GET',path:'/items/{recordId}'},readOnlyContract:'fixture-label-read',status:200,select:{from:'json',path:['label']},equals:mode==='inconclusive'?'absent':{$input:'label'},whenEqual:'confirmed-effect'}}});
  const f=await live(t,[step(seed,'SETUP'),step(change,'EXERCISE'),step(read,'VERIFY'),step(cleanup,'CLEANUP')],{handler:backend.handler});
  const result=await f.start({setup:ctx=>ctx.database.execute({...options(seed),inputs:[idInput(ctx),{...ctx.value('initial'),name:'label'}],resource:resource()}),
    exercise:ctx=>ctx.api.execute({...options(change),inputs:[identity(ctx),ctx.value('label')]}),verify:ctx=>ctx.database.execute({...options(read),inputs:[identity(ctx),ctx.value('label')]}),
    cleanup:ctx=>ctx.database.execute({...options(cleanup),inputs:[identity(ctx)],lifecycle:{resourceId:'row'}})});
  assert.equal(result.status,{confirmed:'PASS','required-response':'BLOCKED',inconclusive:'NEEDS_REVIEW'}[mode]);assert.equal(backend.writes(),1);assert.equal((await rows()).length,0);assert.equal(result.scenarios[0].requiredLifecycleComplete,true);
  if(mode==='confirmed')assert.equal(result.stability,'recovered');
});

for(const assertionFailure of [false,true]) test(`real API cleanup failure ${assertionFailure?'preserves assertion FAIL':'prevents a clean pass'}`,async t=>{
  const seed=insert(),read=verify({checks:[{id:'verified-label',select:{from:'json',path:['label']},equals:assertionFailure?'different':{$input:'label'}}]}),cleanup=clean({checks:[],effects:{confirmedStatuses:[204],noEffectStatuses:[503],contractRef:'fixture-delete'}});
  const backend=app({failCleanup:true}),f=await live(t,[step(seed,'SETUP'),step(read,'VERIFY'),step(cleanup,'CLEANUP')],{handler:backend.handler});
  const result=await f.start({setup:ctx=>ctx.database.execute({...options(seed),inputs:[idInput(ctx),ctx.value('label')],resource:resource()}),verify:ctx=>ctx.api.execute({...options(read),inputs:[identity(ctx),ctx.value('label')]}),
    cleanup:ctx=>ctx.api.execute({...options(cleanup),inputs:[identity(ctx)],lifecycle:{resourceId:'row'}})});
  assert.equal(result.status,assertionFailure?'FAIL':'NEEDS_REVIEW');assert.equal(result.scenarios[0].requiredLifecycleComplete,false);assert.equal((await rows()).length,1);
});

test('real sensitive API output cannot leak through a later public database extraction',async t=>{
  const privateValue=randomUUID();await admin.request().input('value',sql.NVarChar(500),privateValue).query('INSERT m8.Items (Id,Label) VALUES (1,@value)');
  const read=api('before',{path:'/items/1',checks:[statusCheck('before-ok',200)],extract:[{name:'privateValue',type:'string',sensitivity:'sensitive',select:{from:'json',path:['label']}}]});
  const echo=db('echo',{sql:'SELECT Label FROM m8.Items WHERE Id=1',checks:[check('echo-row')],extract:[output('publicCopy','string','Label')]});
  const backend=app(),f=await live(t,[step(read,'SETUP'),step(echo,'VERIFY')],{handler:backend.handler});
  const result=await f.start({setup:ctx=>ctx.api.execute(options(read)),verify:ctx=>ctx.database.execute(options(echo))},{api:{storeSensitive:()=> 'protected:value'}});
  assert.equal(result.status,'NEEDS_REVIEW');assert.equal(result.scenarios[0].attempts.at(-1).outputs.length,0);assert(!f.allText().includes(privateValue));
});
