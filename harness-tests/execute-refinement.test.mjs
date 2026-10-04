import test from 'node:test';
import assert from 'node:assert/strict';
import {executionFixture} from './fixtures/execute.mjs';
import {readFrozen} from '../scripts/lib/execute/storage.mjs';
import {scopedReadiness} from '../scripts/lib/execute/refinement.mjs';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {writeJson, readBounded, EXECUTION_DOCUMENT, ownedFile} from '../scripts/lib/execute/storage.mjs';

test('S4 S5 V7: freeze reports scoped readiness and resolves expected values from consumer .env', async t => {
  const f = await executionFixture(t); f.apiStep();
  writeFileSync(join(f.projectRoot, '.env'), 'EXECUTE_EXPECTED_STATUS=200\n');
  f.refinement.references.status = {env: 'EXECUTE_EXPECTED_STATUS'};
  f.refinement.scenarios[0].steps[0].expectations[0].conditions[0].expected = {source: 'reference:status'};
  // API checked values retain types; use a text response check for the string environment binding.
  f.refinement.scenarios[0].steps[0].operation.checks[0] = {id: 'status-0', select: {from: 'text', path: []}, equals: '200'};
  const targets = f.read('.harness/targets.json'); targets.browser.ui.users = {unused: {usernameRef: 'env:UNUSED_USER', passwordRef: 'env:UNUSED_PASSWORD'}}; f.put('.harness/targets.json', targets);
  assert.deepEqual(f.freeze().readiness, {ready: true, missing: []});
  assert.equal(readFrozen(f.roots, f.executionId).freeze.referenceValues.status.value, '200');
  const browser = await executionFixture(t, {browser: true}); const configured = browser.read('.harness/targets.json'); configured.browser.ui.users = {tester: {usernameRef: 'env:MISSING_TEST_USER', passwordRef: 'env:MISSING_TEST_PASSWORD'}}; browser.put('.harness/targets.json', configured);
  browser.refinement.scenarios[0].steps[0].login = {user: 'tester'};
  const frozen = browser.freeze(); assert.equal(frozen.readiness.ready, false); assert.deepEqual(frozen.readiness.missing.sort(), ['MISSING_TEST_PASSWORD', 'MISSING_TEST_USER']);
});

test('S4: incomplete service drafts name their missing operation; unused login configuration gives guidance', async t => {
  const f = await executionFixture(t); assert.throws(f.freeze, /s001.*operation|operation.*s001/);
  const browser = await executionFixture(t, {browser: true}), targets = browser.read('.harness/targets.json'); targets.browser.ui.users = {unused: {usernameRef: 'env:UNUSED_USER', passwordRef: 'env:UNUSED_PASSWORD'}}; browser.put('.harness/targets.json', targets);
  const result = browser.freeze(); assert.equal(result.readiness.ready, true); assert.match(result.warnings[0].reason, /add a login binding/);
});

test('S1: aggregate documents allow the explicit node budget and reject serialized bytes and depth overflow', async t => {
  const f = await executionFixture(t), file = ownedFile(f.roots, f.executionId, 'limits.json');
  const many = {values: Array(21000).fill(1)}; assert.throws(() => writeJson(file, many), /structural/); writeJson(file, many, EXECUTION_DOCUMENT); assert.equal(readBounded(file).values.length, 21000);
  assert.throws(() => writeJson(file, {value: 'x'.repeat(50)}, {maximum: 64}), /serialized byte/);
  let nested = {}; for (let i = 0; i < 34; i++) nested = {nested}; assert.throws(() => writeJson(file, nested, EXECUTION_DOCUMENT), /structural/);
});

test('condition keys are distinct while preserving their source expectation', async t => {
  const f = await executionFixture(t, {steps: [{action: 'Read response', expected: 'Status is 200 and value is 1'}]}), step = f.apiStep(), expectation = step.expectations[0];
  expectation.conditions = [{...expectation.conditions[0], text: 'Status is 200', expected: {source: 'source-text', value: 200}}, {...expectation.conditions[0], text: 'and value is 1', expected: {source: 'source-text', value: 1}}];
  step.operation.checks.push({id: 'value', select: {from: 'json', path: ['value']}, equals: 1}); step.checkProvenance.push({check: 'value', key: expectation.key, condition: 2});
  f.freeze(); const frozen = readFrozen(f.roots, f.executionId), contracts = frozen.freeze.scenarios[0].steps[0].contracts;
  assert.notEqual(contracts[0].id, contracts[1].id); assert.equal(contracts[0].key, contracts[1].key); assert.deepEqual(scopedReadiness(f.roots, frozen.freeze), {ready: true, missing: []});
});
test('freeze rejects rewording, unlabeled reads, unsupported ownership and changed receipts', async t => {
  const f = await executionFixture(t); const step = f.apiStep(); step.expectations[0].conditions[0].text = 'Response is good'; assert.throws(f.freeze, /preserve source text/);
  step.expectations[0].conditions[0].text = 'Status is 200'; delete step.readOnlyContract; assert.throws(f.freeze, /read-only contract/);
  step.readOnlyContract = {reason: 'Read fixture'}; step.creates = [{resource: 'r', identityOutput: 'id', intent: 'restore'}]; assert.throws(f.freeze, /Unsupported resource/);
  delete step.creates; f.freeze(); const receipt = f.read(`.harness/runs/${f.executionId}/freeze.json`); receipt.scenarios[0].steps[0].optional = true; f.put(`.harness/runs/${f.executionId}/freeze.json`, receipt); assert.throws(() => readFrozen(f.roots, f.executionId), /receipt changed/);
});

test('freeze enforces M19 upper bounds while accepting shorter execution budgets', async t => {
  const f = await executionFixture(t); f.apiStep();
  for (const [key, value] of [['maxAttempts', 20], ['maxValueBytes', 1024 * 1024], ['cleanupTimeoutMs', 21 * 60 * 1000]]) {
    const previous = f.refinement.limits[key]; f.refinement.limits[key] = value;
    assert.throws(f.freeze, /at most 3 attempts|cleanup exceeds/);
    if (previous === undefined) delete f.refinement.limits[key]; else f.refinement.limits[key] = previous;
  }
  Object.assign(f.refinement.limits, {maxAttempts: 3, maxValueBytes: 256 * 1024}); f.freeze();
  const limits = readFrozen(f.roots, f.executionId).freeze.scenarios[0].limits; assert.equal(limits.timeoutMs, 20000); assert.equal(limits.maxAttempts, 3);
});
