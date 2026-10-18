import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync, statSync, existsSync, copyFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fixture} from './fixtures/execution-core.mjs';
import {updateContext, retrieveContext, readContext, readContextOverview, searchContext, exportContext} from '../scripts/lib/context/index.mjs';
import {digest, fingerprint} from '../scripts/lib/execution-core/data.mjs';
import {storeFor, loadSnapshot} from '../scripts/lib/context/storage.mjs';

const put = (roots, path, value) => {const file = join(roots.projectRoot, path); mkdirSync(dirname(file), {recursive: true}); writeFileSync(file, value); return file;};
const request = (sources = [], contextId = 'checkout') => ({version: 1, contextId, identity: {project: 'demo'}, scope: {application: 'checkout', environment: 'qa'}, sources});
const source = (id, path, extra = {}) => ({id, kind: 'file', path, ...extra});
const current = roots => join(roots.projectRoot, '.harness/context/checkout/current.json');

export function adoFixture() {
  const calls = [], project = {id: '11111111-1111-4111-8111-111111111111', name: 'demo'};
  const attachmentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const items = new Map([1, 2, 3].map(id => [id, {id, rev: 1, fields: {'System.TeamProject': 'demo', 'System.AreaPath': 'demo\\Checkout', 'System.WorkItemType': 'Story', 'System.State': 'Active', 'System.Title': `Checkout story ${id}`, 'System.Description': `Requirements for payment ${id}`}, relations: []}]));
  items.get(1).relations = [{rel: 'System.LinkTypes.Hierarchy-Forward', url: 'https://ado.example.test/demo/_apis/wit/workItems/2'}, {rel: 'AttachedFile', url: `https://ado.example.test/demo/_apis/wit/attachments/${attachmentId}`, attributes: {name: 'guide.txt'}}];
  const client = {configuration: {organizationUrl: 'https://ado.example.test', project: 'demo', credentialRef: 'ADO_ACCESS', context: {sources: {backlog: {policy: {excludeTypes: [], excludeStates: []}, scope: {areaPath: 'demo\\Checkout'}}}}},
    async projectIdentity() {calls.push(['identity']); return structuredClone(project);},
    async requireWorkItemProject(item) {assert.equal(item.fields['System.TeamProject'], project.name);},
    async list(route) {calls.push(['metadata']); return route.includes('/states?') ? [{id: 'active', name: 'Active'}, {id: 'closed', name: 'Closed'}] : [{name: 'Story', referenceName: 'Custom.Story'}];},
    async wiql(query) {calls.push(['query']); const cursor = Number(query.match(/\[System.Id\] > (\d+)/)[1]); return {workItems: [...items.keys()].filter(id => id > cursor).slice(0, 200).map(id => ({id}))};},
    async workItems(ids, fields) {calls.push(['classify', ids]); return {value: ids.map(id => ({id, rev: items.get(id).rev, fields: Object.fromEntries(fields.map(key => [key, key === 'System.Rev' ? items.get(id).rev : items.get(id).fields[key]]))}))};},
    async read(route) {const id = Number(route.match(/workitems\/(\d+)/i)[1]); calls.push(['content', id]); return structuredClone(items.get(id));},
    async attachment(id) {calls.push(['attachment', id]); return Buffer.from('Attachment payment evidence');}};
  return {client, project, items, calls, attachmentId};
}

test('v2 stores large evidence outside a bounded manifest; search and export preserve exact text and origins', async t => {
  const {roots} = fixture(t), text = Array.from({length: 180}, (_, n) => `Section ${n} checkout payment ${'details '.repeat(950)}`).join('\n');
  put(roots, 'large.txt', text); const result = await updateContext(roots, request([source('large', 'large.txt')]));
  const manifest = JSON.parse(readFileSync(current(roots))); assert.equal(manifest.version, 2); assert(statSync(current(roots)).size < 65536); assert.equal(manifest.sources, undefined); assert.equal(manifest.facts, undefined);
  assert.equal(result.snapshot.status, 'complete');
  const page = searchContext(roots, 'checkout', {query: 'payment'}); assert(page.results.length > 0 && page.results.length <= 8); assert(Buffer.byteLength(JSON.stringify(page)) <= 16384); assert(page.omitted > 0);
  assert(page.results.every(hit => hit.sourceId === 'large' && hit.chunkId && hit.factId && hit.location && hit.revision));
  exportContext(roots, 'checkout', 'export.json'); const exported = JSON.parse(readFileSync(join(roots.projectRoot, 'export.json')));
  assert.equal(exported.sources[0].contributions.map(part => part.text).join('\n'), text); assert.equal(exported.facts.length, 180);
});

