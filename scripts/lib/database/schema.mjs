import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {registerEvidence, verifyEvidence} from '../execution-core/evidence.mjs';
import {data, fingerprint, frozen, id, integer, keys, oneOf, requireThat, unique} from '../execution-core/data.mjs';
import {requireScenarioState, writeScenario, checkWorkWindow, rememberSensitive, publicValue, requireObservationCapacity} from '../sequential/state.mjs';
import {validateTarget, inspectSqlServer} from './sqlserver-driver.mjs';
import {bounded, credentials, DatabaseFailure} from './shared.mjs';

const receipts = new WeakMap(), budgets = new WeakMap();
const MAX_TABLES = 8, MAX_METADATA_ROWS = 512, MAX_METADATA_BYTES = 262144;
const phases = {SETUP: 0, EXERCISE: 1, VERIFY: 2};

function name(value) {
  requireThat(typeof value === 'string' && value.length > 0 && value.length <= 128 && value.trim().length > 0
    && !/[\x00-\x1f]/.test(value) && !value.startsWith('#'), 'DB_SCHEMA_SCOPE_DENIED: metadata needs ordinary exact names.');
  return value;
}

function tableMetadata(rows, tableName) {
  requireThat(Array.isArray(rows) && rows.length > 0 && rows.length < MAX_METADATA_ROWS, 'DB_SCHEMA_METADATA_UNAVAILABLE: table metadata is absent or incomplete.');
  const tableRows = rows.filter(row => row.kind === 'table');
  requireThat(tableRows.length === 1 && tableRows[0].supported === true, 'DB_SCHEMA_METADATA_UNAVAILABLE: ordinary table SELECT metadata is required.');
  const columns = [], uniqueKeys = new Map(), foreignKeys = new Map();
  for (const row of rows) {
    requireThat(row.tableName === tableName && row.supported === true, 'DB_SCHEMA_METADATA_UNAVAILABLE: unsupported or ambiguous metadata.');
    oneOf(row.kind, ['table', 'column', 'key', 'foreignKey']);
    if (row.kind === 'table') continue;
    name(row.columnName); requireThat(integer(row.ordinal, 1, 32767), 'DB_SCHEMA_METADATA_UNAVAILABLE: invalid metadata ordinal.');
    if (row.kind === 'column') {
      name(row.typeName);
      requireThat(typeof row.nullable === 'boolean' && integer(row.length, -1, 8000) && integer(row.precision, 0, 38) && integer(row.scale, 0, 38), 'DB_SCHEMA_METADATA_UNAVAILABLE: unsupported column metadata.');
      columns.push({name: row.columnName, ordinal: row.ordinal, type: row.typeName, nullable: row.nullable, length: row.length, precision: row.precision, scale: row.scale});
    } else {
      name(row.keyName); const groups = row.kind === 'key' ? uniqueKeys : foreignKeys;
      if (row.kind === 'key') requireThat(typeof row.primaryKey === 'boolean', 'DB_SCHEMA_METADATA_UNAVAILABLE: incomplete unique key.');
      else {name(row.referencedSchema); name(row.referencedTable); name(row.referencedColumn);}
      const group = groups.get(row.keyName) ?? []; group.push(row); groups.set(row.keyName, group);
    }
  }
  requireThat(columns.length > 0, 'DB_SCHEMA_METADATA_UNAVAILABLE: column metadata is missing.');
  unique(columns.map(column => column.name), 'schema columns'); unique(columns.map(column => column.ordinal), 'column ordinals');
  columns.sort((a, b) => a.ordinal - b.ordinal);
  function ordered(group) {
    group.sort((a, b) => a.ordinal - b.ordinal);
    requireThat(group.every((row, index) => row.ordinal === index + 1 && columns.some(column => column.name === row.columnName)), 'DB_SCHEMA_METADATA_UNAVAILABLE: incomplete ordered key.');
    unique(group.map(row => row.columnName), 'key columns'); return group;
  }
  const compare = ([a], [b]) => a < b ? -1 : a > b ? 1 : 0;
  const keys = [...uniqueKeys].sort(compare).map(([keyName, group]) => {
    ordered(group); requireThat(group.every(row => row.primaryKey === group[0].primaryKey), 'DB_SCHEMA_METADATA_UNAVAILABLE: inconsistent unique key.');
    return {name: keyName, primary: group[0].primaryKey, columns: group.map(row => row.columnName)};
  });
  const relationships = [...foreignKeys].sort(compare).map(([keyName, group]) => {
    ordered(group); const first = group[0];
    requireThat(group.every(row => row.referencedSchema === first.referencedSchema && row.referencedTable === first.referencedTable), 'DB_SCHEMA_METADATA_UNAVAILABLE: inconsistent relationship.');
    return {name: keyName, columns: group.map(row => row.columnName), referencedSchema: first.referencedSchema, referencedTable: first.referencedTable, referencedColumns: group.map(row => row.referencedColumn)};
  });
  return {name: tableName, columns, uniqueKeys: keys, foreignKeys: relationships};
}

