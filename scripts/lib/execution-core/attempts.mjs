import {data, frozen, fingerprint, requireThat, integer, id, keys, identity, oneOf, unique, references, typedValue} from './data.mjs';
import {requireRun, checkExecutionWindow} from './inputs.mjs';
import {verifyEvidence} from './evidence.mjs';

export function rowMismatch(attempt) {
  const rows = attempt.effect.affectedRows;
  return rows?.expected !== undefined && (rows.actual < rows.expected.min || rows.actual > rows.expected.max);
}

/** Validate a single completed observation record; this does not execute, replay or schedule work. */
export function attemptRecord(run, input) {
  requireRun(run); const attempt = data(input);
  keys(attempt, ['identity', 'operationFingerprint', 'startedAt', 'endedAt', 'outcome', 'failureClass', 'effect', 'reconciliation', 'assertions', 'inputs', 'outputs', 'evidenceIds', 'supportedCapabilities'], 'attempt');
  identity(attempt.identity);
  requireThat(attempt.identity.runId === run.id && run.inputs.scenarios.some(scenario => scenario.id === attempt.identity.scenarioId), 'Attempt belongs to another execution.');
  requireThat(/^[a-f0-9]{64}$/.test(attempt.operationFingerprint), 'Missing operation provenance.');
  requireThat(integer(attempt.startedAt, run.startedAt) && integer(attempt.endedAt, attempt.startedAt), 'Invalid attempt timing.');
  oneOf(attempt.outcome, ['SUCCESS', 'INFRASTRUCTURE_FAILURE', 'ASSERTION_FAILURE', 'BLOCKED', 'SKIPPED']);
  const failureClasses = {SUCCESS: ['NONE'], INFRASTRUCTURE_FAILURE: ['TRANSPORT', 'TIMEOUT', 'CANCELLED', 'EXECUTOR', 'UNAVAILABLE'], ASSERTION_FAILURE: ['ASSERTION'], BLOCKED: ['POLICY', 'UNAVAILABLE'], SKIPPED: ['NOT_SELECTED', 'DEPENDENCY']};
  oneOf(attempt.failureClass, failureClasses[attempt.outcome]);
  keys(attempt.effect, ['certainty', 'resourceIds', 'affectedRows'], 'effect');
  oneOf(attempt.effect.certainty, ['not-executed', 'none', 'confirmed', 'uncertain']);
  unique(attempt.effect.resourceIds, 'effect resources'); attempt.effect.resourceIds.forEach(id);
  if (['not-executed', 'none'].includes(attempt.effect.certainty)) requireThat(attempt.effect.resourceIds.length === 0, 'No-effect attempts cannot claim changed resources.');
  if (attempt.effect.affectedRows !== undefined) {
    const rows = attempt.effect.affectedRows; keys(rows, ['actual', 'expected'], 'affected rows');
    requireThat(integer(rows.actual) && ['confirmed', 'none'].includes(attempt.effect.certainty), 'Affected rows require a known effect and nonnegative count.');
    if (rows.actual > 0) requireThat(attempt.effect.certainty === 'confirmed', 'Positive affected rows establish an effect.');
    if (rows.expected !== undefined) { keys(rows.expected, ['min', 'max'], 'row expectation'); requireThat(integer(rows.expected.min) && integer(rows.expected.max, rows.expected.min), 'Invalid affected-row expectation.'); }
  }
  if (attempt.reconciliation !== undefined) {
    keys(attempt.reconciliation, ['kind', 'evidenceIds', 'contractRef'], 'reconciliation');
    oneOf(attempt.reconciliation.kind, ['confirmed-no-effect', 'confirmed-effect', 'supported-idempotency', 'inconclusive']);
    references(attempt.reconciliation.evidenceIds);
    requireThat(attempt.reconciliation.evidenceIds.length > 0 && attempt.effect.certainty === 'uncertain', 'Reconciliation needs an uncertain effect and recorded evidence.');
    if (attempt.reconciliation.kind === 'supported-idempotency') id(attempt.reconciliation.contractRef);
    else requireThat(attempt.reconciliation.contractRef === undefined, 'Only supported idempotency uses an endpoint contract.');
  }
  references(attempt.evidenceIds); unique(attempt.supportedCapabilities, 'supported capabilities');
  requireThat(Array.isArray(attempt.assertions) && Array.isArray(attempt.inputs) && Array.isArray(attempt.outputs), 'Attempt observations must be arrays.');
  unique(attempt.assertions.map(assertion => assertion.id), 'attempt assertions');
  const expectations = run.inputs.scenarios.find(scenario => scenario.id === attempt.identity.scenarioId).expectations
    .filter(expectation => expectation.operationId === attempt.identity.operationId && expectation.invocationId === attempt.identity.invocationId);
  for (const assertion of attempt.assertions) {
    keys(assertion, ['id', 'status', 'reliable', 'evidenceIds'], 'assertion'); id(assertion.id);
    requireThat(expectations.some(expectation => expectation.id === assertion.id), 'Assertion does not belong to this invocation.');
    oneOf(assertion.status, ['PASS', 'FAIL', 'INDETERMINATE', 'NOT_EVALUATED']); requireThat(typeof assertion.reliable === 'boolean', 'Assertion reliability must be explicit.');
    requireThat(!['INDETERMINATE', 'NOT_EVALUATED'].includes(assertion.status) || !assertion.reliable, 'Unevaluated or indeterminate assertions are not reliable.'); references(assertion.evidenceIds);
    requireThat(assertion.status !== 'NOT_EVALUATED' || attempt.outcome !== 'SUCCESS', 'Successful attempts cannot omit required evaluation.');
  }
  requireThat(attempt.assertions.length === expectations.length, 'Each attempt must record every required expectation result.');
  for (const collection of [attempt.inputs, attempt.outputs]) {
    unique(collection.map(value => value.name), 'value names'); collection.forEach(value => typedValue(value, run.inputs.limits.maxValueBytes));
  }
  const failed = attempt.assertions.some(assertion => assertion.status === 'FAIL' && assertion.reliable) || rowMismatch(attempt);
  if (attempt.effect.certainty === 'not-executed') requireThat(attempt.outputs.length === 0 && attempt.assertions.every(assertion => ['NOT_EVALUATED', 'INDETERMINATE'].includes(assertion.status)), 'An unexecuted operation cannot produce outputs or evaluated assertions.');
  requireThat(attempt.outcome !== 'ASSERTION_FAILURE' || failed, 'An assertion failure needs a reliable failed observation.');
  requireThat(attempt.outcome !== 'SUCCESS' || !failed, 'A successful attempt cannot hide a reliable assertion failure.');
  if (['BLOCKED', 'SKIPPED'].includes(attempt.outcome)) requireThat(attempt.effect.certainty === 'not-executed' && attempt.outputs.length === 0, 'Blocked/skipped operations cannot have executed effects.');
  return frozen(attempt);
}

