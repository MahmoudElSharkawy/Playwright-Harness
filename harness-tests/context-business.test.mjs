import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync, readFileSync, existsSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fixture} from './fixtures/execution-core.mjs';
import {updateContext, readContext, readContextOverview, searchContext} from '../scripts/lib/context/index.mjs';
import {createAdoContextSource} from '../scripts/lib/integrations/ado-context.mjs';
import {prepareSnapshot, storeFor} from '../scripts/lib/context/storage.mjs';
import {buildIndex} from '../scripts/lib/context/search.mjs';
import {fingerprint, digest} from '../scripts/lib/execution-core/data.mjs';

const request = (ado, sources = []) => ({version: 1, contextId: 'business', identity: {project: 'shop'}, scope: {application: 'shop', environment: 'qa'}, sources, ...(ado ? {ado} : {})});
const file = (id, path) => ({id, kind: 'file', path});
const put = (roots, path, text) => {const target = join(roots.projectRoot, path); mkdirSync(dirname(target), {recursive: true}); writeFileSync(target, text);};
const current = roots => join(roots.projectRoot, '.harness/context/business/current.json');
const policy = {excludeTypes: [], excludeStates: []};
const attachmentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const attachment = {id: `stories-attachment-1-${attachmentId}`, attachmentId};
function project() {
  const calls = [], items = new Map();
  const add = (id, state = 'Active') => items.set(id, {id, rev: 1, fields: {'System.TeamProject': 'shop', 'System.AreaPath': 'shop\\Checkout', 'System.WorkItemType': 'Story', 'System.State': state, 'System.Title': `Checkout ${id}`, 'System.Description': `Customer checks out order ${id}`, 'Microsoft.VSTS.Common.AcceptanceCriteria': `Payment ${id} requires a delivery address.`}, relations: []});
  add(1); add(2);
  items.get(1).relations = [{rel: 'AttachedFile', url: `https://ado.example.test/shop/_apis/wit/attachments/${attachmentId}`, attributes: {name: 'Checkout requirements.txt'}}, {rel: 'System.LinkTypes.Related', url: 'https://ado.example.test/shop/_apis/wit/workItems/2'}];
  const client = {configuration: {organizationUrl: 'https://ado.example.test', project: 'shop', context: {sources: {stories: {scope: {areaPath: 'shop\\Checkout'}, policy}}}},
    async projectIdentity() {return {id: '11111111-1111-4111-8111-111111111111', name: 'shop'};},
    async requireWorkItemProject(item) {assert.equal(item.fields['System.TeamProject'], 'shop');},
    async list(route) {return route.includes('/states?') ? [{id: 'active', name: 'Active'}, {id: 'closed', name: 'Closed'}] : [{name: 'Story', referenceName: 'Custom.Story'}];},
    async wiql(query) {calls.push(['query']); const after = Number(query.match(/\[System.Id\] > (\d+)/)[1]); return {workItems: [...items.keys()].filter(id => id > after).map(id => ({id}))};},
    async workItems(ids, fields) {calls.push(['classify', ids]); return {value: ids.filter(id => items.has(id)).map(id => ({id, rev: items.get(id).rev, fields: Object.fromEntries(fields.map(key => [key, key === 'System.Rev' ? items.get(id).rev : items.get(id).fields[key]]))}))};},
    async read(route) {const id = Number(route.match(/workitems\/(\d+)/)[1]); calls.push(['content', id]); return structuredClone(items.get(id));},
    async attachment(id) {calls.push(['attachment', id]); return Buffer.from('Checkout document: payment requires an address.');}};
  return {client, items, calls, add};
}

test('fixed IDs fetch only selected items without WIQL or implicit attachment downloads', async t => {
  const {roots} = fixture(t), f = project();
  const result = await updateContext(roots, request({sourceId: 'stories', scope: {workItemIds: [1]}}), {client: f.client});
  assert.equal(result.status, 'READY'); assert.equal(result.snapshot.status, 'complete');
  assert(!f.calls.some(([kind]) => ['query', 'attachment'].includes(kind)));
  assert.deepEqual(f.calls.filter(([kind]) => kind === 'content').map(([, id]) => id), [1]);
  assert(result.snapshot.facts.some(fact => fact.text.includes('requires a delivery address')));
  assert.equal(searchContext(roots, 'business', {workItemId: 2}).total, 0);
  assert.equal(result.snapshot.sources[0].availableAttachments[0].attachmentId, attachmentId);
});

