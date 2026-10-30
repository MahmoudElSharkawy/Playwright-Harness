import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fixture} from './fixtures/execution-core.mjs';
import {updateContext, retrieveContext, readContext, readContextMetadata, searchContext, exportContext} from '../scripts/lib/context/index.mjs';
import {createJiraContextSource} from '../scripts/lib/integrations/jira-context.mjs';

const adf = text => ({version: 1, type: 'doc', content: [{type: 'paragraph', content: [{type: 'text', text}]}]});
const request = jira => ({version: 1, contextId: 'checkout', identity: {project: 'demo'}, scope: {application: 'checkout', environment: 'qa'}, sources: [], jira: {sourceId: 'backlog', ...jira}});
const current = roots => join(roots.projectRoot, '.harness/context/checkout/current.json');
function jiraFixture() {
  const calls = [], project = {id: '10001', key: 'DEMO', name: 'Demo'}, types = [{id: '10002', name: 'Story', statuses: [{id: '1', name: 'Open'}, {id: '2', name: 'Done'}]}];
  const issues = new Map([1, 2].map(n => [`DEMO-${n}`, {id: String(10000 + n), key: `DEMO-${n}`, fields: {project: {...project}, summary: `Checkout story ${n}`, description: adf(`Payment requirement ${n}`), customfield_10000: adf(`Acceptance criterion ${n}`), updated: '2026-10-01T00:00:00.000+0000', issuetype: {id: '10002', name: 'Story'}, status: {id: '1', name: 'Open'}, attachment: n === 1 ? [{id: '4001', filename: 'guide.txt', size: 25}] : [], issuelinks: []}}]));
  const comments = [{id: '5001', body: adf('Discussion payment detail'), created: '2026-10-01T00:00:00Z', updated: '2026-10-01T00:00:00Z'}];
  const client = {configuration: {siteUrl: 'https://example.atlassian.net', project: 'DEMO', emailRef: 'JIRA_EMAIL', credentialRef: 'JIRA_TOKEN', fields: {acceptanceCriteria: 'customfield_10000'}, testManagement: {provider: 'none'}, context: {sources: {backlog: {scope: {jql: 'issuetype = Story'}, policy: {excludeTypes: [], excludeStates: []}}}}},
    async projectIdentity() {calls.push(['identity']); return {...project};},
    async requireIssueProject(issue) {assert.equal(issue.fields.project.id, project.id); assert.equal(issue.fields.project.key, project.key);},
    async issue(key) {calls.push(['issue', key]); if (!issues.has(key)) throw new Error('unavailable'); return structuredClone(issues.get(key));},
    async read(route) {calls.push(['read', route]); if (route === 'project/DEMO/statuses') return structuredClone(types); throw new Error('Unexpected read: ' + route);},
    async search(jql) {calls.push(['search', jql]); return structuredClone([...issues.values()]);},
    async list(route) {calls.push(['list', route]); if (route.includes('/comment')) return structuredClone(comments); if (route.includes('/changelog')) return []; throw new Error('Unexpected list: ' + route);},
    async attachment(id) {calls.push(['attachment', id]); assert.equal(String(id), '4001'); return Buffer.from('Attachment payment detail');}};
  return {client, project, issues, comments, calls, types};
}

test('Jira context keeps exact keys fixed, captures mapped ADF, and uses saved shared search/export with Jira citations', async t => {
  const {roots} = fixture(t), f = jiraFixture();
  const result = await updateContext(roots, request({scope: {issueKeys: ['DEMO-1']}}), {client: f.client});
  assert.equal(result.snapshot.status, 'complete'); assert.equal(result.snapshot.adoProject, undefined);
  assert.deepEqual(result.snapshot.jiraProject, {siteUrl: f.client.configuration.siteUrl, ...f.project});
  assert(!f.calls.some(call => ['search', 'attachment'].includes(call[0])));
  const saved = readContext(roots, 'checkout'), item = saved.sources.find(source => source.kind === 'work-item');
  assert.equal(item.workItemId, 'DEMO-1'); assert.equal(item.provider, 'jira'); assert.match(item.version, /^[a-f0-9]{64}$/);
  assert(item.contributions.some(part => part.text.includes('Acceptance criterion 1')));
  assert.equal(item.availableAttachments[0].attachmentId, '4001');
  const found = searchContext(roots, 'checkout', {workItemId: 'DEMO-1'});
  assert(found.results.length); assert(found.results.every(hit => hit.workItemId === 'DEMO-1' && hit.citation.url === 'https://example.atlassian.net/browse/DEMO-1'));
  const queried = searchContext(roots, 'checkout', {query: 'DEMO-1'});
  assert.equal(queried.results[0].workItemId, 'DEMO-1'); assert.equal(queried.results[0].match, 'exact');
  exportContext(roots, 'checkout', 'context.json'); assert.deepEqual(JSON.parse(readFileSync(join(roots.projectRoot, 'context.json'))).jiraProject, saved.jiraProject);
  f.calls.length = 0; await updateContext(roots, {version: 1, contextId: 'checkout'}, {client: f.client});
  assert(!f.calls.some(call => call[0] === 'search')); assert.deepEqual(readContext(roots, 'checkout').selections.backlog.scope, {issueKeys: ['DEMO-1']});
});

