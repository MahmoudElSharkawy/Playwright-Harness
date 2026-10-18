import {existsSync, mkdirSync, openSync, closeSync, unlinkSync, writeSync, linkSync} from 'node:fs';
import {dirname, extname} from 'node:path';
import {consumerPath} from '../consumer-paths.mjs';
import {identifier, keys} from '../project-config.mjs';
import {data, digest, fingerprint, requireThat} from '../execution-core/data.mjs';
import {writeJson, publishExclusive} from '../execute/storage.mjs';
import {createAdoClient} from '../integrations/ado-client.mjs';
import {loadAdoConfiguration, adoGuid, readConsumerJson, validateAdoConfiguration} from '../integrations/config.mjs';
import {createAdoContextSource, validateContextPolicy, validateContextScope, resolveContextPolicy} from '../integrations/ado-context.mjs';
import {htmlToText} from '../integrations/ado-steps.mjs';
import {readFileContext, extractContextBytes, contextParts} from './files.mjs';
import {randomUUID} from 'node:crypto';
import {contextData, facts, inactive, RECIPE, restoreText} from './model.mjs';
import {contextFile, readManifest, loadSnapshot, baseline, prepareSnapshot, backupLegacy, storeFor, capturedCustom} from './storage.mjs';
import {buildIndex} from './search.mjs';
export {readContextOverview, searchContext} from './search.mjs';

const sourceId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value);

const stamp = value => {requireThat(typeof value === 'string' && Number.isFinite(Date.parse(value)), 'Invalid context verification date.'); return value;};
export function readContext(roots, contextId) {
  const snapshot = loadSnapshot(roots, readManifest(roots, contextId));
  if (snapshot && !snapshot.facts) snapshot.facts = facts(snapshot.sources); return snapshot;
}
function validateRequest(input) {
  keys(input, ['version', 'contextId', 'identity', 'scope', 'sources', 'ado'], 'context request');
  requireThat(input.version === 1 && identifier(input.contextId), 'Invalid context request version/identifier.');
  keys(input.identity, ['project', 'repository'], 'context project identity');
  requireThat(typeof input.identity.project === 'string' && input.identity.project.trim() && input.identity.project.length <= 200, 'Context needs an explicit consumer/project identity.'); data(input.identity);
  keys(input.scope, ['application', 'environment'], 'context scope');
  requireThat(['application', 'environment'].every(key => typeof input.scope[key] === 'string' && input.scope[key].trim() && input.scope[key].length <= 200), 'Context needs application and environment scope.'); data(input.scope);
  requireThat(Array.isArray(input.sources) && input.sources.length <= 500 && new Set(input.sources.map(source => source.id)).size === input.sources.length, 'Context needs distinct selected sources.');
  for (const source of input.sources) {
    keys(source, ['id', 'kind', 'path', 'origin', 'authority', 'encoding', 'delimiter', 'extraction', 'status'], 'context source'); requireThat(sourceId(source.id), 'Invalid context source identity.');
    requireThat(source.status === undefined || source.status === 'removed', 'Only explicit removal is accepted as a source status.');
    requireThat(source.origin === undefined || typeof source.origin === 'string' && source.origin.trim() && source.origin.length <= 1000, 'Invalid context source origin.');
  }
  if (input.ado !== undefined) {
    keys(input.ado, ['sourceId', 'policy', 'scope', 'attachments'], 'ADO context request');
    requireThat(identifier(input.ado.sourceId), 'Invalid configured ADO context source.');
    if (input.ado.policy !== undefined) validateContextPolicy(input.ado.policy);
    if (input.ado.scope !== undefined) validateContextScope(input.ado.scope);
    if (input.ado.attachments !== undefined) requireThat(Array.isArray(input.ado.attachments) && input.ado.attachments.every(entry => sourceId(entry.id) && adoGuid(entry.attachmentId)), 'Invalid attachment reader receipts.');
  }
}
function reconcile(previous, next) {
  if (next.status === 'verified' || inactive.has(next.status) || !previous) return next;
  return {...previous, ...next, ...(previous.hash ? {hash: previous.hash} : {}), ...(next.hash && previous.hash && next.hash !== previous.hash ? {attemptedHash: next.hash} : {}),
    ...(previous.verifiedAt ? {verifiedAt: previous.verifiedAt} : {}), contributions: previous.contributions};
}