test('saved criteria discover new matching items; exact selection remains fixed across refresh', async t => {
  const {roots} = fixture(t), f = project();
  const criteria = {...policy, includeStates: [{type: 'Custom.Story', states: ['active']}]};
  await updateContext(roots, request({sourceId: 'stories', policy: criteria}), {client: f.client});
  f.add(3); f.add(4, 'Closed'); f.items.get(1).rev++; f.items.get(1).fields['System.Description'] = 'Updated checkout rule';
  // Configuration drift must not silently replace the selection saved in this context.
  f.client.configuration.context.sources.stories.policy = {...policy, includeTypes: []}; f.calls.length = 0;
  const next = await updateContext(roots, {version: 1, contextId: 'business'}, {client: f.client});
  assert.equal(next.status, 'READY'); assert.equal(next.snapshot.selections.stories.includedCount, 3);
  assert(next.snapshot.facts.some(fact => fact.text === 'Updated checkout rule'));
  assert.deepEqual(f.calls.filter(([kind]) => kind === 'content').map(([, id]) => id), [1, 3]);
  await updateContext(roots, request({sourceId: 'stories', scope: {workItemIds: [1]}, policy}), {client: f.client});
  f.add(5); f.calls.length = 0;
  await updateContext(roots, {version: 1, contextId: 'business'}, {client: f.client});
  assert(!f.calls.some(([kind]) => kind === 'query'));
  assert.deepEqual(readContext(roots, 'business').selections.stories.scope.workItemIds, [1]);
  assert.equal(searchContext(roots, 'business', {workItemId: 3}).total, 0);
});

test('attachment selection can change on unchanged parents and is saved for later refresh', async t => {
  const {roots} = fixture(t), f = project(), selected = {sourceId: 'stories', scope: {workItemIds: [1]}};
  await updateContext(roots, request(selected), {client: f.client}); f.calls.length = 0;
  await updateContext(roots, request({...selected, attachments: [attachment]}), {client: f.client});
  assert.equal(f.calls.filter(([kind]) => kind === 'attachment').length, 1);
  assert(searchContext(roots, 'business', {workItemId: 1}).results.some(hit => hit.sourceId === attachment.id));
  await updateContext(roots, {version: 1, contextId: 'business'}, {client: f.client});
  assert.equal(readContext(roots, 'business').selections.stories.attachments.length, 1);
  await updateContext(roots, request({...selected, attachments: []}), {client: f.client});
  assert.equal(searchContext(roots, 'business', {sourceId: attachment.id}).total, 0);
});

test('search item filters are strict and citations name business sources and fields', async t => {
  const {roots} = fixture(t), f = project(); await updateContext(roots, request({sourceId: 'stories'}), {client: f.client});
  const result = searchContext(roots, 'business', {workItemId: 1, query: 'payment', limit: 25});
  assert(result.results.length > 0); assert(result.results.every(hit => hit.workItemId === 1));
  const acceptance = result.results.find(hit => hit.location.endsWith('AcceptanceCriteria'));
  assert.match(acceptance.citation.label, /Checkout 1/); assert.equal(acceptance.citation.location, 'Acceptance criteria');
  assert.match(acceptance.citation.url, /_workitems\/edit\/1$/);
});

test('new repository sources are rejected and mixed legacy evidence is hidden in every retrieval path', async t => {
  const {roots} = fixture(t); put(roots, 'guide.txt', 'Customers can pay by card.');
  await assert.rejects(updateContext(roots, request(undefined, [{id: 'pom', kind: 'repository', path: 'src/page.ts'}])), /business|repository/i);
  const result = await updateContext(roots, request(undefined, [file('guide', 'guide.txt')]));
  // Simulate a previously stored technical source with the unchanged storage/index format.
  const snapshot = structuredClone(result.snapshot);
  snapshot.sources.push({id: 'old-pom', kind: 'repository', path: 'src/page.ts', status: 'verified', contributions: [{topic: 'technical', text: 'HiddenConstructor payment', location: 'line 1', authority: 'current'}]});
  const prepared = prepareSnapshot(roots, snapshot); prepared.manifest.index = buildIndex(roots, prepared, snapshot); prepared.manifest.revision = fingerprint(prepared.manifest); writeFileSync(current(roots), JSON.stringify(prepared.manifest));
  const before = readFileSync(current(roots));
  for (const filter of [{query: 'HiddenConstructor'}, {sourceId: 'old-pom'}, {topic: 'technical'}]) assert.equal(searchContext(roots, 'business', filter).total, 0);
  assert(searchContext(roots, 'business', {query: 'payment'}).results.every(hit => hit.sourceId !== 'old-pom'));
  assert.deepEqual(searchContext(roots, 'business', {catalog: 'sources'}).results.map(source => source.id), ['guide']);
  assert.equal(readContextOverview(roots, 'business').counts.sources, 1);
  assert.deepEqual(readFileSync(current(roots)), before);
});