test('search normalizes Arabic, preserves evidence, paginates deterministically and never falls back to unrelated facts', async t => {
  const {roots} = fixture(t); put(roots, 'arabic.txt', 'إِدَارَةُ الْمَدْفُوعَاتِ\nطلب آمن'); put(roots, 'many.txt', Array.from({length: 40}, (_, n) => `Payment requirement ${n}`).join('\n'));
  await updateContext(roots, request([source('arabic', 'arabic.txt'), source('many', 'many.txt')]));
  const arabic = searchContext(roots, 'checkout', {query: 'ادارة المدفوعات'}); assert(arabic.results[0].excerpt.includes('إِدَارَةُ'));
  assert.equal(searchContext(roots, 'checkout', {query: 'unrepresentedword'}).results.length, 0);
  const first = searchContext(roots, 'checkout', {query: 'payment', limit: 3}); const second = searchContext(roots, 'checkout', {query: 'payment', limit: 3, cursor: first.cursor});
  assert.equal(first.results.length, 3); assert.equal(second.results.length, 3); assert(!second.results.some(b => first.results.some(a => a.chunkId === b.chunkId)));
  assert.deepEqual(second, searchContext(roots, 'checkout', {query: 'payment', limit: 3, cursor: first.cursor}));
  assert.throws(() => searchContext(roots, 'checkout', {query: 'checkout', cursor: first.cursor}), /cursor/i);
  put(roots, 'many.txt', 'Payment changed'); await updateContext(roots, request([source('many', 'many.txt')]));
  assert.throws(() => searchContext(roots, 'checkout', {query: 'payment', limit: 3, cursor: first.cursor}), /cursor/i);
});

test('captured search reads no original source or credentials and missing indexes require explicit update', async t => {
  const {roots} = fixture(t); put(roots, 'guide.txt', 'Captured payment'); await updateContext(roots, request([source('guide', 'guide.txt')]));
  put(roots, '.harness/integrations.json', 'broken'); unlinkSync(join(roots.projectRoot, 'guide.txt'));
  const before = readFileSync(current(roots)); assert.equal(searchContext(roots, 'checkout', {query: 'payment'}).results.length, 1); assert.deepEqual(readFileSync(current(roots)), before);
  const manifest = JSON.parse(before); unlinkSync(join(dirname(current(roots)), manifest.index.path));
  assert.throws(() => searchContext(roots, 'checkout', {query: 'payment'}), /index.*update/i); assert.deepEqual(readFileSync(current(roots)), before);
});

test('unchanged files reuse extraction; changed receipts remain hash-bound; custom notes have recoverable history', async t => {
  const {roots} = fixture(t); put(roots, 'guide.docx', 'fixture'); let reads = 0;
  const readers = {docx: async ({hash}) => {reads++; return {hash, reader: 'fixture', coverage: 'complete', parts: [{location: 'section 1', text: 'Document payment'}]};}};
  const input = request([source('guide', 'guide.docx')]); await updateContext(roots, input, {readers, now: '2026-10-01T00:00:00Z'});
  const first = JSON.parse(readFileSync(current(roots))); put(roots, '.harness/context/checkout/custom.json', JSON.stringify({note: 'Owner note'}));
  await updateContext(roots, input, {readers, now: '2026-10-02T00:00:00Z'}); assert.equal(reads, 1); const second = JSON.parse(readFileSync(current(roots))); assert.deepEqual(second.index, first.index); assert.deepEqual(readContext(roots, 'checkout').custom, {note: 'Owner note'});
  put(roots, 'guide.docx', 'changed'); await assert.rejects(updateContext(roots, request([source('guide', 'guide.docx', {extraction: {hash: digest('fixture'), reader: 'fixture', coverage: 'complete', parts: [{location: 'section 1', text: 'Wrong'}]}})])), /hash/i);
  assert(readdirSync(join(dirname(current(roots)), 'history')).includes(second.revision + '.json'));
});

