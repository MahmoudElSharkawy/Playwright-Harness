import test from 'node:test';
import assert from 'node:assert/strict';
import {deliverNativeResults} from '../scripts/lib/integrations/native-publication.mjs';
import {prepareLegacyRows} from '../scripts/lib/integrations/publication.mjs';

test('shared legacy verifier preserves opaque IDs and two-green/app-defect classifications', () => {
  const manifest = {cases: [{id: 'DEMO-T1'}, {id: 'DEMO-T2'}]}, state = {cases: {'DEMO-T1': {status: 'passed', greens: 2}, 'DEMO-T2': {status: 'failed', classification: 'app-defect'}}};
  assert.deepEqual(prepareLegacyRows(manifest, state).map(({caseId, status, classification}) => ({caseId, status, classification})), [
    {caseId: 'DEMO-T1', status: 'PASS', classification: 'unclassified'}, {caseId: 'DEMO-T2', status: 'FAIL', classification: 'app-defect'}]);
  state.cases['DEMO-T1'].greens = 1; assert.throws(() => prepareLegacyRows(manifest, state), /two scoped green/);
});

test('native publication lifecycle refuses incomplete identities even when a faulty adapter claims verification', async () => {
  const row = {state: 'INTENT', identities: []}, plan = {desired: [{caseId: 'DEMO-T1'}, {caseId: 'DEMO-T2'}]}, records = [];
  const management = {delivery: () => ({receipt: 'receipt.jsonl', verified() {}, finish() {records.push('completed');}}), writeResults: async () => [{caseId: 'DEMO-T1', id: '1'}], verifyResults: async () => []};
  const result = await deliverNativeResults(management, {row, save() {}, plan, approved: 'a'.repeat(64), preview: {mode: 'dry-run'}});
  assert.equal(result.mode, 'reconciliation-required'); assert.equal(row.state, 'UNCERTAIN'); assert.deepEqual(records, []);
});

test('native publication lifecycle reconciles uncertainty without replaying creates', async () => {
  const row = {state: 'UNCERTAIN', identities: [], receipt: 'original.jsonl'}, plan = {desired: [{caseId: 'DEMO-T1'}]}; let writes = 0;
  const management = {writeResults: async () => {writes++;}, reconcileResults: async () => [{caseId: 'DEMO-T1', id: '99'}]};
  const result = await deliverNativeResults(management, {row, save() {}, plan, approved: 'a'.repeat(64), preview: {mode: 'dry-run'}});
  assert.equal(result.mode, 'resumed'); assert.equal(row.state, 'COMPLETED'); assert.equal(writes, 0); assert.deepEqual(row.identities, [{caseId: 'DEMO-T1', id: '99'}]);
});

test('native publication completion rejects an empty approved result scope', async () => {
  await assert.rejects(deliverNativeResults({}, {row: {state: 'COMPLETED', identities: []}, save() {}, plan: {desired: []}, approved: 'a'.repeat(64), preview: {}}), /scope/);
});
