import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdoClient} from '../scripts/lib/integrations/ado-client.mjs';
import {validateAdoConfiguration} from '../scripts/lib/integrations/config.mjs';
import {createAdoContextSource} from '../scripts/lib/integrations/ado-context.mjs';

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
