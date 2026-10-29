import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import sql from 'mssql';
import {operation, fixture} from './fixtures/database.mjs';
import {requireSchemaEvidence} from '../scripts/lib/database/schema.mjs';
import {createRun} from '../scripts/lib/execution-core/index.mjs';
import {runSequentialScenario} from '../scripts/lib/sequential/index.mjs';

const scope = {target: 'db', operationId: 'query', invocationId: 'query', tables: ['Items']};
const row = (kind, extra = {}) => ({kind, tableName: 'Items', columnName: null, ordinal: 0, typeName: null, nullable: null, length: null, precision: null, scale: null, keyName: null, primaryKey: null, referencedSchema: null, referencedTable: null, referencedColumn: null, supported: true, ...extra});
const rows = () => [row('table'), row('column', {columnName: 'Id', ordinal: 1, typeName: 'int', nullable: false, length: 4, precision: 10, scale: 0}), row('column', {columnName: 'Label', ordinal: 2, typeName: 'nvarchar', nullable: false, length: 200, precision: 0, scale: 0}), row('key', {columnName: 'Id', ordinal: 1, keyName: 'PK_Items', primaryKey: true})];
function native(t, records = rows(), {denied = false} = {}) {
  const calls = [];
  class Pool extends EventEmitter {async connect() {} async close() {}}
  class Request extends EventEmitter {
    constructor() {super(); this.bindings = {};}
    input(name, type, value) {this.bindings[name] = value; return this;}
    cancel() {}
    async query(text) {
      calls.push({text, bindings: this.bindings});
      if (!this.stream) return {recordsets: [[{databaseName: 'HarnessM8', defaultSchema: 'm8'}], denied ? [{permission_name: 'CONTROL'}] : [], [], [], []]};
      const selected = typeof records === 'function' ? records(this.bindings) : records;
      this.emit('recordset', Object.fromEntries(Object.keys(selected[0] ?? {}).map(name => [name, {type: {name: 'NVarChar'}}])));
      for (const record of selected) this.emit('row', record);
      return {rowsAffected: [selected.length]};
    }
  }
  t.mock.method(sql, 'ConnectionPool', function () {return new Pool();}); t.mock.method(sql, 'Request', function () {return new Request();});
  return calls;
}
const credentials = () => ({user: 'schema_runner', password: '<synthetic-private-schema-value>'});

test('schema inspection retains scoped native metadata and verifies its registered evidence', async t => {
  const calls = native(t), f = fixture(t, [operation()], {runtime: {resolveCredential: credentials}});
  const receipt = await f.runtime.inspectSchema(scope);
  assert.equal(requireSchemaEvidence(receipt), receipt);
  assert.equal(receipt.schema.runId, f.run.id); assert.equal(receipt.schema.inputFingerprint, f.run.inputFingerprint);
  assert.equal(receipt.schema.engine, 'sqlserver'); assert.equal(receipt.schema.schema, 'm8');
  assert.deepEqual(receipt.schema.tables[0].uniqueKeys, [{name: 'PK_Items', primary: true, columns: ['Id']}]);
  assert.equal(receipt.schema.tables[0].columns[1].length, 200);
  assert.equal(calls.length, 2); assert.deepEqual(calls[1].bindings, {scope: 'm8', tableName: 'Items'});
  assert.match(calls[1].text, /has_filter=0/); assert.match(calls[1].text, /key_ordinal>0/);
  assert.doesNotMatch(f.allText(), /synthetic-private-schema-value|schema_runner/);
  assert.throws(() => requireSchemaEvidence(JSON.parse(JSON.stringify(receipt))), /runtime/);
  writeFileSync(join(f.roots.runRoot, receipt.evidence.path), '{}');
  assert.throws(() => requireSchemaEvidence(receipt), /integrity|mismatch/);
});

test('schema content fingerprint ignores run identity and changes with relevant schema', async t => {
  const records = rows(); native(t, records);
  const first = fixture(t, [operation()], {runtime: {resolveCredential: credentials}}), second = fixture(t, [operation()], {runtime: {resolveCredential: credentials}});
  const a = await first.runtime.inspectSchema(scope), b = await second.runtime.inspectSchema(scope);
  assert.notEqual(a.schema.runId, b.schema.runId); assert.equal(a.schema.fingerprint, b.schema.fingerprint);
  records[2].length = 400;
  const c = await second.runtime.inspectSchema(scope); assert.notEqual(b.schema.fingerprint, c.schema.fingerprint);
});

