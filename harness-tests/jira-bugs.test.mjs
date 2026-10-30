import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fixture} from './fixtures/execution-core.mjs';
import {prepareBugReport, previewBugReport, approveBugReport, fileBugReport, editBugReport} from '../scripts/lib/bug-report/index.mjs';
import {createJiraClient} from '../scripts/lib/integrations/jira-client.mjs';
import {fingerprint} from '../scripts/lib/execution-core/data.mjs';
import {jiraStoryRevision} from '../scripts/lib/integrations/jira-requirements.mjs';
import {captureJiraExecution} from '../scripts/lib/integrations/jira-source.mjs';
import {executionFixture, executeApi} from './fixtures/execute.mjs';
import {adoFixture} from './fixtures/ado.mjs';
import {createAdoClient} from '../scripts/lib/integrations/ado-client.mjs';
import {deliverExecution} from '../scripts/lib/execute/delivery.mjs';

const intake = () => ({version: 1, description: 'Checkout returns an error', source: {content: 'Checkout must accept the selected card', expected: 'Payment accepted'}, draft: {title: 'Checkout returns an error', description: 'Checkout fails for the selected card', prerequisites: ['A valid card'], steps: ['Submit checkout'], expected: 'Payment accepted', actual: 'Error shown', fields: {}}, evidence: []});
function jiraFixture(roots) {
  const writes = [], issues = new Map(), attachments = new Map(), project = {id: '10001', key: 'DEMO', name: 'Demo'};
  const fields = [{fieldId: 'project', name: 'Project', required: true, operations: ['set'], schema: {type: 'project'}}, {fieldId: 'issuetype', name: 'Issue type', required: true, operations: ['set'], schema: {type: 'issuetype'}}, {fieldId: 'summary', name: 'Summary', required: true, operations: ['set'], schema: {type: 'string'}}, {fieldId: 'description', name: 'Description', operations: ['set'], schema: {type: 'string', system: 'description'}}, {fieldId: 'labels', name: 'Labels', operations: ['set'], schema: {type: 'array', items: 'string'}}];
  const state = {loseCreate: false, loseUpload: false, loseLink: false, changeReadback: false};
  const config = {siteUrl: 'https://example.atlassian.net', project: 'DEMO', emailRef: 'JIRA_EMAIL', credentialRef: 'JIRA_TOKEN'};
  const response = value => new Response(JSON.stringify(value));
  async function fetchImpl(url, options) {
    const route = url.split('/rest/api/3/')[1].split('?')[0], method = options.method ?? 'GET';
    if (route === 'myself') return response({accountId: 'account-1', active: true});
    if (route === 'project/DEMO') return response(project);
    if (route === 'issue/createmeta/DEMO/issuetypes') return response({startAt: 0, total: 1, issueTypes: [{id: '10002', name: 'Bug'}]});
    if (route === 'issue/createmeta/DEMO/issuetypes/10002') return response({startAt: 0, total: fields.length, fields});
    if (route === 'mypermissions') return response({permissions: {CREATE_ISSUES: {havePermission: true}, ADD_COMMENTS: {havePermission: true}, CREATE_ATTACHMENTS: {havePermission: true}, LINK_ISSUES: {havePermission: true}}});
    if (route === 'issueLinkType') return response({issueLinkTypes: [{id: '10000', name: 'Relates', inward: 'relates to', outward: 'relates to'}]});
    if (route === 'search/jql') {const tag = JSON.parse(options.body).jql.match(/labels\s*=\s*"([^"]+)"/)?.[1]; return response({isLast: true, issues: [...issues.values()].filter(item => item.fields.labels?.includes(tag))});}
    if (method === 'GET' && /^issue\/DEMO-\d+$/.test(route)) {
      const item = structuredClone(issues.get(route.split('/')[1])); if (!item) return new Response('{}', {status: 404});
      if (state.changeReadback) item.fields.summary = 'Server transformed the title'; return response(item);
    }
    if (route === 'issue' && method === 'POST') {
      const body = JSON.parse(options.body), key = `DEMO-${issues.size + 10}`, id = String(20000 + issues.size);
      writes.push({method, route, body}); issues.set(key, {id, key, fields: {...body.fields, project: {...project}, status: {id: '1', name: 'Open', statusCategory: {key: 'new'}}, updated: '2026-10-01T00:00:00Z', attachment: [], issuelinks: []}});
      if (state.loseCreate) {state.loseCreate = false; throw new Error('Lost response');} return response({id, key});
    }
    if (route === 'issueLink' && method === 'POST') {
      const body = JSON.parse(options.body), from = issues.get(body.inwardIssue.key), to = issues.get(body.outwardIssue.key), type = {id: body.type.id, name: 'Relates'}, linkId = '80001';
      from.fields.issuelinks ??= []; to.fields.issuelinks ??= [];
      from.fields.issuelinks.push({id: linkId, type, outwardIssue: {id: to.id, key: to.key}}); to.fields.issuelinks.push({id: linkId, type, inwardIssue: {id: from.id, key: from.key}});
      to.fields.updated = '2026-10-02T00:00:00Z'; writes.push({method, route, body});
      if (state.loseLink) {state.loseLink = false; throw new Error('Lost link response');} return new Response(null, {status: 204});
    }
    if (route.endsWith('/attachments') && method === 'POST') {
      assert.equal(options.headers['X-Atlassian-Token'], 'no-check');
      const bytes = Buffer.from(options.body), boundary = options.headers['Content-Type'].split('boundary=')[1], headerEnd = bytes.indexOf('\r\n\r\n'), filename = bytes.subarray(0, headerEnd).toString().match(/filename="([^"]+)"/)[1];
      const content = bytes.subarray(headerEnd + 4, bytes.length - Buffer.byteLength(`\r\n--${boundary}--\r\n`)), id = String(30000 + attachments.size);
      attachments.set(id, content); const value = {id, filename, size: content.length}; issues.get(route.split('/')[1]).fields.attachment.push(value); writes.push({method, route, filename});
      if (state.loseUpload) {state.loseUpload = false; throw new Error('Lost upload response');} return response([value]);
    }
    if (route.startsWith('attachment/content/')) return new Response(attachments.get(route.split('/').at(-1)));
    throw new Error('Unexpected route: ' + method + ' ' + route);
  }
  return {writes, issues, attachments, fields, state, config, client: () => createJiraClient({configuration: config, roots, resolveEmail: () => 'test@example.test', resolveCredential: () => 'test-reference-value', fetchImpl})};
}
const dependencies = f => ({client: f.client(), inventory: async () => [{pid: process.pid, identity: '1'}]});

