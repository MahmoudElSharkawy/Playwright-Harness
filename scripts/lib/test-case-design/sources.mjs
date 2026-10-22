import {captureRequirements, prepareRequirements, readRequirements, readRequirementsSource} from '../requirements/index.mjs';
import {requirementsClient} from '../requirements/sources.mjs';
import {adoId, workItemLinkId} from '../integrations/config.mjs';
import {adoTestCaseType} from '../integrations/ado-source.mjs';
import {readContextOverview, searchContext} from '../context/search.mjs';
import {contextData} from '../context/model.mjs';
import {keys, fingerprint, requireThat} from '../execution-core/data.mjs';
import {confirmedOutcomes} from './review.mjs';

export async function captureDesign(roots, raw, options = {}) {
  const input = contextData(raw); keys(input, ['version', 'analysisId', 'request', 'caseIds', 'context'], 'design source selection');
  requireThat(input.version === 1 && typeof input.analysisId === 'string', 'Select one requirements analysis.');
  let requirements;
  if (input.request) {
    const request = {...input.request, ...(input.request.storyId === undefined ? {} : {attachmentIds: input.request.attachmentIds ?? [], includeHistory: true})};
    requirements = prepareRequirements(roots, input.analysisId, await captureRequirements(roots, request, options));
  } else requirements = readRequirements(roots, input.analysisId);
  requireThat(requirements, 'Prepare selected story/local requirements before design.');
  const source = readRequirementsSource(roots, requirements);
  requireThat(!source.parts.some(part => part.sourceId.startsWith('ado-attachment-')) || Array.isArray(source.request.attachmentIds), 'Reselect captured attachments explicitly before using an older broad capture.');
  const existing = [], related = []; let story;
  if (source.origin) {
    const client = requirementsClient(roots, options), project = await client.projectIdentity();
    requireThat(source.origin.organizationUrl === client.configuration.organizationUrl && source.origin.projectId.toLowerCase() === project.id.toLowerCase(), 'Design source and configured ADO destination differ.');
    story = await client.read(`wit/workitems/${source.origin.storyId}?$expand=relations&api-version=7.1`); await client.requireWorkItemProject(story);
    requireThat(adoId(story.id) === source.origin.storyId && story.rev === Number(source.revisions.find(row => row.id === 'story')?.revision), 'Story revision changed; refresh accepted source first.');
    const isCase = await adoTestCaseType(client), ids = new Set((input.caseIds ?? []).map(adoId));
    requireThat(!isCase(story.fields['System.WorkItemType']) && Array.isArray(story.relations ?? []), 'Select a story with valid relations.');
    for (const relation of story.relations ?? []) {
      const id = workItemLinkId(relation.url, client.configuration.organizationUrl, project);
      if (relation.rel === 'Microsoft.VSTS.Common.TestedBy-Forward') {requireThat(id, 'Unverified linked-case destination.'); ids.add(id);}
      else if (id) related.push({id, relation: relation.rel});
    }
    requireThat(ids.size <= 500, 'Design selection exceeds 500 linked or selected cases.');
    for (const id of ids) {
      const item = await client.read(`wit/workitems/${id}?$expand=relations&api-version=7.1`); await client.requireWorkItemProject(item);
      requireThat(adoId(item.id) === id && isCase(item.fields['System.WorkItemType']) && Number.isInteger(item.rev) && item.rev > 0, 'Existing case identity/type/revision is incomplete.');
      existing.push(contextData(item, 2 * 1024 * 1024));
    }
  } else requireThat(!input.caseIds?.length, 'Local requirements cannot imply ADO case identities.');
  let context = null;
  if (input.context !== undefined) {
    keys(input.context, ['id', 'query', 'sourceId', 'workItemId'], 'selected captured business context');
    requireThat(typeof input.context.id === 'string' && typeof input.context.query === 'string' && input.context.query.trim(), 'Select a context ID and narrow business query.');
    try {
      const overview = readContextOverview(roots, input.context.id);
      requireThat(overview.identity?.project === requirements.project && overview.scope?.application === requirements.application, 'Captured context belongs to another project/application.');
      const {id, ...query} = input.context;
      context = {selection: input.context, overview, result: searchContext(roots, id, {...query, limit: 10, maxBytes: 24000})};
    } catch (error) {context = {selection: input.context, unavailable: true, reason: error.message};}
  }
  return {request: input, requirements: source, inventory: requirements, existing, related, ...(story ? {story} : {}), context};
}