test('ADO refresh verifies membership/revisions and downloads only changed content, with stable project isolation', async t => {
  const {roots} = fixture(t), f = adoFixture(), input = {...request(), ado: {sourceId: 'backlog'}};
  await updateContext(roots, input, {client: f.client, now: '2026-10-01T00:00:00Z'}); f.calls.length = 0;
  await updateContext(roots, input, {client: f.client, now: '2026-10-02T00:00:00Z'});
  assert(f.calls.some(call => call[0] === 'classify')); assert(!f.calls.some(call => ['content', 'attachment'].includes(call[0])));
  assert.equal(readContext(roots, 'checkout').sources.find(s => s.kind === 'attachment').verifiedAt, '2026-10-01T00:00:00Z');
  f.items.get(2).rev++; f.calls.length = 0; await updateContext(roots, input, {client: f.client}); assert.deepEqual(f.calls.filter(c => c[0] === 'content').map(c => c[1]), [2]); assert(!f.calls.some(c => c[0] === 'attachment'));
  const exact = searchContext(roots, 'checkout', {workItemId: 1}); assert.equal(exact.results[0].workItemId, 1); assert(exact.results.some(r => r.workItemId === 2 && r.match === 'relation'));
  f.project.id = '22222222-2222-4222-8222-222222222222'; f.calls.length = 0; const before = readFileSync(current(roots));
  await assert.rejects(updateContext(roots, input, {client: f.client}), /project.*(identity|differs|mismatch)/i); assert(!f.calls.some(c => ['metadata', 'query', 'content', 'attachment'].includes(c[0]))); assert.deepEqual(readFileSync(current(roots)), before);
});

test('ADO attachment reuse checks the current reader recipe even when the parent revision is unchanged', async t => {
  const {roots} = fixture(t), f = adoFixture(), input = {...request(), ado: {sourceId: 'backlog'}};
  f.items.get(1).relations.find(relation => relation.rel === 'AttachedFile').attributes.name = 'guide.docx';
  const read = version => Object.assign(async ({hash}) => ({hash, reader: version, coverage: 'complete', parts: [{location: 'section 1', text: `Attachment extraction ${version}`}]}), {recipe: version});
  await updateContext(roots, input, {client: f.client, readers: {docx: read('docx-v1')}, now: '2026-10-01T00:00:00Z'});
  f.calls.length = 0;
  await updateContext(roots, input, {client: f.client, readers: {docx: read('docx-v2')}, now: '2026-10-02T00:00:00Z'});
  assert.deepEqual(f.calls.filter(call => call[0] === 'content').map(call => call[1]), [1]);
  assert.equal(f.calls.filter(call => call[0] === 'attachment').length, 1);
  const attachment = readContext(roots, 'checkout').sources.find(item => item.kind === 'attachment');
  assert.equal(attachment.reader, 'docx-v2'); assert.equal(attachment.verifiedAt, '2026-10-02T00:00:00Z');
  assert.equal(attachment.contributions[0].text, 'Attachment extraction docx-v2');
  f.calls.length = 0;
  await updateContext(roots, input, {client: f.client, readers: {docx: read('docx-v2')}, now: '2026-10-03T00:00:00Z'});
  assert(!f.calls.some(call => ['content', 'attachment'].includes(call[0])));
  assert.equal(readContext(roots, 'checkout').sources.find(item => item.kind === 'attachment').verifiedAt, attachment.verifiedAt);
});

test('staging rechecks cached local bytes and repairs a changed staged copy without changing the saved snapshot', async t => {
  const {roots} = fixture(t), f = adoFixture(), input = {...request(), ado: {sourceId: 'backlog'}};
  await updateContext(roots, input, {client: f.client, stageAttachments: true});
  const before = readFileSync(current(roots)), attachment = readContext(roots, 'checkout').sources.find(item => item.kind === 'attachment');
  put(roots, attachment.localPath, 'Changed local bytes'); f.calls.length = 0;
  const staged = await retrieveContext(roots, input, {client: f.client, stageAttachments: true});
  const repaired = staged.snapshot.sources.find(item => item.kind === 'attachment');
  assert(f.calls.some(call => call[0] === 'attachment'));
  assert.equal(digest(readFileSync(join(roots.projectRoot, repaired.localPath))), repaired.hash);
  assert.deepEqual(readFileSync(current(roots)), before); assert.equal(staged.saved, false);
});

