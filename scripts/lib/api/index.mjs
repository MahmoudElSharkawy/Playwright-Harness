import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {authorizeOperation, checkExecutionWindow, attemptRecord, decideRecovery, registerEvidence} from '../execution-core/index.mjs';
import {requireRun} from '../execution-core/inputs.mjs';
import {data, fingerprint, id, keys, oneOf, requireThat, typedValue, protectedReference} from '../execution-core/data.mjs';
import {createScenarioState, requireScenarioState, initializeStorage, writeScenario, finishScenario, rememberSensitive, publicValue as checkedPublicValue} from '../sequential/state.mjs';
import {apiCapabilities, validateApiOperation, buildRequest, bind, select} from './definition.mjs';
import {ApiFailure, send, bounded} from './transport.mjs';
import {consumerEnvironment} from '../consumer-env.mjs';

export {defineApiOperation, apiCapabilities} from './definition.mjs';
const AUTH_HEADERS = new Set(['authorization', 'x-api-key', 'api-key', 'x-auth-token', 'cookie']);
const phases = {SETUP: 0, EXERCISE: 1, VERIFY: 2, CLEANUP: 3, RESTORE: 3};
const sensitiveKey = name => /(?:password|passwd|pwd|secret|token|authorization|cookie|api.?key|connectionstring)/i.test(name);

/** A text view covers the whole body; JSON ancestors and descendants share confidentiality. */
function overlaps(left, right) {
  if (['text', 'json'].includes(left.from) && ['text', 'json'].includes(right.from) && [left.from, right.from].includes('text')) return true;
  if (left.from !== right.from) return false;
  const normalize = selector => selector.path.map(part => selector.from === 'header' ? String(part).toLowerCase() : String(part));
  const a = normalize(left), b = normalize(right);
  return a.slice(0, Math.min(a.length, b.length)).every((part, index) => part === b[index]);
}

/** Default bearer credentials stay in memory and are resolved only for their selected destination.
 * The shell environment wins; a name it lacks falls back to the consumer's ignored .env.
 */
function environmentCredential({reference}, environment) {
  const value = environment[reference.slice(4)];
  if (!value) throw new ApiFailure('UNAVAILABLE');
  return {authorization: `Bearer ${value}`};
}

/**
 * One sequential API scenario using Node's native HTTP(S) transport and M5 assessment.
 * Call execute from services/helpers or either host; finish validates the same records.
 * Raw responses/authentication remain in memory. Only allowlisted extracted values and
 * sanitized comparison/transport facts are persisted. No host or reporting dependency.
 */
