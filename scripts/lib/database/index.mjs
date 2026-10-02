import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {authorizeOperation, checkExecutionWindow, attemptRecord, decideRecovery, registerEvidence} from '../execution-core/index.mjs';
import {requireRun} from '../execution-core/inputs.mjs';
import {data, fingerprint, id, keys, oneOf, requireThat, typedValue, protectedReference} from '../execution-core/data.mjs';
import {createScenarioState, requireScenarioState, initializeStorage, writeScenario, finishScenario, rememberSensitive, publicValue as checkedPublicValue} from '../sequential/state.mjs';
import {databaseCapabilities, validateDatabaseOperation, bindDatabase, select, expected} from './definition.mjs';
import {DatabaseFailure, bounded, credentials} from './shared.mjs';
import * as sqlserver from './sqlserver-driver.mjs';
import * as postgresql from './postgresql-driver.mjs';
import {consumerEnvironment} from '../consumer-env.mjs';

export {defineDatabaseOperation, databaseCapabilities} from './definition.mjs';
const phases = {SETUP: 0, EXERCISE: 1, VERIFY: 2, CLEANUP: 3, RESTORE: 3};
const sensitiveKey = name => /(?:password|passwd|pwd|secret|token|authorization|cookie|api.?key|connectionstring)/i.test(name);
const overlaps = (a, b) => a.from === b.from && a.path.slice(0, Math.min(a.path.length, b.path.length)).every((part, i) => String(part) === String(b.path[i]));
// The shell environment wins; a name it lacks falls back to the consumer's ignored .env.
function environmentCredential({reference}, environment) {
  try {return JSON.parse(environment[reference.slice(4)]);} catch {throw new DatabaseFailure('UNAVAILABLE');}
}

