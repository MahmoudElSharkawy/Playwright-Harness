import assert from 'node:assert/strict';
import {mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {join, relative, isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {packageRoot} from '../../scripts/lib/consumer-paths.mjs';
import {prepareSource} from '../../scripts/lib/execute/source.mjs';
import {createExecution, writeJson} from '../../scripts/lib/execute/storage.mjs';
import {draftRefinement, freezeExecution} from '../../scripts/lib/execute/refinement.mjs';
import {loadEnvironment} from '../../scripts/lib/project-config.mjs';
import {readFrozen, ownedFile, saveExecution} from '../../scripts/lib/execute/storage.mjs';
import {runInput} from '../../scripts/lib/execute/host.mjs';
import {createRun} from '../../scripts/lib/execution-core/index.mjs';
import {runSequentialScenario} from '../../scripts/lib/sequential/index.mjs';
import {randomUUID} from 'node:crypto';

export async function executionFixture(t, {browser = false, steps, handler, cases, diagnostics = 'off', organizationUrl = 'https://ado.example.test'} = {}) {
  const base = realpathSync(tmpdir()), projectRoot = mkdtempSync(join(base, 'harness-execute-')), requests = [];
  const server = createServer(async (req, res) => {requests.push({method: req.method, path: req.url}); if (handler) return handler(req, res); res.writeHead(200, {'content-type': 'application/json'}); res.end(JSON.stringify({value: 1, id: 'created-1'}));});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); const actual = realpathSync(projectRoot), suffix = relative(base, actual); assert(!isAbsolute(suffix) && suffix.startsWith('harness-execute-') && !suffix.includes('..')); rmSync(actual, {recursive: true, maxRetries: 20, retryDelay: 100});});
  const roots = {projectRoot, packageRoot};
  const put = (path, value) => {writeJson(join(projectRoot, path), value);};
  put('.harness/project.json', {version: 1, defaultEnvironment: 'qa', environments: {qa: {environmentMode: 'test', apiTargets: ['api'], databaseTargets: [], browserTargets: browser ? ['ui'] : []}}});
  put('.harness/targets.json', {api: {api: {baseUrl: origin}}, databases: {}, browser: {ui: {origins: [origin], startUrl: origin}}});
  const source = prepareSource({organizationUrl, project: 'demo', suiteName: 'Synthetic execution', cases: cases ?? [{id: 101, rev: 1, title: 'Synthetic API case', parameters: null, steps: steps ?? [{action: 'Read status', expected: 'Status is 200'}]}]}, {kind: 'suite', planId: 1, suiteId: 2});
  const refinement = draftRefinement(source, loadEnvironment(roots)); refinement.limits = {timeoutMs: 20000, cleanupTimeoutMs: 3000};
  const created = createExecution(roots, source, refinement, {diagnostics}), executionId = created.executionId;
  const save = () => put(`.harness/runs/${executionId}/refinement.json`, refinement);
  const apiStep = (index = 0, scenarioIndex = 0) => {
    const step = refinement.scenarios[scenarioIndex].steps[index]; step.family = 'api'; step.target = 'api'; step.capability = 'reads'; step.readOnlyContract = {reason: 'Fixture endpoint is read-only.'};
    step.expectations.forEach(expectation => {expectation.conditions[0] = {...expectation.conditions[0], predicate: 'equals', expected: {source: 'source-text', value: 200}};});
    step.operation = {request: {method: 'GET', path: '/status'}, checks: step.expectations.map((expectation, index) => ({id: `status-${index}`, select: {from: 'status', path: []}, equals: 200})), effects: {readOnlyContract: 'fixture-read'}};
    step.checkProvenance = step.expectations.map((expectation, index) => ({check: `status-${index}`, key: expectation.key, condition: 1})); return step;
  };
  const freeze = () => {save(); return freezeExecution(roots, executionId);};
  return {roots, projectRoot, origin, requests, source, refinement, executionId, apiStep, freeze, save, put, read: path => JSON.parse(readFileSync(join(projectRoot, path), 'utf8'))};
}
/** Library path for report/delivery tests; the detached process is tested independently. */
export async function executeApi(f, {scenarioIndex = 0, explicitRerun = false} = {}) {
  const loaded = readFrozen(f.roots, f.executionId), scenario = loaded.freeze.scenarios[scenarioIndex], source = loaded.source.scenarios.find(item => item.id === scenario.id), runId = `run-${randomUUID()}`, input = runInput(loaded.freeze, source, scenario, runId), run = createRun(input);
  writeJson(ownedFile(f.roots, f.executionId, `snapshots/${runId}.json`), {version: 1, executionId: f.executionId, runId, scenarioId: scenario.id, freezeFingerprint: loaded.execution.freezeFingerprint, inputFingerprint: run.inputFingerprint, input, explicitRerun}, {exclusive: true});
  saveExecution(f.roots, f.executionId, {...loaded.execution, runs: [...loaded.execution.runs, {runId, scenarioId: scenario.id, state: 'FINISHED', startedAt: input.startedAt, explicitRerun}]});
  const outputs = new Map(), callbacks = Object.fromEntries([['setup', 'SETUP'], ['exercise', 'EXERCISE'], ['verify', 'VERIFY'], ['cleanup', 'CLEANUP']].map(([name, phase]) => [name, async context => {
    for (const step of scenario.steps.filter(item => item.phase === phase)) {
      const input = {operation: step.operation, invocationId: step.id, retry: step.capability === 'reads', unresolvedChecks: step.contracts.filter(contract => contract.synthetic || contract.condition.ambiguous).map(contract => contract.id), inputs: (step.inputs ?? []).map(binding => binding.source.startsWith('output:') ? {...outputs.get(binding.source.slice(7)), name: binding.name} : context.value(binding.name))};
      if (step.creates?.length) {const created = step.creates[0]; input.resource = {id: created.resource, output: created.identityOutput, ownership: 'harness', intent: created.intent};} if (step.cleanupResource) input.lifecycle = {resourceId: step.cleanupResource};
      const attempt = await context[step.family].execute(input); for (const output of attempt.outputs) outputs.set(output.name, output);
    }
  }]));
  const roots = {...f.roots, runRoot: ownedFile(f.roots, f.executionId, runId)}, result = await runSequentialScenario(run, roots, {}, callbacks); return {runId, run, roots, result};
}
