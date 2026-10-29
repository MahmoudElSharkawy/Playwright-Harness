import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, unlinkSync, readdirSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import sql from 'mssql';
import {createRun} from '../scripts/lib/execution-core/index.mjs';
import {createDatabaseRuntime, defineDatabaseOperation} from '../scripts/lib/database/index.mjs';
import {bindDatabase} from '../scripts/lib/database/definition.mjs';
import {deriveDbCandidate, readDbCandidate, listDbCandidates, reviewDbCandidate, readReviewedDb, listReviewedDbs, promoteDiscoveredQueries, readDbDiscoverySummary} from '../scripts/lib/database/discovery.mjs';

const privateValue = 'CustomerPrivateLookupSentinel';
const metadataRow = (kind, extra = {}) => ({kind, tableName: 'Items', columnName: null, ordinal: 0, typeName: null, nullable: null, length: null, precision: null, scale: null, keyName: null, primaryKey: null, referencedSchema: null, referencedTable: null, referencedColumn: null, supported: true, ...extra});
const metadataRows = () => [metadataRow('table'), metadataRow('column', {columnName: 'Id', ordinal: 1, typeName: 'int', nullable: false, length: 4, precision: 10, scale: 0}), metadataRow('column', {columnName: 'Label', ordinal: 2, typeName: 'nvarchar', nullable: false, length: 200, precision: 0, scale: 0}), metadataRow('key', {columnName: 'Id', ordinal: 1, keyName: 'PK_Items', primaryKey: true})];
function native(t, records = metadataRows()) {
  const calls = [];
  class Pool extends EventEmitter {async connect() {} async close() {}}
  class Request extends EventEmitter {
    constructor() {super(); this.bindings = {};}
    input(name, type, value) {this.bindings[name] = value; return this;}
    cancel() {}
    async query(text) {
      calls.push({text, bindings: this.bindings});
      if (!this.stream) return {recordsets: [[{databaseName: 'HarnessDiscovery', defaultSchema: 'discovery'}], [], [], [], []]};
      const rows = text.includes('sys.tables') ? records : [{Id: this.bindings.key1, Label: privateValue}];
      this.emit('recordset', Object.fromEntries(Object.keys(rows[0] ?? {}).map(name => [name, {type: {name: 'NVarChar'}}])));
      for (const row of rows) this.emit('row', row);
      return {rowsAffected: [rows.length]};
    }
  }
  t.mock.method(sql, 'ConnectionPool', function () {return new Pool();}); t.mock.method(sql, 'Request', function () {return new Request();}); return calls;
}
const environment = {name: 'qa', environmentMode: 'test', apiTargets: [], databaseTargets: ['db'], capabilities: {}, targets: {api: {}, databases: {db: {engine: 'sqlserver', server: 'localhost', database: 'HarnessDiscovery', schema: 'discovery', connectionRef: 'env:DISCOVERY_DB'}}}};
const expectations = operationId => [{id: 'found', description: 'The selected item exists once.', operationId, invocationId: operationId, requiredEvidence: ['response', 'assertion']}, {id: 'label', description: 'The item has its source-defined label.', operationId, invocationId: operationId, requiredEvidence: ['response', 'assertion']}];
function scope(roots, operation, {identity = 7, target = environment, expectations: selected = expectations(operation?.id ?? 'lookup'), additionalOperations = [], omitExpectedLabel = false, scenarioId = 'case'} = {}) {
  const runId = `run-${randomUUID()}`, runRoots = {...roots, runRoot: join(roots.projectRoot, '.harness/runs', runId)};
  const values = [['recordId', identity], ['expectedCount', 1], ['expectedLabel', privateValue]].filter(([name]) => !omitExpectedLabel || name !== 'expectedLabel').map(([name, value]) => ({name, type: typeof value, sensitivity: 'public', value, producer: {runId, scenarioId, name}}));
  const run = createRun({id: runId, environment: target, operations: [...additionalOperations, ...(operation ? [operation] : [])], scenarios: [{id: scenarioId, expectations: selected}], values});
  const runtime = createDatabaseRuntime(run, runRoots, {resolveCredential: () => ({user: 'discovery_runner', password: '<private-connection-sentinel>'}), storeSensitive: () => 'protected:lookup-result'});
  return {run, roots: runRoots, runtime};
}
async function setup(t, {records = metadataRows(), operationId = 'lookup', change = {}} = {}) {
  const calls = native(t, records), directory = mkdtempSync(join(tmpdir(), 'harness-db-discovery-')), roots = {projectRoot: join(directory, 'consumer'), packageRoot: resolve('.')};
  mkdirSync(roots.projectRoot); t.after(() => rmSync(directory, {recursive: true, force: true}));
  writeFileSync(join(roots.projectRoot, 'source.md'), 'Selected source: look up the exact scenario identity and verify its expected label.');
  writeFileSync(join(roots.projectRoot, 'review.md'), 'Reviewed lookup purpose, source-bound identity and expectations, native types, exact table key, tenant/status semantics and no mutation effects.');
  const discovery = scope(roots, undefined, {expectations: expectations(operationId)});
  const schema = await discovery.runtime.inspectSchema({target: 'db', operationId, invocationId: operationId, tables: ['Items']});
  const request = {schema, operationId, invocationId: operationId, table: 'Items', purpose: 'Find the selected item', key: [{column: 'Id', input: 'recordId'}], columns: ['Id', 'Label'], checks: [{id: 'found', input: 'expectedCount'}, {id: 'label', column: 'Label', input: 'expectedLabel'}], extract: [{name: 'labelValue', column: 'Label', sensitivity: 'sensitive'}], source: {artifact: 'source.md', scenarioId: 'case'}, ...change};
  return {roots, discovery, schema, request, calls, records, candidate: () => deriveDbCandidate(discovery.run, discovery.roots, request)};
}
async function verified(f, candidate = f.candidate(), change = {}) {
  const validation = scope(f.roots, candidate.operation), attempt = await validation.runtime.execute({operation: candidate.operation, invocationId: candidate.operation.id, inputs: validation.run.inputs.values});
  assert.equal(validation.runtime.finish().status, 'PASS');
  const request = {candidateId: candidate.id, review: {reviewer: 'independent-reviewer', artifact: 'review.md', purpose: 'Find the selected item', inputs: 'The identity belongs to the selected scenario.', extraction: 'Only explicitly selected outputs are extracted.', semantics: 'The source establishes identity, expected label and tenant/status rules; this SELECT has no mutation effects.'}, validation: {...validation, observations: JSON.parse(readFileSync(join(validation.roots.runRoot, 'observations.json'), 'utf8')), attemptId: attempt.identity.attemptId}, ...change};
  return {record: reviewDbCandidate(f.roots, request), validation, request};
}
async function fresh(f, record, options = {}) {
  const context = scope(f.roots, record.operation, options), schema = await context.runtime.inspectSchema({target: 'db', operationId: record.operation.id, invocationId: record.operation.id, tables: ['Items']});
  return {...context, schema};
}
async function additionalCandidate(f, operationId, change = {}) {
  const discovery = scope(f.roots, undefined, {expectations: expectations(operationId)}), schema = await discovery.runtime.inspectSchema({target: 'db', operationId, invocationId: operationId, tables: ['Items']});
  return deriveDbCandidate(discovery.run, discovery.roots, {...f.request, schema, operationId, invocationId: operationId, ...change});
}
const libraryMetadata = path => JSON.parse(/^<!-- harness-discovered-db (.+) -->\n/.exec(readFileSync(path, 'utf8'))[1]);

