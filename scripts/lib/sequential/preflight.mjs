import {requireRun, operationInput, authorizeOperation} from '../execution-core/inputs.mjs';
import {keys, requireThat, id, integer} from '../execution-core/data.mjs';
import {browserLifecycleOperations, browserCapabilities} from '../browser/index.mjs';
import {phaseOrder} from './state.mjs';

export const stages = Object.freeze([['setup', 'SETUP'], ['exercise', 'EXERCISE'], ['verify', 'VERIFY'], ['cleanup', 'CLEANUP']]);

/** Shared preflight lets a batch reject invalid jobs before any scenario starts. */
export function prepareSequential(run, options = {}, callbacks = {}) {
  requireRun(run); requireThat(run.inputs.scenarios.length === 1, 'Sequential execution needs one scenario.');
  keys(options, ['signal', 'api', 'database', 'browser', 'explorations'], 'sequential options');
  keys(callbacks, stages.map(([name]) => name), 'phase callbacks');
  for (const callback of Object.values(callbacks)) requireThat(typeof callback === 'function', 'Phase callbacks must be functions.');
  requireThat(options.signal === undefined || options.signal instanceof AbortSignal, 'Cancellation needs an AbortSignal.');
  const copied = {...options};
  for (const family of ['api', 'database']) if (options[family] !== undefined) {
    keys(options[family], ['resolveCredential', 'resolveSensitive', 'storeSensitive'], `${family} options`);
    for (const callback of Object.values(options[family])) requireThat(callback === undefined || typeof callback === 'function', 'Runtime resolvers must be functions.');
    copied[family] = Object.freeze({...options[family]});
  }
  if (options.browser !== undefined) {
    keys(options.browser, ['target', 'storageState', 'nativeTimeoutMs', 'commandTimeoutMs'], 'browser options');
    id(options.browser.target);
    for (const [name, maximum] of [['nativeTimeoutMs', 60000], ['commandTimeoutMs', 120000]]) requireThat(options.browser[name] === undefined || integer(options.browser[name], 1, maximum), 'Browser timeouts must be positive and bounded.');
    requireThat(options.browser.storageState === undefined || typeof options.browser.storageState === 'string', 'Browser state must be a file reference.');
    requireThat(browserLifecycleOperations(options.browser.target).every(operation => authorizeOperation(run, operation, browserCapabilities).allowed), 'Owned browser lifecycle is not frozen or permitted for this target.');
    copied.browser = Object.freeze({...options.browser});
  }
  requireThat(Array.isArray(options.explorations ?? []), 'Explorations must be an array.');
  const explorations = (options.explorations ?? []).map(operationInput), operations = [...run.inputs.operations, ...explorations];
  requireThat(explorations.every(operation => operation.source.kind === 'exploration') && new Set(operations.map(operation => operation.id)).size === operations.length, 'Exploration definitions need distinct run-local identities.');
  for (const expectation of run.inputs.scenarios[0].expectations) {
    requireThat(Object.hasOwn(phaseOrder, expectation.phase) && operations.some(operation => operation.id === expectation.operationId), 'Mixed expectations need frozen phases and known stable or run-local definitions.');
    requireThat(!['browser-session-setup', 'browser-session-cleanup'].includes(expectation.invocationId), 'Browser ownership invocation names are reserved.');
    requireThat(run.inputs.scenarios[0].expectations.filter(item => item.invocationId === expectation.invocationId).every(item => item.operationId === expectation.operationId && item.phase === expectation.phase), 'An invocation has one operation and phase.');
  }
  return {options: Object.freeze({...copied, explorations: Object.freeze(explorations)}), callbacks: Object.freeze({...callbacks})};
}
