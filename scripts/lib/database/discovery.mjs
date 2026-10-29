import {mkdirSync, readFileSync, writeFileSync, readdirSync, lstatSync, existsSync, openSync, closeSync, unlinkSync, renameSync} from 'node:fs';
import {join, relative} from 'node:path';
import {randomUUID} from 'node:crypto';
import {consumerRoots, consumerPath} from '../consumer-paths.mjs';
import {data, digest, fingerprint, frozen, id, keys, integer, requireThat, unique} from '../execution-core/data.mjs';
import {requireRun} from '../execution-core/inputs.mjs';
import {assessRun, verifyEvidence} from '../execution-core/index.mjs';
import {reviewArtifact, protect} from '../generation/storage.mjs';
import {defineDatabaseOperation, validateDatabaseOperation} from './definition.mjs';
import {quoteIdentifier} from './sqlserver-syntax.mjs';
import {requireSchemaEvidence} from './schema.mjs';

const CANDIDATES = '.harness/knowledge-candidates/db', REVIEWED = '.harness/knowledge/db', REUSE = '.harness/state/db-reuse';
const MAX_RECORDS = 1000, MAX_BYTES = 1024 * 1024, MAX_LIBRARY = 4 * 1024 * 1024;
const location = (roots, path) => consumerPath(consumerRoots(roots.projectRoot, roots.packageRoot), path);
const relativePath = (roots, path) => relative(roots.projectRoot, path).replaceAll('\\', '/');
const hashId = value => requireThat(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'Invalid DB knowledge identity.');

function jsonFile(path, maximum = MAX_BYTES) {
  const stat = lstatSync(path);
  requireThat(stat.isFile() && !stat.isSymbolicLink() && integer(stat.size, 1, maximum), 'Invalid bounded DB knowledge file.');
  return data(JSON.parse(readFileSync(path, 'utf8')), maximum);
}
function immutable(roots, area, content) {
  const checked = data(content), recordId = fingerprint(checked), directory = location(roots, `${area}/records`);
  mkdirSync(directory, {recursive: true, mode: 0o700}); protect(directory);
  const path = location(roots, `${area}/records/${recordId}.json`), record = {id: recordId, ...checked};
  requireThat(existsSync(path) || readdirSync(directory).filter(name => name.endsWith('.json')).length < MAX_RECORDS, 'DB knowledge store limit reached.');
  try {writeFileSync(path, JSON.stringify(record, null, 2) + '\n', {flag: 'wx', mode: 0o600, flush: true});}
  catch (error) {if (error.code !== 'EEXIST') throw error; requireThat(fingerprint(jsonFile(path)) === fingerprint(record), 'Existing DB knowledge integrity changed.');}
  return frozen({...record, path});
}
function load(roots, area, recordId) {
  hashId(recordId); const path = location(roots, `${area}/records/${recordId}.json`), {id: stored, ...record} = jsonFile(path);
  requireThat(stored === recordId && fingerprint(record) === recordId, 'DB knowledge integrity changed.');
  return frozen({id: recordId, ...record, path});
}
function names(roots, area) {
  const directory = location(roots, `${area}/records`); if (!existsSync(directory)) return [];
  const entries = readdirSync(directory).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).sort();
  requireThat(entries.length <= MAX_RECORDS, 'DB knowledge store limit reached.'); return entries.map(name => name.slice(0, -5));
}
function unchangedArtifact(roots, artifact, label) {
  requireThat(fingerprint(reviewArtifact(roots, artifact.path)) === fingerprint(artifact), `${label} artifact changed.`);
}
function unchangedEvidence(roots, evidence) {
  const path = location(roots, evidence.path), stat = lstatSync(path);
  requireThat(stat.isFile() && !stat.isSymbolicLink() && stat.size === evidence.bytes && stat.size <= 64 * MAX_BYTES, 'DB verification evidence changed.');
  requireThat(digest(readFileSync(path)) === evidence.sha256, 'DB verification evidence integrity changed.'); return path;
}
function prose(value, label) {
  requireThat(typeof value === 'string' && value.trim().length > 0 && value.length <= 2000 && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value), `${label} needs bounded reviewed prose.`); return value;
}
function relevantSchema(schema, table) {
  const selected = schema.tables.find(item => item.name === table);
  requireThat(selected, 'DB_DISCOVERY_SCHEMA_GAP: selected table was not inspected.');
  return {engine: schema.engine, database: schema.database, schema: schema.schema, table: selected};
}
function columnType(column, binding = false) {
  const type = column.type.toLowerCase(), result = {type};
  requireThat(['nvarchar', 'varchar', 'int', 'bigint', 'bit', 'float', 'decimal', 'datetime2', 'uniqueidentifier', 'varbinary'].includes(type), 'DB_DISCOVERY_TYPE_GAP: unsupported native column type.');
  if (['nvarchar', 'varchar', 'varbinary'].includes(type)) {
    const length = type === 'nvarchar' ? column.length / 2 : column.length;
    requireThat(integer(length, 1, type === 'nvarchar' ? 4000 : 8000), 'DB_DISCOVERY_TYPE_GAP: unbounded or unsupported native length.'); result.length = length;
  }
  if (type === 'decimal') {
    requireThat(integer(column.precision, 1, 15) && integer(column.scale, 0, column.precision), 'DB_DISCOVERY_TYPE_GAP: decimal exceeds exact runtime support.');
    result.precision = column.precision; result.scale = column.scale;
  }
  if (type === 'datetime2' && binding) requireThat(column.scale === 3, 'DB_DISCOVERY_TYPE_GAP: datetime2 identity binding requires millisecond precision.');
  return result;
}
const outputType = column => ['int', 'float', 'decimal'].includes(column.type.toLowerCase()) ? 'number' : column.type.toLowerCase() === 'bit' ? 'boolean' : 'string';
function selectedExpectations(run, operationId, invocationId) {
  return run.inputs.scenarios.flatMap(scenario => scenario.expectations.filter(item => item.operationId === operationId && item.invocationId === invocationId).map(item => ({scenarioId: scenario.id, id: item.id, fingerprint: fingerprint(item)})));
}