test('saved Jira criteria discover newly matching issues and retain excluded history', async t => {
  const {roots} = fixture(t), f = jiraFixture();
  await updateContext(roots, request({scope: {jql: 'issuetype = Story'}}), {client: f.client});
  const third = structuredClone(f.issues.get('DEMO-2')); third.id = '10003'; third.key = 'DEMO-3'; third.fields.summary = 'New matching story'; f.issues.set(third.key, third);
  f.issues.get('DEMO-1').fields.status = {id: '2', name: 'Done'};
  await updateContext(roots, request({policy: {excludeTypes: [], excludeStates: [{type: 'Story', states: ['Done']}]}}), {client: f.client});
  const saved = readContext(roots, 'checkout');
  assert(saved.sources.some(source => source.workItemId === 'DEMO-3' && source.status === 'verified'));
  assert(saved.sources.some(source => source.workItemId === 'DEMO-1' && source.status === 'excluded'));
  assert.deepEqual(saved.selections.backlog.scope, {jql: 'issuetype = Story'});
  assert.equal(saved.selections.backlog.includedCount, 2);
  assert(readdirSync(join(roots.projectRoot, '.harness/context/checkout/history')).length >= 2);
});

test('Jira discussion changes invalidate context even with an unchanged issue timestamp; attachments require explicit selection', async t => {
  const {roots} = fixture(t), f = jiraFixture(), input = request({scope: {issueKeys: ['DEMO-1']}, includeDiscussion: true, includeHistory: true, attachments: [{id: 'backlog-attachment-DEMO-1-4001', attachmentId: '4001'}]});
  await updateContext(roots, input, {client: f.client, stageAttachments: true});
  const first = readContext(roots, 'checkout'), hash = first.sources.find(source => source.kind === 'work-item').hash;
  assert(first.sources.some(source => source.kind === 'attachment' && source.status === 'verified' && source.localPath));
  assert(f.calls.some(call => call[0] === 'list' && call[1].includes('/changelog')));
  f.comments[0].body = adf('Changed discussion payment detail'); f.comments[0].updated = '2026-10-02T00:00:00Z';
  await updateContext(roots, {version: 1, contextId: 'checkout'}, {client: f.client});
  const refreshed = readContext(roots, 'checkout'); assert.notEqual(refreshed.sources.find(source => source.kind === 'work-item').hash, hash);
  assert(refreshed.facts.some(fact => fact.text.includes('Changed discussion')));
  assert.equal(refreshed.selections.backlog.includeDiscussion, true);
});

test('failed Jira refresh preserves evidence as unverified rather than reporting an empty verified selection', async t => {
  const {roots} = fixture(t), f = jiraFixture(); await updateContext(roots, request({scope: {issueKeys: ['DEMO-1']}}), {client: f.client});
  f.issues.delete('DEMO-1'); const result = await updateContext(roots, {version: 1, contextId: 'checkout'}, {client: f.client});
  assert.equal(result.snapshot.status, 'partial'); assert(result.snapshot.facts.some(fact => fact.text.includes('Payment requirement 1')));
  assert(result.snapshot.sources.every(source => source.status === 'unverified'));
  assert.equal(result.snapshot.selections.backlog.includedCount, 1);
});

test('Jira site/project changes are rejected before any context content read and preserve the snapshot', async t => {
  const {roots} = fixture(t), f = jiraFixture(); await updateContext(roots, request({scope: {issueKeys: ['DEMO-1']}}), {client: f.client}); const before = readFileSync(current(roots));
  f.client.configuration.siteUrl = 'https://example-other.atlassian.net'; f.calls.length = 0;
  await assert.rejects(updateContext(roots, {version: 1, contextId: 'checkout'}, {client: f.client}), /project.*(identity|differs|mismatch)/i);
  assert(!f.calls.some(call => ['issue', 'search', 'list', 'read'].includes(call[0]))); assert.deepEqual(readFileSync(current(roots)), before);
});

test('Jira context metadata and policy repairs use live native issue types and states', async t => {
  const {roots} = fixture(t), f = jiraFixture();
  const metadata = await readContextMetadata(roots, request({}), {client: f.client}); assert.equal(metadata.metadata.types[0].id, '10002'); assert.equal(metadata.metadata.types[0].states[0].id, '1');
  const result = await retrieveContext(roots, request({scope: {jql: 'issuetype = Story'}, policy: {excludeTypes: ['Deleted type'], excludeStates: []}}), {client: f.client});
  assert.equal(result.status, 'POLICY_REPAIR_REQUIRED'); assert.equal(result.saved, false); assert(!f.calls.some(call => call[0] === 'search'));
});

