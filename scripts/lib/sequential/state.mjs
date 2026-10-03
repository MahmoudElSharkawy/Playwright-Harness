// Shared only because the browser/API/database runtimes now execute one scenario.
import {mkdirSync, writeFileSync, lstatSync, realpathSync, existsSync} from 'node:fs';
import {dirname, basename, join} from 'node:path';
import {assessRun, checkExecutionWindow} from '../execution-core/index.mjs';
import {requireRun} from '../execution-core/inputs.mjs';
import {data, requireThat, typedValue, fingerprint} from '../execution-core/data.mjs';
import {resolveSkillRoots, realFuture} from '../skill-roots.mjs';

const STATES = new WeakSet();
export const phaseOrder = Object.freeze({SETUP: 0, EXERCISE: 1, VERIFY: 2, CLEANUP: 3, RESTORE: 3});
function physical(path) {
  path = realFuture(path); const tail = [];
  while (!existsSync(path)) {tail.unshift(basename(path)); path = dirname(path);}
  // Native realpath expands Windows 8.3 aliases, unlike the JS sync implementation.
  return join(realpathSync.native(path), ...tail);
}

export function createScenarioState(run, inputRoots) {
  requireRun(run); requireThat(run.inputs.scenarios.length === 1, 'Sequential execution needs one scenario.');
  const scope = run.inputs.scenarios[0], scenario = {id: scope.id, disposition: 'executed', attempts: [], resources: [], outputRefs: [], issues: []};
  const state = {run, roots: resolveSkillRoots(inputRoots), scope, scenario, observations: {scenarios: [scenario], operations: [], evidence: []},
    histories: new Map(), secrets: new Set(), releases: [], busy: false, finished: false, storageReady: false, phaseNumber: 0, cleanupStartedAt: undefined};
  STATES.add(state); return state;
}

export function requireScenarioState(state, run, roots) {
  requireThat(STATES.has(state) && state.run === run && !state.finished, 'Shared execution must belong to this active immutable run.');
  const checked = resolveSkillRoots(roots);
  for (const name of ['packageRoot', 'projectRoot', 'runRoot']) requireThat(physical(checked[name]) === physical(state.roots[name]), 'Shared execution roots differ.');
  return state;
}

/** Business cleanup must leave the configured reserve for owned runtime shutdown. */
export function checkWorkWindow(state, {phase, signal, now = Date.now()} = {}) {
  const window = checkExecutionWindow(state.run, {phase, signal, now, cleanupStartedAt: state.cleanupStartedAt});
  if (!['CLEANUP', 'RESTORE'].includes(phase) || !state.cleanupReserveMs) return window;
  const remainingMs = Math.max(0, window.remainingMs - state.cleanupReserveMs);
  return {...window, remainingMs, allowed: window.allowed && remainingMs > 0, reason: remainingMs ? window.reason : 'DEADLINE_EXCEEDED'};
}

export function observationBudgetReached(state, pendingAttempt) {
  if (state.observationBudgetExceeded) return true;
  let nodes = 0;
  const serialized = JSON.stringify({...state.observations, ...(pendingAttempt ? {pendingAttempt} : {})}, (key, value) => {nodes++; return value;});
  return Buffer.byteLength(serialized) >= 0.7 * 1024 * 1024 || nodes >= 0.7 * 20000;
}
export function requireObservationCapacity(state, pendingAttempt) {
  if (state.boundedObservations && observationBudgetReached(state, pendingAttempt)) {
    state.observationBudgetExceeded = true;
    throw Object.assign(new Error('OBSERVATION_LIMIT: finish the scenario.'), {code: 'OBSERVATION_LIMIT'});
  }
}

export function initializeStorage(state) {
  requireScenarioState(state, state.run, state.roots); requireThat(!state.storageReady, 'Scenario storage is already initialized.');
  mkdirSync(dirname(state.roots.runRoot), {recursive: true, mode: 0o700});
  mkdirSync(state.roots.runRoot, {mode: 0o700});
  mkdirSync(join(state.roots.runRoot, 'evidence'), {mode: 0o700});
  state.storageReady = true;
}