/** Derive one exact-key SELECT from an authentic scoped metadata receipt, never caller SQL. */
export function deriveDbCandidate(run, roots, request) {
  requireRun(run);
  keys(request, ['schema', 'operationId', 'invocationId', 'table', 'purpose', 'key', 'columns', 'checks', 'extract', 'source'], 'DB discovery request');
  const receipt = requireSchemaEvidence(request.schema), schema = receipt.schema;
  for (const value of [request.operationId, request.invocationId]) id(value);
  requireThat(schema.runId === run.id && schema.inputFingerprint === run.inputFingerprint && schema.operationId === request.operationId && schema.invocationId === request.invocationId, 'DB discovery schema has the wrong run or operation scope.');
  requireThat(schema.engine === 'sqlserver' && run.inputs.environment.capabilities.dbSelect && run.inputs.environment.capabilities.dbExploration, 'DB discovery requires permitted SQL Server exploration.');
  const target = run.inputs.environment.targets.databases[schema.target];
  requireThat(target && fingerprint(target) === schema.targetFingerprint, 'DB discovery target changed.');
  const metadata = relevantSchema(schema, request.table), table = metadata.table;
  prose(request.purpose, 'DB discovery purpose');
  requireThat(Array.isArray(request.key) && request.key.length > 0 && request.key.length <= 16, 'DB discovery needs a complete unique key.');
  request.key.forEach(item => {keys(item, ['column', 'input'], 'DB identity binding'); id(item.input);});
  unique(request.key.map(item => item.column), 'identity columns'); unique(request.key.map(item => item.input), 'identity inputs');
  const keyNames = request.key.map(item => item.column).sort();
  requireThat(table.uniqueKeys.some(key => fingerprint([...key.columns].sort()) === fingerprint(keyNames)), 'DB_DISCOVERY_IDENTITY_GAP: bind a complete verified unique key.');
  const column = name => {const found = table.columns.find(item => item.name === name); requireThat(found, 'DB_DISCOVERY_SCHEMA_GAP: unknown selected column.'); columnType(found); return found;};
  const parameters = request.key.map((item, index) => {
    const found = column(item.column); requireThat(!found.nullable, 'DB_DISCOVERY_IDENTITY_GAP: nullable unique keys do not establish exact identity.');
    return {name: `key${index + 1}`, input: item.input, ...columnType(found, true)};
  });
  requireThat(Array.isArray(request.columns) && request.columns.length > 0 && request.columns.length <= 32, 'DB discovery needs explicit bounded outputs.');
  unique(request.columns, 'selected columns'); request.columns.forEach(column);
  requireThat(Array.isArray(request.checks) && request.checks.length > 0 && request.checks.length <= 32, 'DB discovery needs source-grounded checks.');
  const checks = request.checks.map(check => {
    keys(check, ['id', 'column', 'input'], 'DB discovery check'); id(check.id); id(check.input);
    requireThat(check.column === undefined || request.columns.includes(check.column), 'DB check needs an explicitly selected column.');
    return {id: check.id, select: check.column === undefined ? {from: 'rowCount', path: []} : {from: 'rows', path: [0, check.column]}, equals: {$input: check.input}};
  });
  unique(checks.map(check => check.id), 'DB discovery checks');
  requireThat(Array.isArray(request.extract ?? []) && (request.extract ?? []).length <= 32, 'DB extraction must be bounded.');
  const extract = (request.extract ?? []).map(item => {
    keys(item, ['name', 'column', 'sensitivity'], 'DB discovered output'); id(item.name);
    requireThat(request.columns.includes(item.column), 'DB extraction needs an explicitly selected column.');
    const selected = column(item.column); requireThat(!selected.nullable, 'DB_DISCOVERY_TYPE_GAP: nullable extraction needs a separately established result contract.');
    return {name: item.name, type: outputType(selected), sensitivity: item.sensitivity ?? 'sensitive', select: {from: 'rows', path: [0, item.column]}};
  });
  keys(request.source, ['artifact', 'scenarioId'], 'DB discovery source'); id(request.source.scenarioId);
  requireThat(request.source.scenarioId === schema.scenarioId, 'DB source scenario differs from its schema evidence.');
  const expectations = selectedExpectations(run, request.operationId, request.invocationId);
  requireThat(expectations.length === checks.length && expectations.every(item => item.scenarioId === schema.scenarioId && checks.some(check => check.id === item.id)), 'DB checks must preserve the selected source expectations.');
  const source = {artifact: reviewArtifact(roots, request.source.artifact), scenarioId: request.source.scenarioId, expectations};
  const operation = defineDatabaseOperation({id: request.operationId, target: schema.target, source: {kind: 'helper', reference: 'schema-backed-discovery', version: '1'}, engine: 'sqlserver',
    sql: `SELECT ${request.columns.map(quoteIdentifier).join(', ')} FROM ${quoteIdentifier(schema.schema)}.${quoteIdentifier(table.name)} WHERE ${request.key.map((item, index) => `${quoteIdentifier(item.column)} = @key${index + 1}`).join(' AND ')}`,
    parameters, checks, extract, maxRows: 1, maxResponseBytes: 65536, timeoutMs: 10000});
  const verified = verifyEvidence(run, roots, receipt.evidence);
  requireThat(fingerprint(jsonFile(verified.actual)) === fingerprint(schema), 'DB metadata content changed.');
  const content = {version: 1, status: 'unreviewed', purpose: request.purpose, operation, invocationId: request.invocationId, table: request.table, selectedColumns: [...request.columns],
    schema, schemaFingerprint: fingerprint(metadata), evidence: data(receipt.evidence), sourceRunRoot: relativePath(roots, roots.runRoot), environment: run.inputs.environment.name, source};
  // Structural derivation accepts no values. Also reject known text inputs accidentally copied into prose or names.
  const serialized = JSON.stringify(content);
  for (const value of run.inputs.values) if (value.sensitivity === 'public' && typeof value.value === 'string' && value.value.length >= 4) requireThat(!serialized.includes(value.value), 'DB candidate contains a scenario value; retain only structural knowledge.');
  return immutable(roots, CANDIDATES, content);
}