test('no query library derives a bounded parameterized ordinary operation without retaining values', async t => {
  const f = await setup(t), candidate = f.candidate();
  assert.match(candidate.path, /knowledge-candidates[\\/]db[\\/]records/);
  assert.equal(candidate.operation.source.kind, 'helper');
  assert.equal(candidate.operation.definition.sql, 'SELECT [Id], [Label] FROM [discovery].[Items] WHERE [Id] = @key1');
  assert.deepEqual(candidate.operation.definition.parameters, [{name: 'key1', input: 'recordId', type: 'int'}]);
  assert.equal(candidate.operation.definition.maxRows, 1);
  assert.deepEqual(candidate.operation.definition.checks[1].equals, {$input: 'expectedLabel'});
  const bound = bindDatabase(candidate.operation.definition, new Map([['recordId', 15]])); assert.equal(bound.parameters[0].value, 15);
  assert.equal(listDbCandidates(f.roots, {runId: f.discovery.run.id}).length, 1);
  const bytes = readFileSync(candidate.path, 'utf8');
  for (const value of [privateValue, 'private-connection-sentinel', 'discovery_runner']) assert(!bytes.includes(value));
});

test('complete nonnullable unique keys and explicit verified outputs are required', async t => {
  const f = await setup(t);
  for (const change of [{key: []}, {key: [{column: 'Label', input: 'recordId'}]}, {columns: ['Unknown']}, {columns: ['*']}, {sql: 'DELETE FROM Items'}, {checks: [{id: 'found', equals: 1}]}, {extract: [{name: 'unseen', column: 'Unknown'}]}]) {
    assert.throws(() => deriveDbCandidate(f.discovery.run, f.discovery.roots, {...f.request, ...change}));
  }
  const records = metadataRows(); records[1].nullable = true;
  const nullable = await setup(t, {records}); assert.throws(() => nullable.candidate(), /nullable|unique|key/i);
});