// Called only after the native browser integration has acquired fresh owned storage.
export function acceptBrowserStorage(state, roots) {
  requireScenarioState(state, state.run, roots); requireThat(!state.storageReady, 'Browser storage must be acquired first.');
  state.roots = resolveSkillRoots(roots); state.storageReady = true;
}

export function writeScenario(state, path, value) {
  for (const directory of [state.roots.runRoot, join(state.roots.runRoot, 'evidence')]) {
    requireThat(state.storageReady && !lstatSync(directory).isSymbolicLink() && realpathSync(directory) === directory && realFuture(directory) === directory, 'Scenario storage ownership changed.');
  }
  writeFileSync(join(state.roots.runRoot, path), JSON.stringify(data(value), null, 2), {flag: 'wx', mode: 0o600});
}

export function finishScenario(state) {
  requireScenarioState(state, state.run, state.roots); requireThat(!state.busy, 'Scenario must be idle before assessment.');
  state.finished = true;
  try {
    writeScenario(state, 'observations.json', state.observations);
    const result = assessRun(state.run, state.roots, state.observations);
    writeScenario(state, 'result.json', result); return result;
  } finally {for (const release of state.releases) release(); state.secrets.clear();}
}

export function inputBindings(state, inputs) {
  const checked = inputs.map(value => typedValue(value, state.run.inputs.limits.maxValueBytes));
  requireThat(new Set(checked.map(value => value.name)).size === checked.length, 'Duplicate binding names.');
  for (const value of checked) {
    const source = value.producer.attemptId === undefined
      ? state.run.inputs.values.find(item => item.name === value.producer.name && item.producer.scenarioId === state.scope.id)
      : state.scenario.attempts.find(item => item.identity.attemptId === value.producer.attemptId)?.outputs.find(item => item.name === value.producer.name);
    requireThat(source && fingerprint({...source, name: value.name}) === fingerprint(value), 'Input must bind an immutable input or earlier output.');
  }
  return checked;
}

function decoded(value) {if (typeof value !== 'string') return undefined; try {return JSON.parse(value);} catch {return undefined;}}
export function rememberSensitive(state, value, depth = 0) {
  requireThat(depth <= 32, 'Sensitive data exceeds structural limits.');
  if (value && typeof value === 'object') Object.values(value).forEach(item => rememberSensitive(state, item, depth + 1));
  else if (value !== null && value !== undefined && value !== '') {
    state.secrets.add(value); const parsed = decoded(value); if (parsed !== undefined) rememberSensitive(state, parsed, depth + 1);
  }
}

export function publicValue(state, value) {
  const checked = data(value, state.run.inputs.limits.maxValueBytes); let nodes = 0;
  function inspect(item, depth = 0) {
    requireThat(++nodes <= 20000 && depth <= 32, 'Public data exceeds structural limits.');
    if (typeof item === 'string') {
      requireThat(![...state.secrets].some(secret => item.includes(String(secret)) || item.includes(encodeURIComponent(String(secret)))), 'Sensitive content cannot be a public output.');
      const parsed = decoded(item); if (parsed !== undefined) inspect(parsed, depth + 1);
    } else if (typeof item === 'number' || typeof item === 'boolean') requireThat(!state.secrets.has(item), 'Sensitive content cannot be a public output.');
    else if (item && typeof item === 'object') for (const [name, child] of Object.entries(item)) {
      requireThat(!/(?:password|passwd|pwd|secret|token|authorization|cookie|api.?key|connectionstring)/i.test(name), 'Sensitive fields require protected extraction.');
      if (!Array.isArray(item)) inspect(name, depth + 1); inspect(child, depth + 1);
    }
  }
  inspect(checked); return checked;
}
