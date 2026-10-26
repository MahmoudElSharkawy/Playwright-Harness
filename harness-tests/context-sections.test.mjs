import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync, readFileSync, unlinkSync, readdirSync, cpSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fixture} from './fixtures/execution-core.mjs';
import {legacyDocuments} from './fixtures/context-legacy.mjs';
import {extractContextBytes, contextReaderRecipe, contextParts} from '../scripts/lib/context/files.mjs';
import {updateContext, readContext, readContextOverview, searchContext, exportContext} from '../scripts/lib/context/index.mjs';
import {readManifest, storeFor} from '../scripts/lib/context/storage.mjs';
import {digest} from '../scripts/lib/execution-core/data.mjs';

const input = sources => ({version: 1, contextId: 'sections', identity: {project: 'shop'}, scope: {application: 'refunds', environment: 'qa'}, sources});
const source = (id, path) => ({id, kind: 'file', path});
const put = (roots, path, text) => {const target = join(roots.projectRoot, path); mkdirSync(dirname(target), {recursive: true}); writeFileSync(target, text); return target;};
const around = (page, hit = page.results[0], extra = {}) => ({around: hit.passageId, sourceId: hit.sourceId, revision: page.revision, ...extra});

test('native Markdown retains sections, ancestry, lists, tables, fences and exact multilingual document spans', async t => {
  const {roots} = fixture(t);
  const text = '\uFEFF# سياسة الاسترداد 😀\r\n\r\n## Refunds\r\nRefunds require a receipt.\r\n\r\nExcept gifts: use the order number.\r\n- Ask the purchaser.\r\n\r\n| Type | Days |\r\n| --- | --- |\r\n| Gift | 14 |\r\n\r\n```text\r\n# Not a heading\r\n\r\nKeep this block.\r\n```\r\n\r\n## Shipping\r\nUnrelated shipping rule.\r\n## Refunds\r\nIndependent duplicate heading.\r\n';
  put(roots, 'rules.md', text); const saved = await updateContext(roots, input([source('rules', 'rules.md')]));
  const parts = saved.snapshot.sources[0].contributions;
  assert.equal(parts.length, 4); assert.equal(parts.map(part => part.text).join(''), text);
  assert(parts[1].text.includes('Except gifts')); assert(parts[1].text.includes('# Not a heading'));
  assert.deepEqual(parts[1].document.headings, ['سياسة الاسترداد 😀', 'Refunds']);
  assert.equal(saved.snapshot.facts.filter(fact => fact.status === 'conflicting').length, 0);
  for (const part of parts) {
    const span = part.document;
    assert.equal(text.slice(span.start, span.end), part.text);
    assert.equal(Buffer.from(text).subarray(span.byteStart, span.byteEnd).toString(), part.text);
    assert.match(part.location, /lines \d+-\d+/);
  }
  const page = searchContext(roots, 'sections', {query: 'gifts'}), hit = page.results[0];
  assert.match(hit.citation.location, /سياسة الاسترداد 😀 > Refunds.*lines 3-18/);
  assert.equal(text.slice(hit.documentOffsets.start, hit.documentOffsets.end), hit.excerpt);
  assert.equal(Buffer.from(text).subarray(hit.documentOffsets.byteStart, hit.documentOffsets.byteEnd).toString(), hit.excerpt);
  exportContext(roots, 'sections', 'export.json');
  assert.deepEqual(JSON.parse(readFileSync(join(roots.projectRoot, 'export.json'))).sources[0].contributions, parts);
});

test('plain text paragraphs and setext headings preserve all original content without invented topics', async () => {
  for (const [path, text, count] of [['rules.txt', 'Rule requires approval.\nExcept urgent orders.\n\nNext process.\n\n', 2], ['rules.md', 'Rules\n=====\nRule.\n\nException.\n\nOther\n-----\nOther rule.', 2]]) {
    const record = await extractContextBytes(source('rules', path), Buffer.from(text));
    assert.equal(record.contributions.length, count); assert.equal(record.contributions.map(part => part.text).join(''), text);
    assert(record.contributions.every(part => part.topic.startsWith('content-')));
  }
});

