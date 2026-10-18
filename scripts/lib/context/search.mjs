import {DatabaseSync} from 'node:sqlite';
import {createHash, randomUUID} from 'node:crypto';
import {existsSync, openSync, readSync, closeSync, copyFileSync, mkdirSync, unlinkSync, statSync, renameSync} from 'node:fs';
import {dirname} from 'node:path';
import {fingerprint, requireThat} from '../execution-core/data.mjs';
import {contextFile, readManifest, storeFor, capturedCustom} from './storage.mjs';
import {scopeKey, inactive, RECIPE, HASH, contextData} from './model.mjs';

const NORMALIZER = 'unicode-arabic-v1';
export function normalize(text) {
  return text.normalize('NFKC').toLowerCase().replace(/[\u0640\u064b-\u065f\u0670\u06d6-\u06ed]/gu, '').replace(/[أإآٱ]/gu, 'ا').replace(/ى/gu, 'ي').replace(/ؤ/gu, 'و').replace(/ئ/gu, 'ي').replace(/ة/gu, 'ه');
}
function fileHash(path) {
  const hash = createHash('sha256'), file = openSync(path, 'r'), buffer = Buffer.alloc(65536);
  try {let length; while ((length = readSync(file, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, length)); return hash.digest('hex');}
  finally {closeSync(file);}
}
function indexPath(roots, manifest) {
  requireThat(manifest.index && HASH.test(manifest.index.hash) && manifest.index.path === `indexes/${manifest.index.hash}.sqlite` && HASH.test(manifest.index.contentKey), 'Invalid context index; run an explicit update to repair it.');
  const path = contextFile(roots, manifest.contextId, manifest.index.path);
  requireThat(existsSync(path) && statSync(path).isFile() && fileHash(path) === manifest.index.hash, 'Missing or corrupt context index; run an explicit update to repair it.'); return path;
}
function openIndex(roots, manifest) {
  const db = new DatabaseSync(indexPath(roots, manifest), {readOnly: true, allowExtension: false, defensive: true});
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;');
    const meta = db.prepare('SELECT scopeKey, contentKey, recipe FROM metadata').get();
    requireThat(meta?.scopeKey === scopeKey(manifest) && meta.contentKey === manifest.index.contentKey && meta.recipe === `${RECIPE}/${NORMALIZER}`, 'Context index scope or recipe mismatch; run an explicit update to repair it.'); return db;
  } catch (error) {db.close(); throw error;}
}
const schema = `
CREATE TABLE metadata(scopeKey TEXT, contentKey TEXT, recipe TEXT);
CREATE TABLE sources(sourceId TEXT PRIMARY KEY, signature TEXT NOT NULL);
CREATE TABLE relations(sourceId TEXT, collection TEXT, workItemId INTEGER);
CREATE INDEX relations_source ON relations(sourceId);
CREATE TABLE entries(rowid INTEGER PRIMARY KEY, key TEXT UNIQUE, sourceId TEXT, collection TEXT, workItemId INTEGER, factId TEXT, factRef TEXT, chunkId TEXT, chunkRef TEXT, location TEXT, topic TEXT, authority TEXT, status TEXT, text TEXT);
CREATE INDEX entries_source ON entries(sourceId);
CREATE INDEX entries_item ON entries(workItemId);
CREATE INDEX entries_topic ON entries(topic);
CREATE VIRTUAL TABLE fts USING fts5(text, content='entries', content_rowid='rowid', tokenize='unicode61');
CREATE TRIGGER entries_insert AFTER INSERT ON entries BEGIN INSERT INTO fts(rowid,text) VALUES(new.rowid,new.text); END;
CREATE TRIGGER entries_delete AFTER DELETE ON entries BEGIN INSERT INTO fts(fts,rowid,text) VALUES('delete',old.rowid,old.text); END;`;