for (const capability of ['dbSelect', 'dbExploration']) test(`schema inspection requires ${capability} before credentials`, async t => {
  let resolved = 0; const f = fixture(t, [operation()], {capabilities: {[capability]: false}, runtime: {resolveCredential: () => {resolved++; return credentials();}}});
  await assert.rejects(f.runtime.inspectSchema(scope), /capabilit/i); assert.equal(resolved, 0);
});

for (const change of [{target: 'other'}, {operationId: 'other'}, {invocationId: 'other'}, {tables: []}, {tables: ['Items', 'Items']}, {tables: Array.from({length: 9}, (_, i) => `Table${i}`)}, {tables: ['#temp']}, {phase: 'CLEANUP'}]) test(`schema scope rejects ${JSON.stringify(change)} before credentials`, async t => {
  let resolved = 0; const f = fixture(t, [operation()], {runtime: {resolveCredential: () => {resolved++; return credentials();}}});
  await assert.rejects(f.runtime.inspectSchema({...scope, ...change})); assert.equal(resolved, 0);
});

for (const engine of ['postgresql', 'mysql']) test(`${engine} discovery remains explicitly unsupported`, async t => {
  let resolved = 0; const target = {engine, ...(engine === 'mysql' ? {schema: 'HarnessM8'} : {})};
  const f = fixture(t, [operation()], {target, runtime: {resolveCredential: () => {resolved++; return credentials();}}});
  await assert.rejects(f.runtime.inspectSchema(scope), /SQL Server/); assert.equal(resolved, 0);
});

test('cancelled and expired schema work never resolves credentials', async t => {
  const controller = new AbortController(); controller.abort(); let resolved = 0;
  const f = fixture(t, [operation()], {runtime: {signal: controller.signal, resolveCredential: () => {resolved++; return credentials();}}});
  await assert.rejects(f.runtime.inspectSchema(scope), /window|cancel/i); assert.equal(resolved, 0);
  const g = fixture(t, [operation()], {runtime: {resolveCredential: () => {resolved++; return credentials();}}});
  t.mock.method(Date, 'now', () => g.run.deadlineAt + 1);
  await assert.rejects(g.runtime.inspectSchema(scope), /window|deadline/i); assert.equal(resolved, 0);
});

test('schema calls serialize with database execution and cannot run after finish', async t => {
  native(t); let release; const f = fixture(t, [operation()], {runtime: {resolveCredential: () => new Promise(resolve => {release = resolve;})}});
  const pending = f.runtime.inspectSchema(scope);
  await assert.rejects(f.runtime.inspectSchema(scope), /sequential|idle/);
  await assert.rejects(f.call(), /sequential/); release(credentials()); await pending;
  assert.throws(() => f.runtime.finish(), /nonempty attempt history/);
  await assert.rejects(f.runtime.inspectSchema(scope), /active|finished|sequential/);
});

for (const [name, records] of [['absent table', []], ['hidden or unsupported table', [row('table', {supported: false})]], ['unsupported column', [row('table'), row('column', {supported: false})]], ['incomplete composite key', [...rows(), row('key', {columnName: 'Label', ordinal: 3, keyName: 'PK_Items', primaryKey: true})]], ['hidden FK endpoint', [...rows(), row('foreignKey', {columnName: 'Id', ordinal: 1, keyName: 'FK_Items', referencedColumn: 'Id'})]], ['untrusted relationship', [...rows(), row('foreignKey', {supported: false})]]]) test(`schema discovery fails closed for ${name}`, async t => {
  native(t, records); const f = fixture(t, [operation()], {runtime: {resolveCredential: credentials}});
  await assert.rejects(f.runtime.inspectSchema(scope)); assert.equal(f.allText(), '');
});

test('native principal preflight remains mandatory for metadata', async t => {
  const calls = native(t, rows(), {denied: true}), f = fixture(t, [operation()], {runtime: {resolveCredential: credentials}});
  await assert.rejects(f.runtime.inspectSchema(scope)); assert.equal(calls.length, 1); assert.equal(f.allText(), '');
});

test('schema metadata never embeds supplied table names in SQL', async t => {
  const name = "Items'; DELETE FROM Orders; --", records = rows().map(value => ({...value, tableName: name}));
  const calls = native(t, records), f = fixture(t, [operation()], {runtime: {resolveCredential: credentials}});
  await f.runtime.inspectSchema({...scope, tables: [name]});
  assert.equal(calls[1].bindings.tableName, name); assert(!calls[1].text.includes(name));
});

