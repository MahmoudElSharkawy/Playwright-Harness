import test, {before, after, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import sql from 'mssql';
import {executeSqlServer} from '../scripts/lib/database/sqlserver-driver.mjs';
import {fixture, operation, check, param, output} from './fixtures/database.mjs';
import {defineOperation} from '../scripts/lib/execution-core/index.mjs';

// This suite fails when no real fixture is configured; it never silently skips.
const target = JSON.parse(process.env.HARNESS_M8_TARGET ?? 'null');
assert(target, 'Run the real-instance suite through probe:database.');
let admin;
before(async () => {admin = await new sql.ConnectionPool(JSON.parse(process.env.HARNESS_M8_ADMIN)).connect();});
after(async () => {await admin?.close();});
beforeEach(async () => {await admin.request().query('DELETE FROM m8.Items; DELETE FROM m8.OtherItems');});
const live = (t, ops, options = {}) => fixture(t, ops, {...options, target: {...target, ...options.target}});
const insert = (id = 'insert', extra = {}) => operation(id, {sql: 'INSERT INTO m8.Items (Id,Label) OUTPUT INSERTED.Id,INSERTED.Revision VALUES (@recordId,@label)',
  parameters: [param('recordId'),param('label','nvarchar',{length: 500})], checks: [check(`check-${id}`, 'affectedRows')], affectedRows: {min: 1,max: 1}, extract: [output(),output('revision','string','Revision')], ...extra});
const seed = async () => admin.request().query("INSERT m8.Items (Id,Label) VALUES (1,N'original')");

for (const kind of ['catalog','helper','inline','exploration']) test(`real ${kind} read has equivalent typed output`, async t => {
  const op = operation('query', {kind, extract: [output()]}), f = live(t, [op]); const a = await f.call();
  assert.equal(a.outcome, 'SUCCESS'); f.runtime.selectOutput(a, 'recordId'); const result = f.runtime.finish(); assert.equal(result.status, 'PASS'); assert.equal(result.scenarios[0].outputs[0].value, 1);
});
for (const kind of ['catalog','helper','inline','exploration']) test(`real ${kind} mutation uses identical controls without catalog conversion`,async t=>{
  const op=insert('write',{kind}),f=live(t,[op],{values:[['recordId',1],['label','synthetic']]});await f.call();assert.equal(f.runtime.finish().status,'PASS');
  assert.equal((await admin.request().query('SELECT COUNT(*) AS n FROM m8.Items')).recordset[0].n,1);
});
test('real dynamic CRUD binds injection-shaped values and records intentional retention', async t => {
  const text = "synthetic'); DELETE FROM m8.Items; --", create = insert('create', {kind: 'exploration'});
  const read = operation('read', {kind: 'exploration', sql: 'SELECT Label FROM m8.Items WHERE Id=@recordId', parameters: [param('recordId')], checks: [check('read-label','rows',{$input:'label'},[0,'Label'])]});
  const update = operation('update', {kind: 'exploration', sql: 'UPDATE m8.Items SET Label=@label WHERE Id=@recordId', parameters: create.definition.parameters, checks: [check('updated','affectedRows')], affectedRows:{min:1,max:1}});
  const remove = operation('remove', {kind:'exploration',sql:'DELETE FROM m8.Items WHERE Id=@recordId',parameters:[param('recordId')],checks:[check('deleted','affectedRows')],affectedRows:{min:1,max:1}});
  const f = live(t,[create,read,update,remove],{values:[['recordId',1],['label',text]]});
  await f.call(create,{phase:'SETUP',resource:{id:'row',output:'recordId',ownership:'harness',intent:'persistent'}});
  await f.call(read); await f.call(update); await f.call(remove);
  const result=f.runtime.finish(); assert.equal(result.status,'PASS'); assert.equal(result.scenarios[0].resources[0].beforeStateRef,undefined);
  assert.equal((await admin.request().query('SELECT COUNT(*) AS n FROM m8.Items')).recordset[0].n,0);
});
for (const intent of ['temporary','persistent','no-obligation']) test(`real ${intent} resource has intent-driven lifecycle`, async t => {
  const create=insert(), remove=operation('cleanup',{sql:'DELETE FROM m8.Items WHERE Id=@recordId',parameters:[param('recordId')],checks:[check('removed','affectedRows')],affectedRows:{min:1,max:1}});
  const f=live(t,intent==='temporary'?[create,remove]:[create],{values:[['recordId',1],['label','synthetic']]});
  const created=await f.call(create,{phase:'SETUP',resource:{id:'row',output:'recordId',ownership:'harness',intent}});
  if(intent==='temporary')await f.call(remove,{phase:'CLEANUP',inputs:[created.outputs[0]],lifecycle:{resourceId:'row'}});
  assert.equal(f.runtime.finish().status,'PASS'); assert.equal((await admin.request().query('SELECT COUNT(*) AS n FROM m8.Items')).recordset[0].n,intent==='temporary'?0:1);
});
test('ordinary full-table fixture cleanup has no universal WHERE restriction',async t=>{
  await seed(); const op=operation('cleanup',{sql:'DELETE FROM m8.Items',checks:[check('removed','affectedRows')],affectedRows:{min:1,max:1}}),f=live(t,[op]);await f.call();assert.equal(f.runtime.finish().status,'PASS');
});
test('controlled dynamic table identifiers and bound values execute on the real driver',async t=>{
  const op=operation('query',{sql:'SELECT Id FROM m8.{{table}} WHERE Id=@recordId',identifiers:{table:{input:'table',allowed:['Items','OtherItems']}},parameters:[param('recordId')],checks:[check('empty','rowCount',0)]});
  const f=live(t,[op],{values:[['table','OtherItems'],['recordId',1]]});await f.call();assert.equal(f.runtime.finish().status,'PASS');
  const bad=live(t,[op],{values:[['table','Items; DROP TABLE m8.Items'],['recordId',1]]});assert.equal((await bad.call()).effect.certainty,'not-executed');assert.equal(bad.runtime.finish().status,'BLOCKED');
});
test('wrong affected-row expectation is FAIL and cannot retry to green',async t=>{
  const op=operation('write',{sql:'DELETE FROM m8.Items',checks:[check('count','affectedRows',0)],affectedRows:{min:1,max:1}}),f=live(t,[op]);await f.call();const result=f.runtime.finish();assert.equal(result.status,'FAIL');assert.equal(result.scenarios[0].attempts.length,1);
});
test('scoped principal cannot read another schema and broad admin credentials are refused before dispatch',async t=>{
  const op=operation('outside',{sql:'SELECT Id FROM dbo.OutsideScope'}),f=live(t,[op]);const a=await f.call();assert.equal(a.failureClass,'EXECUTOR');assert.equal(f.runtime.finish().status,'BLOCKED');
  const config=JSON.parse(process.env.HARNESS_M8_ADMIN),broad=live(t,[operation()],{runtime:{resolveCredential:()=>({user:config.user,password:config.password})}});
  assert.equal((await broad.call()).effect.certainty,'not-executed');assert.equal(broad.runtime.finish().status,'BLOCKED');
});
test('DDL/admin is refused even when configured; no arbitrary execution fallback',async t=>{
  const normal=operation(),f=live(t,[normal],{capabilities:{ddl:true,admin:true}});
  for(const [capability,text] of [['ddl','DROP TABLE m8.Items'],['admin','EXEC sp_who']]){
    const op=defineOperation({id:'forbidden',family:'database',target:'db',capability,source:{kind:'exploration',reference:'test',version:'1'},definition:{sql:text,checks:[]}});
    await assert.rejects(f.runtime.execute({operation:op,invocationId:'forbidden'}));
  }
  await f.call();assert.equal(f.runtime.finish().status,'PASS');
});
test('sensitive input/selected result and native errors stay out of persisted evidence',async t=>{
  const value=randomUUID(),op=operation('private',{sql:'SELECT @value AS PrivateValue',parameters:[param('value','nvarchar',{length:100})],checks:[check('same','rows',{$input:'value'},[0,'PrivateValue'])],extract:[output('privateValue','string','PrivateValue','sensitive')]});
  const f=live(t,[op],{values:[['value','protected:source','sensitive','string']],runtime:{resolveSensitive:()=>value,storeSensitive:()=> 'protected:result'}});
  await f.call();assert.equal(f.runtime.finish().status,'PASS');assert(!f.allText().includes(value));assert(!f.allText().includes(JSON.parse(process.env.M8_DB_CREDENTIAL).password));
});
test('result bounds cancel real streaming without presenting partial rows as success',async t=>{
  const op=operation('bounded',{sql:'SELECT v.Id FROM (VALUES (1),(2),(3)) v(Id)',maxRows:2}),f=live(t,[op]);const a=await f.call();assert.equal(a.failureClass,'EXECUTOR');assert.equal(a.outputs.length,0);assert.equal(f.runtime.finish().status,'BLOCKED');
});

for (const concurrentChange of [false,true]) test(`conditional restoration ${concurrentChange?'detects a conflict':'restores only required existing state'}`,async t=>{
  await seed();
  const change=insert('change',{sql:'UPDATE m8.Items SET Label=@label OUTPUT INSERTED.Id,INSERTED.Revision WHERE Id=@recordId'});
  const restore=operation('restore',{sql:'UPDATE m8.Items SET Label=@original WHERE Id=@recordId AND Revision=@revision',parameters:[param('original','nvarchar',{length:500}),param('recordId'),param('revision','varbinary',{length:8})],
    restorationGuard:{identityParameter:'recordId',versionParameter:'revision'},checks:[check('restored','affectedRows')],affectedRows:{min:1,max:1}});
  const f=live(t,[change,restore],{values:[['recordId',1],['label','temporary'],['original','protected:before','sensitive','string'],['oldRevision','0000000000000000']],runtime:{resolveSensitive:()=> 'original'}});
  const changed=await f.call(change,{resource:{id:'existing',output:'recordId',ownership:'existing',intent:'restore',beforeStateRef:'protected:before'}});
  await assert.rejects(f.call(restore,{phase:'RESTORE',inputs:[changed.outputs[0],{...f.run.inputs.values[3],name:'revision'},f.run.inputs.values[2]],lifecycle:{resourceId:'existing'}}));
  if(concurrentChange)await admin.request().query("UPDATE m8.Items SET Label=N'concurrent' WHERE Id=1");
  await f.call(restore,{phase:'RESTORE',inputs:[...changed.outputs,f.run.inputs.values[2]],lifecycle:{resourceId:'existing'}});
  const result=f.runtime.finish();assert.equal(result.status,concurrentChange?'FAIL':'PASS');assert.equal(result.scenarios[0].resources[0].lifecycle.status,concurrentChange?'conflict':'completed');
  assert.equal((await admin.request().query('SELECT Label FROM m8.Items WHERE Id=1')).recordset[0].Label,concurrentChange?'concurrent':'original');
});
test('pending required cleanup prevents a clean pass',async t=>{
  const op=insert(),f=live(t,[op],{values:[['recordId',1],['label','synthetic']]});await f.call(op,{resource:{id:'row',output:'recordId',ownership:'harness',intent:'temporary'}});assert.equal(f.runtime.finish().status,'NEEDS_REVIEW');
});
async function lockRow(t) {
  await seed();const tx=new sql.Transaction(admin);await tx.begin();await new sql.Request(tx).query('UPDATE m8.Items SET Label=Label WHERE Id=1');
  let closed=false;const release=async()=>{if(!closed){closed=true;await tx.rollback();}};t.after(release);return release;
}
async function waitForBlockedRequest() {
  for(let i=0;i<150;i++){
    const r=await admin.request().query("SELECT r.session_id FROM sys.dm_exec_requests r JOIN sys.dm_exec_sessions s ON s.session_id=r.session_id WHERE s.program_name=N'playwright-pom-harness' AND r.blocking_session_id<>0");
    if(r.recordset.length)return;await pause(20);
  }
  throw new Error('Expected real lock wait was not observed.');
}
test('real read timeout can recover with complete attempt history',async t=>{
  let resolves=0;
  const release=await lockRow(t),op=operation('read',{sql:'SELECT Id FROM m8.Items WHERE Id=@recordId',parameters:[param('recordId')],timeoutMs:600}),f=live(t,[op],{values:[['recordId','protected:input','sensitive','number']],runtime:{resolveSensitive:()=>++resolves}});
  const pending=f.call();await waitForBlockedRequest();const timer=setTimeout(()=>release().catch(()=>{}),650);t.after(()=>clearTimeout(timer));await pending;const result=f.runtime.finish();
  assert.equal(result.status,'PASS');assert.equal(result.stability,'recovered');assert.equal(result.scenarios[0].attempts.length,2);
  assert.equal(resolves,1);
});
for(const cancel of [false,true])test(`real mutation ${cancel?'cancellation':'timeout'} preserves uncertain effect without replay`,async t=>{
  const release=await lockRow(t),controller=new AbortController();
  const op=operation('write',{sql:'UPDATE m8.Items SET Label=@label WHERE Id=1',parameters:[param('label','nvarchar',{length:500})],checks:[check('changed','affectedRows')],timeoutMs:cancel?5000:500});
  const f=live(t,[op],{values:[['label','changed']],runtime:{signal:controller.signal}}),pending=f.call();
  if(cancel){await waitForBlockedRequest();controller.abort();}
  const attempt=await pending;await release();assert.equal(attempt.effect.certainty,'uncertain');assert.equal(attempt.failureClass,cancel?'CANCELLED':'TIMEOUT');
  const result=f.runtime.finish();assert.equal(result.status,'NEEDS_REVIEW');assert.equal(result.scenarios[0].attempts.length,1);
  assert.equal((await admin.request().query('SELECT Label FROM m8.Items WHERE Id=1')).recordset[0].Label,'original');
});
test('required cleanup is allowed after ordinary cancellation with its own budget',async t=>{
  const controller=new AbortController(),create=insert(),remove=operation('cleanup',{sql:'DELETE FROM m8.Items WHERE Id=@recordId',parameters:[param('recordId')],checks:[check('removed','affectedRows')],affectedRows:{min:1,max:1}});
  const f=live(t,[create,remove],{values:[['recordId',1],['label','synthetic']],runtime:{signal:controller.signal}});
  const created=await f.call(create,{resource:{id:'row',output:'recordId',ownership:'harness',intent:'temporary'}});controller.abort();
  await f.call(remove,{phase:'CLEANUP',inputs:[created.outputs[0]],lifecycle:{resourceId:'row'}});assert.equal(f.runtime.finish().status,'PASS');
});
test('native types normalize at the SQL Server boundary',async t=>{
  const op=operation('types',{sql:"SELECT CAST(9223372036854775807 AS bigint) AS Large, CAST(1 AS bit) AS Flag, CAST('2025-01-02T03:04:05.006' AS datetime2(3)) AS Moment, CAST(0x1234 AS varbinary(2)) AS Bytes, CAST(12.34 AS decimal(10,2)) AS Amount",
    checks:[check('large','rows','9223372036854775807',[0,'Large']),check('flag','rows',true,[0,'Flag']),check('moment','rows','2025-01-02T03:04:05.006Z',[0,'Moment']),check('bytes','rows','1234',[0,'Bytes']),check('amount','rows',12.34,[0,'Amount'])]});
  const f=live(t,[op]);await f.call();assert.equal(f.runtime.finish().status,'PASS');
});
test('native conversion errors containing a sensitive bound value are redacted',async t=>{
  const value=randomUUID(),op=operation('bad',{sql:'SELECT CAST(@value AS int) AS Id',parameters:[param('value','nvarchar',{length:100})]});
  const f=live(t,[op],{values:[['value','protected:source','sensitive','string']],runtime:{resolveSensitive:()=>value}});const a=await f.call();assert.equal(a.failureClass,'EXECUTOR');assert.equal(f.runtime.finish().status,'BLOCKED');assert(!f.allText().includes(value));
});
test('trigger counts are kept separate and cannot be invented as one affected-row count',async t=>{
  await admin.request().query('CREATE TRIGGER m8.counts ON m8.Items AFTER INSERT AS INSERT m8.OtherItems(Id) SELECT Id FROM inserted');
  try {const op=insert(),f=live(t,[op],{values:[['recordId',1],['label','synthetic']]});await f.call();assert.equal(f.runtime.finish().status,'NEEDS_REVIEW');}
  finally{await admin.request().query('DROP TRIGGER m8.counts');}
});
test('changed source definitions cannot replace the frozen operation',async t=>{
  const op=operation(),f=live(t,[op]),changed=operation('query',{sql:'SELECT 2 AS Id'});await assert.rejects(f.call(changed));await f.call(op);assert.equal(f.runtime.finish().status,'PASS');
});
test('LOB truncation and high-precision native decimals cannot yield fabricated passes',async t=>{
  for(const text of ["SELECT REPLICATE(CAST(N'x' AS nvarchar(max)),100000) AS Value",'SELECT CAST(12345678901234567890 AS decimal(30,0)) AS Value']){
    const op=operation('bounded',{sql:text,maxResponseBytes:1024}),f=live(t,[op]);assert.equal((await f.call()).outcome,'INFRASTRUCTURE_FAILURE');assert.equal(f.runtime.finish().status,'BLOCKED');
  }
});
test('real typed parameter binding retains null, bigint, Unicode, binary, dates and numeric values',async t=>{
  const values=[['large','9223372036854775807'],['flag',true],['moment','2025-01-02T03:04:05.006Z'],['bytes','1234'],['amount',12.34],['label','synthetic \u0645\u062b\u0627\u0644'],['empty',null],['identifier',randomUUID()],['fraction',1.25]];
  const parameters=[param('large','bigint'),param('flag','bit'),param('moment','datetime2'),param('bytes','varbinary',{length:2}),param('amount','decimal',{precision:10,scale:2}),param('label','nvarchar',{length:100}),param('empty','int'),param('identifier','uniqueidentifier'),param('fraction','float')];
  const op=operation('types',{sql:'SELECT @large AS large,@flag AS flag,@moment AS moment,@bytes AS bytes,@amount AS amount,@label AS label,@empty AS empty,@identifier AS identifier,@fraction AS fraction',parameters,
    checks:values.map(([name,value])=>check(`typed-${name}`,'rows',name==='identifier'?value.toUpperCase():value,[0,name]))});
  const f=live(t,[op],{values});await f.call();assert.equal(f.runtime.finish().status,'PASS');
});
test('a failed cleanup preserves reliable FAIL and leaves the obligation visible',async t=>{
  const create=insert(),remove=operation('cleanup',{sql:'DELETE FROM m8.Items WHERE Id=@recordId AND 1=0',parameters:[param('recordId')],checks:[check('removed','affectedRows')],affectedRows:{min:1,max:1}}),f=live(t,[create,remove],{values:[['recordId',1],['label','synthetic']]});
  const created=await f.call(create,{resource:{id:'row',output:'recordId',ownership:'harness',intent:'temporary'}});await f.call(remove,{phase:'CLEANUP',inputs:[created.outputs[0]],lifecycle:{resourceId:'row'}});
  const result=f.runtime.finish();assert.equal(result.status,'FAIL');assert.equal(result.scenarios[0].resources[0].lifecycle.status,'failed');
});
test('legacy text changes cannot be dispatched as a protected read',async t=>{
  await admin.request().query("CREATE TABLE m8.LegacyItems(Id int, Body text); INSERT m8.LegacyItems VALUES(1,'original')");
  try {
    for(const command of ['WRITETEXT','UPDATETEXT'])assert.throws(()=>operation('legacy',{sql:`SELECT 1 AS Id ${command} LegacyItems.Body @pointer @payload`,parameters:[param('pointer','varbinary',{length:16}),param('payload','varchar',{length:20})]}));
    const op=operation('read',{sql:'SELECT CAST(Body AS varchar(20)) AS Value FROM m8.LegacyItems',checks:[check('unchanged','rows','original',[0,'Value'])]}),f=live(t,[op],{mode:'protected'});
    await f.call();assert.equal(f.runtime.finish().status,'PASS');
  }finally{await admin.request().query('DROP TABLE m8.LegacyItems');}
});
test('JSON encoding cannot publish a protected value or credential-shaped field',async t=>{
  const value=`synthetic-"${randomUUID()}\\tail`;
  for(const field of ['Label','Password']){
    const op=operation('json',{sql:`SELECT (SELECT @value AS [${field}] FOR JSON PATH) AS Payload`,parameters:[param('value','nvarchar',{length:100})],extract:[output('payload','string','Payload')]});
    const f=live(t,[op],{values:[['value','protected:source','sensitive','string']],runtime:{resolveSensitive:()=>value}});
    const result=await f.call();assert.equal(result.outputs.length,0);assert.equal(f.runtime.finish().status,'NEEDS_REVIEW');assert(!f.allText().includes(value));
  }
  const publicOp=operation('json-public',{sql:'SELECT (SELECT @value AS Label FOR JSON PATH) AS Payload',parameters:[param('value','nvarchar',{length:100})],extract:[output('payload','string','Payload')]});
  const control=live(t,[publicOp],{values:[['value','public synthetic text']]});const a=await control.call();assert.deepEqual(JSON.parse(a.outputs[0].value),[{Label:'public synthetic text'}]);assert.equal(control.runtime.finish().status,'PASS');
});
test('native datetime2 sub-millisecond precision survives normalization and assertions',async t=>{
  for(const expected of ['2025-01-02T03:04:05.0067890Z','2025-01-02T03:04:05.006Z']){
    const op=operation('time',{sql:"SELECT CAST('2025-01-02T03:04:05.0067890' AS datetime2(7)) AS Moment",checks:[check('instant','rows',expected,[0,'Moment'])],extract:[output('instant','string','Moment')]}),f=live(t,[op]);
    const a=await f.call();assert.equal(a.outputs[0].value,'2025-01-02T03:04:05.0067890Z');assert.equal(f.runtime.finish().status,expected.endsWith('7890Z')?'PASS':'FAIL');
  }
});
test('an ordinary binary column cannot masquerade as a restoration version',async t=>{
  await admin.request().query("CREATE TABLE m8.GuardItems(Id int PRIMARY KEY, Label nvarchar(100), Ordinary binary(8)); INSERT m8.GuardItems VALUES(1,N'original',0x0102030405060708)");
  try {
    const change=operation('change',{sql:'UPDATE m8.GuardItems SET Label=@label OUTPUT INSERTED.Id,INSERTED.Ordinary WHERE Id=@recordId',parameters:[param('label','nvarchar',{length:100}),param('recordId')],checks:[check('changed','affectedRows')],affectedRows:{min:1,max:1},extract:[output(),output('revision','string','Ordinary')]});
    const restore=operation('restore',{sql:'UPDATE m8.GuardItems SET Label=@original WHERE Id=@recordId AND Ordinary=@revision',parameters:[param('original','nvarchar',{length:100}),param('recordId'),param('revision','varbinary',{length:8})],restorationGuard:{identityParameter:'recordId',versionParameter:'revision'},checks:[check('restored','affectedRows')],affectedRows:{min:1,max:1}});
    const f=live(t,[change,restore],{values:[['recordId',1],['label','temporary'],['original','original']]}),changed=await f.call(change,{resource:{id:'row',output:'recordId',ownership:'existing',intent:'restore'}});
    await admin.request().query("UPDATE m8.GuardItems SET Label=N'concurrent' WHERE Id=1");
    const a=await f.call(restore,{phase:'RESTORE',inputs:[...changed.outputs,f.run.inputs.values[2]],lifecycle:{resourceId:'row'}});
    assert.equal(a.effect.certainty,'not-executed');assert.equal(f.runtime.finish().status,'NEEDS_REVIEW');assert.equal((await admin.request().query('SELECT Label FROM m8.GuardItems WHERE Id=1')).recordset[0].Label,'concurrent');
  } finally {await admin.request().query('DROP TABLE m8.GuardItems');}
});
test('protected JSON member names are screened in outputs and assertion evidence',async t=>{
  const value=`synthetic-"${randomUUID()}\\key`,text=`SELECT CONCAT(N'{"',STRING_ESCAPE(@value,'json'),N'":"public"}') AS Payload`;
  const op=operation('member',{sql:text,parameters:[param('value','nvarchar',{length:100})],checks:[check('observed','rows','different',[0,'Payload'])],extract:[output('payload','string','Payload')]}),f=live(t,[op],{values:[['value','protected:member','sensitive','string']],runtime:{resolveSensitive:()=>value}});
  const a=await f.call();assert.equal(a.outputs.length,0);assert.equal(f.runtime.finish().status,'FAIL');
  assert(f.allText().includes('[REDACTED OR UNAVAILABLE]'));assert(!f.allText().includes('\\\\key'));
});
test('shared temporary tables are outside runtime scope in fixed and dynamic definitions',async t=>{
  await admin.request().query('CREATE TABLE ##HarnessM8ScopeProof(Id int); INSERT ##HarnessM8ScopeProof VALUES(1)');
  try {
    // Confirm the real server fixture's shared visibility; runtime policy must supply the exclusion.
    const shared=await executeSqlServer(target,JSON.parse(process.env.M8_DB_CREDENTIAL),{text:'SELECT Id FROM [##HarnessM8ScopeProof]',parameters:[]},{signal:new AbortController().signal,timeoutMs:3000,maxRows:10,maxResponseBytes:1024});
    assert.equal(shared.rows[0].Id,1);
    for(const text of ['SELECT Id FROM [##HarnessM8ScopeProof]','SELECT Id FROM "##HarnessM8ScopeProof"'])assert.throws(()=>operation('fixed',{sql:text}));
    const op=operation('dynamic',{sql:'SELECT Id FROM {{table}}',identifiers:{table:{input:'table',allowed:['##HarnessM8ScopeProof']}}}),f=live(t,[op],{mode:'protected',values:[['table','##HarnessM8ScopeProof']]});
    const a=await f.call();assert.equal(a.effect.certainty,'not-executed');assert.equal(f.runtime.finish().status,'BLOCKED');
  } finally {await admin.request().query('DROP TABLE ##HarnessM8ScopeProof');}
});
