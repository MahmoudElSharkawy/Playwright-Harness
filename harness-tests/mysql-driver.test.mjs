import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import mysql from 'mysql2';
import {parameter, normalized, validateTarget, validateGrants, executeMysql} from '../scripts/lib/database/mysql-driver.mjs';

test('native MySQL bindings reject coercion and preserve exact values and microseconds', () => {
  const bind = (type, value, metadata = {}) => parameter({type, value, ...metadata});
  assert.equal(bind('int', 7).value, 7n); assert.equal(bind('boolean', true).value, 1n);
  assert.equal(bind('bigint', '9223372036854775807').value, 9223372036854775807n);
  assert.equal(bind('unsigned bigint', '18446744073709551615').value, 18446744073709551615n);
  assert.equal(bind('decimal', '12345678901234567890.123456', {precision: 26, scale: 6}).value, '12345678901234567890.123456');
  assert.equal(bind('timestamp', '2026-01-02T03:04:05.123456Z').value, '2026-01-02 03:04:05.123456');
  assert.equal(bind('datetime', '2026-01-02T03:04:05.123456').value, '2026-01-02 03:04:05.123456');
  assert.equal(bind('varchar', "x'); DELETE FROM Items; --", {length: 100}).value, "x'); DELETE FROM Items; --");
  assert.equal(bind('varbinary', '00ff', {length: 2}).value.toString('hex'), '00ff');
  assert.equal(bind('json', {label: 'قيمة'}, {length: 100}).value.label, 'قيمة');
  assert.equal(bind('int', null), null);
  for (const [type, value, extra] of [['int', '1'], ['int', 2 ** 31], ['boolean', 1], ['double', Infinity], ['bigint', '9223372036854775808'],
    ['unsigned bigint', '-1'], ['unsigned bigint', '18446744073709551616'], ['decimal', '12.34', {precision: 3, scale: 2}], ['text', 'قيمة', {length: 4}],
    ['varbinary', 'fff', {length: 2}], ['json', 'literal', {length: 100}], ['json', {large: 'x'.repeat(20)}, {length: 10}],
    ['timestamp', '2026-01-02T03:04:05.1234567Z'], ['timestamp', '2026-01-02T03:04:05'], ['datetime', '2026-01-02T03:04:05Z'], ['date', '0000-00-00'],
    ['date', '2026-02-30'], ['date', '2025-02-29'], ['date', '2026-04-31'], ['datetime', '2026-01-02T24:00:00'], ['int', undefined]]) {
    assert.throws(() => bind(type, value, extra));
  }
});

test('MySQL results retain numeric precision and temporal meaning', () => {
  const value = (name, input) => normalized(input, {columnType: mysql.Types[name]});
  assert.equal(value('LONGLONG', '18446744073709551615'), '18446744073709551615');
  assert.equal(value('NEWDECIMAL', '12345678901234567890.123456'), '12345678901234567890.123456');
  assert.equal(value('DATETIME', '2026-01-02 03:04:05.123456'), '2026-01-02T03:04:05.123456');
  assert.equal(value('TIMESTAMP', '2026-01-02 03:04:05.123456'), '2026-01-02T03:04:05.123456Z');
  assert.equal(value('DATE', '2026-01-02'), '2026-01-02'); assert.equal(value('TINY', 1), 1);
  assert.equal(value('BLOB', Buffer.from([0, 255])), '00ff'); assert.equal(value('JSON', '{"n": 9007199254740993}'), '{"n": 9007199254740993}');
  for (const [name, input] of [['LONGLONG', 9007199254740992], ['NEWDECIMAL', 1.2], ['LONG', NaN], ['LONG', 2 ** 53], ['DATE', '2026-00-01'],
    ['DATE', '0000-00-00'], ['DATE', '2026-02-30'], ['DATE', '2025-02-29'], ['DATE', '2026-04-31'], ['DATETIME', '2026-01-02 24:00:00'],
    ['JSON', {n: 1}], ['BIT', Buffer.from([1])], ['GEOMETRY', {x: 1}]]) assert.throws(() => value(name, input));
  assert.equal(value('DATE', '2024-02-29'), '2024-02-29');
});

test('MySQL targets use one ordinary database namespace', () => {
  const target = {engine: 'mysql', server: 'localhost', database: 'HarnessMysql'};
  assert.doesNotThrow(() => validateTarget(target)); assert.doesNotThrow(() => validateTarget({...target, schema: target.database}));
  for (const change of [{schema: 'another'}, {database: 'mysql'}, {database: 'SYS'}, {database: 'a/b'}, {database: 'a.b'}, {database: 'a%b'}, {server: 'localhost;bad'}, {server: '127.0.0.1'}, {engine: 'postgresql'}]) {
    assert.throws(() => validateTarget({...target, ...change}));
  }
  assert.doesNotThrow(() => validateTarget({...target, server: '127.0.0.1', encrypt: false}));
  assert.doesNotThrow(() => validateTarget({...target, server: '127.0.0.1', trustServerCertificate: true}));
});

test('SHOW GRANTS admits only direct DML on the exact database', () => {
  const grants = ['GRANT USAGE ON *.* TO `runner`@`%`', 'GRANT SELECT, INSERT, UPDATE, DELETE ON `HarnessMysql`.* TO `runner`@`%`'];
  assert.doesNotThrow(() => validateGrants(grants, 'HarnessMysql', 'runner@%', false));
  const check = value => validateGrants([...grants, value], 'HarnessMysql', 'runner@%', false);
  for (const grant of ['GRANT ALL PRIVILEGES ON `HarnessMysql`.* TO `runner`@`%`', 'GRANT SELECT ON *.* TO `runner`@`%`',
    'GRANT SELECT ON `Other`.* TO `runner`@`%`', 'GRANT SELECT ON `HarnessMysql`.`Items` TO `runner`@`%`',
    'GRANT SELECT (`Id`) ON `Other`.`Items` TO `runner`@`%`', 'GRANT SELECT ON `HarnessMysql`.* TO `runner`@`%` WITH GRANT OPTION',
    'GRANT `reader`@`%` TO `runner`@`%`', 'GRANT PROXY ON `admin`@`%` TO `runner`@`%`',
    'GRANT SYSTEM_USER ON *.* TO `runner`@`%`', 'REVOKE SELECT ON `Other`.* FROM `runner`@`%`',
    'GRANT SELECT ON `HarnessMysql`.* TO `another`@`%`']) assert.throws(() => check(grant));
  assert.throws(() => validateGrants([grants[0]], 'HarnessMysql', 'runner@%', false));
  assert.throws(() => validateGrants(['GRANT SELECT ON `Test_Db`.* TO `runner`@`%`'], 'Test_Db', 'runner@%', false));
  assert.doesNotThrow(() => validateGrants(['GRANT SELECT ON `Test\\_Db`.* TO `runner`@`%`'], 'Test_Db', 'runner@%', false));
  assert.doesNotThrow(() => validateGrants(['GRANT SELECT ON `Test_Db`.* TO `runner`@`%`'], 'Test_Db', 'runner@%', true));
});

test('already-cancelled MySQL execution opens no connection', async () => {
  const controller = new AbortController(); controller.abort('CANCELLED');
  await assert.rejects(executeMysql({engine: 'mysql', server: 'localhost', database: 'HarnessMysql'}, {user: 'runner', password: randomUUID()},
    {parameters: []}, {signal: controller.signal, timeoutMs: 1000, maxRows: 10, maxResponseBytes: 100}), error => error.classification === 'CANCELLED' && !error.dispatched);
});
