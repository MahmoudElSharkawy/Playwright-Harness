import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
import {fixture} from './fixtures/execution-core.mjs';
import {legacyDocuments} from './fixtures/context-legacy.mjs';
import {extractContextBytes, contextParts} from '../scripts/lib/context/files.mjs';
import {updateContext, readContext, searchContext} from '../scripts/lib/context/index.mjs';
import {readManifest, storeFor, prepareSnapshot} from '../scripts/lib/context/storage.mjs';
import {buildIndex} from '../scripts/lib/context/search.mjs';
import {facts, RECIPE} from '../scripts/lib/context/model.mjs';
import {digest, fingerprint} from '../scripts/lib/execution-core/data.mjs';

const input = sources => ({version: 1, contextId: 'completeness', identity: {project: 'shop'}, scope: {application: 'refunds', environment: 'qa'}, sources});
const source = (id, path) => ({id, kind: 'file', path});
const put = (roots, path, text) => fs.writeFileSync(join(roots.projectRoot, path), text);
const extract = text => extractContextBytes(source('rules', 'rules.md'), Buffer.from(text));
const exactSpans = (text, parts) => {
  assert.equal(parts.map(part => part.text).join(''), text);
  for (const {text: excerpt, document} of parts) {
    assert.equal(text.slice(document.start, document.end), excerpt);
    assert.equal(Buffer.from(text).subarray(document.byteStart, document.byteEnd).toString(), excerpt);
  }
};

test('list-contained fences retain literal headings and the following real business section', async () => {
  for (const [opening, indentation] of [['- ```text', '  '], ['10. ~~~text', '    '], ['- Parent\n  - ```text', '    '], ['- Parent\n\n  ```text', '  '], ['- Parent\n    - ```text', '      ']]) {
    const marker = opening.includes('~~~') ? '~~~' : '```';
    const text = `# Refunds\n\n${opening}\n${indentation}# Example: reject all refunds\n${indentation}${marker}\n\n# Gift exceptions\nGifts are refundable without receipt.\n`;
    const {contributions} = await extract(text);
    exactSpans(text, contributions);
    assert.deepEqual(contributions.map(part => part.document.headings), [['Refunds'], ['Gift exceptions']], opening);
    assert(contributions[0].text.includes('# Example: reject all refunds'));
    assert(contributions[1].text.startsWith('# Gift exceptions'));
  }
});

test('unclosed list fences end with their container and standalone fences retain ordinary behavior', async () => {
  for (const text of [
    '# Rules\n\n- ```text\n  # Literal\n\n# Actual\nAllowed.\n',
    '# Rules\n\n```text\n# Literal\n```\n\n# Actual\nAllowed.\n',
    '# Rules\n\n    ```text\n    # Literal\n    ```\n\n# Actual\nAllowed.\n'
  ]) {
    const {contributions} = await extract(text);
    exactSpans(text, contributions);
    assert.deepEqual(contributions.map(part => part.document.headings), [['Rules'], ['Actual']]);
  }
});

test('tabs use Markdown indentation columns inside list fences without changing original offsets', async () => {
  for (const [opening, literal, closing] of [
    ['- Parent\n  ```text', '\t# literal', '  ```'],
    ['- Parent\n\t```text', '\t# literal', '\t```'],
    ['-\t```text', '\t# literal', '\t```'],
    ['- Parent\n\t-\t```text', '\t\t# literal', '\t\t```']
  ]) {
    const text = `# Policy طلب 😀\n\n${opening}\n${literal}\n${closing}\n\n# Actual\nAllowed.\n`;
    const {contributions} = await extract(text);
    exactSpans(text, contributions);
    assert.deepEqual(contributions.map(part => part.document.headings), [['Policy طلب 😀'], ['Actual']], opening);
    assert(contributions[0].text.includes(literal));
  }
});

test('empty list markers establish containers for unclosed fenced blocks', async () => {
  for (const [item, indentation] of [['-', '  '], ['10.', '    '], ['- Parent\n\n  -', '    ']]) {
    const text = `# Policy\n\n${item}\n${indentation}\`\`\`text\n${indentation}# literal\n\n# Actual\nAllowed.\n`;
    const {contributions} = await extract(text);
    exactSpans(text, contributions);
    assert.deepEqual(contributions.map(part => part.document.headings), [['Policy'], ['Actual']], item);
    assert(contributions[0].text.includes('# literal'));
  }
});

