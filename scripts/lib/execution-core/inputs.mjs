import {randomUUID} from 'node:crypto';
import {validateConfiguration, capabilityNames} from '../project-config.mjs';
import {data, frozen, fingerprint, requireThat, integer, id, revision, keys, oneOf, unique, typedValue, EVIDENCE_KINDS} from './data.mjs';

const RUNS = new WeakSet();
const FAMILY_CAPABILITIES = Object.freeze({api: ['apiReads', 'apiMutations'], database: ['dbSelect', 'dbDml', 'ddl', 'admin'], browser: ['browserReads', 'browserMutations']});
const DEFAULT_LIMITS = Object.freeze({maxAttempts: 2, timeoutMs: 60000, cleanupTimeoutMs: 30000, maxValueBytes: 32768, maxEvidenceBytes: 8 * 1024 * 1024});

/** Define intent/provenance, not transport commands. No catalog source receives extra permission. */
export function defineOperation(input) {
  const operation = data(input);
  keys(operation, ['id', 'family', 'target', 'capability', 'source', 'definition'], 'operation');
  id(operation.id); id(operation.target); oneOf(operation.family, Object.keys(FAMILY_CAPABILITIES));
  oneOf(operation.capability, FAMILY_CAPABILITIES[operation.family]);
  keys(operation.source, ['kind', 'reference', 'version'], 'operation source');
  oneOf(operation.source.kind, ['catalog', 'helper', 'inline', 'exploration']);
  id(operation.source.reference); revision(operation.source.version);
  requireThat(operation.definition && typeof operation.definition === 'object' && !Array.isArray(operation.definition), 'Operation definition must be bounded JSON.');
  return frozen({...operation, fingerprint: fingerprint(operation)});
}

export function operationInput(operation) {
  const {fingerprint: recorded, ...input} = operation;
  const checked = defineOperation(input);
  requireThat(recorded === checked.fingerprint, 'Operation fingerprint mismatch.');
  return checked;
}

/** Freeze effective configuration, selected assertions, reviewed content and stable definitions once. */
export function createRun(input) {
  input = data(input);
  keys(input, ['id', 'startedAt', 'environment', 'scenarios', 'operations', 'knowledge', 'values', 'limits'], 'run inputs');
  const runId = input.id ?? randomUUID(), startedAt = input.startedAt ?? Date.now(); id(runId);
  requireThat(integer(startedAt), 'Invalid run start time.');
  const environment = data(input.environment);
  keys(environment, ['name', 'environmentMode', 'apiTargets', 'databaseTargets', 'browserTargets', 'capabilities', 'targets'], 'effective environment');
  id(environment.name);
  const {name, targets, ...profile} = environment;
  validateConfiguration({version: 1, defaultEnvironment: name, environments: {[name]: profile}}, targets);
  const defaults = Object.fromEntries(capabilityNames.map(capability => [capability,
    profile.environmentMode === 'test' ? !['ddl', 'admin'].includes(capability)
      : profile.environmentMode === 'protected' && ['apiReads', 'apiExploration', 'dbSelect', 'dbExploration', 'browserReads', 'browserExploration'].includes(capability)]));
  environment.capabilities = {...defaults, ...profile.capabilities};
  // Only selected destinations and reference identities become active run inputs.
  environment.targets = {api: Object.fromEntries(profile.apiTargets.map(target => [target, targets.api[target]])),
    databases: Object.fromEntries(profile.databaseTargets.map(target => [target, targets.databases[target]])),
    browser: Object.fromEntries((profile.browserTargets ?? []).map(target => [target, targets.browser[target]]))};
  const scenarios = data(input.scenarios);
  requireThat(Array.isArray(scenarios) && scenarios.length > 0 && scenarios.length <= 500, 'Run needs nonempty bounded scenario scope.');
  unique(scenarios.map(scenario => scenario.id), 'scenario identifiers');
  for (const scenario of scenarios) {
    keys(scenario, ['id', 'expectations'], 'scenario scope'); id(scenario.id);
    requireThat(Array.isArray(scenario.expectations) && scenario.expectations.length > 0, 'Each scenario needs required expectations.');
    unique(scenario.expectations.map(expectation => expectation.id), 'expectation identifiers');
    for (const expectation of scenario.expectations) {
      keys(expectation, ['id', 'description', 'operationId', 'invocationId', 'requiredEvidence', 'phase'], 'expectation');
      if (expectation.phase !== undefined) oneOf(expectation.phase, ['SETUP', 'EXERCISE', 'VERIFY', 'CLEANUP', 'RESTORE']);
      id(expectation.id); id(expectation.operationId); id(expectation.invocationId);
      requireThat(typeof expectation.description === 'string' && expectation.description.trim().length > 0, 'Expectation description is required.');
      unique(expectation.requiredEvidence, 'required evidence kinds');
      requireThat(expectation.requiredEvidence.length > 0, 'Expectation requires evidence coverage.');
      expectation.requiredEvidence.forEach(kind => oneOf(kind, EVIDENCE_KINDS));
    }
  }
  const operations = (input.operations ?? []).map(operationInput);
  unique(operations.map(operation => operation.id), 'operation identifiers');
  requireThat(operations.every(operation => operation.source.kind !== 'exploration'), 'Exploration definitions belong to run-local observations.');
  const knowledge = data(input.knowledge ?? []);
  requireThat(Array.isArray(knowledge), 'Reviewed knowledge must be an array.');
  unique(knowledge.map(item => item.id), 'knowledge identifiers');
  for (const item of knowledge) {
    keys(item, ['id', 'version', 'reviewed', 'content'], 'reviewed knowledge'); id(item.id); revision(item.version);
    requireThat(item.reviewed === true && Object.hasOwn(item, 'content'), 'Only explicitly reviewed knowledge is a frozen input.');
  }
  const limits = {...DEFAULT_LIMITS, ...data(input.limits ?? {})}; keys(limits, Object.keys(DEFAULT_LIMITS), 'run limits');
  for (const [field, maximum] of Object.entries({maxAttempts: 20, timeoutMs: 86400000, cleanupTimeoutMs: 3600000, maxValueBytes: 1024 * 1024, maxEvidenceBytes: 64 * 1024 * 1024})) {
    requireThat(integer(limits[field], 1, maximum), 'Invalid finite execution limit.');
  }
  requireThat(Number.isSafeInteger(startedAt + limits.timeoutMs), 'Run deadline overflows.');
  requireThat(Array.isArray(input.values ?? []), 'Initial values must be an array.');
  const values = (input.values ?? []).map(value => typedValue(value, limits.maxValueBytes));
  unique(values.map(value => `${value.producer.scenarioId}/${value.name}`), 'initial value names');
  for (const value of values) requireThat(value.producer.runId === runId && scenarios.some(scenario => scenario.id === value.producer.scenarioId)
    && value.producer.attemptId === undefined && value.producer.name === value.name, 'Initial values need frozen run/scenario provenance.');
  const inputs = {environment, scenarios, operations, knowledge, values, limits};
  const run = frozen({version: 1, id: runId, startedAt, deadlineAt: startedAt + limits.timeoutMs, inputs, inputFingerprint: fingerprint(inputs)});
  RUNS.add(run); return run;
}

