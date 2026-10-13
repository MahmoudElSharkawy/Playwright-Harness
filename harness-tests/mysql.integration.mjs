import test, {before, after, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer, connect} from 'node:net';
import {setTimeout as pause} from 'node:timers/promises';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import mysql from 'mysql2/promise';
import {fixture, operation, param, output, check} from './fixtures/database.mjs';
import {fixture as sequentialFixture} from './fixtures/sequential.mjs';
import {operation as api} from './fixtures/api.mjs';
import {defineOperation} from '../scripts/lib/execution-core/index.mjs';

const target = JSON.parse(process.env.HARNESS_MYSQL_TARGET ?? 'null');
assert(target?.engine === 'mysql', 'Run through the disposable MySQL probe.');
const config = JSON.parse(process.env.HARNESS_MYSQL_ADMIN), credential = JSON.parse(process.env.MYSQL_DB_CREDENTIAL);
let admin, application;
before(async () => {
  try {
    admin = await mysql.createConnection(config);
    application = await mysql.createConnection({...config, ...credential});
  } catch {throw new Error('MYSQL_FIXTURE_CONNECTION');}
});
after(async () => {await application?.end(); await admin?.end();});
beforeEach(async () => {for (const table of ['Items','HugeIds','Typed','UniqueItems']) await admin.query(`DELETE FROM ${table}`);});
const op = (name, definition = {}) => operation(name, {engine: 'mysql', sql: 'SELECT 1 AS Id', ...definition});
const live = (t, definitions, settings = {}) => fixture(t, definitions, {...settings, target: {...target, ...settings.target}});
const generatedId = () => ({name: 'recordId', type: 'string', sensitivity: 'public', select: {from: 'insertId', path: []}});
const temporary = {id: 'row', output: 'recordId', ownership: 'harness', intent: 'temporary'};
const insert = (name = 'seed') => op(name, {sql: 'INSERT INTO Items (Label) VALUES (?)', parameters: [param('label','varchar',{length:500})],
  checks: [check(`${name}-created`,'affectedRows'), check(`${name}-no-rows`,'rowCount',0)], affectedRows: {min:1,max:1}, extract: [generatedId()]});
const clean = (name = 'clean') => op(name, {sql: 'DELETE FROM Items WHERE Id=?', parameters: [param('recordId','unsigned bigint')],
  checks: [check(`${name}-removed`,'affectedRows')], affectedRows: {min:1,max:1}});
const rows = async () => (await admin.execute('SELECT Id,Label FROM Items ORDER BY Id'))[0];

test('real MySQL prepared CRUD preserves injection-shaped values and exact generated identities through cleanup', async t => {
  const label = "'); DELETE FROM Items; -- \\ ' قيمة", changed = 'updated قيمة';
  const seed = insert(), remove = clean();
  const read = op('read', {sql: 'SELECT Id,Label FROM {{table}} WHERE Id=?', identifiers: {table: {input:'table', allowed:['Items']}},
    parameters: [param('recordId','unsigned bigint')], checks: [check('literal','rows',{$input:'label'},[0,'Label'])]});
  const update = op('update', {sql: 'UPDATE Items SET Label=? WHERE Id=?', parameters: [param('changed','text',{length:500}),param('recordId','unsigned bigint')],
    checks: [check('updated','affectedRows')], affectedRows: {min:1,max:1}});
  const verify = op('verify', {sql: 'SELECT Label FROM Items WHERE Id=?', parameters: [param('recordId','unsigned bigint')], checks: [check('changed-value','rows',{$input:'changed'},[0,'Label'])]});
  const f = live(t,[seed,read,update,verify,remove],{values:[['label',label],['changed',changed],['table','Items']]});
  const created = await f.call(seed,{phase:'SETUP',resource:temporary}), identity = created.outputs[0];
  assert.equal(created.outcome,'SUCCESS'); assert.equal(identity.type,'string'); assert(BigInt(identity.value) > BigInt(Number.MAX_SAFE_INTEGER));
  const inputs = [identity,...f.run.inputs.values];
  await f.call(read,{inputs}); await f.call(update,{inputs}); await f.call(verify,{phase:'VERIFY',inputs});
  await f.call(remove,{phase:'CLEANUP',inputs:[identity],lifecycle:{resourceId:'row'}});
  const result = f.runtime.finish(); assert.equal(result.status,'PASS'); assert.equal(result.scenarios[0].requiredLifecycleComplete,true); assert.equal((await rows()).length,0);
});

