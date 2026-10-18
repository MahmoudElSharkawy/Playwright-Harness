#!/usr/bin/env node
/** Synthetic, offline scale evidence. No ADO credentials, originals or network access. */
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync, readdirSync, statSync, readFileSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {consumerRoots} from '../lib/consumer-paths.mjs';
import {updateContext, searchContext, readContextOverview} from '../lib/context/index.mjs';

const [directory, mode, selectedId] = process.argv.slice(2);
assert(directory, 'Supply a new external consumer directory.');
if (mode === '--query-only') {
  const roots = consumerRoots(directory), before = process.memoryUsage(), started = performance.now();
  const result = searchContext(roots, selectedId, {query: 'payment evidence'});
  const elapsedMs = performance.now() - started;
  assert(result.results.length && result.results.length <= 8); assert(Buffer.byteLength(JSON.stringify(result)) + 1 <= 16384);
  console.log(JSON.stringify({elapsedMs, responseBytes: Buffer.byteLength(JSON.stringify(result)) + 1, results: result.results.length, total: result.total, heapDeltaBytes: process.memoryUsage().heapUsed - before.heapUsed, peakRssKiB: process.resourceUsage().maxRSS}));
} else {
  assert(mode === undefined, 'Use <new-directory> or <existing-directory> --query-only <context-id>.');
  const root = resolve(directory); mkdirSync(root); const roots = consumerRoots(root), results = [];
  const project = {id: '11111111-1111-4111-8111-111111111111', name: 'Synthetic'};
  writeFileSync(join(root, 'guide.txt'), Array.from({length: 80}, (_, i) => `Document section ${i}: إدارة المدفوعات. Payment evidence ${'retention '.repeat(80)}`).join('\n'));
  function size(path) {let bytes = 0, files = 0; for (const entry of readdirSync(path, {withFileTypes: true})) {const child = join(path, entry.name); if (entry.isDirectory()) {const result = size(child); bytes += result.bytes; files += result.files;} else {bytes += statSync(child).size; files++;}} return {bytes, files};}
  for (const count of [1000, 10000]) {
    let fullReads = 0, batches = 0, metadata = 0;
    const fields = id => ({'System.Id': id, 'System.Rev': 1, 'System.TeamProject': project.name, 'System.WorkItemType': id % 3 ? 'Story' : 'Test Case', 'System.State': 'Active', 'System.Title': `Payment evidence item ${id}`, 'System.Description': `Business requirement ${id}. ${'Retain payment evidence and preserve project scope. '.repeat(8)}`});
    const client = {configuration: {organizationUrl: 'https://ado.example.test', project: project.name, credentialRef: 'SYN_ADO_PAT', context: {sources: {backlog: {policy: {excludeTypes: [], excludeStates: []}}}}},
      async projectIdentity() {return project;}, async requireWorkItemProject(item) {assert.equal(item.fields['System.TeamProject'], project.name);},
      async list(route) {metadata++; return route.includes('/states?') ? [{id: 'active', name: 'Active'}] : [{name: 'Story', referenceName: 'Synthetic.Story'}, {name: 'Test Case', referenceName: 'Synthetic.Case'}];},
      async wiql(query) {const cursor = Number(query.match(/\[System.Id\] > (\d+)/)[1]); return {workItems: Array.from({length: Math.min(200, count - cursor)}, (_, i) => ({id: cursor + i + 1}))};},
      async workItems(ids, selected) {batches++; return {value: ids.map(id => ({id, rev: 1, fields: Object.fromEntries(selected.map(key => [key, fields(id)[key]]))}))};},
      async read(route) {fullReads++; const id = Number(route.match(/workitems\/(\d+)/)[1]); return {id, rev: 1, fields: fields(id), relations: []};},
      async attachment() {throw new Error('This fixture has no attachments.');}};
    const id = `scale-${count}`, request = {version: 1, contextId: id, identity: {project: 'Synthetic'}, scope: {application: 'payments', environment: 'qa'}, sources: [{id: 'guide', kind: 'file', path: 'guide.txt'}], ado: {sourceId: 'backlog'}};
    console.log(JSON.stringify({phase: 'ingest', workItems: count})); const started = performance.now();
    const captured = await updateContext(roots, request, {client, now: '2026-10-01T00:00:00Z'}), ingestionMs = performance.now() - started;
    assert.equal(captured.snapshot.status, 'complete'); assert.equal(fullReads, count);
    const first = JSON.parse(readFileSync(join(root, `.harness/context/${id}/current.json`))); fullReads = 0; const refreshStarted = performance.now();
    console.log(JSON.stringify({phase: 'refresh', workItems: count})); await updateContext(roots, request, {client, now: '2026-10-02T00:00:00Z'}); const refreshMs = performance.now() - refreshStarted;
    assert.equal(fullReads, 0); const second = JSON.parse(readFileSync(join(root, `.harness/context/${id}/current.json`))); assert.deepEqual(first.index, second.index);
    const exact = searchContext(roots, id, {workItemId: count}); assert.equal(exact.results[0].workItemId, count);
    assert(searchContext(roots, id, {query: 'اداره المدفوعات'}).results.some(hit => hit.sourceId === 'guide'));
    const query = spawnSync(process.execPath, [import.meta.filename, root, '--query-only', id], {encoding: 'utf8', windowsHide: true}); assert.equal(query.status, 0, query.stderr);
    const measurement = {workItems: count, ingestionMs, refreshMs, unchangedFullReads: fullReads, classificationBatches: batches, metadataCalls: metadata, overview: readContextOverview(roots, id).counts,
      manifestBytes: statSync(join(root, `.harness/context/${id}/current.json`)).size, storage: size(join(root, `.harness/context/${id}`)), ingestionPeakRssKiB: process.resourceUsage().maxRSS, freshProcessQuery: JSON.parse(query.stdout)};
    results.push(measurement); writeFileSync(join(root, 'scale-results.json'), JSON.stringify({node: process.version, platform: process.platform, results}, null, 2)); console.log(JSON.stringify(measurement));
  }
}
