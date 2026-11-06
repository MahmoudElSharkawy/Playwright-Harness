import {mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {createRun} from '../../scripts/lib/execution-core/index.mjs';
import {createDatabaseRuntime, defineDatabaseOperation} from '../../scripts/lib/database/index.mjs';

export const check = (id, from = 'rowCount', equals = 1, path = []) => ({id, select: {from, path}, equals});
export const param = (name, type = 'int', extra = {}) => ({name, type, input: name, ...extra});
export const output = (name = 'recordId', type = 'number', field = 'Id', sensitivity = 'public') => ({name, type, sensitivity, select: {from: 'rows', path: [0, field]}});
export function operation(name = 'query', {kind = 'inline', ...d} = {}) {
  return defineDatabaseOperation({id: name, target: 'db', source: {kind, reference: 'synthetic-database', version: '1'}, sql: 'SELECT 1 AS Id', checks: [check(`check-${name}`)], ...d});
}
export function fixture(t, definitions, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'harness-m8-')), packageRoot = resolve('.'), projectRoot = join(directory, 'consumer'); mkdirSync(projectRoot);
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  const roots = {packageRoot, projectRoot, runRoot: join(projectRoot, '.harness', 'runs', randomUUID())}, runId = `run-${randomUUID()}`;
  const values = (options.values ?? []).map(([name, value, sensitivity = 'public', type]) => ({name, type: type ?? (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value), sensitivity,
    ...(sensitivity === 'sensitive' ? {protectedRef: value} : {value}), producer: {runId, scenarioId: 'scenario', name}}));
  const environment = {name: 'qa', environmentMode: options.mode ?? 'test', apiTargets: [], databaseTargets: ['db'], capabilities: options.capabilities ?? {},
    targets: {api: {}, databases: {db: {engine: 'sqlserver', connectionRef: 'env:M8_DB_CREDENTIAL', server: 'localhost', database: 'HarnessM8', schema: 'm8', ...options.target}}}};
  const run = createRun({id: runId, environment, values, scenarios: [{id: 'scenario', expectations: definitions.flatMap(op => op.definition.checks.map(c => ({id: c.id, description: 'Synthetic database expectation', operationId: op.id, invocationId: op.id, requiredEvidence: ['response','assertion']})))}],
    operations: definitions.filter(op => op.source.kind !== 'exploration'), limits: options.limits ?? {}});
  const runtime = createDatabaseRuntime(run, roots, options.runtime);
  return {run, roots, runtime, call: (op = definitions[0], invocation = {}) => runtime.execute({operation: op, invocationId: op.id, inputs: run.inputs.values, ...invocation}),
    allText: () => readdirSync(roots.runRoot, {recursive: true, withFileTypes: true}).filter(f => f.isFile()).map(f => readFileSync(join(f.parentPath, f.name), 'utf8')).join('\n')};
}

/** Common native CRUD proof against the disposable Items table on each engine. */
export async function proveAccountCrud(t, target, resolveCredential) {
  const {engine, database, schema} = target;
  const pg = engine === 'postgresql', mysql = engine === 'mysql';
  const table = pg ? '"Items"' : 'Items', id = pg ? '"Id"' : 'Id', label = pg ? '"Label"' : 'Label';
  const qualified = (mysql ? database : schema) + '.' + table;
  const value = (name, index) => pg ? '$' + index : mysql ? '?' : '@' + name;
  const recordId = param('recordId', pg ? 'integer' : 'int');
  const initial = param('initial', pg || mysql ? 'text' : 'nvarchar', {length: 100});
  const changed = {...initial, name: 'changed', input: 'changed'};
  const where = id + '=' + value('recordId', 1);
  const write = (name, sql, parameters) => operation(name, {engine, sql, parameters, checks: [check(name, 'affectedRows')], affectedRows: {min: 1, max: 1}});
  const create = write('account-insert', `INSERT INTO ${table} (${id},${label}) VALUES (${value('recordId', 1)},${value('initial', 2)})`, [recordId, initial]);
  const update = write('account-update', engine === 'sqlserver'
    ? `UPDATE i SET Label=@changed FROM ${qualified} AS i WHERE i.Id=@recordId`
    : `UPDATE ${qualified} SET ${label}=${value('changed', 1)} WHERE ${id}=${value('recordId', 2)}`, [changed, recordId]);
  const read = operation('account-read', {engine, sql: `SELECT ${label} FROM ${qualified} WHERE ${where}`, parameters: [recordId],
    checks: [check('account-value', 'rows', {$input: 'changed'}, [0, 'Label'])]});
  const remove = write('account-delete', `DELETE FROM ${table} WHERE ${where}`, [recordId]);
  const absent = operation('account-absent', {engine, sql: `SELECT ${id} FROM ${table} WHERE ${where}`, parameters: [recordId],
    checks: [check('account-clean', 'rowCount', 0)]});
  const ops = [create, update, read, remove, absent];
  const f = fixture(t, ops, {target, values: [['recordId', 147], ['initial', 'created'], ['changed', 'updated']], runtime: {resolveCredential}});
  for (const op of ops) {
    const attempt = await f.call(op);
    assert.equal(attempt.outcome, 'SUCCESS', op.id);
  }
  assert.equal(f.runtime.finish().status, 'PASS');
}