test('real MySQL generated identities above signed bigint remain exact through owned cleanup', async t => {
  const seed = op('huge-seed',{sql:'INSERT INTO HugeIds (Label) VALUES (?)',parameters:[param('label','varchar',{length:100})],
    checks:[check('huge-created','affectedRows'),check('huge-no-rows','rowCount',0)],extract:[generatedId()]});
  const remove = op('huge-clean',{sql:'DELETE FROM HugeIds WHERE Id=?',parameters:[param('recordId','unsigned bigint')],checks:[check('huge-cleaned','affectedRows')],affectedRows:{min:1,max:1}});
  const f = live(t,[seed,remove],{values:[['label','unsigned identity']]});
  const created = await f.call(seed,{resource:temporary}); assert.equal(created.outcome,'SUCCESS');
  const identity = created.outputs[0]; assert.equal(identity.value,'9223372036854775808');
  await f.call(remove,{phase:'CLEANUP',inputs:[identity],lifecycle:{resourceId:'row'}});
  const result = f.runtime.finish(); assert.equal(result.status,'PASS'); assert.equal(result.scenarios[0].requiredLifecycleComplete,true);
  assert.equal((await admin.query('SELECT Id FROM HugeIds'))[0].length,0);
});

test('real MySQL explicitly supplied identities never become generated insertId outputs', async t => {
  const supplied = op('supplied-id',{sql:'INSERT INTO HugeIds (Id,Label) VALUES (?,?)',parameters:[param('id','unsigned bigint'),param('label','varchar',{length:100})],
    checks:[check('supplied-created','affectedRows')],extract:[generatedId()]});
  t.after(()=>admin.execute('DELETE FROM HugeIds WHERE Id=?',['7']));
  const f = live(t,[supplied],{values:[['id','7'],['label','explicit identity']]}); const attempted = await f.call();
  assert.equal(attempted.effect.certainty,'confirmed'); assert.equal(attempted.outputs.length,0); assert.equal(f.runtime.finish().status,'NEEDS_REVIEW');
  const [[row]] = await admin.execute('SELECT Id FROM HugeIds WHERE Id=?',['7']); assert.equal(row.Id,'7');
});

test('real MySQL UPDATE affectedRows counts matched rows even when their values do not change', async t => {
  await admin.execute('INSERT INTO Items (Id,Label) VALUES (?,?)',[1,'unchanged']);
  const change = op('unchanged', {sql: 'UPDATE Items SET Label=? WHERE Id=?', parameters: [param('label','text',{length:50}),param('id','int')],
    checks: [check('matched','affectedRows',1),check('returned','rowCount',0)], affectedRows:{min:1,max:1}});
  const f = live(t,[change],{values:[['label','unchanged'],['id',1]]}); const attempted = await f.call();
  assert.equal(attempted.effect.affectedRows.actual,1); assert.equal(f.runtime.finish().status,'PASS');
  const [native] = await admin.execute('UPDATE Items SET Label=? WHERE Id=?',['unchanged',1]);
  assert.equal(native.affectedRows,1); assert.equal(native.changedRows,0);
});