test('multiline setext headings retain the entire qualifying heading and original multilingual offsets', async () => {
  const text = '# سياسة 😀\r\n\r\nRefund eligibility\r\nfor gift purchases طلب\r\n------------------\r\nReceipt not required.\r\n\r\nNext section\r\n============\r\nDifferent rule.\r\n';
  const {contributions} = await extract(text);
  exactSpans(text, contributions);
  assert.deepEqual(contributions.map(part => part.document.headings), [['سياسة 😀'], ['سياسة 😀', 'Refund eligibility for gift purchases طلب'], ['Next section']]);
  assert.equal(contributions[1].document.lineStart, 3);
  assert.equal(contributions[1].document.lineEnd, 7);
  assert.equal(contributions[1].document.start, text.indexOf('Refund eligibility'));
  assert.match(contributions[1].location, /Refund eligibility for gift purchases طلب; lines 3-7/);
});

test('list, thematic-break and indented-code text cannot become setext heading ancestry', async () => {
  for (const block of ['- Example\ncontinued example\n---', '> Example\ncontinued example\n---', '---\n---', '* * *\n---', '    Example\n---']) {
    const text = `# Actual\n\n${block}\n\n## Following\nRule.\n`;
    const {contributions} = await extract(text);
    exactSpans(text, contributions);
    assert.deepEqual(contributions.map(part => part.document.headings), [['Actual'], ['Actual', 'Following']], block);
  }
});

test('plain-text literal fence markers never suppress paragraph boundaries', async () => {
  for (const marker of ['~~~', '```example']) {
    const text = `First paragraph.\n\n${marker}\n\nSecond paragraph.\n\nThird paragraph.`;
    const record = await extractContextBytes(source('rules', 'rules.txt'), Buffer.from(text));
    exactSpans(text, record.contributions);
    assert.equal(record.contributions.length, 4);
    assert(record.contributions.every(part => part.document.headings.length === 0));
  }
});

test('a lone lexical hit discloses omitted section chunks and bounded expansion recovers its distant exception', async t => {
  const {roots} = fixture(t);
  const text = '# Refunds طلب 😀\nRefunds require a receipt.\n' + 'Details for the processing team طلب 😀.\n'.repeat(550) + 'Exception: gifts qualify without proof of purchase.\n';
  put(roots, 'rules.md', text);
  put(roots, 'foreign.md', '# Foreign\nUnrelated secret business rule.');
  await updateContext(roots, input([source('rules', 'rules.md'), source('foreign', 'foreign.md')]));
  const page = searchContext(roots, 'completeness', {query: 'receipt', maxBytes: 4096});
  assert.equal(page.total, 1); assert.equal(page.omitted, 0); assert.equal(page.cursor, null);
  const first = page.results[0];
  assert.equal(first.section.chunkIndex, 0);
  assert.equal(first.section.complete, false);
  assert.equal(first.section.omittedBefore, 0);
  assert(first.section.omittedAfter > 5);
  assert(!first.excerpt.includes('Exception'));
  const hits = new Map([[0, first]]); let anchor = first;
  while (anchor.section.omittedAfter) {
    const options = {around: anchor.passageId, sourceId: 'rules', topic: first.topic, revision: page.revision, before: 0, after: 5, maxBytes: 4096};
    let cursor;
    do {
      const next = searchContext(roots, 'completeness', {...options, ...(cursor ? {cursor} : {})});
      assert(Buffer.byteLength(JSON.stringify(next)) + 1 <= 4096);
      for (const hit of next.results) {
        assert.equal(hit.sourceId, 'rules'); assert.equal(hit.factId, first.factId); assert.equal(hit.topic, first.topic);
        assert.equal(hit.section.chunkCount, first.section.chunkCount);
        assert.equal(hit.section.omittedBefore, hit.section.chunkIndex);
        assert.equal(hit.section.omittedAfter, hit.section.chunkCount - hit.section.chunkIndex - 1);
        assert.equal(hit.section.complete, false);
        assert.equal(text.slice(hit.documentOffsets.start, hit.documentOffsets.end), hit.excerpt);
        assert.equal(Buffer.from(text).subarray(hit.documentOffsets.byteStart, hit.documentOffsets.byteEnd).toString(), hit.excerpt);
        assert.match(hit.citation.location, /^Refunds طلب 😀; lines 1-/);
        hits.set(hit.section.chunkIndex, hit);
      }
      cursor = next.cursor;
    } while (cursor);
    const nextAnchor = [...hits.values()].at(-1);
    assert(nextAnchor.section.chunkIndex > anchor.section.chunkIndex);
    anchor = nextAnchor;
  }
  assert.equal(hits.size, first.section.chunkCount);
  assert(anchor.excerpt.includes('Exception: gifts qualify without proof of purchase.'));
  assert.equal(anchor.section.omittedAfter, 0);
  assert.equal(anchor.section.omittedBefore, hits.size - 1);
  const reconstructed = [...hits.values()].reduce((value, hit) => value + hit.excerpt.slice(Math.max(0, value.length - hit.offsets.start)), '');
  assert.equal(reconstructed, text);
});