export function readDbCandidate(roots, candidateId) {
  const record = load(roots, CANDIDATES, candidateId); validateDatabaseOperation(record.operation);
  const path = unchangedEvidence(roots, {...record.evidence, path: `${record.sourceRunRoot}/${record.evidence.path}`});
  requireThat(fingerprint(jsonFile(path)) === fingerprint(record.schema) && fingerprint(relevantSchema(record.schema, record.table)) === record.schemaFingerprint, 'DB schema evidence content changed.');
  unchangedArtifact(roots, record.source.artifact, 'DB source'); return record;
}
export function listDbCandidates(roots, {runId, scenarioId} = {}) {
  return names(roots, CANDIDATES).map(recordId => load(roots, CANDIDATES, recordId)).filter(record => (runId === undefined || record.schema.runId === runId) && (scenarioId === undefined || record.schema.scenarioId === scenarioId)).map(record => readDbCandidate(roots, record.id));
}

/** Review attests business semantics; only matching assessed execution establishes verification. */
export function reviewDbCandidate(roots, {candidateId, review, validation}) {
  const candidate = readDbCandidate(roots, candidateId), operation = candidate.operation, checked = data(review);
  keys(checked, ['reviewer', 'artifact', 'purpose', 'inputs', 'extraction', 'semantics'], 'DB discovery review'); id(checked.reviewer);
  for (const name of ['purpose', 'inputs', 'extraction', 'semantics']) prose(checked[name], `DB review ${name}`);
  const artifact = reviewArtifact(roots, checked.artifact);
  requireThat(validation?.run && validation.roots && validation.observations, 'Configured DB validation is required.'); requireRun(validation.run);
  requireThat(consumerRoots(validation.roots.projectRoot, validation.roots.packageRoot).projectRoot === consumerRoots(roots.projectRoot, roots.packageRoot).projectRoot, 'DB validation must belong to this consumer.');
  const result = assessRun(validation.run, validation.roots, validation.observations), environment = validation.run.inputs.environment;
  const config = environment.targets.databases[operation.target];
  requireThat(environment.name === candidate.environment && config && fingerprint(config) === candidate.schema.targetFingerprint, 'DB validation target or environment drifted.');
  const attempt = result.scenarios.flatMap(scenario => scenario.attempts).find(item => item.identity.attemptId === validation.attemptId);
  requireThat(result.status === 'PASS' && result.scenarios.every(scenario => scenario.requiredLifecycleComplete) && attempt?.outcome === 'SUCCESS' && attempt.operationFingerprint === operation.fingerprint
    && attempt.identity.scenarioId === candidate.schema.scenarioId && attempt.identity.invocationId === candidate.invocationId && attempt.assertions.length > 0 && attempt.assertions.every(item => item.status === 'PASS' && item.reliable), 'DB verification needs a successful matching operation, source checks and complete lifecycle.');
  requireThat(fingerprint(selectedExpectations(validation.run, operation.id, candidate.invocationId)) === fingerprint(candidate.source.expectations), 'DB validation changed the source expectations.');
  for (const parameter of operation.definition.parameters) {
    const input = attempt.inputs.find(item => item.name === parameter.input);
    requireThat(input && input.type !== 'null' && (input.sensitivity === 'sensitive' || input.value !== null), 'DB identity parameters need non-null typed scenario identities.');
  }
  const expectedInputs = [...new Set(operation.definition.checks.map(check => check.equals.$input))];
  for (const name of expectedInputs) {
    const input = attempt.inputs.find(item => item.name === name), initial = validation.run.inputs.values.find(item => item.name === name && item.producer.scenarioId === candidate.schema.scenarioId);
    requireThat(input && initial && input.producer.attemptId === undefined && fingerprint(input) === fingerprint(initial), 'DB expected values must bind frozen source inputs, never observed outputs.');
  }
  // Preserve the assessed run's evidence closure, including required setup, UI and cleanup.
  const evidence = result.evidence.map(item => ({id: item.id, identity: item.identity, kind: item.kind, path: relativePath(roots, join(validation.roots.runRoot, item.path)), sha256: item.sha256, bytes: item.bytes}));
  requireThat(evidence.some(item => item.kind === 'response') && attempt.assertions.every(assertion => assertion.evidenceIds.some(evidenceId => evidence.some(item => item.id === evidenceId && item.kind === 'assertion'))), 'DB verification needs retained assertion and response evidence.');
  return immutable(roots, REVIEWED, {version: 1, status: 'reviewed-verified', candidateId, operation, review: {...checked, artifact},
    verification: {runId: validation.run.id, scenarioId: attempt.identity.scenarioId, inputFingerprint: validation.run.inputFingerprint, attemptId: validation.attemptId, operationFingerprint: operation.fingerprint,
      environment: environment.name, targetFingerprint: fingerprint(config), expectedInputs, evidence}});
}
function readHistorical(roots, reviewedId) {
  const record = load(roots, REVIEWED, reviewedId), candidate = readDbCandidate(roots, record.candidateId);
  validateDatabaseOperation(record.operation);
  requireThat(record.status === 'reviewed-verified' && record.operation.fingerprint === candidate.operation.fingerprint && record.verification.operationFingerprint === record.operation.fingerprint, 'Reviewed DB operation changed.');
  unchangedArtifact(roots, record.review.artifact, 'DB review'); record.verification.evidence.forEach(item => unchangedEvidence(roots, item)); return record;
}
/** Historical inspection only. These records cannot establish current schema compatibility. */
export function listReviewedDbs(roots) {return names(roots, REVIEWED).map(recordId => readHistorical(roots, recordId));}