test('composite keys retain native lengths and refuse incomplete identities', async t => {
  const records = metadataRows(); records.push(metadataRow('key', {columnName: 'Label', ordinal: 2, keyName: 'PK_Items', primaryKey: true}));
  const f = await setup(t, {records}); assert.throws(() => f.candidate(), /unique|key/i);
  const candidate = deriveDbCandidate(f.discovery.run, f.discovery.roots, {...f.request, key: [{column: 'Label', input: 'labelIdentity'}, {column: 'Id', input: 'recordId'}]});
  assert.deepEqual(candidate.operation.definition.parameters, [{name: 'key1', input: 'labelIdentity', type: 'nvarchar', length: 100}, {name: 'key2', input: 'recordId', type: 'int'}]);
});

for (const type of ['xml', 'geography', 'money']) test(`unsupported ${type} schema types cannot become discovered operations`, async t => {
  const records = metadataRows(); records[2].typeName = type;
  const f = await setup(t, {records}); assert.throws(() => f.candidate(), /type|unsupported/i);
});

test('forged, cross-run and altered schema evidence cannot derive a candidate', async t => {
  const f = await setup(t);
  assert.throws(() => deriveDbCandidate(f.discovery.run, f.discovery.roots, {...f.request, schema: JSON.parse(JSON.stringify(f.schema))}), /runtime|schema/i);
  const another = scope(f.roots); assert.throws(() => deriveDbCandidate(another.run, another.roots, f.request), /run|schema|scope/i);
  writeFileSync(join(f.discovery.roots.runRoot, f.schema.evidence.path), '{}'); assert.throws(() => f.candidate(), /integrity|mismatch/i);
});

