import {randomUUID} from 'node:crypto';
import {createApiRuntime, apiCapabilities} from '../api/index.mjs';
import {createDatabaseRuntime, databaseCapabilities} from '../database/index.mjs';
import {runBrowserScenario, browserCapabilities} from '../browser/index.mjs';
import {authorizeOperation, checkExecutionWindow, attemptRecord, registerEvidence} from '../execution-core/index.mjs';
import {data, frozen, requireThat} from '../execution-core/data.mjs';
import {createScenarioState, initializeStorage, writeScenario, finishScenario, phaseOrder} from './state.mjs';
import {prepareSequential, stages} from './preflight.mjs';

const capabilities = {api: apiCapabilities, database: databaseCapabilities, browser: browserCapabilities};

/** Fixed sequential lifecycle; callbacks use existing runtimes, never a step DSL or scheduler. */
export async function runSequentialScenario(run, roots, options = {}, callbacks = {}) {
  ({options, callbacks} = prepareSequential(run, options, callbacks));
  const state = createScenarioState(run, roots), controller = new AbortController();
  state.observations.operations.push(...options.explorations);
  const operationFor = id => [...run.inputs.operations, ...state.observations.operations].find(item => item.id === id);
  const abort = () => controller.abort(); options.signal?.addEventListener('abort', abort, {once: true});
  if (options.signal?.aborted) abort();
  const issue = () => {if (!state.scenario.issues.includes('indeterminate-outcome')) state.scenario.issues.push('indeterminate-outcome');};
  const phaseSucceeded = phase => [...state.histories.values()].filter(history => history.length && phaseOrder[history[0].identity.phase] === phaseOrder[phase]).every(history => {
    const last = history.at(-1);
    return last.assertions.every(assertion => assertion.status === 'PASS' && assertion.reliable)
      && (last.outcome === 'SUCCESS' && ['none', 'confirmed'].includes(last.effect.certainty)
        || last.outcome === 'INFRASTRUCTURE_FAILURE' && last.reconciliation?.kind === 'confirmed-effect');
  });
  function missing(phase, reason) {
    for (const expected of state.scope.expectations.filter(item => phaseOrder[item.phase] === phaseOrder[phase])) {
      if (state.histories.get(expected.invocationId)?.length) continue;
      // A started operation with a broken result is not proof of no execution.
      // Preserve the integrity failure instead of inventing an unexecuted attempt.
      if (state.histories.has(expected.invocationId)) {issue(); continue;}
      const operation = operationFor(expected.operationId), now = Date.now(), supportedCapabilities = capabilities[operation.family];
      const authorized = authorizeOperation(run, operation, supportedCapabilities), window = checkExecutionWindow(run, {phase: expected.phase, cleanupStartedAt: state.cleanupStartedAt});
      const failureClass = !authorized.allowed ? 'POLICY' : !window.allowed ? 'TIMEOUT' : reason === 'CANCELLED' ? 'CANCELLED' : 'UNAVAILABLE';
      const current = {identity: {runId: run.id, scenarioId: state.scope.id, operationId: operation.id, invocationId: expected.invocationId, attemptId: `attempt-${randomUUID()}`, phase: expected.phase, number: 1},
        operationFingerprint: operation.fingerprint, startedAt: now, endedAt: now, outcome: ['POLICY', 'UNAVAILABLE'].includes(failureClass) ? 'BLOCKED' : 'INFRASTRUCTURE_FAILURE', failureClass,
        effect: {certainty: 'not-executed', resourceIds: []}, inputs: [], outputs: [], supportedCapabilities: [...supportedCapabilities], evidenceIds: [],
        assertions: state.scope.expectations.filter(item => item.invocationId === expected.invocationId).map(item => ({id: item.id, status: 'NOT_EVALUATED', reliable: false, evidenceIds: []}))};
      const artifactId = `artifact-${randomUUID()}`, path = `evidence/${artifactId}.json`;
      writeScenario(state, path, {invoked: false, reason: failureClass});
      state.observations.evidence.push(registerEvidence(run, state.roots, {id: artifactId, identity: current.identity, kind: 'observation', path, sanitized: true}));
      current.evidenceIds.push(artifactId); current.endedAt = Date.now();
      const checked = attemptRecord(run, current); state.scenario.attempts.push(checked); state.histories.set(expected.invocationId, [checked]);
    }
  }

  async function drive(browser, unavailable = false) {
    const api = createApiRuntime(run, state.roots, {...options.api, signal: controller.signal, execution: state});
    const database = createDatabaseRuntime(run, state.roots, {...options.database, signal: controller.signal, execution: state});
    let stopped = unavailable;
    for (const [name, phase] of stages) {
      state.phaseNumber = phaseOrder[phase]; if (phase === 'CLEANUP') state.cleanupStartedAt ??= Date.now();
      let active = true, callbackError, timer, onCancel; const pending = new Set();
      const requireActive = () => requireThat(active && !state.finished, 'The phase callback has ended.');
      const invocation = input => {
        requireActive(); const selected = input.phase ?? phase;
        requireThat(selected === phase || phase === 'CLEANUP' && selected === 'RESTORE', 'Invocation must use the active lifecycle phase.');
        requireThat(!['browser-session-setup', 'browser-session-cleanup'].includes(input.invocationId), 'Browser ownership invocation names are reserved.');
        const expected = state.scope.expectations.find(item => item.invocationId === input.invocationId);
        requireThat(!expected || expected.operationId === input.operation.id && expected.phase === selected, 'Invocation differs from its frozen operation or phase.');
        return {...input, phase: selected};
      };
      const track = action => {
        requireActive(); let promise;
        try {promise = Promise.resolve(action());} catch (error) {promise = Promise.reject(error);}
        const tracked = promise.then(value => {pending.delete(tracked); return value;}, error => {pending.delete(tracked); callbackError ??= error; throw error;});
        pending.add(tracked); tracked.catch(() => {}); return tracked;
      };
      const context = Object.freeze({
        api: Object.freeze({execute: input => track(() => api.execute(invocation(input)))}),
        database: Object.freeze({execute: input => track(() => database.execute(invocation(input)))}),
        ...(browser ? {browser: Object.freeze({attempt: (input, action) => track(() => browser.attempt(invocation(input), action))})} : {}),
        value: name => {requireActive(); const value = run.inputs.values.find(item => item.name === name && item.producer.scenarioId === state.scope.id); requireThat(value, 'Initial binding is absent.'); return value;},
        output: (attempt, name, alias = name) => {requireActive(); requireThat(state.scenario.attempts.includes(attempt), 'Output must come from a completed scenario attempt.'); const output = attempt.outputs.find(item => item.name === name); requireThat(output, 'Selected output is absent.'); return frozen({...output, name: alias});},
        resource: id => {requireActive(); const resource = state.scenario.resources.find(item => item.id === id); if (!resource) return undefined; const origin = state.scenario.attempts.find(item => item.identity.attemptId === resource.originAttemptId); return frozen({resource: data(resource), outputs: data(origin.outputs)});},
        selectOutput: (attempt, name) => {requireActive(); api.selectOutput(attempt, name);}
      });
      try {
        const window = checkExecutionWindow(run, {phase, signal: controller.signal, cleanupStartedAt: state.cleanupStartedAt});
        if ((!stopped || phase === 'CLEANUP') && window.allowed && callbacks[name]) {
          await Promise.race([Promise.resolve().then(() => callbacks[name](context)), new Promise((_, reject) => {
            onCancel = () => reject(new Error('Phase was cancelled.'));
            if (phase !== 'CLEANUP') controller.signal.addEventListener('abort', onCancel, {once: true});
            timer = setTimeout(() => {if (phase !== 'CLEANUP') controller.abort(); reject(new Error('Phase deadline exceeded.'));}, window.remainingMs);
          })]);
        }
      } catch (error) {callbackError ??= error;}
      finally {
        clearTimeout(timer); if (onCancel) controller.signal.removeEventListener('abort', onCancel); active = false;
        // Runtimes bound/cancel their own I/O; do not finalize while an operation can still write.
        if (pending.size) {issue(); if (phase !== 'CLEANUP') controller.abort(); await Promise.allSettled([...pending]);}
      }
      if (callbackError) {issue(); stopped = true;}
      missing(phase, controller.signal.aborted ? 'CANCELLED' : 'UNAVAILABLE');
      stopped ||= !phaseSucceeded(phase);
    }
  }
  try {
    if (options.browser) await runBrowserScenario(run, roots, {...options.browser, signal: controller.signal, execution: state, onUnavailable: () => drive(undefined, true)}, browser => drive(browser));
    else {initializeStorage(state); await drive();}
    return finishScenario(state);
  } finally {options.signal?.removeEventListener('abort', abort); for (const release of state.releases) release(); state.secrets.clear();}
}
