// Fixed M15 acceptance fixtures. These compose existing executors; they are not a workflow language.
import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createRun, defineOperation} from '../../scripts/lib/execution-core/index.mjs';
import {createApiRuntime, defineApiOperation} from '../../scripts/lib/api/index.mjs';
import {createDatabaseRuntime, defineDatabaseOperation} from '../../scripts/lib/database/index.mjs';
import {browserLifecycleOperations, runBrowserScenario} from '../../scripts/lib/browser/index.mjs';
import {loadEnvironment} from '../../scripts/lib/project-config.mjs';
import {sourceExpectations} from '../../scripts/lib/generation/handoff.mjs';
import {writeReports} from '../../scripts/lib/reporting/index.mjs';
import {generationCases} from './generation.mjs';
import {executeHostCases, hostCaseIds} from './host-execution.mjs';

export const lifecycleCases = Object.freeze([
  {id: 'apiTemporary', execution: 'api-temporary', family: 'api', title: 'A temporary API fixture is updated and removed', description: 'The API fixture has label updated and its required cleanup completes', assertion: 'label'},
  {id: 'apiPersistent', execution: 'api-persistent', family: 'api', title: 'An intentional API outcome remains present', description: 'The API fixture has label updated and remains intentionally persistent without a restoration requirement', assertion: 'label'},
  {id: 'apiNoObligation', execution: 'api-no-obligation', family: 'api', title: 'An API mutation can have no cleanup obligation', description: 'The API fixture has label updated without an invented cleanup or before-state obligation', assertion: 'label'},
  {id: 'apiRestore', execution: 'api-restore', family: 'api', title: 'A temporary API change restores existing state', description: 'The API fixture has label updated during verification and its original label is restored with a version guard', assertion: 'label'},
  {id: 'sqlserverLifecycle', execution: 'sqlserver-crud', family: 'database', title: 'A SQL Server fixture completes bound data operations and cleanup', description: 'Bound INSERT UPDATE SELECT DELETE use the approved SQL Server scope, return label updated and remove the temporary row', assertion: 'read-label'},
  {id: 'postgresqlLifecycle', execution: 'postgresql-crud', family: 'database', title: 'A PostgreSQL fixture completes bound data operations and cleanup', description: 'Bound INSERT UPDATE SELECT DELETE use the approved PostgreSQL scope, return label updated and remove the temporary row', assertion: 'read-label'},
]);

export function workflowCases() {
  const original = generationCases(), cases = [...original.cases, ...lifecycleCases.map(c => ({...c, expected: 'PASS'}))];
  const source = {version: 1, id: 'workflow-observations', title: 'Workflow observations', scenarios: cases.map(c => ({id: c.id, title: c.title, steps: [{action: c.title, expected: [c.description]}]}))};
  const expectations = sourceExpectations(source);
  const complete = cases.map(c => ({...c, key: expectations.find(e => e.scenarioId === c.id).key,
    ...(c.definition ? {definition: {...c.definition, caseId: c.id}} : {})}));
  return {source, cases: complete, testData: Object.fromEntries(complete.map(({key, ...c}) => [c.id, c]))};
}

export const workflowExecutionIds = Object.freeze([...generationCases().cases.map(c => c.id), ...hostCaseIds.map(id => `control-${id}`)]);
export const generatedExecutionIds = Object.freeze(workflowCases().cases.filter(c => c.id !== 'ui').map(c => c.id));