test('CLI save exposes staged attachment paths beyond the preview through every bounded catalog page', async t => {
  const {roots} = fixture(t), input = {...request(), ado: {sourceId: 'backlog'}};
  put(roots, 'request.json', JSON.stringify(input));
  put(roots, '.harness/integrations.json', JSON.stringify({version: 1, ado: {organizationUrl: 'https://ado.example.test', project: 'demo', credentialRef: 'ADO_ACCESS', context: {sources: {backlog: {policy: {excludeTypes: [], excludeStates: []}}}}}}));
  function transport(url, options) {
    const attachmentId = id => `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`;
    const item = id => ({id, rev: 1, fields: {'System.Id': id, 'System.Rev': 1, 'System.TeamProject': 'demo', 'System.WorkItemType': 'Story', 'System.State': 'Active', 'System.Title': `Story ${id}`}, relations: id > 8 ? [{rel: 'AttachedFile', url: `https://ado.example.test/demo/_apis/wit/attachments/${attachmentId(id)}`, attributes: {name: 'guide.docx'}}] : []});
    if (url.includes('/attachments/')) return new Response('Synthetic document bytes');
    const body = url.includes('/projects/') ? {id: '11111111-1111-4111-8111-111111111111', name: 'demo'}
      : url.includes('/states?') ? {value: [{name: 'Active'}]}
      : url.includes('/workitemtypes?') ? {value: [{name: 'Story', referenceName: 'Custom.Story'}]}
      : url.includes('/wiql?') ? {workItems: Array.from({length: 20}, (_, index) => ({id: index + 1})).filter(entry => entry.id > Number(JSON.parse(options.body).query.match(/\[System.Id\] > (\d+)/)[1]))}
      : url.includes('/workitemsbatch?') ? {value: JSON.parse(options.body).ids.map(item)}
      : item(Number(url.match(/workitems\/(\d+)/i)[1]));
    return new Response(JSON.stringify(body));
  }
  const mock = 'data:text/javascript,' + encodeURIComponent('globalThis.fetch = ' + transport.toString());
  const cli = (...args) => spawnSync(process.execPath, ['--import', mock, join(roots.packageRoot, 'scripts/project-context.mjs'), ...args, '--project-root', roots.projectRoot], {encoding: 'utf8', windowsHide: true, env: {...process.env, ADO_ACCESS: crypto.randomUUID()}});
  const staged = cli('stage', '--request', 'request.json'); assert.equal(staged.status, 2, staged.stderr); assert(!existsSync(current(roots))); assert(Buffer.byteLength(staged.stdout) <= 16384);
  const saved = cli('update', '--request', 'request.json'); assert.equal(saved.status, 2, saved.stderr); assert.equal(JSON.parse(saved.stdout).saved, true);
  const receipts = []; let cursor;
  do {
    const page = cli('search', '--id', 'checkout', '--catalog', 'sources', '--limit', '3', ...(cursor ? ['--cursor', cursor] : []));
    assert.equal(page.status, 0, page.stderr); assert(Buffer.byteLength(page.stdout) <= 16384);
    const result = JSON.parse(page.stdout); assert(result.results.length <= 3); receipts.push(...result.results); cursor = result.cursor;
  } while (cursor);
  assert.equal(receipts.length, 32); const attachments = receipts.filter(item => item.kind === 'attachment'); assert.equal(attachments.length, 12);
  for (const attachment of attachments) {
    assert(attachment.localPath, 'Every saved attachment must expose its staged bytes to the host reader.');
    assert.equal(digest(readFileSync(join(roots.projectRoot, attachment.localPath))), attachment.hash);
  }
});