test('review requires a matching successful runtime, frozen source expectations and retained source artifact', async t => {
  const f = await setup(t), candidate = f.candidate();
  assert.throws(() => reviewDbCandidate(f.roots, {candidateId: candidate.id, review: {}, validation: {}}));
  const {record, request} = await verified(f, candidate);
  assert.equal(record.operation.fingerprint, candidate.operation.fingerprint); assert.equal(listReviewedDbs(f.roots).length, 1);
  assert.throws(() => readReviewedDb(f.roots, record.id), /fresh|schema/i);
  const changed = structuredClone(request.validation.observations); changed.scenarios[0].attempts[0].outcome = 'BLOCKED';
  assert.throws(() => reviewDbCandidate(f.roots, {...request, validation: {...request.validation, observations: changed}}));
  writeFileSync(join(f.roots.projectRoot, 'source.md'), 'Changed source'); assert.throws(() => readDbCandidate(f.roots, candidate.id), /source|changed/i);
});

test('fresh invocation reuses current reviewed operation with new per-run identity and detects schema drift', async t => {
  const f = await setup(t), {record} = await verified(f), current = await fresh(f, record, {identity: 28});
  const reusable = readReviewedDb(f.roots, record.id, {run: current.run, roots: current.roots, schema: current.schema});
  assert.equal(reusable.operation.fingerprint, record.operation.fingerprint);
  await current.runtime.execute({operation: reusable.operation, invocationId: reusable.operation.id, inputs: current.run.inputs.values});
  assert.equal(current.runtime.finish().status, 'PASS'); assert.equal(f.calls.at(-1).bindings.key1, 28);
  f.records[2].length = 400; const drifted = await fresh(f, record);
  assert.throws(() => readReviewedDb(f.roots, record.id, {run: drifted.run, roots: drifted.roots, schema: drifted.schema}), /drift|schema/i);
});

test('review and assertion evidence tampering invalidates historical inspection and reuse', async t => {
  const f = await setup(t), {record} = await verified(f);
  const proof = record.verification.evidence.find(item => item.kind === 'assertion');
  writeFileSync(join(f.roots.projectRoot, proof.path), '{}'); assert.throws(() => listReviewedDbs(f.roots), /evidence|integrity|changed/i);
  const g = await setup(t), reviewed = await verified(g); writeFileSync(join(g.roots.projectRoot, 'review.md'), 'Changed review');
  assert.throws(() => listReviewedDbs(g.roots), /review|changed/i);
  assert.equal(reviewed.record.status, 'reviewed-verified');
});

test('promotion is incremental, deduplicated, sanitized and preserves supplied exports', async t => {
  const f = await setup(t), {record} = await verified(f), directory = join(f.roots.projectRoot, 'resources/Queries'); mkdirSync(directory, {recursive: true});
  const supplied = '-- supplied team query bytes\r\nSELECT * FROM legacy;\r\n'; writeFileSync(join(directory, 'team.sql'), supplied);
  const result = await promoteDiscoveredQueries(f.roots, {application: 'orders', reviewedIds: [record.id]}), original = readFileSync(result.path, 'utf8');
  assert.match(original, /SELECT \[Id\], \[Label\]/); assert.match(original, /reviewed-verified/); assert(!original.includes(privateValue)); assert(!original.includes('private-connection-sentinel'));
  await promoteDiscoveredQueries(f.roots, {application: 'orders', reviewedIds: [record.id]}); assert.equal(readFileSync(result.path, 'utf8'), original);
  assert.equal(readFileSync(join(directory, 'team.sql'), 'utf8'), supplied);
  const summary = readDbDiscoverySummary(f.roots, {runIds: [f.discovery.run.id]}); assert.equal(summary.candidates.length, 1); assert.equal(summary.reviewed.length, 1); assert.equal(summary.libraries[0].path, 'resources/Queries/orders-discovered.md');
});