/** Copy-on-write index generation: unchanged sources retain their rows and immutable evidence. */
export function buildIndex(roots, prepared, snapshot, previous) {
  const {manifest, store, sourceRecords} = prepared, statuses = new Map(snapshot.facts.map(fact => [fact.id, fact.status]));
  const signatures = new Map();
  for (const [id, source] of sourceRecords) {
    const {retrievedAt, verifiedAt, revisionVerifiedAt, membershipVerifiedAt, ...content} = source;
    signatures.set(id, fingerprint({content, statuses: source.contributions.map(part => statuses.get(store.get(part.fact, 'fact').id) ?? 'inactive')}));
  }
  const contentKey = fingerprint({scopeKey: manifest.scopeKey, recipe: `${RECIPE}/${NORMALIZER}`, sources: [...signatures]});
  let previousPath;
  if (previous?.version === 2 && previous.scopeKey === manifest.scopeKey) {
    try {const db = openIndex(roots, previous); db.close(); previousPath = indexPath(roots, previous);} catch {/* Only explicit update may rebuild a missing/invalid derived index. */}
    if (previousPath && previous.index.contentKey === contentKey) return previous.index;
  }
  const temporary = contextFile(roots, manifest.contextId, `indexes/build-${randomUUID()}.sqlite`); mkdirSync(dirname(temporary), {recursive: true});
  if (previousPath) copyFileSync(previousPath, temporary);
  let db;
  try {
    db = new DatabaseSync(temporary, {allowExtension: false});
    db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;'); if (!previousPath) db.exec(schema);
    db.exec('BEGIN IMMEDIATE');
    const old = new Map(db.prepare('SELECT sourceId,signature FROM sources').all().map(row => [row.sourceId, row.signature]));
    const removeEntries = db.prepare('DELETE FROM entries WHERE sourceId=?'), removeLinks = db.prepare('DELETE FROM relations WHERE sourceId=?'), removeSource = db.prepare('DELETE FROM sources WHERE sourceId=?');
    const insertSource = db.prepare('INSERT INTO sources VALUES(?,?)'), insertLink = db.prepare('INSERT INTO relations VALUES(?,?,?)');
    const insert = db.prepare('INSERT INTO entries(key,sourceId,collection,workItemId,factId,factRef,chunkId,chunkRef,location,topic,authority,status,text) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const id of new Set([...old.keys(), ...signatures.keys()])) {
      if (old.get(id) === signatures.get(id)) continue;
      removeEntries.run(id); removeLinks.run(id); removeSource.run(id);
      if (!signatures.has(id)) continue;
      insertSource.run(id, signatures.get(id)); const source = sourceRecords.get(id); if (inactive.has(source.status)) continue;
      for (const link of source.relations ?? []) insertLink.run(id, source.collection ?? '', link.workItemId);
      const workItemId = source.workItemId ?? sourceRecords.get(source.parentId)?.workItemId ?? null;
      for (const part of source.contributions) {
        const fact = store.get(part.fact, 'fact');
        for (const ref of fact.chunks) {
          const chunk = store.get(ref, 'chunk'), key = fingerprint({sourceId: id, factId: fact.id, chunkId: chunk.id, location: part.location, authority: part.authority});
          insert.run(key, id, source.collection ?? '', workItemId, fact.id, part.fact, chunk.id, ref, part.location, fact.topic, part.authority, statuses.get(fact.id), normalize(chunk.text));
        }
      }
    }
    db.exec('DELETE FROM metadata'); db.prepare('INSERT INTO metadata VALUES(?,?,?)').run(manifest.scopeKey, contentKey, `${RECIPE}/${NORMALIZER}`);
    db.exec("INSERT INTO fts(fts) VALUES('integrity-check'); COMMIT;"); db.close(); db = undefined;
    const hash = fileHash(temporary), path = `indexes/${hash}.sqlite`, target = contextFile(roots, manifest.contextId, path);
    if (existsSync(target) && fileHash(target) !== hash) renameSync(target, `${target}.corrupt-${randomUUID()}`);
    if (existsSync(target)) unlinkSync(temporary); else renameSync(temporary, target);
    return {path, hash, contentKey};
  } finally {db?.close(); if (existsSync(temporary)) unlinkSync(temporary);}
}

