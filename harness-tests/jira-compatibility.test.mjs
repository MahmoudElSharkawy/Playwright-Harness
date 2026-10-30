import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync, readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {fixture} from './fixtures/execution-core.mjs';
import {runCompatibility, jiraFetchScope} from '../scripts/lib/integrations/compatibility.mjs';
import {createHash} from 'node:crypto';
import {createDelivery} from '../scripts/lib/integrations/delivery.mjs';

function nativeFixture(t, provider = 'xray') {
  const {roots} = fixture(t), siteUrl = 'https://example.atlassian.net';
  mkdirSync(join(roots.projectRoot, '.harness'), {recursive: true});
  writeFileSync(join(roots.projectRoot, '.harness/integrations.json'), JSON.stringify({version: 1, defaultProvider: 'jira', jira: {siteUrl, project: 'DEMO', emailRef: 'JIRA_EMAIL', credentialRef: 'JIRA_TOKEN'}}));
  const client = {configuration: {siteUrl, project: 'DEMO', testManagement: {provider}}, projectIdentity: async () => ({id: '1', key: 'DEMO', name: 'Demo'}), issue: async key => ({id: '2', key, fields: {summary: 'Shop', updated: '2026-10-28T12:00:00.000Z'}})};
  const item = {provider, siteUrl, project: 'DEMO', id: provider === 'xray' ? 'DEMO-2' : 'DEMO-T2', nativeId: '2', revision: 'v1', fingerprint: 'a'.repeat(64), title: 'Buy', labels: ['smoke'],
    steps: [{id: 'step-1', action: 'Buy item', data: 'quantity 1', expected: 'Order appears'}], preconditions: [{id: 'setup', text: 'Signed in'}], externalReferences: [{system: provider, id: `${siteUrl}::${provider}::case-2`}]};
  const selections = [], management = {provider, capabilities: {remoteCases: provider !== 'none', remoteResults: provider !== 'none'},
    storyCases: async id => {selections.push({kind: 'story', id}); return [structuredClone(item)];},
    groupCases: async selection => {selections.push(selection); return [structuredClone(item)];}, readCase: async () => structuredClone(item)};
  return {roots, client, management, item, selections, lockOptions: {inventory: async () => [{pid: process.pid, identity: 'fixture-process'}]}};
}

for (const provider of ['xray', 'zephyr-scale']) test(`shared fetch-story selects ${provider}, retains neutral IDs and preserves refinement`, async t => {
  const f = nativeFixture(t, provider), args = ['--project-root', f.roots.projectRoot, '--story', 'DEMO-1', '--source-out', '.harness/sources/story.json'];
  const result = await runCompatibility('fetch-story', args, f), manifestPath = result.files.find(file => file.endsWith('_suite.json'));
  const manifest = JSON.parse(readFileSync(join(f.roots.projectRoot, manifestPath), 'utf8'));
  assert.equal(manifest.provider, 'jira'); assert.equal(manifest.testManagement, provider); assert.equal(manifest.siteUrl, f.client.configuration.siteUrl);
  assert.equal(manifest.cases[0].id, f.item.id); assert.equal(Object.hasOwn(manifest, 'orgUrl'), false);
  assert.equal(manifest.story.id, 'DEMO-1'); assert.match(manifest.story.version.revision, /^[a-f0-9]{64}$/);
  assert.equal(createHash('sha256').update(JSON.stringify(jiraFetchScope(manifest))).digest('hex'), manifest.sourceFingerprint);
  const specPath = result.files.find(file => file.endsWith('.md')), spec = readFileSync(join(f.roots.projectRoot, specPath), 'utf8');
  assert.ok(spec.includes('Signed in')); assert.ok(spec.includes('quantity 1')); assert.ok(!spec.includes('Azure DevOps'));
  const neutral = JSON.parse(readFileSync(join(f.roots.projectRoot, '.harness/sources/story.json'), 'utf8'));
  assert.deepEqual(neutral.scenarios[0].externalReferences, f.item.externalReferences);
  writeFileSync(join(f.roots.projectRoot, specPath), spec + '\n## Refinement log\nReviewed refinement');
  await runCompatibility('fetch-story', args, f);
  assert.ok(readFileSync(join(f.roots.projectRoot, specPath), 'utf8').includes('Reviewed refinement'));
});

