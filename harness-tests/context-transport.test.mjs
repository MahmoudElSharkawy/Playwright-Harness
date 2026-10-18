import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdoClient} from '../scripts/lib/integrations/ado-client.mjs';
import {validateAdoConfiguration} from '../scripts/lib/integrations/config.mjs';
import {createAdoContextSource} from '../scripts/lib/integrations/ado-context.mjs';
import {fixture} from './fixtures/execution-core.mjs';
import {updateContext, searchContext} from '../scripts/lib/context/index.mjs';

test('ADO binary reads and bounded WIQL reuse the configured transport without writes or credential disclosure', async () => {
  const routes = [], credential = crypto.randomUUID(), bytes = Buffer.from('synthetic attachment');
  const configuration = {organizationUrl: 'https://ado.example.test', project: 'demo', credentialRef: 'ADO_ACCESS', maxResponseBytes: 1024};
  const client = createAdoClient({configuration, resolveCredential: () => credential, fetchImpl: async (url, options) => {routes.push({url, method: options.method, body: options.body}); return new Response(url.includes('/attachments/') ? bytes : JSON.stringify({workItems: []}));}});
  assert.deepEqual(await client.attachment('00000000-0000-4000-8000-000000000001'), bytes);
  await client.wiql('SELECT [System.Id] FROM WorkItems', {top: 200}); assert(routes[1].url.includes('$top=200')); assert.equal(routes[0].method, 'GET'); assert.equal(routes[1].method, 'POST');
  await assert.rejects(client.attachment('../outside')); await assert.rejects(client.wiql('SELECT [System.Id] FROM WorkItems', {top: -1})); assert.equal(routes.length, 2);
  const oversized = createAdoClient({configuration, resolveCredential: () => credential, fetchImpl: async () => new Response(Buffer.alloc(1025))});
  await assert.rejects(oversized.attachment('00000000-0000-4000-8000-000000000001'), error => error.code === 'response-too-large' && !error.message.includes(credential));
});
test('ADO configuration extends only the existing per-source context policy contract', () => {
  const input = {organizationUrl: 'https://ado.example.test', project: 'demo', credentialRef: 'ADO_ACCESS', context: {sources: {app: {scope: {areaPath: 'demo\\app'}, policy: {excludeTypes: [], excludeStates: []}}}}};
  assert.deepEqual(validateAdoConfiguration(input).context, input.context);
  for (const mutate of [value => value.context.sources.app.policy = {}, value => value.context.extra = true, value => value.context.sources.app.scope = {query: 'anything'}]) {const copy = structuredClone(input); mutate(copy); assert.throws(() => validateAdoConfiguration(copy));}
});
test('valid ADO area names containing read-only guard keywords remain retrievable while mutations fail', async () => {
  const calls = [], client = createAdoClient({configuration: {organizationUrl: 'https://ado.example.test', project: 'demo', credentialRef: 'ADO_ACCESS'}, resolveCredential: () => crypto.randomUUID(),
    fetchImpl: async (url, options) => {calls.push({url, options}); return new Response(JSON.stringify(url.includes('/states?') ? {value: [{name: 'Ready'}]} : url.includes('/workitemtypes?') ? {value: [{name: 'Custom work', referenceName: 'Custom.Work'}]} : {workItems: []}));}});
  for (const area of ['Update', 'Delete', 'Drop', 'Insert']) {
    const result = await createAdoContextSource(client).retrieve({policy: {excludeTypes: [], excludeStates: []}, scope: {areaPath: `demo\\${area}`}}); assert.equal(result.status, 'READY');
  }
  assert.equal(calls.filter(call => call.url.includes('/wiql?')).length, 4);
  for (const query of ["SELECT [System.Id] FROM WorkItems WHERE [System.Title] = 'safe'; DELETE WorkItems", "SELECT [System.Id] FROM WorkItems WHERE [System.Title] = 'unclosed", 'DELETE WorkItems']) await assert.rejects(client.wiql(query), /read-only/);
});

test('one PAT with two-project access remains bound before metadata, classification and content reads', async t => {
  const {roots} = fixture(t), credential = crypto.randomUUID(), routes = [], ids = {Alpha: '11111111-1111-4111-8111-111111111111', Beta: '22222222-2222-4222-8222-222222222222'};
  function client(project) {
    return createAdoClient({configuration: {organizationUrl: 'https://ado.example.test', project, credentialRef: 'ADO_ACCESS', context: {sources: {backlog: {policy: {excludeTypes: [], excludeStates: []}}}}}, resolveCredential: () => credential,
      fetchImpl: async (url, options) => {
        assert.equal(options.headers.Authorization, 'Basic ' + Buffer.from(':' + credential).toString('base64')); routes.push(url);
        assert(url.startsWith(`https://ado.example.test/${project}/_apis/`) || url === `https://ado.example.test/_apis/projects/${project}?api-version=7.1`);
        const fields = {'System.Id': 1, 'System.Rev': 1, 'System.TeamProject': project, 'System.WorkItemType': 'Story', 'System.State': 'Active', 'System.Title': `${project} unique evidence`};
        const body = url.includes('/projects/') ? {id: ids[project], name: project} : url.includes('/states?') ? {value: [{id: 'active', name: 'Active'}]} : url.includes('/workitemtypes?') ? {value: [{name: 'Story', referenceName: 'Custom.Story'}]} : url.includes('/wiql?') ? {workItems: [{id: 1}]} : url.includes('/workitemsbatch?') ? {value: [{id: 1, rev: 1, fields}]} : {id: 1, rev: 1, fields, relations: [{rel: 'System.LinkTypes.Related', url: 'https://ado.example.test/Beta/_apis/wit/workItems/2'}]};
        return new Response(JSON.stringify(body));
      }});
  }
  const input = contextId => ({version: 1, contextId, identity: {project: 'Consumer'}, scope: {application: 'app', environment: 'qa'}, sources: [], ado: {sourceId: 'backlog'}});
  await updateContext(roots, input('alpha'), {client: client('Alpha')}); assert(!routes.some(url => url.includes('/Beta/'))); routes.length = 0;
  await assert.rejects(updateContext(roots, input('alpha'), {client: client('Beta')}), /project identity differs/); assert.equal(routes.length, 1); assert(routes[0].includes('/projects/Beta?'));
  await updateContext(roots, input('beta'), {client: client('Beta')});
  assert.equal(searchContext(roots, 'alpha', {query: 'Beta'}).results.length, 0); assert.equal(searchContext(roots, 'beta', {query: 'Alpha'}).results.length, 0); assert(searchContext(roots, 'alpha', {workItemId: 1}).results[0].excerpt.includes('Alpha'));
});