function destination(url, client, project, resource) {
  let parsed; try {parsed = new URL(url);} catch {return;}
  if (parsed.username || parsed.password || parsed.search || parsed.hash) return;
  for (const scope of ['', ...[project.id, project.name].map(name => '/' + encodeURIComponent(name))]) {
    const prefix = client.configuration.organizationUrl + scope + '/_apis/wit/' + resource + '/';
    if (parsed.href.toLowerCase().startsWith(prefix.toLowerCase())) return parsed.href.slice(prefix.length).replace(/\/$/, '');
  }
}
const projectKey = project => fingerprint({organizationUrl: project.organizationUrl, id: project.id});
async function bindProject(roots, input, manifest, options) {
  const legacyAdo = manifest?.version === 1 && manifest.sources.some(source => source.collection);
  if (!input.ado && !manifest?.adoProject && !legacyAdo) return {};
  const loaded = options.client ? undefined : loadAdoConfiguration(roots, {}, options.environment ?? process.env);
  const client = options.client ?? createAdoClient({...loaded, roots, fetchImpl: options.fetchImpl});
  const identity = await client.projectIdentity(); requireThat(adoGuid(identity.id) && typeof identity.name === 'string' && identity.name.length > 0, 'ADO project identity is incomplete.');
  const project = {organizationUrl: client.configuration.organizationUrl.replace(/\/$/, '').toLowerCase(), id: identity.id.toLowerCase(), name: identity.name};
  requireThat(!manifest?.adoProject || projectKey(manifest.adoProject) === projectKey(project), 'ADO project identity differs from the captured context; select a different context identifier.');
  if (legacyAdo) {
    const origins = [identity.name, identity.id].map(value => (project.organizationUrl + '/' + encodeURIComponent(value)).toLowerCase());
    requireThat(manifest.sources.filter(source => source.collection).every(source => origins.some(origin => source.origin?.toLowerCase() === origin || source.origin?.toLowerCase().startsWith(origin + '/_workitems/edit/'))), 'Legacy ADO project ownership is ambiguous; migration stopped without changing the snapshot.');
  }
  return {client, project};
}
function capturedRelations(candidates, available) {
  const relations = [], relationGaps = [];
  for (const candidate of candidates) {
    if (candidate.targetId && candidate.reason !== 'unverified-destination' && available.has(candidate.targetId)) relations.push({relation: candidate.relation, workItemId: candidate.targetId});
    else relationGaps.push({...candidate, reason: candidate.reason === 'unverified-destination' ? candidate.reason : 'outside-selected-or-available-items'});
  }
  return {relations: [...new Map(relations.map(link => [fingerprint(link), link])).values()], relationGaps};
}
async function adoRecords(roots, input, previous, options, now) {
  const {client, project} = options, collection = input.sourceId, configuration = client.configuration.context?.sources?.[collection] ?? {};
  const prior = previous?.selections?.[collection], old = new Map((previous?.sources ?? []).filter(source => source.collection === collection).map(source => [source.id, source]));
  const children = new Map(); for (const source of old.values()) if (source.parentId && !inactive.has(source.status)) {const list = children.get(source.parentId) ?? []; list.push(source); children.set(source.parentId, list);}
  const reuse = decision => {
    const source = old.get(collection + '-item-' + decision.id);
    return previous?.version === 2 && source?.status === 'verified' && source.coverage === 'complete' && source.recipeVersion === RECIPE && source.version === String(decision.rev)
      && source.projectKey === projectKey(project) && (children.get(source.id) ?? []).every(child => child.status === 'verified' && child.coverage === 'complete' && child.recipeVersion === RECIPE && child.parentRevision === source.version && child.relationBinding
        && (!input.attachments?.some(receipt => receipt.id === child.id) || fingerprint(input.attachments.find(receipt => receipt.id === child.id).extraction) === child.extractionRecipe)
        && (!options.stageAttachments || child.localPath && existsSync(consumerPath(roots, child.localPath))));
  };
  const result = await createAdoContextSource(client).retrieve({policy: input.policy ?? configuration.policy, scope: input.scope ?? configuration.scope ?? {}, previousMetadata: prior?.metadata, reuse, allowPartial: true});
  if (result.status !== 'READY') return {selectionRequired: {...result, sourceId: collection}};
  const records = [], selected = new Set(), available = new Set([...result.items.map(item => item.id), ...result.reused.map(item => item.id)]);
  const origin = project.organizationUrl + '/' + encodeURIComponent(project.name);
  for (const decision of result.reused) {
    const id = collection + '-item-' + decision.id, cached = old.get(id); selected.add(id);
    const candidates = [...(cached.relations ?? []).map(link => ({relation: link.relation, targetId: link.workItemId})), ...(cached.relationGaps ?? [])];
    records.push({...cached, origin, retrievedAt: now, revisionVerifiedAt: now, membershipVerifiedAt: now, ...capturedRelations(candidates, available)});
    for (const child of children.get(id) ?? []) {selected.add(child.id); records.push({...child, origin: origin + '/_workitems/edit/' + decision.id, retrievedAt: now, revisionVerifiedAt: now});}
  }
  for (const decision of result.unavailable) {
    const id = collection + '-item-' + decision.id; selected.add(id);
    records.push({...old.get(id), id, kind: 'work-item', collection, workItemId: decision.id, origin, projectKey: projectKey(project), status: 'unverified', coverage: 'item-unavailable-or-changed', retrievedAt: now, contributions: old.get(id)?.contributions ?? []});
    for (const child of children.get(id) ?? []) {selected.add(child.id); records.push({...child, status: 'unverified', coverage: 'parent-unavailable', retrievedAt: now});}
  }
  for (const item of result.items) {
    const id = collection + '-item-' + item.id; selected.add(id);
    const parts = Object.entries(item.fields).filter(([name, value]) => typeof value === 'string' && (name === 'System.Title' || /(?:Description|AcceptanceCriteria|ReproSteps|TCM\.Steps)$/.test(name)))
      .flatMap(([location, value]) => {const text = htmlToText(value); return text.trim() ? [{location, text}] : [];});
    const extracted = contextParts(parts, 'observation');
    const candidates = (item.relations ?? []).filter(link => link.rel !== 'AttachedFile').map(link => {
      const raw = destination(link.url, client, project, 'workItems'), targetId = /^[1-9][0-9]*$/.test(raw ?? '') ? Number(raw) : undefined;
      return {relation: typeof link.rel === 'string' ? link.rel.slice(0, 200) : 'unknown', ...(Number.isSafeInteger(targetId) ? {targetId} : {reason: 'unverified-destination'})};
    });
    records.push({id, kind: 'work-item', collection, workItemId: item.id, origin, projectKey: projectKey(project), version: String(item.rev), hash: fingerprint({rev: item.rev, parts}), recipeVersion: RECIPE,
      retrievedAt: now, revisionVerifiedAt: now, membershipVerifiedAt: now, verifiedAt: now, status: 'verified', coverage: 'complete', ...extracted, ...capturedRelations(candidates, available)});
    for (const [number, relation] of (item.relations ?? []).entries()) if (relation.rel === 'AttachedFile') {
      const raw = destination(relation.url, client, project, 'attachments'), attachmentId = adoGuid(raw) ? raw.toLowerCase() : undefined;
      const attachmentSourceId = attachmentId ? collection + '-attachment-' + item.id + '-' + attachmentId : collection + '-attachment-' + item.id + '-unavailable-' + number; selected.add(attachmentSourceId);
      const name = relation.attributes?.name ?? 'attachment', receipt = input.attachments?.find(entry => entry.attachmentId.toLowerCase() === attachmentId && entry.id === attachmentSourceId);
      const source = {id: attachmentSourceId, kind: 'attachment', origin: origin + '/_workitems/edit/' + item.id, name, parentId: id, collection, ...(receipt?.extraction ? {extraction: receipt.extraction} : {})};
      const binding = {projectKey: projectKey(project), parentRevision: String(item.rev), relationBinding: fingerprint({id, attachmentId: attachmentId ?? null, name})};
      if (!attachmentId) {records.push({...source, ...binding, status: 'unverified', coverage: 'attachment-destination-unverified', retrievedAt: now, contributions: []}); continue;}
      let bytes;
      try {bytes = await client.attachment(attachmentId);} catch {records.push({...source, ...binding, attachmentId, status: 'unverified', coverage: 'attachment-inaccessible', retrievedAt: now, contributions: []}); continue;}
      let localPath;
      if (options.stageAttachments) {
        const extension = extname(name).slice(1).toLowerCase(); localPath = '.harness/runs/context/' + options.contextId + '/' + attachmentSourceId + '-' + digest(bytes) + (/^[a-z0-9]{1,10}$/.test(extension) ? '.' + extension : '.bin');
        const path = consumerPath(roots, localPath); if (!existsSync(path)) publishExclusive(path, bytes);
      }
      records.push({...await extractContextBytes(source, bytes, {...options, now, previous: old.get(attachmentSourceId)}), ...binding, attachmentId, ...(localPath ? {localPath} : {})});
    }
  }
  const decisions = new Map(result.selection.items.map(item => [item.id, item]));
  for (const source of old.values()) if (!selected.has(source.id)) {
    const parentItemId = source.workItemId ?? old.get(source.parentId)?.workItemId, decision = decisions.get(parentItemId), status = decision && !decision.included && decision.reason !== 'outside-area-scope' ? 'excluded' : 'out-of-scope';
    records.push({...source, projectKey: projectKey(project), status, reason: decision?.reason ?? 'outside-current-source-scope', retrievedAt: now, contributions: []});
  }
  return {records, selection: {sourceId: collection, origin, project, scope: result.scope, effectivePolicy: result.policy, metadata: result.metadata, metadataVerifiedAt: now, metadataChanges: result.metadataChanges, ...result.selection}};
}
const withoutVerification = source => Object.fromEntries(Object.entries(source).filter(([key]) => !['retrievedAt', 'verifiedAt', 'revisionVerifiedAt', 'membershipVerifiedAt'].includes(key)));

