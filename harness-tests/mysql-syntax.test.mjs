import test from 'node:test';
import assert from 'node:assert/strict';
import {tokens, classifySql, quoteIdentifier, validateParameters, validateVersionParameter, validateRestoration} from '../scripts/lib/database/mysql-syntax.mjs';

const parameter = (type, metadata = {}) => ({name:'value', input:'value', type, ...metadata});
const validate = (sql, parameters = []) => validateParameters({sql, parameters}, classifySql(sql));

test('MySQL ordinary reads, read CTEs and set operators remain available', () => {
  for (const sql of [
    'SELECT 1', 'SELECT 1; -- trailing comment', 'SELECT 1 # ignored ?; DROP TABLE t',
    '/* ordinary comment */ SELECT ?', 'WITH c AS (SELECT 1 AS x) SELECT x FROM c',
    'WITH RECURSIVE c AS (SELECT 1 AS x UNION ALL SELECT x + 1 FROM c WHERE x < 3) SELECT * FROM c',
    'SELECT 1 UNION SELECT 2', 'SELECT 1 UNION ALL SELECT 2', 'SELECT 1 UNION DISTINCT SELECT 2',
    'SELECT 1 INTERSECT DISTINCT SELECT 1', 'SELECT 1 EXCEPT ALL SELECT 2',
    'SELECT 1 UNION (SELECT 2)', 'SELECT * FROM t WHERE id IN (SELECT id FROM other)',
    'SELECT lower(?), coalesce(?, 1), replace(?, "x", "y"), truncate(1.25, 1), sleep(0)',
    'SELECT * FROM t ORDER BY id DESC', 'SELECT 1--2',
  ]) assert.equal(classifySql(sql).capability, 'dbSelect', sql);
});

test('MySQL ordinary writes include INSERT SELECT and INSERT SET', () => {
  for (const sql of [
    'INSERT INTO items (id, label) VALUES (?, ?)', 'INSERT items (id) VALUES (?)',
    'INSERT INTO items SET id = ?, label = ?', 'UPDATE items SET label = ? WHERE id = ?',
    'DELETE FROM items WHERE id = ?', 'DELETE FROM items',
    'INSERT INTO items (id) SELECT id FROM other',
    'INSERT INTO items (id) SELECT id FROM other UNION ALL SELECT id FROM third',
    'INSERT INTO items (id) WITH c AS (SELECT 1 AS id) SELECT id FROM c',
    'WITH c AS (SELECT 1 AS id) UPDATE items SET label = ? WHERE id IN (SELECT id FROM c)',
    'WITH c AS (SELECT 1 AS id) DELETE FROM items WHERE id IN (SELECT id FROM c)',
    'INSERT INTO get_lock (id) VALUES (?)', 'INSERT `load_file` (id) VALUES (?)',
  ]) assert.equal(classifySql(sql).capability, 'dbDml', sql);
});

test('MySQL quotes preserve injection-shaped literals under NO_BACKSLASH_ESCAPES', () => {
  const sql = String.raw`SELECT 'it''s ?; DELETE FROM t; {{fake}} --' AS value, "a""b ?; CALL p()" AS other, '\' AS slash, ? AS bound`;
  const classified = classifySql(sql);
  assert.equal(classified.command, 'SELECT');
  assert.equal(classified.tokens.filter(t => t.kind === 'parameter').length, 1);
  assert.equal(classified.tokens.filter(t => t.kind === 'slot').length, 0);
  assert.deepEqual(classified.tokens.filter(t => t.kind === 'literal').map(t => t.value), ["it's ?; DELETE FROM t; {{fake}} --", 'a"b ?; CALL p()', '\\']);
  assert.equal(tokens(String.raw`SELECT '\' AS value`)[1].value, '\\');
  assert.throws(() => classifySql(String.raw`SELECT '\'; DELETE FROM t; --'`));
});

test('MySQL line comments follow native double-dash, hash, CR and LF boundaries', () => {
  for (const comment of ['-- ', '--\t', '#']) {
    for (const end of ['\r', '\n', '\r\n']) {
      const sql = `SELECT ? ${comment} ?; UPDATE items SET id=1 ${end} + ?`;
      assert.equal(tokens(sql).filter(t => t.kind === 'parameter').length, 2);
      assert.doesNotThrow(() => validate(sql, [parameter('int'), parameter('int', {name:'again'})]));
    }
  }
  assert.equal(tokens('SELECT 1--?').filter(t => t.kind === 'parameter').length, 1);
  assert.throws(() => classifySql('SELECT 1--x\n; DELETE FROM t'));
  assert.throws(() => classifySql('SELECT 1 --\u00a0; DELETE FROM t'));
});

