import test from 'node:test';
import assert from 'node:assert/strict';
import {validateConfiguration} from '../scripts/lib/project-config.mjs';
import {bindDatabase} from '../scripts/lib/database/definition.mjs';
import {fixture, operation, param, check} from './fixtures/database.mjs';

const target = {engine: 'mysql', server: 'localhost', database: 'HarnessMysql', connectionRef: 'env:MYSQL_CREDENTIAL'};
const mysqlOperation = (name = 'read', definition = {}) => operation(name, {engine: 'mysql', sql: 'SELECT 1 AS Id', ...definition});

test('MySQL configuration accepts one database namespace without a separate schema', () => {
  const project = {version: 1, defaultEnvironment: 'qa', environments: {qa: {environmentMode: 'test', apiTargets: [], databaseTargets: ['db']}}};
  assert.equal(validateConfiguration(project, {api: {}, databases: {db: target}}).targets.databases.db.engine, 'mysql');
  assert.throws(() => validateConfiguration(project, {api: {}, databases: {db: {...target, schema: 'different'}}}), /MySQL schema/);
});

test('MySQL definitions retain native positional bindings and explicit capability', () => {
  const op = mysqlOperation('bound', {sql: 'SELECT ? AS Label', parameters: [param('label', 'text', {length: 200})]});
  const label = "'); DELETE FROM Items; --";
  const bound = bindDatabase(op.definition, new Map([['label', label]]));
  assert.equal(bound.text, 'SELECT ? AS Label');
  assert.equal(bound.parameters[0].value, label);
  assert.equal(bound.capability, 'dbSelect');
});

test('MySQL runtime validates target scope before resolving credentials', async t => {
  let resolutions = 0;
  const f = fixture(t, [mysqlOperation()], {target: {...target, database: 'mysql', schema: 'mysql'}, runtime: {resolveCredential: () => {resolutions++; throw new Error('unused');}}});
  const attempt = await f.call();
  assert.equal(attempt.effect.certainty, 'not-executed');
  assert.equal(resolutions, 0);
  assert.equal(f.runtime.finish().status, 'BLOCKED');
});

test('MySQL insert identity extraction uses a scalar exact-string selector', () => {
  assert.doesNotThrow(() => mysqlOperation('create', {sql: 'INSERT INTO Items (Label) VALUES (?)', parameters: [param('label', 'text', {length: 100})],
    checks: [check('created', 'affectedRows')], extract: [{name: 'recordId', type: 'string', sensitivity: 'public', select: {from: 'insertId', path: []}}]}));
  assert.throws(() => mysqlOperation('bad', {extract: [{name: 'recordId', type: 'string', sensitivity: 'public', select: {from: 'insertId', path: [0]}}]}));
  assert.throws(() => operation('sqlserver', {checks: [check('wrong-engine', 'insertId', '1')]}));
});

test('MySQL target mismatch and protected DML fail before credentials resolve', async t => {
  for (const settings of [{target: {engine: 'postgresql'}}, {mode: 'protected', target: {...target, schema: target.database}}]) {
    let resolutions = 0;
    const change = mysqlOperation('change', {sql: 'DELETE FROM Items', checks: [check('changed', 'affectedRows')]});
    const f = fixture(t, [change], {...settings, runtime: {resolveCredential: () => {resolutions++; throw new Error('unused');}}});
    const attempt = await f.call(); assert.equal(attempt.effect.certainty, 'not-executed'); assert.equal(resolutions, 0); assert.equal(f.runtime.finish().status, 'BLOCKED');
  }
});

test('MySQL restoration is rejected when an operation is defined', () => {
  assert.throws(() => mysqlOperation('restore', {sql: 'UPDATE Items SET Label=? WHERE Id=? AND Revision=?',
    parameters: [param('label', 'text', {length: 100}), param('id'), param('revision')], checks: [check('restored', 'affectedRows')],
    affectedRows: {min: 1, max: 1}, restorationGuard: {identityParameter: 'id', versionParameter: 'revision'}}), /restoration.*unsupported/i);
});

test('MySQL RESTORE execution fails before credential resolution', async t => {
  let resolutions = 0;
  const change = mysqlOperation('restore', {sql: 'UPDATE Items SET Label=?', parameters: [param('label', 'text', {length: 100})], checks: [check('restored', 'affectedRows')]});
  const f = fixture(t, [change], {target: {...target, schema: target.database}, values: [['label', 'original']], runtime: {resolveCredential: () => {resolutions++; throw new Error('unused');}}});
  const attempt = await f.call(change, {phase: 'RESTORE'});
  assert.equal(attempt.effect.certainty, 'not-executed'); assert.equal(resolutions, 0); assert.equal(f.runtime.finish().status, 'BLOCKED');
});