test('shared suite selection maps to native test-set or cycle and preview creates no files', async t => {
  for (const [provider, expected] of [['xray', 'test-set'], ['zephyr-scale', 'cycle']]) {
    const f = nativeFixture(t, provider), id = provider === 'xray' ? 'DEMO-10' : 'DEMO-R10';
    const result = await runCompatibility('fetch-suite', ['--project-root', f.roots.projectRoot, '--suite', id, '--dry-run'], f);
    assert.deepEqual(f.selections, [{kind: expected, id}]); assert.equal(result.mode, 'dry-run');
    assert.equal(existsSync(join(f.roots.projectRoot, result.files[0])), false);
  }
});

test('Jira without a plugin uses explicit local cases and cannot pretend to fetch native test suites', async t => {
  const f = nativeFixture(t, 'none');
  await assert.rejects(runCompatibility('fetch-suite', ['--project-root', f.roots.projectRoot, '--suite', 'DEMO-1'], f), /local case|local source/i);
  assert.deepEqual(f.selections, []);
});

for (const provider of ['xray', 'zephyr-scale']) test(`shared publication selects ${provider}, enforces source freshness, and publishes qualified overall outcomes`, async t => {
  const f = nativeFixture(t, provider), nativeGroup = provider === 'xray' ? 'DEMO-10' : 'DEMO-R10';
  const fetched = await runCompatibility('fetch-suite', ['--project-root', f.roots.projectRoot, '--suite', nativeGroup], f);
  const path = fetched.files.find(file => file.endsWith('_suite.json')), statePath = path.replace('_suite.json', '_verify-state.json');
  writeFileSync(join(f.roots.projectRoot, statePath), JSON.stringify({sourceFingerprint: fetched.sourceFingerprint, cases: {[f.item.id]: {status: 'passed', greens: 2}}}));
  writeFileSync(join(f.roots.projectRoot, 'statuses.json'), JSON.stringify({PASS: 'Passed'}));
  const writes = [], prepares = [];
  f.management.prepareResults = async input => {prepares.push(input); return {kind: 'results', provider, groupId: input.groupId, desired: input.results.map(row => ({caseId: row.caseId})), requests: []};};
  f.management.writeResults = async (plan, delivery, {onIdentity}) => {writes.push(plan); const ids = plan.desired.map(row => ({caseId: row.caseId, id: 'native-result-1'})); for (const item of ids) await onIdentity(item); return ids;};
  f.management.verifyResults = async (plan, ids) => ids;
  f.management.delivery = () => ({receipt: 'fixture.jsonl', verified() {}, finish() {}});
  const args = ['--project-root', f.roots.projectRoot, '--manifest', path, '--group', nativeGroup, '--statuses', 'statuses.json'];
  const preview = await runCompatibility('publish-results', args, f); assert.equal(preview.mode, 'dry-run'); assert.equal(writes.length, 0);
  assert.equal(prepares[0].automated, true); assert.equal(prepares[0].results[0].outcome, 'PASS'); assert.equal(prepares[0].results[0].steps, undefined);
  f.item.fingerprint = 'b'.repeat(64);
  await assert.rejects(runCompatibility('publish-results', [...args, '--execute', '--approval', preview.fingerprint], f), /source case changed/);
  f.item.fingerprint = 'a'.repeat(64);
  const done = await runCompatibility('publish-results', [...args, '--execute', '--approval', preview.fingerprint], f);
  assert.equal(done.mode, 'execute'); assert.equal(writes.length, 1);
  assert.equal((await runCompatibility('publish-results', [...args, '--execute', '--approval', preview.fingerprint], f)).mode, 'resumed'); assert.equal(writes.length, 1);
});

