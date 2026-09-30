import {readFile, writeFile, lstat, realpath} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {defineOperation, authorizeOperation, checkExecutionWindow, attemptRecord, decideRecovery, registerEvidence, assessRun} from '../execution-core/index.mjs';
import {requireRun} from '../execution-core/inputs.mjs';
import {data, id, oneOf, typedValue} from '../execution-core/data.mjs';
import {within} from '../skill-roots.mjs';
import {prepareNativeSession, NativeFailure} from './native-cli.mjs';

export const browserCapabilities = Object.freeze(['browserReads', 'browserMutations']);
// Bound trusted asynchronous callbacks as well as native commands. This cannot preempt
// synchronous JavaScript; host process limits remain responsible for that case.
function boundedWork(action, currentWindow, signal, expire = () => {}) {
  return new Promise((resolveResult, reject) => {
    let settled = false, timer;
    const finish = (error, value) => {
      if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', check);
      if (error) reject(error); else resolveResult(value);
    };
    const check = () => {
      clearTimeout(timer);
      try {const window = currentWindow(); timer = setTimeout(check, window.timeoutMs);}
      catch (error) {expire(); finish(error);}
    };
    signal?.addEventListener('abort', check); check();
    if (!settled) Promise.resolve().then(() => {if (!settled) return action();}).then(value => {
      if (settled) return;
      try {currentWindow(); finish(undefined, value);} catch (error) {expire(); finish(error);}
    }, error => finish(error));
  });
}
/** Include these ownership operations in the immutable run before executing a scenario. */
export function browserLifecycleOperations(target) {
  return ['setup', 'cleanup'].map(phase => defineOperation({id: `browser-${phase}`, family: 'browser', target, capability: 'browserReads',
    source: {kind: 'helper', reference: 'owned-browser-lifecycle', version: '1.0.0'}, definition: {intent: `${phase} owned isolated browser session`}}));
}

