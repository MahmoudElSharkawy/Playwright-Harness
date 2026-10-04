import {readFile, writeFile, lstat, realpath, unlink} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {defineOperation, authorizeOperation, checkExecutionWindow, attemptRecord, decideRecovery, registerEvidence, verifyEvidence} from '../execution-core/index.mjs';
import {requireRun} from '../execution-core/inputs.mjs';
import {data, id, oneOf, typedValue} from '../execution-core/data.mjs';
import {within} from '../skill-roots.mjs';
import {prepareNativeSession, NativeFailure} from './native-cli.mjs';
import {prepareSettlement, projectOutcome} from './settlement.mjs';
import {createScenarioState, requireScenarioState, acceptBrowserStorage, finishScenario, inputBindings, publicValue, rememberSensitive, phaseOrder, checkWorkWindow, observationBudgetReached, requireObservationCapacity} from '../sequential/state.mjs';

export const browserCapabilities = Object.freeze(['browserReads', 'browserMutations']);
// Bound trusted asynchronous callbacks as well as native commands. This cannot preempt
// synchronous JavaScript; host process limits remain responsible for that case.
function boundedWork(action, currentWindow, signal, expire = () => {}) {
  return new Promise((resolveResult, reject) => {
    let settled = false, expiring = false, timer;
    const finish = (error, value) => {
      if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', check);
      if (error) reject(error); else resolveResult(value);
    };
    const check = () => {
      clearTimeout(timer);
      try {const window = currentWindow(); timer = setTimeout(check, window.timeoutMs);}
      catch (error) {if (!expiring) {expiring = true; Promise.resolve().then(() => expire(error)).then(() => finish(error), () => finish(error));}}
    };
    signal?.addEventListener('abort', check); check();
    if (!settled && !expiring) Promise.resolve().then(() => {if (!settled && !expiring) return action();}).then(value => {
      if (settled || expiring) return;
      try {currentWindow(); finish(undefined, value);} catch {check();}
    }, error => {if (!expiring) finish(error);});
  });
}
/** Include these ownership operations in the immutable run before executing a scenario. */
export function browserLifecycleOperations(target) {
  return ['setup', 'cleanup'].map(phase => defineOperation({id: `browser-${phase}`, family: 'browser', target, capability: 'browserReads',
    source: {kind: 'helper', reference: 'owned-browser-lifecycle', version: '1.0.0'}, definition: {intent: `${phase} owned isolated browser session`}}));
}

