import test from 'node:test';
import assert from 'node:assert/strict';
import {createJiraClient, JiraError} from '../scripts/lib/integrations/jira-client.mjs';

const config = (patch = {}) => ({siteUrl: 'https://example.atlassian.net', project: 'DEMO', emailRef: 'JIRA_EMAIL', credentialRef: 'JIRA_TOKEN', ...patch});
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json', ...headers}});
const item = (key = 'DEMO-1', project = 'DEMO') => ({id: '101', key, fields: {project: {id: '10', key: project}, summary: 'Synthetic story'}});
function setup(handler = () => json({ok: true}), patch = {}, serverSite) {
  const calls = [], token = crypto.randomUUID(); let credentials = 0;
  const client = createJiraClient({configuration: config(patch), resolveEmail: () => 'qa@example.test', resolveCredential: () => {credentials++; return token;}, fetchImpl: async (url, options) => {
    const path = new URL(url).pathname.split('/rest/api/3/')[1]; calls.push({url, path, ...options});
    if (path === 'serverInfo' && patch.authType === 'scoped') return json({baseUrl: serverSite ?? config(patch).siteUrl});
    if (path === 'myself') return json({accountId: 'account-1', active: true});
    if (path === 'project/DEMO') return json({id: '10', key: 'DEMO', name: 'Demo'});
    return handler({url, path, ...options});
  }});
  return {client, calls, token, credentials: () => credentials};
}

test('classic and scoped tokens use fixed approved API origins and lazy credentials', async () => {
  for (const scoped of [false, true]) {
    const f = setup(() => json(item()), scoped ? {authType: 'scoped', cloudId: '11111111-1111-4111-8111-111111111111'} : {});
    assert.equal(f.credentials(), 0); assert.equal((await f.client.issue('DEMO-1')).key, 'DEMO-1');
    const prefix = scoped ? 'https://api.atlassian.com/ex/jira/11111111-1111-4111-8111-111111111111/rest/api/3/' : 'https://example.atlassian.net/rest/api/3/';
    assert(f.calls.every(call => call.url.startsWith(prefix) && call.redirect === 'manual'));
    assert.equal(f.calls[0].headers.Authorization, `Basic ${Buffer.from(`qa@example.test:${f.token}`).toString('base64')}`);
  }
});

test('unsafe routes fail before credential resolution or network calls', async () => {
  const f = setup();
  for (const route of ['https://other.invalid/steal', '//other.invalid', '../other', 'issue/%2e%2e/%2e%2e/other', 'issue/%252e%252e/other', 'issue/DEMO-1#x']) await assert.rejects(f.client.read(route));
  assert.equal(f.calls.length, 0); assert.equal(f.credentials(), 0);
});

test('scoped cloud identity cannot route the selected project into a different site', async () => {
  const f = setup(() => json(item()), {authType: 'scoped', cloudId: '11111111-1111-4111-8111-111111111111'}, 'https://example-other.atlassian.net');
  await assert.rejects(f.client.issue('DEMO-1'), /different site/);
  assert.deepEqual(f.calls.map(call => call.path), ['serverInfo']);
});

test('saved Jira criteria preserve top-level sorting and quote boundaries while bounding OR to the project', async () => {
  const captured = [], f = setup(({body}) => {captured.push(JSON.parse(body).jql); return json({issues: [], isLast: true});});
  await f.client.search('status = Open OR summary ~ "ORDER BY priority" ORDER BY updated DESC');
  assert.equal(captured[0], 'project = "DEMO" AND (status = Open OR summary ~ "ORDER BY priority") ORDER BY updated DESC');
  await f.client.search('(summary ~ "quoted \\"order by\\"" OR assignee = currentUser()) order by key ASC');
  assert.match(captured[1], /currentUser\(\)\)\) order by key ASC$/);
  for (const invalid of ['status = "Open', '(status = Open', 'status = Open) OR project = OTHER', 'ORDER BY updated', 'status = Open ORDER BY']) await assert.rejects(f.client.search(invalid), /search/);
});

test('issue and configured-project identity mismatches are rejected', async () => {
  const f = setup(() => json(item('OTHER-1', 'OTHER')));
  await assert.rejects(f.client.issue('DEMO-1'), /identity|project/);
  await assert.rejects(f.client.issue('OTHER-1'), /project/);
  const wrong = createJiraClient({configuration: config(), resolveEmail: () => 'qa@example.test', resolveCredential: () => 'synthetic', fetchImpl: async url => json(url.endsWith('/myself') ? {accountId: 'a', active: true} : {id: '11', key: 'OTHER', name: 'Other'})});
  await assert.rejects(wrong.projectIdentity(), /project/);
});

test('mutations need explicit execution and are never retried; beforeDispatch runs only at dispatch', async () => {
  const f = setup(() => json({}, 503)); let dispatched = 0;
  await assert.rejects(f.client.request('issue', {method: 'POST', body: {}, beforeDispatch() {dispatched++;}}), /authorization/);
  assert.equal(f.calls.length, 0); assert.equal(dispatched, 0);
  await assert.rejects(f.client.request('issue', {method: 'POST', execute: true, body: {}, beforeDispatch() {dispatched++;}}), e => e instanceof JiraError && e.status === 503);
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1); assert.equal(dispatched, 1);
});