export function createApiRuntime(run, inputRoots, {signal, resolveCredential, resolveSensitive, storeSensitive, execution} = {}) {
  requireRun(run);
  requireThat(run.inputs.scenarios.length === 1, 'M7 accepts one sequential API scenario per run.');
  requireThat(signal === undefined || signal instanceof AbortSignal, 'Cancellation needs an AbortSignal.');
  for (const callback of [resolveCredential, resolveSensitive, storeSensitive]) requireThat(callback === undefined || typeof callback === 'function', 'API resolvers must be functions.');
  const state = execution ? requireScenarioState(execution, run, inputRoots) : createScenarioState(run, inputRoots);
  if (!execution) initializeStorage(state);
  requireThat(state.storageReady, 'Shared storage must be initialized.');
  const {roots, scope, scenario, observations, histories} = state, credentials = new Map();
  resolveCredential ??= context => environmentCredential(context, consumerEnvironment(roots));
  state.releases.push(() => credentials.clear());
  let busy = false, finished = false, phaseNumber = 0, cleanupStartedAt;

  function write(path, value) {
    writeScenario(state, path, value);
  }
  function evidence(attempt, kind, value) {
    const artifactId = `artifact-${randomUUID()}`, path = `evidence/${artifactId}.json`;
    data(value, run.inputs.limits.maxEvidenceBytes); write(path, value);
    const record = registerEvidence(run, roots, {id: artifactId, identity: attempt.identity, kind, path, sanitized: true});
    observations.evidence.push(record); attempt.evidenceIds.push(artifactId); return artifactId;
  }
  const remember = value => rememberSensitive(state, value);
  const publicValue = value => checkedPublicValue(state, value);
  function comparison(value) {
    try { return publicValue(value); } catch { return '[REDACTED OR UNAVAILABLE]'; }
  }
  function publicSelection(response, selector) {
    // Text must not bypass the recursive field screening of an available JSON body.
    if (selector.from === 'text' && response.json !== undefined) publicValue(response.json);
    return publicValue(select(response, selector));
  }
  function getBindings(inputs) {
    const checked = inputs.map(value => typedValue(value, run.inputs.limits.maxValueBytes));
    requireThat(new Set(checked.map(value => value.name)).size === checked.length, 'Duplicate API binding names.');
    for (const value of checked) {
      const source = value.producer.attemptId === undefined
        ? run.inputs.values.find(item => item.name === value.producer.name && item.producer.scenarioId === scope.id)
        : scenario.attempts.find(item => item.identity.attemptId === value.producer.attemptId)?.outputs.find(item => item.name === value.producer.name);
      requireThat(source && fingerprint({...source, name: value.name}) === fingerprint(value), 'API input must bind an immutable input or earlier output.');
    }
    return checked;
  }
  async function auth(targetId, refresh, controller) {
    const target = run.inputs.environment.targets.api[targetId];
    if (!target.credentialRef) return {};
    if (refresh || !credentials.has(targetId)) {
      const resolved = await bounded(() => resolveCredential({reference: target.credentialRef, target: targetId, destination: target.baseUrl, refresh, signal: controller.signal}), controller.signal);
      requireThat(resolved && typeof resolved === 'object' && !Array.isArray(resolved) && Object.keys(resolved).length > 0, 'Credential resolver must return credential headers.');
      const headers = {};
      for (const [name, value] of Object.entries(resolved)) {
        requireThat(AUTH_HEADERS.has(name) && typeof value === 'string' && value.length > 0 && value.length <= 8192 && !/[\r\n\0]/.test(value), 'Invalid credential header.');
        headers[name] = value; remember(value);
        if (name === 'authorization') {
          requireThat(/^(?:Bearer [A-Za-z0-9._~+\/-]+=*|Basic [A-Za-z0-9+/]+=*)$/i.test(value), 'Unsupported authentication scheme.');
          const payload = value.replace(/^\S+\s+/, ''); remember(payload);
          if (/^Basic /i.test(value)) {
            const decoded = Buffer.from(payload, 'base64').toString('utf8'), separator = decoded.indexOf(':');
            requireThat(separator >= 0, 'Invalid Basic credential.'); remember(decoded); remember(decoded.slice(0, separator)); remember(decoded.slice(separator + 1));
          }
        }
        if (name === 'cookie') for (const pair of value.split(';')) {
          const separator = pair.indexOf('='); requireThat(separator > 0, 'Invalid credential cookie.');
          const component = pair.slice(separator + 1).trim().replace(/^"|"$/g, ''); remember(component);
          try {remember(decodeURIComponent(component));} catch { /* The exact cookie value is still protected. */ }
        }
      }
      credentials.set(targetId, Object.freeze(headers));
    }
    return credentials.get(targetId);
  }
  function record(operation, invocationId, phase, number, inputs) {
    return {identity: {runId: run.id, scenarioId: scope.id, operationId: operation.id, invocationId, attemptId: `attempt-${randomUUID()}`, phase, number},
      operationFingerprint: operation.fingerprint, startedAt: Date.now(), endedAt: Date.now(), outcome: 'SUCCESS', failureClass: 'NONE',
      effect: {certainty: 'not-executed', resourceIds: []}, inputs, outputs: [], evidenceIds: [], supportedCapabilities: [...apiCapabilities],
      assertions: scope.expectations.filter(item => item.invocationId === invocationId && item.operationId === operation.id).map(item => ({id: item.id, status: 'NOT_EVALUATED', reliable: false, evidenceIds: []}))};
  }

  /** Execute one definition with typed bindings. Retry is finite and enabled only by established effect facts. */
  async function execute(options) {
    requireThat(!busy && !finished && !state.busy && !state.finished, 'API execution must be sequential and inside the active runtime.');
    keys(options, ['operation', 'invocationId', 'phase', 'inputs', 'retry', 'resource', 'lifecycle'], 'API invocation');
    const operation = validateApiOperation(options.operation), definition = operation.definition;
    const invocationId = options.invocationId, phase = options.phase ?? 'EXERCISE'; id(invocationId); oneOf(phase, Object.keys(phases));
    const inputs = getBindings(options.inputs ?? []), retry = options.retry ?? true;
    const checkPrivateBinding = (value, privateField = false) => {
      if (!value || typeof value !== 'object') return;
      if (Object.hasOwn(value, '$input')) {
        if (privateField) requireThat(inputs.some(input => input.name === value.$input && input.sensitivity === 'sensitive'), 'Sensitive wire fields require protected input bindings.');
      } else for (const [name, child] of Object.entries(value)) checkPrivateBinding(child, privateField || sensitiveKey(name));
    };
    checkPrivateBinding(definition.request);
    if (definition.recovery?.reconcile) checkPrivateBinding(definition.recovery.reconcile.request);
    requireThat(typeof retry === 'boolean' && !histories.has(invocationId) && phases[phase] >= state.phaseNumber, 'Invalid sequential API invocation.');
    const expected = scope.expectations.filter(item => item.operationId === operation.id && item.invocationId === invocationId);
    requireThat(expected.every(item => item.phase === undefined || item.phase === phase), 'API invocation differs from its frozen phase.');
    requireThat(expected.length === definition.checks.length && definition.checks.every(check => expected.some(item => item.id === check.id)), 'API checks must match the frozen invocation expectations.');
    requireThat(expected.every(item => item.requiredEvidence.every(kind => ['response', 'assertion', 'observation'].includes(kind))), 'API assertions require supported evidence kinds.');
    const resource = options.resource === undefined ? undefined : data(options.resource), lifecycle = options.lifecycle === undefined ? undefined : data(options.lifecycle);
    if (resource) {
      keys(resource, ['id', 'output', 'ownership', 'intent', 'beforeStateRef'], 'API resource'); id(resource.id); id(resource.output); oneOf(resource.ownership, ['harness', 'existing']); oneOf(resource.intent, ['temporary', 'restore', 'persistent', 'no-obligation']);
      requireThat(!scenario.resources.some(item => item.id === resource.id) && definition.extract?.some(item => item.name === resource.output), 'New resource requires a unique identity output.');
      if (resource.beforeStateRef !== undefined) protectedReference(resource.beforeStateRef);
    }
    if (lifecycle) {
      keys(lifecycle, ['resourceId', 'guard'], 'API lifecycle'); id(lifecycle.resourceId);
      const existing = scenario.resources.find(item => item.id === lifecycle.resourceId);
      requireThat(existing && ['pending', 'failed', 'conflict'].includes(existing.lifecycle.status) && existing.lifecycle.action.toUpperCase() === phase, 'Lifecycle invocation needs an outstanding matching obligation.');
      if (phase === 'RESTORE') {
        requireThat(lifecycle.guard === 'version' && Object.hasOwn(definition.request.headers ?? {}, 'if-match'), 'Restoration requires a target-supported conditional version header.');
      } else requireThat(lifecycle.guard === undefined, 'Cleanup does not use restoration guards.');
      requireThat(inputs.some(value => value.producer.attemptId === existing.identity.attemptId && value.producer.name === existing.identity.name), 'Lifecycle must bind the recorded resource identity.');
    }
    const authorization = authorizeOperation(run, operation, apiCapabilities);
    if (operation.source.kind === 'exploration') {
      const previous = observations.operations.find(item => item.id === operation.id);
      requireThat(!previous || previous.fingerprint === operation.fingerprint, 'Run-local API definition changed.');
      if (!previous) observations.operations.push(operation);
    }
    phaseNumber = state.phaseNumber = phases[phase]; if (phaseNumber === 3) state.cleanupStartedAt ??= Date.now(); cleanupStartedAt = state.cleanupStartedAt;
    busy = state.busy = true; const history = []; histories.set(invocationId, history); let refresh = false, resolvedBindings;
    try {
      for (let number = 1; number <= run.inputs.limits.maxAttempts; number++) {
        const current = record(operation, invocationId, phase, number, inputs), controller = new AbortController();
        const cancel = () => controller.abort('CANCELLED');
        const window = checkExecutionWindow(run, {phase, signal, cleanupStartedAt});
        const budget = Math.min(window.remainingMs, definition.timeoutMs ?? 10000);
        let timer, response, dispatched = false, failure, bindings;
        if (phaseNumber !== 3) signal?.addEventListener('abort', cancel, {once: true});
        if (!window.allowed) controller.abort(window.remainingMs === 0 ? 'TIMEOUT' : 'CANCELLED');
        else timer = setTimeout(() => controller.abort('TIMEOUT'), budget);
        const transmit = async requestDefinition => {
          const request = buildRequest(run.inputs.environment.targets.api[operation.target], requestDefinition, bindings, requestDefinition === definition.request ? definition.recovery?.idempotency : undefined);
          if (phase === 'RESTORE' && requestDefinition === definition.request) requireThat(/^"[^"\r\n]+"$/.test(request.headers['if-match'] ?? ''), 'Restoration needs a concrete strong version, never a wildcard.');
          request.headers = {...request.headers, ...await auth(operation.target, refresh, controller)}; refresh = false;
          return await send(request, {signal: controller.signal, timeoutMs: budget, maxResponseBytes: definition.maxResponseBytes ?? 1048576});
        };
        try {
          if (!authorization.allowed) {current.outcome = 'BLOCKED'; current.failureClass = 'POLICY';}
          else {
            if (controller.signal.aborted) throw new ApiFailure(controller.signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED');
            if (!resolvedBindings) {
              bindings = new Map();
              for (const input of inputs) {
                let value = input.value;
                if (input.sensitivity === 'sensitive') {
                  requireThat(resolveSensitive, 'Sensitive inputs need protected runtime storage.');
                  value = await bounded(() => resolveSensitive(input.protectedRef, {signal: controller.signal}), controller.signal);
                  // Snapshot actual request inputs once per invocation; retries cannot re-read mutable storage.
                  const serialized = JSON.stringify(value);
                  requireThat(typeof serialized === 'string' && Buffer.byteLength(serialized) <= run.inputs.limits.maxValueBytes, 'Protected input exceeds its limit.');
                  value = JSON.parse(serialized); remember(value);
                  const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
                  requireThat(actual === input.type, 'Protected input type does not match.');
                }
                bindings.set(input.name, value);
              }
              resolvedBindings = bindings;
            }
            bindings = resolvedBindings;
            response = await transmit(definition.request); dispatched = true;
            const effect = definition.effects;
            current.effect.certainty = effect.readOnlyContract || effect.noEffectStatuses?.includes(response.status) ? 'none' : effect.confirmedStatuses?.includes(response.status) ? 'confirmed' : 'uncertain';
            const observationId = evidence(current, 'observation', {target: operation.target, method: definition.request.method, status: response.status, responseBytes: response.bytes});
            const responseId = evidence(current, 'response', {status: response.status, responseBytes: response.bytes, jsonAvailable: response.json !== undefined});
            if (definition.recovery?.authentication?.statuses.includes(response.status)) {
              requireThat(run.inputs.environment.targets.api[operation.target].credentialRef, 'Authentication refresh needs a configured credential reference.');
              refresh = true; throw new ApiFailure('UNAVAILABLE', true, 'AUTHENTICATION_REJECTED');
            }
            // Classify declared confidential outputs before any assertion evidence is serialized.
            const sensitiveSelectors = (definition.extract ?? []).filter(item => item.sensitivity === 'sensitive').map(item => item.select);
            for (const selector of sensitiveSelectors) remember(select(response, selector));
            for (const check of definition.checks) {
              const actual = select(response, check.select), expectedValue = bind(check.equals, bindings), passed = actual !== undefined && isDeepStrictEqual(actual, expectedValue);
              const sensitive = check.select.from === 'header' && sensitiveKey(check.select.path[0]) || check.select.path.some(part => sensitiveKey(String(part))) || sensitiveSelectors.some(selector => overlaps(selector, check.select));
              let observed = '[REDACTED]';
              if (!sensitive) {try {observed = publicSelection(response, check.select);} catch {observed = '[REDACTED OR UNAVAILABLE]';}}
              const assertionId = evidence(current, 'assertion', {check: check.id, passed, actual: observed, expected: sensitive ? '[REDACTED]' : comparison(expectedValue)});
              current.assertions.find(item => item.id === check.id).status = passed ? 'PASS' : 'FAIL';
              Object.assign(current.assertions.find(item => item.id === check.id), {reliable: true, evidenceIds: [responseId, observationId, assertionId]});
            }
            for (const extraction of definition.extract ?? []) {
              const value = select(response, extraction.select), actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
              requireThat(actual === extraction.type, 'API output has a missing or incorrect type.');
              const output = {name: extraction.name, type: extraction.type, sensitivity: extraction.sensitivity,
                producer: {runId: run.id, scenarioId: scope.id, attemptId: current.identity.attemptId, name: extraction.name}};
              if (extraction.sensitivity === 'sensitive') {
                requireThat(storeSensitive, 'Sensitive extraction needs protected runtime storage.'); remember(value);
                output.protectedRef = await bounded(() => storeSensitive(value, {identity: current.identity, name: extraction.name, signal: controller.signal}), controller.signal);
              } else {
                requireThat(!sensitiveSelectors.some(selector => overlaps(selector, extraction.select)), 'A sensitive selector cannot also produce a public output.');
                requireThat(!(extraction.select.from === 'header' && sensitiveKey(extraction.select.path[0])) && !extraction.select.path.some(part => sensitiveKey(String(part))), 'Sensitive selectors cannot produce public outputs.');
                output.value = publicSelection(response, extraction.select);
              }
              current.outputs.push(typedValue(output, run.inputs.limits.maxValueBytes));
            }
            if (controller.signal.aborted) throw new ApiFailure(controller.signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED', true);
          }
        } catch (error) {
          failure = error instanceof ApiFailure ? error : new ApiFailure('EXECUTOR', dispatched);
          dispatched ||= failure.dispatched;
          current.outcome = 'INFRASTRUCTURE_FAILURE'; current.failureClass = failure.classification;
          if (current.effect.certainty === 'not-executed') current.effect.certainty = !dispatched ? 'not-executed' : definition.effects.readOnlyContract ? 'none' : 'uncertain';
        }
        try {
          if (failure && current.effect.certainty === 'uncertain' && !controller.signal.aborted) {
            const recovery = definition.recovery ?? {};
            if (recovery.reconcile) {
              let kind = 'inconclusive', status;
              try {
                requireThat(run.inputs.environment.capabilities.apiReads, 'Reconciliation read capability is disabled.');
                const proof = await transmit(recovery.reconcile.request); status = proof.status;
                if (status === recovery.reconcile.status && isDeepStrictEqual(select(proof, recovery.reconcile.select), bind(recovery.reconcile.equals, bindings))) kind = recovery.reconcile.whenEqual;
              } catch { /* Preserve uncertain effects when reconciliation cannot establish its facts. */ }
              const proofId = evidence(current, 'reconciliation', {kind, readOnlyContract: recovery.reconcile.readOnlyContract, ...(status === undefined ? {} : {status})});
              current.reconciliation = {kind, evidenceIds: [proofId]};
            } else if (recovery.idempotency) {
              const proofId = evidence(current, 'reconciliation', {kind: 'supported-idempotency', contractRef: recovery.idempotency.contractRef, boundInput: recovery.idempotency.input});
              current.reconciliation = {kind: 'supported-idempotency', contractRef: recovery.idempotency.contractRef, evidenceIds: [proofId]};
            }
          }
        } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
        if (current.assertions.some(item => item.status === 'FAIL' && item.reliable)) {current.outcome = 'ASSERTION_FAILURE'; current.failureClass = 'ASSERTION';}
        if (failure && response && failure.reason !== 'AUTHENTICATION_REJECTED' && !scenario.issues.includes('indeterminate-outcome')) scenario.issues.push('indeterminate-outcome');
        if (resource && current.effect.certainty === 'confirmed') {
          const output = current.outputs.find(item => item.name === resource.output);
          if (output) {
            const action = resource.intent === 'persistent' ? 'retain' : resource.intent === 'no-obligation' ? 'none' : resource.intent === 'restore' || resource.ownership === 'existing' ? 'restore' : 'cleanup';
            scenario.resources.push({id: resource.id, originAttemptId: current.identity.attemptId, identity: {attemptId: current.identity.attemptId, name: output.name}, ownership: resource.ownership, intent: resource.intent,
              ...(resource.beforeStateRef ? {beforeStateRef: resource.beforeStateRef} : {}), lifecycle: {action, status: ['retain', 'none'].includes(action) ? 'not-required' : 'pending', evidenceIds: []}});
            current.effect.resourceIds.push(resource.id);
          } else if (!scenario.issues.includes('indeterminate-outcome')) scenario.issues.push('indeterminate-outcome');
        }
        if (lifecycle) {
          const existing = scenario.resources.find(item => item.id === lifecycle.resourceId);
          const complete = current.outcome === 'SUCCESS' && current.effect.certainty === 'confirmed' && response?.status !== 412;
          const proof = evidence(current, 'lifecycle', {resourceId: existing.id, complete, ...(lifecycle.guard ? {guard: lifecycle.guard} : {})});
          if (current.effect.certainty === 'confirmed') current.effect.resourceIds.push(existing.id);
          existing.lifecycle = {...existing.lifecycle, status: complete ? 'completed' : response?.status === 412 ? 'conflict' : 'failed', attemptId: current.identity.attemptId, evidenceIds: [proof],
            ...(lifecycle.guard ? {guard: {kind: lifecycle.guard, evidenceIds: [proof]}} : {})};
        }
        evidence(current, 'observation', {target: operation.target, method: definition.request.method, dispatched, ...(failure ? {reason: failure.reason} : {}), effect: current.effect.certainty});
        current.endedAt = Date.now();
        // Synchronous evidence/serialization can cross the wall clock limit too.
        if (current.outcome === 'SUCCESS' && current.endedAt > (phaseNumber === 3 ? cleanupStartedAt + run.inputs.limits.cleanupTimeoutMs : run.deadlineAt)) {current.outcome = 'INFRASTRUCTURE_FAILURE'; current.failureClass = 'TIMEOUT';}
        const completed = attemptRecord(run, current); history.push(completed); scenario.attempts.push(completed);
        const transient = failure && ['TRANSPORT', 'TIMEOUT', 'AUTHENTICATION_REJECTED'].includes(failure.reason);
        if (!retry || !transient || signal?.aborted && phaseNumber !== 3 || decideRecovery(run, history, {evidence: observations.evidence, roots, cleanupStartedAt}).action !== 'RETRY') return completed;
      }
      return history.at(-1);
    } finally {busy = state.busy = false;}
  }

  /** Select typed business outputs explicitly; finish never copies unrestricted response bodies. */
  function selectOutput(attempt, name) {
    requireThat(!finished && !state.finished && !state.busy && !busy && scenario.attempts.includes(attempt) && attempt.outputs.some(output => output.name === name), 'Output must belong to a completed API attempt.');
    scenario.outputRefs.push({attemptId: attempt.identity.attemptId, name});
  }
  /** Validate required scope, evidence integrity and intent-driven lifecycle obligations once. */
  function finish() {
    requireThat(!execution && !busy && !finished, 'Finish needs an idle active standalone API runtime.'); finished = true;
    return finishScenario(state);
  }
  return Object.freeze({execute, selectOutput, finish});
}
