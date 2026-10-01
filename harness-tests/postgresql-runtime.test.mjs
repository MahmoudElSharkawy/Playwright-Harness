import test from 'node:test';
import assert from 'node:assert/strict';
import {classifySql, quoteIdentifier} from '../scripts/lib/database/postgresql-syntax.mjs';
import {bindDatabase} from '../scripts/lib/database/definition.mjs';
import {parameter, normalized, validateTarget} from '../scripts/lib/database/postgresql-driver.mjs';
import {fixture, operation, param, check} from './fixtures/database.mjs';

const pg = (name = 'query', definition = {}) => operation(name, {engine:'postgresql',sql:'SELECT 1 AS "Id"',...definition});
for (const sql of ['SELECT 1', 'WITH c AS (SELECT 1 AS x) SELECT x FROM c', 'SELECT $$ DELETE FROM t; $$ AS value', "SELECT E'\\\' DELETE; UPDATE' AS value", 'SELECT $tag$ {{fake}} $1 DELETE; $tag$', '/* outer /* inner */ comment */ SELECT 1;', 'SELECT 1 UNION ALL SELECT 2']) test(`PostgreSQL read classification: ${sql}`, () => assert.equal(classifySql(sql).capability,'dbSelect'));
for (const sql of ['INSERT INTO m10."Items" ("Id") VALUES ($1)', 'UPDATE m10."Items" SET "Label"=$1', 'DELETE FROM m10."Items"', 'WITH c AS (SELECT 1) INSERT INTO m10."Items" ("Id") SELECT * FROM c']) test(`PostgreSQL ordinary DML: ${sql}`, () => assert.equal(classifySql(sql).capability,'dbDml'));
for (const sql of ['DROP TABLE t','TRUNCATE t','CALL p()','COPY t TO STDOUT','SELECT 1 INTO t','SELECT 1; DELETE FROM t','SELECT 1 DELETE FROM t','SELECT 1 SELECT 2','WITH c AS (DELETE FROM t RETURNING *) SELECT * FROM c','SELECT 1 SET ROLE x','DO $$ BEGIN END $$','SELECT U&"escaped"','SELECT $$ unclosed','SELECT /* unclosed','UPDATE t SET x=1;COMMIT']) test(`PostgreSQL unsupported scope: ${sql}`, () => assert.throws(() => classifySql(sql)));

