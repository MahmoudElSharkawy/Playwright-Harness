import {existsSync, mkdirSync, openSync, closeSync, unlinkSync} from 'node:fs';
import {dirname, extname} from 'node:path';
import {consumerPath} from '../consumer-paths.mjs';
import {identifier, keys} from '../project-config.mjs';
import {data, digest, fingerprint, requireThat} from '../execution-core/data.mjs';
import {readBounded, writeJson, publishExclusive} from '../execute/storage.mjs';
import {createAdoClient} from '../integrations/ado-client.mjs';
import {loadAdoConfiguration, adoGuid, readConsumerJson, validateAdoConfiguration} from '../integrations/config.mjs';
import {createAdoContextSource, validateContextPolicy, validateContextScope, resolveContextPolicy} from '../integrations/ado-context.mjs';
import {htmlToText} from '../integrations/ado-steps.mjs';
import {readFileContext, extractContextBytes, contextParts} from './files.mjs';
import {secretFindings} from '../package-validation.mjs';

const sourceId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value);
const inactive = new Set(['removed', 'excluded', 'out-of-scope']);
const stamp = value => {requireThat(typeof value === 'string' && Number.isFinite(Date.parse(value)), 'Invalid context verification date.'); return value;};
function contextData(value) {
  const result = data(value);
  function inspect(item) {
    if (typeof item === 'string') requireThat(secretFindings('context.txt', item).length === 0, 'Context contains a credential-like literal; sanitize before reading or saving.');
    else if (item && typeof item === 'object') Object.values(item).forEach(inspect);
  }
  inspect(result); return result;
}
function contextFile(roots, contextId, suffix = 'current.json') {
  requireThat(identifier(contextId), 'Invalid context identifier.');
  return consumerPath(roots, `.harness/context/${contextId}/${suffix}`);
}
export function readContext(roots, contextId) {
  const path = contextFile(roots, contextId); if (!existsSync(path)) return null;
  let document; try {document = readBounded(path);} catch {throw new Error('Captured context is unreadable or invalid; preserve it and inspect its history.');}
  const snapshot = contextData(document);
  keys(snapshot, ['version', 'contextId', 'identity', 'scope', 'capturedAt', 'updatedAt', 'status', 'sources', 'facts', 'selections', 'custom', 'lastCompleteRevision', 'revision'], 'captured context; preserve owner content under custom');
  requireThat(snapshot.version === 1 && snapshot.contextId === contextId && /^[a-f0-9]{64}$/.test(snapshot.revision) && Array.isArray(snapshot.sources) && Array.isArray(snapshot.facts), 'Invalid captured context snapshot.');
  return snapshot;
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
function facts(sources) {
  const found = new Map();
  for (const source of sources) if (!inactive.has(source.status)) for (const part of source.contributions) {
    const id = fingerprint({topic: part.topic, text: part.text});
    if (!found.has(id)) found.set(id, {id, topic: part.topic, text: part.text, references: []});
    found.get(id).references.push({sourceId: source.id, location: part.location, authority: part.authority, status: source.status, ...(source.verifiedAt ? {verifiedAt: source.verifiedAt} : {})});
  }
  const values = [...found.values()].sort((a, b) => a.id.localeCompare(b.id));
  const topics = new Map(); for (const fact of values) topics.set(fact.topic, (topics.get(fact.topic) ?? 0) + 1);
  for (const fact of values) {
    fact.references.sort((a, b) => `${a.sourceId}:${a.location}`.localeCompare(`${b.sourceId}:${b.location}`));
    const verified = fact.references.filter(reference => reference.status === 'verified');
    fact.status = topics.get(fact.topic) > 1 ? 'conflicting' : !verified.length ? 'stale' : verified.some(reference => reference.authority === 'reviewed') ? 'reviewed' : verified.some(reference => reference.authority === 'current') ? 'current' : 'observation';
  }
  return values;
}
function attachmentIdentity(url, client, project) {
  let parsed; try {parsed = new URL(url);} catch {return;}
  if (parsed.username || parsed.password || parsed.search || parsed.hash) return;
  const base = client.configuration.organizationUrl;
  for (const scope of ['', ...[project.id, project.name].map(name => `/${encodeURIComponent(name)}`)]) {
    const prefix = `${base}${scope}/_apis/wit/attachments/`;
    if (parsed.href.toLowerCase().startsWith(prefix.toLowerCase())) {
      const id = parsed.href.slice(prefix.length).replace(/\/$/, ''); if (adoGuid(id)) return id;
    }
  }
}
async function adoRecords(roots, input, previous, options, now) {
  const loaded = options.client ? undefined : loadAdoConfiguration(roots, {}, options.environment ?? process.env);
  const client = options.client ?? createAdoClient({...loaded, roots, fetchImpl: options.fetchImpl});
  const configuration = client.configuration.context?.sources?.[input.sourceId] ?? {};
  const prior = previous?.selections?.[input.sourceId];
  const result = await createAdoContextSource(client).retrieve({policy: input.policy ?? configuration.policy, scope: input.scope ?? configuration.scope ?? {}, previousMetadata: prior?.metadata});
  if (result.status !== 'READY') return {selectionRequired: {...result, sourceId: input.sourceId}};
  const collection = input.sourceId, records = [], selected = new Set(), identity = await client.projectIdentity();
  const origin = `${client.configuration.organizationUrl}/${encodeURIComponent(identity.name)}`;
  for (const item of result.items) {
    const id = `${collection}-item-${item.id}`; selected.add(id);
    // Only bounded textual business fields enter context; identities/credentials never do.
    const parts = Object.entries(item.fields).filter(([name, value]) => typeof value === 'string' && (name === 'System.Title' || /(?:Description|AcceptanceCriteria|ReproSteps|TCM\.Steps)$/.test(name)))
      .flatMap(([location, value]) => {const text = htmlToText(value); return text.trim() && text.length <= 16000 ? [{location, text}] : [];});
    const extracted = contextParts(parts, 'observation');
    const contentComplete = Object.entries(item.fields).every(([name, value]) => typeof value !== 'string' || !/(?:Description|AcceptanceCriteria|ReproSteps|TCM\.Steps)$/.test(name) || htmlToText(value).length <= 16000);
    records.push({id, kind: 'work-item', collection, workItemId: item.id, origin, version: String(item.rev), hash: fingerprint({rev: item.rev, parts}), retrievedAt: now,
      status: contentComplete ? 'verified' : 'partial', coverage: contentComplete ? 'complete' : 'partial', ...(contentComplete ? {verifiedAt: now} : {}), ...extracted});
    for (const relation of item.relations ?? []) if (relation.rel === 'AttachedFile') {
      const attachmentId = attachmentIdentity(relation.url, client, identity), attachmentSourceId = attachmentId ? `${collection}-attachment-${item.id}-${attachmentId}` : `${collection}-attachment-${item.id}-unavailable-${records.length}`;
      selected.add(attachmentSourceId);
      const name = relation.attributes?.name ?? 'attachment', receipt = input.attachments?.find(entry => entry.attachmentId === attachmentId && entry.id === attachmentSourceId);
      const source = {id: attachmentSourceId, kind: 'attachment', origin: `${origin}/_workitems/edit/${item.id}`, name, parentId: id, collection, ...(receipt?.extraction ? {extraction: receipt.extraction} : {})};
      if (!attachmentId) {records.push({...source, status: 'unverified', coverage: 'attachment-destination-unverified', retrievedAt: now, contributions: []}); continue;}
      let bytes;
      try {bytes = await client.attachment(attachmentId);} catch {records.push({...source, status: 'unverified', coverage: 'attachment-inaccessible', retrievedAt: now, contributions: []}); continue;}
      let localPath;
      if (options.stageAttachments) {
        const extension = extname(name).slice(1).toLowerCase();
        localPath = `.harness/runs/context/${previous?.contextId ?? options.contextId}/${attachmentSourceId}-${digest(bytes)}${/^[a-z0-9]{1,10}$/.test(extension) ? `.${extension}` : '.bin'}`;
        const path = consumerPath(roots, localPath); if (!existsSync(path)) publishExclusive(path, bytes);
      }
      records.push({...await extractContextBytes(source, bytes, {...options, now}), attachmentId, ...(localPath ? {localPath} : {})});
    }
  }
  const decisions = new Map(result.selection.items.map(item => [item.id, item]));
  for (const old of previous?.sources ?? []) if (old.collection === collection && !selected.has(old.id)) {
    const parentItemId = old.workItemId ?? previous.sources.find(source => source.id === old.parentId)?.workItemId;
    const decision = decisions.get(parentItemId), status = decision && !decision.included && decision.reason !== 'outside-area-scope' ? 'excluded' : 'out-of-scope';
    records.push({...old, status, reason: decision?.reason ?? 'outside-current-source-scope', retrievedAt: now, contributions: []});
  }
  return {records, selection: {sourceId: collection, origin, scope: result.scope, effectivePolicy: result.policy, metadata: result.metadata, metadataVerifiedAt: now, metadataChanges: result.metadataChanges, ...result.selection}};
}
const withoutVerification = source => Object.fromEntries(Object.entries(source).filter(([key]) => !['retrievedAt', 'verifiedAt'].includes(key)));
/** A read-only composition: source references never grant authority to follow other links. */
export async function retrieveContext(roots, input, options = {}) {
  validateRequest(input); const now = stamp(options.now ?? new Date().toISOString()), previous = readContext(roots, input.contextId);
  if (previous) requireThat(fingerprint(previous.identity) === fingerprint(input.identity) && fingerprint(previous.scope) === fingerprint(input.scope), 'Captured context identity/scope differs; choose the matching context identifier.');
  const existing = new Map((previous?.sources ?? []).map(source => [source.id, source])), checked = [], selections = structuredClone(previous?.selections ?? {});
  for (const source of input.sources) {
    requireThat(!existing.get(source.id)?.collection, 'A file source cannot replace a selected ADO source.');
    requireThat(source.status !== 'removed' || existing.has(source.id), 'Only a previously captured source can be explicitly removed.');
    const next = source.status === 'removed' ? {...existing.get(source.id), id: source.id, status: 'removed', reason: 'explicit-removal', retrievedAt: now, contributions: []} : await readFileContext(roots, source, {...options, now});
    existing.set(source.id, reconcile(existing.get(source.id), next)); checked.push(source.id);
  }
  if (input.ado) {
    requireThat(!input.sources.some(source => source.id.startsWith(`${input.ado.sourceId}-`)), 'File and ADO context identities overlap.');
    let result;
    try {result = await adoRecords(roots, input.ado, previous, {...options, contextId: input.contextId}, now);} catch {
      const old = [...existing.values()].filter(source => source.collection === input.ado.sourceId);
      result = {records: old.length ? old.map(source => ({...source, status: 'unverified', coverage: 'ado-unavailable', retrievedAt: now})) : [{id: `${input.ado.sourceId}-unavailable`, collection: input.ado.sourceId, kind: 'work-item', origin: 'configured-ado', status: 'unverified', coverage: 'ado-unavailable', retrievedAt: now, contributions: []}]};
    }
    if (result.selectionRequired) return {...result.selectionRequired, saved: false};
    if (result.selection) selections[input.ado.sourceId] = result.selection;
    for (const next of result.records) {
      requireThat(!existing.has(next.id) || existing.get(next.id).collection === input.ado.sourceId, 'ADO context identity overlaps an unrelated file source.');
      existing.set(next.id, reconcile(existing.get(next.id), next)); checked.push(next.id);
    }
  }
  const sources = [...existing.values()].sort((a, b) => a.id.localeCompare(b.id)), content = facts(sources);
  const gaps = sources.filter(source => source.status !== 'verified' && !inactive.has(source.status)).map(source => ({sourceId: source.id, status: source.status, coverage: source.coverage}));
  if (!sources.length && !Object.values(selections).some(selection => selection.includedCount === 0)) gaps.push({status: 'unverified', coverage: 'no-selected-sources'});
  if (content.some(fact => fact.status === 'conflicting')) gaps.push({status: 'conflicting', coverage: 'conflicting-facts'});
  const snapshot = {version: 1, contextId: input.contextId, identity: structuredClone(input.identity), scope: structuredClone(input.scope), capturedAt: previous?.capturedAt ?? now,
    updatedAt: checked.length || input.ado || !previous ? now : previous.updatedAt, status: gaps.length ? 'partial' : 'complete', sources, facts: content, selections,
    ...(previous?.custom === undefined ? {} : {custom: structuredClone(previous.custom)}),
    ...(gaps.length && previous ? {lastCompleteRevision: previous.status === 'complete' ? previous.revision : previous.lastCompleteRevision ?? null} : {})};
  snapshot.revision = fingerprint(snapshot); contextData(snapshot);
  const before = new Set((previous?.facts ?? []).map(fact => fact.id)), after = new Set(content.map(fact => fact.id));
  const changes = {added: [...after].filter(id => !before.has(id)), removed: [...before].filter(id => !after.has(id)),
    changed: checked.filter(id => {const old = previous?.sources.find(source => source.id === id); return old && fingerprint(withoutVerification(old)) !== fingerprint(withoutVerification(existing.get(id)));})};
  return {status: 'READY', snapshot, changes, checked, gaps, baseline: previous ? fingerprint(previous) : null, saved: false};
}
/** History first, atomic publication second, with a compare check against intervening edits. */
export async function updateContext(roots, input, options = {}) {
  const result = await retrieveContext(roots, input, options); if (result.status !== 'READY') return result;
  const currentFile = contextFile(roots, input.contextId), directory = dirname(currentFile), lock = contextFile(roots, input.contextId, 'writer.lock');
  mkdirSync(directory, {recursive: true}); const descriptor = openSync(lock, 'wx', 0o600); closeSync(descriptor);
  try {
    const current = readContext(roots, input.contextId);
    requireThat((current ? fingerprint(current) : null) === result.baseline, 'Context changed during retrieval; refresh again before publishing.');
    const history = contextFile(roots, input.contextId, `history/${result.snapshot.revision}.json`);
    if (!existsSync(history)) writeJson(history, result.snapshot, {exclusive: true});
    options.beforePublish?.();
    if (!current || fingerprint(current) !== fingerprint(result.snapshot)) writeJson(currentFile, result.snapshot);
    return {...result, saved: true, path: `.harness/context/${input.contextId}/current.json`};
  } finally {unlinkSync(lock);}
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
