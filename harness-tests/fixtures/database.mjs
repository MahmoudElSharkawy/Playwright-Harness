import {mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
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