test('PostgreSQL identifier substitution preserves literals/comments and quotes one allowed identifier', () => {
  const op = pg('query',{sql:'SELECT \'{{table}}\' FROM m10.{{table}} -- {{unused}}',identifiers:{table:{input:'table',allowed:['odd"name']}}});
  assert.equal(bindDatabase(op.definition,new Map([['table','odd"name']])).text, 'SELECT \'{{table}}\' FROM m10."odd""name" -- {{unused}}');
  assert.throws(() => bindDatabase(op.definition,new Map([['table','Items;DROP']])),/allowlist/);
  assert.equal(quoteIdentifier('a.b'),'"a.b"'); assert.throws(() => quoteIdentifier('ü'.repeat(32)));
});
test('PostgreSQL values stay positional and are never substituted into SQL text', () => {
  const op=pg('bound',{sql:'SELECT $1::text AS value',parameters:[param('value','text',{length:500})]});
  const value="'); DELETE FROM m10.\"Items\"; --",bound=bindDatabase(op.definition,new Map([['value',value]]));
  assert.equal(bound.text,op.definition.sql); assert.equal(parameter(bound.parameters[0]),value);
  for(const sql of ['SELECT $0','SELECT $2','SELECT 1']) assert.throws(()=>pg('bad',{sql,parameters:[param('v','integer')]}));
});
test('engine-local input types refuse coercion and preserve exact decimal, bigint and microseconds', () => {
  assert.equal(parameter({...param('v','numeric',{precision:30,scale:4}),value:'12345678901234567890123456.7890'}),'12345678901234567890123456.7890');
  assert.equal(parameter({...param('v','bigint'),value:'9223372036854775807'}),'9223372036854775807');
  assert.equal(parameter({...param('v','timestamptz'),value:'2026-01-02T03:04:05.123456Z'}),'2026-01-02T03:04:05.123456Z');
  for(const p of [{type:'integer',value:'1'},{type:'integer',value:2147483648},{type:'bigint',value:1},{type:'double precision',value:NaN},{type:'text',length:2,value:'€'},{type:'bytea',length:1,value:'0001'},{type:'numeric',precision:3,scale:2,value:'10.001'},{type:'xid',value:'4294967296'}]) assert.throws(()=>parameter(p));
});
test('native normalization preserves precision and refuses unsupported results', () => {
  assert.equal(normalized('9223372036854775807',20),'9223372036854775807'); assert.equal(normalized('1234567890.01234567890123456789',1700),'1234567890.01234567890123456789');
  assert.equal(normalized('2026-01-02 03:04:05.123456+00',1184),'2026-01-02T03:04:05.123456Z'); assert.equal(normalized('\\x00ff',17),'00ff');
  assert.equal(normalized('t',16),true); assert.equal(normalized('42',23),42);
  for(const [value,type] of [['NaN',1700],['Infinity',701],['infinity',1114],['{1,2}',1007]]) assert.throws(()=>normalized(value,type));
});
test('optional xmin restoration rejects weakened or fake version predicates, while full-table DML remains valid', () => {
  const d={sql:'UPDATE m10."Items" SET "Label"=$2 WHERE "Id"=$1 AND xmin=$3',parameters:[param('recordId','integer'),param('label','text',{length:500}),param('revision','xid')],affectedRows:{min:1,max:1},restorationGuard:{identityParameter:'recordId',versionParameter:'revision'}};
  assert.doesNotThrow(()=>pg('restore',d)); assert.doesNotThrow(()=>pg('clean',{sql:'DELETE FROM m10."Items"',checks:[]}));
  for(const sql of [d.sql+' OR true',d.sql.replace('xmin','"Label"'),d.sql.replace('"Id"=$1','xmin=$1'),d.sql.replace(' AND ',' OR ')]) assert.throws(()=>pg('restore',{...d,sql}));
  assert.throws(()=>pg('restore',{...d,parameters:d.parameters.map(p=>p.type==='xid'?{...p,type:'integer'}:p)}));
});
test('PostgreSQL requires explicit non-system destinations', () => {
  assert.throws(()=>validateTarget({engine:'postgresql'})); assert.throws(()=>validateTarget({engine:'postgresql',server:'localhost',database:'postgres',schema:'public'}));
  assert.doesNotThrow(()=>validateTarget({engine:'postgresql',server:'localhost',database:'HarnessM10',schema:'m10'}));
});
test('protected PostgreSQL mutation is refused before credentials, including catalog operations', async t => {
  const op=pg('write',{kind:'catalog',sql:'DELETE FROM m10."Items"',checks:[check('written','affectedRows',0)]});let resolved=0;
  const f=fixture(t,[op],{mode:'protected',target:{engine:'postgresql'},runtime:{resolveCredential:()=>{resolved++;throw new Error();}}});
  const attempt=await f.call();assert.equal(attempt.failureClass,'POLICY');assert.equal(attempt.effect.certainty,'not-executed');assert.equal(resolved,0);assert.equal(f.runtime.finish().status,'BLOCKED');
});
test('a SQL definition cannot execute against the other configured engine', async t => {
  let resolved=0;const op=pg(),f=fixture(t,[op],{runtime:{resolveCredential:()=>{resolved++;throw new Error();}}});
  const attempt=await f.call();assert.equal(attempt.failureClass,'EXECUTOR');assert.equal(attempt.effect.certainty,'not-executed');assert.equal(resolved,0);assert.equal(f.runtime.finish().status,'BLOCKED');
});

test('administrative and SQL-evaluating calls are refused including quoted and qualified spellings',()=>{
  for(const name of ['pg_terminate_backend','pg_cancel_backend','pg_notify','pg_logical_emit_message','pg_stat_reset','pg_future_admin','lo_create','lo_get','loread','lowrite','set_config','query_to_xml','query_to_xml_and_xmlschema','query_to_xmlschema','ts_stat','ts_rewrite']) {
    for(const spelling of [name,`"${name}"`,`pg_catalog.${name}`,`"pg_catalog"."${name}"`]) assert.throws(()=>classifySql(`SELECT 1 FROM ${spelling} /* boundary */ ($1)`),/unsupported/);
  }
  assert.throws(()=>classifySql('INSERT INTO t SELECT pg_notify($1,$2)'),/unsupported/);
  assert.throws(()=>classifySql('UPDATE t SET x=pg_terminate_backend($1)'),/unsupported/);
});

test('ordinary value functions, reviewed read functions and function-looking literals remain usable',()=>{
  for(const text of ['SELECT lower($1),length($1),coalesce($1,\'pg_notify(\')','SELECT pg_typeof($1),pg_column_size($1),pg_backend_pid()',"SELECT 'pg_notify(1)', $$ query_to_xml(1) $$",'SELECT 1 FROM pg_sleep(0)','INSERT INTO m10."pg_items" ("Id") VALUES ($1)']) assert.doesNotThrow(()=>classifySql(text));
});

test('identifier-bound function names are checked again before credential resolution',async t=>{
  let credentials=0;
  const op=pg('read',{sql:'SELECT 1 FROM {{functionName}}($1,$2)',identifiers:{functionName:{input:'functionName',allowed:['pg_notify']}},parameters:[param('channel','text',{length:100}),param('message','text',{length:100})]});
  const f=fixture(t,[op],{mode:'protected',target:{engine:'postgresql'},values:[['functionName','pg_notify'],['channel','synthetic'],['message','synthetic']],runtime:{resolveCredential:()=>{credentials++;throw new Error();}}});
  const attempt=await f.call();assert.equal(attempt.effect.certainty,'not-executed');assert.equal(credentials,0);assert.equal(f.runtime.finish().status,'BLOCKED');
});