export function readContextOverview(roots, id) {
  const manifest = readManifest(roots, id); if (!manifest) return {status: 'ABSENT', contextId: id};
  // Validate editable owner notes without disclosing an unbounded note body.
  capturedCustom(roots, manifest);
  return {status: 'CAPTURED', version: manifest.version, contextId: id, identity: manifest.identity, scope: manifest.scope, ...(manifest.adoProject ? {adoProject: manifest.adoProject} : {}),
    revision: manifest.revision, coverage: manifest.status, updatedAt: manifest.updatedAt,
    counts: manifest.counts ?? {sources: manifest.sources.length, facts: manifest.facts.length, conflicts: manifest.facts.filter(f => f.status === 'conflicting').length, gaps: manifest.sources.filter(s => !inactive.has(s.status) && s.status !== 'verified').length},
    ...(manifest.freshness ? {freshness: manifest.freshness} : {}), gaps: manifest.gaps ?? [], ...(manifest.version === 1 ? {migration: 'Explicit update required for indexed search.'} : {})};
}
export function searchContext(roots, id, options = {}) {
  const manifest = readManifest(roots, id); requireThat(manifest?.version === 2, 'Indexed search requires a captured v2 context; run an explicit update.');
  const allowed = ['query', 'sourceId', 'topic', 'workItemId', 'limit', 'maxBytes', 'cursor', 'catalog']; requireThat(Object.keys(options).every(key => allowed.includes(key)), 'Unknown context search option.');
  const limit = options.limit === undefined ? 8 : Number(options.limit), maxBytes = options.maxBytes === undefined ? 16384 : Number(options.maxBytes);
  requireThat(Number.isSafeInteger(limit) && limit >= 1 && limit <= 25 && Number.isSafeInteger(maxBytes) && maxBytes >= 4096 && maxBytes <= 65536, 'Search limits are 1–25 results and 4096–65536 output bytes.');
  const query = options.query ?? ''; requireThat(typeof query === 'string' && Buffer.byteLength(query) <= 4096, 'Search query exceeds 4096 bytes.');
  for (const key of ['sourceId', 'topic']) requireThat(options[key] === undefined || typeof options[key] === 'string' && options[key].length > 0 && options[key].length <= 200, 'Invalid search filter.');
  const inferredId = /^#?[1-9][0-9]*$/.test(query.trim()) ? Number(query.trim().replace('#', '')) : undefined;
  const workItemId = options.workItemId === undefined ? inferredId : Number(options.workItemId);
  requireThat(workItemId === undefined || Number.isSafeInteger(workItemId) && workItemId > 0, 'Invalid work item identifier.');
  const terms = [...new Set(normalize(query).match(/[\p{L}\p{N}]+/gu) ?? [])]; requireThat(terms.length <= 32, 'Search query exceeds 32 terms.');
  requireThat(options.catalog === undefined || options.catalog === 'sources' && !query && !options.sourceId && !options.topic && !workItemId, 'Source catalog browsing cannot be combined with evidence filters.');
  requireThat(options.catalog || terms.length || options.sourceId || options.topic || workItemId, 'Search needs a query or an explicit source, topic or work item.');
  const binding = fingerprint({revision: manifest.revision, scopeKey: manifest.scopeKey, query, sourceId: options.sourceId ?? null, topic: options.topic ?? null, workItemId: workItemId ?? null, catalog: options.catalog ?? null, limit, maxBytes, normalizer: NORMALIZER});
  let offset = 0;
  if (options.cursor) {
    try {requireThat(typeof options.cursor === 'string' && options.cursor.length < 2048, 'Invalid cursor.'); const cursor = JSON.parse(Buffer.from(options.cursor, 'base64url').toString()); requireThat(cursor.binding === binding && Number.isSafeInteger(cursor.offset) && cursor.offset >= 0, 'Cursor does not match revision, scope, query or filters.'); offset = cursor.offset;}
    catch {throw new Error('Cursor does not match revision, scope, query or filters.');}
  }
  if (options.catalog) {
    const store = storeFor(roots, manifest), results = [], total = manifest.counts.sources;
    const response = {status: 'SOURCES', contextId: id, revision: manifest.revision, results, total, omitted: Math.max(0, total - offset), cursor: null};
    const finish = () => {response.omitted = Math.max(0, total - offset - results.length); response.cursor = response.omitted ? Buffer.from(JSON.stringify({binding, offset: offset + results.length})).toString('base64url') : null;};
    let position = 0;
    for (const entry of store.entries(manifest.catalogs.sources)) {
      if (position++ < offset) continue; if (results.length === limit) break;
      const source = store.source(entry.ref, false), {contributions, relations, relationGaps, ...metadata} = source;
      results.push({...metadata, facts: contributions.length, relations: relations?.length ?? 0, relationGaps: relationGaps?.length ?? 0}); finish();
      if (Buffer.byteLength(JSON.stringify(response)) + 1 > maxBytes) {results.pop(); finish(); break;}
    }
    requireThat(!response.omitted || results.length > 0, 'Search output budget is too small for one source record.'); return contextData(response, maxBytes);
  }
  const filters = [], args = {};
  if (options.sourceId) {filters.push('e.sourceId=$source'); args.$source = options.sourceId;}
  if (options.topic) {filters.push('e.topic=$topic'); args.$topic = options.topic;}
  const filter = filters.length ? ` AND ${filters.join(' AND ')}` : '';
  args.$exact = options.sourceId ?? query.trim(); args.$item = workItemId ?? -1;
  args.$fts = terms.map(term => `"${term.replaceAll('"', '""')}"`).join(' OR ') || '""';
  const cte = `WITH lexical AS MATERIALIZED (SELECT e.rowid,bm25(fts) AS score FROM fts JOIN entries e ON e.rowid=fts.rowid WHERE fts MATCH $fts${filter}),
    candidates AS (SELECT e.rowid,0 AS priority,0.0 AS score FROM entries e WHERE (e.sourceId=$exact OR e.workItemId=$item${options.topic && !terms.length && !workItemId && !options.sourceId ? ' OR e.topic=$topic' : ''})${filter}
      UNION ALL SELECT e.rowid,1,0.0 FROM entries e WHERE EXISTS(SELECT 1 FROM relations r JOIN entries seed ON seed.sourceId=r.sourceId WHERE seed.workItemId=$item AND r.collection=e.collection AND r.workItemId=e.workItemId)${filter}
      UNION ALL SELECT rowid,2,score FROM lexical),
    ranked AS (SELECT rowid,min(priority) AS priority,min(score) AS score FROM candidates GROUP BY rowid)`;
  let db;
  try {
    db = openIndex(roots, manifest);
    const total = db.prepare(`${cte} SELECT count(*) AS n FROM ranked`).get(args).n;
    const rows = db.prepare(`${cte} SELECT e.*,r.priority FROM ranked r JOIN entries e ON e.rowid=r.rowid ORDER BY r.priority,r.score,e.key LIMIT $limit OFFSET $offset`).all({...args, $limit: limit, $offset: offset});
    const store = storeFor(roots, manifest), results = [];
    const response = {status: total ? 'MATCHES' : 'NO_EVIDENCE', contextId: id, revision: manifest.revision, scope: manifest.scope, ...(manifest.adoProject ? {adoProject: manifest.adoProject} : {}), results, total, omitted: Math.max(0, total - offset), cursor: null};
    const finish = () => {response.omitted = Math.max(0, total - offset - results.length); response.cursor = response.omitted ? Buffer.from(JSON.stringify({binding, offset: offset + results.length})).toString('base64url') : null;};
    for (const row of rows) {
      const sourceRef = store.lookup(manifest.catalogs.sources, row.sourceId); requireThat(sourceRef, 'Search index references an uncaptured source.');
      const source = store.source(sourceRef, false), fact = store.get(row.factRef, 'fact'), chunk = store.get(row.chunkRef, 'chunk');
      requireThat(!inactive.has(source.status) && source.contributions.some(part => part.fact === row.factRef && part.location === row.location && part.authority === row.authority) && fact.id === row.factId && fact.chunks.includes(row.chunkRef) && chunk.id === row.chunkId && chunk.factId === fact.id && normalize(chunk.text) === row.text, 'Search index and captured evidence differ; run an explicit update.');
      const hit = {sourceId: source.id, factId: fact.id, chunkId: chunk.id, excerpt: chunk.text, location: row.location, offsets: {start: chunk.start, end: chunk.end, byteStart: chunk.byteStart, byteEnd: chunk.byteEnd}, revision: source.version ?? source.hash,
        authority: row.authority, status: row.status, freshness: {status: source.status, verifiedAt: source.verifiedAt ?? null, revisionVerifiedAt: source.revisionVerifiedAt ?? null}, match: ['exact', 'relation', 'text'][row.priority], ...(row.workItemId ? {workItemId: row.workItemId} : {})};
      results.push(hit); finish();
      if (Buffer.byteLength(JSON.stringify(response)) + 1 > maxBytes) {results.pop(); finish(); break;}
    }
    requireThat(!rows.length || results.length, 'Search output budget is too small for one evidence result.');
    contextData(response, maxBytes); return response;
  } catch (error) {
    if (/index|cursor|context|budget|evidence/i.test(error.message)) throw error;
    throw new Error('Context search index is invalid; run an explicit update to repair it.');
  } finally {db?.close();}
}