test('real MySQL values retain exact numerics, Unicode, binary, JSON, null and microsecond temporals', async t => {
  const values = [['id',1],['signed','9223372036854775807'],['unsigned','18446744073709551615'],['amount','12345678901234567890123456.7890'],['flag',true],['ratio',1.25],
    ['label','قيمة 🚀'],['bodyText','literal \\ and apostrophe \u0027'],['bytes','00ff'],['day','2026-01-02'],['moment','2026-01-02T03:04:05.123456'],
    ['stamp','2026-01-02T03:04:05.123456Z'],['document',{word:'قيمة',nested:[null,true]}],['nullable',null]];
  const seed = op('typed-seed', {sql: 'INSERT INTO Typed (Id,SignedValue,UnsignedValue,Amount,Flag,Ratio,Label,BodyText,Bytes,Day,Moment,Stamp,Document,NullableValue) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    parameters: [param('id','int'),param('signed','bigint'),param('unsigned','unsigned bigint'),param('amount','decimal',{precision:30,scale:4}),param('flag','boolean'),param('ratio','double'),
      param('label','varchar',{length:100}),param('bodyText','text',{length:100}),param('bytes','varbinary',{length:10}),param('day','date'),param('moment','datetime'),param('stamp','timestamp'),param('document','json',{length:500}),param('nullable','varchar',{length:50})],
    checks: [check('typed-insert','affectedRows')]});
  const f = live(t,[seed],{values}); await f.call(); assert.equal(f.runtime.finish().status,'PASS');
  const [[native]] = await admin.execute('SELECT Document FROM Typed WHERE Id=1'); assert.equal(typeof native.Document,'string');
  const expected = {Id:1,SignedValue:values[1][1],UnsignedValue:values[2][1],Amount:values[3][1],Flag:1,Ratio:1.25,Label:values[6][1],BodyText:values[7][1],
    Bytes:'00ff',Day:values[9][1],Moment:values[10][1],Stamp:values[11][1],Document:native.Document,NullableValue:null};
  const read = op('typed-read', {sql: 'SELECT Id,SignedValue,UnsignedValue,Amount,Flag,Ratio,Label,BodyText,Bytes,Day,Moment,Stamp,Document,NullableValue FROM Typed WHERE Id=1',
    checks: Object.entries(expected).map(([name,value])=>check(`value-${name}`,'rows',value,[0,name])), extract:[output('nullableValue','null','NullableValue')]});
  const observed = live(t,[read]); const attempted = await observed.call(); assert.equal(attempted.outputs[0].value,null); assert.equal(observed.runtime.finish().status,'PASS');
  await admin.execute('UPDATE Typed SET Document=? WHERE Id=1',['{"wide":9007199254740993}']);
  const exactJson = op('exact-json', {sql:'SELECT Document FROM Typed WHERE Id=1',checks:[check('json-precision','rows','{"wide": 9007199254740993}',[0,'Document'])]});
  const json = live(t,[exactJson]); await json.call(); assert.equal(json.runtime.finish().status,'PASS');
});

test('a truncated MySQL temporal expectation fails without discarding server microseconds', async t => {
  await admin.execute('INSERT INTO Typed (Id,Moment) VALUES (?,?)',[1,'2026-01-02 03:04:05.123456']);
  const read = op('precision', {sql:'SELECT Moment FROM Typed',checks:[check('microseconds','rows','2026-01-02T03:04:05.123',[0,'Moment'])]});
  const f = live(t,[read]); await f.call(); assert.equal(f.runtime.finish().status,'FAIL');
});

test('real MySQL strict mode rejects invalid calendar and zero dates without persisting rows', async t => {
  for (const value of ['2026-02-30','2026-00-00']) {
    const invalid = op('invalid-day',{sql:'INSERT INTO Typed (Id,Day) VALUES (1,?)',parameters:[param('day','varchar',{length:10})],checks:[check('inserted','affectedRows')]});
    const f = live(t,[invalid],{values:[['day',value]]}); const attempted = await f.call();
    assert.equal(attempted.failureClass,'EXECUTOR'); assert.equal(attempted.outcome,'INFRASTRUCTURE_FAILURE'); assert.equal(f.runtime.finish().status,'NEEDS_REVIEW');
    assert.equal((await admin.query('SELECT Id FROM Typed'))[0].length,0);
  }
});

test('real MySQL refuses previously persisted invalid dates without exposing a successful output', async t => {
  const [[{mode}]] = await admin.query('SELECT @@SESSION.sql_mode AS mode');
  try {
    await admin.query("SET SESSION sql_mode='ALLOW_INVALID_DATES'");
    await admin.execute('INSERT INTO Typed (Id,Day) VALUES (?,?)',[1,'2026-02-30']);
  } finally {await admin.query('SET SESSION sql_mode=?',[mode]);}
  t.after(()=>admin.execute('DELETE FROM Typed WHERE Id=?',[1]));
  const [[stored]] = await admin.query('SELECT Day FROM Typed WHERE Id=1'); assert.equal(stored.Day,'2026-02-30');
  const read = op('invalid-persisted-day',{sql:'SELECT Day FROM Typed WHERE Id=1',extract:[output('day','string','Day')]});
  const f = live(t,[read]); const attempted = await f.call();
  assert.equal(attempted.failureClass,'EXECUTOR'); assert.equal(attempted.outputs.length,0); assert.equal(f.runtime.finish().status,'BLOCKED');
});

