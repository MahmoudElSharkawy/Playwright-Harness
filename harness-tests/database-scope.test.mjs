import assert from 'node:assert/strict';
import test from 'node:test';
import {fixture, operation} from './fixtures/database.mjs';
import {scopeDatabaseRequest} from '../scripts/lib/database/scope.mjs';

const targets = {
  sqlserver: {engine: 'sqlserver', database: 'HarnessM8', schema: 'm8'},
  postgresql: {engine: 'postgresql', database: 'HarnessM8', schema: 'm8'},
  mysql: {engine: 'mysql', database: 'HarnessM8'}
};
const compile = (engine, text) => scopeDatabaseRequest(targets[engine], {text, parameters: []});

for (const [engine, scope, outside] of [
  ['sqlserver', 'm8', 'dbo'], ['postgresql', 'm8', 'public'], ['mysql', 'HarnessM8', 'OutsideDb']
]) test(`${engine} blocks a cross-scope INSERT source before resolving credentials`, async t => {
  const op = operation('outside', {engine, sql: `INSERT INTO ${scope}.Items (Id) SELECT Id FROM ${outside}.Items`});
  let credentials = 0;
  const f = fixture(t, [op], {target: {engine, schema: scope}, runtime: {resolveCredential() {credentials++; throw Error('Do not connect');}}});
  const attempt = await f.call();
  assert.equal(credentials, 0);
  assert.equal(attempt.effect.certainty, 'not-executed');
  assert.equal(attempt.failureClass, 'EXECUTOR');
  assert.match(f.allText(), /DB_SCOPE_DENIED/);
});

for (const [engine, qualifier, quoted] of [
  ['sqlserver', '[m8]', '[Odd.Table]'], ['postgresql', '"m8"', '"Odd.Table"'], ['mysql', '`HarnessM8`', '`Odd.Table`']
]) test(`${engine} scopes nested SELECT, JOIN, CTE and set sources and preserves aliases and literals`, () => {
  const text = `WITH local_rows AS (SELECT Id FROM Items WHERE Label='not.other') SELECT c.Id FROM local_rows AS c
    JOIN (SELECT Id FROM ${quoted} UNION ALL SELECT Id FROM Items) AS n ON c.Id=n.Id
    WHERE EXISTS (SELECT 1 FROM OtherItems WHERE Id=c.Id)`;
  const scoped = compile(engine, text);
  assert.equal(scoped.text, text.replaceAll('FROM Items', 'FROM ' + qualifier + '.Items')
    .replace('FROM ' + quoted, 'FROM ' + qualifier + '.' + quoted)
    .replace('FROM OtherItems', 'FROM ' + qualifier + '.OtherItems'));
  assert.deepEqual(scoped.tables, [engine === 'postgresql' ? 'items' : 'Items', 'Odd.Table', engine === 'postgresql' ? 'otheritems' : 'OtherItems']);
});

test('SQL Server scopes actual mutation targets while preserving proven source aliases and CTEs', () => {
  assert.equal(compile('sqlserver', 'UPDATE i SET Label=@value FROM Items AS i WHERE i.Id=@id').text,
    'UPDATE i SET Label=@value FROM [m8].Items AS i WHERE i.Id=@id');
  assert.equal(compile('sqlserver', 'UPDATE Items SET Label=@value FROM m8.Items WHERE Items.Id=@id').text,
    'UPDATE [m8].Items SET Label=@value FROM m8.Items WHERE Items.Id=@id');
  assert.equal(compile('sqlserver', 'DELETE i FROM Items AS i WHERE i.Id=@id').text,
    'DELETE i FROM [m8].Items AS i WHERE i.Id=@id');
  assert.equal(compile('sqlserver', 'WITH c AS (SELECT Id FROM Items) DELETE FROM c').text,
    'WITH c AS (SELECT Id FROM [m8].Items) DELETE FROM c');
});

test('PostgreSQL and MySQL keep physical DML targets scoped even when a CTE shadows the name', () => {
  assert.equal(compile('postgresql', 'WITH pg_authid AS (SELECT 1) DELETE FROM pg_authid WHERE true').text,
    'WITH pg_authid AS (SELECT 1) DELETE FROM "m8".pg_authid WHERE true');
  assert.equal(compile('postgresql', 'WITH Items AS (SELECT Id FROM Items) SELECT Id FROM Items').text,
    'WITH Items AS (SELECT Id FROM "m8".Items) SELECT Id FROM Items');
  const mysql = compile('mysql', 'WITH Items AS (SELECT 1) INSERT INTO Items (Id) VALUES (1)');
  assert.match(mysql.text, /INSERT INTO .HarnessM8.\.Items/);
  assert.deepEqual(mysql.tables, ['Items']);
});

test('PostgreSQL sequence functions resolve only static names in the configured schema', () => {
  const input = "INSERT INTO items (id) VALUES (nextval('seq'::regclass))";
  assert.equal(compile('postgresql', input).text, "INSERT INTO \"m8\".items (id) VALUES (pg_catalog.nextval('\"m8\".\"seq\"'::regclass))");
  for (const expression of ["nextval('public.seq')", "nextval('123')", "nextval($1::regclass)",
    "CAST('public.seq' AS pg_catalog.regclass)", "CAST('public.seq' AS text)::regclass",
    "'public.seq'::regclass", "nextval('m8/* ignored */.seq')", 'public.outside_func()']) {
    assert.throws(() => compile('postgresql', 'SELECT ' + expression), {reason: /^DB_SCOPE_/}, expression);
  }
});

