import {existsSync, readFileSync, lstatSync, readdirSync, realpathSync} from 'node:fs';
import {resolve, join, dirname} from 'node:path';
import {consumerPath} from '../consumer-paths.mjs';
import {identifier, keys} from '../project-config.mjs';
import {fingerprint, requireThat} from '../execution-core/data.mjs';
import {readBounded, writeJson, publishExclusive} from '../execute/storage.mjs';
import {within} from '../skill-roots.mjs';
import {contextData, HASH, scopeKey, bucket, chunks, restoreText, inactive, businessSource, facts} from './model.mjs';

const OBJECT_LIMIT = 16 * 1024 * 1024;
function capturedJson(path, maximum) {
  try {return readBounded(path, maximum);} catch {throw new Error('Captured context data is unreadable or invalid; preserve it and inspect its history.');}
}
export function contextFile(roots, id, suffix = 'current.json') {
  requireThat(identifier(id), 'Invalid context identifier.');
  requireThat(typeof suffix === 'string' && !/[\\:\x00-\x1f]/.test(suffix) && suffix.split('/').every(part => part && !['.', '..'].includes(part)), 'Invalid context file reference.');
  const base = resolve(roots.projectRoot, `.harness/context/${id}`), target = consumerPath(roots, `.harness/context/${id}/${suffix}`);
  // A consumer-level path check alone would permit a junction to another context.
  requireThat(within(base, target) && (!existsSync(base) || realpathSync(base) === base), 'Context reference must stay inside its own context directory.');
  return target;
}
export function readManifest(roots, id) {
  const path = contextFile(roots, id); if (!existsSync(path)) return null;
  let value; try {value = readBounded(path, 2 * 1024 * 1024);} catch {throw new Error('Captured context is unreadable or invalid; preserve it and inspect its history.');}
  const result = contextData(value, 2 * 1024 * 1024);
  requireThat(result.contextId === id && HASH.test(result.revision), 'Invalid captured context identity/revision.');
  if (result.version === 1) {
    keys(result, ['version', 'contextId', 'identity', 'scope', 'capturedAt', 'updatedAt', 'status', 'sources', 'facts', 'selections', 'custom', 'lastCompleteRevision', 'revision'], 'captured context');
    requireThat(Array.isArray(result.sources) && Array.isArray(result.facts), 'Invalid legacy context snapshot.'); return result;
  }
  keys(result, ['version', 'contextId', 'identity', 'scope', 'adoProject', 'scopeKey', 'capturedAt', 'updatedAt', 'status', 'catalogs', 'selections', 'customRef', 'lastCompleteRevision', 'counts', 'freshness', 'gaps', 'index', 'revision'], 'captured context; edit custom.json for owner notes');
  const {revision, ...body} = result;
  requireThat(result.version === 2 && Buffer.byteLength(JSON.stringify(result)) <= 65536 && scopeKey(result) === result.scopeKey && fingerprint(body) === revision, 'Invalid captured context manifest or scope.');
  for (const name of ['sources', 'facts']) requireThat(Array.isArray(result.catalogs?.[name]) && result.catalogs[name].length === 64 && result.catalogs[name].every(ref => ref === null || HASH.test(ref)), 'Invalid captured context catalog.');
  return result;
}
export function storeFor(roots, manifest) {
  const binding = scopeKey(manifest), cache = new Map();
  function get(ref, kind) {
    requireThat(HASH.test(ref), 'Invalid context object reference.');
    const key = `${kind}:${ref}`; if (cache.has(key)) return cache.get(key);
    const path = contextFile(roots, manifest.contextId, `objects/${ref.slice(0, 2)}/${ref}.json`), object = contextData(capturedJson(path, OBJECT_LIMIT), OBJECT_LIMIT);
    requireThat(object.version === 2 && object.scopeKey === binding && object.kind === kind && fingerprint(object) === ref, 'Captured context object hash/scope mismatch.');
    // Bound the read cache; search never accumulates the evidence corpus.
    if (cache.size >= 128) cache.clear(); cache.set(key, object.value); return object.value;
  }
  function put(kind, value) {
    const object = contextData({version: 2, scopeKey: binding, kind, value}, OBJECT_LIMIT), ref = fingerprint(object);
    const path = contextFile(roots, manifest.contextId, `objects/${ref.slice(0, 2)}/${ref}.json`);
    if (existsSync(path)) get(ref, kind);
    else writeJson(path, object, {exclusive: true, compact: true, maximum: OBJECT_LIMIT, maxNodes: 500000});
    return ref;
  }
  function* entries(catalog, selectedBucket) {
    const roots = selectedBucket === undefined ? catalog : [catalog[selectedBucket]];
    for (const root of roots) {
      let ref = root; const seen = new Set();
      while (ref) {
        requireThat(!seen.has(ref) && seen.size <= 20000, 'Captured context catalog cycle or size limit.'); seen.add(ref);
        const page = get(ref, 'catalog'); requireThat(Array.isArray(page.entries) && page.entries.length <= 512 && Buffer.byteLength(JSON.stringify(page)) <= 262144, 'Invalid context catalog page.');
        for (const entry of page.entries) {requireThat(typeof entry.id === 'string' && HASH.test(entry.ref), 'Invalid context catalog entry.'); yield entry;}
        ref = page.next;
      }
    }
  }
  function lookup(catalog, id) {return [...entries(catalog, bucket(id))].find(entry => entry.id === id)?.ref;}
  function catalog(values) {
    const buckets = Array.from({length: 64}, () => []); for (const entry of values) buckets[bucket(entry.id)].push(entry);
    return buckets.map(entries => {
      entries.sort((a, b) => a.id.localeCompare(b.id)); let next = null;
      for (let end = entries.length; end > 0; end -= 512) next = put('catalog', {entries: entries.slice(Math.max(0, end - 512), end), next});
      return next;
    });
  }
  function source(ref, hydrate = true) {
    const record = get(ref, 'source'); if (!hydrate) return record;
    return {...record, contributions: record.contributions.map(part => {const fact = get(part.fact, 'fact'); return {topic: fact.topic, text: restoreText(fact.chunks.map(ref => get(ref, 'chunk'))), location: part.location, authority: part.authority, ...(part.document ? {document: part.document} : {})};})};
  }
  return {get, put, entries, lookup, catalog, source};
}
export function capturedCustom(roots, manifest, {historical = false} = {}) {
  if (manifest.version === 1) return manifest.custom;
  const file = contextFile(roots, manifest.contextId, 'custom.json');
  if (!historical && existsSync(file)) return contextData(capturedJson(file, 1024 * 1024));
  return manifest.customRef ? storeFor(roots, manifest).get(manifest.customRef, 'custom') : undefined;
}
export function baseline(roots, manifest) {
  if (!manifest) return null;
  return fingerprint({manifest, custom: capturedCustom(roots, manifest) ?? null});
}
export function loadSnapshot(roots, manifest) {
  if (!manifest) return null;
  if (manifest.version === 1) return {...manifest, ...(capturedCustom(roots, manifest) === undefined ? {} : {custom: capturedCustom(roots, manifest)})};
  const store = storeFor(roots, manifest), selections = {};
  for (const [name, ref] of Object.entries(manifest.selections)) {
    const {pages, ...selection} = store.get(ref, 'selection'); selection.items = [];
    for (const ref of pages) selection.items.push(...store.get(ref, 'selection-items')); selections[name] = selection;
  }
  return {version: 2, contextId: manifest.contextId, identity: manifest.identity, scope: manifest.scope,
    ...(manifest.adoProject ? {adoProject: manifest.adoProject} : {}), capturedAt: manifest.capturedAt, updatedAt: manifest.updatedAt, status: manifest.status,
    sources: [...store.entries(manifest.catalogs.sources)].map(entry => store.source(entry.ref)).sort((a, b) => a.id.localeCompare(b.id)), selections,
    ...(capturedCustom(roots, manifest) === undefined ? {} : {custom: capturedCustom(roots, manifest)}),
    ...(manifest.lastCompleteRevision === undefined ? {} : {lastCompleteRevision: manifest.lastCompleteRevision}), revision: manifest.revision};
}
/** Immutable records and fixed-size catalog roots; history shares unchanged objects. */
export function prepareSnapshot(roots, snapshot) {
  const store = storeFor(roots, snapshot), sourceEntries = [], factEntries = new Map(), sourceRecords = new Map();
  for (const source of snapshot.sources) {
    const contributions = source.contributions.map(part => {
      const id = fingerprint({topic: part.topic, text: part.text}); let ref = factEntries.get(id);
      if (!ref) {ref = store.put('fact', {id, topic: part.topic, chunks: chunks(part.text, id).map(chunk => store.put('chunk', chunk))}); factEntries.set(id, ref);}
      return {fact: ref, location: part.location, authority: part.authority, ...(part.document ? {document: part.document} : {})};
    });
    const record = {...source, contributions}; sourceRecords.set(source.id, record); sourceEntries.push({id: source.id, ref: store.put('source', record)});
  }
  const selections = {};
  for (const [name, {items, ...selection}] of Object.entries(snapshot.selections)) {
    const pages = []; for (let i = 0; i < (items?.length ?? 0); i += 512) pages.push(store.put('selection-items', items.slice(i, i + 512)));
    selections[name] = store.put('selection', {...selection, pages});
  }
  const active = snapshot.sources.filter(s => businessSource(s) && !inactive.has(s.status)), businessFacts = facts(active);
  const times = active.map(s => s.verifiedAt).filter(Boolean).sort();
  const gaps = active.filter(s => s.status !== 'verified').map(s => ({sourceId: s.id, status: s.status, coverage: s.coverage}));
  if (businessFacts.some(f => f.status === 'conflicting')) gaps.push({status: 'conflicting', coverage: 'conflicting-facts'});
  if (!active.length && !Object.values(snapshot.selections).some(selection => selection.purpose === 'business-context' && selection.includedCount === 0)) gaps.push({status: 'unverified', coverage: 'no-selected-sources'});
  const manifest = {version: 2, contextId: snapshot.contextId, identity: snapshot.identity, scope: snapshot.scope,
    ...(snapshot.adoProject ? {adoProject: snapshot.adoProject} : {}), scopeKey: scopeKey(snapshot), capturedAt: snapshot.capturedAt, updatedAt: snapshot.updatedAt, status: snapshot.status,
    catalogs: {sources: store.catalog(sourceEntries), facts: store.catalog([...factEntries].map(([id, ref]) => ({id, ref})))}, selections,
    ...(snapshot.custom === undefined ? {} : {customRef: store.put('custom', snapshot.custom)}),
    ...(snapshot.lastCompleteRevision === undefined ? {} : {lastCompleteRevision: snapshot.lastCompleteRevision}),
    counts: {sources: active.length, activeSources: active.length, facts: businessFacts.length, conflicts: businessFacts.filter(f => f.status === 'conflicting').length, gaps: gaps.length},
    freshness: {oldestVerifiedAt: times[0] ?? null, newestVerifiedAt: times.at(-1) ?? null}, gaps: gaps.slice(0, 8)};
  return {manifest, store, sourceRecords};
}
export function backupLegacy(roots, manifest) {
  if (manifest?.version !== 1) return;
  const directory = dirname(contextFile(roots, manifest.contextId)), history = join(directory, 'history');
  const files = ['current.json', ...(existsSync(history) ? readdirSync(history).filter(name => HASH.test(name.replace(/\.json$/, ''))).map(name => `history/${name}`) : [])];
  for (const file of files) {
    const from = contextFile(roots, manifest.contextId, file); requireThat(lstatSync(from).isFile(), 'Invalid legacy history file.');
    const to = contextFile(roots, manifest.contextId, `legacy/${fingerprint(manifest)}/${file}`), bytes = readFileSync(from);
    if (!existsSync(to)) publishExclusive(to, bytes);
    else requireThat(readFileSync(to).equals(bytes), 'Legacy backup differs; preserve the existing snapshot.');
  }
}