test('promotion refuses active or interrupted writers, drift and unowned files without corrupting output', async t => {
  const f = await setup(t), {record} = await verified(f), request = {application: 'orders', reviewedIds: [record.id]}, result = await promoteDiscoveredQueries(f.roots, request), before = readFileSync(result.path, 'utf8');
  writeFileSync(result.path + '.lock', 'interrupted-or-active'); await assert.rejects(promoteDiscoveredQueries(f.roots, request)); assert.equal(readFileSync(result.path, 'utf8'), before); unlinkSync(result.path + '.lock');
  writeFileSync(join(f.roots.projectRoot, 'resources/Queries/.orders-discovered-interrupted.tmp'), 'partial');
  await promoteDiscoveredQueries(f.roots, request); assert.equal(readFileSync(result.path, 'utf8'), before);
  writeFileSync(result.path, before.replace('Find the selected item', 'Changed query purpose')); await assert.rejects(promoteDiscoveredQueries(f.roots, request), /integrity|drift/i);
  writeFileSync(result.path, '# Team-owned document\n'); await assert.rejects(promoteDiscoveredQueries(f.roots, request), /owned|origin/i);
  assert.equal(readFileSync(result.path, 'utf8'), '# Team-owned document\n');
});

test('candidate/source failures become scoped discovery gaps without changing execution verdicts', async t => {
  const f = await setup(t), candidate = f.candidate(); writeFileSync(candidate.path, '{}');
  const summary = readDbDiscoverySummary(f.roots, {runIds: [f.discovery.run.id]}); assert(summary.gaps.length > 0); assert.equal(summary.candidates.length, 0);
  assert(!Object.hasOwn(summary, 'status')); assert(!Object.hasOwn(summary, 'verdict'));
  assert.equal(readdirSync(join(f.roots.projectRoot, '.harness/knowledge-candidates/db/records')).length, 1);
});

test('column-only source expectations stay unchanged without an invented row-count requirement', async t => {
  const f = await setup(t), selected = expectations('lookup').filter(item => item.id === 'label'), discovery = scope(f.roots, undefined, {expectations: selected});
  const schema = await discovery.runtime.inspectSchema({target: 'db', operationId: 'lookup', invocationId: 'lookup', tables: ['Items']});
  const candidate = deriveDbCandidate(discovery.run, discovery.roots, {...f.request, schema, checks: [{id: 'label', column: 'Label', input: 'expectedLabel'}]});
  assert.deepEqual(candidate.operation.definition.checks, [{id: 'label', select: {from: 'rows', path: [0, 'Label']}, equals: {$input: 'expectedLabel'}}]);
  assert.equal(candidate.operation.definition.maxRows, 1);
  const validation = scope(f.roots, candidate.operation, {expectations: selected});
  await validation.runtime.execute({operation: candidate.operation, invocationId: 'lookup', inputs: validation.run.inputs.values});
  assert.equal(validation.runtime.finish().status, 'PASS');
});