test('long Unicode sections retain bounded chunks and absolute character/byte offsets', async t => {
  const {roots} = fixture(t), text = '# شروط 😀\n' + 'طلب استرداد 😀 '.repeat(1600) + '\nException: manual review.';
  put(roots, 'long.md', text); await updateContext(roots, input([source('long', 'long.md')]));
  let cursor; const hits = [];
  do {const page = searchContext(roots, 'sections', {sourceId: 'long', limit: 25, ...(cursor ? {cursor} : {})}); hits.push(...page.results); cursor = page.cursor;} while (cursor);
  assert(hits.length > 10);
  for (const hit of hits) {
    assert(Buffer.byteLength(hit.excerpt) <= 2048);
    assert.equal(text.slice(hit.documentOffsets.start, hit.documentOffsets.end), hit.excerpt);
    assert.equal(Buffer.from(text).subarray(hit.documentOffsets.byteStart, hit.documentOffsets.byteEnd).toString(), hit.excerpt);
    assert(!hit.excerpt.includes('\uFFFD'));
  }
});

test('legacy surrounding evidence is ordered, bounded, pageable, strict and readable without originals or migration', async t => {
  const {roots} = fixture(t), text = 'Before\nRefunds require a receipt.\nExcept gifts.\nAfter\nLast';
  legacyDocuments(roots, input([]), [{id: 'rules', path: 'rules.md', text}, {id: 'foreign', path: 'foreign.md', text: 'Foreign source'}]);
  const before = readManifest(roots, 'sections'), page = searchContext(roots, 'sections', {query: 'receipt', sourceId: 'rules'});
  assert.equal(readContextOverview(roots, 'sections').coverage, 'complete');
  const options = around(page, undefined, {before: 1, after: 2, limit: 2});
  const first = searchContext(roots, 'sections', options), second = searchContext(roots, 'sections', {...options, cursor: first.cursor});
  assert.deepEqual([...first.results, ...second.results].map(hit => hit.excerpt), ['Before', 'Refunds require a receipt.', 'Except gifts.', 'After']);
  assert.equal(first.omitted, 2); assert.equal(second.omitted, 0); assert.equal(second.cursor, null);
  assert.equal(first.surrounding.omittedAfter, 1); assert.equal(first.surrounding.omittedBefore, 0);
  const strict = searchContext(roots, 'sections', {...around(page), topic: page.results[0].topic});
  assert.deepEqual(strict.results.map(hit => hit.excerpt), ['Refunds require a receipt.']); assert(strict.surrounding.excludedByFilters > 0);
  for (const invalid of [{sourceId: 'foreign'}, {workItemId: 99}, {revision: '0'.repeat(64)}, {before: 6}, {before: -1}, {query: 'refund'}, {sourceId: undefined}]) {
    assert.throws(() => searchContext(roots, 'sections', {...around(page), ...invalid}), /surround|anchor|revision|window|filter/i);
  }
  assert.throws(() => searchContext(roots, 'sections', {...options, after: 1, cursor: first.cursor}), /cursor/i);
  assert.deepEqual(readManifest(roots, 'sections'), before);
});

test('surrounding long sections honors byte budgets and cursor scope without loading other context evidence', async t => {
  const {roots} = fixture(t), text = '# Rule\n' + 'Refund payment requires a receipt. '.repeat(600);
  put(roots, 'rules.md', text); await updateContext(roots, input([source('rules', 'rules.md')]));
  const page = searchContext(roots, 'sections', {query: 'receipt'}), options = around(page, undefined, {before: 5, after: 5, maxBytes: 4096});
  let cursor, count = 0;
  do {
    const next = searchContext(roots, 'sections', {...options, ...(cursor ? {cursor} : {})});
    assert(Buffer.byteLength(JSON.stringify(next)) + 1 <= 4096); assert(next.results.length); count += next.results.length; cursor = next.cursor;
  } while (cursor);
  assert(count > 1);
  const file = put(roots, 'rules.md', text + '\nChanged.'); await updateContext(roots, {version: 1, contextId: 'sections'}); unlinkSync(file);
  assert.throws(() => searchContext(roots, 'sections', options), /revision/i);
});