/** Live reads are explicit. Captured search/read never call this composition. */
export async function retrieveContext(roots, input, options = {}) {
  validateRequest(input); const now = stamp(options.now ?? new Date().toISOString()), manifest = readManifest(roots, input.contextId);
  if (manifest) requireThat(fingerprint(manifest.identity) === fingerprint(input.identity) && fingerprint(manifest.scope) === fingerprint(input.scope), 'Captured context identity/scope differs; choose the matching context identifier.');
  // Bind the configured project before loading evidence or querying metadata/content.
  const bound = await bindProject(roots, input, manifest, options), previous = loadSnapshot(roots, manifest); if (previous && !previous.facts) previous.facts = facts(previous.sources);
  if (options.persist && manifest?.version === 1) requireThat(fingerprint(facts(previous.sources)) === fingerprint(previous.facts), 'Legacy facts differ from their source evidence; preserve and repair the original snapshot before migration.');
  const originalBaseline = baseline(roots, manifest), existing = new Map((previous?.sources ?? []).map(source => [source.id, source])), original = new Map(existing), checked = [], selections = structuredClone(previous?.selections ?? {});
  for (const source of input.sources) {
    const prior = existing.get(source.id); requireThat(!prior?.collection, 'A file source cannot replace a selected ADO source.');
    requireThat(source.status !== 'removed' || prior, 'Only a previously captured source can be explicitly removed.');
    requireThat(!prior || source.status === 'removed' || prior.kind === source.kind && prior.path === source.path && (!source.origin || prior.origin === source.origin), 'A source identifier cannot be reassigned to another origin.');
    const next = source.status === 'removed' ? {...prior, status: 'removed', reason: 'explicit-removal', retrievedAt: now, contributions: []} : await readFileContext(roots, source, {...options, now, previous: prior});
    existing.set(source.id, reconcile(prior, next)); checked.push(source.id);
  }
  const adoInputs = input.ado ? [input.ado] : [];
  if (options.persist && manifest?.version === 1) for (const collection of new Set(previous.sources.map(source => source.collection).filter(Boolean))) {
    if (!adoInputs.some(item => item.sourceId === collection)) adoInputs.push({sourceId: collection});
  }
  for (const adoInput of adoInputs) {
    requireThat(!input.sources.some(source => source.id.startsWith(adoInput.sourceId + '-')), 'File and ADO context identities overlap.');
    let result;
    try {result = await adoRecords(roots, adoInput, previous, {...options, ...bound, contextId: input.contextId}, now);} catch {
      requireThat(!options.persist || manifest?.version !== 1, 'Legacy ADO recapture failed; migration stopped without changing the snapshot.');
      const old = [...existing.values()].filter(source => source.collection === adoInput.sourceId && !inactive.has(source.status));
      result = {records: old.length ? old.map(source => ({...source, status: 'unverified', coverage: 'ado-unavailable', retrievedAt: now})) : [{id: adoInput.sourceId + '-unavailable', collection: adoInput.sourceId, kind: 'work-item', origin: 'configured-ado', projectKey: projectKey(bound.project), status: 'unverified', coverage: 'ado-unavailable', retrievedAt: now, contributions: []}]};
    }
    if (result.selectionRequired) return {...result.selectionRequired, saved: false};
    if (result.selection) selections[adoInput.sourceId] = result.selection;
    for (const next of result.records) {
      requireThat(!existing.has(next.id) || existing.get(next.id).collection === adoInput.sourceId, 'ADO context identity overlaps an unrelated file source.'); existing.set(next.id, reconcile(existing.get(next.id), next)); checked.push(next.id);
    }
  }
  const sources = [...existing.values()].sort((a, b) => a.id.localeCompare(b.id)), content = facts(sources);
  if (options.persist && manifest?.version === 1 && bound.project) requireThat(sources.filter(source => source.collection).every(source => source.projectKey === projectKey(bound.project) && (inactive.has(source.status) || source.status === 'verified' && source.recipeVersion === RECIPE)), 'Legacy ADO recapture is incomplete; migration stopped without changing the snapshot.');
  const gaps = sources.filter(source => !inactive.has(source.status) && (source.status !== 'verified' || source.relationGaps?.length)).map(source => ({sourceId: source.id, status: source.status, coverage: source.coverage, relationGaps: source.relationGaps?.length ?? 0}));
  if (!sources.length && !Object.values(selections).some(selection => selection.includedCount === 0)) gaps.push({status: 'unverified', coverage: 'no-selected-sources'});
  if (content.some(fact => fact.status === 'conflicting')) gaps.push({status: 'conflicting', coverage: 'conflicting-facts'});
  const snapshot = {version: 2, contextId: input.contextId, identity: structuredClone(input.identity), scope: structuredClone(input.scope), ...(bound.project ? {adoProject: bound.project} : {}), capturedAt: previous?.capturedAt ?? now,
    updatedAt: checked.length || input.ado || !previous ? now : previous.updatedAt, status: gaps.length ? 'partial' : 'complete', sources, facts: content, selections,
    ...(previous?.custom === undefined ? {} : {custom: structuredClone(previous.custom)}), ...(gaps.length && previous ? {lastCompleteRevision: previous.status === 'complete' ? previous.revision : previous.lastCompleteRevision ?? null} : {})};
  // Validate bounded objects separately; the complete corpus has no one-document 1 MiB limit.
  sources.forEach(source => contextData(source, 16 * 1024 * 1024)); if (snapshot.custom !== undefined) contextData(snapshot.custom); snapshot.revision = fingerprint(snapshot);
  const before = new Set((previous?.facts ?? []).map(fact => fact.id)), after = new Set(content.map(fact => fact.id));
  const changes = {added: [...after].filter(id => !before.has(id)), removed: [...before].filter(id => !after.has(id)), changed: checked.filter(id => {const old = original.get(id); return old && fingerprint(withoutVerification(old)) !== fingerprint(withoutVerification(existing.get(id)));})};
  return {status: 'READY', snapshot, changes, checked, gaps, baseline: originalBaseline, saved: false};
}
/** Publish the index generation and immutable history before atomically switching the manifest. */
export async function updateContext(roots, input, options = {}) {
  const result = await retrieveContext(roots, input, {...options, persist: true}); if (result.status !== 'READY') return result;
  const currentFile = contextFile(roots, input.contextId), lock = contextFile(roots, input.contextId, 'writer.lock'); mkdirSync(dirname(currentFile), {recursive: true}); closeSync(openSync(lock, 'wx', 0o600));
  try {
    const current = readManifest(roots, input.contextId); requireThat(baseline(roots, current) === result.baseline, 'Context changed during retrieval; refresh again before publishing.');
    backupLegacy(roots, current);
    const prepared = prepareSnapshot(roots, result.snapshot); prepared.manifest.index = buildIndex(roots, prepared, result.snapshot, current); prepared.manifest.revision = fingerprint(prepared.manifest);
    contextData(prepared.manifest, 65536); const history = contextFile(roots, input.contextId, 'history/' + prepared.manifest.revision + '.json');
    if (!existsSync(history)) writeJson(history, prepared.manifest, {exclusive: true, compact: true});
    options.beforePublish?.(); requireThat(baseline(roots, readManifest(roots, input.contextId)) === result.baseline, 'Context changed during publication; refresh again before publishing.');
    if (current?.version === 1 && result.snapshot.custom !== undefined && !existsSync(contextFile(roots, input.contextId, 'custom.json'))) writeJson(contextFile(roots, input.contextId, 'custom.json'), result.snapshot.custom);
    if (!current || current.revision !== prepared.manifest.revision) writeJson(currentFile, prepared.manifest, {compact: true});
    result.snapshot.revision = prepared.manifest.revision; return {...result, saved: true, path: '.harness/context/' + input.contextId + '/current.json'};
  } finally {unlinkSync(lock);}
}