test('Jira bugs use the shared reviewed preview and filing journal with native ADF and opaque identity', async t => {
  const {roots} = fixture(t), f = jiraFixture(roots), input = intake(); input.source.externalReferences = [{system: 'zephyr-scale', id: 'https://example.atlassian.net/projects/DEMO?selectedItem=com.kanoah.test-manager__main-project-page#!/testCase/DEMO-T2'}]; prepareBugReport(roots, 'jira-basic', input);
  const preview = await previewBugReport(roots, 'jira-basic', dependencies(f)); assert.equal(preview.ready, true, JSON.stringify(preview.problems));
  assert.equal(preview.destination.siteUrl, f.config.siteUrl); assert.equal(preview.bugs[0].fields.description.type, 'doc'); assert.equal(f.writes.length, 0);
  assert(preview.bugs[0].fields.description.content.flatMap(row => row.content).some(node => node.marks?.[0]?.attrs.href === input.source.externalReferences[0].id));
  approveBugReport(roots, 'jira-basic', preview.hash); const filed = await fileBugReport(roots, 'jira-basic', preview.hash, dependencies(f));
  assert.equal(filed.bugs[0].state, 'COMPLETED'); assert.equal(filed.bugs[0].id, 'DEMO-10');
  await fileBugReport(roots, 'jira-basic', preview.hash, dependencies(f)); assert.equal(f.writes.filter(row => row.route === 'issue').length, 1);
});

test('direct execution keeps Azure source freshness separate from a selected Jira bug destination', async t => {
  const ado = await adoFixture(t), ex = await executionFixture(t, {organizationUrl: ado.config.organizationUrl, handler: (_, response) => {response.writeHead(500); response.end('{}');}}), f = jiraFixture(ex.roots);
  ex.apiStep(); ex.freeze(); await executeApi(ex);
  const sourceClient = createAdoClient({configuration: ado.config, roots: ex.roots, resolveCredential: () => ado.credential, fetchImpl: ado.fetchImpl});
  const result = await deliverExecution(ex.roots, ex.executionId, 'file-bugs', {provider: 'jira', execute: true}, {...dependencies(f), sourceClient});
  assert.equal(result.bugs[0].state, 'COMPLETED'); assert.equal(f.writes.filter(row => row.route === 'issue').length, 1);
});

