import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync, realpathSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, relative, isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {packageRoot} from '../../scripts/lib/consumer-paths.mjs';
import {createRun} from '../../scripts/lib/execution-core/index.mjs';
import {browserLifecycleOperations} from '../../scripts/lib/browser/index.mjs';
import {operation, statusCheck} from './api.mjs';

export const call = (ctx, operation, extra = {}) => ctx.api.execute({operation, invocationId: operation.id, ...extra});
export const read = (id, extra = {}) => operation(id, {path: `/${id}`, checks: [statusCheck(`${id}-ok`, 200)], ...extra});
export const step = (operation, phase = 'EXERCISE', checks = operation.definition.checks) => ({operation, phase, checks});

/** Owned loopback server and a separate consumer; retained only for native proof. */
export async function parallelFixture(t, {handler, projectRoot: retainedProject, targets = {}} = {}) {
  const requests = [], server = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      let body; try {body = JSON.parse(Buffer.concat(chunks).toString());} catch { /* Optional synthetic body. */ }
      const request = {path: req.url, method: req.method, body, headers: req.headers}; requests.push(request);
      const reply = (status, value = {}) => {res.writeHead(status, {'content-type': 'application/json'}); res.end(JSON.stringify(value));};
      if (handler) await handler({req, res, request, reply}); else reply(200, {label: req.url});
    } catch {if (!res.destroyed && !res.headersSent) {res.writeHead(500); res.end();}}
  });
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  const base = realpathSync(tmpdir()), projectRoot = retainedProject ?? mkdtempSync(join(base, 'harness-m16-'));
  const origin = `http://127.0.0.1:${server.address().port}`, roots = {packageRoot, projectRoot};
  async function close() {
    server.closeAllConnections(); if (server.listening) await new Promise(resolve => server.close(resolve));
    if (!retainedProject) {
      const actual = realpathSync(projectRoot), suffix = relative(base, actual);
      assert(!isAbsolute(suffix) && suffix.startsWith('harness-m16-') && !suffix.includes('..')); rmSync(actual, {recursive: true});
    }
  }
  t?.after(close);
  function job(id, settings = {}) {
    const defaultRead = read('observe'), steps = settings.steps ?? [step(defaultRead)];
    const definitions = [...new Map(steps.map(item => [item.operation.id, item.operation])).values()];
    const runId = settings.runId ?? `run-${randomUUID()}`, browser = settings.browser;
    const run = createRun({id: runId, ...(settings.startedAt === undefined ? {} : {startedAt: settings.startedAt}),
      environment: {name: 'qa', environmentMode: 'test', apiTargets: ['fixture-api'], databaseTargets: Object.keys(targets), browserTargets: browser ? ['ui'] : [],
        targets: {api: {'fixture-api': {baseUrl: origin}}, databases: targets, browser: {ui: {origins: [origin]}}}},
      operations: [...definitions.filter(operation => operation.source.kind !== 'exploration'), ...(browser ? browserLifecycleOperations('ui') : [])],
      values: Object.entries(settings.values ?? {}).map(([name, value]) => ({name, value, type: typeof value, sensitivity: 'public', producer: {runId, scenarioId: 'case', name}})),
      scenarios: [{id: 'case', expectations: steps.flatMap(item => item.checks.map(check => ({id: check.id, description: 'Bounded dispatch fixture expectation', operationId: item.operation.id,
        invocationId: item.operation.id, phase: item.phase, requiredEvidence: item.operation.family === 'browser' ? ['observation', 'snapshot'] : ['response', 'assertion']})))}],
      limits: {timeoutMs: 10000, cleanupTimeoutMs: 2000, ...settings.limits}});
    return {id, run, resources: settings.resources ?? [{key: id, access: 'read'}],
      options: {explorations: definitions.filter(operation => operation.source.kind === 'exploration'), ...(browser ? {browser: {target: 'ui'}} : {}), ...settings.options},
      callbacks: settings.callbacks ?? {exercise: ctx => call(ctx, defaultRead)}};
  }
  return {roots, origin, requests, job, close};
}