test('CLI live metadata pages expose every type/state before policy selection and reject changed-metadata cursors', t => {
  const {roots} = fixture(t), input = {...request(), ado: {sourceId: 'backlog'}};
  put(roots, 'request.json', JSON.stringify(input));
  const configuration = JSON.stringify({version: 1, ado: {organizationUrl: 'https://ado.example.test', project: 'demo', credentialRef: 'ADO_ACCESS'}});
  put(roots, '.harness/integrations.json', configuration);
  function transport(url) {
    const body = url.includes('/projects/') ? {id: '11111111-1111-4111-8111-111111111111', name: 'demo'}
      : url.includes('/states?') ? {value: Array.from({length: process.env.CHANGED_METADATA ? 10 : 9}, (_, index) => ({id: 'state-' + (index + 1), name: 'State ' + (index + 1)}))}
      : url.includes('/workitemtypes?') ? {value: Array.from({length: 9}, (_, index) => ({referenceName: 'Custom.Type' + (index + 1), name: 'Type ' + (index + 1)}))} : undefined;
    if (!body) throw new Error('Metadata discovery must not read work items or attachments.');
    return new Response(JSON.stringify(body));
  }
  const mock = 'data:text/javascript,' + encodeURIComponent('globalThis.fetch = ' + transport.toString());
  const cli = (args, extra = {}) => spawnSync(process.execPath, ['--import', mock, join(roots.packageRoot, 'scripts/project-context.mjs'), ...args, '--project-root', roots.projectRoot], {encoding: 'utf8', windowsHide: true, env: {...process.env, ADO_ACCESS: crypto.randomUUID(), CHANGED_METADATA: '', ...extra}});
  const selection = cli(['retrieve', '--request', 'request.json']); assert.equal(selection.status, 2, selection.stderr);
  assert.match(JSON.parse(selection.stdout).metadataContinuation, /context metadata/);
  const entries = []; let cursor, firstCursor;
  do {
    const page = cli(['metadata', '--request', 'request.json', ...(cursor ? ['--cursor', cursor] : [])]);
    assert.equal(page.status, 0, page.stderr); assert(Buffer.byteLength(page.stdout) <= 16384);
    const result = JSON.parse(page.stdout); assert.equal(result.total, 90); assert(result.results.length <= 8); entries.push(...result.results); cursor = result.cursor; firstCursor ??= cursor;
  } while (cursor);
  assert.equal(entries.length, 90); assert.equal(entries.filter(item => item.kind === 'type').length, 9);
  assert(entries.some(item => item.kind === 'state' && item.typeId === 'Custom.Type9' && item.id === 'state-9'));
  const stale = cli(['metadata', '--request', 'request.json', '--cursor', firstCursor], {CHANGED_METADATA: '1'}); assert.equal(stale.status, 1); assert.match(stale.stderr, /cursor/i);
  assert(!existsSync(current(roots))); assert.equal(readFileSync(join(roots.projectRoot, '.harness/integrations.json'), 'utf8'), configuration);
});

test('incomplete membership retains stale support; foreign and excluded links are never followed', async t => {
  const {roots} = fixture(t), f = adoFixture(), input = {...request(), ado: {sourceId: 'backlog'}};
  f.items.get(1).relations.push({rel: 'System.LinkTypes.Related', url: 'https://other.example.test/foreign/_apis/wit/workItems/99'});
  await updateContext(roots, input, {client: f.client}); assert(!f.calls.some(c => c[1] === 99));
  const item = readContext(roots, 'checkout').sources.find(s => s.workItemId === 1); assert(item.relationGaps.length); assert.deepEqual(item.relations.map(r => r.workItemId), [2]);
  f.client.wiql = async () => {throw new Error('Unavailable');};
  const next = await updateContext(roots, input, {client: f.client}); assert.equal(next.snapshot.status, 'partial'); assert(next.snapshot.sources.filter(s => s.kind === 'work-item').every(s => s.status === 'unverified' && s.contributions.length));
});

test('legacy local snapshots migrate only on explicit update, preserve all evidence/custom/history, and survive interruption', async t => {
  const {roots} = fixture(t); put(roots, 'guide.txt', 'Legacy payment');
  const legacy = (await retrieveContext(roots, request([source('guide', 'guide.txt')]))).snapshot; legacy.version = 1; legacy.custom = {note: 'Preserve owner knowledge'};
  const {revision, ...body} = legacy; legacy.revision = fingerprint(body);
  const original = JSON.stringify(legacy, null, 2); put(roots, '.harness/context/checkout/current.json', original); put(roots, `.harness/context/checkout/history/${legacy.revision}.json`, original);
  assert.equal(readContextOverview(roots, 'checkout').version, 1); assert.equal(readContext(roots, 'checkout').facts[0].text, 'Legacy payment'); assert.equal(readFileSync(current(roots), 'utf8'), original);
  assert.throws(() => searchContext(roots, 'checkout', {query: 'payment'}), /update/);
  await assert.rejects(updateContext(roots, request(), {beforePublish() {throw new Error('Simulated interruption');}}), /interruption/); assert.equal(readFileSync(current(roots), 'utf8'), original);
  const saved = await updateContext(roots, request()); assert.equal(saved.snapshot.version, 2); assert.equal(saved.snapshot.facts[0].text, legacy.facts[0].text); assert.deepEqual(saved.snapshot.custom, legacy.custom);
  assert.equal(readFileSync(join(dirname(current(roots)), `legacy/${fingerprint(legacy)}/current.json`), 'utf8'), original);
  assert.equal(readFileSync(join(dirname(current(roots)), `history/${legacy.revision}.json`), 'utf8'), original);
  const manifest = JSON.parse(readFileSync(current(roots))); put(roots, '.harness/context/checkout/custom.json', '{"note":"Changed note"}');
  assert.deepEqual(loadSnapshot(roots, {...manifest}).custom, {note: 'Changed note'}); assert.deepEqual(storeFor(roots, manifest).get(manifest.customRef, 'custom'), legacy.custom);
});

