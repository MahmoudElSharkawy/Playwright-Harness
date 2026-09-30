import {data, frozen, fingerprint, requireThat, id, keys, oneOf, unique, references, protectedReference, typedValue} from './data.mjs';
import {requireRun, operationInput, authorizeOperation, checkExecutionWindow} from './inputs.mjs';
import {attemptRecord, decideRecovery, rowMismatch} from './attempts.mjs';
import {verifyEvidence} from './evidence.mjs';

function sameProducer(value, attempt, name) {
  return value.producer.runId === attempt.identity.runId && value.producer.scenarioId === attempt.identity.scenarioId
    && value.producer.attemptId === attempt.identity.attemptId && value.producer.name === name;
}

function resolveOutput(reference, attempts) {
  keys(reference, ['attemptId', 'name'], 'output reference'); id(reference.attemptId); id(reference.name);
  const attempt = attempts.get(reference.attemptId), output = attempt?.outputs.find(value => value.name === reference.name);
  requireThat(output !== undefined, 'Missing producer output.'); return {attempt, output};
}

const sameBinding = (left, right) => fingerprint({...left, name: right.name}) === fingerprint(right);

function resourceIdentity(run, reference, origin, attempts) {
  keys(reference, ['attemptId', 'name'], 'resource identity'); id(reference.name);
  const value = reference.attemptId === undefined
    ? run.inputs.values.find(input => input.producer.scenarioId === origin.identity.scenarioId && input.name === reference.name)
    : resolveOutput(reference, attempts).output;
  requireThat(value && [...origin.inputs, ...origin.outputs].some(bound => sameBinding(value, bound)), 'Resource identity must be produced by or bound into its originating attempt.');
  return value;
}

function lifecycle(run, resource, attempts, evidence) {
  keys(resource, ['id', 'originAttemptId', 'identity', 'ownership', 'intent', 'beforeStateRef', 'lifecycle'], 'resource');
  id(resource.id); id(resource.originAttemptId);
  oneOf(resource.ownership, ['harness', 'existing']); oneOf(resource.intent, ['temporary', 'restore', 'persistent', 'no-obligation']);
  const origin = attempts.get(resource.originAttemptId);
  requireThat(origin?.effect.resourceIds.includes(resource.id), 'Resource must be associated with its recorded effect.');
  const identityValue = resourceIdentity(run, resource.identity, origin, attempts);
  if (resource.beforeStateRef !== undefined) protectedReference(resource.beforeStateRef);
  const action = resource.intent === 'persistent' ? 'retain' : resource.intent === 'no-obligation' ? 'none'
    : resource.intent === 'restore' || resource.ownership === 'existing' ? 'restore' : 'cleanup';
  const obligation = resource.lifecycle;
  keys(obligation, ['action', 'status', 'attemptId', 'evidenceIds', 'guard'], 'resource lifecycle');
  requireThat(obligation.action === action, 'Lifecycle action contradicts resource intent.'); references(obligation.evidenceIds);
  if (['retain', 'none'].includes(action)) {
    requireThat(obligation.status === 'not-required' && obligation.attemptId === undefined && obligation.guard === undefined && obligation.evidenceIds.length === 0, 'Intentional retention has no invented cleanup obligation.');
    return false;
  }
  oneOf(obligation.status, ['pending', 'completed', 'failed', 'conflict']);
  const cleanupAttempt = obligation.attemptId === undefined ? undefined : attempts.get(obligation.attemptId);
  if (obligation.attemptId !== undefined) requireThat(cleanupAttempt && cleanupAttempt.identity.phase === action.toUpperCase() && cleanupAttempt.startedAt >= origin.endedAt, 'Wrong lifecycle attempt or phase.');
  for (const reference of obligation.evidenceIds) requireThat(cleanupAttempt?.evidenceIds.includes(reference) && evidence.has(reference), 'Lifecycle evidence is missing or belongs to another attempt.');
  if (obligation.guard !== undefined) {
    keys(obligation.guard, ['kind', 'evidenceIds'], 'restoration guard'); oneOf(obligation.guard.kind, ['identity', 'version']); references(obligation.guard.evidenceIds);
    requireThat(action === 'restore' && obligation.guard.evidenceIds.length > 0 && obligation.guard.evidenceIds.every(reference => obligation.evidenceIds.includes(reference)), 'Restoration guard needs associated evidence.');
  }
  if (obligation.status === 'completed') {
    requireThat(cleanupAttempt?.outcome === 'SUCCESS' && obligation.evidenceIds.some(reference => evidence.get(reference).kind === 'lifecycle'), 'Completed lifecycle needs a successful attempt and evidence.');
    const associatedEffect = cleanupAttempt.effect.certainty === 'confirmed' && cleanupAttempt.effect.resourceIds.includes(resource.id);
    const associatedVerification = ['none', 'confirmed'].includes(cleanupAttempt.effect.certainty) && cleanupAttempt.inputs.some(input => sameBinding(identityValue, input));
    requireThat(associatedEffect || associatedVerification, 'Completed lifecycle must identify the same resource through its effect or typed input binding.');
    requireThat(action !== 'restore' || obligation.guard !== undefined, 'Restoration completion needs an identity/version guard.');
  }
  return obligation.status !== 'completed';
}