/** One sequential browser scenario. The callback uses the official native CLI, not a harness action language. */
export async function runBrowserScenario(run, roots, {target, storageState, signal, nativeTimeoutMs, commandTimeoutMs} = {}, body) {
  requireRun(run); id(target);
  if (run.inputs.scenarios.length !== 1 || typeof body !== 'function') throw new Error('M6 accepts one sequential browser scenario per run.');
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new Error('Cancellation needs an AbortSignal.');
  const scope = run.inputs.scenarios[0], lifecycle = browserLifecycleOperations(target);
  for (const operation of lifecycle) if (!authorizeOperation(run, operation, browserCapabilities).allowed) throw new Error('Owned browser lifecycle is not frozen or permitted for this target.');
  const origins = run.inputs.environment.targets.browser[target].origins;
  const initialWindow = checkExecutionWindow(run, {phase: 'SETUP', signal});
  if (!initialWindow.allowed) throw new NativeFailure(initialWindow.reason === 'CANCELLED' ? 'CANCELLED' : 'TIMEOUT');
  const native = await prepareNativeSession(roots, {origins, storageState, ...(nativeTimeoutMs === undefined ? {} : {nativeTimeoutMs}), ...(commandTimeoutMs === undefined ? {} : {commandTimeoutMs})});
  roots = native.roots;
  const scenario = {id: scope.id, disposition: 'executed', attempts: [], resources: [], outputRefs: [], issues: []};
  const observations = {scenarios: [scenario], operations: [], evidence: []}, histories = new Map();
  const activeAttempts = new Set();
  let busy = false, finished = false, cleanupStartedAt, phaseNumber = 0, scenarioFailure, bodyInterrupted = false;
  const indeterminate = () => {if (!scenario.issues.includes('indeterminate-outcome')) scenario.issues.push('indeterminate-outcome');};
  function record(operation, invocationId, phase, number = 1, inputs = []) {
    const identity = {runId: run.id, scenarioId: scope.id, operationId: operation.id, invocationId, attemptId: `attempt-${randomUUID()}`, phase, number};
    return {identity, operationFingerprint: operation.fingerprint, startedAt: Date.now(), endedAt: Date.now(), outcome: 'SUCCESS', failureClass: 'NONE', effect: {certainty: 'none', resourceIds: []},
      inputs: data(inputs), outputs: [], assertions: scope.expectations.filter(item => item.operationId === operation.id && item.invocationId === invocationId).map(item => ({id: item.id, status: 'NOT_EVALUATED', reliable: false, evidenceIds: []})), evidenceIds: [], supportedCapabilities: [...browserCapabilities]};
  }
  function window(attempt, cleanup = false) {
    const value = checkExecutionWindow(run, {phase: attempt.identity.phase, signal: cleanup ? undefined : signal, cleanupStartedAt});
    if (!value.allowed) throw new NativeFailure(value.reason === 'CANCELLED' ? 'CANCELLED' : 'TIMEOUT');
    return {timeoutMs: value.remainingMs, ...(cleanup ? {} : {signal})};
  }
  const cleanupWindow = () => {cleanupStartedAt ??= Date.now(); return window({identity: {phase: 'CLEANUP'}}, true);};
  async function evidence(attempt, kind, bytes) {
    oneOf(kind, ['observation','assertion','response','snapshot','screenshot','trace','reconciliation','lifecycle']);
    const artifactId = `artifact-${randomUUID()}`, path = `evidence/${artifactId}`;
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > run.inputs.limits.maxEvidenceBytes) throw new Error('Evidence must be bounded sanitized bytes.');
    await writeFile(join(roots.runRoot, path), bytes, {mode: 0o600, flag: 'wx'});
    const artifact = registerEvidence(run, roots, {id: artifactId, identity: attempt.identity, kind, path, sanitized: true});
    observations.evidence.push(artifact); attempt.evidenceIds.push(artifactId); return artifactId;
  }
  const observe = (attempt, kind, value) => evidence(attempt, kind, Buffer.from(JSON.stringify(data(value, run.inputs.limits.maxEvidenceBytes))));
  function finish(attempt) {attempt.endedAt = Date.now(); scenario.attempts.push(attemptRecord(run, attempt));}
  async function execute({operation, invocationId, phase = 'EXERCISE', inputs = [], retry = false}, action) {
    if (busy || finished) throw new Error('Browser attempts must be sequential and inside the active scenario.');
    id(invocationId); oneOf(phase, ['SETUP','EXERCISE','VERIFY','CLEANUP','RESTORE']);
    const nextPhase = {SETUP: 0, EXERCISE: 1, VERIFY: 2, CLEANUP: 3, RESTORE: 3}[phase];
    if (nextPhase < phaseNumber || histories.has(invocationId) || typeof action !== 'function' || typeof retry !== 'boolean') throw new Error('Invalid sequential invocation.');
    if (operation.family !== 'browser' || operation.target !== target) throw new Error('Browser operation must use this session target.');
    const authorization = authorizeOperation(run, operation, browserCapabilities); phaseNumber = nextPhase;
    if (nextPhase === 3) cleanupStartedAt ??= Date.now();
    if (operation.source.kind === 'exploration' && !observations.operations.some(item => item.id === operation.id)) observations.operations.push(operation);
    busy = true; const history = []; histories.set(invocationId, history);
    try {
      for (let number = 1; number <= run.inputs.limits.maxAttempts; number++) {
        const current = record(operation, invocationId, phase, number, inputs); let failure, dispatched = false, explicitEffect = false, active = true;
        const asserted = new Set(), pending = new Set(), nativePending = new Set(), eventStart = native.events.length;
        const controller = new AbortController(); let expired = false;
        const expire = () => {expired = true; active = false; controller.abort();};
        const currentWindow = () => window(current, nextPhase === 3);
        const requireActive = () => {if (!active) throw new Error('The browser attempt context has ended.');};
        const track = (promise, native = false) => {pending.add(promise); if (native) nativePending.add(promise); promise.catch(error => {failure ??= error;}).finally(() => {pending.delete(promise); nativePending.delete(promise);}); return promise;};
        if (!authorization.allowed) {current.outcome = 'BLOCKED'; current.failureClass = 'POLICY'; current.effect.certainty = 'not-executed';}
        else {
          const context = {
            native: args => {
              requireActive(); explicitEffect = false;
              return track((async () => {
                try {const reply = await native.command(args, {...currentWindow(), signal: controller.signal}); dispatched = true; return reply;}
                catch (error) {dispatched ||= error.dispatched === true; failure ??= error; throw error;}
              })(), true);
            },
            evidence: (kind, value) => {requireActive(); return track(observe(current, kind, value));},
            artifact: (kind, filename, sanitize) => {requireActive(); return track((async () => {
              if (typeof sanitize !== 'function') throw new Error('Native artifacts require explicit sanitization before evidence registration.');
              const source = await realpath(resolve(native.workRoot, filename)), stat = await lstat(source);
              if (!within(await realpath(native.workRoot), source) || !stat.isFile() || stat.size > run.inputs.limits.maxEvidenceBytes) throw new Error('Native artifact escapes protected bounded storage.');
              const bytes = await sanitize(await readFile(source)); requireActive();
              return await evidence(current, kind, bytes);
            })());},
            // A protected location for native --filename/state-save arguments, never serialized as evidence.
            file: name => {requireActive(); id(name); return join(native.workRoot, name);},
            assertion: input => {requireActive(); const value = data(input), index = current.assertions.findIndex(item => item.id === value.id); if (index < 0 || asserted.has(value.id)) throw new Error('Assertion is outside the frozen invocation or already recorded.'); asserted.add(value.id); current.assertions[index] = value;},
            effect: effect => {requireActive(); current.effect = data(effect); explicitEffect = true;},
            reconciliation: value => {requireActive(); current.reconciliation = data(value);},
            output: input => {requireActive(); const value = typedValue({...data(input), producer: {runId: run.id, scenarioId: scope.id, attemptId: current.identity.attemptId, name: input.name}}, run.inputs.limits.maxValueBytes); current.outputs.push(value); return value;},
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
          if (reliableFailure) {current.outcome = 'ASSERTION_FAILURE'; current.failureClass = 'ASSERTION';}
          else if (failure) {
            current.outcome = 'INFRASTRUCTURE_FAILURE'; current.failureClass = failure instanceof NativeFailure ? failure.classification : 'EXECUTOR';
            if (current.effect.certainty === 'none') current.effect.certainty = !dispatched ? 'not-executed' : operation.capability === 'browserReads' ? 'none' : 'uncertain';
            if (expired || (failure instanceof NativeFailure && failure.interrupted)) {
              cleanupStartedAt ??= Date.now();
              try {await native.interrupt({deadlineAt: cleanupStartedAt + run.inputs.limits.cleanupTimeoutMs});} catch {indeterminate();}
            }
          }
        }
        await observe(current, 'observation', {nativeEvents: native.events.slice(eventStart), ...(failure ? {exception: failure.name, ...(typeof failure.code === 'string' ? {code: failure.code} : {})} : {})});
        finish(current); history.push(scenario.attempts.at(-1));
        if (finished || !retry || decideRecovery(run, history, {evidence: observations.evidence, roots, cleanupStartedAt}).action !== 'RETRY') return history.at(-1);
      }
      return history.at(-1);
    } finally {busy = false;}
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
    await observe(setup, 'lifecycle', {sessionCreated: !openingFailure, ownership: 'harness'}); finish(setup);
    if (!openingFailure) await boundedWork(() => body({attempt: launchAttempt, ownership: native.ownership}),
      () => window({identity: {phase: phaseNumber === 3 ? 'CLEANUP' : 'EXERCISE'}}, phaseNumber === 3), signal);
    else for (const expectation of scope.expectations) if (!histories.has(expectation.invocationId)) {
      const operation = run.inputs.operations.find(item => item.id === expectation.operationId);
      if (!operation) throw new Error('Unopened browser has an unresolved exploratory operation.');
      const blocked = record(operation, expectation.invocationId, 'EXERCISE'); blocked.outcome = 'BLOCKED'; blocked.failureClass = 'UNAVAILABLE'; blocked.effect.certainty = 'not-executed'; finish(blocked); histories.set(expectation.invocationId, [blocked]);
    }
  } catch (error) {
    scenarioFailure = error instanceof NativeFailure ? error.classification : 'EXECUTOR';
    bodyInterrupted = ['TIMEOUT','CANCELLED'].includes(scenarioFailure);
    const knownUnreached = scope.expectations.some(item => !histories.has(item.invocationId) && run.inputs.operations.some(operation => operation.id === item.operationId));
    if (!bodyInterrupted || (!activeAttempts.size && !knownUnreached)) indeterminate();
  }
  finally {
    finished = true;
    if (activeAttempts.size) {if (!bodyInterrupted) indeterminate(); await boundedWork(() => Promise.allSettled([...activeAttempts]), cleanupWindow).catch(() => indeterminate());}
    // A timed-out body may never reach a known frozen invocation. Preserve its
    // unevaluated expectations explicitly; never fabricate exploratory provenance.
    if (scenarioFailure) for (const expectation of scope.expectations) if (!histories.has(expectation.invocationId)) {
      const operation = run.inputs.operations.find(item => item.id === expectation.operationId);
      if (!operation) {indeterminate(); continue;}
      const phase = phaseNumber === 3 ? 'CLEANUP' : phaseNumber === 2 ? 'VERIFY' : 'EXERCISE';
      const missing = record(operation, expectation.invocationId, phase);
      const window = checkExecutionWindow(run, {phase, cleanupStartedAt});
      const allowed = authorizeOperation(run, operation, browserCapabilities).allowed;
      missing.outcome = allowed ? 'INFRASTRUCTURE_FAILURE' : 'BLOCKED';
      missing.failureClass = !allowed ? 'POLICY' : !window.allowed ? 'TIMEOUT' : scenarioFailure;
      missing.effect.certainty = 'not-executed';
      await observe(missing, 'observation', {invoked: false, reason: missing.failureClass}); finish(missing);
      histories.set(expectation.invocationId, [missing]);
    }
    cleanupStartedAt ??= Date.now();
    const cleanup = record(lifecycle[1], 'browser-session-cleanup', 'CLEANUP'); cleanup.inputs = [sessionValue];
    const cleanupExpired = cleanup.startedAt >= cleanupStartedAt + run.inputs.limits.cleanupTimeoutMs;
    const result = await native.close({deadlineAt: cleanupStartedAt + run.inputs.limits.cleanupTimeoutMs});
    cleanup.effect = {certainty: result.complete ? 'confirmed' : 'uncertain', resourceIds: [sessionResourceId]};
    if (!result.complete || Date.now() >= cleanupStartedAt + run.inputs.limits.cleanupTimeoutMs) {cleanup.outcome = 'INFRASTRUCTURE_FAILURE'; cleanup.failureClass = 'EXECUTOR';}
    if (cleanupExpired) {cleanup.outcome = 'INFRASTRUCTURE_FAILURE'; cleanup.failureClass = 'TIMEOUT'; cleanup.effect = {certainty: 'not-executed', resourceIds: []};}
    const proof = await observe(cleanup, 'lifecycle', {...result, ...(scenarioFailure ? {scenarioFailure} : {})}); finish(cleanup);
    sessionResource.lifecycle = {action: 'cleanup', status: cleanup.outcome === 'SUCCESS' ? 'completed' : 'failed', attemptId: cleanup.identity.attemptId, evidenceIds: [proof]};
  }
  await writeFile(join(roots.runRoot, 'observations.json'), JSON.stringify(data(observations), null, 2), {mode: 0o600, flag: 'wx'});
  const result = assessRun(run, roots, observations);
  await writeFile(join(roots.runRoot, 'result.json'), JSON.stringify(result, null, 2), {mode: 0o600, flag: 'wx'});
  return result;
}
