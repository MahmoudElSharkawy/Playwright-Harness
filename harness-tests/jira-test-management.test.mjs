import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestManagement} from '../scripts/lib/integrations/test-management.mjs';
import {createPluginClient, PluginError} from '../scripts/lib/integrations/plugin-client.mjs';
import {desiredCase} from '../scripts/lib/integrations/test-management-common.mjs';

const siteUrl = 'https://example.atlassian.net';
function jira(provider = 'xray') {
  return {configuration: {siteUrl, project: 'DEMO', timeoutMs: 1000, maxResponseBytes: 200000, testManagement: {provider, region: 'eu'}},
    projectIdentity: async () => ({id: '10001', key: 'DEMO', name: 'Demo'}),
    issue: async key => ({id: key === 'DEMO-1' ? '10002' : '10003', key, fields: {project: {id: '10001', key: 'DEMO'}, summary: 'Buy', labels: ['team'], updated: '2026-10-28T01:02:03.000Z'}})};
}
const nativeJira = key => ({key, project: {id: '10001', key: 'DEMO', self: siteUrl + '/rest/api/2/project/10001'}});
const manual = {issueId: '10003', projectId: '10001', jira: nativeJira('DEMO-2'), lastModified: '2026-10-28T01:02:03.000Z', testType: {name: 'Manual'}, steps: [{id: 'step-a', action: 'Buy', data: 'quantity 2', result: 'Order created', attachments: [], customFields: []}], dataset: null, preconditions: {total: 0, results: []}};
const zproject = {id: 37, jiraProjectId: 10001, key: 'DEMO', enabled: true};
const zcase = {id: 25, key: 'DEMO-T25', name: 'Buy', objective: 'Business goal', precondition: 'Signed in', project: {id: 37}, priority: {id: 2}, status: {id: 1}, labels: ['team'], customFields: {Risk: 'High'}};
const zsteps = [{id: 10, inline: {description: 'Buy', testData: 'quantity 2', expectedResult: 'Order created', customFields: {}}, attachments: []}];

test('reviewed classification replacement removes only explicitly selected owned labels', () => {
  const desired = desiredCase({before: {labels: ['team', 'Functional', 'Negative']}, title: 'Buy', steps: [{action: 'Buy', expected: 'Order'}],
    marker: 'pom-harness-0123456789abcdef', removeLabels: ['Functional', 'Negative'], labels: ['Accessibility', 'Positive']});
  assert.deepEqual(desired.labels, ['team', 'Accessibility', 'Positive', 'pom-harness-0123456789abcdef']);
});

test('no-plugin mode advertises local cases and never resolves plugin secrets', () => {
  const adapter = createTestManagement({jira: jira('none'), resolveCredentials() {throw new Error('must stay lazy');}});
  assert.equal(adapter.provider, 'none'); assert.equal(adapter.capabilities.remoteCases, false); assert.equal(adapter.capabilities.remoteResults, false);
});

test('Xray reads preserve native IDs, separate data, ordered expectations and site-qualified identity', async () => {
  const adapter = createTestManagement({jira: jira(), transport: {query: async () => ({getTest: manual})}});
  const item = await adapter.readCase('DEMO-2');
  assert.equal(item.id, 'DEMO-2'); assert.equal(item.nativeId, '10003'); assert.equal(item.siteUrl, siteUrl);
  assert.deepEqual(item.steps, [{id: 'step-a', action: 'Buy', data: 'quantity 2', expected: 'Order created'}]);
  assert.deepEqual(item.externalReferences, [{system: 'xray', id: `${siteUrl}/browse/DEMO-2`}]);
  assert.match(item.fingerprint, /^[a-f0-9]{64}$/); assert.equal(item.revision, manual.lastModified);
});