export function requireRun(run) { requireThat(RUNS.has(run), 'Use the immutable run returned by createRun.'); }

/** Pure policy decision. Driver support is explicit; this never dispatches or requests approval. */
export function authorizeOperation(run, input, supportedCapabilities = []) {
  requireRun(run); const operation = operationInput(input);
  unique(supportedCapabilities, 'supported capabilities'); supportedCapabilities.forEach(value => oneOf(value, capabilityNames));
  const environment = run.inputs.environment, exploration = operation.source.kind === 'exploration';
  const stable = run.inputs.operations.find(candidate => candidate.id === operation.id);
  let reason = null;
  if (exploration ? stable !== undefined : stable?.fingerprint !== operation.fingerprint) reason = 'DEFINITION_NOT_FROZEN';
  else if (!Object.hasOwn(environment.targets[{api: 'api', database: 'databases', browser: 'browser'}[operation.family]], operation.target)) reason = 'TARGET_NOT_ENABLED';
  else if (!environment.capabilities[operation.capability] || (exploration && !environment.capabilities[{api: 'apiExploration', database: 'dbExploration', browser: 'browserExploration'}[operation.family]])) reason = 'CAPABILITY_DISABLED';
  else if (!supportedCapabilities.includes(operation.capability)) reason = 'UNSUPPORTED_CAPABILITY';
  return frozen({allowed: reason === null, reason, operationFingerprint: operation.fingerprint});
}

/** Scheduling guard only. Executors must enforce real deadlines/cancellation when they are implemented. */
export function checkExecutionWindow(run, {phase, now = Date.now(), signal, cleanupStartedAt} = {}) {
  requireRun(run); oneOf(phase, ['SETUP', 'EXERCISE', 'VERIFY', 'CLEANUP', 'RESTORE']);
  requireThat(integer(now) && now >= run.startedAt, 'Invalid execution clock.');
  requireThat(signal === undefined || signal instanceof AbortSignal, 'Cancellation needs an AbortSignal.');
  const cleanup = ['CLEANUP', 'RESTORE'].includes(phase);
  if (cleanup) requireThat(integer(cleanupStartedAt) && cleanupStartedAt >= run.startedAt && cleanupStartedAt <= now && Number.isSafeInteger(cleanupStartedAt + run.inputs.limits.cleanupTimeoutMs), 'Cleanup needs its own bounded start time.');
  const remainingMs = Math.max(0, (cleanup ? cleanupStartedAt + run.inputs.limits.cleanupTimeoutMs : run.deadlineAt) - now);
  const reason = !cleanup && signal?.aborted ? 'CANCELLED' : remainingMs === 0 ? 'DEADLINE_EXCEEDED' : null;
  return frozen({allowed: reason === null, reason, remainingMs});
}