/** Reuse requires a fresh native receipt bound to this invocation's immutable run and target. */
export function readReviewedDb(roots, reviewedId, current) {
  requireThat(current?.run && current.schema, 'DB reuse requires fresh schema evidence and its current run.'); requireRun(current.run);
  requireThat(current.roots?.runRoot, 'DB reuse requires its exact current evidence storage roots.');
  requireThat(consumerRoots(current.roots.projectRoot, current.roots.packageRoot).projectRoot === consumerRoots(roots.projectRoot, roots.packageRoot).projectRoot, 'DB reuse evidence must belong to this consumer.');
  const receipt = requireSchemaEvidence(current.schema), schema = receipt.schema, record = readHistorical(roots, reviewedId), candidate = readDbCandidate(roots, record.candidateId);
  const config = current.run.inputs.environment.targets.databases[record.operation.target];
  requireThat(schema.runId === current.run.id && schema.inputFingerprint === current.run.inputFingerprint && schema.operationId === record.operation.id && schema.target === record.operation.target
    && config && fingerprint(config) === schema.targetFingerprint && schema.targetFingerprint === record.verification.targetFingerprint && current.run.inputs.environment.name === record.verification.environment, 'DB reuse target or current schema scope drifted.');
  requireThat(fingerprint(relevantSchema(schema, candidate.table)) === candidate.schemaFingerprint, 'DB reuse detected relevant schema drift; review a new candidate.');
  const verified = verifyEvidence(current.run, current.roots, receipt.evidence);
  requireThat(fingerprint(jsonFile(verified.actual)) === fingerprint(schema), 'DB reuse schema storage content changed.');
  // A current-use receipt is reporting state, not a new operation authority or a runtime pass.
  immutable(roots, REUSE, {version: 1, status: 'schema-checked', reviewedId, runId: current.run.id, scenarioId: schema.scenarioId, invocationId: schema.invocationId,
    inputFingerprint: current.run.inputFingerprint, schemaFingerprint: candidate.schemaFingerprint,
    evidence: {...data(receipt.evidence), path: relativePath(roots, verified.actual)}});
  return record;
}