test('section metadata reads only the matched chunk and does not hydrate other section contents', async t => {
  const {roots} = fixture(t), text = '# Rule\nNeedle.\n' + 'Ordinary detail طلب 😀.\n'.repeat(700);
  put(roots, 'rules.md', text); await updateContext(roots, input([source('rules', 'rules.md')]));
  const manifest = readManifest(roots, 'completeness'), store = storeFor(roots, manifest);
  const record = store.source(store.lookup(manifest.catalogs.sources, 'rules'), false), fact = store.get(record.contributions[0].fact, 'fact');
  const forbidden = new Set(fact.chunks.slice(1).map(ref => ref + '.json'));
  const originalRead = fs.readFileSync; const reads = [];
  fs.readFileSync = (...args) => {reads.push(String(args[0]).replaceAll('\\', '/').split('/').at(-1)); return originalRead(...args);};
  syncBuiltinESMExports();
  try {
    const page = searchContext(roots, 'completeness', {query: 'Needle'});
    assert.equal(page.results[0].section.chunkCount, fact.chunks.length);
    assert.equal(page.results[0].section.complete, false);
    assert(!reads.some(path => forbidden.has(path)));
  } finally {fs.readFileSync = originalRead; syncBuiltinESMExports();}
});

test('complete means one captured contribution, not complete legacy source or host extraction', async t => {
  const {roots} = fixture(t);
  legacyDocuments(roots, input([]), [{id: 'legacy', path: 'legacy.md', text: 'Rule\nException'}]);
  const complete = {chunkIndex: 0, chunkCount: 1, omittedBefore: 0, omittedAfter: 0, complete: true};
  const legacy = searchContext(roots, 'completeness', {query: 'Rule'});
  assert.deepEqual(legacy.results[0].section, complete);
  assert.equal(searchContext(roots, 'completeness', {sourceId: 'legacy'}).results.length, 2);
  put(roots, 'partial.pdf', 'Synthetic bytes');
  await updateContext(roots, input([{...source('partial', 'partial.pdf'), extraction: {hash: digest('Synthetic bytes'), reader: 'host', coverage: 'partial', parts: [{location: 'page 1', text: 'Courier exception.'}]}}]));
  const host = searchContext(roots, 'completeness', {query: 'Courier'}).results[0];
  assert.deepEqual(host.section, complete); assert.equal(host.freshness.status, 'partial');
});