for (const [name, grant, revoke] of [
  ['table grant',"GRANT SELECT ON HarnessMysql.Items TO 'harness_runner'@'%'","REVOKE SELECT ON HarnessMysql.Items FROM 'harness_runner'@'%'"] ,
  ['column grant',"GRANT SELECT (Id) ON OutsideMysql.Items TO 'harness_runner'@'%'","REVOKE SELECT (Id) ON OutsideMysql.Items FROM 'harness_runner'@'%'"] ,
  ['cross-database grant',"GRANT SELECT ON OutsideMysql.* TO 'harness_runner'@'%'","REVOKE SELECT ON OutsideMysql.* FROM 'harness_runner'@'%'"] ,
  ['global privilege',"GRANT FILE ON *.* TO 'harness_runner'@'%'","REVOKE FILE ON *.* FROM 'harness_runner'@'%'"] ,
  ['grant option',"GRANT GRANT OPTION ON HarnessMysql.* TO 'harness_runner'@'%'","REVOKE GRANT OPTION ON HarnessMysql.* FROM 'harness_runner'@'%'"]
]) test(`real MySQL principal with ${name} is rejected before business dispatch`, async t => {
  await admin.query(grant); t.after(()=>admin.query(revoke));
  const f = live(t,[op('read')]); const attempted = await f.call();
  assert.equal(attempted.effect.certainty,'not-executed'); assert.equal(f.runtime.finish().status,'BLOCKED');
});

test('real MySQL applicable roles are refused even when the role is inactive', async t => {
  await admin.query("CREATE ROLE 'harness_role'"); t.after(async()=>{await admin.query("REVOKE 'harness_role' FROM 'harness_runner'@'%'"); await admin.query("DROP ROLE 'harness_role'");});
  await admin.query("GRANT 'harness_role' TO 'harness_runner'@'%'");
  const peer = await mysql.createConnection({...config,...credential});
  try {const [[row]] = await peer.query('SELECT CURRENT_ROLE() AS activeRole'); assert.equal(row.activeRole,'NONE');} finally {await peer.end();}
  const f = live(t,[op('read')]); const attempted = await f.call(); assert.equal(attempted.effect.certainty,'not-executed'); assert.equal(f.runtime.finish().status,'BLOCKED');
});

for (const [name, create, drop] of [
  ['view','CREATE VIEW FixtureView AS SELECT Id FROM Items','DROP VIEW FixtureView'],
  ['nontransactional table','CREATE TABLE FixtureMyisam (Id INT) ENGINE=MyISAM','DROP TABLE FixtureMyisam']
]) test(`real MySQL refuses a visible ${name} before business dispatch`, async t => {
  await admin.query(create); t.after(()=>admin.query(drop));
  const f = live(t,[op('read')]); const attempted = await f.call(); assert.equal(attempted.effect.certainty,'not-executed'); assert.equal(f.runtime.finish().status,'BLOCKED');
});

test('real MySQL refuses administrative credentials and wrong passwords without native diagnostics', async t => {
  for (const auth of [{user:config.user,password:config.password},{...credential,password:randomUUID()}]) {
    const f = live(t,[op('read')],{runtime:{resolveCredential:()=>auth}}); const attempted = await f.call();
    assert.equal(attempted.effect.certainty,'not-executed'); assert.equal(f.runtime.finish().status,'BLOCKED');
    assert(!f.allText().includes(auth.password)); assert(!f.allText().includes('Access denied'));
  }
});

test('real MySQL TLS rejects a trusted certificate with the wrong hostname and allows explicit fixture trust', async t => {
  const ca = readFileSync(process.env.HARNESS_MYSQL_CA_PATH);
  const native = await mysql.createConnection({...config,...credential,host:'localhost',ssl:{ca,rejectUnauthorized:true,verifyIdentity:false}});
  try {const [[row]] = await native.execute('SELECT 1 AS alive'); assert.equal(row.alive,1);} finally {await native.end();}
  const verified = live(t,[op('verified')],{target:{server:'localhost',encrypt:true}}); const rejected = await verified.call();
  assert.equal(rejected.effect.certainty,'not-executed'); assert.equal(verified.runtime.finish().status,'BLOCKED');
  const fixtureTrust = live(t,[op('fixture-trust')],{target:{encrypt:true,trustServerCertificate:true}}); await fixtureTrust.call(); assert.equal(fixtureTrust.runtime.finish().status,'PASS');
});