/** One sequential database scenario; native SQL and types stay in the selected driver. */
export function createDatabaseRuntime(run, inputRoots, {signal, resolveCredential, resolveSensitive, storeSensitive, execution} = {}) {
  requireRun(run); requireThat(run.inputs.scenarios.length === 1, 'Database execution accepts one sequential scenario per run.');
  requireThat(signal === undefined || signal instanceof AbortSignal, 'Cancellation needs an AbortSignal.');
  for (const callback of [resolveCredential, resolveSensitive, storeSensitive]) requireThat(callback === undefined || typeof callback === 'function', 'Database resolvers must be functions.');
  const state = execution ? requireScenarioState(execution, run, inputRoots) : createScenarioState(run, inputRoots);
  if (!execution) initializeStorage(state);
  requireThat(state.storageReady, 'Shared storage must be initialized.');
  const {roots, scope, scenario, observations, histories} = state, authCache = new Map();
  resolveCredential ??= context => environmentCredential(context, consumerEnvironment(roots));
  state.releases.push(() => authCache.clear());
  let busy = false, finished = false, phaseNumber = 0, cleanupStartedAt;
  function write(path, value) {
    writeScenario(state, path, value);
  }
  function evidence(attempt, kind, value) {
    const artifactId = `artifact-${randomUUID()}`, path = `evidence/${artifactId}.json`;
    data(value, run.inputs.limits.maxEvidenceBytes); write(path, value);
    observations.evidence.push(registerEvidence(run, roots, {id: artifactId, identity: attempt.identity, kind, path, sanitized: true})); attempt.evidenceIds.push(artifactId); return artifactId;
  }
  const remember = value => rememberSensitive(state, value);
  const publicValue = value => checkedPublicValue(state, value);
  function comparison(value) {try {return publicValue(value);} catch {return '[REDACTED OR UNAVAILABLE]';}}
  function getBindings(inputs) {
    const checked = inputs.map(value => typedValue(value, run.inputs.limits.maxValueBytes));
    requireThat(new Set(checked.map(v => v.name)).size === checked.length, 'Duplicate database bindings.');
    for (const v of checked) {
      const source = v.producer.attemptId === undefined ? run.inputs.values.find(item => item.name === v.producer.name && item.producer.scenarioId === scope.id)
        : scenario.attempts.find(item => item.identity.attemptId === v.producer.attemptId)?.outputs.find(item => item.name === v.producer.name);
      requireThat(source && fingerprint({...source, name: v.name}) === fingerprint(v), 'Database input must bind an immutable input or earlier output.');
    }
    return checked;
  }
  function record(operation, invocationId, phase, number, inputs) {
    return {identity: {runId: run.id, scenarioId: scope.id, operationId: operation.id, invocationId, attemptId: `attempt-${randomUUID()}`, phase, number}, operationFingerprint: operation.fingerprint,
      startedAt: Date.now(), endedAt: Date.now(), outcome: 'SUCCESS', failureClass: 'NONE', effect: {certainty: 'not-executed', resourceIds: []}, inputs, outputs: [], evidenceIds: [], supportedCapabilities: [...databaseCapabilities],
      assertions: scope.expectations.filter(e => e.invocationId === invocationId && e.operationId === operation.id).map(e => ({id: e.id, status: 'NOT_EVALUATED', reliable: false, evidenceIds: []}))};
  }
  async function execute(options) {
    requireThat(!busy && !finished && !state.busy && !state.finished, 'Database execution must be sequential inside its active runtime.');
    keys(options, ['operation','invocationId','phase','inputs','retry','resource','lifecycle'], 'database invocation');
    const operation = validateDatabaseOperation(options.operation), d = operation.definition, invocationId = options.invocationId, phase = options.phase ?? 'EXERCISE';
    id(invocationId); oneOf(phase, Object.keys(phases));
    const inputs = getBindings(options.inputs ?? []), retry = options.retry ?? true;
    requireThat(typeof retry === 'boolean' && !histories.has(invocationId) && phases[phase] >= state.phaseNumber, 'Invalid sequential database invocation.');
    const expectations = scope.expectations.filter(e => e.operationId === operation.id && e.invocationId === invocationId);
    requireThat(expectations.every(item => item.phase === undefined || item.phase === phase), 'Database invocation differs from its frozen phase.');
    requireThat(expectations.length === d.checks.length && d.checks.every(c => expectations.some(e => e.id === c.id)) && expectations.every(e => e.requiredEvidence.every(kind => ['response','assertion','observation'].includes(kind))), 'Database checks must match frozen expectations and supported evidence.');
    for (const p of d.parameters ?? []) if (sensitiveKey(p.name)) requireThat(inputs.some(v => v.name === p.input && v.sensitivity === 'sensitive'), 'Sensitive SQL parameters need protected bindings.');
    const resource = options.resource === undefined ? undefined : data(options.resource), lifecycle = options.lifecycle === undefined ? undefined : data(options.lifecycle);
    if (resource) {
      keys(resource, ['id','output','ownership','intent','beforeStateRef'], 'database resource'); id(resource.id); id(resource.output); oneOf(resource.ownership, ['harness','existing']); oneOf(resource.intent, ['temporary','restore','persistent','no-obligation']);
      requireThat(!scenario.resources.some(r => r.id === resource.id) && d.extract?.some(e => e.name === resource.output), 'Resource needs a unique identity output.'); if (resource.beforeStateRef) protectedReference(resource.beforeStateRef);
    }
    if (lifecycle) {
      keys(lifecycle, ['resourceId'], 'database lifecycle'); id(lifecycle.resourceId);
      const existing = scenario.resources.find(r => r.id === lifecycle.resourceId);
      requireThat(existing && ['pending','failed','conflict'].includes(existing.lifecycle.status) && existing.lifecycle.action.toUpperCase() === phase, 'Lifecycle needs an outstanding matching obligation.');
      requireThat(inputs.some(v => v.producer.attemptId === existing.identity.attemptId && v.producer.name === existing.identity.name && (d.parameters ?? []).some(p => p.input === v.name && (phase !== 'RESTORE' || p.name === d.restorationGuard?.identityParameter))), 'Lifecycle must bind its recorded resource identity.');
      if (phase === 'RESTORE') {
        requireThat(d.restorationGuard, 'Restoration requires a conditional identity/version definition.');
        const version = d.parameters.find(p => p.name === d.restorationGuard.versionParameter);
        requireThat(inputs.some(v => v.name === version.input && v.producer.attemptId === existing.originAttemptId), 'Restoration version must bind the original change output.');
      }
    }
    const authorization = authorizeOperation(run, operation, databaseCapabilities);
    requireThat(authorization.reason !== 'DEFINITION_NOT_FROZEN', 'Database definition is not an immutable run input.');
    if (operation.source.kind === 'exploration') {
      const previous = observations.operations.find(item => item.id === operation.id); requireThat(!previous || previous.fingerprint === operation.fingerprint, 'Run-local database definition changed.'); if (!previous) observations.operations.push(operation);
    }
    phaseNumber = state.phaseNumber = phases[phase]; if (phaseNumber === 3) state.cleanupStartedAt ??= Date.now(); cleanupStartedAt = state.cleanupStartedAt;
    busy = state.busy = true; const history = []; histories.set(invocationId, history); let resolvedBindings;
    try {
      for (let number = 1; number <= run.inputs.limits.maxAttempts; number++) {
        const current = record(operation, invocationId, phase, number, inputs), controller = new AbortController(), window = checkExecutionWindow(run, {phase, signal, cleanupStartedAt});
        const cancel = () => controller.abort('CANCELLED'), budget = Math.min(window.remainingMs, d.timeoutMs ?? 10000);
        if (phaseNumber !== 3) signal?.addEventListener('abort', cancel, {once: true});
        let timer, response, failure;
        if (!window.allowed) controller.abort(window.remainingMs === 0 ? 'TIMEOUT' : 'CANCELLED'); else timer = setTimeout(() => controller.abort('TIMEOUT'), budget);
        try {
          if (!authorization.allowed) {current.outcome = 'BLOCKED'; current.failureClass = 'POLICY';}
          else {
            if (controller.signal.aborted) throw new DatabaseFailure(controller.signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED');
            const target = run.inputs.environment.targets.databases[operation.target];
            requireThat((d.engine ?? 'sqlserver') === target.engine, 'Database definition and configured target engines differ.');
            const driver = target.engine === 'sqlserver' ? sqlserver : postgresql;
            driver.validateTarget(target);
            if (!resolvedBindings) {
              const bindings = new Map();
              for (const input of inputs) {
                let value = input.value;
                if (input.sensitivity === 'sensitive') {
                  requireThat(resolveSensitive, 'Sensitive inputs need protected storage.');
                  value = await bounded(() => resolveSensitive(input.protectedRef, {signal: controller.signal}), controller.signal);
                  const serialized = JSON.stringify(value); requireThat(typeof serialized === 'string' && Buffer.byteLength(serialized) <= run.inputs.limits.maxValueBytes, 'Protected input exceeds its limit.'); value = JSON.parse(serialized); remember(value);
                  requireThat((value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value) === input.type, 'Protected input type does not match.');
                }
                bindings.set(input.name, value);
              }
              resolvedBindings = bindings;
            }
            const request = bindDatabase(d, resolvedBindings);
            if (!authCache.has(operation.target)) {
              const auth = credentials(await bounded(() => resolveCredential({reference: target.connectionRef, target: operation.target, destination: {server: target.server, port: target.port ?? (target.engine === 'sqlserver' ? 1433 : 5432), database: target.database, schema: target.schema}, signal: controller.signal}), controller.signal));
              remember(auth.user); remember(auth.password); authCache.set(operation.target, auth);
            }
            response = await (target.engine === 'sqlserver' ? driver.executeSqlServer : driver.executePostgresql)(target, authCache.get(operation.target), request, {signal: controller.signal, timeoutMs: budget, maxRows: d.maxRows ?? 1000, maxResponseBytes: d.maxResponseBytes ?? 1048576});
            current.effect.certainty = operation.capability === 'dbSelect' ? 'none' : response.affectedRows === undefined ? 'uncertain' : response.affectedRows === 0 ? 'none' : 'confirmed';
            if (operation.capability === 'dbDml' && response.affectedRows !== undefined) current.effect.affectedRows = {actual: response.affectedRows, ...(d.affectedRows ? {expected: d.affectedRows} : {})};
            const responseId = evidence(current, 'response', {rowCount: response.rowCount, rowsAffected: response.rowsAffected, bytes: response.bytes});
            const observationId = evidence(current, 'observation', {target: operation.target, rowCount: response.rowCount, effect: current.effect.certainty});
            if (operation.capability === 'dbDml' && response.affectedRows === undefined) throw new DatabaseFailure('EXECUTOR', true, 'AMBIGUOUS_AFFECTED_ROWS');
            const sensitiveSelectors = (d.extract ?? []).filter(e => e.sensitivity === 'sensitive').map(e => e.select);
            for (const selector of sensitiveSelectors) remember(select(response, selector));
            for (const check of d.checks) {
              const actual = select(response, check.select), wanted = expected(check, resolvedBindings), passed = actual !== undefined && isDeepStrictEqual(actual, wanted);
              const sensitive = check.select.path.some(part => sensitiveKey(String(part))) || sensitiveSelectors.some(selector => overlaps(selector, check.select));
              const proof = evidence(current, 'assertion', {check: check.id, passed, actual: sensitive ? '[REDACTED]' : comparison(actual), expected: sensitive ? '[REDACTED]' : comparison(wanted)});
              Object.assign(current.assertions.find(a => a.id === check.id), {status: passed ? 'PASS' : 'FAIL', reliable: true, evidenceIds: [responseId, observationId, proof]});
            }
            for (const extraction of d.extract ?? []) {
              const value = select(response, extraction.select), type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
              requireThat(type === extraction.type, 'Database output is missing or has an incorrect type.');
              const output = {name: extraction.name, type, sensitivity: extraction.sensitivity, producer: {runId: run.id, scenarioId: scope.id, attemptId: current.identity.attemptId, name: extraction.name}};
              if (extraction.sensitivity === 'sensitive') {requireThat(storeSensitive, 'Sensitive extraction needs protected storage.'); remember(value); output.protectedRef = await bounded(() => storeSensitive(value, {identity: current.identity, name: extraction.name, signal: controller.signal}), controller.signal);}
              else {requireThat(!extraction.select.path.some(part => sensitiveKey(String(part))) && !sensitiveSelectors.some(selector => overlaps(selector, extraction.select)), 'Sensitive selections cannot produce public outputs.'); output.value = publicValue(value);}
              current.outputs.push(typedValue(output, run.inputs.limits.maxValueBytes));
            }
          }
        } catch (error) {
          failure = error instanceof DatabaseFailure ? error : new DatabaseFailure('EXECUTOR', !!response);
          current.outcome = 'INFRASTRUCTURE_FAILURE'; current.failureClass = failure.classification;
          if (current.effect.certainty === 'not-executed') current.effect.certainty = !failure.dispatched ? 'not-executed' : operation.capability === 'dbSelect' ? 'none' : 'uncertain';
          if (response && !scenario.issues.includes('indeterminate-outcome')) scenario.issues.push('indeterminate-outcome');
        } finally {clearTimeout(timer); signal?.removeEventListener('abort', cancel);}
        const countFailed = current.effect.affectedRows?.expected && (current.effect.affectedRows.actual < d.affectedRows.min || current.effect.affectedRows.actual > d.affectedRows.max);
        if (countFailed || current.assertions.some(a => a.status === 'FAIL' && a.reliable)) {current.outcome = 'ASSERTION_FAILURE'; current.failureClass = 'ASSERTION';}
        if (resource && current.effect.certainty === 'confirmed') {
          const output = current.outputs.find(o => o.name === resource.output);
          if (output) {
            const action = resource.intent === 'persistent' ? 'retain' : resource.intent === 'no-obligation' ? 'none' : resource.intent === 'restore' || resource.ownership === 'existing' ? 'restore' : 'cleanup';
            scenario.resources.push({id: resource.id, originAttemptId: current.identity.attemptId, identity: {attemptId: current.identity.attemptId, name: output.name}, ownership: resource.ownership, intent: resource.intent,
              ...(resource.beforeStateRef ? {beforeStateRef: resource.beforeStateRef} : {}), lifecycle: {action, status: ['retain','none'].includes(action) ? 'not-required' : 'pending', evidenceIds: []}}); current.effect.resourceIds.push(resource.id);
          } else if (!scenario.issues.includes('indeterminate-outcome')) scenario.issues.push('indeterminate-outcome');
        }
        if (lifecycle) {
          const existing = scenario.resources.find(r => r.id === lifecycle.resourceId), complete = current.outcome === 'SUCCESS' && current.effect.certainty === 'confirmed' && (phase !== 'RESTORE' || response?.restorationGuardVerified);
          const proof = evidence(current, 'lifecycle', {resourceId: existing.id, complete, ...(phase === 'RESTORE' ? {guard: 'version', verified: response?.restorationGuardVerified === true} : {})});
          if (current.effect.certainty === 'confirmed') current.effect.resourceIds.push(existing.id);
          existing.lifecycle = {...existing.lifecycle, status: complete ? 'completed' : phase === 'RESTORE' && response?.affectedRows === 0 ? 'conflict' : 'failed', attemptId: current.identity.attemptId, evidenceIds: [proof], ...(phase === 'RESTORE' ? {guard: {kind: 'version', evidenceIds: [proof]}} : {})};
        }
        evidence(current, 'observation', {target: operation.target, dispatched: current.effect.certainty !== 'not-executed', effect: current.effect.certainty, ...(failure ? {reason: failure.reason} : {})});
        current.endedAt = Date.now();
        if (current.outcome === 'SUCCESS' && current.endedAt > (phaseNumber === 3 ? cleanupStartedAt + run.inputs.limits.cleanupTimeoutMs : run.deadlineAt)) {current.outcome = 'INFRASTRUCTURE_FAILURE'; current.failureClass = 'TIMEOUT';}
        const completed = attemptRecord(run, current); history.push(completed); scenario.attempts.push(completed);
        if (!retry || !failure || !['TRANSPORT','TIMEOUT'].includes(failure.reason) || signal?.aborted && phaseNumber !== 3 || decideRecovery(run, history, {evidence: observations.evidence, roots, cleanupStartedAt}).action !== 'RETRY') return completed;
      }
      return history.at(-1);
    } finally {busy = state.busy = false;}
  }
  function selectOutput(attempt, name) {requireThat(!finished && !state.finished && !state.busy && !busy && scenario.attempts.includes(attempt) && attempt.outputs.some(o => o.name === name), 'Output must belong to a completed database attempt.'); scenario.outputRefs.push({attemptId: attempt.identity.attemptId, name});}
  function finish() {
    requireThat(!execution && !busy && !finished, 'Finish needs an idle active standalone database runtime.'); finished = true;
    return finishScenario(state);
  }
  return Object.freeze({execute, selectOutput, finish});
}
