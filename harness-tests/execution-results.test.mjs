import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync, unlinkSync, mkdirSync, symlinkSync, renameSync} from 'node:fs';
import {join} from 'node:path';
import {assessRun, registerEvidence, decideRecovery, attemptRecord} from '../scripts/lib/execution-core/index.mjs';
import {fixture, operation, scope, value, attempt, retry, resource} from './fixtures/execution-core.mjs';

test('complete evidence-backed result derives counts, preserves selected outputs and is immutable', t => {
  const f = fixture(t), result = f.assess(); assert.equal(result.status, 'PASS'); assert.equal(result.stability, 'stable');
  assert.equal(result.scenarios[0].counts.evaluated, 1); assert.equal(result.counts.PASS, 1);
  assert.equal(result.scenarios[0].outputs[0].value, 'row-1'); assert.throws(() => { result.status = 'FAIL'; });
});
for (const change of [f => f.report.scenarios = [], f => f.scenario.attempts = [], f => f.current.assertions = [], f => f.report.counts = {PASS: 7}, f => f.report.status = 'PASS', f => f.scenario.attempts.push(f.current), f => f.current.identity.number = 2, f => f.current.identity.runId = 'another-run', f => f.current.identity.scenarioId = 'another-case']) {
  test(`incomplete or forged result records fail: ${change.toString()}`, t => { const f = fixture(t); change(f); assert.throws(f.assess); });
}
test('a safely retried read passes with recovered stability and both attempts retained', t => {
  const f = fixture(t); const next = retry(f); f.current.effect.certainty = 'not-executed';
  assert.equal(decideRecovery(f.run, [f.current], {now: next.startedAt}).action, 'RETRY');
  const result = f.assess(); assert.equal(result.status, 'PASS'); assert.equal(result.stability, 'recovered'); assert.equal(result.scenarios[0].attempts.length, 2);
});
test('a known no-effect mutation may safely retry without catalog registration or an invented approval', t => {
  const op = operation({capability: 'apiMutations'}), f = fixture(t, {operations: [op]}); retry(f);
  assert.equal(f.assess().status, 'PASS');
});
test('unknown transmitted effects require reconciliation and cannot be replayed blindly', t => {
  const f = fixture(t, {operations: [operation({capability: 'apiMutations'})]}); retry(f); f.current.effect.certainty = 'uncertain';
  assert.equal(decideRecovery(f.run, [f.current], {now: 1200}).action, 'RECONCILE'); assert.throws(f.assess, /Unsafe/);
});
test('reconciliation establishing no effect permits bounded replay with retained proof', t => {
  const f = fixture(t, {operations: [operation({capability: 'apiMutations'})]}); retry(f); f.current.effect.certainty = 'uncertain';
  f.current.reconciliation = {kind: 'confirmed-no-effect', evidenceIds: [f.evidence(f.current, 'reconciliation')]};
  assert.throws(() => decideRecovery(f.run, [f.current], {now: 1200}), /associated evidence/);
  assert.equal(f.assess().status, 'PASS'); assert.equal(f.assess().stability, 'recovered');
});
test('an endpoint-supported idempotency contract permits replay but an HTTP verb or arbitrary header does not', t => {
  const f = fixture(t, {operations: [operation({capability: 'apiMutations'})]}), next = retry(f); f.current.effect.certainty = 'uncertain';
  f.current.reconciliation = {kind: 'supported-idempotency', contractRef: 'documented-fixture-contract', evidenceIds: [f.evidence(f.current, 'reconciliation')]}; next.effect.certainty = 'confirmed';
  assert.equal(f.assess().status, 'PASS');
  delete f.current.reconciliation.contractRef; assert.throws(f.assess);
  f.current.reconciliation = {kind: 'supported-idempotency', method: 'PUT', evidenceIds: []}; assert.throws(f.assess);
});
test('confirmed effects are verified instead of replayed, and lost required response evidence stays indeterminate', t => {
  const f = fixture(t, {operations: [operation({capability: 'apiMutations'})], scenarios: scope(['response'])});
  f.current.outcome = 'INFRASTRUCTURE_FAILURE'; f.current.failureClass = 'TRANSPORT'; f.current.effect.certainty = 'uncertain';
  f.current.reconciliation = {kind: 'confirmed-effect', evidenceIds: [f.evidence(f.current, 'reconciliation')]};
  f.current.assertions = [{id: 'visible', status: 'INDETERMINATE', reliable: false, evidenceIds: []}];
  assert.equal(decideRecovery(f.run, [f.current], {now: 1200, evidence: f.report.evidence, roots: f.roots}).action, 'VERIFY');
  assert.equal(f.assess().status, 'NEEDS_REVIEW');
  f.current.assertions[0] = {id: 'visible', status: 'PASS', reliable: true, evidenceIds: f.current.reconciliation.evidenceIds}; assert.throws(f.assess, /Required assertion evidence/);
});
test('confirmed infrastructure effects with every required observation satisfied can finish recovered', t => {
  const f = fixture(t); f.current.outcome = 'INFRASTRUCTURE_FAILURE'; f.current.failureClass = 'TRANSPORT'; f.current.effect.certainty = 'confirmed';
  assert.equal(f.assess().status, 'PASS'); assert.equal(f.assess().stability, 'recovered');
});
test('reliable assertion failures remain FAIL and cannot be retried to green', t => {
  const f = fixture(t); f.current.assertions[0].status = 'FAIL'; f.current.outcome = 'ASSERTION_FAILURE'; f.current.failureClass = 'ASSERTION';
  assert.equal(f.assess().status, 'FAIL'); assert.equal(decideRecovery(f.run, [f.current], {now: 1200}).reason, 'ASSERTION_FAILED');
  const next = attempt(f.run, f.run.inputs.operations[0], {identity: {...f.current.identity, number: 2, attemptId: 'attempt-2'}, startedAt: 1200, endedAt: 1210});
  next.assertions = [{id: 'visible', status: 'PASS', reliable: true, evidenceIds: [f.evidence(next)]}]; f.scenario.attempts.push(next); assert.throws(f.assess, /Unsafe/);
});
test('a separate later invocation cannot substitute for an earlier required observation', t => {
  const f = fixture(t); const next = retry(f); next.identity.invocationId = 'unrelated-call'; next.identity.number = 1;
  f.report.evidence = f.report.evidence.filter(item => item.identity.attemptId !== 'attempt-2'); next.evidenceIds = [];
  next.assertions[0].evidenceIds = [f.evidence(next)]; assert.throws(f.assess, /does not belong/);
});
for (const issue of ['assertion-instability', 'contradictory-evidence', 'indeterminate-outcome']) test(`${issue} prevents a clean pass`, t => {
  const f = fixture(t); f.scenario.issues.push(issue); assert.equal(f.assess().status, 'NEEDS_REVIEW');
});
test('unreliable assertions and unresolved effects require review', t => {
  const f = fixture(t); f.current.assertions[0].reliable = false; assert.equal(f.assess().status, 'NEEDS_REVIEW');
  f.current.assertions[0].reliable = true; f.current.effect.certainty = 'uncertain'; assert.equal(f.assess().status, 'NEEDS_REVIEW');
});
test('retry budget and run deadline cannot be reset by a later attempt', t => {
  const f = fixture(t, {limits: {maxAttempts: 1}}); retry(f); assert.equal(decideRecovery(f.run, [f.current], {now: 1200}).reason, 'RETRY_BUDGET_EXHAUSTED'); assert.throws(f.assess, /excessive/);
  const late = fixture(t, {limits: {timeoutMs: 150}}); retry(late); assert.equal(decideRecovery(late.run, [late.current], {now: 1200}).reason, 'DEADLINE_EXCEEDED'); assert.throws(late.assess, /deadline/);
});
test('typed output-to-input binding preserves producer identity, type, sensitivity and business value', t => {
  const nextOp = operation({id: 'verify'}), f = fixture(t, {operations: [operation(), nextOp]});
  const next = attempt(f.run, nextOp, {identity: {...f.current.identity, operationId: 'verify', invocationId: 'verify-call', attemptId: 'verify-attempt', phase: 'VERIFY'}, startedAt: 1200, endedAt: 1210});
  next.inputs = [{...f.current.outputs[0], name: 'fixtureId'}]; f.scenario.attempts.push(next); assert.equal(f.assess().status, 'PASS');
  next.inputs[0].value = 'different-record'; assert.throws(f.assess, /changes type/);
  next.inputs[0].value = 'row-1'; next.inputs[0].producer.attemptId = 'unknown'; assert.throws(f.assess);
});
test('outputs with wrong producers and bindings from future attempts are rejected', t => {
  const f = fixture(t); f.current.outputs[0].producer.attemptId = 'other-attempt'; assert.throws(f.assess, /wrong producer/);
  f.current.outputs = [value(f.current)]; f.current.inputs = [{...value(f.current), name: 'selfInput'}]; assert.throws(f.assess, /earlier producer/);
});
test('selected sensitive output references are serializable without protected values', t => {
  const f = fixture(t), output = f.current.outputs[0]; delete output.value; output.sensitivity = 'sensitive'; output.protectedRef = 'protected:private-result';
  const result = f.assess(); assert.equal(result.scenarios[0].outputs[0].protectedRef, 'protected:private-result'); assert.equal(Object.hasOwn(result.scenarios[0].outputs[0], 'value'), false);
});
for (const intent of ['persistent', 'no-obligation']) test(`${intent} mutations pass without automatic before-state capture or cleanup`, t => {
  const f = fixture(t, {operations: [operation({capability: 'apiMutations'})]}); resource(f, intent); const result = f.assess();
  assert.equal(result.status, 'PASS'); assert.equal(result.scenarios[0].requiredLifecycleComplete, true); assert.equal(Object.hasOwn(result.scenarios[0].resources[0], 'beforeStateRef'), false);
});
test('temporary owned resources require completed cleanup and cannot disappear from the result', t => {
  const cleanupOp = operation({id: 'cleanup', capability: 'apiMutations'}), f = fixture(t, {operations: [operation({capability: 'apiMutations'}), cleanupOp]});
  const fixtureResource = resource(f, 'temporary'); assert.equal(f.assess().status, 'NEEDS_REVIEW');
  const cleanup = attempt(f.run, cleanupOp, {identity: {...f.current.identity, operationId: 'cleanup', invocationId: 'cleanup-call', attemptId: 'cleanup-attempt', phase: 'CLEANUP'}, startedAt: 1200, endedAt: 1210, effect: {certainty: 'confirmed', resourceIds: ['fixture-1']}});
  fixtureResource.lifecycle = {action: 'cleanup', status: 'completed', attemptId: 'cleanup-attempt', evidenceIds: [f.evidence(cleanup, 'lifecycle')]};
  f.scenario.attempts.push(cleanup); assert.equal(f.assess().status, 'PASS');
  f.scenario.resources = []; assert.throws(f.assess, /dropped/);
});
test('existing temporary state requires guarded restoration; a conflict prevents a clean pass', t => {
  const restoreOp = operation({id: 'restore', capability: 'dbDml', family: 'database', target: 'qa-db'}), f = fixture(t, {operations: [operation({capability: 'apiMutations'}), restoreOp]});
  const fixtureResource = resource(f, 'temporary', 'existing'); fixtureResource.beforeStateRef = 'protected:before-fixture';
  const restore = attempt(f.run, restoreOp, {identity: {...f.current.identity, operationId: 'restore', invocationId: 'restore-call', attemptId: 'restore-attempt', phase: 'RESTORE'}, startedAt: 1200, endedAt: 1210});
  restore.inputs = [{...f.current.outputs[0], name: 'existingId'}];
  f.scenario.attempts.push(restore); const proof = f.evidence(restore, 'lifecycle');
  fixtureResource.lifecycle = {action: 'restore', status: 'completed', attemptId: 'restore-attempt', evidenceIds: [proof]}; assert.throws(f.assess, /guard/);
  fixtureResource.lifecycle.guard = {kind: 'version', evidenceIds: [proof]}; assert.equal(f.assess().status, 'PASS');
  fixtureResource.lifecycle.status = 'conflict'; assert.equal(f.assess().status, 'NEEDS_REVIEW');
});
test('cleanup failure stays visible without erasing an established assertion failure', t => {
  const f = fixture(t); const fixtureResource = resource(f, 'temporary'); fixtureResource.lifecycle.status = 'failed';
  f.current.assertions[0].status = 'FAIL'; f.current.outcome = 'ASSERTION_FAILURE'; f.current.failureClass = 'ASSERTION';
  const result = f.assess(); assert.equal(result.status, 'FAIL'); assert.equal(result.scenarios[0].requiredLifecycleComplete, false);
});
test('affected-row counts reject invalid data and preserve valid expectation failures', t => {
  const f = fixture(t); f.current.effect = {certainty: 'confirmed', resourceIds: [], affectedRows: {actual: 2, expected: {min: 1, max: 1}}};
  f.current.outcome = 'ASSERTION_FAILURE'; f.current.failureClass = 'ASSERTION'; assert.equal(f.assess().status, 'FAIL');
  f.current.effect.affectedRows.actual = -1; assert.throws(f.assess, /nonnegative/);
});
test('blocked and skipped scenarios are explicit outcomes, never empty passes', t => {
  const f = fixture(t); f.report.evidence = []; Object.assign(f.scenario, {disposition: 'blocked', reason: 'target-unavailable', attempts: [], resources: [], outputRefs: []});
  assert.equal(f.assess().status, 'BLOCKED'); f.scenario.disposition = 'skipped'; assert.equal(f.assess().status, 'SKIPPED');
  delete f.scenario.reason; assert.throws(f.assess);
});
test('dynamic operations are recorded run-locally and still satisfy the same result controls', t => {
  const f = fixture(t, {operations: []}), op = operation({source: {kind: 'exploration', reference: 'run-local', version: 'v1'}});
  f.report.operations = [op]; f.current.operationFingerprint = op.fingerprint; assert.equal(f.assess().status, 'PASS');
  assert.equal(f.run.inputs.operations.length, 0);
});
test('required evidence cannot be removed, reassigned or replaced with unrelated categories', t => {
  const f = fixture(t); f.current.assertions[0].evidenceIds = []; assert.throws(f.assess, /Required assertion evidence/);
  f.current.assertions[0].evidenceIds = [f.current.evidenceIds[0]]; f.report.evidence[0] = {...f.report.evidence[0], kind: 'reconciliation'}; assert.throws(f.assess, /Required assertion evidence/);
  f.report.evidence[0] = {...f.report.evidence[0], kind: 'observation', identity: {...f.current.identity, attemptId: 'other-attempt'}}; assert.throws(f.assess, /another attempt/);
});
test('artifact integrity is checked against files, including tampering, deletion, empty files and invalid counts', t => {
  const f = fixture(t), path = join(f.roots.runRoot, f.report.evidence[0].path); writeFileSync(path, 'Tampered'); assert.throws(f.assess, /integrity mismatch/);
  writeFileSync(path, ''); assert.throws(f.assess, /Evidence is missing/); unlinkSync(path); assert.throws(f.assess, /Evidence is missing/);
  const second = fixture(t); second.report.evidence[0] = {...second.report.evidence[0], bytes: -1}; assert.throws(second.assess, /integrity metadata/);
});
test('evidence paths cannot escape into package, external or protected storage through aliases', t => {
  const f = fixture(t), external = join(f.roots.projectRoot, 'external'); mkdirSync(external); writeFileSync(join(external, 'outside.txt'), 'Synthetic');
  const alias = join(f.roots.runRoot, 'evidence', 'alias'); symlinkSync(external, alias, process.platform === 'win32' ? 'junction' : 'dir');
  t.after(() => { try { unlinkSync(alias); } catch (error) { if (error.code !== 'ENOENT') throw error; } });
  for (const path of ['../outside.txt', 'evidence/../../external/outside.txt', 'evidence/alias/outside.txt', 'protected/state.json', f.roots.packageRoot]) assert.throws(() => registerEvidence(f.run, f.roots, {id: 'escape', identity: f.current.identity, kind: 'observation', path, sanitized: true}));
});
test('duplicate artifact paths and unregistered evidence are rejected', t => {
  const f = fixture(t); f.report.evidence.push({...f.report.evidence[0], id: 'another-id'}); f.current.evidenceIds.push('another-id'); assert.throws(f.assess, /artifact paths/);
});
test('unapproved operation sources, missing driver support and phase/time regressions fail the record gate', t => {
  const unsupported = fixture(t); unsupported.current.supportedCapabilities = []; assert.throws(unsupported.assess, /unauthorized or unsupported/);
  const late = fixture(t); retry(late); late.scenario.attempts[1].startedAt = 1001; assert.throws(late.assess, /sequential/);
  const source = fixture(t); source.current.operationFingerprint = 'a'.repeat(64); assert.throws(source.assess, /provenance mismatch/);
});
test('replayed operations must evaluate required assertions again instead of reusing an earlier pass', t => {
  const f = fixture(t), original = structuredClone(f.current.assertions); const next = retry(f);
  f.current.assertions = original; next.assertions = []; assert.throws(f.assess, /Each attempt/);
});
test('known unevaluated scope is BLOCKED and unrecovered infrastructure is not called recovered', t => {
  const f = fixture(t); Object.assign(f.current, {outcome: 'INFRASTRUCTURE_FAILURE', failureClass: 'UNAVAILABLE', outputs: [], assertions: [{id: 'visible', status: 'NOT_EVALUATED', reliable: false, evidenceIds: []}]});
  f.current.effect.certainty = 'not-executed'; f.scenario.outputRefs = [];
  const result = f.assess(); assert.equal(result.status, 'BLOCKED'); assert.equal(result.stability, 'unstable'); assert.equal(result.scenarios[0].counts.notEvaluated, 1);
  f.current.outputs = [value(f.current)]; assert.throws(f.assess, /unexecuted operation/);
});
test('success outside the run deadline and renewed cleanup budgets are rejected', t => {
  const expired = fixture(t, {limits: {timeoutMs: 105}}); assert.throws(expired.assess, /exceeded its deadline/);
  const cleanupOp = operation({id: 'cleanup'}), f = fixture(t, {operations: [operation(), cleanupOp], limits: {cleanupTimeoutMs: 20}});
  for (const [attemptId, time] of [['cleanup-1', 1200], ['cleanup-2', 1300]]) f.scenario.attempts.push(attempt(f.run, cleanupOp, {identity: {...f.current.identity, operationId: 'cleanup', invocationId: attemptId, attemptId, phase: 'CLEANUP'}, startedAt: time, endedAt: time + 5}));
  assert.throws(f.assess, /outside its execution deadline/);
});
test('first-operation inputs bind frozen typed test data without fabricating a producer attempt', t => {
  const initial = {name: 'fixtureSeed', type: 'number', sensitivity: 'public', value: 7, producer: {runId: 'run-1', scenarioId: 'case-1', name: 'fixtureSeed'}};
  const f = fixture(t, {values: [initial]}); initial.value = 9;
  f.current.inputs = [{...structuredClone(f.run.inputs.values[0]), name: 'seed'}]; assert.equal(f.assess().status, 'PASS');
  f.current.inputs[0].value = 9; assert.throws(f.assess, /changes type/);
});
test('unrelated successful cleanup cannot discharge a fixture, but bound absence verification can', t => {
  const cleanupOp = operation({id: 'cleanup'}), f = fixture(t, {operations: [operation({capability: 'apiMutations'}), cleanupOp]});
  const fixtureResource = resource(f, 'temporary');
  const cleanup = attempt(f.run, cleanupOp, {identity: {...f.current.identity, operationId: 'cleanup', invocationId: 'cleanup-call', attemptId: 'cleanup-attempt', phase: 'CLEANUP'}, startedAt: 1200, endedAt: 1210});
  f.scenario.attempts.push(cleanup);
  fixtureResource.lifecycle = {action: 'cleanup', status: 'completed', attemptId: 'cleanup-attempt', evidenceIds: [f.evidence(cleanup, 'lifecycle')]};
  assert.throws(f.assess, /same resource/);
  cleanup.inputs = [{...f.current.outputs[0], name: 'absentId'}]; assert.equal(f.assess().status, 'PASS');
  cleanup.effect.certainty = 'uncertain'; assert.throws(f.assess, /same resource/);
});
test('a resource identity cannot come from unrelated later work', t => {
  const laterOp = operation({id: 'later'}), f = fixture(t, {operations: [operation({capability: 'apiMutations'}), laterOp]});
  const fixtureResource = resource(f, 'persistent');
  const later = attempt(f.run, laterOp, {identity: {...f.current.identity, operationId: 'later', invocationId: 'later-call', attemptId: 'later-attempt', phase: 'VERIFY'}, startedAt: 1200, endedAt: 1210});
  later.outputs = [value(later, 'recordId', 'string', 'row-999')]; f.scenario.attempts.push(later);
  fixtureResource.identity = {attemptId: 'later-attempt', name: 'recordId'}; assert.throws(f.assess, /originating attempt/);
});
test('existing-state identity can bind a frozen input without a fabricated output or mandatory before-image', t => {
  const initial = {name: 'existingId', type: 'string', sensitivity: 'public', value: 'row-1', producer: {runId: 'run-1', scenarioId: 'case-1', name: 'existingId'}};
  const restoreOp = operation({id: 'restore'}), f = fixture(t, {operations: [operation({capability: 'apiMutations'}), restoreOp], values: [initial]});
  const fixtureResource = resource(f, 'restore', 'existing'); fixtureResource.identity = {name: 'existingId'};
  f.current.inputs = [{...initial, name: 'targetId'}]; f.current.outputs = []; f.scenario.outputRefs = [];
  const restore = attempt(f.run, restoreOp, {identity: {...f.current.identity, operationId: 'restore', invocationId: 'restore-call', attemptId: 'restore-attempt', phase: 'RESTORE'}, startedAt: 1200, endedAt: 1210, inputs: [{...initial, name: 'restoredId'}]});
  f.scenario.attempts.push(restore); const proof = f.evidence(restore, 'lifecycle');
  fixtureResource.lifecycle = {action: 'restore', status: 'completed', attemptId: 'restore-attempt', evidenceIds: [proof], guard: {kind: 'version', evidenceIds: [proof]}};
  assert.equal(f.assess().status, 'PASS'); assert.equal(Object.hasOwn(fixtureResource, 'beforeStateRef'), false);
  f.current.inputs = []; assert.throws(f.assess, /originating attempt/);
});
test('one bulk cleanup may discharge multiple explicitly recorded resource effects', t => {
  const cleanupOp = operation({id: 'cleanup', capability: 'apiMutations'}), f = fixture(t, {operations: [operation({capability: 'apiMutations'}), cleanupOp]});
  const first = resource(f, 'temporary'), second = structuredClone(first); second.id = 'fixture-2'; second.identity.name = 'secondId';
  f.scenario.resources.push(second); f.current.effect.resourceIds.push(second.id); f.current.outputs.push(value(f.current, 'secondId', 'string', 'row-2'));
  const cleanup = attempt(f.run, cleanupOp, {identity: {...f.current.identity, operationId: 'cleanup', invocationId: 'cleanup-call', attemptId: 'cleanup-attempt', phase: 'CLEANUP'}, startedAt: 1200, endedAt: 1210, effect: {certainty: 'confirmed', resourceIds: ['fixture-1', 'fixture-2']}});
  f.scenario.attempts.push(cleanup); const proof = f.evidence(cleanup, 'lifecycle');
  for (const item of [first, second]) item.lifecycle = {action: 'cleanup', status: 'completed', attemptId: 'cleanup-attempt', evidenceIds: [proof]};
  assert.equal(f.assess().status, 'PASS');
});
test('an evidence alias cannot expose protected files elsewhere inside the same run', t => {
  const f = fixture(t), protectedRoot = join(f.roots.runRoot, 'protected'), alias = join(f.roots.runRoot, 'evidence', 'alias');
  mkdirSync(protectedRoot); writeFileSync(join(protectedRoot, 'state.txt'), 'Synthetic protected before-state');
  symlinkSync(protectedRoot, alias, process.platform === 'win32' ? 'junction' : 'dir');
  t.after(() => { try { unlinkSync(alias); } catch (error) { if (error.code !== 'ENOENT') throw error; } });
  assert.throws(() => registerEvidence(f.run, f.roots, {id: 'alias-proof', identity: f.current.identity, kind: 'observation', path: 'evidence/alias/state.txt', sanitized: true}), /Evidence is missing/);
});
test('the evidence directory itself cannot redirect to protected storage even with unchanged bytes', t => {
  const f = fixture(t), evidenceRoot = join(f.roots.runRoot, 'evidence'), protectedRoot = join(f.roots.runRoot, 'protected');
  renameSync(evidenceRoot, protectedRoot); symlinkSync(protectedRoot, evidenceRoot, process.platform === 'win32' ? 'junction' : 'dir');
  t.after(() => { try { unlinkSync(evidenceRoot); } catch (error) { if (error.code !== 'ENOENT') throw error; } });
  assert.throws(f.assess, /Evidence is missing/);
});
test('recovery rejects unsafe earlier transitions and verifies the actual earlier reconciliation artifact', t => {
  const f = fixture(t, {limits: {maxAttempts: 3}}), second = retry(f);
  f.current.effect.certainty = 'uncertain'; second.outcome = 'INFRASTRUCTURE_FAILURE'; second.failureClass = 'TRANSPORT'; second.outputs = [];
  second.assertions = [{id: 'visible', status: 'NOT_EVALUATED', reliable: false, evidenceIds: []}];
  assert.equal(decideRecovery(f.run, [f.current, second], {now: 1300}).reason, 'UNSAFE_REPLAY_HISTORY');
  const proof = f.evidence(f.current, 'reconciliation'); f.current.reconciliation = {kind: 'confirmed-no-effect', evidenceIds: [proof]};
  assert.throws(() => decideRecovery(f.run, [f.current, second], {now: 1300, evidence: f.report.evidence}), /roots/);
  assert.equal(decideRecovery(f.run, [f.current, second], {now: 1300, evidence: f.report.evidence, roots: f.roots}).action, 'RETRY');
  writeFileSync(join(f.roots.runRoot, f.report.evidence.find(record => record.id === proof).path), 'Changed synthetic proof');
  assert.throws(() => decideRecovery(f.run, [f.current, second], {now: 1300, evidence: f.report.evidence, roots: f.roots}), /integrity mismatch/);
});
for (const omitted of [0, 1]) test(`every interrupted attempt records required expectations, including attempt ${omitted + 1}`, t => {
  const f = fixture(t, {limits: {maxAttempts: 3}}), second = retry(f);
  second.outcome = 'INFRASTRUCTURE_FAILURE'; second.failureClass = 'TRANSPORT'; second.outputs = [];
  second.assertions = [{id: 'visible', status: 'NOT_EVALUATED', reliable: false, evidenceIds: []}];
  const third = attempt(f.run, f.run.inputs.operations[0], {identity: {...second.identity, attemptId: 'attempt-3', number: 3}, startedAt: 1300, endedAt: 1310});
  third.assertions = [{id: 'visible', status: 'PASS', reliable: true, evidenceIds: [f.evidence(third)]}]; third.outputs = [value(third)];
  f.scenario.attempts.push(third); f.scenario.outputRefs = [{attemptId: 'attempt-3', name: 'recordId'}];
  assert.equal(f.assess().status, 'PASS'); assert.equal(f.assess().stability, 'recovered');
  f.scenario.attempts[omitted].assertions = []; assert.throws(f.assess, /Each attempt/);
});
test('cleanup recovery requires and preserves the shared phase budget across invocations', t => {
  const cleanupOp = operation({id: 'cleanup'}), f = fixture(t, {operations: [operation(), cleanupOp], limits: {cleanupTimeoutMs: 20}});
  const first = attempt(f.run, cleanupOp, {identity: {...f.current.identity, operationId: 'cleanup', invocationId: 'cleanup-a', attemptId: 'cleanup-a1', phase: 'CLEANUP'}, startedAt: 1200, endedAt: 1205});
  const second = attempt(f.run, cleanupOp, {identity: {...first.identity, invocationId: 'cleanup-b', attemptId: 'cleanup-b1'}, startedAt: 1210, endedAt: 1215, outcome: 'INFRASTRUCTURE_FAILURE', failureClass: 'TRANSPORT'});
  assert.throws(() => decideRecovery(f.run, [second], {now: 1216}), /shared cleanup start/);
  assert.throws(() => decideRecovery(f.run, [second], {now: 1216, cleanupStartedAt: 1211}), /shared cleanup start/);
  assert.equal(decideRecovery(f.run, [second], {now: 1216, cleanupStartedAt: 1200}).action, 'RETRY');
  assert.equal(decideRecovery(f.run, [second], {now: 1221, cleanupStartedAt: 1200}).reason, 'DEADLINE_EXCEEDED');
  const next = attempt(f.run, cleanupOp, {identity: {...second.identity, attemptId: 'cleanup-b2', number: 2}, startedAt: 1216, endedAt: 1219});
  f.scenario.attempts.push(first, second, next); assert.equal(f.assess().status, 'PASS');
  next.startedAt = 1221; next.endedAt = 1222; assert.throws(f.assess, /deadline/);
});
for (const missing of [true, false]) test(`pre-action recovery rejects ${missing ? 'missing' : 'unrelated'} required assertion records`, t => {
  const f = fixture(t); retry(f);
  if (missing) f.current.assertions = []; else f.current.assertions[0].id = 'unselected-assertion';
  const expected = missing ? /Each attempt/ : /does not belong/;
  assert.throws(() => attemptRecord(f.run, f.current), expected);
  assert.throws(() => decideRecovery(f.run, [f.current], {now: 1200}), expected);
  assert.throws(f.assess, expected);
});