test('Jira context cannot infer an unbounded selection when keys or saved criteria are missing', async () => {
  const f = jiraFixture(); const result = await createJiraContextSource(f.client).retrieve({policy: {excludeTypes: [], excludeStates: []}});
  assert.equal(result.status, 'SELECTION_REQUIRED'); assert(!f.calls.some(call => ['issue', 'search'].includes(call[0])));
});

test('removed Jira attachments withdraw saved support and new unrelated attachment selections cannot be saved', async t => {
  const {roots} = fixture(t), f = jiraFixture(), selected = {id: 'backlog-attachment-DEMO-1-4001', attachmentId: '4001'};
  await updateContext(roots, request({scope: {issueKeys: ['DEMO-1']}, attachments: [selected]}), {client: f.client});
  const before = readFileSync(current(roots));
  await assert.rejects(updateContext(roots, request({attachments: [{id: 'backlog-attachment-DEMO-1-9999', attachmentId: '9999'}]}), {client: f.client}), /selection/i);
  assert.deepEqual(readFileSync(current(roots)), before);
  f.issues.get('DEMO-1').fields.attachment = [];
  await updateContext(roots, {version: 1, contextId: 'checkout'}, {client: f.client});
  assert.equal(searchContext(roots, 'checkout', {sourceId: selected.id}).total, 0);
  assert.equal(readContext(roots, 'checkout').sources.find(source => source.id === selected.id).status, 'out-of-scope');
});

test('incomplete selected discussions and unsupported ADF remain visible gaps with previous evidence preserved', async t => {
  const {roots} = fixture(t), f = jiraFixture(), input = request({scope: {issueKeys: ['DEMO-1']}, includeDiscussion: true});
  await updateContext(roots, input, {client: f.client});
  f.client.list = async () => {throw new Error('permission denied');};
  const result = await updateContext(roots, {version: 1, contextId: 'checkout'}, {client: f.client});
  assert.equal(result.snapshot.status, 'partial');
  assert(result.snapshot.facts.some(fact => fact.text.includes('Discussion payment detail') && fact.status === 'stale'));
  assert(result.snapshot.sources.some(source => source.omissions.some(omission => omission.reason === 'inaccessible-or-incomplete')));
});

test('Jira source changes during capture are unverified and never silently adopted as current', async t => {
  const {roots} = fixture(t), f = jiraFixture(); await updateContext(roots, request({scope: {issueKeys: ['DEMO-1']}}), {client: f.client});
  const issue = f.client.issue; let reads = 0;
  f.client.issue = async key => {const result = await issue(key); if (++reads === 3) result.fields.description = adf('Changed during capture'); return result;};
  const result = await updateContext(roots, {version: 1, contextId: 'checkout'}, {client: f.client});
  assert.equal(result.snapshot.status, 'partial'); assert(result.snapshot.sources.every(source => source.status === 'unverified'));
  assert(!result.snapshot.facts.some(fact => fact.text.includes('Changed during capture')));
});

test('one shared context can preserve independent Azure and Jira collections without identity collisions', async t => {
  const {roots} = fixture(t), f = jiraFixture(), project = {id: '11111111-1111-4111-8111-111111111111', name: 'Demo'}, item = {id: 1, rev: 1, fields: {'System.TeamProject': 'Demo', 'System.WorkItemType': 'Story', 'System.State': 'Open', 'System.Title': 'Azure checkout', 'System.Description': 'Azure payment requirement'}, relations: []};
  const ado = {configuration: {organizationUrl: 'https://dev.azure.com/example-org', project: 'Demo'}, async projectIdentity() {return project;}, async requireWorkItemProject() {},
    async list(route) {return route.includes('/states?') ? [{id: 'open', name: 'Open'}] : [{name: 'Story', referenceName: 'Custom.Story'}];},
    async workItems() {return {value: [structuredClone(item)]};}, async read() {return structuredClone(item);}};
  const input = {...request({scope: {issueKeys: ['DEMO-1']}}), ado: {sourceId: 'azure', scope: {workItemIds: [1]}}};
  await updateContext(roots, input, {clients: {ado, jira: f.client}});
  const saved = readContext(roots, 'checkout'); assert.equal(saved.adoProject.id, project.id); assert.equal(saved.jiraProject.id, f.project.id);
  assert(saved.sources.some(source => source.workItemId === 1)); assert(saved.sources.some(source => source.workItemId === 'DEMO-1'));
  await updateContext(roots, {version: 1, contextId: 'checkout'}, {clients: {ado, jira: f.client}});
  assert.equal(readContext(roots, 'checkout').sources.filter(source => source.kind === 'work-item').length, 2);
  assert(searchContext(roots, 'checkout', {workItemId: 1}).results.every(hit => hit.citation.url.startsWith('https://dev.azure.com/example-org/')));
  assert(searchContext(roots, 'checkout', {workItemId: 'DEMO-1'}).results.every(hit => hit.citation.url.startsWith('https://example.atlassian.net/')));
});
