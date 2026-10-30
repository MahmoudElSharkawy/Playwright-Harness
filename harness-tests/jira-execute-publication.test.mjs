import test from 'node:test';
import assert from 'node:assert/strict';
import {executionFixture, executeApi} from './fixtures/execute.mjs';
import {captureJiraExecution} from '../scripts/lib/integrations/jira-source.mjs';
import {createDelivery} from '../scripts/lib/integrations/delivery.mjs';
import {deliverExecution} from '../scripts/lib/execute/delivery.mjs';
import {prepareNeutralSource} from '../scripts/lib/execute/source.mjs';
import {fingerprint} from '../scripts/lib/execution-core/data.mjs';

async function setup(t) {
  const client = {configuration: {siteUrl: 'https://example.atlassian.net', project: 'DEMO', testManagement: {provider: 'zephyr-scale'}}, projectIdentity: async () => ({id: '10', key: 'DEMO', name: 'Demo'})};
  const item = {id: 'DEMO-T42', nativeId: '42', provider: 'zephyr-scale', siteUrl: client.configuration.siteUrl, project: 'DEMO', title: 'Read status', revision: '1', fingerprint: 'a'.repeat(64), steps: [{id: 'step-1', action: 'Read status', expected: 'Status is 200'}]};
  const calls = [], results = [], control = {lose: false};
  const management = {provider: 'zephyr-scale', capabilities: {remoteCases: true, remoteResults: true},
    readCase: async () => item, groupCases: async () => [item],
    prepareResults: async input => ({kind: 'results', provider: 'zephyr-scale', desired: structuredClone(input.results), marker: input.marker, groupId: input.groupId, requests: [{operation: 'create-result', route: 'testexecutions', method: 'POST', body: JSON.parse(JSON.stringify(input))}]}),
    delivery(kind, execute, sourceFingerprint) {return createDelivery({roots: f.roots, provider: 'Zephyr', kind, execute, sourceFingerprint, base: client.configuration.siteUrl, destination: route => route,
      send: async (route, options) => {options.beforeDispatch(); calls.push({route, body: options.body}); const id = {caseId: 'DEMO-T42', id: String(results.length + 1)}; results.push(id); if (control.lose) throw Error('response lost'); return id;},
      identityFor: (_operation, value) => ({externalId: value.id})});},
    async writeResults(plan, delivery, {onIdentity} = {}) {const response = await delivery.write('create-result', 'testexecutions', plan.requests[0].body, {method: 'POST'}); await onIdentity?.(response); return [response];},
    async verifyResults(_plan, identities) {assert.deepEqual(identities, results); return identities;},
    async reconcileResults() {return results;}
  };
  const source = await captureJiraExecution(client, management, {kind: 'suite', id: 'DEMO-R1'}), f = await executionFixture(t, {source}); f.apiStep(); f.freeze(); await executeApi(f);
  const deliver = options => deliverExecution(f.roots, f.executionId, 'publish-results', {group: 'DEMO-R1', statusValues: {PASS: 'Pass'}, ...options}, {client, management, inventory: async () => [{pid: process.pid, identity: '1'}]});
  return {f, item, calls, results, control, deliver};
}
test('Jira publishing uses assessed shared outcomes and exact approval before native writes', async t => {
  const f = await setup(t), preview = await f.deliver({});
  assert.equal(preview.mode, 'dry-run'); assert.equal(f.calls.length, 0); assert.equal(preview.plan.desired[0].caseId, 'DEMO-T42');
  assert.equal(preview.plan.desired[0].outcome, 'PASS'); assert.equal(preview.plan.desired[0].steps[0].outcome, 'PASS');
  await assert.rejects(f.deliver({execute: true, approval: 'yes'}), /approval|confirmation/);
  assert.equal((await f.deliver({execute: true, approval: preview.fingerprint})).mode, 'execute'); assert.equal(f.calls.length, 1);
  assert.equal((await f.deliver({execute: true, approval: preview.fingerprint})).mode, 'resumed'); assert.equal(f.calls.length, 1);
});
test('lost Jira result response reconciles the stored approved plan without another create', async t => {
  const f = await setup(t), preview = await f.deliver({}); f.control.lose = true;
  assert.equal((await f.deliver({execute: true, approval: preview.fingerprint})).mode, 'reconciliation-required');
  assert.equal((await f.deliver({execute: true, approval: preview.fingerprint})).mode, 'resumed'); assert.equal(f.calls.length, 1);
});
test('local execution keeps results local without loading any configured tracker', async t => {
  const source = prepareNeutralSource({version: 1, id: 'local-cases', title: 'Local', scenarios: [{id: 'case-1', title: 'Read', steps: [{action: 'Read status', expected: ['Status is 200']}]}]}, {kind: 'local', path: 'cases.json', sha256: fingerprint('local')});
  const f = await executionFixture(t, {source}); f.apiStep(); f.freeze(); await executeApi(f);
  const result = await deliverExecution(f.roots, f.executionId, 'publish-results', {execute: true}, {inventory: async () => [{pid: process.pid, identity: '1'}]});
  assert.equal(result.mode, 'local'); assert.equal(result.cases[0].status, 'PASS');
});