test('search validates authentication before accepting an empty result and checks result project scope', async () => {
  const f = setup(() => json({issues: [], isLast: true}));
  assert.deepEqual(await f.client.search('status = "Open"'), []);
  assert.deepEqual(f.calls.map(c => c.path), ['myself', 'project/DEMO', 'search/jql']);
  assert.match(JSON.parse(f.calls.at(-1).body).jql, /^project = "DEMO" AND/);
  const wrong = setup(() => json({issues: [item('OTHER-1', 'OTHER')], isLast: true}));
  await assert.rejects(wrong.client.search('status = "Open"'), /project/);
  let searched = false;
  const rejected = createJiraClient({configuration: config(), resolveEmail: () => 'qa@example.test', resolveCredential: () => 'synthetic', fetchImpl: async url => {if (url.includes('search')) searched = true; return url.endsWith('myself') ? json({}, 401) : json({issues: [], isLast: true});}});
  await assert.rejects(rejected.search('status = "Open"'), e => e.code === 'authentication-rejected'); assert.equal(searched, false);
});

test('search follows bounded token pagination and refuses repeated or partial pages', async () => {
  const f = setup(({body}) => JSON.parse(body).nextPageToken ? json({issues: [{...item('DEMO-2'), id: '102'}], isLast: true}) : json({issues: [item()], isLast: false, nextPageToken: 'next'}));
  assert.deepEqual((await f.client.search('status = "Open"')).map(i => i.key), ['DEMO-1', 'DEMO-2']);
  const repeated = setup(() => json({issues: [item()], isLast: false, nextPageToken: 'same'}));
  await assert.rejects(repeated.client.search('status = "Open"'), /pagination|duplicate/);
  const partial = setup(() => json({issues: [item()]})); await assert.rejects(partial.client.search('status = "Open"'), /incomplete/);
});

test('offset lists require explicit completion and reject repeated pages', async () => {
  const f = setup(({url}) => Number(new URL(url).searchParams.get('startAt')) === 0 ? json({values: [{id: '1'}], startAt: 0, total: 2}) : json({values: [{id: '2'}], startAt: 1, total: 2}));
  assert.deepEqual(await f.client.list('field/search'), [{id: '1'}, {id: '2'}]);
  const repeated = setup(() => json({values: [{id: '1'}], isLast: false})); await assert.rejects(repeated.client.list('field/search'), /pagination/);
  const partial = setup(() => json({values: [{id: '1'}]})); await assert.rejects(partial.client.list('field/search'), /incomplete/);
});

test('bounded read retries honor Retry-After; a delay exceeding the budget is refused', async () => {
  let attempts = 0; const f = setup(() => ++attempts === 1 ? json({}, 429, {'Retry-After': '0'}) : json({ok: true}));
  assert.deepEqual(await f.client.read('serverInfo'), {ok: true}); assert.equal(attempts, 2);
  const tooLong = setup(() => json({}, 429, {'Retry-After': '120'}), {timeoutMs: 100});
  await assert.rejects(tooLong.client.read('serverInfo'), e => e.code === 'rate-limited');
  assert.equal(tooLong.calls.filter(c => c.path === 'serverInfo').length, 1);
});

for (const [status, code] of [[401, 'authentication-rejected'], [403, 'permission-denied'], [302, 'redirect-refused']]) test(`HTTP ${status} remains distinct and sanitized`, async () => {
  const f = setup(() => json({message: 'sensitive-upstream'}, status));
  await assert.rejects(f.client.read('serverInfo'), e => e.code === code && !e.message.includes(f.token) && !e.message.includes('sensitive-upstream'));
});

test('oversized and malformed responses are bounded; no-content mutations succeed', async () => {
  const large = setup(() => json({value: 'x'.repeat(5000)}), {maxResponseBytes: 512}); await assert.rejects(large.client.read('serverInfo'), e => e.code === 'response-too-large');
  const malformed = setup(() => new Response('not-json')); await assert.rejects(malformed.client.read('serverInfo'), e => e.code === 'invalid-json');
  const empty = setup(() => new Response(null, {status: 204})); assert.equal(await empty.client.request('issue/DEMO-1', {method: 'PUT', execute: true, body: {fields: {summary: 'Updated'}}}), undefined);
});

test('attachments use numeric identity and suppress redirects without accepting a URL', async () => {
  const f = setup(({url}) => {assert.equal(new URL(url).searchParams.get('redirect'), 'false'); return new Response(Buffer.from('synthetic'));});
  assert.deepEqual(await f.client.attachment('123'), Buffer.from('synthetic'));
  const before = f.calls.length; await assert.rejects(f.client.attachment('https://other.invalid/123')); assert.equal(f.calls.length, before);
});
