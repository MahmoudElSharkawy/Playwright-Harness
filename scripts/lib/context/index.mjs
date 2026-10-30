import {existsSync, mkdirSync, openSync, closeSync, unlinkSync, writeSync, linkSync, lstatSync, readFileSync} from 'node:fs';
import {dirname, extname} from 'node:path';
import {consumerPath} from '../consumer-paths.mjs';
import {identifier, keys} from '../project-config.mjs';
import {data, digest, fingerprint, requireThat} from '../execution-core/data.mjs';
import {writeJson, publishExclusive} from '../execute/storage.mjs';
import {createAdoClient} from '../integrations/ado-client.mjs';
import {loadAdoConfiguration, adoGuid, readConsumerJson, validateAdoConfiguration} from '../integrations/config.mjs';
import {createAdoContextSource, validateContextPolicy, validateContextScope, resolveContextPolicy} from '../integrations/ado-context.mjs';
import {createTrackerClient, trackerProvider} from '../integrations/selection.mjs';
import {createJiraContextSource, validateJiraContextScope} from '../integrations/jira-context.mjs';
import {validateJiraConfiguration, jiraIssueKey} from '../integrations/jira-config.mjs';
import {requirementDestination} from '../requirements/sources.mjs';
import {htmlToText} from '../integrations/ado-steps.mjs';
import {readFileContext, extractContextBytes, contextParts, contextReaderRecipe} from './files.mjs';
import {randomUUID} from 'node:crypto';
import {contextData, facts, inactive, RECIPE, restoreText, businessSource} from './model.mjs';
import {contextFile, readManifest, loadSnapshot, baseline, prepareSnapshot, backupLegacy, storeFor, capturedCustom} from './storage.mjs';
import {buildIndex} from './search.mjs';
export {readContextOverview, searchContext} from './search.mjs';

const sourceId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value);

