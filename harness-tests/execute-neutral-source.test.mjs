import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareNeutralSource} from '../scripts/lib/execute/source.mjs';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {consumerRoots} from '../scripts/lib/consumer-paths.mjs';
import {executeMain} from '../scripts/execute-test.mjs';
import {readExecution} from '../scripts/lib/execute/storage.mjs';
import {defectFingerprint} from '../scripts/lib/execute/report.mjs';

const input = () => ({version: 1, id: 'checkout', title: 'Checkout', scenarios: [{id: 'checkout-card', title: 'Pay by card', externalReferences: [{system: 'jira', id: 'https://example.atlassian.net/browse/SHOP-42'}], steps: [{action: 'Pay for the order', expected: ['Order is confirmed', 'Payment is recorded']}]}]});

test('neutral execution preserves opaque identities and each ordered expectation', () => {
  const source = prepareNeutralSource(input(), {kind: 'local', path: '.harness/sources/checkout.json', sha256: 'a'.repeat(64)});
  assert.equal(source.scenarios[0].caseId, 'checkout-card');
  assert.equal(source.scenarios[0].id, 'checkout-card-r1');
  assert.deepEqual(source.scenarios[0].steps[0].expected, ['Order is confirmed', 'Payment is recorded']);
  assert.deepEqual(source.scenarios[0].expectations.map(row => row.description), ['Order is confirmed', 'Payment is recorded']);
  assert.deepEqual(source.scenarios[0].externalReferences, input().scenarios[0].externalReferences);
  assert.equal(source.scope.kind, 'local');
  assert.equal(source.scope.sha256, 'a'.repeat(64));
  assert.equal(source.cases[0].sharedIds.length, 0);
  assert.equal(source.cases[0].contentSha256.length, 64);
  assert.equal(source.cases[0].rev, undefined);
});

test('neutral capture rejects incomplete cases and credential literals without inventing expectations', () => {
  const missing = input(); missing.scenarios[0].steps[0].expected = [];
  assert.throws(() => prepareNeutralSource(missing, {kind: 'local', path: 'cases.json'}), /expectation/);
  const secret = input(); secret.scenarios[0].steps[0].action = 'Use api' + '_key="fixture-private-key"';
  assert.throws(() => prepareNeutralSource(secret, {kind: 'local', path: 'cases.json'}), /credential/);
});

test('neutral capture retains provider scope without inventing an Azure revision', () => {
  const scope = {kind: 'jira', siteUrl: 'https://example.atlassian.net', project: 'SHOP', testManagement: 'xray', storyKey: 'SHOP-1'};
  const source = prepareNeutralSource(input(), scope);
  assert.deepEqual(source.scope, scope);
  assert.equal(source.provider, 'jira');
  assert.equal(source.organizationUrl, undefined);
  assert.equal(source.scopeRev, undefined);
  assert.deepEqual(source.sharedSteps, {});
});

test('existing execute prepare accepts local cases without reading integrations or secrets', async t => {
  const root = mkdtempSync(join(tmpdir(), 'harness-neutral-execute-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  mkdirSync(join(root, '.harness'));
  writeFileSync(join(root, '.harness/project.json'), JSON.stringify({version: 1, defaultEnvironment: 'test', environments: {test: {environmentMode: 'test', apiTargets: ['service'], databaseTargets: []}}}));
  writeFileSync(join(root, '.harness/targets.json'), JSON.stringify({api: {service: {baseUrl: 'https://app.example.test'}}, databases: {}}));
  writeFileSync(join(root, '.harness/integrations.json'), 'deliberately invalid and unused');
  writeFileSync(join(root, 'cases.json'), JSON.stringify(input()));
  const roots = consumerRoots(root), result = await executeMain(roots, ['prepare', 'local', 'cases.json']);
  assert.equal(result.status, 'PREPARED');
  const stored = readExecution(roots, result.executionId);
  assert.equal(stored.source.provider, 'local');
  assert.equal(stored.source.scenarios[0].expectations.length, 2);
  assert.equal(stored.source.scope.path, 'cases.json');
});

test('defect identity distinguishes identical keys across Jira sites and local sources', () => {
  const item = {caseId: 'SHOP-42', kind: 'expectation', sourceStep: 1, expectedIndex: 1, conditionIndex: 1, conditionTemplate: 'Ready'};
  const source = {provider: 'jira', scope: {kind: 'jira', siteUrl: 'https://example.atlassian.net', project: 'SHOP'}};
  assert.notEqual(defectFingerprint(source, item), defectFingerprint({...source, scope: {...source.scope, siteUrl: 'https://example-other.atlassian.net'}}, item));
  assert.notEqual(defectFingerprint({...source, scope: {...source.scope, testManagement: 'xray'}}, item), defectFingerprint({...source, scope: {...source.scope, testManagement: 'zephyr-scale'}}, item));
  const local = {provider: 'local', scope: {kind: 'local', path: 'one.json'}};
  assert.notEqual(defectFingerprint(local, item), defectFingerprint({...local, scope: {...local.scope, path: 'two.json'}}, item));
});