test('refresh by context ID rereads selected documents without scanning repository files', async t => {
  const {roots} = fixture(t); put(roots, 'guide.txt', 'Old payment rule');
  await updateContext(roots, request(undefined, [file('guide', 'guide.txt')]));
  put(roots, 'guide.txt', 'New payment rule'); put(roots, 'unselected.txt', 'UnselectedRule');
  const result = await updateContext(roots, {version: 1, contextId: 'business'});
  assert.deepEqual(result.snapshot.facts.map(fact => fact.text), ['New payment rule']);
  assert.equal(searchContext(roots, 'business', {query: 'UnselectedRule'}).total, 0);
});

test('fixed IDs reject invalid selections and preserve missing selected evidence as stale', async t => {
  const f = project(), source = createAdoContextSource(f.client);
  for (const ids of [[1, 1], [0], ['1'], [-1], [1.5]]) await assert.rejects(source.retrieve({scope: {workItemIds: ids}}));
  const {roots} = fixture(t); await updateContext(roots, request({sourceId: 'stories', scope: {workItemIds: [1]}}), {client: f.client});
  f.items.delete(1);
  const result = await updateContext(roots, {version: 1, contextId: 'business'}, {client: f.client});
  assert.equal(result.snapshot.status, 'partial'); assert(result.snapshot.facts.every(fact => fact.status === 'stale'));
});

test('an unavailable initial selection cannot publish a context that cannot be refreshed', async t => {
  const {roots} = fixture(t), f = project(); f.client.list = async () => {throw new Error('Unavailable');};
  await assert.rejects(updateContext(roots, request({sourceId: 'stories', scope: {workItemIds: [1]}}), {client: f.client}), /verify.*selection/i);
  assert.equal(existsSync(current(roots)), false);
});

test('new attachment selection must belong to a selected item; removed saved links withdraw support', async t => {
  const {roots} = fixture(t), f = project(), selected = {sourceId: 'stories', scope: {workItemIds: [1]}};
  await updateContext(roots, request({...selected, attachments: [attachment]}), {client: f.client});
  const before = readFileSync(current(roots)), other = {...attachment, id: attachment.id.replace('-1-', '-2-')}; f.calls.length = 0;
  await assert.rejects(updateContext(roots, request({...selected, attachments: [other]}), {client: f.client}), /selection/i);
  assert.deepEqual(readFileSync(current(roots)), before); assert(!f.calls.some(([kind]) => kind === 'attachment'));
  f.items.get(1).rev++; f.items.get(1).relations = [];
  await updateContext(roots, {version: 1, contextId: 'business'}, {client: f.client});
  assert.equal(searchContext(roots, 'business', {sourceId: attachment.id}).total, 0);
  assert.equal(readContextOverview(roots, 'business').coverage, 'complete');
});

const extraction = text => ({hash: digest(text), reader: 'business-document-reader', coverage: 'complete', parts: [{topic: 'refund.deadline', location: 'section Refunds', text}]});
test('saved document refresh preserves explicit topics/locations and requires extraction for changed bytes', async t => {
  const {roots} = fixture(t), texts = ['Refunds within 14 days.', 'Refunds within 30 days.'];
  const sources = texts.map((text, i) => {put(roots, `refund-${i}.txt`, text); return {...file(`refund-${i}`, `refund-${i}.txt`), authority: 'observation', extraction: extraction(text)};});
  const first = await updateContext(roots, request(undefined, sources));
  const refreshed = await updateContext(roots, {version: 1, contextId: 'business'});
  const meaning = facts => facts.map(({id, topic, text, status}) => ({id, topic, text, status}));
  assert.deepEqual(meaning(refreshed.snapshot.facts), meaning(first.snapshot.facts));
  for (const source of refreshed.snapshot.sources) assert.deepEqual(source.contributions, first.snapshot.sources.find(previous => previous.id === source.id).contributions);
  const changed = 'Refunds within 45 days.'; put(roots, sources[0].path, changed);
  const stale = await updateContext(roots, {version: 1, contextId: 'business'});
  assert.equal(stale.snapshot.sources[0].coverage, 'reader-required'); assert.equal(stale.snapshot.sources[0].attemptedHash, digest(changed));
  assert.equal(searchContext(roots, 'business', {topic: 'refund.deadline'}).total, 2);
  await updateContext(roots, request(undefined, [{...sources[0], extraction: extraction(changed)}]));
  assert(searchContext(roots, 'business', {topic: 'refund.deadline'}).results.some(hit => hit.excerpt === changed));
});

