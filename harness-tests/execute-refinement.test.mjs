import test from 'node:test';
import assert from 'node:assert/strict';
import {executionFixture} from './fixtures/execute.mjs';
import {readFrozen} from '../scripts/lib/execute/storage.mjs';
import {scopedReadiness} from '../scripts/lib/execute/refinement.mjs';

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