test('legacy ADO migration requires fresh project ownership and complete recapture', async t => {
  const {roots} = fixture(t), f = adoFixture(), input = {...request(), ado: {sourceId: 'backlog'}};
  const legacy = (await retrieveContext(roots, input, {client: f.client})).snapshot; legacy.version = 1; delete legacy.adoProject; for (const source of legacy.sources) {delete source.projectKey; delete source.recipeVersion;}
  put(roots, '.harness/context/checkout/current.json', JSON.stringify(legacy)); const before = readFileSync(current(roots)), read = f.client.read;
  f.client.read = async () => {throw new Error('Offline');}; await assert.rejects(updateContext(roots, input, {client: f.client}), /migration.*stopped/i); assert.deepEqual(readFileSync(current(roots)), before);
  f.client.read = read; f.calls.length = 0; const next = await updateContext(roots, input, {client: f.client}); assert.equal(next.snapshot.adoProject.id, f.project.id); assert.equal(f.calls.filter(c => c[0] === 'content').length, 3);
});

test('same project GUID survives rename; another organization with the same name/GUID cannot reuse context', async t => {
  const {roots} = fixture(t), f = adoFixture(), input = {...request(), ado: {sourceId: 'backlog'}}; await updateContext(roots, input, {client: f.client});
  f.project.name = 'renamed'; f.client.configuration.project = 'renamed'; for (const item of f.items.values()) item.fields['System.TeamProject'] = 'renamed';
  const renamed = await updateContext(roots, input, {client: f.client}); assert.equal(renamed.snapshot.adoProject.name, 'renamed'); assert.equal(renamed.snapshot.adoProject.id, f.project.id);
  f.client.configuration.organizationUrl = 'https://other.example.test'; f.calls.length = 0;
  await assert.rejects(updateContext(roots, input, {client: f.client}), /project identity differs/); assert(f.calls.every(c => c[0] === 'identity'));
});

test('foreign object/index paths and scope-forged cursors fail before returning another context', async t => {
  const {roots} = fixture(t); put(roots, 'a.txt', 'Checkout payment'); put(roots, 'b.txt', 'Other project secret-free marker');
  await updateContext(roots, request([source('a', 'a.txt')])); await updateContext(roots, request([source('b', 'b.txt')], 'other'));
  const original = readFileSync(current(roots)), manifest = JSON.parse(original), other = JSON.parse(readFileSync(join(roots.projectRoot, '.harness/context/other/current.json')));
  const rewrite = body => {delete body.revision; body.revision = fingerprint(body); writeFileSync(current(roots), JSON.stringify(body));};
  rewrite({...manifest, index: {...other.index, path: '../other/' + other.index.path}}); assert.throws(() => searchContext(roots, 'checkout', {query: 'marker'}), /index|reference/);
  writeFileSync(current(roots), original);
  const foreignStore = storeFor(roots, other), foreignEntry = [...foreignStore.entries(other.catalogs.sources)][0];
  const from = join(roots.projectRoot, `.harness/context/other/objects/${foreignEntry.ref.slice(0, 2)}/${foreignEntry.ref}.json`), to = join(dirname(current(roots)), `objects/${foreignEntry.ref.slice(0, 2)}/${foreignEntry.ref}.json`); mkdirSync(dirname(to), {recursive: true}); copyFileSync(from, to);
  const ownStore = storeFor(roots, manifest), catalogs = {...manifest.catalogs, sources: ownStore.catalog([{id: 'b', ref: foreignEntry.ref}])}; rewrite({...manifest, catalogs});
  assert.throws(() => searchContext(roots, 'checkout', {catalog: 'sources'}), /scope mismatch/); writeFileSync(current(roots), original);
  const page = searchContext(roots, 'checkout', {query: 'payment'}); assert(page.results.every(r => !r.excerpt.includes('marker')));
});