test('native MySQL grants block out-of-scope reads without exposing native permission errors', async t => {
  const f = live(t,[op('outside',{sql:'SELECT Id FROM OutsideMysql.Items'})]); const attempted = await f.call();
  assert.equal(attempted.outputs.length,0); assert.equal(f.runtime.finish().status,'BLOCKED'); assert(!f.allText().includes('SELECT command denied'));
});

for (const [name, sql, limits] of [
  ['rows','SELECT 1 AS Id UNION ALL SELECT 2 AS Id UNION ALL SELECT 3 AS Id',{maxRows:2}],
  ['bytes',"SELECT 'a synthetic result larger than the byte limit' AS Label",{maxResponseBytes:10}],
  ['unsupported type','SELECT Bits FROM ProbeBits',{}],
  ['duplicate columns','SELECT 1 AS Id,2 AS Id',{}],
  ['unsafe column','SELECT 1 AS `__proto__`',{}]
]) test(`real MySQL ${name} refusal never returns partial success`, async t => {
  const f = live(t,[op('read',{sql,...limits,extract:[output()]})]); const attempted = await f.call();
  assert.equal(attempted.outcome,'INFRASTRUCTURE_FAILURE'); assert.equal(attempted.outputs.length,0); assert.equal(f.runtime.finish().status,'BLOCKED');
});

test('protected MySQL values and JSON member names cannot escape through public outputs', async t => {
  const confidential = randomUUID();
  const first = op('first',{sql:'SELECT ? AS Label',parameters:[param('value','text',{length:100})],extract:[output('captured','string','Label','sensitive')]});
  const second = op('second',{sql:"SELECT JSON_OBJECT(?,'public') AS Label",parameters:[param('value','text',{length:100})],extract:[output('copy','string','Label')]});
  const f = live(t,[first,second],{values:[['value','protected:input','sensitive','string']],runtime:{resolveSensitive:()=>confidential,storeSensitive:()=> 'protected:captured'}});
  await f.call(first); const attempted = await f.call(second); assert.equal(attempted.outputs.length,0); assert.equal(f.runtime.finish().status,'NEEDS_REVIEW'); assert(!f.allText().includes(confidential));
});

test('native MySQL duplicate-value errors are normalized without leaking the protected value', async t => {
  const confidential = randomUUID(); await admin.execute('INSERT INTO UniqueItems (Label) VALUES (?)',[confidential]);
  const duplicate = op('duplicate',{sql:'INSERT INTO UniqueItems (Label) VALUES (?)',parameters:[param('value','text',{length:100})],checks:[check('inserted','affectedRows')]});
  const f = live(t,[duplicate],{values:[['value','protected:input','sensitive','string']],runtime:{resolveSensitive:()=>confidential}}); const attempted = await f.call();
  assert.equal(attempted.failureClass,'EXECUTOR'); assert.equal(attempted.effect.certainty,'uncertain'); assert.equal(f.runtime.finish().status,'NEEDS_REVIEW');
  assert(!f.allText().includes(confidential)); assert(!f.allText().includes('Duplicate entry'));
});

test('MySQL cancellation and unsupported RESTORE fail before resolving credentials', async t => {
  for (const restore of [false,true]) {
    let resolutions = 0; const controller = new AbortController(); if (!restore) controller.abort();
    const change = op('change',{sql:"UPDATE Items SET Label='unused' WHERE Id=1",checks:[check('changed','affectedRows')]});
    const f = live(t,[change],{runtime:{signal:controller.signal,resolveCredential:()=>{resolutions++; return credential;}}});
    const attempted = await f.call(change,restore?{phase:'RESTORE'}:{}); assert.equal(attempted.effect.certainty,'not-executed'); assert.equal(resolutions,0); assert.equal(f.runtime.finish().status,'BLOCKED');
  }
});