test('Xray refuses the same numeric issue/project IDs from another native Jira site before reads or creation', async () => {
  const foreign = key => ({...nativeJira(key), project: {...nativeJira(key).project, self: 'https://example-other.atlassian.net/rest/api/2/project/10001'}});
  const client = jira(); client.read = async () => ({issueLinkTypes: [{id: '1', outward: 'tests', inward: 'is tested by'}]});
  const adapter = createTestManagement({jira: client, transport: {query: async query => query.includes('getCoverableIssue')
    ? {getCoverableIssue: {issueId: '10002', jira: foreign('DEMO-1')}}
    : query.includes('getTestSet') ? {getTestSet: {issueId: '10003', jira: foreign('DEMO-2'), tests: {start: 0, total: 0, results: []}}}
      : {getTest: {...manual, jira: foreign('DEMO-2')}}}});
  await assert.rejects(adapter.readCase('DEMO-2'), /another Jira site/);
  await assert.rejects(adapter.groupCases({kind: 'test-set', id: 'DEMO-2'}), /another Jira site/);
  await assert.rejects(adapter.prepareCase({title: 'Buy', steps: [{action: 'Buy', expected: 'Order'}], storyKey: 'DEMO-1', marker: 'pom-harness-0123456789abcdef'}), /another Jira site/);
  await assert.rejects(adapter.prepareCase({title: 'Buy', steps: [{action: 'Buy', expected: 'Order'}], marker: 'pom-harness-0123456789abcdef'}), /selected source story/);
});

test('Xray rejects called tests or datasets instead of flattening their meaning', async () => {
  for (const raw of [{...manual, dataset: {id: 'dataset-1'}}, {...manual, steps: [{...manual.steps[0], callTestIssueId: '10009'}]}]) {
    const adapter = createTestManagement({jira: jira(), transport: {query: async () => ({getTest: raw})}});
    await assert.rejects(adapter.readCase('DEMO-2'), /unsupported|dataset|called/i);
  }
});

test('Xray does not treat omitted preconditions as an empty collection', async () => {
  const raw = {...manual}; delete raw.preconditions;
  await assert.rejects(createTestManagement({jira: jira(), transport: {query: async () => ({getTest: raw})}}).readCase('DEMO-2'), /preconditions are incomplete/);
});

test('Zephyr discovers an interrupted empty creation and proposes only its original missing steps/link', async () => {
  const marker = 'pom-harness-0123456789abcdef', current = {...zcase, labels: [marker]}, steps = [], links = [];
  const transport = {read: async route => route.startsWith('projects/') ? zproject : route.endsWith('/links') ? {issues: links} : current,
    list: async route => route.startsWith('testcases?') ? [current] : route.endsWith('/attachments') ? [] : steps};
  const adapter = createTestManagement({jira: jira('zephyr-scale'), transport}), plan = await adapter.prepareCase({title: 'Buy', steps: [{action: 'Buy', expected: 'Order created'}], storyKey: 'DEMO-1', marker});
  assert.equal((await adapter.findCase(marker)).id, 'DEMO-T25');
  await assert.rejects(adapter.readCase('DEMO-T25'), /no executable/);
  const missing = await adapter.caseCompletion(plan, 'DEMO-T25');
  assert.deepEqual(missing.requests.map(item => item.operation), ['write-case-steps', 'link-case-story']);
  assert.equal(missing.requests[0].body.mode, 'OVERWRITE');
  steps.push({id: 10, inline: {description: 'Buy', testData: '', expectedResult: 'Order created'}});
  assert.deepEqual((await adapter.caseCompletion(plan, 'DEMO-T25')).requests.map(item => item.operation), ['link-case-story']);
  links.push({issueId: 10002}); assert.equal((await adapter.caseCompletion(plan, 'DEMO-T25')).complete, true);
  links.length = 0;
  const update = await adapter.prepareCase({before: await adapter.readCase('DEMO-T25'), title: 'Buy', steps: [{action: 'Buy', expected: 'Order created'}], storyKey: 'DEMO-1', marker});
  assert.deepEqual((await adapter.caseCompletion(update, 'DEMO-T25')).requests.map(item => item.operation), ['link-case-story']);
  steps[0].inline.expectedResult = 'Changed'; await assert.rejects(adapter.caseCompletion(plan, 'DEMO-T25'), /approved ordered prefix/);
});

