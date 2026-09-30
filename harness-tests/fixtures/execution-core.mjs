import assert from 'node:assert/strict';
import {mkdtempSync, realpathSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, relative, isAbsolute} from 'node:path';
import {packageRoot} from '../../scripts/lib/consumer-paths.mjs';
import {createRun, defineOperation, registerEvidence, assessRun} from '../../scripts/lib/execution-core/index.mjs';

export const environment = (mode = 'test', capabilities = {}) => ({name: 'qa', environmentMode: mode, apiTargets: ['qa-api'], databaseTargets: ['qa-db'], capabilities,
  targets: {api: {'qa-api': {baseUrl: 'https://api.example.test', credentialRef: 'env:API_TOKEN'}}, databases: {'qa-db': {engine: 'sqlserver', connectionRef: 'env:DB_CONNECTION', schema: 'dbo'}}}});
export const operation = (patch = {}) => defineOperation({id: 'observe', family: 'api', target: 'qa-api', capability: 'apiReads', source: {kind: 'inline', reference: 'fixture', version: 'v1'}, definition: {intent: 'Observe a synthetic fixture'}, ...patch});
export const scope = (requiredEvidence = ['observation']) => [{id: 'case-1', expectations: [{id: 'visible', description: 'The synthetic observation matches', operationId: 'observe', invocationId: 'observe-call', requiredEvidence}]}];
export const runInput = (patch = {}) => ({id: 'run-1', startedAt: 1000, environment: environment(), scenarios: scope(), operations: [operation()], ...patch});
export function value(attempt, name = 'recordId', type = 'string', content = 'row-1') {
  return {name, type, sensitivity: 'public', value: content, producer: {runId: attempt.identity.runId, scenarioId: attempt.identity.scenarioId, attemptId: attempt.identity.attemptId, name}};
}
export function attempt(run, operation, patch = {}) {
  return {identity: {runId: run.id, scenarioId: 'case-1', operationId: operation.id, invocationId: `${operation.id}-call`, attemptId: 'attempt-1', phase: 'EXERCISE', number: 1},
    operationFingerprint: operation.fingerprint, startedAt: 1100, endedAt: 1110, outcome: 'SUCCESS', failureClass: 'NONE', effect: {certainty: 'none', resourceIds: []},
    assertions: [], inputs: [], outputs: [], evidenceIds: [], supportedCapabilities: [operation.capability], ...patch};
}
export function fixture(t, patch = {}) {
  const base = realpathSync(tmpdir()), projectRoot = mkdtempSync(join(base, 'pom-core-'));
  t.after(() => { const path = realpathSync(projectRoot), suffix = relative(base, path); assert(!isAbsolute(suffix) && suffix.startsWith('pom-core-') && !suffix.includes('..')); rmSync(path, {recursive: true}); });
  const runRoot = join(projectRoot, '.harness', 'runs', 'run-1'); mkdirSync(join(runRoot, 'evidence'), {recursive: true});
  const roots = {packageRoot, projectRoot, runRoot}, run = createRun(runInput(patch)), current = attempt(run, run.inputs.operations[0] ?? operation());
  current.outputs = [value(current)];
  const scenario = {id: 'case-1', disposition: 'executed', attempts: [current], resources: [], outputRefs: [{attemptId: current.identity.attemptId, name: 'recordId'}], issues: []};
  const report = {scenarios: [scenario], operations: [], evidence: []};
  function evidence(owner, kind = 'observation', name = `artifact-${report.evidence.length + 1}`, text = 'Synthetic sanitized observation') {
    const path = `evidence/${name}.txt`; writeFileSync(join(runRoot, path), text);
    const record = registerEvidence(run, roots, {id: name, identity: owner.identity, path, kind, sanitized: true});
    report.evidence.push(record); owner.evidenceIds.push(record.id); return record.id;
  }
  current.assertions = [{id: 'visible', status: 'PASS', reliable: true, evidenceIds: [evidence(current, patch.scenarios?.[0]?.expectations[0]?.requiredEvidence[0] ?? 'observation')]}];
  return {run, roots, report, scenario, current, evidence, assess: () => assessRun(run, roots, report)};
}

export function retry(f, reconciliation) {
  const first = f.current;
  first.outcome = 'INFRASTRUCTURE_FAILURE'; first.failureClass = 'TRANSPORT'; first.outputs = [];
  first.assertions = [{id: 'visible', status: 'INDETERMINATE', reliable: false, evidenceIds: []}];
  if (reconciliation) first.reconciliation = reconciliation;
  const next = attempt(f.run, f.run.inputs.operations[0], {identity: {...first.identity, attemptId: 'attempt-2', number: 2}, startedAt: 1200, endedAt: 1210});
  next.outputs = [value(next)];
  next.assertions = [{id: 'visible', status: 'PASS', reliable: true, evidenceIds: [f.evidence(next)]}];
  f.scenario.attempts.push(next); f.scenario.outputRefs = [{attemptId: next.identity.attemptId, name: 'recordId'}]; return next;
}

export function resource(f, intent = 'persistent', ownership = 'harness') {
  f.current.effect = {certainty: 'confirmed', resourceIds: ['fixture-1']};
  const action = intent === 'persistent' ? 'retain' : intent === 'no-obligation' ? 'none' : intent === 'restore' || ownership === 'existing' ? 'restore' : 'cleanup';
  const record = {id: 'fixture-1', originAttemptId: f.current.identity.attemptId, identity: {attemptId: f.current.identity.attemptId, name: 'recordId'}, ownership, intent,
    lifecycle: {action, status: ['retain', 'none'].includes(action) ? 'not-required' : 'pending', evidenceIds: []}};
  f.scenario.resources.push(record); return record;
}
