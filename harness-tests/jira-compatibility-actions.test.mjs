import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync, readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {fixture} from './fixtures/execution-core.mjs';
import {runCompatibility} from '../scripts/lib/integrations/compatibility.mjs';
import {createDelivery} from '../scripts/lib/integrations/delivery.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function json(roots, path, value) {const file = join(roots.projectRoot, path); mkdirSync(dirname(file), {recursive: true}); writeFileSync(file, JSON.stringify(value));}
function setup(t, provider = 'none') {
  const {roots} = fixture(t), issues = new Map(), writes = [];
  json(roots, '.harness/integrations.json', {version: 1, defaultProvider: 'jira', jira: {siteUrl: 'https://example.atlassian.net', project: 'DEMO', emailRef: 'JIRA_EMAIL', credentialRef: 'JIRA_TOKEN'}});
  const issue = key => {if (!issues.has(key)) issues.set(key, {id: key.split('-')[1], key, fields: {summary: key, updated: '2026-10-28T12:00:00.000Z', labels: ['keep'], issuelinks: [], project: {id: '1', key: 'DEMO'}, issuetype: {subtask: false}}}); return structuredClone(issues.get(key));};
  const client = {configuration: {siteUrl: 'https://example.atlassian.net', project: 'DEMO', testManagement: {provider}}, projectIdentity: async () => ({id: '1', key: 'DEMO'}), issue: async key => issue(key),
    read: async route => route === 'issueLinkType' ? {issueLinkTypes: [{id: '1', inward: 'relates to', outward: 'relates to'}]} : {fields: {labels: {operations: ['set']}, parent: {required: false, operations: ['set']}}},
    delivery: () => ({receipt: 'fixture.jsonl', identified() {}, verified() {}, finish() {}, write: async (operation, route, body) => {
      writes.push({operation, route, body});
      if (route === 'issueLink') {issues.get(body.inwardIssue.key).fields.issuelinks.push({id: 'link1', type: {id: body.type.id}, outwardIssue: {key: body.outwardIssue.key}}); return;}
      const row = issues.get(route.split('/')[1]); Object.assign(row.fields, body.fields ?? {}); if (body.update?.parent) delete row.fields.parent;
    }})};
  const management = {provider, capabilities: {remoteCases: provider !== 'none', remoteResults: provider !== 'none'}};
  return {roots, client, management, issue, issues, writes, lockOptions: {inventory: async () => [{pid: process.pid, identity: 'fixture-process'}]}, args: ['--project-root', roots.projectRoot]};
}

test('shared Jira tag preview and approved write preserve labels in no-plugin mode', async t => {
  const f = setup(t), args = [...f.args, '--id', 'DEMO-2', '--tag', 'smoke'];
  const preview = await runCompatibility('tag-workitem', args, f); assert.equal(preview.mode, 'dry-run'); assert.equal(f.writes.length, 0);
  await assert.rejects(runCompatibility('tag-workitem', [...args, '--execute', '--approval', '0'.repeat(64)], f), /approval|preview/i);
  const done = await runCompatibility('tag-workitem', [...args, '--execute', '--approval', preview.fingerprint], f);
  assert.equal(done.mode, 'execute'); assert.deepEqual(f.issues.get('DEMO-2').fields.labels, ['keep', 'smoke']);
  assert.equal((await runCompatibility('tag-workitem', [...args, '--execute', '--approval', preview.fingerprint], f)).mode, 'resumed'); assert.equal(f.writes.length, 1);
});

test('shared Jira relink replaces only the selected optional parent with a discovered related link', async t => {
  const f = setup(t); f.issue('DEMO-2'); f.issues.get('DEMO-2').fields.parent = {key: 'DEMO-1'};
  f.issues.get('DEMO-2').fields.issuelinks = [{id: 'keep-link', type: {id: '9'}, outwardIssue: {key: 'DEMO-8'}}];
  const args = [...f.args, '--id', 'DEMO-2', '--story', 'DEMO-1'];
  const preview = await runCompatibility('relink-story', args, f);
  assert.deepEqual(preview.plans[0].requests.at(-1).body, {update: {parent: [{set: {none: true}}]}});
  const done = await runCompatibility('relink-story', [...args, '--execute', '--approval', preview.fingerprint], f);
  assert.equal(done.mode, 'execute'); assert.equal(f.issues.get('DEMO-2').fields.parent, undefined); assert.equal(f.issues.get('DEMO-2').fields.issuelinks.length, 2);
});