test('Xray creation completion only proposes an absent approved story link', async () => {
  const marker = 'pom-harness-0123456789abcdef', client = jira(), item = await client.issue('DEMO-2');
  item.fields.labels = [marker]; item.fields.issuelinks = [];
  client.issue = async key => key === 'DEMO-1' ? {id: '10002', key, fields: {project: {id: '10001', key: 'DEMO'}}} : item;
  client.read = async () => ({issueLinkTypes: [{id: 'link-type', outward: 'tests', inward: 'is tested by'}]});
  client.search = async () => [{key: 'DEMO-2'}];
  const adapter = createTestManagement({jira: client, transport: {query: async query => query.includes('getCoverableIssue') ? {getCoverableIssue: {issueId: '10002', jira: nativeJira('DEMO-1')}} : {getTest: manual}}});
  const plan = await adapter.prepareCase({title: 'Buy', steps: [{action: 'Buy', data: 'quantity 2', expected: 'Order created'}], storyKey: 'DEMO-1', marker});
  assert.equal((await adapter.findCase(marker)).id, 'DEMO-2');
  assert.equal((await adapter.caseCompletion(plan, 'DEMO-2')).requests[0].operation, 'link-case-story');
  item.fields.issuelinks.push({id: '1', type: {id: 'link-type'}, outwardIssue: {key: 'DEMO-1'}});
  assert.equal((await adapter.caseCompletion(plan, 'DEMO-2')).complete, true);
  item.fields.issuelinks = [];
  const update = await adapter.prepareCase({before: await adapter.readCase('DEMO-2'), title: 'Buy', steps: [{action: 'Buy', data: 'quantity 2', expected: 'Order created'}], storyKey: 'DEMO-1', marker});
  assert.equal((await adapter.caseCompletion(update, 'DEMO-2')).requests[0].operation, 'link-case-story');
});

test('Zephyr update preserves metadata and custom fields while replacing ordered ordinary steps', async () => {
  const transport = {read: async route => route.startsWith('projects/') ? zproject : zcase,
    list: async route => route.endsWith('/attachments') ? [] : zsteps};
  const adapter = createTestManagement({jira: jira('zephyr-scale'), transport});
  const before = await adapter.readCase('DEMO-T25');
  const plan = await adapter.prepareCase({before, title: 'Buy twice', steps: [{action: 'Buy again', expected: 'Two orders'}], marker: 'pom-harness-0123456789abcdef'});
  const metadata = plan.requests.find(request => request.route === 'testcases/DEMO-T25');
  assert.equal(metadata.method, 'PUT'); assert.equal(metadata.body.objective, 'Business goal'); assert.equal(metadata.body.precondition, 'Signed in');
  assert.deepEqual(metadata.body.customFields, {Risk: 'High'}); assert.deepEqual(metadata.body.priority, {id: 2}); assert.deepEqual(metadata.body.status, {id: 1});
  assert.deepEqual(plan.requests.find(request => request.route.endsWith('/teststeps')).body, {mode: 'OVERWRITE', items: [{inline: {description: 'Buy again', testData: '', expectedResult: 'Two orders'}}]});
});

test('Zephyr refuses step overwrites that would erase attachments or called tests', async () => {
  const adapter = createTestManagement({jira: jira('zephyr-scale'), transport: {read: async route => route.startsWith('projects/') ? zproject : zcase, list: async () => [{...zsteps[0], attachments: [{id: 1}]}]}});
  await assert.rejects(adapter.readCase('DEMO-T25'), /unsupported|attachment/i);
});

test('Zephyr metadata readback must preserve unrelated custom fields after a case edit', async () => {
  let current = structuredClone(zcase), currentSteps = structuredClone(zsteps);
  const transport = {read: async route => route.startsWith('projects/') ? zproject : structuredClone(current), list: async route => route.endsWith('/attachments') ? [] : structuredClone(currentSteps)};
  const adapter = createTestManagement({jira: jira('zephyr-scale'), transport}), before = await adapter.readCase('DEMO-T25');
  const plan = await adapter.prepareCase({before, title: 'Buy twice', steps: [{action: 'Buy again', expected: 'Two orders'}], marker: 'pom-harness-0123456789abcdef'});
  current.name = 'Buy twice'; current.labels = plan.desired.labels;
  currentSteps = [{id: 22, inline: {description: 'Buy again', testData: '', expectedResult: 'Two orders', customFields: {}}}];
  await adapter.verifyCase(plan, 'DEMO-T25');
  current.customFields = {}; await assert.rejects(adapter.verifyCase(plan, 'DEMO-T25'), /metadata|custom|preserv/i);
});