test('equivalent operation identities deduplicate, variants persist and stable-ID conflicts preserve the library', async t => {
  const f = await setup(t), first = await verified(f), initial = await promoteDiscoveredQueries(f.roots, {application: 'orders', reviewedIds: [first.record.id]});
  const equivalent = await verified(f, await additionalCandidate(f, 'lookup-again'));
  const same = await promoteDiscoveredQueries(f.roots, {application: 'orders', reviewedIds: [equivalent.record.id]});
  assert.equal(same.queries, 1); assert.equal(libraryMetadata(same.path).representatives[0].reviewedId, first.record.id);
  assert.match(readFileSync(same.path, 'utf8'), /\n## lookup\n/); assert.doesNotMatch(readFileSync(same.path, 'utf8'), /\n## lookup-again\n/);
  const variant = await verified(f, await additionalCandidate(f, 'lookup-label', {columns: ['Label']}));
  const expanded = await promoteDiscoveredQueries(f.roots, {application: 'orders', reviewedIds: [variant.record.id]});
  assert.equal(expanded.queries, 2); assert.equal(libraryMetadata(initial.path).reviewedIds.length, 3);
  const conflict = await verified(f, await additionalCandidate(f, 'lookup', {columns: ['Label']})), before = readFileSync(initial.path, 'utf8');
  await assert.rejects(promoteDiscoveredQueries(f.roots, {application: 'orders', reviewedIds: [conflict.record.id]}), /conflict/i);
  assert.equal(readFileSync(initial.path, 'utf8'), before);
});

test('a passing lookup cannot promote an earlier observed output into its expected-value source', async t => {
  const f = await setup(t), candidate = f.candidate(), valid = await verified(f, candidate);
  const producer = defineDatabaseOperation({id: 'observe-label', target: 'db', source: {kind: 'helper', reference: 'fixture-observation', version: '1'}, engine: 'sqlserver',
    sql: candidate.operation.definition.sql, parameters: candidate.operation.definition.parameters,
    checks: [{id: 'producer-found', select: {from: 'rowCount', path: []}, equals: {$input: 'expectedCount'}}], extract: [{name: 'observedLabel', type: 'string', sensitivity: 'public', select: {from: 'rows', path: [0, 'Label']}}]});
  const validation = scope(f.roots, candidate.operation, {additionalOperations: [producer], omitExpectedLabel: true,
    expectations: [...expectations('lookup'), {id: 'producer-found', description: 'Read the selected item as an observation.', operationId: producer.id, invocationId: producer.id, requiredEvidence: ['response', 'assertion']}]});
  const observed = await validation.runtime.execute({operation: producer, invocationId: producer.id, inputs: validation.run.inputs.values});
  const attempt = await validation.runtime.execute({operation: candidate.operation, invocationId: 'lookup', inputs: [...validation.run.inputs.values, {...observed.outputs[0], name: 'expectedLabel'}]});
  assert.equal(validation.runtime.finish().status, 'PASS');
  assert.throws(() => reviewDbCandidate(f.roots, {...valid.request, validation: {...validation, observations: JSON.parse(readFileSync(join(validation.roots.runRoot, 'observations.json'), 'utf8')), attemptId: attempt.identity.attemptId}}), /frozen source inputs|observed outputs/i);
});

test('competing promotion processes preserve valid output and merge the retried verified union', async t => {
  const f = await setup(t), first = await verified(f), equivalent = await verified(f, await additionalCandidate(f, 'lookup-again')), variant = await verified(f, await additionalCandidate(f, 'lookup-label', {columns: ['Label']}));
  const initial = await promoteDiscoveredQueries(f.roots, {application: 'orders', reviewedIds: [first.record.id]});
  const code = `import {promoteDiscoveredQueries} from ${JSON.stringify(new URL('../scripts/lib/database/discovery.mjs', import.meta.url).href)};
const {roots, request} = JSON.parse(process.argv[1]);
try {const result = await promoteDiscoveredQueries(roots, request); process.stdout.write(result.status);}
catch (error) {if (error.code !== 'EEXIST') throw error; process.stdout.write('CONTENDED');}`;
  const execute = promisify(execFile), results = await Promise.all([equivalent.record, variant.record].map(record => execute(process.execPath, ['--input-type=module', '-e', code, JSON.stringify({roots: f.roots, request: {application: 'orders', reviewedIds: [record.id]}})], {windowsHide: true, timeout: 15000})));
  assert(results.every(result => ['PROMOTED', 'CONTENDED'].includes(result.stdout)));
  assert(libraryMetadata(initial.path).reviewedIds.includes(first.record.id));
  const merged = await promoteDiscoveredQueries(f.roots, {application: 'orders', reviewedIds: [equivalent.record.id, variant.record.id]});
  assert.equal(merged.queries, 2); assert.equal(libraryMetadata(initial.path).reviewedIds.length, 3);
  assert.equal(libraryMetadata(initial.path).representatives.find(item => item.reviewedId === first.record.id)?.reviewedId, first.record.id);
});

test('fresh cross-case reuse reports its query and saved library without claiming a runtime pass', async t => {
  const f = await setup(t), {record} = await verified(f), promotion = await promoteDiscoveredQueries(f.roots, {application: 'orders', reviewedIds: [record.id]});
  const historical = readDbDiscoverySummary(f.roots, {scenarioIds: ['case']});
  assert.equal(historical.reviewed[0].candidateId, record.candidateId); assert.equal(historical.reused.length, 0);
  const current = await fresh(f, record, {identity: 44, scenarioId: 'later-case'});
  const selected = {runIds: [current.run.id], scenarioIds: ['later-case']};
  assert.equal(readDbDiscoverySummary(f.roots, selected).reused.length, 0);
  readReviewedDb(f.roots, record.id, {run: current.run, roots: current.roots, schema: current.schema});
  const summary = readDbDiscoverySummary(f.roots, selected);
  assert.equal(summary.candidates.length, 0); assert.equal(summary.reviewed.length, 0); assert.equal(summary.reused.length, 1);
  assert.deepEqual({reviewedId: summary.reused[0].reviewedId, candidateId: summary.reused[0].candidateId, operationId: summary.reused[0].operationId, status: summary.reused[0].status},
    {reviewedId: record.id, candidateId: record.candidateId, operationId: 'lookup', status: 'schema-checked'});
  assert.equal(summary.libraries[0].path, 'resources/Queries/orders-discovered.md'); assert(!Object.hasOwn(summary, 'verdict'));
  const usages = join(f.roots.projectRoot, '.harness/state/db-reuse/records'), files = readdirSync(usages);
  assert.equal(files.length, 1); const bytes = readFileSync(join(usages, files[0]), 'utf8'); assert(!bytes.includes(privateValue)); assert(!bytes.includes('private-connection-sentinel'));
  readReviewedDb(f.roots, record.id, {run: current.run, roots: current.roots, schema: current.schema}); assert.equal(readdirSync(usages).length, 1);
  assert.equal(libraryMetadata(promotion.path).reviewedIds.length, 1);
  const untouched = scope(f.roots, record.operation, {scenarioId: 'later-case'});
  assert.equal(readDbDiscoverySummary(f.roots, {runIds: [untouched.run.id], scenarioIds: ['later-case']}).reused.length, 0, 'An earlier use in the same case must not claim reuse in a later untouched run.');
  writeFileSync(join(current.roots.runRoot, current.schema.evidence.path), '{}');
  const tampered = readDbDiscoverySummary(f.roots, selected); assert.equal(tampered.reused.length, 0); assert.equal(tampered.libraries.length, 0); assert(tampered.gaps.length > 0);
  assert.equal(listReviewedDbs(f.roots).length, 1, 'Current-use evidence must not rewrite the historical reviewed authority.');
});

test('reuse binds exact current evidence storage to its consumer and detects receipt tampering', async t => {
  const f = await setup(t), {record} = await verified(f), current = await fresh(f, record, {scenarioId: 'later-case'}), another = await fresh(f, record, {scenarioId: 'other-case'});
  assert.throws(() => readReviewedDb(f.roots, record.id, {run: current.run, schema: current.schema}), /roots|storage/i);
  assert.throws(() => readReviewedDb(f.roots, record.id, {run: current.run, roots: another.roots, schema: current.schema}), /evidence|missing|storage/i);
  const foreignRoot = join(f.roots.projectRoot, 'foreign-consumer'); mkdirSync(foreignRoot);
  assert.throws(() => readReviewedDb(f.roots, record.id, {run: current.run, roots: {...current.roots, projectRoot: foreignRoot}, schema: current.schema}), /consumer/i);
  readReviewedDb(f.roots, record.id, current);
  const directory = join(f.roots.projectRoot, '.harness/state/db-reuse/records'), path = join(directory, readdirSync(directory)[0]), value = JSON.parse(readFileSync(path, 'utf8'));
  value.reviewedId = 'a'.repeat(64); writeFileSync(path, JSON.stringify(value));
  const summary = readDbDiscoverySummary(f.roots, {scenarioIds: ['later-case']}); assert.equal(summary.reused.length, 0); assert(summary.gaps.length > 0);
});
