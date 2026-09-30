import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync, realpathSync, rmSync, readdirSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, relative, isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {packageRoot} from '../../scripts/lib/consumer-paths.mjs';
import {createRun} from '../../scripts/lib/execution-core/index.mjs';
import {defineApiOperation, createApiRuntime} from '../../scripts/lib/api/index.mjs';

export const statusCheck = (id, status) => ({id, select: {from: 'status', path: []}, equals: status});
export const readEffects = {readOnlyContract: 'fixture-read-contract'};
export const writeEffects = {confirmedStatuses: [200, 201, 204], noEffectStatuses: [400, 401, 403, 404, 409, 412], contractRef: 'fixture-write-contract'};
export function operation(id = 'request', {method = 'GET', path = '/items', kind = 'inline', checks = [statusCheck('status', 200)], ...rest} = {}) {
  return defineApiOperation({id, target: 'fixture-api', source: {kind, reference: 'synthetic-service', version: '1.0.0'},
    request: {method, path}, checks, effects: method === 'GET' ? readEffects : writeEffects, ...rest});
}
export function input(runId, name, value) {return {name, type: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value, sensitivity: 'public', value, producer: {runId, scenarioId: 'case', name}};}

/** Real loopback transport and synthetic consumer state; never contacts an external service. */
export async function fixture(t, handler, definitions, options = {}) {
  const requests = [], items = new Map(); let effects = 0;
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    let body; try {body = JSON.parse(Buffer.concat(chunks).toString());} catch { /* Bodies are optional. */ }
    const request = {method: req.method, path: req.url, headers: req.headers, body}; requests.push(request);
    const reply = (status, value = {}, headers = {}) => {res.writeHead(status, {'content-type': 'application/json', ...headers}); res.end(JSON.stringify(value));};
    const context = {req, res, request, requests, reply, items, effect: () => effects++};
    try { await handler(context); } catch { if (!res.destroyed) {res.writeHead(500); res.end();} }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = realpathSync(tmpdir()), projectRoot = mkdtempSync(join(base, 'pom-api-'));
  t.after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    const path = realpathSync(projectRoot), suffix = relative(base, path); assert(!isAbsolute(suffix) && suffix.startsWith('pom-api-') && !suffix.includes('..')); rmSync(path, {recursive: true});
  });
  const runId = randomUUID(), roots = {packageRoot, projectRoot, runRoot: join(projectRoot, 'run')};
  const environment = {name: 'fixture', environmentMode: options.mode ?? 'test', apiTargets: ['fixture-api'], databaseTargets: [], capabilities: options.capabilities ?? {},
    targets: {api: {'fixture-api': {baseUrl: `http://127.0.0.1:${server.address().port}${options.basePath ?? ''}`, ...(options.auth ? {credentialRef: 'env:FIXTURE_ACCESS'} : {})}}, databases: {}}};
  const invocations = options.invocations ?? definitions.map(definition => ({operation: definition, invocationId: `${definition.id}-call`}));
  const run = createRun({id: runId, environment, operations: definitions.filter(definition => definition.source.kind !== 'exploration'),
    values: [...(options.values ?? []).map(([name, value]) => input(runId, name, value)), ...(options.sensitiveValues ?? []).map(([name, type, protectedRef]) => ({name, type, sensitivity: 'sensitive', protectedRef, producer: {runId, scenarioId: 'case', name}}))], limits: {timeoutMs: 5000, cleanupTimeoutMs: 2000, ...options.limits},
    scenarios: [{id: 'case', expectations: invocations.flatMap(({operation, invocationId}) => operation.definition.checks.map(check => ({id: check.id, description: 'Synthetic API expectation', operationId: operation.id, invocationId, requiredEvidence: ['response', 'assertion', 'observation']})))}]});
  const runtime = createApiRuntime(run, roots, options.runtime);
  return {run, runtime, roots, environment, requests, items, effects: () => effects,
    allText: () => [readFileSync(join(roots.runRoot, 'result.json'), 'utf8'), ...readdirSync(join(roots.runRoot, 'evidence')).map(file => readFileSync(join(roots.runRoot, 'evidence', file), 'utf8'))].join('\n'),
    call: (definition = definitions[0], patch = {}) => runtime.execute({operation: definition, invocationId: `${definition.id}-call`, ...patch})};
}
