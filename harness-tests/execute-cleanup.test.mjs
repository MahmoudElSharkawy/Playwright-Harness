import test from 'node:test';
import assert from 'node:assert/strict';
import {executionFixture, executeApi} from './fixtures/execute.mjs';
for (const intent of ['persistent', 'no-obligation', 'temporary']) test(`API ${intent} resource uses the core lifecycle contract`, async t => {
  const f = await executionFixture(t, {steps: intent === 'temporary' ? [{action: 'Create item', expected: 'Status is 200'}, {action: 'Delete item', expected: 'Status is 200'}] : [{action: 'Create item', expected: 'Status is 200'}]});
  const create = f.apiStep(); create.capability = 'mutations'; delete create.readOnlyContract; create.operation.request.method = 'POST'; create.operation.effects = {confirmedStatuses: [200], contractRef: 'fixture-create'}; create.operation.extract = [{name: 'createdId', type: 'string', sensitivity: 'public', select: {from: 'json', path: ['id']}}]; create.creates = [{resource: 'record', identityOutput: 'createdId', intent, ...(intent === 'temporary' ? {cleanupStep: 's002'} : {})}];
  if (intent === 'temporary') {const cleanup = f.apiStep(1); cleanup.capability = 'mutations'; delete cleanup.readOnlyContract; cleanup.phase = 'CLEANUP'; cleanup.operation.request = {method: 'DELETE', path: '/item', query: {id: {$input: 'recordId'}}}; cleanup.operation.effects = {confirmedStatuses: [200], contractRef: 'fixture-delete'}; cleanup.cleanupResource = 'record'; cleanup.inputs = [{name: 'recordId', source: 'output:createdId'}];}
  f.freeze(); const {result} = await executeApi(f), resource = result.scenarios[0].resources[0]; assert.equal(result.status, 'PASS'); assert.equal(resource.ownership, 'harness');
  assert.equal(resource.lifecycle.status, intent === 'temporary' ? 'completed' : 'not-required'); if (intent !== 'temporary') {assert.deepEqual(resource.lifecycle.evidenceIds, []); assert.equal(resource.lifecycle.attemptId, undefined);} else {assert(resource.lifecycle.evidenceIds.length); assert(resource.lifecycle.attemptId);}
});