/** Actual native exploration. Negative controls remain negative and do not enter a generation handoff. */
export async function exploreWorkflow(roots, origin, targets) {
  const fixture = workflowCases(), environment = loadEnvironment(roots), executions = [], bindings = [];
  for (const item of fixture.cases.filter(c => !c.execution)) {
    const browser = item.id === 'ui';
    const operation = browser ? defineOperation({id: 'observe', family: 'browser', target: 'app', capability: 'browserReads', source: {kind: 'inline', reference: 'synthetic-heading', version: '1.0.0'}, definition: {intent: item.description}})
      : item.definition.family === 'api' ? defineApiOperation(item.definition.operation) : defineDatabaseOperation(item.definition.operation);
    const runId = `observed-${item.id}`, checks = browser ? [{id: 'expected'}] : operation.definition.checks;
    const run = createRun({id: runId, startedAt: Date.now(), environment, operations: [operation, ...(browser ? browserLifecycleOperations('app') : [])],
      scenarios: [{id: item.id, expectations: checks.map(c => ({id: c.id, description: item.description, operationId: operation.id, invocationId: 'observe-call', requiredEvidence: browser ? ['observation', 'snapshot'] : ['response', 'assertion']}))}],
      values: (item.definition?.values ?? []).map(value => ({...value, producer: {runId, scenarioId: item.id, name: value.name}})), limits: {timeoutMs: 120000, cleanupTimeoutMs: 60000}});
    const runRoots = {...roots, runRoot: join(roots.projectRoot, '.harness/runs', run.id)}; let result;
    if (browser) result = await runBrowserScenario(run, runRoots, {target: 'app'}, async session => {
      await session.attempt({operation, invocationId: 'observe-call'}, async context => {
        await context.native(['goto', origin]); await context.native(['snapshot', '--filename=observation.yml']);
        const evidence = await context.artifact('snapshot', 'observation.yml', bytes => Buffer.from(bytes.toString().replaceAll(origin, 'http://fixture.test')));
        const value = JSON.parse((await context.native(['eval', 'document.querySelector("#observation").textContent'])).result);
        const observed = await context.evidence('observation', {value, expected: item.expected});
        context.assertion({id: 'expected', status: value === item.expected ? 'PASS' : 'FAIL', reliable: true, evidenceIds: [evidence, observed]});
      });
    });
    else {
      const runtime = item.definition.family === 'api' ? createApiRuntime(run, runRoots) : createDatabaseRuntime(run, runRoots);
      await runtime.execute({operation, invocationId: 'observe-call', inputs: run.inputs.values}); result = runtime.finish();
    }
    assert.equal(result.status, 'PASS', item.id);
    writeFileSync(join(runRoots.runRoot, 'inputs.json'), JSON.stringify(run), {flag: 'wx'});
    executions.push({id: item.id, run, roots: runRoots, result, observations: JSON.parse(readFileSync(join(runRoots.runRoot, 'observations.json'), 'utf8')),
      symbols: browser ? [{name: 'owned-browser-session', slots: [{scenarioId: item.id, invocationId: 'browser-session-setup', number: 1, name: 'sessionIdentity'}]}] : []});
    bindings.push({key: item.key, runId, scenarioId: item.id, expectationId: 'expected'});
  }
  const controlRoot = join(roots.projectRoot, '.harness/workflow/controls'); mkdirSync(controlRoot, {recursive: true});
  const controls = await executeHostCases(controlRoot, targets);
  for (const record of controls) executions.push({...record, id: `control-${record.id}`});
  for (const item of fixture.cases.filter(c => c.execution)) {
    const record = controls.find(c => c.id === item.execution);
    bindings.push({key: item.key, runId: record.run.id, scenarioId: 'case', expectationId: item.assertion});
  }
  for (const execution of executions) assert.equal(writeReports(roots, execution.result, {directory: `reports/exploration/${execution.id}`}).status, 'WRITTEN');
  assert.deepEqual(executions.map(c => c.id), workflowExecutionIds);
  return {executions, bindings, generationExecutions: executions.filter(c => bindings.some(b => b.runId === c.run.id))};
}

/** Bind generated runtime records to the actual native verification invocation, never to agent prose. */
export function recordGeneratedExecution(roots, scenarioId, execution) {
  const invocation = process.env.HARNESS_GENERATION_INVOCATION;
  assert.match(invocation ?? '', /^verify-[a-f0-9-]+$/); assert(generatedExecutionIds.includes(scenarioId));
  const directory = join(roots.projectRoot, '.harness/workflow/generated', invocation); mkdirSync(directory, {recursive: true});
  const receipt = writeReports(roots, execution.result, {directory: `reports/execution/${invocation}/${scenarioId}`});
  assert.equal(receipt.status, 'WRITTEN');
  writeFileSync(join(directory, `${scenarioId}.json`), JSON.stringify({id: scenarioId, invocation, execution, reporting: receipt}), {flag: 'wx', mode: 0o600});
}