/** Stream a full logical snapshot into a new consumer-owned file; stdout receives only a receipt. */
export function exportContext(roots, id, output) {
  const manifest = readManifest(roots, id); requireThat(manifest, 'No captured context to export.');
  const path = consumerPath(roots, output); requireThat(!existsSync(path) && !path.replaceAll('\\', '/').includes('/.harness/context/'), 'Export needs a new consumer file outside context storage.');
  mkdirSync(dirname(path), {recursive: true}); const temporary = path + '.' + randomUUID() + '.tmp', file = openSync(temporary, 'wx', 0o600);
  const write = value => writeSync(file, value); let complete = false;
  try {
    if (manifest.version === 1) write(JSON.stringify(manifest));
    else {
      const store = storeFor(roots, manifest), references = new Map(), custom = capturedCustom(roots, manifest);
      write(JSON.stringify({version: 2, contextId: id, identity: manifest.identity, scope: manifest.scope, ...(manifest.adoProject ? {adoProject: manifest.adoProject} : {}), capturedAt: manifest.capturedAt, updatedAt: manifest.updatedAt, status: manifest.status, revision: manifest.revision, ...(custom === undefined ? {} : {custom}), ...(manifest.lastCompleteRevision === undefined ? {} : {lastCompleteRevision: manifest.lastCompleteRevision})}).slice(0, -1));
      write(',"sources":['); let first = true;
      for (const entry of store.entries(manifest.catalogs.sources)) {
        const source = store.source(entry.ref); if (!first) write(','); first = false; write(JSON.stringify(source));
        if (!inactive.has(source.status)) for (const part of source.contributions) {const factId = fingerprint({topic: part.topic, text: part.text}), list = references.get(factId) ?? []; list.push({sourceId: source.id, location: part.location, authority: part.authority, status: source.status, ...(source.verifiedAt ? {verifiedAt: source.verifiedAt} : {})}); references.set(factId, list);}
      }
      write('],"facts":['); first = true; const topics = new Map();
      for (const entry of store.entries(manifest.catalogs.facts)) if (references.has(entry.id)) {const fact = store.get(entry.ref, 'fact'); topics.set(fact.topic, (topics.get(fact.topic) ?? 0) + 1);}
      for (const entry of store.entries(manifest.catalogs.facts)) if (references.has(entry.id)) {
        const record = store.get(entry.ref, 'fact'), refs = references.get(entry.id), verified = refs.filter(r => r.status === 'verified');
        const status = topics.get(record.topic) > 1 ? 'conflicting' : !verified.length ? 'stale' : verified.some(r => r.authority === 'reviewed') ? 'reviewed' : verified.some(r => r.authority === 'current') ? 'current' : 'observation';
        if (!first) write(','); first = false; write(JSON.stringify({id: record.id, topic: record.topic, text: restoreText(record.chunks.map(ref => store.get(ref, 'chunk'))), references: refs, status}));
      }
      write('],"selections":{'); first = true;
      for (const [name, ref] of Object.entries(manifest.selections)) {
        const {pages, ...selection} = store.get(ref, 'selection'); if (!first) write(','); first = false;
        write(JSON.stringify(name) + ':' + JSON.stringify(selection).slice(0, -1) + ',"items":['); let firstItem = true;
        for (const page of pages) for (const item of store.get(page, 'selection-items')) {if (!firstItem) write(','); firstItem = false; write(JSON.stringify(item));} write(']}');
      }
      write('}}');
    }
    complete = true;
  } finally {closeSync(file); if (!complete) unlinkSync(temporary);}
  try {linkSync(temporary, path);} finally {unlinkSync(temporary);}
  return {status: 'EXPORTED', contextId: id, revision: manifest.revision, path: output};
}