async function lock(t) {
  await admin.execute('INSERT INTO Items (Id,Label) VALUES (?,?)',[1,'initial']);
  const blocker = await mysql.createConnection(config); await blocker.beginTransaction(); await blocker.execute('UPDATE Items SET Label=Label WHERE Id=1');
  let released = false; const release = async () => {if (!released) {released = true; await blocker.rollback(); await blocker.end();}}; t.after(release); return release;
}
async function waitForLock() {
  for (let i=0;i<150;i++) {
    const [waiting] = await admin.query("SELECT 1 FROM information_schema.INNODB_TRX t JOIN information_schema.PROCESSLIST p ON p.ID=t.trx_mysql_thread_id WHERE p.USER='harness_runner' AND t.trx_state='LOCK WAIT'");
    if (waiting.length) return; await pause(20);
  }
  throw new Error('Expected real MySQL lock wait was not observed.');
}
for (const cancel of [false,true]) test(`real MySQL mutation ${cancel?'cancellation':'timeout'} stays uncertain without replay`, async t => {
  const release = await lock(t), controller = new AbortController();
  const change = op('change',{sql:'UPDATE Items SET Label=? WHERE Id=1',parameters:[param('label','text',{length:100})],checks:[check('changed','affectedRows')],timeoutMs:cancel?5000:1500});
  const f = live(t,[change],{values:[['label','changed']],runtime:{signal:controller.signal}}), pending = f.call();
  await waitForLock(); if (cancel) controller.abort(); const attempted = await pending; await release();
  assert.equal(attempted.effect.certainty,'uncertain'); assert.equal(attempted.failureClass,cancel?'CANCELLED':'TIMEOUT');
  const result = f.runtime.finish(); assert.equal(result.status,'NEEDS_REVIEW'); assert.equal(result.scenarios[0].attempts.length,1); assert.equal((await rows())[0].Label,'initial');
});

test('required MySQL cleanup still uses its captured identity after cancellation', async t => {
  const controller = new AbortController(), seed = insert(), remove = clean();
  const f = live(t,[seed,remove],{values:[['label','synthetic']],runtime:{signal:controller.signal}});
  const created = await f.call(seed,{resource:temporary}); controller.abort();
  await f.call(remove,{phase:'CLEANUP',inputs:[created.outputs[0]],lifecycle:{resourceId:'row'}});
  assert.equal(f.runtime.finish().status,'PASS'); assert.equal((await rows()).length,0);
});

test('losing a real MySQL COMMIT reply preserves an actually committed write as uncertain without replay', async t => {
  const sockets = new Set(); let commitCount = 0, observedCommit = false;
  const proxy = createServer(front => {
    const back = connect({host:target.server,port:target.port}); sockets.add(front); sockets.add(back);
    let preparingCommit = false, commitStatement, awaitingCommit = false;
    function relay(source,destination,observe) {
      let pending = Buffer.alloc(0);
      source.on('data',chunk=>{
        pending = Buffer.concat([pending,chunk]);
        while (pending.length >= 4 && pending.length >= pending.readUIntLE(0,3)+4) {
          const length = pending.readUIntLE(0,3)+4, packet = pending.subarray(0,length); pending = pending.subarray(length);
          if (observe(packet.subarray(4),packet[3]) !== false) destination.write(packet);
        }
      });
    }
    relay(front,back,(body,sequence)=>{
      if (sequence !== 0) return;
      if ([0x03,0x16].includes(body[0]) && /^COMMIT\s*;?$/i.test(body.subarray(1).toString())) {
        if (body[0] === 0x16) preparingCommit = true; else {awaitingCommit = true; commitCount++;}
      } else if (body[0] === 0x17 && body.length >= 5 && body.readUInt32LE(1) === commitStatement) {awaitingCommit = true; commitCount++;}
    });
    relay(back,front,(body,sequence)=>{
      if (sequence === 1 && body[0] === 0x00 && awaitingCommit) {observedCommit = true; front.destroy(); back.destroy(); return false;}
      if (sequence === 1 && body[0] === 0x00 && preparingCommit) {commitStatement = body.readUInt32LE(1); preparingCommit = false;}
    });
    for (const socket of [front,back]) {socket.on('error',()=>{}); socket.on('close',()=>{sockets.delete(socket); front.destroy(); back.destroy();});}
  });
  await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{for (const socket of sockets) socket.destroy(); await new Promise(resolve=>proxy.close(resolve));});
  const seed = insert(), f = live(t,[seed],{target:{server:'127.0.0.1',port:proxy.address().port},values:[['label','committed']]});
  const attempted = await f.call(); assert.equal(observedCommit,true); assert.equal(commitCount,1); assert.equal(attempted.effect.certainty,'uncertain');
  const result = f.runtime.finish(); assert.equal(result.status,'NEEDS_REVIEW'); assert.equal(result.scenarios[0].attempts.length,1); assert.equal((await rows()).length,1);
});

