import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fixture} from './fixtures/execution-core.mjs';
import {captureRequirements} from '../scripts/lib/requirements/sources.mjs';
import {readJiraRequirements, readJiraStoryComments} from '../scripts/lib/integrations/jira-requirements.mjs';
import {fingerprint} from '../scripts/lib/execution-core/data.mjs';

const adf = value => ({version: 1, type: 'doc', content: [{type: 'paragraph', content: [{type: 'text', text: value}]}]});
function jiraFixture(t) {
  const {roots} = fixture(t), calls = [], item = {id: '101', key: 'DEMO-1', fields: {project: {id: '10', key: 'DEMO'}, updated: '2026-10-29T08:00:00.000+0000', summary: 'Checkout', description: adf('Save a display name.'), customfield_10001: adf('Spaces are accepted.'), attachment: [{id: '500', filename: 'notes.md', content: 'https://untrusted.invalid/never-use'}]}};
  const comments = [{id: '200', updated: '2026-10-29T08:10:00.000+0000', body: adf('Discussion is context, not acceptance.')}];
  const history = [{id: '300', created: '2026-10-28T08:00:00.000+0000', items: [{fieldId: 'description', field: 'Description', fromString: 'Old behavior', toString: 'Save a display name.'}]}];
  const client = {configuration: {siteUrl: 'https://example.atlassian.net', project: 'DEMO', fields: {acceptanceCriteria: 'customfield_10001'}, testManagement: {provider: 'none'}},
    async projectIdentity() {return {id: '10', key: 'DEMO', name: 'Demo'};}, async issue(key) {calls.push(['issue', key]); return structuredClone(item);},
    async list(route) {calls.push(['list', route]); return structuredClone(route.endsWith('/comment') ? comments : history);},
    async attachment(id) {calls.push(['attachment', id]); return Buffer.from('Selected attachment supplies context.');}};
  const request = {version: 1, project: 'synthetic', application: 'checkout', provider: 'jira', storyId: 'DEMO-1', sources: []};
  return {roots, client, item, comments, history, calls, request};
}

test('Jira capture uses shared sanitized parts with native identity and content freshness', async t => {
  const f = jiraFixture(t), source = await captureRequirements(f.roots, f.request, {client: f.client});
  assert.deepEqual(source.origin, {provider: 'jira', siteUrl: 'https://example.atlassian.net', projectId: '10', project: 'DEMO', storyId: 'DEMO-1', testManagement: 'none'});
  assert(source.parts.some(p => p.sourceId === 'jira-story' && p.kind === 'criterion' && p.text === 'Spaces are accepted.'));
  assert(source.parts.some(p => p.sourceId === 'jira-discussion' && p.kind === 'discussion'));
  assert(source.revisions.some(r => r.id === 'jira-story' && r.updated === f.item.fields.updated && /^[a-f0-9]{64}$/.test(r.revision)));
  assert(!JSON.stringify(source).includes('System.Description')); assert(!f.calls.some(([kind]) => kind === 'attachment'));
  f.item.fields.description = adf('Changed content with the same update timestamp.');
  const changed = await captureRequirements(f.roots, f.request, {client: f.client}); assert.notEqual(source.fingerprint, changed.fingerprint);
});

test('Jira attachments default to none and only selected issue-bound numeric IDs are fetched', async t => {
  const f = jiraFixture(t);
  const source = await captureRequirements(f.roots, {...f.request, attachmentIds: ['500']}, {client: f.client});
  assert(source.parts.some(p => p.sourceId === 'jira-attachment-500' && p.text.includes('Selected attachment')));
  assert.deepEqual(f.calls.filter(([kind]) => kind === 'attachment'), [['attachment', '500']]);
  f.calls.length = 0;
  const missing = await captureRequirements(f.roots, {...f.request, attachmentIds: ['999']}, {client: f.client});
  assert(missing.omissions.some(o => o.reason === 'unverified-selected-attachment')); assert(!f.calls.some(([kind]) => kind === 'attachment'));
  await assert.rejects(captureRequirements(f.roots, {...f.request, attachmentIds: ['https://other.invalid/500']}, {client: f.client}), /attachment/);
});

test('discussion, history and unsupported ADF content report omissions without fabricating acceptance', async t => {
  const f = jiraFixture(t); f.item.fields.description.content.push({type: 'mediaSingle', content: []});
  const source = await captureRequirements(f.roots, {...f.request, includeHistory: true}, {client: f.client});
  assert(source.omissions.some(o => o.sourceId === 'jira-story' && o.reason === 'unsupported-adf-node'));
  assert(source.parts.some(p => p.sourceId === 'jira-history' && p.kind === 'discussion' && p.text.includes('Old behavior')));
  f.client.list = async () => {throw new Error('private upstream body');};
  const partial = await captureRequirements(f.roots, {...f.request, includeHistory: true}, {client: f.client});
  assert(partial.omissions.some(o => o.sourceId === 'jira-discussion' && o.reason === 'inaccessible-or-incomplete'));
  assert(partial.omissions.some(o => o.sourceId === 'jira-history' && o.reason === 'inaccessible-or-incomplete'));
  assert(!JSON.stringify(partial).includes('private upstream'));
});