test('explicit refresh upgrades unchanged native bytes narrowly, preserves history and unaffected extraction/index rows', async t => {
  const {roots} = fixture(t), text = '# Refunds\nRule needs a receipt.\nExcept gifts.';
  put(roots, 'rules.md', text); put(roots, 'unaffected.json', '{"payment":"Card accepted"}');
  legacyDocuments(roots, input([]), [{id: 'rules', path: 'rules.md', text}]);
  await updateContext(roots, input([source('unaffected', 'unaffected.json')]));
  const original = readManifest(roots, 'sections');
  const oldStore = storeFor(roots, original), oldSource = oldStore.source(oldStore.lookup(original.catalogs.sources, 'rules'), false);
  assert.notEqual(contextReaderRecipe(source('rules', 'rules.md'), {}, oldSource).recipe, oldSource.recipe);
  assert.equal(contextReaderRecipe(source('unaffected', 'unaffected.json'), {}, {selectedFor: 'business-context', kind: 'file', extractionRecipe: 'native'}).extractionRecipe, 'native');
  const beforePage = searchContext(roots, 'sections', {sourceId: 'rules', limit: 1});
  const originalBytes = readFileSync(join(roots.projectRoot, '.harness/context/sections/current.json'));
  await assert.rejects(updateContext(roots, {version: 1, contextId: 'sections'}, {beforePublish() {throw new Error('Interrupted upgrade');}}), /Interrupted/);
  assert.deepEqual(readFileSync(join(roots.projectRoot, '.harness/context/sections/current.json')), originalBytes);
  assert.equal(searchContext(roots, 'sections', {sourceId: 'rules'}).results.length, 3);
  put(roots, '.harness/context/sections/custom.json', '{"note":"Preserve owner notes"}');
  const refreshed = await updateContext(roots, {version: 1, contextId: 'sections'}, {now: '2026-10-02T00:00:00Z'});
  assert.equal(refreshed.snapshot.sources.find(item => item.id === 'rules').contributions.length, 1);
  assert.equal(refreshed.snapshot.sources.find(item => item.id === 'rules').hash, digest(text));
  assert.deepEqual(refreshed.snapshot.custom, {note: 'Preserve owner notes'});
  assert.equal(readContext(roots, 'sections').sources.length, 2);
  const first = readManifest(roots, 'sections');
  const firstStore = storeFor(roots, first);
  assert.deepEqual(firstStore.source(firstStore.lookup(first.catalogs.sources, 'unaffected'), false).contributions,
    oldStore.source(oldStore.lookup(original.catalogs.sources, 'unaffected'), false).contributions);
  assert.throws(() => searchContext(roots, 'sections', {sourceId: 'rules', limit: 1, cursor: beforePage.cursor}), /cursor/i);
  await updateContext(roots, {version: 1, contextId: 'sections'}, {now: '2026-10-03T00:00:00Z'});
  assert.deepEqual(readManifest(roots, 'sections').index, first.index);
  assert(readdirSync(join(roots.projectRoot, '.harness/context/sections/history')).includes(first.revision + '.json'));
  const beforeFailure = readFileSync(join(roots.projectRoot, '.harness/context/sections/current.json'));
  await assert.rejects(updateContext(roots, {version: 1, contextId: 'sections'}, {beforePublish() {throw new Error('Interrupted publication');}}), /Interrupted/);
  assert.deepEqual(readFileSync(join(roots.projectRoot, '.harness/context/sections/current.json')), beforeFailure);
  assert(searchContext(roots, 'sections', {query: 'gifts'}).results.length);
});

test('host receipts for native extensions retain their topics, locations and reader contract', async t => {
  const {roots} = fixture(t), text = '# Receipt\nRule'; put(roots, 'rules.md', text);
  const extraction = {hash: digest(text), reader: 'host-reader', coverage: 'partial', parts: [{topic: 'refund.rule', location: 'page 2', text: 'Host exception'}]};
  await updateContext(roots, input([{...source('rules', 'rules.md'), extraction}]));
  await updateContext(roots, {version: 1, contextId: 'sections'});
  const record = readContext(roots, 'sections').sources[0];
  assert.equal(record.coverage, 'reader-required'); assert.equal(record.contributions[0].location, 'page 2'); assert.equal(record.contributions[0].text, 'Host exception');
});

test('CLI exposes the additive surrounding search contract', async t => {
  const {roots} = fixture(t); legacyDocuments(roots, input([]), [{id: 'rules', path: 'rules.md', text: 'Rule\nException'}]);
  const page = searchContext(roots, 'sections', {query: 'Rule'}), hit = page.results[0];
  const result = spawnSync(process.execPath, [join(roots.packageRoot, 'scripts/project-context.mjs'), 'search', '--id', 'sections', '--around', hit.passageId ?? 'missing', '--source', 'rules', '--revision', page.revision, '--before', '0', '--after', '1', '--project-root', roots.projectRoot], {encoding: 'utf8', windowsHide: true});
  assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout).results.map(hit => hit.excerpt), ['Rule', 'Exception']);
});

test('surrounding cursors stay bound to the selected consumer even for identical copied captures', t => {
  const {roots} = fixture(t), foreign = fixture(t).roots;
  legacyDocuments(roots, input([]), [{id: 'rules', path: 'rules.md', text: 'First\nRule\nException'}]);
  cpSync(join(roots.projectRoot, '.harness/context'), join(foreign.projectRoot, '.harness/context'), {recursive: true});
  const page = searchContext(roots, 'sections', {query: 'Rule'}), options = around(page, undefined, {limit: 1});
  const first = searchContext(roots, 'sections', options); assert(first.cursor);
  assert.throws(() => searchContext(foreign, 'sections', {...options, cursor: first.cursor}), /cursor/i);
});