test('composite unique keys and foreign keys retain exact ordered column relationships', async t => {
  const records = [...rows(), row('key', {columnName: 'Label', ordinal: 2, keyName: 'PK_Items', primaryKey: true}),
    row('foreignKey', {columnName: 'Label', ordinal: 2, keyName: 'FK_Items', referencedSchema: 'm8', referencedTable: 'Parents', referencedColumn: 'Label'}),
    row('foreignKey', {columnName: 'Id', ordinal: 1, keyName: 'FK_Items', referencedSchema: 'm8', referencedTable: 'Parents', referencedColumn: 'Id'})];
  native(t, records); const f = fixture(t, [operation()], {runtime: {resolveCredential: credentials}});
  const receipt = await f.runtime.inspectSchema(scope), table = receipt.schema.tables[0];
  assert.deepEqual(table.uniqueKeys[0].columns, ['Id', 'Label']);
  assert.deepEqual(table.foreignKeys, [{name: 'FK_Items', columns: ['Id', 'Label'], referencedSchema: 'm8', referencedTable: 'Parents', referencedColumns: ['Id', 'Label']}]);
});

test('repeated schema requests cannot crawl beyond the scenario inspection budget', async t => {
  let resolved = 0; native(t); const f = fixture(t, [operation()], {runtime: {resolveCredential: () => {resolved++; return credentials();}}});
  for (let i = 0; i < 8; i++) await f.runtime.inspectSchema(scope);
  await assert.rejects(f.runtime.inspectSchema(scope), /cumulative/); assert.equal(resolved, 8);
});

test('the distinct table budget accumulates across metadata calls', async t => {
  let resolved = 0; native(t, bindings => rows().map(value => ({...value, tableName: bindings.tableName})));
  const f = fixture(t, [operation()], {runtime: {resolveCredential: () => {resolved++; return credentials();}}});
  await f.runtime.inspectSchema({...scope, tables: Array.from({length: 8}, (_, i) => `Items${i}`)});
  await assert.rejects(f.runtime.inspectSchema({...scope, tables: ['Unrelated']}), /cumulative/); assert.equal(resolved, 1);
});

test('metadata row ceilings fail instead of promoting incomplete schema', async t => {
  native(t, [...rows(), ...Array.from({length: 510}, () => row('table'))]);
  const f = fixture(t, [operation()], {runtime: {resolveCredential: credentials}});
  await assert.rejects(f.runtime.inspectSchema(scope), /METADATA_UNAVAILABLE/); assert.equal(f.allText(), '');
});

test('metadata excludes known credential values even inside schema identifiers', async t => {
  const records = rows(); records[2].columnName = credentials().password;
  native(t, records); const f = fixture(t, [operation()], {runtime: {resolveCredential: credentials}});
  await assert.rejects(f.runtime.inspectSchema(scope), /METADATA_UNAVAILABLE/); assert.equal(f.allText(), '');
});

test('sequential workflow exposes metadata without adding a passing business attempt', async t => {
  native(t); const op = operation('query', {checks: [{id: 'check-query', select: {from: 'rowCount', path: []}, equals: 4}]});
  const f = fixture(t, [op]);
  const run = createRun({...f.run.inputs, id: `${f.run.id}-sequential`, scenarios: f.run.inputs.scenarios.map(value => ({...value, expectations: value.expectations.map(item => ({...item, phase: 'VERIFY'}))}))});
  let context, receipt;
  const result = await runSequentialScenario(run, {...f.roots, runRoot: `${f.roots.runRoot}-sequential`}, {database: {resolveCredential: credentials}}, {verify: async ctx => {
    context = ctx; receipt = await ctx.database.inspectSchema(scope);
    await ctx.database.execute({operation: op, invocationId: 'query'});
  }});
  assert.equal(result.status, 'PASS'); assert.equal(result.scenarios[0].attempts.length, 1);
  assert.equal(receipt.evidence.identity.phase, 'VERIFY'); assert.equal(requireSchemaEvidence(receipt), receipt);
  assert.throws(() => context.database.inspectSchema(scope), /callback has ended/);
});

