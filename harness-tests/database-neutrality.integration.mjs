import test, {before, after, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import sql from 'mssql';
import {fixture, operation, param, output, check} from './fixtures/database.mjs';
import {fixture as mixedFixture} from './fixtures/sequential.mjs';
import {operation as api} from './fixtures/api.mjs';

const target = JSON.parse(process.env.HARNESS_M10_TARGET ?? 'null');
assert(target && ['sqlserver','postgresql'].includes(target.engine), 'Run through a real database neutrality probe.');
const postgresql=target.engine==='postgresql',table=postgresql?'m10."Items"':'m8.Items',summaries=[];
let admin;
before(async()=>{admin=postgresql?new pg.Client(JSON.parse(process.env.HARNESS_M10_ADMIN)):new sql.ConnectionPool(JSON.parse(process.env.HARNESS_M10_ADMIN));await admin.connect();});
const native=async text=>{const response=postgresql?await admin.query(text):await admin.request().query(text);return postgresql?response.rows:response.recordset;};
beforeEach(async()=>{await native(`DELETE FROM ${table}`);});
after(async()=>{if(postgresql)await admin?.end();else await admin?.close();console.log(JSON.stringify({probe:'database-neutrality',engine:target.engine,cases:summaries.sort((a,b)=>a.name.localeCompare(b.name))}));});
const p=(name,type='integer')=>param(name,type==='integer'?(postgresql?'integer':'int'):type==='version'?(postgresql?'xid':'varbinary'):(postgresql?'text':'nvarchar'),type==='text'?{length:500}:type==='version'&&!postgresql?{length:8}:{});
const definition=(name,d)=>operation(name,{engine:target.engine,...d});
const create=(kind='inline')=>definition('create',{kind,sql:postgresql?'INSERT INTO m10."Items" ("Id","Label") VALUES ($1,$2) RETURNING "Id",xmin::text AS "Revision"':'INSERT INTO m8.Items (Id,Label) OUTPUT INSERTED.Id,INSERTED.Revision VALUES (@recordId,@label)',parameters:[p('recordId'),p('label','text')],checks:[check('created','affectedRows')],affectedRows:{min:1,max:1},extract:[output(),output('revision','string','Revision')]});
const update=(kind='inline')=>definition('update',{kind,sql:postgresql?'UPDATE m10."Items" SET "Label"=$2 WHERE "Id"=$1 RETURNING "Id",xmin::text AS "Revision"':'UPDATE m8.Items SET Label=@label OUTPUT INSERTED.Id,INSERTED.Revision WHERE Id=@recordId',parameters:[p('recordId'),p('label','text')],checks:[check('updated','affectedRows')],affectedRows:{min:1,max:1},extract:[output(),output('revision','string','Revision')]});
const read=(kind='inline',equals={$input:'label'})=>definition('read',{kind,sql:postgresql?'SELECT "Id","Label" FROM m10."Items" WHERE "Id"=$1':'SELECT Id,Label FROM m8.Items WHERE Id=@recordId',parameters:[p('recordId')],checks:[check('observed','rows',equals,[0,'Label'])],extract:[output(),output('label','string','Label')]});
const remove=(kind='inline')=>definition('remove',{kind,sql:postgresql?'DELETE FROM m10."Items" WHERE "Id"=$1':'DELETE FROM m8.Items WHERE Id=@recordId',parameters:[p('recordId')],checks:[check('removed','affectedRows')],affectedRows:{min:1,max:1}});
const retained=(intent='temporary',ownership='harness')=>({id:'row',output:'recordId',ownership,intent});
const live=(t,definitions,settings={})=>fixture(t,definitions,{target,values:[['recordId',7],['label','updated'],['initial','initial']],...settings});
const initial=f=>f.run.inputs.values.find(v=>v.name==='initial'),value=(f,name)=>f.run.inputs.values.find(v=>v.name===name);
const binding=attempt=>attempt.outputs.find(v=>v.name==='recordId');
function record(name,result) {
  const scenario=result.scenarios[0],producer=id=>scenario.attempts.find(a=>a.identity.attemptId===id)?.identity.operationId??'initial';
  summaries.push({name,status:result.status,stability:result.stability,counts:scenario.counts,
    attempts:scenario.attempts.map(a=>({operation:a.identity.operationId,source:result.operations.find(op=>op.id===a.identity.operationId).source.kind,phase:a.identity.phase,outcome:a.outcome,failureClass:a.failureClass,effect:a.effect.certainty,
      evidence:[...new Set(a.evidenceIds.map(id=>result.evidence.find(item=>item.id===id).kind))].sort(),
      assertions:a.assertions.map(c=>({id:c.id,status:c.status,reliable:c.reliable})),inputs:a.inputs.map(v=>({name:v.name,from:producer(v.producer.attemptId),output:v.producer.name,type:v.type,sensitivity:v.sensitivity})),
      outputs:a.outputs.map(v=>({name:v.name,type:v.type,sensitivity:v.sensitivity,...(v.sensitivity==='public'&&v.name!=='revision'?{value:v.value}:{})}))})),
    resources:scenario.resources.map(r=>({id:r.id,ownership:r.ownership,intent:r.intent,action:r.lifecycle.action,status:r.lifecycle.status})),requiredLifecycleComplete:scenario.requiredLifecycleComplete,
    selected:scenario.outputs.map(v=>({name:v.name,type:v.type,value:v.value}))});
}

for(const kind of ['catalog','helper','inline','exploration'])test(`neutral native CRUD and typed binding through ${kind}`,async t=>{
  const seed=create(kind),change=update(kind),observe=read(kind),clean=remove(kind),f=live(t,[seed,change,observe,clean]);
  const created=await f.call(seed,{phase:'SETUP',inputs:[value(f,'recordId'),{...initial(f),name:'label'}],resource:retained()});
  await f.call(change,{inputs:[binding(created),value(f,'label')]});
  const seen=await f.call(observe,{phase:'VERIFY',inputs:[binding(created),value(f,'label')]});f.runtime.selectOutput(seen,'label');
  await f.call(clean,{phase:'CLEANUP',inputs:[binding(created)],lifecycle:{resourceId:'row'}});
  const result=f.runtime.finish();assert.equal(result.status,'PASS');assert.equal((await native(`SELECT * FROM ${table}`)).length,0);record(`crud-${kind}`,result);
});
for(const intent of ['persistent','no-obligation'])test(`neutral ${intent} outcomes need no automatic before-state or cleanup`,async t=>{
  const seed=create(),observe=read(),f=live(t,[seed,observe]);const created=await f.call(seed,{phase:'SETUP',inputs:[value(f,'recordId'),value(f,'label')],resource:retained(intent)});
  const seen=await f.call(observe,{phase:'VERIFY',inputs:[binding(created),value(f,'label')]});f.runtime.selectOutput(seen,'label');
  const result=f.runtime.finish();assert.equal(result.status,'PASS');assert.equal(result.scenarios[0].resources[0].beforeStateRef,undefined);assert.equal((await native(`SELECT * FROM ${table}`)).length,1);record(intent,result);
});
for(const conflict of [false,true])test(`neutral optional restoration ${conflict?'detects a concurrent change':'restores existing state'}`,async t=>{
  await native(postgresql?'INSERT INTO m10."Items" ("Id","Label") VALUES (7,\'initial\')':"INSERT m8.Items (Id,Label) VALUES (7,N'initial')");
  const change=update(),observe=read(),restore=definition('restore',{sql:postgresql?'UPDATE m10."Items" SET "Label"=$2 WHERE "Id"=$1 AND xmin=$3':'UPDATE m8.Items SET Label=@label WHERE Id=@recordId AND Revision=@revision',parameters:[p('recordId'),p('label','text'),p('revision','version')],checks:[],affectedRows:{min:1,max:1},restorationGuard:{identityParameter:'recordId',versionParameter:'revision'}});
  const f=live(t,[change,observe,restore]);const changed=await f.call(change,{resource:retained('restore','existing')});
  await f.call(observe,{phase:'VERIFY',inputs:[binding(changed),value(f,'label')]});
  if(conflict)await native(postgresql?'UPDATE m10."Items" SET "Label"=\'concurrent\' WHERE "Id"=7':"UPDATE m8.Items SET Label=N'concurrent' WHERE Id=7");
  await f.call(restore,{phase:'RESTORE',inputs:[binding(changed),{...initial(f),name:'label'},changed.outputs.find(v=>v.name==='revision')],lifecycle:{resourceId:'row'}});
  const result=f.runtime.finish();assert.equal(result.status,conflict?'FAIL':'PASS');assert.equal((await native(`SELECT * FROM ${table}`))[0].Label,conflict?'concurrent':'initial');record(conflict?'restoration-conflict':'restoration',result);
});
test('neutral assertion failure remains FAIL after successful cleanup',async t=>{
  const seed=create(),observe=read('inline','different'),clean=remove(),f=live(t,[seed,observe,clean]);const created=await f.call(seed,{phase:'SETUP',resource:retained()});
  await f.call(observe,{phase:'VERIFY',inputs:[binding(created)]});await f.call(clean,{phase:'CLEANUP',inputs:[binding(created)],lifecycle:{resourceId:'row'}});
  const result=f.runtime.finish();assert.equal(result.status,'FAIL');assert.equal(result.scenarios[0].requiredLifecycleComplete,true);record('assertion-failure',result);
});
test('neutral required cleanup failure prevents a clean pass',async t=>{
  const seed=create(),observe=read(),clean=definition('remove',{sql:postgresql?'DELETE FROM m10."Items" WHERE "Id"=$1 AND false':'DELETE FROM m8.Items WHERE Id=@recordId AND 1=0',parameters:[p('recordId')],checks:[]});
  const f=live(t,[seed,observe,clean]),created=await f.call(seed,{phase:'SETUP',resource:retained()});await f.call(observe,{phase:'VERIFY',inputs:[binding(created),value(f,'label')]});
  await f.call(clean,{phase:'CLEANUP',inputs:[binding(created)],lifecycle:{resourceId:'row'}});const result=f.runtime.finish();assert.equal(result.status,'NEEDS_REVIEW');assert.equal((await native(`SELECT * FROM ${table}`)).length,1);record('cleanup-failure',result);
});
test('neutral scoped database setup feeds API verification and database cleanup',async t=>{
  const seed=create(),clean=remove(),observe=api('api-read',{path:'/items',checks:[{id:'api-label',select:{from:'json',path:['label']},equals:'updated'}]});
  const f=await mixedFixture(t,[{operation:seed,phase:'SETUP'},{operation:observe,phase:'VERIFY'},{operation:clean,phase:'CLEANUP'}],{target,values:[['recordId',7],['label','updated']],handler:async({reply})=>{const row=(await native(`SELECT * FROM ${table}`))[0];reply(200,{label:row.Label});}});
  const result=await f.start({setup:ctx=>ctx.database.execute({operation:seed,invocationId:seed.id,inputs:[ctx.value('recordId'),ctx.value('label')],resource:retained()}),
    verify:ctx=>ctx.api.execute({operation:observe,invocationId:observe.id,inputs:[ctx.resource('row').outputs[0]]}),cleanup:ctx=>ctx.database.execute({operation:clean,invocationId:clean.id,inputs:[ctx.resource('row').outputs[0]],lifecycle:{resourceId:'row'}})});
  assert.equal(result.status,'PASS');assert.equal((await native(`SELECT * FROM ${table}`)).length,0);record('mixed-api',result);
});
test('neutral partial setup preserves uncertain failure and cleans the created resource',async t=>{
  const seed=create(),second=definition('second',{...seed.definition,checks:[check('second-created','affectedRows')]}),observe=read(),clean=remove();let verified=false;
  const f=await mixedFixture(t,[{operation:seed,phase:'SETUP'},{operation:second,phase:'SETUP'},{operation:observe,phase:'VERIFY'},{operation:clean,phase:'CLEANUP'}],{target,values:[['recordId',7],['label','updated']]});
  const result=await f.start({setup:async ctx=>{const inputs=[ctx.value('recordId'),ctx.value('label')];await ctx.database.execute({operation:seed,invocationId:seed.id,inputs,resource:retained()});await ctx.database.execute({operation:second,invocationId:second.id,inputs});},
    verify:()=>{verified=true;},cleanup:ctx=>ctx.database.execute({operation:clean,invocationId:clean.id,inputs:[ctx.resource('row').outputs[0]],lifecycle:{resourceId:'row'}})});
  assert.equal(result.status,'NEEDS_REVIEW');assert.equal(verified,false);assert.equal((await native(`SELECT * FROM ${table}`)).length,0);assert.equal(result.scenarios[0].requiredLifecycleComplete,true);record('partial-setup',result);
});
