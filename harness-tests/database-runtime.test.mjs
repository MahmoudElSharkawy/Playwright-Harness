import test from 'node:test';
import assert from 'node:assert/strict';
import {classifySql, quoteIdentifier, validateRestoration} from '../scripts/lib/database/sqlserver-syntax.mjs';
import {bindDatabase} from '../scripts/lib/database/definition.mjs';
import {parameter, credentials, validateTarget} from '../scripts/lib/database/sqlserver-driver.mjs';
import {operation, fixture, param} from './fixtures/database.mjs';

for (const text of ['SELECT 1', 'WITH c AS (SELECT 1 AS x) SELECT x FROM c', "SELECT 'DROP; UPDATE x' AS [INTO]", 'SELECT 1 UNION ALL SELECT 2', '/* outer /* nested */ ok */ SELECT 1;']) test(`read classification: ${text}`, () => assert.equal(classifySql(text).capability, 'dbSelect'));
for (const text of ['INSERT INTO m8.Items (Id) VALUES (@id)', 'UPDATE m8.Items SET Label=@label', 'DELETE FROM m8.Items', 'INSERT m8.Items (Id) SELECT 1', 'WITH c AS (SELECT Id FROM m8.Items) DELETE FROM c']) test(`DML classification: ${text}`, () => assert.equal(classifySql(text).capability, 'dbDml'));
for (const text of ['SELECT 1 INTO m8.T', 'DROP TABLE m8.Items', 'EXEC p', 'MERGE t USING x ON 1=1', 'SELECT NEXT VALUE FOR s', 'SELECT 1; DELETE FROM m8.Items', 'SELECT 1 DELETE FROM m8.Items', 'SELECT 1 SELECT 2', 'SELECT * FROM other.dbo.t', 'SELECT * FROM other..t', 'SELECT * FROM OPENROWSET(x)', 'SELECT 1 SET XACT_ABORT ON', "SELECT 'unclosed", 'SELECT /* unclosed', 'WAITFOR DELAY @delay', 'SELECT * FROM #tmp']) test(`unsupported SQL: ${text}`, () => assert.throws(() => classifySql(text)));
test('identifier binding quotes only allowlisted identifier slots, never literals or comments', () => {
  const op = operation('query', {sql: "SELECT '{{table}}' FROM m8.{{table}} -- {{unused}}", identifiers: {table: {input: 'table', allowed: ['odd]name']}}});
  assert.equal(bindDatabase(op.definition, new Map([['table','odd]name']])).text, "SELECT '{{table}}' FROM m8.[odd]]name] -- {{unused}}");
  assert.throws(() => bindDatabase(op.definition, new Map([['table','Items; DROP TABLE x']]))); assert.equal(quoteIdentifier('a.b'), '[a.b]');
});
test('restoration guard rejects weakened predicates without restricting ordinary full-table DML', () => {
  const guard = {identityParameter: 'id', versionParameter: 'revision'};
  validateRestoration('UPDATE m8.Items SET Label=@label WHERE Id=@id AND Revision=@revision', guard);
  for (const sql of ['UPDATE m8.Items SET Label=@label WHERE Id=@id OR Revision=@revision', 'UPDATE m8.Items SET Label=@label WHERE 1=1 OR Id=@id AND Revision=@revision', 'UPDATE m8.Items SET Label=@label /* WHERE Id=@id AND Revision=@revision */']) assert.throws(() => validateRestoration(sql, guard));
  assert.equal(classifySql('DELETE FROM m8.Items').capability, 'dbDml');
});
test('binding refuses driver coercion, truncation and unsupported precision', () => {
  for (const value of [undefined, NaN, Infinity, '1', 2147483648]) assert.throws(() => parameter({...param('n'), value}));
  assert.throws(() => parameter({...param('label','nvarchar',{length: 2}), value: 'long'}));
  assert.throws(() => parameter({...param('n','decimal',{precision: 30,scale: 0}), value: 1}));
  assert.equal(parameter({...param('n','bigint'), value: '9223372036854775807'}).value, '9223372036854775807');
  assert.throws(() => parameter({...param('n','bigint'), value: '9223372036854775808'}));
});
test('credentials cannot override destination and executor requires complete scope', () => {
  assert.throws(() => credentials({user: 'synthetic', password: null, server: 'elsewhere.invalid'}));
  assert.throws(() => validateTarget({engine: 'sqlserver', connectionRef: 'env:DB'}));
});
test('protected DML is blocked before credential resolution, regardless of catalog source', async t => {
  let calls = 0; const op = operation('write', {kind: 'catalog', sql: 'DELETE FROM m8.Items'});
  const f = fixture(t, [op], {mode: 'protected', runtime: {resolveCredential: () => {calls++; throw new Error();}}});
  const attempt = await f.call(); assert.equal(attempt.failureClass, 'POLICY'); assert.equal(calls, 0); assert.equal(f.runtime.finish().status, 'BLOCKED');
});
test('disabled exploration blocks uncataloged reads before connection', async t => {
  const op = operation('query', {kind: 'exploration'}), f = fixture(t, [op], {capabilities: {dbExploration: false}});
  assert.equal((await f.call()).failureClass, 'POLICY'); assert.equal(f.runtime.finish().status, 'BLOCKED');
});
test('cancelled-before-dispatch operations record no effect', async t => {
  const controller = new AbortController(); controller.abort();
  const f = fixture(t, [operation()], {runtime: {signal: controller.signal}}); const attempt = await f.call();
  assert.equal(attempt.failureClass, 'CANCELLED'); assert.equal(attempt.effect.certainty, 'not-executed'); assert.equal(f.runtime.finish().status, 'BLOCKED');
});
for(const text of ["SELECT '(' AS Label DELETE FROM m8.Items WHERE Label=')'", "SELECT '[' AS Label DELETE FROM m8.Items", 'SELECT 1 AS [(] DELETE FROM m8.Items WHERE Id IN (1)'])test(`quoted syntax cannot hide a second mutation: ${text}`,()=>assert.throws(()=>classifySql(text)));
for(const text of ["SELECT '(' AS Label", "SELECT ')' AS Label", "SELECT ';' AS Label", 'SELECT 1 AS [(]'])test(`quoted punctuation is ordinary data: ${text}`,()=>assert.equal(classifySql(text).capability,'dbSelect'));
for(const command of ['WRITETEXT','UPDATETEXT','READTEXT','SEND','RECEIVE','CHECKPOINT','RECONFIGURE','SHUTDOWN','RAISERROR'])test(`a read cannot contain unsupported command ${command}`,()=>assert.throws(()=>classifySql(`SELECT 1 AS Id ${command} Items.Body @pointer @value`)));
test('decimal binding refuses value-changing fractional rounding',()=>{
  assert.throws(()=>parameter({...param('amount','decimal',{precision:10,scale:2}),value:0.30000000000000004}));
  assert.equal(parameter({...param('amount','decimal',{precision:10,scale:2}),value:0.29}).value,0.29);
});
test('restoration cannot use the identity column twice or a joined target',()=>{
  const guard={identityParameter:'id',versionParameter:'revision'};
  for(const text of ['UPDATE m8.Items SET Label=@label WHERE Id=@id AND Id=@revision','UPDATE m8.Items SET Label=@label FROM m8.Items WHERE Id=@id AND Revision=@revision'])assert.throws(()=>validateRestoration(text,guard));
});
test('ordinary CASE expressions remain valid while broker END is refused',()=>{
  assert.equal(classifySql('SELECT CASE WHEN 1=1 THEN 1 ELSE 0 END AS Id').capability,'dbSelect');
  assert.equal(classifySql('UPDATE m8.Items SET Label=CASE WHEN Id=1 THEN @label ELSE Label END').capability,'dbDml');
  assert.throws(()=>classifySql('SELECT 1 END CONVERSATION @handle'));
});
for(const text of ['SELECT * FROM [##SharedFixture]','SELECT * FROM "##SharedFixture"','UPDATE [##SharedFixture] SET Label=@label','SELECT * FROM [#LocalFixture]'])test(`temporary objects remain excluded when quoted: ${text}`,()=>assert.throws(()=>classifySql(text)));
test('dynamic identifier binding cannot select a temporary object',()=>{
  const op=operation('query',{sql:'SELECT * FROM {{table}}',identifiers:{table:{input:'table',allowed:['##SharedFixture','Items']}}});
  assert.throws(()=>bindDatabase(op.definition,new Map([['table','##SharedFixture']])));
  assert.equal(bindDatabase(op.definition,new Map([['table','Items']])).text,'SELECT * FROM [Items]');
});