/** Internal runtime entry: the branded scenario state prevents standalone fabricated receipts. */
export async function inspectDatabaseSchema(state, options, {signal, resolveCredential} = {}) {
  requireScenarioState(state, state.run, state.roots);
  requireThat(!state.busy && !state.finished && state.storageReady, 'DB_SCHEMA_SCOPE_DENIED: metadata needs an idle active sequential runtime.');
  keys(options, ['target', 'operationId', 'invocationId', 'tables', 'tableHint', 'phase'], 'schema inspection');
  const {run, scope, roots} = state, {target: targetId, operationId, invocationId} = options, phase = options.phase ?? 'EXERCISE';
  for (const value of [targetId, operationId, invocationId]) id(value);
  oneOf(phase, Object.keys(phases));
  requireThat(phases[phase] >= state.phaseNumber, 'DB_SCHEMA_SCOPE_DENIED: metadata cannot move to an earlier phase.');
  requireThat(scope.expectations.some(item => item.operationId === operationId && item.invocationId === invocationId && (item.phase === undefined || item.phase === phase)), 'DB_SCHEMA_SCOPE_DENIED: metadata must serve a selected scenario expectation.');
  const target = run.inputs.environment.targets.databases[targetId];
  requireThat(target, 'DB_SCHEMA_SCOPE_DENIED: database target is not selected.');
  const known = [...run.inputs.operations, ...state.observations.operations].find(item => item.id === operationId);
  requireThat(!known || known.family === 'database' && known.target === targetId, 'DB_SCHEMA_SCOPE_DENIED: metadata target differs from the selected operation.');
  requireThat(run.inputs.environment.capabilities.dbSelect && run.inputs.environment.capabilities.dbExploration, 'DB_SCHEMA_SCOPE_DENIED: dbSelect and dbExploration capabilities are required.');
  requireThat(target.engine === 'sqlserver', 'DB_SCHEMA_UNSUPPORTED_ENGINE: automatic discovery supports SQL Server only.');
  validateTarget(target);
  const hasTables = Object.hasOwn(options, 'tables'), hasHint = Object.hasOwn(options, 'tableHint'), tableHint = options.tableHint;
  requireThat(hasTables !== hasHint, 'DB_SCHEMA_SCOPE_DENIED: select exact tables or one literal table hint.');
  if (hasTables) {
    requireThat(Array.isArray(options.tables) && options.tables.length > 0 && options.tables.length <= MAX_TABLES, 'DB_SCHEMA_SCOPE_DENIED: inspect one to eight explicit tables.');
    options.tables.forEach(name); unique(options.tables, 'metadata tables');
  } else requireThat(typeof tableHint === 'string' && tableHint.trim().length >= 3 && tableHint.length <= 128 && !/[\x00-\x1f]/.test(tableHint), 'DB_SCHEMA_SCOPE_DENIED: a literal table hint needs three to 128 characters.');
  const selectedTables = hasTables ? [...options.tables] : [];
  const window = checkWorkWindow(state, {phase, signal});
  requireThat(window.allowed, 'DB_SCHEMA_UNAVAILABLE: cancelled or expired metadata work window.');
  requireObservationCapacity(state);
  const budget = budgets.get(run) ?? {inspections: 0, tables: new Set()}, selected = new Set([...budget.tables, ...selectedTables.map(table => `${targetId}/${table}`)]);
  requireThat(budget.inspections < 8 && selected.size <= MAX_TABLES, 'DB_SCHEMA_SCOPE_DENIED: cumulative scenario metadata limit reached.');
  const nextBudget = {inspections: budget.inspections + 1, tables: selected}; budgets.set(run, nextBudget);
  requireThat(typeof resolveCredential === 'function', 'DB_SCHEMA_METADATA_UNAVAILABLE: credential resolver is required.');
  const controller = new AbortController(), cancel = () => controller.abort('CANCELLED'), timeoutMs = Math.min(window.remainingMs, 10000);
  const timer = setTimeout(() => controller.abort('TIMEOUT'), timeoutMs); signal?.addEventListener('abort', cancel, {once: true});
  state.busy = true; state.phaseNumber = phases[phase];
  try {
    const auth = credentials(await bounded(() => resolveCredential({reference: target.connectionRef, target: targetId,
      destination: {server: target.server, port: target.port ?? 1433, database: target.database, schema: target.schema}, signal: controller.signal}), controller.signal));
    rememberSensitive(state, auth.user); rememberSensitive(state, auth.password);
    if (hasHint) {
      const response = await inspectSqlServer(target, auth, 'tableHint', tableHint,
      {signal: controller.signal, timeoutMs, maxRows: MAX_TABLES + 1, maxResponseBytes: 8192});
      requireThat(response.rows.length > 0, 'DB_SCHEMA_TABLE_NOT_FOUND: no visible table matches the selected scenario hint.');
      requireThat(response.rows.length <= MAX_TABLES, 'DB_SCHEMA_TABLE_HINT_AMBIGUOUS: narrow the scenario hint before inspecting table details.');
      selectedTables.push(...response.rows.map(row => name(row.tableName))); unique(selectedTables, 'discovered table names');
      const matched = new Set([...nextBudget.tables, ...selectedTables.map(table => `${targetId}/${table}`)]);
      requireThat(matched.size <= MAX_TABLES, 'DB_SCHEMA_SCOPE_DENIED: cumulative scenario metadata limit reached.'); nextBudget.tables = matched;
    }
    const tables = [];
    for (const tableName of selectedTables.sort()) {
      const response = await inspectSqlServer(target, auth, 'tableName', tableName, {signal: controller.signal, timeoutMs, maxRows: MAX_METADATA_ROWS, maxResponseBytes: MAX_METADATA_BYTES});
      tables.push(tableMetadata(response.rows, tableName));
    }
    requireThat(!controller.signal.aborted && checkWorkWindow(state, {phase, signal}).allowed, 'DB_SCHEMA_UNAVAILABLE: metadata work window ended.');
    const metadata = {engine: 'sqlserver', database: target.database, schema: target.schema, tables};
    const schema = frozen(data({version: 1, runId: run.id, inputFingerprint: run.inputFingerprint, scenarioId: scope.id, operationId, invocationId,
      target: targetId, targetFingerprint: fingerprint(target), ...metadata, fingerprint: fingerprint(metadata)}, MAX_METADATA_BYTES));
    // Metadata identifiers can still contain credential values; use the runtime's known-value screen.
    publicValue(state, schema);
    const artifactId = `artifact-${randomUUID()}`, path = `evidence/${artifactId}.json`;
    writeScenario(state, path, schema);
    const evidence = registerEvidence(run, roots, {id: artifactId, identity: {runId: run.id, scenarioId: scope.id, operationId, invocationId,
      attemptId: `schema-${randomUUID()}`, phase, number: 1}, kind: 'observation', path, sanitized: true});
    // Discovery evidence does not invent a business attempt or change the execution verdict.
    const receipt = frozen({schema, evidence}); receipts.set(receipt, {run, roots}); return receipt;
  } catch (error) {
    if (typeof error?.message === 'string' && error.message.startsWith('DB_SCHEMA_')) throw error;
    const reason = error instanceof DatabaseFailure && ['TIMEOUT', 'CANCELLED', 'UNAVAILABLE'].includes(error.classification) ? error.classification : 'METADATA_UNAVAILABLE';
    throw new Error(`DB_SCHEMA_${reason}: required bounded metadata could not be established.`);
  } finally {clearTimeout(timer); signal?.removeEventListener('abort', cancel); state.busy = false;}
}

/** Only live native-runtime receipts qualify; persisted evidence is checked again at every use. */
export function requireSchemaEvidence(receipt) {
  const context = receipts.get(receipt); requireThat(context, 'Schema evidence must come from the configured runtime.');
  const verified = verifyEvidence(context.run, context.roots, receipt.evidence);
  requireThat(fingerprint(JSON.parse(readFileSync(verified.actual, 'utf8'))) === fingerprint(receipt.schema), 'Schema evidence content mismatch.');
  return receipt;
}