const hinted = tableHint => ({target: 'db', operationId: 'query', invocationId: 'query', tableHint});
test('a literal scenario hint discovers exact table names before inspecting their schema', async t => {
  const tableName = 'DiscoveredOrders', tableHint = 'Order';
  const calls = native(t, bindings => bindings.tableHint === undefined ? rows().map(record => ({...record, tableName: bindings.tableName})) : [{tableName}]);
  const f = fixture(t, [operation()], {runtime: {resolveCredential: credentials}});
  const receipt = await f.runtime.inspectSchema(hinted(tableHint));
  assert.equal(requireSchemaEvidence(receipt), receipt); assert.equal(receipt.schema.tables[0].name, tableName);
  assert.equal(calls.length, 4); assert.deepEqual(calls[1].bindings, {scope: 'm8', tableHint});
  assert.match(calls[1].text, /TOP \(9\)/); assert.match(calls[1].text, /CHARINDEX\(@tableHint,t.name\)/);
  assert.doesNotMatch(calls[1].text, /\bLIKE\b/); assert.equal(calls[3].bindings.tableName, tableName);
});

for (const change of [{tableHint: 'ab'}, {tableHint: '   '}, {tableHint: 'a'.repeat(129)}, {tableHint: 'x\ny'}, {tableHint: null}, {tables: ['Items'], tableHint: 'Items'}]) test(`table hint input ${JSON.stringify(change)} rejects before credentials`, async t => {
  let resolved = 0; const f = fixture(t, [operation()], {runtime: {resolveCredential: () => {resolved++; return credentials();}}});
  await assert.rejects(f.runtime.inspectSchema({...hinted('Items'), ...change})); assert.equal(resolved, 0);
});

for (const [label, matches] of [['missing', []], ['too broad', Array.from({length: 9}, (_, i) => ({tableName: `Items${i}`}))]]) test(`a ${label} hint fails before table detail reads`, async t => {
  const calls = native(t, matches), f = fixture(t, [operation()], {runtime: {resolveCredential: credentials}});
  await assert.rejects(f.runtime.inspectSchema(hinted('Items')), /TABLE_NOT_FOUND|TABLE_HINT_AMBIGUOUS/);
  assert.equal(calls.length, 2); assert.equal(f.allText(), '');
});

test('failed table searches consume the cumulative inspection budget', async t => {
  let resolved = 0; const calls = native(t, []), f = fixture(t, [operation()], {runtime: {resolveCredential: () => {resolved++; return credentials();}}});
  for (let i = 0; i < 8; i++) await assert.rejects(f.runtime.inspectSchema(hinted('Items')), /TABLE_NOT_FOUND/);
  await assert.rejects(f.runtime.inspectSchema(hinted('Unrelated')), /cumulative/); assert.equal(resolved, 8); assert.equal(calls.length, 16);
});

test('hint discovery respects the cumulative distinct-table ceiling before detail reads', async t => {
  const calls = native(t, bindings => bindings.tableHint === undefined ? rows().map(record => ({...record, tableName: bindings.tableName})) : [{tableName: 'NinthTable'}]);
  const f = fixture(t, [operation()], {runtime: {resolveCredential: credentials}});
  await f.runtime.inspectSchema({...scope, tables: Array.from({length: 8}, (_, i) => `Items${i}`)});
  const count = calls.length;
  await assert.rejects(f.runtime.inspectSchema(hinted('Ninth')), /cumulative/); assert.equal(calls.length, count + 2);
});

test('hint metacharacters stay literal native parameters and are absent from durable evidence', async t => {
  const tableHint = "x%_'; DELETE FROM Other; --";
  const calls = native(t, bindings => bindings.tableHint === undefined ? rows() : [{tableName: 'Items'}]);
  const f = fixture(t, [operation()], {runtime: {resolveCredential: credentials}});
  await f.runtime.inspectSchema(hinted(tableHint));
  assert.equal(calls[1].bindings.tableHint, tableHint); assert(!calls[1].text.includes(tableHint)); assert(!f.allText().includes(tableHint));
});

test('cancellation after a table-name search prevents subsequent metadata reads', async t => {
  const controller = new AbortController();
  const calls = native(t, () => {controller.abort(); return [{tableName: 'Items'}];});
  const f = fixture(t, [operation()], {runtime: {resolveCredential: credentials, signal: controller.signal}});
  await assert.rejects(f.runtime.inspectSchema(hinted('Items')), /CANCELLED/); assert.equal(calls.length, 2); assert.equal(f.allText(), '');
});