/** Decide a finite replay from established facts. An HTTP verb/header is never a safety proof. */
export function decideRecovery(run, history, {now = Date.now(), evidence = [], roots, cleanupStartedAt} = {}) {
  requireRun(run); requireThat(Array.isArray(history) && history.length > 0, 'Recovery needs attempt history.');
  const attempts = history.map(attempt => attemptRecord(run, attempt)), last = attempts.at(-1), first = attempts[0].identity;
  requireThat(attempts.every((attempt, index) => attempt.identity.number === index + 1 && ['runId', 'scenarioId', 'operationId', 'invocationId', 'phase'].every(key => attempt.identity[key] === first[key])), 'Recovery history must belong to one complete invocation.');
  unique(attempts.map(attempt => attempt.identity.attemptId), 'recovery attempt identities');
  requireThat(attempts.every((attempt, index) => attempt.operationFingerprint === attempts[0].operationFingerprint && fingerprint(attempt.inputs) === fingerprint(attempts[0].inputs)
    && (index === 0 || attempt.startedAt >= attempts[index - 1].endedAt)) && integer(now, last.endedAt), 'Recovery history changed its definition, inputs or chronology.');
  if (['CLEANUP', 'RESTORE'].includes(first.phase)) requireThat(integer(cleanupStartedAt, run.startedAt, attempts[0].startedAt), 'Recovery needs the existing shared cleanup start time.');
  requireThat(Array.isArray(evidence), 'Recovery evidence must be an array.');
  for (const attempt of attempts) for (const reference of attempt.reconciliation?.evidenceIds ?? []) {
    const records = evidence.filter(record => record.id === reference);
    requireThat(records.length === 1 && attempt.evidenceIds.includes(reference) && records[0].kind === 'reconciliation' && fingerprint(records[0].identity) === fingerprint(attempt.identity), 'Reconciliation requires associated evidence.');
    requireThat(roots !== undefined, 'Reconciliation requires roots for artifact verification.');
    verifyEvidence(run, roots, records[0]);
  }
  const result = (action, reason) => frozen({action, reason, nextAttemptNumber: attempts.length + 1});
  if (attempts.some(attempt => attempt.assertions.some(assertion => assertion.status === 'FAIL' && assertion.reliable) || rowMismatch(attempt))) return result('STOP', 'ASSERTION_FAILED');
  function after(attempt, count, time) {
    if (attempt.outcome !== 'INFRASTRUCTURE_FAILURE') return result('STOP', 'NO_REPLAY_REQUIRED');
    if (attempt.effect.certainty === 'confirmed' || attempt.reconciliation?.kind === 'confirmed-effect') return result('VERIFY', 'KNOWN_EFFECT');
    const uncertain = attempt.effect.certainty === 'uncertain';
    if (uncertain && !attempt.reconciliation) return result('RECONCILE', 'EFFECT_UNCERTAIN');
    if (attempt.reconciliation?.kind === 'inconclusive') return result('NEEDS_REVIEW', 'EFFECT_UNCERTAIN');
    if (count >= run.inputs.limits.maxAttempts) return result('STOP', 'RETRY_BUDGET_EXHAUSTED');
    const window = checkExecutionWindow(run, {phase: attempt.identity.phase, now: time, cleanupStartedAt});
    if (!window.allowed) return result('STOP', window.reason);
    return result('RETRY', uncertain ? attempt.reconciliation.kind === 'supported-idempotency' ? 'SUPPORTED_IDEMPOTENCY' : 'RECONCILED_NO_EFFECT' : 'KNOWN_NO_EFFECT');
  }
  for (let index = 0; index < attempts.length - 1; index++) {
    if (after(attempts[index], index + 1, attempts[index + 1].startedAt).action !== 'RETRY') return result('NEEDS_REVIEW', 'UNSAFE_REPLAY_HISTORY');
  }
  return after(last, attempts.length, now);
}
