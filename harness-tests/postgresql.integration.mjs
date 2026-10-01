import test, {before, after, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {createServer, connect} from 'node:net';
import {setTimeout as pause} from 'node:timers/promises';
import {fixture, operation, param, output, check} from './fixtures/database.mjs';

const target = JSON.parse(process.env.HARNESS_M10_TARGET ?? 'null');
assert(target?.engine === 'postgresql', 'Run through the disposable PostgreSQL probe.');
let admin;
before(async () => {admin = new pg.Client(JSON.parse(process.env.HARNESS_M10_ADMIN)); await admin.connect();});
after(async () => {await admin?.end();});
beforeEach(async () => {await admin.query('DELETE FROM m10."Items"');});
const op = (name, d = {}) => operation(name,{engine:'postgresql',sql:'SELECT 1 AS "Id"',...d});
const live = (t, definitions, settings = {}) => fixture(t,definitions,{target,...settings});

test('real PostgreSQL native parameter binding executes and returns neutral typed results', async t => {
  const read=op('read',{sql:'SELECT $1::integer AS "Id"',parameters:[param('recordId','integer')],extract:[output()]});
  const f=live(t,[read],{values:[['recordId',7]]}); const attempt=await f.call();
  assert.equal(attempt.outcome,'SUCCESS'); assert.equal(attempt.outputs[0].value,7); assert.equal(f.runtime.finish().status,'PASS');
});

test('real injection-shaped values remain values and dynamic identifiers stay allowlisted',async t=>{
  const text="'); DELETE FROM m10.\"Items\"; --",seed=op('seed',{sql:'INSERT INTO m10."Items" ("Id","Label") VALUES ($1,$2) RETURNING "Id"',parameters:[param('id','integer'),param('label','text',{length:500})],checks:[check('inserted','affectedRows')]});
  const read=op('read',{sql:'SELECT "Label" FROM m10.{{table}} WHERE "Id"=$1',identifiers:{table:{input:'table',allowed:['Items']}},parameters:[param('id','integer')],checks:[check('literal','rows',{$input:'label'},[0,'Label'])]});
  const f=live(t,[seed,read],{values:[['id',1],['label',text],['table','Items']]});await f.call(seed);await f.call(read);assert.equal(f.runtime.finish().status,'PASS');assert.equal((await admin.query('SELECT * FROM m10."Items"')).rows.length,1);
});
test('real PostgreSQL parameters preserve numeric, binary, UUID, Unicode, JSON and microsecond values',async t=>{
  const values=[['n','12345678901234567890123456.7890'],['large','9223372036854775807'],['flag',true],['moment','2026-01-02T03:04:05.123456Z'],['bytes','00ff'],['identity','123e4567-e89b-12d3-a456-426614174000'],['text','قيمة'],['document',{sample:1}]];
  const read=op('types',{sql:'SELECT $1::numeric AS n,$2::bigint AS large,$3::boolean AS flag,$4::timestamptz AS moment,$5::bytea AS bytes,$6::uuid AS identity,$7::text AS text,$8::jsonb AS document',
    parameters:[param('n','numeric',{precision:30,scale:4}),param('large','bigint'),param('flag','boolean'),param('moment','timestamptz'),param('bytes','bytea',{length:2}),param('identity','uuid'),param('text','text',{length:100}),param('document','jsonb',{length:100})],
    checks:values.map(([name,value])=>check(name,'rows',name==='document'?'{"sample": 1}':value,[0,name]))});
  const f=live(t,[read],{values});await f.call();assert.equal(f.runtime.finish().status,'PASS');
});
test('a truncated temporal expectation reliably fails instead of losing native microseconds',async t=>{
  const read=op('precision',{sql:"SELECT TIMESTAMPTZ '2026-01-02T03:04:05.123456Z' AS moment",checks:[check('moment','rows','2026-01-02T03:04:05.123Z',[0,'moment'])]});
  const f=live(t,[read]);await f.call();assert.equal(f.runtime.finish().status,'FAIL');
});
test('read-only capability is enforced by the server even for an owner-defined mutating function',async t=>{
  await admin.query('INSERT INTO m10."Items" VALUES (1,\'initial\')');
  await admin.query('CREATE FUNCTION m10.try_write() RETURNS integer LANGUAGE plpgsql AS $$ BEGIN UPDATE m10."Items" SET "Label"=\'changed\'; RETURN 1; END $$');t.after(()=>admin.query('DROP FUNCTION m10.try_write()'));
  const read=op('read',{sql:'SELECT m10.try_write() AS "Id"'}),f=live(t,[read],{mode:'protected'});const attempted=await f.call();
  assert.equal(attempted.failureClass,'EXECUTOR');assert.equal(attempted.effect.certainty,'none');assert.equal(f.runtime.finish().status,'BLOCKED');assert.equal((await admin.query('SELECT "Label" FROM m10."Items"')).rows[0].Label,'initial');
});
test('server read-only mode also refuses sequence advancement through SELECT',async t=>{
  await admin.query('CREATE SEQUENCE m10.fixture_sequence');await admin.query('GRANT USAGE,SELECT ON SEQUENCE m10.fixture_sequence TO harness_runner');t.after(()=>admin.query('DROP SEQUENCE m10.fixture_sequence'));
  const read=op('read',{sql:"SELECT nextval('m10.fixture_sequence') AS value"}),f=live(t,[read]);await f.call();assert.equal(f.runtime.finish().status,'BLOCKED');
  assert.equal((await admin.query('SELECT is_called FROM m10.fixture_sequence')).rows[0].is_called,false);
});
test('broad roles and ambient type-parser overrides cannot bypass principal checks',async t=>{
  const config=JSON.parse(process.env.HARNESS_M10_ADMIN),read=op('read'),original=pg.types.getTypeParser(16);
  pg.types.setTypeParser(16,()=>true);t.after(()=>pg.types.setTypeParser(16,original));
  const f=live(t,[read],{runtime:{resolveCredential:()=>({user:config.user,password:config.password})}});const attempt=await f.call();assert.equal(attempt.effect.certainty,'not-executed');assert.equal(f.runtime.finish().status,'BLOCKED');
});
test('cross-schema column-only grants are detected before business dispatch',async t=>{
  await admin.query('GRANT USAGE ON SCHEMA public TO harness_runner');await admin.query('GRANT SELECT ("Id") ON public."OutsideScope" TO harness_runner');
  t.after(async()=>{await admin.query('REVOKE SELECT ("Id") ON public."OutsideScope" FROM harness_runner');await admin.query('REVOKE USAGE ON SCHEMA public FROM harness_runner');});
  const control=new pg.Client({host:target.server,port:target.port,database:target.database,...JSON.parse(process.env.M10_DB_CREDENTIAL),ssl:false});await control.connect();
  try{assert.equal((await control.query('SELECT "Id" FROM public."OutsideScope"')).rows[0].Id,1);}finally{await control.end();}
  const f=live(t,[op('read')]);const attempt=await f.call();assert.equal(attempt.effect.certainty,'not-executed');assert.equal(f.runtime.finish().status,'BLOCKED');
});
test('native schema permissions refuse an out-of-scope read without exposing diagnostics',async t=>{
  const read=op('outside',{sql:'SELECT "Id" FROM public."OutsideScope"'}),f=live(t,[read]);const attempt=await f.call();
  assert.equal(attempt.failureClass,'EXECUTOR');assert.equal(attempt.effect.certainty,'none');assert.equal(f.runtime.finish().status,'BLOCKED');assert(!f.allText().includes('permission denied'));
});
for(const [name,sql,limits] of [['rows','SELECT generate_series(1,10) AS "Id"',{maxRows:2}],['bytes',"SELECT repeat('synthetic-data',1000) AS \"Label\"",{maxResponseBytes:100}],['unsupported','SELECT ARRAY[1,2] AS value',{}],['duplicate','SELECT 1 AS "Id",2 AS "Id"',{}],['unsafe','SELECT 1 AS "__proto__"',{}]])test(`real ${name} result refusal never returns partial success`,async t=>{
  const f=live(t,[op('read',{sql,...limits})]);const attempt=await f.call();assert.equal(attempt.outcome,'INFRASTRUCTURE_FAILURE');assert.equal(attempt.outputs.length,0);assert.equal(f.runtime.finish().status,'BLOCKED');
});
test('protected values and JSON member names cannot escape through public PostgreSQL outputs',async t=>{
  const confidential=randomUUID(),first=op('first',{sql:'SELECT $1::text AS "Label"',parameters:[param('value','text',{length:100})],extract:[output('captured','string','Label','sensitive')]}),second=op('second',{sql:"SELECT jsonb_build_object($1::text,'public')::text AS \"Label\"",parameters:[param('value','text',{length:100})],extract:[output('copy','string','Label')]});
  const f=live(t,[first,second],{values:[['value','protected:input','sensitive','string']],runtime:{resolveSensitive:()=>confidential,storeSensitive:()=> 'protected:captured'}});
  await f.call(first);const attempted=await f.call(second);assert.equal(attempted.outputs.length,0);assert.equal(f.runtime.finish().status,'NEEDS_REVIEW');assert(!f.allText().includes(confidential));
});
test('confidential database errors are normalized without reproducing the native message',async t=>{
  const confidential=randomUUID();await admin.query(`CREATE FUNCTION m10.fixture_error() RETURNS integer LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '${confidential}'; END $$`);t.after(()=>admin.query('DROP FUNCTION m10.fixture_error()'));
  const f=live(t,[op('read',{sql:'SELECT m10.fixture_error() AS "Id"'})]);await f.call();assert.equal(f.runtime.finish().status,'BLOCKED');assert(!f.allText().includes(confidential));
});
async function lock(t) {
  await admin.query('INSERT INTO m10."Items" VALUES (1,\'initial\')');const blocker=new pg.Client(JSON.parse(process.env.HARNESS_M10_ADMIN));await blocker.connect();await blocker.query('BEGIN');await blocker.query('LOCK TABLE m10."Items" IN ACCESS EXCLUSIVE MODE');
  let released=false;const release=async()=>{if(!released){released=true;await blocker.query('ROLLBACK');await blocker.end();}};t.after(release);return release;
}
async function waitForLock() {
  for(let i=0;i<150;i++){if((await admin.query("SELECT 1 FROM pg_stat_activity WHERE application_name='playwright-pom-harness' AND wait_event_type='Lock'")).rows.length)return;await pause(20);}throw new Error('Expected real database lock wait was not observed.');
}
test('real read timeout recovers without resolving protected bindings again',async t=>{
  const release=await lock(t);let resolutions=0;
  const read=op('read',{sql:'SELECT "Id" FROM m10."Items" WHERE "Id"=$1',parameters:[param('id','integer')],timeoutMs:600}),f=live(t,[read],{values:[['id','protected:input','sensitive','number']],runtime:{resolveSensitive:()=>++resolutions}});
  const pending=f.call();await waitForLock();const timer=setTimeout(()=>release().catch(()=>{}),650);t.after(()=>clearTimeout(timer));await pending;
  const result=f.runtime.finish();assert.equal(result.status,'PASS');assert.equal(result.stability,'recovered');assert.equal(result.scenarios[0].attempts.length,2);assert.equal(resolutions,1);
});
for(const cancel of [false,true])test(`real PostgreSQL mutation ${cancel?'cancellation':'timeout'} remains uncertain and is never replayed`,async t=>{
  const release=await lock(t),controller=new AbortController(),change=op('change',{sql:'UPDATE m10."Items" SET "Label"=$1 WHERE "Id"=1',parameters:[param('label','text',{length:100})],checks:[check('changed','affectedRows')],timeoutMs:cancel?5000:500});
  const f=live(t,[change],{values:[['label','changed']],runtime:{signal:controller.signal}}),pending=f.call();if(cancel){await waitForLock();controller.abort();}
  const attempt=await pending;await release();assert.equal(attempt.effect.certainty,'uncertain');assert.equal(attempt.failureClass,cancel?'CANCELLED':'TIMEOUT');const result=f.runtime.finish();assert.equal(result.status,'NEEDS_REVIEW');assert.equal(result.scenarios[0].attempts.length,1);assert.equal((await admin.query('SELECT "Label" FROM m10."Items"')).rows[0].Label,'initial');
});
test('required PostgreSQL cleanup remains available after normal cancellation',async t=>{
  const controller=new AbortController(),seed=op('seed',{sql:'INSERT INTO m10."Items" ("Id","Label") VALUES (1,\'synthetic\') RETURNING "Id"',checks:[check('created','affectedRows')],extract:[output()]}),clean=op('clean',{sql:'DELETE FROM m10."Items" WHERE "Id"=$1',parameters:[param('recordId','integer')],checks:[check('cleaned','affectedRows')]});
  const f=live(t,[seed,clean],{runtime:{signal:controller.signal}}),created=await f.call(seed,{resource:{id:'row',output:'recordId',ownership:'harness',intent:'temporary'}});controller.abort();
  await f.call(clean,{phase:'CLEANUP',inputs:[created.outputs[0]],lifecycle:{resourceId:'row'}});assert.equal(f.runtime.finish().status,'PASS');assert.equal((await admin.query('SELECT * FROM m10."Items"')).rows.length,0);
});
test('a lost COMMIT reply preserves an actually committed mutation as uncertain without replay',async t=>{
  const sockets=new Set();let observedCommit=false;
  const proxy=createServer(front=>{const back=connect({host:target.server,port:target.port});sockets.add(front);sockets.add(back);let sent='',received='';
    front.on('data',chunk=>{sent=(sent+chunk.toString()).slice(-4096);back.write(chunk);});
    back.on('data',chunk=>{received=(received+chunk.toString()).slice(-4096);if(sent.includes('COMMIT')&&received.includes('COMMIT')){observedCommit=true;front.destroy();back.destroy();}else front.write(chunk);});
    for(const socket of [front,back]){socket.on('error',()=>{});socket.on('close',()=>{sockets.delete(socket);front.destroy();back.destroy();});}
  });await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));t.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>proxy.close(resolve));});
  const seed=op('seed',{sql:'INSERT INTO m10."Items" ("Id","Label") VALUES (1,\'committed\') RETURNING "Id"',checks:[check('created','affectedRows')]}),f=live(t,[seed],{target:{...target,server:'127.0.0.1',port:proxy.address().port}});
  const attempt=await f.call();assert.equal(observedCommit,true);assert.equal(attempt.effect.certainty,'uncertain');const result=f.runtime.finish();assert.equal(result.status,'NEEDS_REVIEW');assert.equal((await admin.query('SELECT * FROM m10."Items"')).rows.length,1);
  assert.equal(result.scenarios[0].attempts.length,1);
});