test('native edit compatibility accepts opaque case/revision and refuses stale approval', async t => {
  const f = nativeFixture(t, 'zephyr-scale'), prepared = [];
  f.management.prepareCase = async input => {prepared.push(input); return {id: input.before.id, desired: {title: input.title, steps: input.steps}, requests: []};};
  f.management.delivery = () => ({receipt: 'fixture.jsonl', verified() {}, finish() {}});
  f.management.writeCase = async plan => {f.item.title = plan.desired.title; return f.item.id;};
  f.management.verifyCase = async plan => {assert.equal(f.item.title, plan.desired.title); return f.item;};
  const proposal = {version: 1, cases: [{id: f.item.id, revision: f.item.revision, title: 'Buy two'}]};
  writeFileSync(join(f.roots.projectRoot, 'edit.json'), JSON.stringify(proposal));
  const args = ['--project-root', f.roots.projectRoot, '--input', 'edit.json'], preview = await runCompatibility('edit-cases', args, f);
  assert.deepEqual(prepared[0].steps, f.item.steps);
  const done = await runCompatibility('edit-cases', [...args, '--execute', '--approval', preview.fingerprint], f); assert.equal(done.mode, 'execute'); assert.equal(f.item.title, 'Buy two');
  proposal.cases[0].revision = 'stale'; writeFileSync(join(f.roots.projectRoot, 'edit.json'), JSON.stringify(proposal));
  await assert.rejects(runCompatibility('edit-cases', args, f), /Stale native case revision/);
});

for (const provider of ['xray', 'zephyr-scale']) test(`shared edit-cases routes ${provider} partial updates through exact missing-request recovery`, async t => {
  const f = nativeFixture(t, provider), writes = []; let stop = true, completions = 0;
  f.management.prepareCase = async input => ({id: input.before.id, desired: {title: input.title, steps: input.steps}, requests: [
    {operation: 'update-case', channel: 'plugin', method: 'PUT', route: 'case/' + input.before.id, body: {title: input.title}},
    {operation: 'write-case-steps', channel: 'plugin', method: 'POST', route: 'case/' + input.before.id + '/steps', body: {steps: input.steps}}
  ]});
  f.management.writeCase = async (plan, delivery) => {for (const request of plan.requests) await delivery.write(request.operation, request.channel + '/' + request.route, request.body, {method: request.method});};
  f.management.verifyCase = async plan => {assert.equal(f.item.title, plan.desired.title); assert.deepEqual(f.item.steps, plan.desired.steps); return f.item;};
  f.management.caseCompletion = async plan => {completions++; assert.equal(f.item.title, plan.desired.title); return {complete: false, requests: [plan.requests[1]]};};
  f.management.delivery = (kind, execute, sourceFingerprint) => createDelivery({roots: f.roots, provider, kind, execute, sourceFingerprint, base: f.client.configuration.siteUrl,
    destination: route => 'https://example.test/' + route, send: async (route, options) => {
      if (route.endsWith('/steps') && stop) {stop = false; throw new Error('Interrupted before step dispatch');}
      options.beforeDispatch(); writes.push(route);
      if (route.endsWith('/steps')) f.item.steps = options.body.steps; else f.item.title = options.body.title;
    }});
  const proposal = {version: 1, cases: [{id: f.item.id, revision: f.item.revision, title: 'Buy two', steps: [{action: 'Buy two', expected: 'Two orders', data: 'quantity 2'}]}]};
  writeFileSync(join(f.roots.projectRoot, 'edit.json'), JSON.stringify(proposal));
  const args = ['--project-root', f.roots.projectRoot, '--input', 'edit.json'], preview = await runCompatibility('edit-cases', args, f), execute = [...args, '--execute', '--approval', preview.fingerprint];
  assert.equal((await runCompatibility('edit-cases', execute, f)).mode, 'reconciliation-required'); assert.equal(writes.length, 1);
  assert.equal((await runCompatibility('edit-cases', execute, f)).mode, 'resumed'); assert.equal(completions, 1);
  assert.deepEqual(writes, ['plugin/case/' + f.item.id, 'plugin/case/' + f.item.id + '/steps']);
});