function readReuse(roots, reuseId) {
  const use = load(roots, REUSE, reuseId), record = readHistorical(roots, use.reviewedId), candidate = readDbCandidate(roots, record.candidateId);
  const schema = jsonFile(unchangedEvidence(roots, use.evidence)), identity = use.evidence.identity;
  requireThat(use.version === 1 && use.status === 'schema-checked' && use.evidence.kind === 'observation' && schema.runId === use.runId && schema.scenarioId === use.scenarioId
    && schema.invocationId === use.invocationId && schema.inputFingerprint === use.inputFingerprint && schema.operationId === record.operation.id && schema.target === record.operation.target
    && identity.runId === schema.runId && identity.scenarioId === schema.scenarioId && identity.operationId === schema.operationId && identity.invocationId === schema.invocationId
    && schema.targetFingerprint === record.verification.targetFingerprint && use.schemaFingerprint === candidate.schemaFingerprint
    && fingerprint(relevantSchema(schema, candidate.table)) === candidate.schemaFingerprint, 'DB reuse receipt or current schema evidence changed.');
  return {use, record, candidate};
}

const md = value => String(value).replace(/([\\`*_[\]<>|])/g, '\\$1');
const definitionKey = (record, candidate) => fingerprint({target: record.operation.target, targetFingerprint: candidate.schema.targetFingerprint, schemaFingerprint: candidate.schemaFingerprint, definition: record.operation.definition});
function libraryFile(roots, path) {
  const stat = lstatSync(path); requireThat(stat.isFile() && !stat.isSymbolicLink() && stat.size <= MAX_LIBRARY, 'Invalid discovered query library.');
  const text = readFileSync(path, 'utf8'), match = /^<!-- harness-discovered-db (.+) -->\n/.exec(text);
  requireThat(match, 'Existing query document is not owned discovered output.');
  const metadata = data(JSON.parse(match[1]), MAX_LIBRARY), body = text.slice(match[0].length), {integrity, ...content} = metadata;
  requireThat(metadata.origin === 'reviewed-consumer-evidence' && metadata.version === 1, 'Existing query document origin is not owned discovered output.');
  requireThat(fingerprint({metadata: content, body}) === integrity, 'Discovered query library integrity drift; resolve external changes before promotion.');
  return {metadata, body, text, path: relativePath(roots, path)};
}
function renderLibrary(application, groups) {
  return `# ${md(application)} discovered queries\n\nDerived from reviewed schema and runtime evidence. These are not captured application SQL. Both supplied exports and this consumer-owned document are derive-only inputs; use ordinary DB services and typed bindings. Read discovery establishes no seed, delete or restoration recipe.\n\n` + groups.map(({record, candidate, provenance}) => {
    const definition = record.operation.definition, selected = relevantSchema(candidate.schema, candidate.table);
    return `## ${md(record.operation.id)}\n\nStatus: reviewed-verified\n\nPurpose: ${md(record.review.purpose)}\n\nEngine: ${md(selected.engine)}; target: ${md(record.operation.target)}; database/schema: ${md(selected.database)} / ${md(selected.schema)}; table: ${md(selected.table.name)}.\n\n    ${definition.sql}\n\nParameters:\n\n${definition.parameters.map(parameter => `- ${md(parameter.name)}: ${md(parameter.type)}${parameter.length ? `(${parameter.length})` : parameter.precision ? `(${parameter.precision},${parameter.scale})` : ''}; scenario input: ${md(parameter.input)}`).join('\n')}\n\nSelected outputs: ${candidate.selectedColumns.map(md).join(', ')}\n\nExpected values remain source inputs: ${definition.checks.map(check => md(check.equals.$input)).join(', ')}.\n\nProvenance:\n\n${provenance.map(item => `- Reviewed record: ${item.reviewedId}; candidate: ${item.candidateId}; verification run: ${md(item.runId)}; attempt: ${md(item.attemptId)}.`).join('\n')}\n- Source: ${md(candidate.source.artifact.path)} (${candidate.source.artifact.sha256}).\n- Review: ${md(record.review.artifact.path)} (${record.review.artifact.sha256}).\n- Schema evidence: ${md(candidate.sourceRunRoot + '/' + candidate.evidence.path)} (${candidate.evidence.sha256}).\n\n`;
  }).join('');
}

