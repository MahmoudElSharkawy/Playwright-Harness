import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdoContextSource, validateContextPolicy} from '../scripts/lib/integrations/ado-context.mjs';

const empty = () => ({excludeTypes: [], excludeStates: []});
function project() {
  const calls = [], types = [{name: 'Demande', referenceName: 'Custom.Request'}, {name: 'Décision', referenceName: 'Custom.Decision'}];
  const states = {Demande: [{id: 'open', name: 'Ouvert'}, {id: 'done', name: 'Terminé'}, {id: 'drop', name: 'Abandonné'}], 'Décision': [{id: 'pending', name: 'Ouvert'}, {id: 'approved', name: 'Accepté'}]};
  const items = new Map([[1, ['Demande', 'Terminé']], [2, ['Demande', 'Abandonné']], [3, ['Décision', 'Ouvert']], [4, ['Demande', 'Ouvert']]].map(([id, [type, state]]) => [id, {id, rev: 1, fields: {'System.TeamProject': 'demo', 'System.AreaPath': 'demo\\Checkout', 'System.WorkItemType': type, 'System.State': state, 'System.Title': `Item ${id}`, 'System.Description': `Content ${id}`}, relations: [{rel: 'AttachedFile', url: `https://ado.example.test/demo/_apis/wit/attachments/${id}`}]}]));
  const client = {configuration: {organizationUrl: 'https://ado.example.test', project: 'demo'},
    async projectIdentity() {return {name: 'demo', id: 'project-id'};},
    async requireWorkItemProject(item) {assert.equal(item.fields['System.TeamProject'], 'demo');},
    async list(route) {calls.push(['metadata', route]); if (route === 'wit/workitemtypes?api-version=7.1') return structuredClone(types); const name = decodeURIComponent(route.match(/workitemtypes\/([^/]+)\/states/)[1]); return structuredClone(states[name]);},
    async wiql(query) {calls.push(['query', query]); const cursor = Number(query.match(/\[System.Id\] > (\d+)/)?.[1] ?? 0); return {workItems: [...items.keys()].filter(id => id > cursor).map(id => ({id}))};},
    async workItems(ids, fields) {calls.push(['classify', ids, fields]); assert(!fields.includes('System.Description')); return {value: ids.map(id => ({id, rev: 1, fields: Object.fromEntries(fields.map(name => [name, items.get(id).fields[name]]))}))};},
    async read(route) {const id = Number(route.match(/workitems\/(\d+)/)[1]); calls.push(['content', id]); return structuredClone(items.get(id));}};
  return {client, calls, types, states, items, source: createAdoContextSource(client)};
}
test('missing policy discovers live metadata but cannot query or ingest content', async () => {
  const f = project(), result = await f.source.retrieve({});
  assert.equal(result.status, 'SELECTION_REQUIRED'); assert.equal(result.metadata.types.length, 2);
  assert(result.choices.some(choice => choice.label === 'Exclude nothing'));
  assert(f.calls.every(call => call[0] === 'metadata'));
});
test('explicit empty exclusions retain completed/custom work and apply scope before content', async () => {
  const f = project(), result = await f.source.retrieve({policy: empty(), scope: {areaPath: 'demo\\Checkout'}});
  assert.equal(result.status, 'READY'); assert.deepEqual(result.items.map(item => item.id), [1, 2, 3, 4]);
  assert.equal(result.selection.includedCount, 4); assert.equal(result.selection.excludedCount, 0);
  assert(f.calls.find(call => call[0] === 'query')[1].includes("[System.AreaPath] UNDER 'demo\\Checkout'"));
  assert(f.calls.findIndex(call => call[0] === 'classify') < f.calls.findIndex(call => call[0] === 'content'));
});
test('exclusions win; global and type-scoped state identity stay distinct', async () => {
  const f = project(), result = await f.source.retrieve({policy: {...empty(), includeTypes: ['Custom.Request', 'Custom.Decision'], excludeStates: [{type: 'Custom.Request', states: ['drop']}, {type: '*', states: ['Ouvert']} ]}});
  assert.deepEqual(result.items.map(item => item.id), [1]); assert.equal(result.selection.excludedCount, 3);
  assert.deepEqual(f.calls.filter(call => call[0] === 'content').map(call => call[1]), [1]);
  const g = project(), scoped = await g.source.retrieve({policy: {...empty(), excludeStates: [{type: 'Custom.Request', states: ['open']}]}});
  assert.deepEqual(scoped.items.map(item => item.id), [1, 2, 3]);
});
test('empty inclusions select zero without ingesting item or attachment content', async () => {
  const f = project(), result = await f.source.retrieve({policy: {...empty(), includeTypes: []}});
  assert.equal(result.selection.includedCount, 0); assert.equal(result.selection.excludedCount, 4); assert.deepEqual(result.items, []);
  assert(!f.calls.some(call => call[0] === 'content'));
});
test('new metadata follows include/exclude semantics; removed selectors require repair before querying', async () => {
  const f = project(), first = await f.source.retrieve({policy: {...empty(), excludeStates: [{type: 'Custom.Request', states: ['drop']}]}});
  f.states.Demande.push({id: 'new', name: 'Nouveau'}); f.items.get(4).fields['System.State'] = 'Nouveau';
  const next = await f.source.retrieve({policy: first.policy, previousMetadata: first.metadata});
  assert(next.metadataChanges.added.length > 0); assert(next.items.some(item => item.id === 4));
  const included = await f.source.retrieve({policy: {...empty(), includeStates: [{type: 'Custom.Request', states: ['done']}]}});
  assert.deepEqual(included.items.map(item => item.id), [1]);
  f.states.Demande = f.states.Demande.filter(state => state.id !== 'drop'); const before = f.calls.length;
  const broken = await f.source.retrieve({policy: first.policy}); assert.equal(broken.status, 'POLICY_REPAIR_REQUIRED'); assert(broken.repairs.length);
  assert(!f.calls.slice(before).some(call => ['query', 'classify', 'content'].includes(call[0])));
});
test('another custom schema works without conventional type/state names', async () => {
  const f = project(); f.types.splice(0, 2, {name: 'قرار', referenceName: 'Team.Decision'}); f.states['قرار'] = [{name: 'مقبول'}, {name: 'مؤجل'}];
  f.items.clear(); f.items.set(9, {id: 9, rev: 2, fields: {'System.TeamProject': 'demo', 'System.WorkItemType': 'قرار', 'System.State': 'مقبول', 'System.Title': 'قرار'}});
  const result = await f.source.retrieve({policy: {...empty(), excludeStates: [{type: 'Team.Decision', states: ['مؤجل']}]}});
  assert.deepEqual(result.items.map(item => item.id), [9]);
});
test('invalid policy structure, unknown values and WIQL injection cannot expand scope', async () => {
  assert.throws(() => validateContextPolicy({}), /policy/i);
  const f = project(); await assert.rejects(f.source.retrieve({policy: empty(), scope: {areaPath: "demo' OR [System.Id] > 0"}}));
  const result = await f.source.retrieve({policy: {...empty(), excludeTypes: ['Unknown']}}); assert.equal(result.status, 'POLICY_REPAIR_REQUIRED');
});
test('application scope is rechecked after query and after classification before accepting content', async () => {
  const f = project(), wiql = f.client.wiql;
  f.client.wiql = async query => {const result = await wiql(query); f.items.get(1).fields['System.AreaPath'] = 'demo\\Other'; return result;};
  const result = await f.source.retrieve({policy: empty(), scope: {areaPath: 'demo\\Checkout'}});
  assert.deepEqual(result.items.map(item => item.id), [2, 3, 4]); assert.equal(result.selection.items.find(item => item.id === 1).reason, 'outside-area-scope'); assert(!f.calls.some(call => call[0] === 'content' && call[1] === 1));
  const g = project(), batch = g.client.workItems;
  g.client.workItems = async (...args) => {const result = await batch(...args); g.items.get(1).fields['System.AreaPath'] = 'demo\\Other'; return result;};
  await assert.rejects(g.source.retrieve({policy: empty(), scope: {areaPath: 'demo\\Checkout'}}), /scope/i);
});