test('direct Jira execution resumes an owned story link without duplicating bugs or treating its backlink as a source edit', async t => {
  const story = {id: '10001', key: 'DEMO-1', fields: {project: {id: '10001', key: 'DEMO'}, summary: 'Accepted response', updated: '2026-10-01T00:00:00Z', issuelinks: []}};
  const configuration = {siteUrl: 'https://example.atlassian.net', project: 'DEMO'}, sourceClient = {configuration, projectIdentity: async () => story.fields.project, issue: async () => structuredClone(story)};
  const tc = {id: 'DEMO-2', nativeId: '10002', provider: 'xray', ...configuration, revision: '2026-10-01T00:00:00Z', fingerprint: 'a'.repeat(64), title: 'Read response', steps: [{id: 'step-a', action: 'Read status', data: '', expected: 'Status is 200'}], externalReferences: [{system: 'xray', id: 'https://example.atlassian.net/browse/DEMO-2'}]};
  const management = {provider: 'xray', capabilities: {remoteCases: true}, storyCases: async () => [tc], readCase: async () => tc};
  const source = await captureJiraExecution(sourceClient, management, {kind: 'story', id: 'DEMO-1'});
  const ex = await executionFixture(t, {source, handler: (_, response) => {response.writeHead(500); response.end('{}');}}), f = jiraFixture(ex.roots);
  f.issues.set(story.key, structuredClone(story)); f.config.bugs = {storyLink: true, linkType: '10000'}; f.state.loseLink = true;
  ex.apiStep(); ex.freeze(); await executeApi(ex);
  const deps = {...dependencies(f), management};
  await assert.rejects(deliverExecution(ex.roots, ex.executionId, 'file-bugs', {execute: true}, deps), /uncertain|lost|Jira/i);
  const recovered = await deliverExecution(ex.roots, ex.executionId, 'file-bugs', {execute: true}, deps);
  assert.equal(recovered.bugs[0].state, 'COMPLETED'); assert.equal(f.writes.filter(row => row.route === 'issue').length, 1); assert.equal(f.writes.filter(row => row.route === 'issueLink').length, 1);
  f.issues.get(story.key).fields.summary = 'Changed acceptance';
  await assert.rejects(deliverExecution(ex.roots, ex.executionId, 'file-bugs', {}, deps), /source changed/);
});

test('Jira required custom values use native metadata and stay in the ordinary editable draft', async t => {
  const {roots} = fixture(t), f = jiraFixture(roots); f.fields.push({fieldId: 'customfield_12345', name: 'Affected component', required: true, operations: ['set'], schema: {type: 'option'}, allowedValues: [{id: '100', value: 'Portal'}, {id: '101', value: 'API'}]});
  const state = prepareBugReport(roots, 'jira-custom', intake()); let preview = await previewBugReport(roots, 'jira-custom', dependencies(f));
  assert.equal(preview.ready, false); assert(preview.fieldReview.some(field => field.field === 'customfield_12345' && field.required));
  editBugReport(roots, 'jira-custom', {head: state.head, draft: {fields: {customfield_12345: {id: '101'}}}});
  preview = await previewBugReport(roots, 'jira-custom', dependencies(f)); assert.equal(preview.ready, true, JSON.stringify(preview.problems));
  approveBugReport(roots, 'jira-custom', preview.hash); await fileBugReport(roots, 'jira-custom', preview.hash, dependencies(f));
  assert.equal(f.issues.get('DEMO-10').fields.customfield_12345.id, '101');
});

test('lost Jira create acknowledgements reconcile the full remote filing marker without another create', async t => {
  const {roots} = fixture(t), f = jiraFixture(roots); prepareBugReport(roots, 'jira-recovery', intake());
  const preview = await previewBugReport(roots, 'jira-recovery', dependencies(f)); assert(preview.ready); approveBugReport(roots, 'jira-recovery', preview.hash); f.state.loseCreate = true;
  await assert.rejects(fileBugReport(roots, 'jira-recovery', preview.hash, dependencies(f)), /incomplete/);
  const result = await fileBugReport(roots, 'jira-recovery', preview.hash, dependencies(f)); assert.equal(result.bugs[0].state, 'COMPLETED'); assert.equal(f.writes.filter(row => row.route === 'issue').length, 1);
  assert(f.issues.get('DEMO-10').fields.labels.some(label => /^harness-filing-[a-f0-9-]{36}$/.test(label)));
});

test('Jira schema or readback changes cannot be marked as a completed approved delivery', async t => {
  const {roots} = fixture(t), f = jiraFixture(roots); prepareBugReport(roots, 'jira-schema', intake()); const preview = await previewBugReport(roots, 'jira-schema', dependencies(f)); assert(preview.ready); approveBugReport(roots, 'jira-schema', preview.hash);
  f.fields[2].name = 'Renamed title'; await assert.rejects(fileBugReport(roots, 'jira-schema', preview.hash, dependencies(f)), /preview changed/); assert.equal(f.writes.length, 0);
  f.fields[2].name = 'Summary'; f.state.changeReadback = true; await assert.rejects(fileBugReport(roots, 'jira-schema', preview.hash, dependencies(f)), /approved value at readback/); assert.equal(f.issues.size, 1);
});