test('real MySQL setup -> native browser/API change -> API verification -> generated-identity MySQL cleanup', async t => {
  const seed = insert(), remove = clean();
  const verify = api('api-verify',{request:{method:'GET',path:'/items/{recordId}'},checks:[{id:'api-label',select:{from:'json',path:['label']},equals:{$input:'label'}}]});
  const ui = defineOperation({id:'ui-edit',family:'browser',target:'ui',capability:'browserMutations',source:{kind:'helper',reference:'synthetic-mysql-ui',version:'1'},definition:{intent:'Change the MySQL fixture label through the UI'}});
  const f = await sequentialFixture(t,[{operation:seed,phase:'SETUP'},{operation:ui,phase:'EXERCISE',checks:[{id:'ui-saved'}]},
    {operation:verify,phase:'VERIFY'},{operation:remove,phase:'CLEANUP'}],{target,browser:true,values:[['initial','initial'],['label','changed from UI']],
    handler:async ({res,request,reply})=>{
      const url = new URL(request.path,'http://fixture.test');
      if (url.pathname === '/ui') {
        res.writeHead(200,{'content-type':'text/html'});
        res.end(`<!doctype html><title>Synthetic MySQL fixture</title><label>Record<input id="record"></label><label>Label<input id="label"></label><button id="save">Save</button><div id="status"></div><script>document.querySelector('#save').onclick=async()=>{const response=await fetch('/items/'+document.querySelector('#record').value,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({label:document.querySelector('#label').value})});document.querySelector('#status').textContent=response.ok?'saved':'failed';};</script>`); return;
      }
      const identity = url.pathname.split('/')[2];
      if (request.method === 'PATCH') {await application.execute('UPDATE Items SET Label=? WHERE Id=?',[request.body.label,identity]); reply(200,{id:identity}); return;}
      if (request.method === 'GET') {const [[item]] = await application.execute('SELECT Id,Label FROM Items WHERE Id=?',[identity]); reply(item?200:404,item?{id:item.Id,label:item.Label}:{absent:true}); return;}
      reply(404);
    }});
  const identity = ctx=>ctx.resource('row').outputs.find(value=>value.name==='recordId'), options = operation=>({operation,invocationId:operation.id});
  const result = await f.start({
    setup:ctx=>ctx.database.execute({...options(seed),inputs:[{...ctx.value('initial'),name:'label'}],resource:temporary}),
    exercise:ctx=>ctx.browser.attempt({...options(ui),inputs:[identity(ctx),ctx.value('label')]},async browser=>{
      await browser.native(['goto',`${f.origin}/ui`]); await browser.native(['snapshot','--filename=page.yml']);
      await browser.artifact('snapshot','page.yml',bytes=>Buffer.from(bytes.toString().replaceAll(f.origin,'http://fixture.test')));
      await browser.native(['fill','#record',identity(ctx).value]); await browser.native(['fill','#label',ctx.value('label').value]); await browser.native(['click','#save']);
      const actual = JSON.parse((await browser.native(['run-code','async page => {await page.locator("#status").filter({hasText:"saved"}).waitFor(); return await page.locator("#status").textContent();}'])).result);
      const proof = await browser.evidence('observation',{actual,expected:'saved'});
      browser.assertion({id:'ui-saved',status:actual==='saved'?'PASS':'FAIL',reliable:true,evidenceIds:[proof]}); browser.effect({certainty:'confirmed',resourceIds:['row']});
    }),
    verify:ctx=>ctx.api.execute({...options(verify),inputs:[identity(ctx),ctx.value('label')]}),
    cleanup:ctx=>ctx.database.execute({...options(remove),inputs:[identity(ctx)],lifecycle:{resourceId:'row'}})
  });
  assert.equal(result.status,'PASS'); assert.equal(result.scenarios[0].requiredLifecycleComplete,true); assert.equal((await rows()).length,0);
  assert(result.evidence.some(item=>item.kind==='snapshot')); assert(result.scenarios[0].attempts.some(item=>item.identity.operationId===ui.id));
  assert.equal(existsSync(join(f.roots.runRoot,'protected')),false);
});