test('corrupt index is never repaired by reads; explicit update restores it and preserves evidence/history', async t => {
  const {roots} = fixture(t); put(roots, 'a.txt', 'Payment evidence'); await updateContext(roots, request([source('a', 'a.txt')]));
  const manifest = JSON.parse(readFileSync(current(roots))), path = join(dirname(current(roots)), manifest.index.path); writeFileSync(path, 'broken index');
  assert.throws(() => searchContext(roots, 'checkout', {query: 'payment'}), /index.*update/i); assert.equal(readFileSync(path, 'utf8'), 'broken index');
  await updateContext(roots, request()); assert.equal(searchContext(roots, 'checkout', {query: 'payment'}).results[0].excerpt, 'Payment evidence');
});

test('catalog and CLI outputs are bounded, paginated, useful for host readers, and explicit export is complete', async t => {
  const {roots} = fixture(t), sources = [];
  for (let n = 0; n < 35; n++) {put(roots, `${n}.txt`, 'Payment ' + 'evidence '.repeat(600)); sources.push(source(`source-${n}`, `${n}.txt`));}
  put(roots, 'request.json', JSON.stringify(request(sources)));
  const cli = (...args) => spawnSync(process.execPath, [join(roots.packageRoot, 'scripts/project-context.mjs'), ...args, '--project-root', roots.projectRoot], {encoding: 'utf8', windowsHide: true});
  const transient = cli('retrieve', '--request', 'request.json'); assert.equal(transient.status, 0, transient.stderr); assert(Buffer.byteLength(transient.stdout) <= 16384); const preview = JSON.parse(transient.stdout); assert.equal(preview.saved, false); assert.equal(preview.sources.sample[0].hash, digest('Payment ' + 'evidence '.repeat(600))); assert(!existsSync(current(roots)));
  const update = cli('update', '--request', 'request.json'); assert.equal(update.status, 0, update.stderr); assert(Buffer.byteLength(update.stdout) <= 16384); assert.equal(JSON.parse(update.stdout).snapshot.facts, undefined);
  const catalog = searchContext(roots, 'checkout', {catalog: 'sources', limit: 3}), next = searchContext(roots, 'checkout', {catalog: 'sources', limit: 3, cursor: catalog.cursor}); assert.equal(catalog.total, 35); assert.equal(next.results.length, 3); assert(next.results.every(b => !catalog.results.some(a => a.id === b.id)));
  const searched = cli('search', '--id', 'checkout', '--query', 'payment', '--limit', '25', '--max-bytes', '65536'); assert.equal(searched.status, 0, searched.stderr); assert(Buffer.byteLength(searched.stdout) <= 65536); assert.equal(JSON.parse(searched.stdout).results.length, 25);
  const exported = cli('export', '--id', 'checkout', '--out', 'complete.json'); assert.equal(exported.status, 0, exported.stderr); assert.equal(JSON.parse(exported.stdout).status, 'EXPORTED'); assert.equal(JSON.parse(readFileSync(join(roots.projectRoot, 'complete.json'))).sources.length, 35);
});

test('long sections stay one fact, overlap reconstructs originals, and credential scans run before chunk boundaries', async t => {
  const {roots} = fixture(t), secret = crypto.randomUUID(), text = ('إدارة المدفوعات with Unicode 🧪. ').repeat(900);
  put(roots, 'long.txt', text); put(roots, 'private.txt', ' '.repeat(2035) + ['api', 'Key'].join('') + ' = "' + secret + '"');
  const next = await updateContext(roots, request([source('long', 'long.txt'), source('redacted', 'private.txt')]));
  assert.equal(next.snapshot.facts.length, 1); assert.equal(next.snapshot.facts[0].text, text); assert.equal(next.snapshot.facts[0].status, 'observation'); assert(!JSON.stringify(next).includes(secret));
  const page = searchContext(roots, 'checkout', {query: 'اداره', limit: 25, maxBytes: 65536}); assert(page.results.length > 8); assert(page.results.every(hit => hit.factId === next.snapshot.facts[0].id && Buffer.byteLength(hit.excerpt) <= 2048));
});