test('comment identity stays opaque and updated body changes its freshness fingerprint', async t => {
  const f = jiraFixture(t), first = await readJiraStoryComments(f.client, 'DEMO-1');
  assert.equal(first[0].id, '200'); assert.match(first[0].version, /^[a-f0-9]{64}$/); assert.equal(first[0].body, undefined);
  assert.equal(first[0].content, fingerprint(f.comments[0].body));
  f.comments[0].body = adf('Changed discussion.'); const second = await readJiraStoryComments(f.client, 'DEMO-1'); assert.notEqual(first[0].version, second[0].version);
  f.comments.push({...f.comments[0]}); await assert.rejects(readJiraStoryComments(f.client, 'DEMO-1'), /duplicate/);
});

test('unmapped acceptance criteria permits description-based requirements in every Jira mode', async t => {
  const f = jiraFixture(t); delete f.client.configuration.fields.acceptanceCriteria;
  for (const provider of ['none', 'xray', 'zephyr-scale']) {
    f.client.configuration.testManagement.provider = provider;
    const source = await captureRequirements(f.roots, f.request, {client: f.client});
    assert.equal(source.origin.testManagement, provider);
    assert(source.parts.some(part => part.location === 'description' && part.kind === 'requirement'));
    assert(source.omissions.every(omission => omission.reason === 'absent'));
  }
});

test('native metadata and attachment inventory reuse the same issue read without downloads', async t => {
  const f = jiraFixture(t); f.item.fields.issuetype = {id: '10001', name: 'Story'}; f.item.fields.status = {id: '1', name: 'Open'};
  const result = await readJiraRequirements(f.client, {...f.request, includeDiscussion: false});
  assert.deepEqual(result.metadata, {id: '101', key: 'DEMO-1', type: {id: '10001', name: 'Story'}, status: {id: '1', name: 'Open'}, updated: f.item.fields.updated});
  assert.deepEqual(result.availableAttachments, [{id: '500', name: 'notes.md'}]);
  assert.deepEqual(f.calls, [['issue', 'DEMO-1']]);
});

test('source sanitization removes secrets from Jira text and link destinations', async t => {
  const f = jiraFixture(t); f.item.fields.description = adf(['password', 'synthetic-secret-value'].join('='));
  f.item.fields.customfield_10001 = {type: 'doc', version: 1, content: [{type: 'paragraph', content: [{type: 'text', text: 'Public reference', marks: [{type: 'link', attrs: {href: 'https://docs.example.test/?token=synthetic-secret-value'}}]}]}]};
  const source = await captureRequirements(f.roots, f.request, {client: f.client});
  assert(!JSON.stringify(source).includes('synthetic-secret-value')); assert(source.omissions.some(o => o.reason === 'sensitive-content-omitted'));
  assert(source.links.some(link => link.status === 'redacted'));
});

test('Jira-specific source IDs are reserved while local sources keep the shared readers', async t => {
  const f = jiraFixture(t), file = join(f.roots.projectRoot, 'notes.md'); mkdirSync(dirname(file), {recursive: true}); writeFileSync(file, 'Local supplied requirement.');
  const source = await captureRequirements(f.roots, {...f.request, sources: [{id: 'notes', kind: 'file', path: 'notes.md'}]}, {client: f.client});
  assert(source.parts.some(p => p.sourceId === 'notes'));
  await assert.rejects(captureRequirements(f.roots, {...f.request, sources: [{id: 'jira-story', kind: 'file', path: 'notes.md'}]}, {client: f.client}), /reserved/);
});

test('configured Jira default is frozen into the captured request', async t => {
  const f = jiraFixture(t), request = {...f.request}; delete request.provider;
  const source = await captureRequirements(f.roots, request, {client: f.client}); assert.equal(source.request.provider, 'jira');
});

test('Jira source freshness ignores volatile and unselected fields but binds selected evidence and updated identity', async t => {
  const f = jiraFixture(t), before = await captureRequirements(f.roots, f.request, {client: f.client});
  f.item.fields.lastViewed = '2026-10-30T08:00:00Z'; f.item.fields.watches = {watchCount: 42}; f.item.fields.attachment.push({id: '501', filename: 'unselected.md'});
  const viewed = await captureRequirements(f.roots, f.request, {client: f.client}); assert.equal(viewed.fingerprint, before.fingerprint);
  f.item.fields.updated = '2026-10-30T09:00:00Z'; const updated = await captureRequirements(f.roots, f.request, {client: f.client});
  assert.notEqual(updated.fingerprint, before.fingerprint); assert.equal(updated.revisions[0].content, before.revisions[0].content);
  f.item.fields.status = {id: '2', name: 'Ready'}; const status = await captureRequirements(f.roots, f.request, {client: f.client}); assert.notEqual(status.revisions[0].content, before.revisions[0].content);
});