const stamp = value => {requireThat(typeof value === 'string' && Number.isFinite(Date.parse(value)), 'Invalid context verification date.'); return value;};
export function readContext(roots, contextId) {
  const snapshot = loadSnapshot(roots, readManifest(roots, contextId));
  if (snapshot) {snapshot.sources = snapshot.sources.filter(businessSource); snapshot.facts = facts(snapshot.sources);} return snapshot;
}
const fileSelection = source => Object.fromEntries(['id', 'kind', 'path', 'origin', 'authority', 'encoding', 'delimiter'].filter(key => source[key] !== undefined).map(key => [key, source[key]]));
function savedSources(roots, manifest) {
  if (!manifest) return [];
  const store = manifest.version === 2 ? storeFor(roots, manifest) : undefined;
  const sources = store ? [...store.entries(manifest.catalogs.sources)].map(entry => store.source(entry.ref, false)) : manifest.sources;
  requireThat(!sources.some(source => !inactive.has(source.status) && !businessSource(source)), 'This older context needs explicit business-source selection before a full refresh. History is preserved.');
  return sources.filter(source => businessSource(source) && source.kind === 'file' && !inactive.has(source.status)).map(fileSelection);
}
function validateRequest(input) {
  keys(input, ['version', 'contextId', 'identity', 'scope', 'sources', 'ado', 'jira'], 'context request');
  requireThat(input.version === 1 && identifier(input.contextId), 'Invalid context request version/identifier.');
  keys(input.identity, ['project', 'repository'], 'context project identity');
  requireThat(typeof input.identity.project === 'string' && input.identity.project.trim() && input.identity.project.length <= 200, 'Context needs an explicit consumer/project identity.'); data(input.identity);
  keys(input.scope, ['application', 'environment'], 'context scope');
  requireThat(['application', 'environment'].every(key => typeof input.scope[key] === 'string' && input.scope[key].trim() && input.scope[key].length <= 200), 'Context needs application and environment scope.'); data(input.scope);
  requireThat(Array.isArray(input.sources) && input.sources.length <= 500 && new Set(input.sources.map(source => source.id)).size === input.sources.length, 'Context needs distinct selected sources.');
  for (const source of input.sources) {
    keys(source, ['id', 'kind', 'path', 'origin', 'authority', 'encoding', 'delimiter', 'extraction', 'status'], 'context source'); requireThat(sourceId(source.id), 'Invalid context source identity.');
    requireThat(source.status === undefined || source.status === 'removed', 'Only explicit removal is accepted as a source status.');
    requireThat(source.status === 'removed' || source.kind === 'file', 'Select business documents as file sources; repository/POM sources are not business context.');
    if (source.status !== 'removed' && typeof source.path === 'string') requireThat(!/(?:^|[\\/])(?:\.git|\.agents|\.claude|\.github|node_modules)(?:[\\/]|$)|(?:^|[\\/])(?:AGENTS\.md|CLAUDE\.md|package(?:-lock)?\.json|npm-shrinkwrap\.json|tsconfig[^\\/]*\.json|playwright\.config\.[^\\/]+)$|\.harness[\\/](?:project|targets|integrations)\.json$|\.(?:[cm]?[jt]sx?|sql|log)$/i.test(source.path), 'Framework code and configuration cannot be business context sources.');
    requireThat(source.origin === undefined || typeof source.origin === 'string' && source.origin.trim() && source.origin.length <= 1000, 'Invalid context source origin.');
  }
  if (input.ado !== undefined) {
    keys(input.ado, ['sourceId', 'policy', 'scope', 'attachments'], 'ADO context request');
    requireThat(identifier(input.ado.sourceId), 'Invalid configured ADO context source.');
    if (input.ado.policy !== undefined) validateContextPolicy(input.ado.policy);
    if (input.ado.scope !== undefined) validateContextScope(input.ado.scope);
    if (input.ado.attachments !== undefined) {
      requireThat(Array.isArray(input.ado.attachments) && input.ado.attachments.length <= 500 && new Set(input.ado.attachments.map(entry => entry.id)).size === input.ado.attachments.length, 'Invalid selected attachments.');
      for (const entry of input.ado.attachments) {
        keys(entry, ['id', 'attachmentId', 'extraction'], 'selected attachment');
        const prefix = input.ado.sourceId + '-attachment-', suffix = '-' + String(entry.attachmentId).toLowerCase();
        requireThat(sourceId(entry.id) && adoGuid(entry.attachmentId) && entry.id.startsWith(prefix) && entry.id.endsWith(suffix) && /^[1-9][0-9]*$/.test(entry.id.slice(prefix.length, -suffix.length)), 'Invalid selected attachment identity.');
      }
    }
  }
  if (input.jira !== undefined) {
    keys(input.jira, ['sourceId', 'policy', 'scope', 'attachments', 'includeDiscussion', 'includeHistory'], 'Jira context request');
    requireThat(identifier(input.jira.sourceId) && input.jira.sourceId !== input.ado?.sourceId, 'Jira context needs a distinct configured source.');
    if (input.jira.policy !== undefined) validateContextPolicy(input.jira.policy);
    if (input.jira.scope !== undefined) validateJiraContextScope(input.jira.scope);
    for (const name of ['includeDiscussion', 'includeHistory']) requireThat(input.jira[name] === undefined || typeof input.jira[name] === 'boolean', 'Jira context discussion/history selection must be boolean.');
    if (input.jira.attachments !== undefined) {
      requireThat(Array.isArray(input.jira.attachments) && input.jira.attachments.length <= 500 && new Set(input.jira.attachments.map(entry => entry.id)).size === input.jira.attachments.length, 'Invalid selected Jira attachments.');
      for (const entry of input.jira.attachments) {
        keys(entry, ['id', 'attachmentId', 'extraction'], 'selected Jira attachment');
        const prefix = input.jira.sourceId + '-attachment-', suffix = '-' + String(entry.attachmentId);
        requireThat(sourceId(entry.id) && typeof entry.attachmentId === 'string' && /^[1-9]\d{0,19}$/.test(entry.attachmentId) && entry.id.startsWith(prefix) && entry.id.endsWith(suffix) && jiraIssueKey(entry.id.slice(prefix.length, -suffix.length)), 'Invalid selected Jira attachment identity.');
      }
    }
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
const projectKey = project => fingerprint(project.siteUrl ? {provider: 'jira', siteUrl: project.siteUrl, id: project.id} : {organizationUrl: project.organizationUrl, id: project.id});
function stagedBytesMatch(roots, source, contextId) {
  if (!source.localPath?.startsWith('.harness/runs/context/' + contextId + '/')) return false;
  try {
    const path = consumerPath(roots, source.localPath), stat = lstatSync(path);
    return stat.isFile() && stat.size <= 8 * 1024 * 1024 && digest(readFileSync(path)) === source.hash;
  } catch {return false;}
}
function stageAttachment(roots, {id, name}, bytes, options) {
  if (!options.stageAttachments) return;
  const hash = digest(bytes), extension = extname(name).slice(1).toLowerCase(), suffix = /^[a-z0-9]{1,10}$/.test(extension) ? '.' + extension : '.bin';
  const base = '.harness/runs/context/' + options.contextId + '/' + id + '-' + hash; let localPath = base + suffix;
  if (existsSync(consumerPath(roots, localPath)) && !stagedBytesMatch(roots, {localPath, hash}, options.contextId)) localPath = base + '-' + randomUUID() + suffix;
  const path = consumerPath(roots, localPath); if (!existsSync(path)) publishExclusive(path, bytes);
  return localPath;
}
async function bindProject(roots, input, manifest, options) {
  const legacyAdo = manifest?.version === 1 && manifest.sources.some(source => source.collection);
  if (!input.ado && !manifest?.adoProject && !legacyAdo) return {};
  const injected = options.clients?.ado ?? (options.client && trackerProvider(options.client) === 'ado' ? options.client : undefined);
  const loaded = injected ? undefined : loadAdoConfiguration(roots, {}, options.environment ?? process.env);
  const client = injected ?? createAdoClient({...loaded, roots, fetchImpl: options.fetchImpl});
  const identity = await client.projectIdentity(); requireThat(adoGuid(identity.id) && typeof identity.name === 'string' && identity.name.length > 0, 'ADO project identity is incomplete.');
  const project = {organizationUrl: client.configuration.organizationUrl.replace(/\/$/, '').toLowerCase(), id: identity.id.toLowerCase(), name: identity.name};
  requireThat(!manifest?.adoProject || projectKey(manifest.adoProject) === projectKey(project), 'ADO project identity differs from the captured context; select a different context identifier.');
  if (legacyAdo) {
    const origins = [identity.name, identity.id].map(value => (project.organizationUrl + '/' + encodeURIComponent(value)).toLowerCase());
    requireThat(manifest.sources.filter(source => source.collection).every(source => origins.some(origin => source.origin?.toLowerCase() === origin || source.origin?.toLowerCase().startsWith(origin + '/_workitems/edit/'))), 'Legacy ADO project ownership is ambiguous; migration stopped without changing the snapshot.');
  }
  return {client, project};
}
async function bindJiraProject(roots, input, manifest, options) {
  if (!input.jira && !manifest?.jiraProject) return {};
  const injected = options.clients?.jira ?? (options.client && trackerProvider(options.client) === 'jira' ? options.client : undefined);
  const client = createTrackerClient(roots, {...options, client: injected, provider: 'jira'}), identity = await client.projectIdentity();
  requireThat(trackerProvider(client) === 'jira' && typeof identity.id === 'string' && /^[1-9]\d{0,19}$/.test(identity.id) && identity.key === client.configuration.project && typeof identity.name === 'string' && identity.name.trim(), 'Jira project identity is incomplete.');
  const project = {siteUrl: client.configuration.siteUrl, id: identity.id, key: identity.key, name: identity.name};
  requireThat(!manifest?.jiraProject || projectKey(manifest.jiraProject) === projectKey(project), 'Jira project identity differs from the captured context; select a different context identifier.');
  return {client, project};
}
function capturedRelations(candidates, available) {
  const relations = [];
  for (const candidate of candidates) {
    if (candidate.targetId && candidate.reason !== 'unverified-destination' && available.has(candidate.targetId)) relations.push({relation: candidate.relation, workItemId: candidate.targetId});
  }
  // Unselected relationships do not expand the source set or make it incomplete.
  return {relations: [...new Map(relations.map(link => [fingerprint(link), link])).values()], relationGaps: []};
}
async function adoRecords(roots, input, previous, options, now) {
  const {client, project} = options, collection = input.sourceId, configuration = client.configuration.context?.sources?.[collection] ?? {};
  const prior = previous?.selections?.[collection], old = new Map((previous?.sources ?? []).filter(source => source.collection === collection).map(source => [source.id, source]));
  const attachments = input.attachments ?? (prior?.purpose === 'business-context' ? prior.attachments : undefined) ?? [];
  const attachmentIds = new Set(attachments.map(entry => entry.id));
  const scope = input.scope ?? prior?.scope ?? configuration.scope ?? {};
  const policy = input.policy ?? (input.scope?.workItemIds !== undefined ? {excludeTypes: [], excludeStates: []} : prior?.effectivePolicy ?? configuration.policy);
  const children = new Map(); for (const source of old.values()) if (source.parentId && !inactive.has(source.status)) {const list = children.get(source.parentId) ?? []; list.push(source); children.set(source.parentId, list);}
  const reuse = decision => {
    const source = old.get(collection + '-item-' + decision.id);
    const selectedChildren = (children.get(source?.id) ?? []).filter(child => attachmentIds.has(child.id));
    const requestedChildren = attachments.filter(entry => entry.id.startsWith(collection + '-attachment-' + decision.id + '-'));
    return previous?.version === 2 && source?.status === 'verified' && businessSource(source) && source.coverage === 'complete' && source.recipeVersion === RECIPE && source.version === String(decision.rev)
      && source.projectKey === projectKey(project) && requestedChildren.every(entry => selectedChildren.some(child => child.id === entry.id)) && selectedChildren.every(child => {
        const receipt = attachments.find(entry => entry.id === child.id && entry.attachmentId.toLowerCase() === child.attachmentId);
        return child.status === 'verified' && child.coverage === 'complete' && child.recipeVersion === RECIPE && child.parentRevision === source.version && child.relationBinding
          && child.recipe === contextReaderRecipe({...child, extraction: receipt?.extraction}, options.readers, child).recipe
          && (!options.stageAttachments || stagedBytesMatch(roots, child, options.contextId));
      });
  };
  const result = await createAdoContextSource(client).retrieve({policy, scope, previousMetadata: prior?.metadata, reuse, allowPartial: true});
  if (result.status !== 'READY') return {selectionRequired: {...result, sourceId: collection}};
  const records = [], selected = new Set(), available = new Set([...result.items.map(item => item.id), ...result.reused.map(item => item.id)]);
  const origin = project.organizationUrl + '/' + encodeURIComponent(project.name);
  for (const decision of result.reused) {
    const id = collection + '-item-' + decision.id, cached = old.get(id); selected.add(id);
    const candidates = [...(cached.relations ?? []).map(link => ({relation: link.relation, targetId: link.workItemId})), ...(cached.relationGaps ?? [])];
    records.push({...cached, origin, retrievedAt: now, revisionVerifiedAt: now, membershipVerifiedAt: now, ...capturedRelations(candidates, available)});
    for (const child of children.get(id) ?? []) if (attachmentIds.has(child.id)) {selected.add(child.id); records.push({...child, origin: origin + '/_workitems/edit/' + decision.id, retrievedAt: now, revisionVerifiedAt: now});}
  }
  for (const decision of result.unavailable) {
    const id = collection + '-item-' + decision.id; selected.add(id);
    records.push({...old.get(id), id, kind: 'work-item', selectedFor: 'business-context', collection, workItemId: decision.id, origin, projectKey: projectKey(project), status: 'unverified', coverage: 'item-unavailable-or-changed', retrievedAt: now, contributions: businessSource(old.get(id) ?? {}) ? old.get(id).contributions : []});
    for (const child of children.get(id) ?? []) if (attachmentIds.has(child.id) && businessSource(child)) {selected.add(child.id); records.push({...child, status: 'unverified', coverage: 'parent-unavailable', retrievedAt: now});}
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
    const availableAttachments = [];
    records.push({id, kind: 'work-item', selectedFor: 'business-context', title: htmlToText(item.fields['System.Title'] ?? '').slice(0, 300), availableAttachments, collection, workItemId: item.id, origin, projectKey: projectKey(project), version: String(item.rev), hash: fingerprint({rev: item.rev, parts}), recipeVersion: RECIPE,
      retrievedAt: now, revisionVerifiedAt: now, membershipVerifiedAt: now, verifiedAt: now, status: 'verified', coverage: 'complete', ...extracted, ...capturedRelations(candidates, available)});
    for (const [number, relation] of (item.relations ?? []).entries()) if (relation.rel === 'AttachedFile') {
      const raw = destination(relation.url, client, project, 'attachments'), attachmentId = adoGuid(raw) ? raw.toLowerCase() : undefined;
      const attachmentSourceId = attachmentId ? collection + '-attachment-' + item.id + '-' + attachmentId : collection + '-attachment-' + item.id + '-unavailable-' + number;
      const name = String(relation.attributes?.name ?? 'attachment').slice(0, 300), receipt = attachments.find(entry => entry.attachmentId.toLowerCase() === attachmentId && entry.id === attachmentSourceId);
      if (attachmentId) availableAttachments.push({id: attachmentSourceId, attachmentId, name});
      if (!receipt) continue;
      selected.add(attachmentSourceId);
      const source = {id: attachmentSourceId, kind: 'attachment', origin: origin + '/_workitems/edit/' + item.id, name, parentId: id, collection, ...(receipt.extraction ? {extraction: receipt.extraction} : {})};
      const binding = {projectKey: projectKey(project), parentRevision: String(item.rev), relationBinding: fingerprint({id, attachmentId: attachmentId ?? null, name})};
      if (!attachmentId) {records.push({...source, ...binding, status: 'unverified', coverage: 'attachment-destination-unverified', retrievedAt: now, contributions: []}); continue;}
      let bytes;
      try {bytes = await client.attachment(attachmentId);} catch {records.push({...source, ...binding, attachmentId, status: 'unverified', coverage: 'attachment-inaccessible', retrievedAt: now, contributions: []}); continue;}
      const localPath = stageAttachment(roots, source, bytes, options);
      records.push({...await extractContextBytes(source, bytes, {...options, now, previous: old.get(attachmentSourceId)}), selectedFor: 'business-context', ...binding, attachmentId, ...(localPath ? {localPath} : {})});
    }
  }
  const previouslySelected = new Set(prior?.purpose === 'business-context' ? (prior.attachments ?? []).map(entry => entry.id) : []);
  requireThat(attachments.every(entry => selected.has(entry.id) || previouslySelected.has(entry.id)), 'Cannot verify the attachment selection within the selected work items.');
  const decisions = new Map(result.selection.items.map(item => [item.id, item]));
  for (const source of old.values()) if (!selected.has(source.id)) {
    const parentItemId = source.workItemId ?? old.get(source.parentId)?.workItemId, decision = decisions.get(parentItemId), status = decision && !decision.included && decision.reason !== 'outside-area-scope' ? 'excluded' : 'out-of-scope';
    records.push({...source, projectKey: projectKey(project), status, reason: decision?.reason ?? 'outside-current-source-scope', retrievedAt: now, contributions: []});
  }
  for (const record of records) if (selected.has(record.id)) record.selectedFor = 'business-context';
  return {records, selection: {sourceId: collection, purpose: 'business-context', origin, project, scope: result.scope, attachments: attachments.map(({id, attachmentId}) => ({id, attachmentId: attachmentId.toLowerCase()})), effectivePolicy: result.policy, metadata: result.metadata, metadataVerifiedAt: now, metadataChanges: result.metadataChanges, ...result.selection}};
}
async function jiraRecords(roots, input, previous, options, now) {
  const {client, project} = options, collection = input.sourceId, configuration = client.configuration.context?.sources?.[collection] ?? {};
  const prior = previous?.selections?.[collection]; requireThat(!prior || prior.provider === 'jira', 'Context collection belongs to another provider.');
  const old = new Map((previous?.sources ?? []).filter(source => source.collection === collection).map(source => [source.id, source]));
  const scope = input.scope ?? prior?.scope ?? configuration.scope ?? {}, policy = input.policy ?? (input.scope?.issueKeys !== undefined ? {excludeTypes: [], excludeStates: []} : prior?.effectivePolicy ?? configuration.policy);
  const attachments = input.attachments ?? prior?.attachments ?? [], includeDiscussion = input.includeDiscussion ?? prior?.includeDiscussion ?? false, includeHistory = input.includeHistory ?? prior?.includeHistory ?? false;
  const selectedAttachments = attachments.map(entry => ({...entry, issueKey: entry.id.slice((collection + '-attachment-').length, -('-' + entry.attachmentId).length)}));
  const result = await createJiraContextSource(client).retrieve({scope, policy, previousMetadata: prior?.metadata, attachments: selectedAttachments, includeDiscussion, includeHistory});
  if (result.status !== 'READY') return {selectionRequired: {...result, sourceId: collection}};
  const decisions = new Map(result.selection.items.map(item => [item.id, item]));
  requireThat(selectedAttachments.every(entry => decisions.has(entry.issueKey)), 'Selected Jira attachment does not belong to the selected issue set.');
  const records = [], selected = new Set(), origin = project.siteUrl;
  for (const decision of result.unavailable) {
    const id = collection + '-item-' + decision.id; selected.add(id);
    records.push({...old.get(id), id, provider: 'jira', kind: 'work-item', selectedFor: 'business-context', collection, workItemId: decision.id, origin: origin + '/browse/' + decision.id, projectKey: projectKey(project), status: 'unverified', coverage: 'item-unavailable-or-changed', retrievedAt: now, contributions: old.get(id)?.contributions ?? []});
    for (const child of old.values()) if (child.parentId === id && attachments.some(entry => entry.id === child.id)) {selected.add(child.id); records.push({...child, status: 'unverified', coverage: 'parent-unavailable', retrievedAt: now});}
  }
  for (const {id: key, captured, relations} of result.items) {
    const id = collection + '-item-' + key; selected.add(id);
    const parts = captured.sections.flatMap(section => section.values.map(part => ({...part, location: section.sourceId === 'jira-story' ? part.location : section.sourceId + ':' + part.location})));
    const availableAttachments = captured.availableAttachments.map(value => ({id: collection + '-attachment-' + key + '-' + value.id, attachmentId: value.id, name: value.name}));
    const issueAttachments = selectedAttachments.filter(entry => entry.issueKey === key);
    requireThat(issueAttachments.every(entry => availableAttachments.some(value => value.id === entry.id) || prior?.attachments.some(value => value.id === entry.id)), 'Cannot verify the new Jira attachment selection within its issue.');
    const removedAttachments = issueAttachments.filter(entry => !availableAttachments.some(value => value.id === entry.id));
    const extracted = contextParts(parts, 'observation'), omissions = captured.omissions.filter(value => !removedAttachments.some(entry => value.sourceId === 'jira-attachment-' + entry.attachmentId && value.reason === 'unverified-selected-attachment'));
    const links = captured.links.map(link => ({...link, ...requirementDestination(link.destination)}));
    if (links.some(link => link.status === 'redacted')) omissions.push({sourceId: 'jira-story', reason: 'redacted-link'});
    const incomplete = extracted.redacted > 0 || omissions.some(value => !['absent', 'not-configured'].includes(value.reason));
    const version = fingerprint(captured.revisions), binding = {projectKey: projectKey(project), parentRevision: version};
    records.push({id, provider: 'jira', kind: 'work-item', selectedFor: 'business-context', collection, workItemId: key, origin: origin + '/browse/' + key, title: captured.sections.find(section => section.sourceId === 'jira-story' && section.values[0]?.location === 'summary')?.values[0].text.slice(0, 300) ?? key,
      projectKey: projectKey(project), version, updated: captured.metadata.updated, hash: fingerprint({revisions: captured.revisions, parts, links, omissions}), recipeVersion: RECIPE, availableAttachments, links, omissions, relations: relations ?? [], relationGaps: [], ...extracted,
      status: incomplete ? 'unverified' : 'verified', coverage: incomplete ? 'incomplete-selected-content' : 'complete', retrievedAt: now, revisionVerifiedAt: now, membershipVerifiedAt: now, ...(!incomplete ? {verifiedAt: now} : {})});
    for (const entry of issueAttachments) {
      selected.add(entry.id); const attachment = captured.attachments.find(value => value.id === entry.attachmentId);
      const source = {id: entry.id, provider: 'jira', kind: 'attachment', selectedFor: 'business-context', origin: origin + '/browse/' + key, parentId: id, collection, attachmentId: entry.attachmentId, name: attachment?.name ?? availableAttachments.find(value => value.attachmentId === entry.attachmentId)?.name ?? 'attachment', ...(entry.extraction ? {extraction: entry.extraction} : {})};
      const relationBinding = fingerprint({id, attachmentId: entry.attachmentId, name: source.name});
      if (removedAttachments.some(value => value.id === entry.id)) {records.push({...source, ...binding, relationBinding, status: 'out-of-scope', coverage: 'attachment-no-longer-linked', retrievedAt: now, contributions: []}); continue;}
      if (!attachment) {records.push({...source, ...binding, relationBinding, status: 'unverified', coverage: 'attachment-inaccessible', retrievedAt: now, contributions: old.get(entry.id)?.contributions ?? []}); continue;}
      const localPath = stageAttachment(roots, source, attachment.bytes, options);
      records.push({...await extractContextBytes(source, attachment.bytes, {...options, now, previous: old.get(entry.id)}), provider: 'jira', selectedFor: 'business-context', ...binding, relationBinding, attachmentId: entry.attachmentId, ...(localPath ? {localPath} : {})});
    }
  }
  for (const source of old.values()) if (!selected.has(source.id)) {
    const decision = decisions.get(source.workItemId ?? old.get(source.parentId)?.workItemId);
    records.push({...source, status: decision && !decision.included ? 'excluded' : 'out-of-scope', reason: decision?.reason ?? 'outside-current-source-scope', retrievedAt: now, contributions: []});
  }
  return {records, selection: {provider: 'jira', sourceId: collection, purpose: 'business-context', origin, project, scope: result.scope, includeDiscussion, includeHistory, attachments: attachments.map(({id, attachmentId}) => ({id, attachmentId})), effectivePolicy: result.policy, metadata: result.metadata, metadataVerifiedAt: now, metadataChanges: result.metadataChanges, ...result.selection}};
}
const withoutVerification = source => Object.fromEntries(Object.entries(source).filter(([key]) => !['retrievedAt', 'verifiedAt', 'revisionVerifiedAt', 'membershipVerifiedAt'].includes(key)));

/** Discover live selectors without loading evidence, selecting items, or saving a context. */
export async function readContextMetadata(roots, input, options = {}) {
  validateRequest(input); requireThat(Boolean(input.ado) !== Boolean(input.jira), 'Metadata discovery needs one explicit tracker context request.');
  const manifest = readManifest(roots, input.contextId);
  if (manifest) requireThat(fingerprint(manifest.identity) === fingerprint(input.identity) && fingerprint(manifest.scope) === fingerprint(input.scope), 'Captured context identity/scope differs; choose the matching context identifier.');
  const jira = Boolean(input.jira), {client, project} = await (jira ? bindJiraProject : bindProject)(roots, input, manifest, options);
  return {status: 'METADATA', saved: false, contextId: input.contextId, identity: input.identity, scope: input.scope, sourceId: (input.jira ?? input.ado).sourceId, [jira ? 'jiraProject' : 'adoProject']: project, metadata: await (jira ? createJiraContextSource : createAdoContextSource)(client).metadata()};
}

/** Live reads are explicit. Captured search/read never call this composition. */
export async function retrieveContext(roots, input, options = {}) {
  requireThat(input?.version === 1 && identifier(input.contextId), 'Invalid context request version/identifier.');
  const now = stamp(options.now ?? new Date().toISOString()), manifest = readManifest(roots, input.contextId), refreshAll = input.sources === undefined && input.ado === undefined && input.jira === undefined;
  input = {...input, identity: input.identity ?? manifest?.identity, scope: input.scope ?? manifest?.scope, sources: input.sources ?? (refreshAll ? savedSources(roots, manifest) : [])};
  validateRequest(input);
  if (manifest) requireThat(fingerprint(manifest.identity) === fingerprint(input.identity) && fingerprint(manifest.scope) === fingerprint(input.scope), 'Captured context identity/scope differs; choose the matching context identifier.');
  // Bind the configured project before loading evidence or querying metadata/content.
  const bound = await bindProject(roots, input, manifest, options), jiraBound = await bindJiraProject(roots, input, manifest, options), previous = loadSnapshot(roots, manifest); if (previous && !previous.facts) previous.facts = facts(previous.sources);
  if (options.persist && manifest?.version === 1) requireThat(fingerprint(facts(previous.sources)) === fingerprint(previous.facts), 'Legacy facts differ from their source evidence; preserve and repair the original snapshot before migration.');
  const originalBaseline = baseline(roots, manifest), original = new Map((previous?.sources ?? []).map(source => [source.id, source]));
  const existing = new Map([...original].map(([id, source]) => [id, businessSource(source) ? source : {...source, status: 'out-of-scope', reason: 'business-selection-required', contributions: []}])), checked = [], selections = structuredClone(previous?.selections ?? {});
  for (const source of input.sources) {
    const prior = existing.get(source.id); requireThat(!prior?.collection, 'A file source cannot replace a selected tracker source.');
    requireThat(source.status !== 'removed' || prior, 'Only a previously captured source can be explicitly removed.');
    requireThat(!prior || source.status === 'removed' || prior.kind === source.kind && prior.path === source.path && (!source.origin || prior.origin === source.origin), 'A source identifier cannot be reassigned to another origin.');
    const next = source.status === 'removed' ? {...prior, status: 'removed', reason: 'explicit-removal', retrievedAt: now, contributions: []} : await readFileContext(roots, source, {...options, now, previous: prior});
    existing.set(source.id, {...reconcile(prior, next), ...(source.status === 'removed' ? {} : {selectedFor: 'business-context', ...Object.fromEntries(['authority', 'encoding', 'delimiter'].filter(key => source[key] !== undefined).map(key => [key, source[key]]))})}); checked.push(source.id);
  }
  const remoteInputs = ['ado', 'jira'].flatMap(provider => (input[provider] ? [input[provider]] : refreshAll ? Object.entries(selections).filter(([, selection]) => selection.purpose === 'business-context' && (selection.provider ?? 'ado') === provider).map(([sourceId]) => ({sourceId})) : []).map(input => ({provider, input})));
  for (const {provider, input: remoteInput} of remoteInputs) {
    const remoteBound = provider === 'jira' ? jiraBound : bound;
    requireThat(!input.sources.some(source => source.id.startsWith(remoteInput.sourceId + '-')), 'File and tracker context identities overlap.');
    requireThat(!selections[remoteInput.sourceId] || (selections[remoteInput.sourceId].provider ?? 'ado') === provider, 'Context collection belongs to another provider.');
    let result;
    try {result = await (provider === 'jira' ? jiraRecords : adoRecords)(roots, remoteInput, previous, {...options, ...remoteBound, contextId: input.contextId}, now);} catch {
      requireThat(!options.persist || manifest?.version !== 1, 'Legacy ADO recapture failed; migration stopped without changing the snapshot.');
      const prior = previous?.selections?.[remoteInput.sourceId];
      requireThat(prior?.purpose === 'business-context', 'Cannot verify the initial business selection; no context was saved. Retry the explicit selection.');
      requireThat((remoteInput.scope === undefined || fingerprint(remoteInput.scope) === fingerprint(prior.scope)) && (remoteInput.policy === undefined || fingerprint(remoteInput.policy) === fingerprint(prior.effectivePolicy)) && (remoteInput.attachments === undefined || fingerprint(remoteInput.attachments) === fingerprint(prior.attachments ?? [])) && ['includeDiscussion', 'includeHistory'].every(name => remoteInput[name] === undefined || remoteInput[name] === prior[name]), 'Cannot verify the changed selection; previous context is preserved. Retry the explicit selection.');
      const old = [...existing.values()].filter(source => source.collection === remoteInput.sourceId && businessSource(source) && !inactive.has(source.status));
      result = {records: old.length ? old.map(source => ({...source, status: 'unverified', coverage: provider + '-unavailable', retrievedAt: now})) : [{id: remoteInput.sourceId + '-unavailable', selectedFor: 'business-context', collection: remoteInput.sourceId, kind: 'work-item', origin: 'configured-' + provider, projectKey: projectKey(remoteBound.project), status: 'unverified', coverage: provider + '-unavailable', retrievedAt: now, contributions: []}]};
    }
    if (result.selectionRequired) return {...result.selectionRequired, saved: false};
    if (result.selection) selections[remoteInput.sourceId] = result.selection;
    for (const next of result.records) {
      requireThat(!existing.has(next.id) || existing.get(next.id).collection === remoteInput.sourceId, 'Tracker context identity overlaps an unrelated file source.'); existing.set(next.id, reconcile(existing.get(next.id), next)); checked.push(next.id);
    }
  }
  const sources = [...existing.values()].filter(businessSource).sort((a, b) => a.id.localeCompare(b.id)), content = facts(sources);
  if (options.persist && manifest?.version === 1 && bound.project) requireThat(sources.filter(source => source.collection).every(source => source.projectKey === projectKey(bound.project) && (inactive.has(source.status) || source.status === 'verified' && source.recipeVersion === RECIPE)), 'Legacy ADO recapture is incomplete; migration stopped without changing the snapshot.');
  const gaps = sources.filter(source => !inactive.has(source.status) && (source.status !== 'verified' || source.relationGaps?.length)).map(source => ({sourceId: source.id, status: source.status, coverage: source.coverage, relationGaps: source.relationGaps?.length ?? 0}));
  if (!sources.length && !Object.values(selections).some(selection => selection.includedCount === 0)) gaps.push({status: 'unverified', coverage: 'no-selected-sources'});
  if (content.some(fact => fact.status === 'conflicting')) gaps.push({status: 'conflicting', coverage: 'conflicting-facts'});
  const snapshot = {version: 2, contextId: input.contextId, identity: structuredClone(input.identity), scope: structuredClone(input.scope), ...(bound.project ? {adoProject: bound.project} : {}), ...(jiraBound.project ? {jiraProject: jiraBound.project} : {}), capturedAt: previous?.capturedAt ?? now,
    updatedAt: checked.length || remoteInputs.length || !previous ? now : previous.updatedAt, status: gaps.length ? 'partial' : 'complete', sources, facts: content, selections,
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
      write(JSON.stringify({version: 2, contextId: id, identity: manifest.identity, scope: manifest.scope, ...(manifest.adoProject ? {adoProject: manifest.adoProject} : {}), ...(manifest.jiraProject ? {jiraProject: manifest.jiraProject} : {}), capturedAt: manifest.capturedAt, updatedAt: manifest.updatedAt, status: manifest.status, revision: manifest.revision, ...(custom === undefined ? {} : {custom}), ...(manifest.lastCompleteRevision === undefined ? {} : {lastCompleteRevision: manifest.lastCompleteRevision})}).slice(0, -1));
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
  requireThat(identifier(name), 'Invalid configured tracker context source.'); validateContextPolicy(input);
  const modern = readConsumerJson(roots, '.harness/integrations.json');
  const client = createTrackerClient(roots, options), provider = trackerProvider(client);
  requireThat(modern.version === 1 && modern[provider], 'Configure the selected tracker before saving context selection.');
  const metadata = await (provider === 'jira' ? createJiraContextSource : createAdoContextSource)(client).metadata();
  const {policy, repairs} = resolveContextPolicy(input, metadata);
  if (repairs.length) return {status: 'POLICY_REPAIR_REQUIRED', repairs, metadata, saved: false};
  const before = fingerprint(modern); modern[provider].context ??= {sources: {}}; modern[provider].context.sources[name] ??= {}; modern[provider].context.sources[name].policy = policy;
  (provider === 'jira' ? validateJiraConfiguration : validateAdoConfiguration)(modern[provider]);
  requireThat(fingerprint(readConsumerJson(roots, '.harness/integrations.json')) === before, 'Integration configuration changed during selection; save again.');
  writeJson(consumerPath(roots, '.harness/integrations.json'), modern);
  return {status: 'SAVED', policy, metadata, saved: true, path: '.harness/integrations.json'};
}
