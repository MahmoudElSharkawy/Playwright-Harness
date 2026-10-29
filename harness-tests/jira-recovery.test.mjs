import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fixture} from './fixtures/execution-core.mjs';
import {createDelivery} from '../scripts/lib/integrations/delivery.mjs';
import {deliverNativeResults} from '../scripts/lib/integrations/native-publication.mjs';

function setup(t) {
  const {roots} = fixture(t), approved = 'a'.repeat(64), remote = [], calls = [], control = {interrupt: true, loseBeforeEffect: false};
  const plan = {kind: 'results', provider: 'zephyr-scale', desired: [{caseId: 'DEMO-T1'}, {caseId: 'DEMO-T2'}], requests: ['DEMO-T1', 'DEMO-T2'].map(caseId => ({operation: 'create-result', channel: 'plugin', route: 'testexecutions', method: 'POST', body: {caseId}}))};
  const path = join(roots.projectRoot, 'result-state.json'); let row = {state: 'INTENT', identities: []};
  const save = () => writeFileSync(path, JSON.stringify(row)); save();
  const management = {
    delivery(kind, execute, sourceFingerprint) {return createDelivery({roots, provider: 'test', kind, execute, sourceFingerprint, base: 'https://example.test/plugin', destination() {}, identityFor: (_operation, value) => ({externalId: value.id}), async send(_route, options) {
      options.beforeDispatch(); calls.push(options.body.caseId);
      if (control.loseBeforeEffect) throw Error('Response lost; effect unknown');
      const result = {caseId: options.body.caseId, id: String(remote.length + 1)}; remote.push(result); return result;
    }});},
    async writeResults(selected, delivery, {onIdentity} = {}) {
      const identities = [];
      for (const request of selected.requests) {
        const value = await delivery.write(request.operation, 'plugin/' + request.route, request.body, {method: request.method});
        await onIdentity?.(value); identities.push(value);
        if (control.interrupt) {control.interrupt = false; throw Error('Local interruption before the next request');}
      }
      return identities;
    },
    async verifyResults(selected, identities) {assert.equal(identities.length, selected.desired.length); for (const item of identities) assert(remote.some(row => row.id === item.id && row.caseId === item.caseId)); return identities;},
    async findResults() {return structuredClone(remote);},
    async reconcileResults(selected) {return this.verifyResults(selected, structuredClone(remote));}
  };
  return {control, calls, remote, async run() {row = JSON.parse(readFileSync(path)); return deliverNativeResults(management, {roots, row, save, plan, approved, preview: {fingerprint: approved}});}};
}

test('fresh result invocation resumes only the request never dispatched after a verified first result', async t => {
  const f = setup(t);
  assert.equal((await f.run()).mode, 'reconciliation-required'); assert.deepEqual(f.calls, ['DEMO-T1']);
  assert.equal((await f.run()).mode, 'resumed'); assert.deepEqual(f.calls, ['DEMO-T1', 'DEMO-T2']);
  assert.equal((await f.run()).mode, 'resumed'); assert.equal(f.calls.length, 2);
});

test('missing result after uncertain dispatch cannot be recreated by a fresh invocation', async t => {
  const f = setup(t); f.control.loseBeforeEffect = true;
  assert.equal((await f.run()).mode, 'reconciliation-required'); assert.equal(f.remote.length, 0);
  f.control.loseBeforeEffect = false;
  assert.equal((await f.run()).mode, 'reconciliation-required'); assert.deepEqual(f.calls, ['DEMO-T1']);
});