/** Save an explicitly chosen policy in the existing per-project integration configuration. */
export async function saveContextPolicy(roots, name, input, options = {}) {
  requireThat(identifier(name), 'Invalid configured ADO context source.'); validateContextPolicy(input);
  const modern = readConsumerJson(roots, '.harness/integrations.json');
  requireThat(modern.version === 1 && modern.ado, 'Configure the consumer ADO integration before saving context selection.');
  const loaded = options.client ? undefined : loadAdoConfiguration(roots, {}, options.environment ?? process.env);
  const client = options.client ?? createAdoClient({...loaded, roots, fetchImpl: options.fetchImpl}), metadata = await createAdoContextSource(client).metadata();
  const {policy, repairs} = resolveContextPolicy(input, metadata);
  if (repairs.length) return {status: 'POLICY_REPAIR_REQUIRED', repairs, metadata, saved: false};
  const before = fingerprint(modern); modern.ado.context ??= {sources: {}}; modern.ado.context.sources[name] ??= {}; modern.ado.context.sources[name].policy = policy;
  validateAdoConfiguration(modern.ado);
  requireThat(fingerprint(readConsumerJson(roots, '.harness/integrations.json')) === before, 'Integration configuration changed during selection; save again.');
  writeJson(consumerPath(roots, '.harness/integrations.json'), modern);
  return {status: 'SAVED', policy, metadata, saved: true, path: '.harness/integrations.json'};
}