test('explicit refresh upgrades native sections-v1 unchanged bytes while preserving old history and unaffected receipts', async t => {
  const {roots} = fixture(t), text = '# Policy\n\nRefund eligibility\nfor gifts\n---------\nReceipt not required.\n', now = '2026-10-01T00:00:00Z';
  put(roots, 'rules.md', text); put(roots, 'unaffected.json', '{"payment":"Card accepted"}'); put(roots, 'host.md', 'Host bytes');
  // The actual sections-v1 split for this fixture, independent of the current parser.
  const boundary = text.indexOf('for gifts');
  const parts = [{location: 'Policy; lines 1-3', text: text.slice(0, boundary), document: {start: 0, end: boundary, byteStart: 0, byteEnd: boundary, lineStart: 1, lineEnd: 3, headings: ['Policy']}},
    {location: 'Policy > for gifts; lines 4-6', text: text.slice(boundary), document: {start: boundary, end: text.length, byteStart: boundary, byteEnd: text.length, lineStart: 4, lineEnd: 6, headings: ['Policy', 'for gifts']}}];
  const old = {...source('rules', 'rules.md'), name: 'rules.md', selectedFor: 'business-context', origin: 'user-supplied', hash: digest(text), extractionRecipe: 'native-document-sections-v1', recipeVersion: RECIPE,
    recipe: fingerprint({version: RECIPE, extension: 'md', extractionRecipe: 'native-document-sections-v1', encoding: 'utf-8', delimiter: null, authority: null}),
    reader: 'native', status: 'verified', coverage: 'complete', retrievedAt: now, verifiedAt: now, contributions: contextParts(parts).contributions};
  const jsonSource = {...await extractContextBytes(source('unaffected', 'unaffected.json'), Buffer.from('{"payment":"Card accepted"}'), {now}), selectedFor: 'business-context'};
  const hostSource = {...await extractContextBytes({...source('host', 'host.md'), extraction: {hash: digest('Host bytes'), reader: 'host', coverage: 'complete', parts: [{topic: 'host.rule', location: 'page 4', text: 'Host rule.'}]}}, Buffer.from('Host bytes'), {now}), selectedFor: 'business-context'};
  const sources = [old, jsonSource, hostSource], snapshot = {...input(sources), version: 2, sources, facts: facts(sources), selections: {}, capturedAt: now, updatedAt: now, status: 'complete'};
  const prepared = prepareSnapshot(roots, snapshot); prepared.manifest.index = buildIndex(roots, prepared, snapshot); prepared.manifest.revision = fingerprint(prepared.manifest);
  const directory = join(roots.projectRoot, '.harness/context/completeness'), current = join(directory, 'current.json');
  fs.mkdirSync(join(directory, 'history')); put(roots, '.harness/context/completeness/current.json', JSON.stringify(prepared.manifest));
  put(roots, `.harness/context/completeness/history/${prepared.manifest.revision}.json`, JSON.stringify(prepared.manifest));
  const before = fs.readFileSync(current), original = readContext(roots, 'completeness');
  assert.equal(searchContext(roots, 'completeness', {query: 'required'}).results[0].headings[1], 'for gifts');
  assert.deepEqual(fs.readFileSync(current), before);
  await assert.rejects(updateContext(roots, {version: 1, contextId: 'completeness'}, {beforePublish() {throw new Error('Interrupted upgrade');}}), /Interrupted upgrade/);
  assert.deepEqual(fs.readFileSync(current), before);
  const refreshed = await updateContext(roots, {version: 1, contextId: 'completeness'}), rules = refreshed.snapshot.sources.find(item => item.id === 'rules');
  assert.equal(rules.extractionRecipe, 'native-document-sections-v2'); assert.equal(rules.hash, old.hash);
  assert.deepEqual(rules.contributions[1].document.headings, ['Policy', 'Refund eligibility for gifts']);
  for (const id of ['unaffected', 'host']) {
    const prior = original.sources.find(item => item.id === id), next = refreshed.snapshot.sources.find(item => item.id === id);
    assert.equal(next.recipe, prior.recipe); assert.equal(next.extractionRecipe, prior.extractionRecipe); assert.deepEqual(next.contributions, prior.contributions);
  }
  assert.deepEqual(fs.readFileSync(join(directory, 'history', prepared.manifest.revision + '.json')), before);
  const stableIndex = readManifest(roots, 'completeness').index;
  await updateContext(roots, {version: 1, contextId: 'completeness'});
  assert.deepEqual(readManifest(roots, 'completeness').index, stableIndex);
});