/** Only the separately owned derived document is mutable; immutable authority remains in records. */
export async function promoteDiscoveredQueries(roots, {application, reviewedIds}) {
  requireThat(typeof application === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(application), 'Use a stable application slug.');
  requireThat(Array.isArray(reviewedIds) && reviewedIds.length > 0 && reviewedIds.length <= 100, 'Promotion needs bounded reviewed records.'); unique(reviewedIds, 'reviewed DB identities');
  reviewedIds.forEach(recordId => readHistorical(roots, recordId));
  const directory = location(roots, 'resources/Queries'); mkdirSync(directory, {recursive: true});
  const path = location(roots, `resources/Queries/${application}-discovered.md`), lock = path + '.lock', fd = openSync(lock, 'wx', 0o600); let temporary;
  try {
    const previous = existsSync(path) ? libraryFile(roots, path) : null;
    requireThat(!previous || previous.metadata.application === application, 'Discovered query application ownership changed.');
    const allIds = [...new Set([...(previous?.metadata.reviewedIds ?? []), ...reviewedIds])].sort(); requireThat(allIds.length <= MAX_RECORDS, 'Discovered query library limit reached.');
    const records = new Map(allIds.map(recordId => {const record = readHistorical(roots, recordId); return [recordId, {record, candidate: readDbCandidate(roots, record.candidateId)}];}));
    const byOperation = new Map(), groups = new Map();
    for (const representative of previous?.metadata.representatives ?? []) {
      const selected = records.get(representative.reviewedId);
      requireThat(selected && definitionKey(selected.record, selected.candidate) === representative.definition, 'Discovered query representative changed.');
      groups.set(representative.definition, {...selected, provenance: []});
    }
    for (const {record, candidate} of records.values()) {
      const operationKey = `${record.operation.target}/${record.operation.id}`, key = definitionKey(record, candidate);
      requireThat(!byOperation.has(operationKey) || byOperation.get(operationKey) === key, 'Conflicting reviewed DB operation; resolve contract or schema drift explicitly.'); byOperation.set(operationKey, key);
      const group = groups.get(key) ?? {record, candidate, provenance: []};
      group.provenance.push({reviewedId: record.id, candidateId: record.candidateId, runId: record.verification.runId, attemptId: record.verification.attemptId}); groups.set(key, group);
    }
    const ordered = [...groups].sort(([a], [b]) => a.localeCompare(b)), body = renderLibrary(application, ordered.map(([, group]) => group));
    const metadata = {version: 1, origin: 'reviewed-consumer-evidence', application, reviewedIds: allIds, representatives: ordered.map(([definition, group]) => ({definition, reviewedId: group.record.id})),
      conflictPolicy: 'Reuse business methods and applicable supplied exports first; conflicts require explicit source-grounded resolution.'};
    metadata.integrity = fingerprint({metadata, body});
    const text = `<!-- harness-discovered-db ${JSON.stringify(metadata)} -->\n${body}`; requireThat(Buffer.byteLength(text) <= MAX_LIBRARY, 'Discovered query library exceeds its limit.');
    if (text !== previous?.text) {
      temporary = location(roots, `resources/Queries/.${application}-discovered-${randomUUID()}.tmp`);
      writeFileSync(temporary, text, {flag: 'wx', mode: 0o600, flush: true}); renameSync(temporary, path); temporary = undefined;
    }
    return {path, queries: groups.size, reviewedIds: allIds, status: 'PROMOTED'};
  } finally {if (temporary) unlinkSync(temporary); closeSync(fd); unlinkSync(lock);}
}