test('MySQL executable, optimizer, nested and malformed comments are refused', () => {
  for (const sql of [
    'SELECT /*!80400 SQL_NO_CACHE */ 1', 'SELECT /*! GET_LOCK("x", 0) */ 1',
    'SELECT /*+ SET_VAR(sql_mode="") */ 1', 'SELECT /* outer /* nested */ still outer */ 1',
    'SELECT /* nested /*! SQL */ */ 1', 'SELECT /* unclosed', 'SELECT 1 */',
  ]) assert.throws(() => classifySql(sql), /comment|unsupported/i, sql);
  assert.doesNotThrow(() => classifySql("SELECT '/*!80400 SQL */', '/*+ hint */'"));
});

test('MySQL unsupported statements and alternate side-effect forms fail before dispatch', () => {
  for (const sql of [
    '', ' -- only a comment', 'SELECT 1; DELETE FROM t', 'SELECT 1;;', 'SELECT 1 SELECT 2',
    'SELECT 1 DELETE FROM t', 'DROP TABLE t', 'CREATE TABLE t (id int)', 'TRUNCATE t',
    'ALTER TABLE t ADD label text', 'GRANT SELECT ON t TO u', 'REVOKE SELECT ON t FROM u',
    'CALL p()', 'DO 1', 'PREPARE p FROM "SELECT 1"', 'EXECUTE p', 'DEALLOCATE PREPARE p',
    'SET sql_mode = ""', 'USE other', 'START TRANSACTION', 'BEGIN', 'COMMIT', 'ROLLBACK',
    'SAVEPOINT x', 'RELEASE SAVEPOINT x', 'SHOW TABLES', 'EXPLAIN SELECT 1', 'HANDLER t OPEN',
    'LOAD DATA INFILE "x" INTO TABLE t', 'REPLACE INTO t VALUES (1)', 'INSERT IGNORE INTO t VALUES (1)',
    'UPDATE IGNORE t SET x=1', 'INSERT INTO t VALUES (1) ON DUPLICATE KEY UPDATE x=1',
    'INSERT LOW_PRIORITY INTO t VALUES (1)', 'SELECT HIGH_PRIORITY * FROM t',
    'SELECT 1 INTO OUTFILE "x"', 'SELECT 1 INTO DUMPFILE "x"', 'SELECT 1 INTO @v',
    'SELECT 1 INTO v', 'SELECT @v', 'SELECT @@sql_mode', 'SELECT @v := 1',
    'SELECT * FROM t FOR UPDATE', 'SELECT * FROM t FOR SHARE', 'SELECT * FROM t LOCK IN SHARE MODE',
    'LOCK TABLES t READ', 'UNLOCK TABLES', 'FLUSH TABLES', 'KILL 1',
    'WITH c AS (DELETE FROM t) SELECT * FROM c', 'SELECT (UPDATE t SET id=1)',
    'UPDATE t SET x=1 SET sql_mode=""', 'SELECT SQL_CALC_FOUND_ROWS * FROM t',
  ]) assert.throws(() => classifySql(sql), undefined, sql);
});

test('MySQL lexical limits reject malformed and unsupported encodings', () => {
  for (const sql of [
    'SELECT (1', 'SELECT 1)', "SELECT 'unclosed", 'SELECT "unclosed', 'SELECT `unclosed',
    'SELECT {{bad-name}}', 'SELECT {value}', 'SELECT $1', 'SELECT :value',
    'SELECT U&"escaped"', "SELECT N'value'", "SELECT _utf8mb4'value'", "SELECT _binary 'value'",
    "SELECT X'00'", "SELECT B'01'", 'SELECT \\u0047ET_LOCK("x",0)',
    'SELECT \u0000', 'SELECT \u001a', 'SELECT \u007f', 'SELECT \u0085', 'SELECT \u00a0 1',
    'SELECT \u200bGET_LOCK("x",0)', 'SELECT \u2028 1', 'SELECT \ud800',
    'SELECT 1'.padEnd(65537, ' '),
  ]) assert.throws(() => classifySql(sql), undefined, JSON.stringify(sql).slice(0, 100));
  assert.doesNotThrow(() => classifySql("SELECT '日本語', `名`, ?"));
});

test('MySQL administration, locks and session-mutating calls are refused through quoting and qualification', () => {
  for (const name of ['get_lock', 'release_lock', 'release_all_locks', 'is_free_lock', 'is_used_lock',
    'load_file', 'last_insert_id', 'sys_exec', 'sys_eval', 'mysql_firewall_flush_status',
    'group_replication_set_as_primary', 'version_tokens_lock_shared', 'service_get_write_locks',
    'asynchronous_connection_failover_add_source']) {
    for (const spelling of [name, name.toUpperCase(), `\`${name}\``, `app.${name}`, `\`app\`.\`${name}\``]) {
      assert.throws(() => classifySql(`SELECT ${spelling} /* boundary */ (?)`), /unsupported/i, spelling);
    }
    assert.throws(() => classifySql(`UPDATE t SET x=${name}(?)`), /unsupported/i);
  }
  assert.throws(() => classifySql('SELECT sys.execute_prepared_stmt(?)'), /unsupported/i);
  assert.throws(() => classifySql('SELECT `mysql`.some_function(?)'), /unsupported/i);
  assert.doesNotThrow(() => classifySql("SELECT 'GET_LOCK(1)', `get_lock` FROM t"));
});