/** One sequential browser scenario. The callback uses the official native CLI, not a harness action language. */
export async function runBrowserScenario(run, roots, {target, storageState, secrets = {}, signal, nativeTimeoutMs, commandTimeoutMs, execution, onUnavailable, nativeSession = prepareNativeSession} = {}, body) {
  requireRun(run); id(target);
  if (run.inputs.scenarios.length !== 1 || typeof body !== 'function') throw new Error('M6 accepts one sequential browser scenario per run.');
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new Error('Cancellation needs an AbortSignal.');
  const scope = run.inputs.scenarios[0], lifecycle = browserLifecycleOperations(target);
  const state = execution ? requireScenarioState(execution, run, roots) : createScenarioState(run, roots);
  for (const value of Object.values(secrets)) rememberSensitive(state, value);
  if (state.storageReady || state.busy) throw new Error('Browser session must acquire this scenario storage first.');
  if (onUnavailable !== undefined && (!execution || typeof onUnavailable !== 'function')) throw new Error('Unavailable handling belongs to the mixed scenario owner.');
  for (const operation of lifecycle) if (!authorizeOperation(run, operation, browserCapabilities).allowed) throw new Error('Owned browser lifecycle is not frozen or permitted for this target.');
  const invocations = new Map();
  for (const expectation of scope.expectations) {
    const invocation = invocations.get(expectation.invocationId) ?? {invocationId: expectation.invocationId, operationId: expectation.operationId};
    if (invocation.operationId !== expectation.operationId || invocation.phase !== undefined && expectation.phase !== undefined && invocation.phase !== expectation.phase) throw new Error('Frozen invocation has incompatible operations or phases.');
    invocation.phase ??= expectation.phase; invocations.set(invocation.invocationId, invocation);
  }
  const origins = run.inputs.environment.targets.browser[target].origins;
  const initialWindow = checkExecutionWindow(run, {phase: 'SETUP', signal});
  if (!initialWindow.allowed) throw new NativeFailure(initialWindow.reason === 'CANCELLED' ? 'CANCELLED' : 'TIMEOUT');
  if (typeof nativeSession !== 'function') throw new Error('Native session factory must be a function.');
  const native = await nativeSession(roots, {origins, storageState, secrets, ...(nativeTimeoutMs === undefined ? {} : {nativeTimeoutMs}), ...(commandTimeoutMs === undefined ? {} : {commandTimeoutMs})});
  let nativeCleanup;
  const closeOwnedSession = () => {
    state.cleanupStartedAt ??= Date.now();
    return nativeCleanup ??= native.close({deadlineAt: state.cleanupStartedAt + run.inputs.limits.cleanupTimeoutMs});
  };
  async function runOwnedScenario() {
  roots = native.roots;
  acceptBrowserStorage(state, roots);
  const {scenario, observations, histories} = state;
  const activeAttempts = new Set();
  let busy = false, finished = false, cleanupStartedAt, scenarioFailure, bodyInterrupted = false;
  const indeterminate = () => {if (!scenario.issues.includes('indeterminate-outcome')) scenario.issues.push('indeterminate-outcome');};
  function record(operation, invocationId, phase, number = 1, inputs = []) {
    const identity = {runId: run.id, scenarioId: scope.id, operationId: operation.id, invocationId, attemptId: `attempt-${randomUUID()}`, phase, number};
    return {identity, operationFingerprint: operation.fingerprint, startedAt: Date.now(), endedAt: Date.now(), outcome: 'SUCCESS', failureClass: 'NONE', effect: {certainty: 'none', resourceIds: []},
      inputs: data(inputs), outputs: [], assertions: scope.expectations.filter(item => item.operationId === operation.id && item.invocationId === invocationId).map(item => ({id: item.id, status: 'NOT_EVALUATED', reliable: false, evidenceIds: []})), evidenceIds: [], supportedCapabilities: [...browserCapabilities]};
  }
  function window(attempt, cleanup = false, work = false) {
    const options = {phase: attempt.identity.phase, signal: cleanup ? undefined : signal};
    const value = work ? checkWorkWindow(state, options) : checkExecutionWindow(run, {...options, cleanupStartedAt: state.cleanupStartedAt});
    if (!value.allowed) throw new NativeFailure(value.reason === 'CANCELLED' ? 'CANCELLED' : 'TIMEOUT');
    return {timeoutMs: value.remainingMs, ...(cleanup ? {} : {signal})};
  }
  const cleanupWindow = () => {state.cleanupStartedAt ??= Date.now(); cleanupStartedAt = state.cleanupStartedAt; return window({identity: {phase: 'CLEANUP'}}, true);};
  async function evidence(attempt, kind, bytes, guard = () => {}) {
    oneOf(kind, ['observation','assertion','response','snapshot','screenshot','trace','reconciliation','lifecycle']);
    const artifactId = `artifact-${randomUUID()}`, path = `evidence/${artifactId}`;
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > run.inputs.limits.maxEvidenceBytes) throw new Error('Evidence must be bounded sanitized bytes.');
    await writeFile(join(roots.runRoot, path), bytes, {mode: 0o600, flag: 'wx'});
    try {guard();} catch (error) {await unlink(join(roots.runRoot, path)).catch(() => {}); throw error;}
    const artifact = registerEvidence(run, roots, {id: artifactId, identity: attempt.identity, kind, path, sanitized: true});
    observations.evidence.push(artifact); attempt.evidenceIds.push(artifactId); return artifactId;
  }
  const observe = (attempt, kind, value, guard) => evidence(attempt, kind, Buffer.from(JSON.stringify(data(value, run.inputs.limits.maxEvidenceBytes))), guard);
  const diagnostic = value => {try {return publicValue(state, value);} catch {return '[redacted]';}};
  // Fixed native facts are not application data. A confidential value can itself be
  // "OK" or true; matching it must not erase an executed effect or skip cleanup.
  async function observeAutomatic(attempt, kind, value) {
    try {return await observe(attempt, kind, value);} catch {
      indeterminate();
      if (attempt.outcome === 'SUCCESS') {attempt.outcome = 'INFRASTRUCTURE_FAILURE'; attempt.failureClass = 'EXECUTOR';}
      return undefined;
    }
  }
  function finish(attempt) {attempt.endedAt = Date.now(); scenario.attempts.push(attemptRecord(run, attempt));}
  async function missing(reason = 'UNAVAILABLE', beforePhase = Infinity) {
    if (execution) return; // Mixed execution records its own frozen lifecycle scope.
    const fallback = state.phaseNumber === 3 ? 'CLEANUP' : state.phaseNumber === 2 ? 'VERIFY' : 'EXERCISE';
    const remaining = [...invocations.values()].filter(item => !histories.has(item.invocationId) &&
      (beforePhase === Infinity || item.phase !== undefined && phaseOrder[item.phase] < beforePhase))
      .map(item => ({...item, phase: item.phase ?? fallback})).sort((a, b) => phaseOrder[a.phase] - phaseOrder[b.phase]);
    for (const invocation of remaining) {
      const operation = run.inputs.operations.find(item => item.id === invocation.operationId);
      if (!operation) throw new Error('Unreached browser invocation has unresolved exploratory provenance.');
      const nextPhase = phaseOrder[invocation.phase];
      if (nextPhase < state.phaseNumber) throw new Error('Unreached invocation would reverse the recorded phase history.');
      state.phaseNumber = nextPhase;
      if (nextPhase === 3) state.cleanupStartedAt ??= Date.now();
      // An empty history is an integrity failure, never proof that a started operation had no effect.
      const history = []; histories.set(invocation.invocationId, history);
      const current = record(operation, invocation.invocationId, invocation.phase);
      const allowed = authorizeOperation(run, operation, browserCapabilities).allowed;
      const window = checkExecutionWindow(run, {phase: invocation.phase, cleanupStartedAt: state.cleanupStartedAt});
      current.failureClass = !allowed ? 'POLICY' : !window.allowed ? 'TIMEOUT' : reason;
      current.outcome = ['POLICY', 'UNAVAILABLE'].includes(current.failureClass) ? 'BLOCKED' : 'INFRASTRUCTURE_FAILURE';
      current.effect.certainty = 'not-executed';
      await observe(current, 'observation', {invoked: false, reason: current.failureClass}); finish(current);
      history.push(scenario.attempts.at(-1));
    }
  }
  async function execute({operation, invocationId, phase = 'EXERCISE', inputs = [], retry = false}, action) {
    if (busy || finished || state.busy || state.finished) throw new Error('Browser attempts must be sequential and inside the active scenario.');
    id(invocationId); oneOf(phase, ['SETUP','EXERCISE','VERIFY','CLEANUP','RESTORE']);
    const nextPhase = phaseOrder[phase];
    if (nextPhase < state.phaseNumber || histories.has(invocationId) || typeof action !== 'function' || typeof retry !== 'boolean') throw new Error('Invalid sequential invocation.');
    if (operation.family !== 'browser' || operation.target !== target) throw new Error('Browser operation must use this session target.');
    inputs = inputBindings(state, inputs);
    requireObservationCapacity(state, record(operation, invocationId, phase, 1, inputs));
    if (scope.expectations.some(item => item.invocationId === invocationId && item.operationId === operation.id && item.phase !== undefined && item.phase !== phase)) throw new Error('Browser invocation differs from its frozen phase.');
    const authorization = authorizeOperation(run, operation, browserCapabilities);
    if (operation.source.kind === 'exploration' && !observations.operations.some(item => item.id === operation.id)) observations.operations.push(operation);
    busy = state.busy = true; const history = []; histories.set(invocationId, history);
    try {
      await missing('UNAVAILABLE', nextPhase); state.phaseNumber = nextPhase;
      if (nextPhase === 3) state.cleanupStartedAt ??= Date.now(); cleanupStartedAt = state.cleanupStartedAt;
      for (let number = 1; number <= run.inputs.limits.maxAttempts; number++) {
        const current = record(operation, invocationId, phase, number, inputs); let failure, dispatched = false, explicitEffect = false, active = true, manualRetry = false;
        const asserted = new Set(), pending = new Set(), nativePending = new Set(), eventStart = native.events.length;
        const controller = new AbortController(); let expired = false, closing = false, beforeExpire, closingPromise, committed = false, context;
        const currentWindow = () => window(current, nextPhase === 3, true);
        const requireActive = () => {if (!active || closing) throw new Error('The browser attempt context has ended.');};
        const commit = staged => {
          if (!active || committed) throw new Error('The browser attempt has already settled.');
          if (execution) for (const output of staged.outputs ?? []) if (output.sensitivity === 'public') publicValue(state, output.value);
          const prepared = prepareSettlement(run, scenario, observations.evidence, current, staged, failure);
          Object.assign(current, prepared.candidate);
          for (const resource of prepared.resources) {const existing = scenario.resources.find(item => item.id === resource.id); if (existing) Object.assign(existing, resource); else scenario.resources.push(resource);}
          explicitEffect = true; manualRetry = prepared.retry; committed = true;
        };
        const expire = reason => closingPromise ??= (async () => {
          expired = closing = true; failure ??= reason; controller.abort();
          state.cleanupStartedAt ??= Date.now(); cleanupStartedAt = state.cleanupStartedAt;
          const remaining = Math.max(0, state.cleanupStartedAt + run.inputs.limits.cleanupTimeoutMs - Date.now());
          const reserve = Math.min(5000, (state.cleanupReserveMs ?? 0) / 4, remaining);
          const bounded = async (promise, milliseconds) => {let timer; try {await Promise.race([promise, new Promise(resolve => {timer = setTimeout(resolve, Math.max(0, milliseconds));})]);} finally {clearTimeout(timer);}};
          if (nativePending.size) await bounded(Promise.allSettled([...nativePending]), remaining - reserve);
          if (beforeExpire && reserve > 0) {
            const until = Math.min(Date.now() + reserve, state.cleanupStartedAt + run.inputs.limits.cleanupTimeoutMs);
            const guard = () => {if (!active || Date.now() >= until) throw new Error('Settlement window has ended.');};
            const settlement = {
              evidence: async (kind, value) => {guard(); return observe(current, kind, execution ? publicValue(state, value) : value, guard);},
              verifyEvidence: () => {guard(); for (const item of observations.evidence.filter(item => current.evidenceIds.includes(item.id))) verifyEvidence(run, roots, item);},
              commit: staged => {guard(); commit(staged);}, identity: context.identity
            };
            await bounded(Promise.resolve().then(() => beforeExpire(Object.freeze(settlement))).catch(error => {failure ??= error;}), until - Date.now());
          }
          active = false;
        })();
        const track = (promise, native = false) => {pending.add(promise); if (native) nativePending.add(promise); promise.catch(error => {if (!error.refused) failure ??= error;}).finally(() => {pending.delete(promise); nativePending.delete(promise);}); return promise;};
        if (!authorization.allowed) {current.outcome = 'BLOCKED'; current.failureClass = 'POLICY'; current.effect.certainty = 'not-executed';}
        else {
          context = {
            onBeforeExpire: handler => {requireActive(); if (beforeExpire || typeof handler !== 'function') throw new Error('Register one expiry handler per attempt.'); beforeExpire = handler;},
            commit: staged => {requireActive(); commit(staged);},
            diagnostic: args => {
              requireActive();
              if (!Array.isArray(args) || !['console', 'requests'].includes(args[0]) || args.slice(1).some(value => !['error', 'warning', 'info', 'debug', '--clear'].includes(value))) throw new Error('Unsupported diagnostic command.');
              return track((async () => {
                try {return {notice: false, reply: await native.command(args, {...currentWindow(), signal: controller.signal})};}
                catch (error) {if (error instanceof NativeFailure && error.classification === 'EXECUTOR') return {notice: true, reason: error.reason ?? 'COMMAND_ERROR'}; throw error;}
              })());
            },
            rememberSensitive: value => {requireActive(); rememberSensitive(state, value);},
            retryAfterReconciliation: () => {requireActive(); if (current.reconciliation?.kind !== 'confirmed-no-effect') throw new Error('Manual retry needs confirmed no-effect reconciliation.'); manualRetry = true;},
            native: args => {
              requireActive(); explicitEffect = false;
              return track((async () => {
                try {const reply = await native.command(args, {...currentWindow(), signal: controller.signal}); dispatched = true; return reply;}
                catch (error) {if (!error.refused) {dispatched ||= error.dispatched === true; failure ??= error;} throw error;}
              })(), true);
            },
            evidence: (kind, value) => {requireActive(); return track(observe(current, kind, execution ? publicValue(state, value) : value, () => {if (!active) throw new Error('The browser attempt context has ended.');}));},
            verifyEvidence: () => {
              requireActive(); const ids = new Set(current.evidenceIds);
              for (const record of observations.evidence) if (ids.has(record.id)) {verifyEvidence(run, roots, record); ids.delete(record.id);}
              if (ids.size) throw new Error('Registered attempt evidence is missing.');
            },
            observationBudgetReached: () => {requireActive(); return observationBudgetReached(state, current);},
            artifact: (kind, filename, sanitize) => {requireActive(); return track((async () => {
              if (typeof sanitize !== 'function') throw new Error('Native artifacts require explicit sanitization before evidence registration.');
              const source = await realpath(resolve(native.workRoot, filename)), stat = await lstat(source);
              if (!within(await realpath(native.workRoot), source) || !stat.isFile() || stat.size > run.inputs.limits.maxEvidenceBytes) throw new Error('Native artifact escapes protected bounded storage.');
              const bytes = await sanitize(await readFile(source)); requireActive();
              return await evidence(current, kind, bytes, requireActive);
            })());},
            // A protected location for native --filename/state-save arguments, never serialized as evidence.
            file: name => {requireActive(); id(name); return join(native.workRoot, name);},
            assertion: input => {requireActive(); const value = data(input), index = current.assertions.findIndex(item => item.id === value.id); if (index < 0 || asserted.has(value.id)) throw new Error('Assertion is outside the frozen invocation or already recorded.'); asserted.add(value.id); current.assertions[index] = value;},
            effect: effect => {requireActive(); current.effect = data(effect); explicitEffect = true;},
            reconciliation: value => {requireActive(); current.reconciliation = data(value);},
            output: input => {requireActive(); if (execution && input.sensitivity === 'public') publicValue(state, input.value); const value = typedValue({...data(input), producer: {runId: run.id, scenarioId: scope.id, attemptId: current.identity.attemptId, name: input.name}}, run.inputs.limits.maxValueBytes); requireObservationCapacity(state, {...current, outputs: [...current.outputs, value]}); current.outputs.push(value); return value;},
            resource: value => {requireActive(); const resource = {...data(value), originAttemptId: current.identity.attemptId}; if (scenario.resources.some(item => item.id === resource.id)) throw new Error('Resource identity already exists.'); scenario.resources.push(resource);},
            lifecycle: (resourceId, value) => {
              requireActive(); const resource = scenario.resources.find(item => item.id === resourceId), update = data(value);
              if (!resource || resourceId === sessionResourceId || resource.originAttemptId === current.identity.attemptId || !['CLEANUP','RESTORE'].includes(phase)) throw new Error('Lifecycle update needs an existing business resource and cleanup/restoration attempt.');
              if (Object.keys(update).some(key => !['status','evidenceIds','guard'].includes(key)) || !['pending','failed','conflict'].includes(resource.lifecycle.status)) throw new Error('Lifecycle update cannot change resource intent or an already completed obligation.');
              resource.lifecycle = {...resource.lifecycle, ...update, attemptId: current.identity.attemptId};
            },
            selectOutput: value => {requireActive(); scenario.outputRefs.push(data(value));},
            identity: Object.freeze({...current.identity})
          };
          try {await boundedWork(() => action(context), currentWindow, signal, expire);} catch (error) {failure ??= error;}
          if (closingPromise) await closingPromise;
          active = false;
          if (pending.size && !expired) {
            failure ??= new Error('Native work or evidence was not awaited.');
            try {await boundedWork(() => Promise.allSettled([...pending]), currentWindow, signal, expire);} catch (error) {failure = error;}
          }
          if (expired) {
            try {await boundedWork(() => Promise.allSettled([...nativePending]), cleanupWindow);} catch {indeterminate();}
          }
          if (!dispatched && !failure) failure = new Error('A browser attempt needs an actual native observation.');
          if (dispatched && operation.capability === 'browserMutations' && !explicitEffect) current.effect.certainty = 'uncertain';
          const reliableFailure = current.assertions.some(item => item.status === 'FAIL' && item.reliable);
          if (reliableFailure) Object.assign(current, projectOutcome(current, failure));
          else if (failure) {
            current.outcome = 'INFRASTRUCTURE_FAILURE'; current.failureClass = failure instanceof NativeFailure ? failure.classification : 'EXECUTOR';
            if (current.effect.certainty === 'none') current.effect.certainty = !dispatched ? 'not-executed' : operation.capability === 'browserReads' ? 'none' : 'uncertain';
            if (expired || (failure instanceof NativeFailure && failure.interrupted)) {
              state.cleanupStartedAt ??= Date.now(); cleanupStartedAt = state.cleanupStartedAt;
              try {await native.interrupt({deadlineAt: cleanupStartedAt + run.inputs.limits.cleanupTimeoutMs});} catch {indeterminate();}
            }
          }
        }
        // Commands are caller-supplied strings. Exception names/codes are omitted;
        // the fixed failure classification already records the useful outcome.
        await observeAutomatic(current, 'observation', {nativeEvents: native.events.slice(eventStart).map(event => ({command: diagnostic(event.command), classification: event.classification, dispatched: event.dispatched})), ...(failure ? {failureClass: current.failureClass} : {})});
        finish(current); history.push(scenario.attempts.at(-1));
        if (finished || !retry && !manualRetry || decideRecovery(run, history, {evidence: observations.evidence, roots, cleanupStartedAt}).action !== 'RETRY') return history.at(-1);
      }
      return history.at(-1);
    } finally {busy = state.busy = false;}
  }
  const setup = record(lifecycle[0], 'browser-session-setup', 'SETUP'), sessionResourceId = 'owned-browser-session';
  setup.effect = {certainty: 'confirmed', resourceIds: [sessionResourceId]};
  const sessionValue = {name: 'sessionIdentity', type: 'string', sensitivity: 'public', value: native.session, producer: {runId: run.id, scenarioId: scope.id, attemptId: setup.identity.attemptId, name: 'sessionIdentity'}};
  setup.outputs = [sessionValue];
  const sessionResource = {id: sessionResourceId, originAttemptId: setup.identity.attemptId, identity: {attemptId: setup.identity.attemptId, name: 'sessionIdentity'}, ownership: 'harness', intent: 'temporary', lifecycle: {action: 'cleanup', status: 'pending', evidenceIds: []}};
  scenario.resources.push(sessionResource);
  let openingFailure;
  function launchAttempt(options, action) {
    const promise = execute(options, action); activeAttempts.add(promise);
    promise.catch(indeterminate).finally(() => activeAttempts.delete(promise)); return promise;
  }
  try {
    try {await native.open(window(setup));} catch (error) {openingFailure = error; setup.outcome = 'INFRASTRUCTURE_FAILURE'; setup.failureClass = error instanceof NativeFailure ? error.classification : 'EXECUTOR';}
    await observeAutomatic(setup, 'lifecycle', {sessionCreated: !openingFailure, ownership: 'harness'}); finish(setup); histories.set(setup.identity.invocationId, [scenario.attempts.at(-1)]);
    if (!openingFailure && execution) await body({attempt: launchAttempt, ownership: native.ownership});
    else if (!openingFailure) await boundedWork(() => body({attempt: launchAttempt, ownership: native.ownership}),
      () => window({identity: {phase: state.phaseNumber === 3 ? 'CLEANUP' : 'EXERCISE'}}, state.phaseNumber === 3), signal);
    else if (execution) await onUnavailable?.();
    else await missing('UNAVAILABLE');
  } catch (error) {
    scenarioFailure = error instanceof NativeFailure ? error.classification : 'EXECUTOR';
    bodyInterrupted = ['TIMEOUT','CANCELLED'].includes(scenarioFailure);
    const knownUnreached = scope.expectations.some(item => !histories.has(item.invocationId) && run.inputs.operations.some(operation => operation.id === item.operationId));
    if (!bodyInterrupted || (!activeAttempts.size && !knownUnreached)) indeterminate();
  }
  finally {
    finished = true;
    if (activeAttempts.size) {if (!bodyInterrupted) indeterminate(); await boundedWork(() => Promise.allSettled([...activeAttempts]), cleanupWindow).catch(() => indeterminate());}
    await missing(scenarioFailure ?? 'UNAVAILABLE');
    state.cleanupStartedAt ??= Date.now(); cleanupStartedAt = state.cleanupStartedAt; state.phaseNumber = 3;
    const cleanup = record(lifecycle[1], 'browser-session-cleanup', 'CLEANUP'); cleanup.inputs = [sessionValue];
    const cleanupExpired = cleanup.startedAt >= cleanupStartedAt + run.inputs.limits.cleanupTimeoutMs;
    const result = await closeOwnedSession();
    cleanup.effect = {certainty: result.complete ? 'confirmed' : 'uncertain', resourceIds: [sessionResourceId]};
    if (!result.complete || Date.now() >= cleanupStartedAt + run.inputs.limits.cleanupTimeoutMs) {cleanup.outcome = 'INFRASTRUCTURE_FAILURE'; cleanup.failureClass = 'EXECUTOR';}
    if (cleanupExpired) {cleanup.outcome = 'INFRASTRUCTURE_FAILURE'; cleanup.failureClass = 'TIMEOUT'; cleanup.effect = {certainty: 'not-executed', resourceIds: []};}
    const proof = await observeAutomatic(cleanup, 'lifecycle', {...result, ...(scenarioFailure ? {scenarioFailure} : {})}); finish(cleanup);
    sessionResource.lifecycle = {action: 'cleanup', status: cleanup.outcome === 'SUCCESS' ? 'completed' : 'failed', attemptId: cleanup.identity.attemptId, evidenceIds: proof ? [proof] : []};
  }
  if (execution) return;
  return finishScenario(state);
  }
  try {return await runOwnedScenario();} finally {
    // Result construction, evidence writes and validators cannot bypass owned physical cleanup.
    await closeOwnedSession();
  }
}