test('saved attachment refresh preserves explicit extraction even for native formats', async t => {
  const {roots} = fixture(t), f = project(), text = 'Refunds within 14 days.';
  f.client.attachment = async () => Buffer.from(text);
  const selected = {sourceId: 'stories', scope: {workItemIds: [1]}, attachments: [{...attachment, extraction: extraction(text)}]};
  await updateContext(roots, request(selected), {client: f.client});
  await updateContext(roots, {version: 1, contextId: 'business'}, {client: f.client});
  const source = readContext(roots, 'business').sources.find(source => source.id === attachment.id);
  assert.equal(source.contributions[0].topic, 'refund.deadline'); assert.equal(source.contributions[0].location, 'section Refunds');
  f.items.get(1).rev++; f.client.attachment = async () => Buffer.from('Changed attachment bytes');
  await updateContext(roots, {version: 1, contextId: 'business'}, {client: f.client});
  const stale = readContext(roots, 'business').sources.find(source => source.id === attachment.id);
  assert.equal(stale.coverage, 'reader-required'); assert.equal(stale.contributions[0].text, text);
});

test('catalog pages skip inactive sources and do not hydrate earlier or later evidence pages', async t => {
  const {roots} = fixture(t), sources = Array.from({length: 12}, (_, i) => file(`guide-${i}`, `guide-${i}.txt`));
  for (const source of sources) put(roots, source.path, 'Customer guide');
  await updateContext(roots, request(undefined, sources));
  await updateContext(roots, request(undefined, sources.slice(0, 3).map(source => ({id: source.id, status: 'removed'}))));
  const manifest = JSON.parse(readFileSync(current(roots))), store = storeFor(roots, manifest);
  const active = [...store.entries(manifest.catalogs.sources)].filter(entry => store.source(entry.ref, false).status !== 'removed');
  const objectPath = ref => `.harness/context/business/objects/${ref.slice(0, 2)}/${ref}.json`;
  const lastPath = objectPath(active.at(-1).ref), lastBytes = readFileSync(join(roots.projectRoot, lastPath));
  put(roots, lastPath, 'Unreadable later-page object');
  const first = searchContext(roots, 'business', {catalog: 'sources', limit: 3}); assert.equal(first.total, 9); assert.equal(first.results.length, 3);
  put(roots, lastPath, lastBytes); put(roots, objectPath(active[0].ref), 'Unreadable earlier-page object');
  const second = searchContext(roots, 'business', {catalog: 'sources', limit: 3, cursor: first.cursor});
  const third = searchContext(roots, 'business', {catalog: 'sources', limit: 3, cursor: second.cursor});
  assert.equal(new Set([...first.results, ...second.results, ...third.results].map(source => source.id)).size, 9);
  assert.equal(third.omitted, 0); assert.equal(third.cursor, null);
});

for (const kind of ['file', 'attachment']) test(`an initially unavailable ${kind} can recover through its native reader`, async t => {
  const {roots} = fixture(t), f = project(), text = 'Recovered business requirement';
  f.client.attachment = async () => {throw new Error('Unavailable');};
  const input = kind === 'file' ? request(undefined, [file('guide', 'guide.txt')]) : request({sourceId: 'stories', scope: {workItemIds: [1]}, attachments: [attachment]});
  const first = await updateContext(roots, input, {client: f.client}); assert.equal(first.snapshot.status, 'partial');
  if (kind === 'file') put(roots, 'guide.txt', text); else f.client.attachment = async () => Buffer.from(text);
  const recovered = await updateContext(roots, {version: 1, contextId: 'business'}, {client: f.client});
  assert.equal(recovered.snapshot.status, 'complete'); assert(recovered.snapshot.facts.some(fact => fact.text === text));
});
