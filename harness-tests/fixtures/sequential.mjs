import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync, realpathSync, rmSync, readdirSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, relative, isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {packageRoot} from '../../scripts/lib/consumer-paths.mjs';
import {createRun} from '../../scripts/lib/execution-core/index.mjs';
import {browserLifecycleOperations} from '../../scripts/lib/browser/index.mjs';
import {runSequentialScenario} from '../../scripts/lib/sequential/index.mjs';

export async function fixture(t, invocations, options = {}) {
  const requests = [], server = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString(); let body; try {body = JSON.parse(raw);} catch { /* Optional synthetic body. */ }
      const request = {method: req.method, path: req.url, body}; requests.push(request);
      const reply = (status, value = {}, headers = {}) => {res.writeHead(status, {'content-type': 'application/json', ...headers}); res.end(JSON.stringify(value));};
      if (options.handler) await options.handler({req, res, request, reply}); else reply(200, {value: 1});
    } catch {if (!res.destroyed) {res.writeHead(500); res.end();}}
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = realpathSync(tmpdir()), projectRoot = mkdtempSync(join(base, 'harness-m9-')), origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    const actual = realpathSync(projectRoot), suffix = relative(base, actual);
    assert(!isAbsolute(suffix) && suffix.startsWith('harness-m9-') && !suffix.includes('..')); rmSync(actual, {recursive: true});
  });
  const roots = {packageRoot, projectRoot, runRoot: join(projectRoot, '.harness', 'runs', 'mixed')}, runId = `mixed-${randomUUID()}`;
  const definitions = [...new Map(invocations.map(item => [item.operation.id, item.operation])).values()];
  const environment = {name: 'qa', environmentMode: options.mode ?? 'test', capabilities: options.capabilities ?? {}, apiTargets: ['fixture-api'], databaseTargets: ['db'], browserTargets: options.browser ? ['ui'] : [],
    targets: {api: {'fixture-api': {baseUrl: origin}}, databases: {db: options.target ?? {engine: 'sqlserver', server: 'localhost', database: 'Synthetic', schema: 'm9', connectionRef: 'env:M9_DB_CREDENTIAL'}}, browser: {ui: {origins: [origin]}}}};
  const run = createRun({id: runId, environment, operations: [...definitions.filter(operation => operation.source.kind !== 'exploration'), ...(options.browser ? browserLifecycleOperations('ui') : [])],
    values: (options.values ?? []).map(([name, value, sensitivity = 'public', type]) => ({name, type: type ?? (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value), sensitivity,
      ...(sensitivity === 'sensitive' ? {protectedRef: value} : {value}), producer: {runId, scenarioId: 'case', name}})),
    scenarios: [{id: 'case', expectations: invocations.flatMap(({operation, phase, invocationId = operation.id, checks = operation.definition.checks ?? []}) => checks.map(check => ({id: check.id, description: 'Synthetic mixed expectation', operationId: operation.id, invocationId, phase, requiredEvidence: operation.family === 'browser' ? ['observation'] : ['response', 'assertion']})))}],
    limits: {timeoutMs: options.browser ? 120000 : 10000, cleanupTimeoutMs: options.browser ? 60000 : 3000, ...options.limits}});
  return {run, roots, origin, requests,
    start: (callbacks, runtime = {}) => runSequentialScenario(run, roots, {explorations: definitions.filter(operation => operation.source.kind === 'exploration'), ...(options.browser ? {browser: {target: 'ui'}} : {}), ...runtime}, callbacks),
    allText: () => readdirSync(roots.runRoot, {recursive: true, withFileTypes: true}).filter(item => item.isFile()).map(item => readFileSync(join(item.parentPath, item.name), 'utf8')).join('\n')};
}