test('MySQL slots only identify lexical identifier positions and resolved calls are rechecked', () => {
  const sql = "SELECT '{{table}}' AS `{{column}}` FROM {{table}} WHERE id = ? # {{ignored}}";
  const slots = tokens(sql).filter(t => t.kind === 'slot');
  assert.equal(slots.length, 1);
  assert.equal(sql.slice(slots[0].start, slots[0].end), '{{table}}');
  assert.equal(slots[0].value, 'table');
  assert.doesNotThrow(() => classifySql('SELECT {{functionName}}(?)'));
  assert.throws(() => classifySql(`SELECT ${quoteIdentifier('get_lock')}(?)`), /unsupported/i);
});

test('MySQL identifier quoting preserves one identifier and enforces 64 Unicode characters', () => {
  assert.equal(quoteIdentifier('odd`name'), '`odd``name`');
  assert.equal(quoteIdentifier('a.b'), '`a.b`');
  assert.equal(quoteIdentifier('Items;DROP TABLE t'), '`Items;DROP TABLE t`');
  assert.equal(quoteIdentifier('名'.repeat(64)), `\`${'名'.repeat(64)}\``);
  for (const value of ['', null, 'a'.repeat(65), '名'.repeat(65), 'a\nb', 'a\tb', '\u0000', '\u007f', '\u0085', '\ud800']) assert.throws(() => quoteIdentifier(value));
});

test('MySQL native question-mark bindings match ordered definitions exactly', () => {
  assert.doesNotThrow(() => validate('SELECT 1'));
  assert.doesNotThrow(() => validate('SELECT ? + ?', [parameter('int'), parameter('int', {name:'sameAgain'})]));
  assert.doesNotThrow(() => validate("SELECT '?' AS `?`, ? # ?", [parameter('int')]));
  for (const [sql, parameters] of [['SELECT ?', []], ['SELECT 1', [parameter('int')]], ['SELECT ?, ?', [parameter('int')]]]) assert.throws(() => validate(sql, parameters), /positional/i);
  const definition = Object.freeze({sql:'SELECT ?', parameters:Object.freeze([Object.freeze(parameter('text', {length:500}))])});
  assert.doesNotThrow(() => validateParameters(definition, classifySql(definition.sql)));
  assert.equal(definition.sql, 'SELECT ?');
});

test('MySQL parameter metadata is bounded and engine-specific', () => {
  for (const type of ['int', 'bigint', 'unsigned bigint', 'boolean', 'double', 'date', 'datetime', 'timestamp']) assert.doesNotThrow(() => validate('SELECT ?', [parameter(type)]));
  for (const type of ['text', 'varchar', 'varbinary', 'json']) {
    for (const length of [1, 1048576]) assert.doesNotThrow(() => validate('SELECT ?', [parameter(type, {length})]));
    for (const length of [undefined, 0, -1, 1.5, 1048577, '1']) assert.throws(() => validate('SELECT ?', [parameter(type, {length})]), /length/i);
  }
  for (const [precision, scale] of [[1, 0], [1, 1], [65, 30]]) assert.doesNotThrow(() => validate('SELECT ?', [parameter('decimal', {precision, scale})]));
  for (const [precision, scale] of [[0, 0], [66, 0], [65, 31], [2, 3], [2, -1], [2, 0.5], [undefined, 0], [2, undefined]]) assert.throws(() => validate('SELECT ?', [parameter('decimal', {precision, scale})]), /precision|scale/i);
  for (const bad of [parameter('text'), parameter('int', {length:8}), parameter('double', {precision:3, scale:1}), parameter('decimal', {precision:4, scale:2, length:10}), parameter('integer'), parameter('jsonb'), parameter('int', {nullable:true}), parameter('int', {name:'bad name'}), parameter('int', {input:'bad input'})]) assert.throws(() => validate('SELECT ?', [bad]));
});

test('MySQL version-based restoration fails explicitly before dispatch', () => {
  assert.throws(() => validateVersionParameter(parameter('bigint')), /MySQL.*restoration.*unsupported/i);
  assert.throws(() => validateRestoration('UPDATE t SET x=? WHERE id=? AND version=?', {}, []), /MySQL.*restoration.*unsupported/i);
});