test('plugin pagination follows server offsets and rejects an incomplete or repeated page', async () => {
  const offsets = [], responses = [{startAt: 0, total: 2, isLast: false, values: [{id: 1}]}, {startAt: 1, total: 2, isLast: true, values: [{id: 2}]}];
  const transport = createPluginClient({jira: jira('zephyr-scale'), resolveCredentials: () => ({token: '<synthetic>'}), fetchImpl: async url => {offsets.push(new URL(url).searchParams.get('startAt')); return new Response(JSON.stringify(responses.shift()));}});
  assert.deepEqual(await transport.list('testcases?projectKey=DEMO'), [{id: 1}, {id: 2}]); assert.deepEqual(offsets, ['0', '1']);
  const incomplete = createPluginClient({jira: jira('zephyr-scale'), resolveCredentials: () => ({token: '<synthetic>'}), fetchImpl: async () => new Response(JSON.stringify({startAt: 0, total: 2, isLast: true, values: [{id: 1}]}))});
  await assert.rejects(incomplete.list('testcases?projectKey=DEMO'), /contradicts/);
});

test('Zephyr native project identity cannot be mistaken for Jira project identity', async () => {
  const adapter = createTestManagement({jira: jira('zephyr-scale'), transport: {read: async () => ({id: 10001, jiraProjectId: 99, key: 'DEMO', enabled: true})}});
  await assert.rejects(adapter.readCase('DEMO-T25'), /project identity/);
});

test('plugin transport keeps tokens separate, rejects GraphQL errors, and never retries an uncertain create', async () => {
  let calls = 0; const addresses = [];
  const transport = createPluginClient({jira: jira(), resolveCredentials: () => ({clientId: '<synthetic>', clientSecret: '<synthetic>'}), fetchImpl: async (url, options) => {
    addresses.push(url); calls++;
    if (url.endsWith('/authenticate')) return new Response(JSON.stringify('<synthetic-access>'));
    assert.equal(options.headers.Authorization, 'Bearer <synthetic-access>');
    if (options.body.includes('mutation')) throw new Error('response lost');
    return new Response(JSON.stringify({errors: [{message: 'secret must never escape'}], data: null}));
  }});
  await assert.rejects(transport.query('query { getTest(issueId:"10003") { issueId } }'), error => error instanceof PluginError && !error.message.includes('secret'));
  await assert.rejects(transport.request('graphql', {method: 'POST', execute: true, body: {query: 'mutation { createTest(jira:{}) { test { issueId } } }'}}), /transport-failure/);
  assert.equal(calls, 3); assert.ok(addresses.every(url => url.startsWith('https://xray.cloud.getxray.app/api/v2/')));
});

test('plugin transport refuses escaped destinations before resolving credentials', async () => {
  const transport = createPluginClient({jira: jira('zephyr-scale'), resolveCredentials() {throw new Error('must not resolve');}});
  await assert.rejects(transport.read('https://other.test/token'), /route|destination/i);
  await assert.rejects(transport.read('testcases/%2e%2e/%2e%2e/secrets'), /route|destination/i);
});

test('read-only Xray GraphQL honors bounded Retry-After while mutation rejection is never retried', async () => {
  let reads = 0, writes = 0;
  const transport = createPluginClient({jira: jira(), resolveCredentials: () => ({clientId: '<synthetic>', clientSecret: '<synthetic>'}), fetchImpl: async (url, options) => {
    if (url.endsWith('/authenticate')) return new Response(JSON.stringify('<synthetic-access>'));
    if (JSON.parse(options.body).query.startsWith('mutation')) {writes++; return new Response('{}', {status: 429, headers: {'retry-after': '0'}});}
    if (++reads === 1) return new Response('{}', {status: 429, headers: {'retry-after': '0'}});
    return new Response(JSON.stringify({data: {getTest: {issueId: '10003'}}}));
  }});
  assert.equal((await transport.query('query { getTest(issueId:"10003") { issueId } }')).getTest.issueId, '10003'); assert.equal(reads, 2);
  await assert.rejects(transport.request('graphql', {method: 'POST', execute: true, body: {query: 'mutation { createTest(jira:{}) { warnings } }'}}), /rate-limited/); assert.equal(writes, 1);
});