test('writer locks and intervening owner edits preserve current and reject stale publication', async t => {
  const {roots} = fixture(t); put(roots, 'a.txt', 'Payment evidence'); await updateContext(roots, request([source('a', 'a.txt')]));
  const before = readFileSync(current(roots)); put(roots, '.harness/context/checkout/writer.lock', 'active'); await assert.rejects(updateContext(roots, request()), /exist/i); assert.deepEqual(readFileSync(current(roots)), before); unlinkSync(join(dirname(current(roots)), 'writer.lock'));
  await assert.rejects(updateContext(roots, request(), {beforePublish() {put(roots, '.harness/context/checkout/custom.json', '{"note":"Concurrent owner edit"}');}}), /changed during publication/); assert.deepEqual(readFileSync(current(roots)), before); assert.equal(readContext(roots, 'checkout').custom.note, 'Concurrent owner edit');
});

test('malformed custom notes and captured objects never echo parser excerpts', async t => {
  const {roots} = fixture(t); put(roots, 'a.txt', 'Payment evidence'); await updateContext(roots, request([source('a', 'a.txt')]));
  const marker = 'PRIVATE' + crypto.randomUUID(), malformed = 'x' + marker;
  put(roots, '.harness/context/checkout/custom.json', malformed);
  assert.throws(() => readContextOverview(roots, 'checkout'), error => !error.message.includes('PRIVATE'));
  unlinkSync(join(dirname(current(roots)), 'custom.json'));
  const manifest = JSON.parse(readFileSync(current(roots))), store = storeFor(roots, manifest), entry = [...store.entries(manifest.catalogs.sources)][0];
  put(roots, `.harness/context/checkout/objects/${entry.ref.slice(0, 2)}/${entry.ref}.json`, malformed);
  assert.throws(() => searchContext(roots, 'checkout', {query: 'payment'}), error => !error.message.includes('PRIVATE'));
});

test('query loads only matched evidence and performs no writes or network calls', async t => {
  const {roots} = fixture(t); put(roots, 'a.txt', 'Unique checkout evidence'); put(roots, 'b.txt', 'Unrelated inventory evidence'); await updateContext(roots, request([source('a', 'a.txt'), source('b', 'b.txt')]));
  const manifest = JSON.parse(readFileSync(current(roots))), store = storeFor(roots, manifest), unrelated = store.lookup(manifest.catalogs.sources, 'b');
  put(roots, `.harness/context/checkout/objects/${unrelated.slice(0, 2)}/${unrelated}.json`, 'unreadable unrelated payload');
  const entries = [];
  function capture(path) {for (const item of readdirSync(path, {withFileTypes: true})) {const file = join(path, item.name); if (item.isDirectory()) capture(file); else entries.push([file, statSync(file).mtimeMs, digest(readFileSync(file))]);}}
  capture(dirname(current(roots))); const oldFetch = globalThis.fetch; globalThis.fetch = () => {throw new Error('Network is forbidden');};
  try {assert.equal(searchContext(roots, 'checkout', {query: 'checkout'}).results[0].sourceId, 'a'); assert.equal(readContextOverview(roots, 'checkout').counts.sources, 2);} finally {globalThis.fetch = oldFetch;}
  for (const [file, time, hash] of entries) {assert.equal(statSync(file).mtimeMs, time); assert.equal(digest(readFileSync(file)), hash);}
});

test('adding a document to an existing large capture exposes the newly selected hash receipt in the compact preview', async t => {
  const {roots} = fixture(t), sources = [];
  for (let n = 0; n < 10; n++) {put(roots, `${n}.txt`, `Old source ${n}`); sources.push(source(`old-${n}`, `${n}.txt`));}
  await updateContext(roots, request(sources)); put(roots, 'new.docx', 'opaque document bytes'); put(roots, 'request.json', JSON.stringify(request([source('z-new-document', 'new.docx')])));
  const result = spawnSync(process.execPath, [join(roots.packageRoot, 'scripts/project-context.mjs'), 'retrieve', '--request', 'request.json', '--project-root', roots.projectRoot], {encoding: 'utf8', windowsHide: true});
  assert.equal(result.status, 2, result.stderr); const output = JSON.parse(result.stdout); assert.equal(output.sources.sample[0].id, 'z-new-document'); assert.equal(output.sources.sample[0].hash, digest('opaque document bytes'));
});