for (const [engine, outside] of [['sqlserver', 'dbo'], ['postgresql', 'public'], ['mysql', 'OutsideDb']]) {
  test(`${engine} rejects direct cross-scope access in each nested source or routine`, () => {
    for (const sql of [
      `SELECT a.Id FROM Items AS a LEFT JOIN ${outside}.Items AS b ON a.Id=b.Id`,
      `SELECT Id FROM Items, ${outside}.Items`,
      `SELECT Id FROM Items WHERE Id IN (SELECT Id FROM ${outside}.Items)`,
      `WITH c AS (SELECT Id FROM ${outside}.Items) SELECT * FROM c`,
      `SELECT 1 UNION ALL SELECT Id FROM ${outside}.Items`,
      `SELECT ${outside}.outside_func(1)`,
      `DELETE FROM ${outside}.Items`
    ]) assert.throws(() => compile(engine, sql), {reason: 'DB_SCOPE_DENIED'}, sql);
  });
}

test('a resolved identifier cannot replace the configured schema', async t => {
  const op = operation('bound-outside', {sql: 'SELECT Id FROM {{schemaName}}.Items',
    identifiers: {schemaName: {input: 'schemaName', allowed: ['m8', 'dbo']}}});
  const f = fixture(t, [op], {values: [['schemaName', 'dbo']], runtime: {resolveCredential: () => assert.fail('Do not resolve credentials')}});
  assert.equal((await f.call()).effect.certainty, 'not-executed');
  assert.match(f.allText(), /DB_SCOPE_DENIED/);
  assert.equal(f.runtime.finish().status, 'BLOCKED');
});

test('SQL Server rejects nested writes, extra statements and a CR-hidden source', () => {
  for (const sql of [
    'SELECT Id FROM (DELETE FROM m8.Items OUTPUT DELETED.Id) AS x',
    'SELECT 1 REVERT',
    'SELECT 1; SELECT Id FROM dbo.Items',
    'SELECT 1 -- comment\rFROM dbo.Items'
  ]) assert.throws(() => compile('sqlserver', sql), {reason: /^DB_SCOPE_/}, sql);
});

test('SQL Server legacy hints scope a table even when its name looks like a function', () => {
  const scoped = compile('sqlserver', 'SELECT Id FROM ABS (NOLOCK)');
  assert.equal(scoped.text, 'SELECT Id FROM [m8].ABS (NOLOCK)');
  assert.deepEqual(scoped.tables, ['ABS']);
  assert.equal(compile('sqlserver', 'SELECT i.Id FROM ABS AS i (NOLOCK)').text,
    'SELECT i.Id FROM [m8].ABS AS i (NOLOCK)');
  assert.throws(() => compile('sqlserver', 'SELECT Id FROM dbo.ABS (NOLOCK)'), {reason: 'DB_SCOPE_DENIED'});
});

test('bare SQL Server HOLDLOCK never binds an unqualified write target as a source alias', () => {
  assert.equal(compile('sqlserver', "UPDATE [HOLDLOCK] SET Label='changed' FROM m8.Items HOLDLOCK").text,
    "UPDATE [m8].[HOLDLOCK] SET Label='changed' FROM m8.Items HOLDLOCK");
  assert.equal(compile('sqlserver', 'DELETE [HOLDLOCK] FROM m8.Items HOLDLOCK').text,
    'DELETE [m8].[HOLDLOCK] FROM m8.Items HOLDLOCK');
  assert.equal(compile('sqlserver', 'DELETE [HOLDLOCK] FROM m8.Items AS [HOLDLOCK]').text,
    'DELETE [HOLDLOCK] FROM m8.Items AS [HOLDLOCK]');
});

test('previously supported dialect forms still have resolvable scope', () => {
  assert.match(compile('sqlserver', 'UPDATE Items SET Quantity += 1 WHERE Id=1').text, /UPDATE \[m8\].Items/);
  assert.doesNotThrow(() => compile('sqlserver', "SELECT Id FROM OPENJSON(N'[]') WITH (Id INT '$.Id')"));
  for (const engine of ['postgresql', 'mysql']) {
    assert.doesNotThrow(() => compile(engine, "SELECT TRIM(BOTH ' ' FROM ' a ')"));
  }
  assert.doesNotThrow(() => compile('postgresql', "SELECT TRIM('xyabcxy','xy')"));
  assert.doesNotThrow(() => compile('mysql', "SELECT REVERSE('abc')"));
  assert.doesNotThrow(() => compile('mysql', 'SELECT * FROM Items FORCE INDEX (PRIMARY)'));
});

test('PostgreSQL rejects identifier truncation that could redirect a CTE reference', () => {
  const label = 'a'.repeat(63);
  assert.throws(() => compile('postgresql', 'WITH ' + label + 'X AS (SELECT 7 AS x) SELECT x FROM ' + label),
    {reason: 'DB_SCOPE_UNSUPPORTED'});
});