for(const kind of ['terminate','notify','nested-query'])test(`protected PostgreSQL refuses ${kind} effects before dispatch`,async t=>{
  const peer=new pg.Client({host:target.server,port:target.port,database:target.database,...JSON.parse(process.env.M10_DB_CREDENTIAL),ssl:false});peer.on('error',()=>{});
  await peer.connect();t.after(()=>peer.end());const pid=(await peer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  let notifications=0;peer.on('notification',()=>notifications++);await peer.query('LISTEN harness_m10_boundary');
  const functionName=kind==='terminate'?'pg_terminate_backend':kind==='notify'?'pg_notify':'query_to_xml';
  const definition=op('read',{sql:kind==='terminate'?'SELECT {{functionName}}($1) AS allowed':kind==='notify'?'SELECT 1 AS "Id" FROM {{functionName}}($1,$2)':"SELECT 1 AS \"Id\" FROM {{functionName}}($1,false,false,'')",
    identifiers:{functionName:{input:'functionName',allowed:[functionName]}},
    parameters:kind==='terminate'?[param('pid','integer')]:kind==='notify'?[param('channel','text',{length:100}),param('message','text',{length:100})]:[param('query','text',{length:500})]});
  let resolved=0;const f=live(t,[definition],{mode:'protected',values:[['functionName',functionName],...(kind==='terminate'?[['pid',pid]]:kind==='notify'?[['channel','harness_m10_boundary'],['message','synthetic']]:[['query',`SELECT pg_terminate_backend(${pid})`]])],runtime:{resolveCredential:()=>{resolved++;return JSON.parse(process.env.M10_DB_CREDENTIAL);}}});
  const attempt=await f.call();assert.equal(attempt.effect.certainty,'not-executed');assert.equal(resolved,0);assert.equal(f.runtime.finish().status,'BLOCKED');
  assert.equal((await peer.query('SELECT 1 AS alive')).rows[0].alive,1);assert.equal(notifications,0);
});