test('native document redaction retains safe section text and exact offsets without propagating a secret heading', async t => {
  const {roots} = fixture(t), literal = crypto.randomUUID(), name = ['api', 'Key'].join('');
  const text = `# ${name} = "${literal}"\nPublic rule.\n${name} = "${literal}"\nException: gifts.\n`;
  put(roots, 'rules.md', text); const saved = await updateContext(roots, input([source('rules', 'rules.md')]));
  assert(!JSON.stringify(saved).includes(literal)); assert.equal(saved.snapshot.sources[0].redacted, 2);
  assert(saved.snapshot.facts.some(fact => fact.text.includes('Public rule.'))); assert(saved.snapshot.facts.some(fact => fact.text.includes('Exception: gifts.')));
  for (const hit of searchContext(roots, 'sections', {sourceId: 'rules'}).results) assert.equal(text.slice(hit.documentOffsets.start, hit.documentOffsets.end), hit.excerpt);
});

test('unavailable legacy originals retain their line capture as stale until a successful explicit upgrade', async t => {
  const {roots} = fixture(t), text = '# Rule\nExcept gifts.';
  legacyDocuments(roots, input([]), [{id: 'rules', path: 'rules.md', text}]);
  const result = await updateContext(roots, {version: 1, contextId: 'sections'});
  assert.equal(result.snapshot.status, 'partial');
  const record = result.snapshot.sources[0]; assert.equal(record.extractionRecipe, 'native'); assert.equal(record.contributions.length, 2);
  const page = searchContext(roots, 'sections', {query: 'gifts'});
  assert.equal(page.results[0].freshness.status, 'unverified'); assert.equal(page.results[0].freshness.verifiedAt, '2026-10-01T00:00:00Z');
  put(roots, 'rules.md', text); await updateContext(roots, {version: 1, contextId: 'sections'});
  assert.equal(readContext(roots, 'sections').sources[0].contributions.length, 1);
});

test('non-UTF-8 native documents expose decoded character spans without claiming original UTF-8 byte offsets', async () => {
  const text = '# Rule\r\nطلب 😀\r\nException.';
  const record = await extractContextBytes({...source('rules', 'rules.md'), encoding: 'utf-16le'}, Buffer.from(text, 'utf16le'));
  assert.equal(record.contributions[0].text, text); assert.equal(record.contributions[0].document.byteStart, undefined);
});

test('blank preambles survive capture and indented code cannot invent setext heading ancestry', async () => {
  const text = '\n\n    Code example\n---\n\n# Actual rule\nRefunds need approval.';
  const record = await extractContextBytes(source('rules', 'rules.md'), Buffer.from(text));
  assert.equal(record.contributions.map(part => part.text).join(''), text);
  assert.deepEqual(record.contributions[0].document.headings, []);
  assert.deepEqual(record.contributions.at(-1).document.headings, ['Actual rule']);
});

test('oversized paragraph counts report bounded partial extraction rather than overflowing argument limits', async () => {
  const record = await extractContextBytes(source('rules', 'rules.txt'), Buffer.from('Rule.\n\n'.repeat(140000)));
  assert.equal(record.coverage, 'partial'); assert.equal(record.contributions.length, 20000);
  assert.equal(record.contributions[0].document.start, 0);
});

test('document span receipts reject nonnumeric and unsafe byte coordinates', () => {
  for (const span of [{byteStart: 0, byteEnd: '4'}, {byteStart: Number.MAX_SAFE_INTEGER - 1, byteEnd: Number.MAX_SAFE_INTEGER + 3}]) {
    assert.throws(() => contextParts([{text: 'Rule', location: 'line 1', document: {start: 0, end: 4, lineStart: 1, lineEnd: 1, headings: [], ...span}}]), /byte span/i);
  }
});

test('bounded heading labels never split a Unicode surrogate pair', async () => {
  const text = '# ' + '😀'.repeat(120) + '\n## ' + '😀'.repeat(120) + '\nRule.';
  const record = await extractContextBytes(source('rules', 'rules.md'), Buffer.from(text));
  assert.equal(record.status, 'verified'); assert.equal(record.contributions.map(part => part.text).join(''), text);
  assert(record.contributions.every(part => part.location.isWellFormed() && part.document.headings.every(label => label.isWellFormed() && label.length <= 200)));
});