export async function requireFreshDesign(roots, state, options = {}) {
  const requirements = readRequirements(roots, state.analysisId);
  requireThat(requirements?.head === state.requirements.head, 'Requirement acceptance or source changed; revalidate and renew approval.');
  const before = state.evidence.requirements, request = {...before.request, ...(before.origin ? {attachmentIds: before.request.attachmentIds ?? []} : {})};
  let current = await captureRequirements(roots, request, options);
  const signature = value => fingerprint({consumer: value.consumer, parts: value.parts, revisions: value.revisions, omissions: value.omissions.filter(row => row.reason !== 'not-selected'), origin: value.origin ?? null});
  if (signature(current) !== signature(before) && before.origin && confirmedOutcomes(state).some(row => row.caseId.startsWith('NEW-') && row.status === 'applied')) current = await accountForCreatedLinks(roots, state, current, options);
  requireThat(signature(current) === signature(before), 'Story, comments, history, selected attachment or local source changed; refresh and renew approval.');
  requireThat(!current.omissions.some(row => /inaccessible|incomplete|sensitive|unverified/.test(row.reason)), 'Unavailable or incomplete source evidence blocks publication.');
  if (state.evidence.context && !state.evidence.context.unavailable) {
    const {id, ...query} = state.evidence.context.selection;
    const now = searchContext(roots, id, {...query, limit: 10, maxBytes: 24000});
    requireThat(fingerprint(now) === fingerprint(state.evidence.context.result), 'Selected captured business context changed; revalidate and renew approval.');
  }
  return requirements;
}

async function accountForCreatedLinks(roots, state, current, options) {
  const before = state.evidence.requirements, storyId = before.origin.storyId, baseline = Number(before.revisions.find(row => row.id === 'story').revision);
  const now = Number(current.revisions.find(row => row.id === 'story').revision), owned = new Set(confirmedOutcomes(state).filter(row => row.caseId.startsWith('NEW-') && row.status === 'applied').map(row => row.adoId));
  requireThat(now > baseline && now - baseline <= owned.size, 'Relevant source revision changed outside confirmed creation links.');
  const client = requirementsClient(roots, options), project = await client.projectIdentity(), updates = [];
  for (let skip = 0; ; skip += 100) {
    const response = await client.read(`wit/workitems/${storyId}/updates?$top=100&$skip=${skip}&api-version=7.1`);
    requireThat(Array.isArray(response.value) && response.value.length <= 100 && updates.length + response.value.length <= 1000, 'Story update history is incomplete or exceeds recovery bound.');
    updates.push(...response.value); if (response.value.length < 100) break;
  }
  const changes = updates.filter(update => update.rev > baseline && update.rev <= now), seen = new Set();
  requireThat(changes.length === now - baseline && new Set(changes.map(update => update.rev)).size === changes.length, 'Story update history does not prove every intervening revision.');
  const automatic = new Set(['System.Rev', 'System.ChangedDate', 'System.ChangedBy', 'System.AuthorizedDate', 'System.RevisedDate', 'System.Watermark']);
  for (const update of changes) {
    requireThat(update.workItemId === storyId && Object.keys(update.fields ?? {}).every(field => automatic.has(field)) && update.relations?.added?.length && !(update.relations.removed?.length || update.relations.updated?.length), 'Story changed beyond the approved atomic case link.');
    for (const relation of update.relations.added) {
      const id = workItemLinkId(relation.url, client.configuration.organizationUrl, project);
      requireThat(relation.rel === 'Microsoft.VSTS.Common.TestedBy-Forward' && owned.has(id) && !seen.has(id), 'Story link does not belong to one confirmed creation.'); seen.add(id);
    }
  }
  // Only proven relation-only revisions can be normalized; business text, comments,
  // selected attachments and prior history still compare byte-for-byte below.
  const normalized = structuredClone(current);
  normalized.parts = normalized.parts.filter(part => part.sourceId !== 'history' || Number(part.revision) <= baseline).map(part => part.sourceId === 'story' ? {...part, revision: String(baseline)} : part);
  for (const row of normalized.revisions) if (['story', 'history'].includes(row.id)) Object.assign(row, before.revisions.find(item => item.id === row.id));
  return normalized;
}