/** Validate complete sequential records and derive verdicts once. Reporters consume this result. */
export function assessRun(run, roots, input) {
  requireRun(run); const report = data(input);
  keys(report, ['scenarios', 'operations', 'evidence'], 'run observations');
  requireThat(Array.isArray(report.scenarios) && Array.isArray(report.operations) && Array.isArray(report.evidence), 'Run observations need arrays.');
  requireThat(report.scenarios.length === run.inputs.scenarios.length, 'Incomplete scenario results.');
  unique(report.scenarios.map(scenario => scenario.id), 'scenario results');
  const operations = [...run.inputs.operations, ...report.operations.map(operationInput)];
  unique(operations.map(operation => operation.id), 'run operation definitions');
  requireThat(report.operations.every(operation => operation.source.kind === 'exploration'), 'Stable definitions must be frozen at initialization.');
  const operationMap = new Map(operations.map(operation => [operation.id, operation]));
  unique(report.evidence.map(record => record.id), 'artifact identifiers');
  const checkedEvidence = report.evidence.map(record => verifyEvidence(run, roots, record));
  unique(checkedEvidence.map(item => process.platform === 'win32' ? item.actual.toLowerCase() : item.actual), 'artifact paths');
  const evidence = new Map(checkedEvidence.map(item => [item.record.id, item.record]));
  const allAttempts = new Map(), results = []; let previousEnd = run.startedAt;
  for (const [index, scenario] of report.scenarios.entries()) {
    keys(scenario, ['id', 'disposition', 'reason', 'attempts', 'resources', 'outputRefs', 'issues'], 'scenario result');
    const scope = run.inputs.scenarios[index]; requireThat(scenario.id === scope.id, 'Scenario results must match the frozen sequential scope.');
    oneOf(scenario.disposition, ['executed', 'blocked', 'skipped']);
    requireThat(Array.isArray(scenario.attempts) && Array.isArray(scenario.resources) && Array.isArray(scenario.outputRefs), 'Scenario result collections are required.');
    unique(scenario.issues, 'scenario issues'); scenario.issues.forEach(issue => oneOf(issue, ['assertion-instability', 'contradictory-evidence', 'indeterminate-outcome']));
    if (scenario.disposition !== 'executed') {
      id(scenario.reason);
      requireThat(scenario.attempts.length === 0 && scenario.resources.length === 0 && scenario.outputRefs.length === 0 && scenario.issues.length === 0, 'Unexecuted scenarios cannot discard partial execution.');
      results.push({...scenario, status: scenario.disposition.toUpperCase(), stability: 'stable', counts: {required: scope.expectations.length, evaluated: 0, passed: 0, failed: 0, indeterminate: 0, notEvaluated: scope.expectations.length}, outputs: []});
      continue;
    }
    requireThat(scenario.reason === undefined && scenario.attempts.length > 0, 'Executed scenarios need nonempty attempt history.');
    const attempts = new Map(), invocations = new Map(), assertions = new Map(scope.expectations.map(expectation => [expectation.id, []]));
    let previousPhase = -1, cleanupStartedAt;
    for (const raw of scenario.attempts) {
      const attempt = attemptRecord(run, raw), identity = attempt.identity;
      requireThat(identity.scenarioId === scenario.id && !allAttempts.has(identity.attemptId), 'Duplicate or wrong attempt identity.');
      const phase = {SETUP: 0, EXERCISE: 1, VERIFY: 2, CLEANUP: 3, RESTORE: 3}[identity.phase];
      requireThat(phase >= previousPhase && attempt.startedAt >= previousEnd, 'Attempt history must be sequential in phase and time.');
      previousPhase = phase; previousEnd = attempt.endedAt;
      if (phase === 3) cleanupStartedAt ??= attempt.startedAt;
      const window = checkExecutionWindow(run, {phase: identity.phase, now: attempt.startedAt, ...(phase === 3 ? {cleanupStartedAt} : {})});
      // A refusal can be recorded after expiry without claiming that work started.
      // The authorization check below also proves every POLICY refusal is genuine.
      const unexecutedExpiry = attempt.effect.certainty === 'not-executed' &&
        ((attempt.outcome === 'INFRASTRUCTURE_FAILURE' && attempt.failureClass === 'TIMEOUT') || (attempt.outcome === 'BLOCKED' && attempt.failureClass === 'POLICY'));
      requireThat(window.allowed || unexecutedExpiry, 'Operation started outside its execution deadline.');
      const deadline = phase === 3 ? cleanupStartedAt + run.inputs.limits.cleanupTimeoutMs : run.deadlineAt;
      requireThat(attempt.outcome !== 'SUCCESS' || attempt.endedAt <= deadline, 'Successful operation exceeded its deadline.');
      const operation = operationMap.get(identity.operationId);
      requireThat(operation?.fingerprint === attempt.operationFingerprint, 'Attempt operation provenance mismatch.');
      const authorization = authorizeOperation(run, operation, attempt.supportedCapabilities);
      requireThat(authorization.allowed || (attempt.outcome === 'BLOCKED' && attempt.failureClass === 'POLICY'), 'Attempt used an unauthorized or unsupported operation.');
      if (attempt.outcome === 'BLOCKED' && attempt.failureClass === 'POLICY') requireThat(!authorization.allowed, 'Policy-blocked attempt contradicts its capabilities.');
      for (const reference of attempt.evidenceIds) requireThat(evidence.has(reference) && fingerprint(evidence.get(reference).identity) === fingerprint(identity), 'Artifact belongs to another attempt or is missing.');
      for (const reference of attempt.reconciliation?.evidenceIds ?? []) requireThat(attempt.evidenceIds.includes(reference) && evidence.get(reference)?.kind === 'reconciliation', 'Reconciliation needs its own registered observation.');
      for (const value of attempt.inputs) {
        const producer = attempts.get(value.producer.attemptId);
        const source = value.producer.attemptId === undefined ? run.inputs.values.find(input => input.producer.scenarioId === scenario.id && input.name === value.producer.name)
          : producer?.outputs.find(output => output.name === value.producer.name);
        requireThat(source && (producer ? sameProducer(value, producer, source.name) : value.producer.runId === run.id && value.producer.scenarioId === scenario.id), 'Input binding has no frozen input or earlier producer in this scenario.');
        requireThat(fingerprint({...source, name: value.name}) === fingerprint(value), 'Input binding changes type, sensitivity or value.');
      }
      for (const value of attempt.outputs) { typedValue(value, run.inputs.limits.maxValueBytes); requireThat(sameProducer(value, attempt, value.name), 'Output has the wrong producer.'); }
      const history = invocations.get(identity.invocationId) ?? [];
      requireThat(identity.number === history.length + 1 && identity.number <= run.inputs.limits.maxAttempts, 'Incomplete or excessive attempt history.');
      if (history.length) {
        requireThat(history[0].identity.operationId === identity.operationId && history[0].identity.phase === identity.phase && fingerprint(history[0].inputs) === fingerprint(attempt.inputs), 'Replay changed its operation, phase or inputs.');
        requireThat(decideRecovery(run, history, {now: attempt.startedAt, evidence: [...evidence.values()], roots, cleanupStartedAt}).action === 'RETRY', 'Unsafe or unbudgeted replay.');
      }
      history.push(attempt); invocations.set(identity.invocationId, history);
      for (const assertion of attempt.assertions) {
        const expectation = scope.expectations.find(item => item.id === assertion.id);
        for (const reference of assertion.evidenceIds) requireThat(attempt.evidenceIds.includes(reference), 'Assertion evidence belongs to another attempt.');
        if (['PASS', 'FAIL'].includes(assertion.status)) requireThat(expectation.requiredEvidence.every(kind => assertion.evidenceIds.some(reference => evidence.get(reference)?.kind === kind)), 'Required assertion evidence is missing.');
        assertions.get(assertion.id).push({...assertion, attemptId: identity.attemptId});
      }
      attempts.set(identity.attemptId, attempt); allAttempts.set(identity.attemptId, attempt);
    }
    requireThat([...assertions.values()].every(observations => observations.length > 0), 'Required expectation results are incomplete.');
    unique(scenario.resources.map(resource => resource.id), 'resource identifiers');
    const resourceIds = new Set(scenario.resources.map(resource => resource.id));
    for (const attempt of attempts.values()) requireThat(attempt.effect.resourceIds.every(resource => resourceIds.has(resource)), 'Effect resource was dropped from the result.');
    let lifecycleIncomplete = false;
    for (const resource of scenario.resources) lifecycleIncomplete = lifecycle(run, resource, attempts, evidence) || lifecycleIncomplete;
    let failed = [...attempts.values()].some(rowMismatch), needsReview = scenario.issues.length > 0 || lifecycleIncomplete, blocked = false;
    const counts = {required: scope.expectations.length, evaluated: 0, passed: 0, failed: 0, indeterminate: 0, notEvaluated: 0};
    for (const [expectationId, observations] of assertions) {
      const expectation = scope.expectations.find(item => item.id === expectationId);
      const latest = invocations.get(expectation.invocationId).at(-1).identity.attemptId;
      const current = observations.filter(observation => observation.attemptId === latest);
      requireThat(current.length > 0, 'Latest attempt is missing a required expectation result.');
      const reliableFail = observations.some(observation => observation.status === 'FAIL' && observation.reliable);
      const reliablePass = current.some(observation => observation.status === 'PASS' && observation.reliable);
      const instability = observations.some(observation => ['PASS', 'FAIL'].includes(observation.status) && !observation.reliable);
      if (reliableFail) { failed = true; counts.failed++; counts.evaluated++; }
      else if (reliablePass && !instability) { counts.passed++; counts.evaluated++; }
      else if (current.every(observation => observation.status === 'NOT_EVALUATED') && !instability) { blocked = true; counts.notEvaluated++; }
      else { needsReview = true; counts.indeterminate++; }
      if (instability) needsReview = true;
    }
    for (const history of invocations.values()) {
      const last = history.at(-1);
      for (const attempt of history) {
        if (attempt.effect.certainty === 'uncertain') {
          const resolved = ['confirmed-effect', 'confirmed-no-effect'].includes(attempt.reconciliation?.kind)
            || (attempt.reconciliation?.kind === 'supported-idempotency' && last !== attempt && last.outcome === 'SUCCESS' && last.effect.certainty === 'confirmed');
          if (!resolved) needsReview = true;
        }
      }
      if (['BLOCKED', 'SKIPPED'].includes(last.outcome) || (last.outcome === 'INFRASTRUCTURE_FAILURE' && last.effect.certainty !== 'confirmed' && last.reconciliation?.kind !== 'confirmed-effect')) blocked = true;
    }
    const status = failed ? 'FAIL' : needsReview ? 'NEEDS_REVIEW' : blocked ? 'BLOCKED' : 'PASS';
    unique(scenario.outputRefs.map(reference => `${reference.attemptId}/${reference.name}`), 'selected outputs');
    const outputs = scenario.outputRefs.map(reference => resolveOutput(reference, attempts).output);
    const recoveryObserved = [...attempts.values()].some(attempt => attempt.outcome === 'INFRASTRUCTURE_FAILURE' || attempt.reconciliation !== undefined);
    results.push({...scenario, attempts: [...attempts.values()], status,
      stability: needsReview || (blocked && recoveryObserved) ? 'unstable' : recoveryObserved ? 'recovered' : 'stable', counts, outputs,
      requiredLifecycleComplete: !lifecycleIncomplete});
  }
  for (const record of evidence.values()) requireThat(allAttempts.get(record.identity.attemptId)?.evidenceIds.includes(record.id), 'Evidence has no corresponding attempt.');
  const status = ['FAIL', 'NEEDS_REVIEW', 'BLOCKED'].find(candidate => results.some(result => result.status === candidate))
    ?? (results.every(result => result.status === 'SKIPPED') ? 'SKIPPED' : 'PASS');
  const counts = Object.fromEntries(['PASS', 'FAIL', 'BLOCKED', 'SKIPPED', 'NEEDS_REVIEW'].map(value => [value, results.filter(result => result.status === value).length]));
  return frozen({version: 1, runId: run.id, inputFingerprint: run.inputFingerprint, status,
    stability: results.some(result => result.stability === 'unstable') ? 'unstable' : results.some(result => result.stability === 'recovered') ? 'recovered' : 'stable', counts,
    scenarios: results, operations, evidence: [...evidence.values()]});
}