test('approved native batch resumes a later undispatched action without repeating the verified first action', async t => {
  const f = setup(t), mutate = f.client.delivery(); let interrupt = true;
  f.client.delivery = (kind, execute, sourceFingerprint) => createDelivery({roots: f.roots, provider: 'Jira', kind, execute, sourceFingerprint, base: f.client.configuration.siteUrl,
    destination: route => f.client.configuration.siteUrl + '/rest/api/3/' + route, send: async (route, options) => {
      if (route === 'issue/DEMO-3' && interrupt) {interrupt = false; throw new Error('Before-dispatch interruption');}
      options.beforeDispatch(); return mutate.write('update-labels', route, options.body);
    }});
  const args = [...f.args, '--ids', 'DEMO-2,DEMO-3', '--tag', 'smoke'], preview = await runCompatibility('tag-workitem', args, f), execute = [...args, '--execute', '--approval', preview.fingerprint];
  assert.equal((await runCompatibility('tag-workitem', execute, f)).mode, 'reconciliation-required');
  assert.equal(f.writes.length, 1);
  await assert.rejects(runCompatibility('tag-workitem', [...f.args, '--id', 'DEMO-2', '--tag', 'different'], f), /prior native batch/);
  assert.equal((await runCompatibility('tag-workitem', execute, f)).mode, 'resumed');
  assert.deepEqual(f.writes.map(row => row.route), ['issue/DEMO-2', 'issue/DEMO-3']);
});

test('native batch never repeats an uncertain missing effect after dispatch', async t => {
  const f = setup(t); let dispatches = 0;
  f.client.delivery = (kind, execute, sourceFingerprint) => createDelivery({roots: f.roots, provider: 'Jira', kind, execute, sourceFingerprint, base: f.client.configuration.siteUrl,
    destination: route => f.client.configuration.siteUrl + '/rest/api/3/' + route, send: async (route, options) => {options.beforeDispatch(); dispatches++; throw new Error('Lost response');}});
  const args = [...f.args, '--id', 'DEMO-2', '--tag', 'smoke'], preview = await runCompatibility('tag-workitem', args, f), execute = [...args, '--execute', '--approval', preview.fingerprint];
  assert.equal((await runCompatibility('tag-workitem', execute, f)).mode, 'reconciliation-required');
  assert.equal((await runCompatibility('tag-workitem', execute, f)).mode, 'reconciliation-required'); assert.equal(dispatches, 1);
});

test('local automation status uses the same two-green gate, records identity, and clear retains history without Jira configuration', async t => {
  const f = setup(t), source = {version: 1, id: 'local-checkout', title: 'Checkout', scenarios: [{id: 'buy', title: 'Buy', steps: [{action: 'Buy', expected: ['Order']}]}]};
  json(f.roots, '.harness/integrations.json', {malformed: true}); json(f.roots, 'source.json', source);
  json(f.roots, 'verify.json', {sourceFingerprint: hash(source), cases: {buy: {status: 'passed', greens: 1}}});
  json(f.roots, 'map.json', {buy: {file: 'tests/Checkout.spec.ts', title: 'Buy'}});
  mkdirSync(join(f.roots.projectRoot, 'tests'), {recursive: true}); writeFileSync(join(f.roots.projectRoot, 'tests/Checkout.spec.ts'), "test('Buy', async () => {});");
  const args = [...f.args, '--source', 'source.json', '--verification', 'verify.json', '--test-map', 'map.json', '--mark-automated'];
  await assert.rejects(runCompatibility('publish-results', args, f), /two scoped green/);
  json(f.roots, 'verify.json', {sourceFingerprint: hash(source), cases: {buy: {status: 'passed', greens: 2}}});
  const preview = await runCompatibility('publish-results', args, f), done = await runCompatibility('publish-results', [...args, '--execute', '--approval', preview.fingerprint], f);
  const marked = JSON.parse(readFileSync(join(f.roots.projectRoot, done.metadata), 'utf8')); assert.equal(marked.cases.buy.automated, true); assert.equal(marked.cases.buy.identity.storage, 'tests/Checkout.spec.ts');
  const clearArgs = [...f.args, '--source', 'source.json', '--verification', 'verify.json', '--mark-automated', '--value', 'Not Automated'];
  const clear = await runCompatibility('publish-results', clearArgs, f); await runCompatibility('publish-results', [...clearArgs, '--execute', '--approval', clear.fingerprint], f);
  const cleared = JSON.parse(readFileSync(join(f.roots.projectRoot, done.metadata), 'utf8')); assert.equal(cleared.cases.buy.automated, false); assert.equal(cleared.cases.buy.identity, null); assert.equal(cleared.history.length, 2); assert.equal(f.writes.length, 0);
});