test('lost Jira attachment acknowledgements reconcile issue-owned filename and exact bytes without duplicate uploads', async t => {
  const {roots} = fixture(t), f = jiraFixture(roots), raw = intake(); writeFileSync(join(roots.projectRoot, 'evidence.txt'), 'Sanitized checkout result: error');
  raw.evidence = [{path: 'evidence.txt', kind: 'log', origin: 'user', sanitized: true, verification: {privacy: true, relevance: true}, context: 'Selected checkout response'}];
  prepareBugReport(roots, 'jira-evidence', raw); const preview = await previewBugReport(roots, 'jira-evidence', dependencies(f)); assert(preview.ready); approveBugReport(roots, 'jira-evidence', preview.hash); f.state.loseUpload = true;
  const pending = await fileBugReport(roots, 'jira-evidence', preview.hash, dependencies(f)); assert.equal(pending.bugs[0].state, 'ATTACHMENTS_PENDING');
  const result = await fileBugReport(roots, 'jira-evidence', preview.hash, dependencies(f)); assert.equal(result.bugs[0].state, 'COMPLETED'); assert.equal(f.attachments.size, 1);
});

test('Jira selected story freshness is bound to site, project and a captured content fingerprint', async t => {
  const {roots} = fixture(t), f = jiraFixture(roots), raw = intake(), fields = {project: {id: '10001', key: 'DEMO'}, summary: 'Story', description: 'Expected behavior', updated: '2026-10-01T00:00:00Z'};
  f.issues.set('DEMO-1', {id: '10000', key: 'DEMO-1', fields}); raw.source = {...raw.source, provider: 'jira', siteUrl: f.config.siteUrl, project: 'DEMO', storyId: 'DEMO-1', revision: jiraStoryRevision(f.client(), {fields}).revision};
  prepareBugReport(roots, 'jira-source', raw); const preview = await previewBugReport(roots, 'jira-source', dependencies(f)); assert(preview.ready); approveBugReport(roots, 'jira-source', preview.hash);
  fields.description = 'Changed behavior'; await assert.rejects(fileBugReport(roots, 'jira-source', preview.hash, dependencies(f)), /story.*changed/i); assert.equal(f.writes.length, 0);
});

test('owned Jira story links recover a lost response without invalidating their original source approval', async t => {
  const {roots} = fixture(t), f = jiraFixture(roots), raw = intake(), fields = {project: {id: '10001', key: 'DEMO'}, summary: 'Story', description: 'Expected behavior', updated: '2026-10-01T00:00:00Z', issuelinks: []};
  f.config.bugs = {storyLink: true, linkType: 'Relates'}; f.issues.set('DEMO-1', {id: '10000', key: 'DEMO-1', fields});
  raw.source = {...raw.source, provider: 'jira', siteUrl: f.config.siteUrl, project: 'DEMO', storyId: 'DEMO-1', revision: jiraStoryRevision(f.client(), {fields}).revision};
  prepareBugReport(roots, 'jira-link', raw); const preview = await previewBugReport(roots, 'jira-link', dependencies(f)); assert(preview.ready, JSON.stringify(preview.problems)); approveBugReport(roots, 'jira-link', preview.hash); f.state.loseLink = true;
  await assert.rejects(fileBugReport(roots, 'jira-link', preview.hash, dependencies(f)), /incomplete/);
  const result = await fileBugReport(roots, 'jira-link', preview.hash, dependencies(f)); assert.equal(result.bugs[0].state, 'COMPLETED'); assert.equal(f.writes.filter(row => row.route === 'issueLink').length, 1);
  fields.description = 'Unrelated source change'; await assert.rejects(fileBugReport(roots, 'jira-link', preview.hash, dependencies(f)), /story.*changed/i);
});

test('a bug destination can be Jira while its captured Azure story is verified through its source adapter', async t => {
  const {roots} = fixture(t), f = jiraFixture(roots), raw = intake(); raw.source = {...raw.source, provider: 'ado', storyId: 123, revision: 7};
  let reads = 0; const sourceClient = {configuration: {organizationUrl: 'https://dev.azure.com/example-org', project: 'Source'}, async read() {reads++; return {id: 123, rev: 7};}, async requireWorkItemProject() {}};
  prepareBugReport(roots, 'jira-mixed', raw); const preview = await previewBugReport(roots, 'jira-mixed', {...dependencies(f), sourceClient}); assert(preview.ready, JSON.stringify(preview.problems)); assert.equal(reads, 1); assert.equal(preview.destination.provider, 'jira');
});