/** Inspect selected knowledge only; this summary never grants reuse or changes a case verdict. */
export function readDbDiscoverySummary(roots, {runIds = [], scenarioIds = []} = {}) {
  requireThat(Array.isArray(runIds) && Array.isArray(scenarioIds) && runIds.length <= 500 && scenarioIds.length <= 500, 'DB summary scope must be bounded.');
  [...runIds, ...scenarioIds].forEach(id);
  const selected = (runId, scenarioId) => runIds.includes(runId) || scenarioIds.includes(scenarioId);
  const summary = {candidates: [], reviewed: [], reused: [], libraries: [], gaps: []}, candidateIds = new Set(), reviewedIds = new Set();
  const gap = () => {if (!summary.gaps.includes('db-discovery-evidence-unavailable')) summary.gaps.push('db-discovery-evidence-unavailable');};
  try {
  for (const recordId of names(roots, CANDIDATES)) {
    let raw; try {raw = jsonFile(location(roots, `${CANDIDATES}/records/${recordId}.json`));} catch {gap(); continue;}
    if (!raw.schema?.runId || !raw.schema?.scenarioId) {gap(); continue;}
    if (!selected(raw.schema.runId, raw.schema.scenarioId)) continue;
    candidateIds.add(recordId);
    try {const candidate = readDbCandidate(roots, recordId); summary.candidates.push({id: candidate.id, operationId: candidate.operation.id, purpose: candidate.purpose, target: candidate.operation.target, status: 'unreviewed'});} catch {gap();}
  }
  for (const recordId of names(roots, REVIEWED)) {
    let raw; try {raw = load(roots, REVIEWED, recordId);} catch {continue;}
    if (!candidateIds.has(raw.candidateId) && !selected(raw.verification.runId, raw.verification.scenarioId)) continue;
    try {const record = readHistorical(roots, recordId); reviewedIds.add(record.id); summary.reviewed.push({id: record.id, candidateId: record.candidateId, operationId: record.operation.id, target: record.operation.target, status: 'reviewed-verified'});} catch {gap();}
  }
  for (const reuseId of names(roots, REUSE)) {
    let raw; try {raw = jsonFile(location(roots, `${REUSE}/records/${reuseId}.json`));} catch {gap(); continue;}
    if (!raw.runId || !raw.scenarioId) {gap(); continue;}
    if (!(runIds.length ? runIds.includes(raw.runId) : scenarioIds.includes(raw.scenarioId))) continue;
    try {
      const {use, record, candidate} = readReuse(roots, reuseId); reviewedIds.add(record.id);
      summary.reused.push({id: use.id, reviewedId: record.id, candidateId: record.candidateId, operationId: record.operation.id, purpose: candidate.purpose,
        target: record.operation.target, runId: use.runId, scenarioId: use.scenarioId, status: 'schema-checked'});
    } catch {gap();}
  }
  const directory = location(roots, 'resources/Queries');
  if (existsSync(directory)) for (const name of readdirSync(directory).filter(name => /^[a-z][a-z0-9-]{0,63}-discovered\.md$/.test(name)).slice(0, MAX_RECORDS)) {
    try {const library = libraryFile(roots, location(roots, `resources/Queries/${name}`)); if (library.metadata.reviewedIds.some(recordId => reviewedIds.has(recordId))) summary.libraries.push({path: library.path, queries: library.metadata.representatives.length});} catch { /* Unattributable or unrelated files cannot poison selected scenario reporting. */ }
  }
  } catch {gap();}
  return frozen(summary);
}
