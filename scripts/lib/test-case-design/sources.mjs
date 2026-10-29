import {captureRequirements, prepareRequirements, readRequirements, readRequirementsSource} from '../requirements/index.mjs';
import {requirementsClient} from '../requirements/sources.mjs';
import {adoId, workItemLinkId} from '../integrations/config.mjs';
import {adoTestCaseType} from '../integrations/ado-source.mjs';
import {readContextOverview, searchContext} from '../context/search.mjs';
import {contextData} from '../context/model.mjs';
import {keys, fingerprint, requireThat} from '../execution-core/data.mjs';
import {confirmedOutcomes} from './review.mjs';
import {captureReferences, requireFreshReferences} from './references.mjs';
import {captureConventions} from './conventions.mjs';
import {designClient, designTestManagement, createDesignTarget, operationRequestFingerprint} from './provider.mjs';
import {loadLocalSource} from '../local-source.mjs';
import {jiraStoryRevision} from '../integrations/jira-requirements.mjs';
import {consumerPath} from '../consumer-paths.mjs';
import {readBounded} from '../execute/storage.mjs';

export async function captureDesign(roots, raw, options = {}) {
  const input = contextData(raw); keys(input, ['version', 'analysisId', 'request', 'caseIds', 'localCaseSource', 'context', 'references', 'referenceIds'], 'design source selection');
  requireThat(input.version === 1 && typeof input.analysisId === 'string', 'Select one requirements analysis.');
  let requirements;
  if (input.request) {
    const request = {...input.request, ...(input.request.storyId === undefined ? {} : {attachmentIds: input.request.attachmentIds ?? [], includeHistory: true})};
    requirements = prepareRequirements(roots, input.analysisId, await captureRequirements(roots, request, options));
  } else requirements = readRequirements(roots, input.analysisId);
  requireThat(requirements, 'Prepare selected story/local requirements before design.');
  const source = readRequirementsSource(roots, requirements);
  requireThat(!source.parts.some(part => part.sourceId.startsWith('ado-attachment-')) || Array.isArray(source.request.attachmentIds), 'Reselect captured attachments explicitly before using an older broad capture.');
  const existing = [], related = []; let story, localCases;
  requireThat(input.caseIds === undefined || Array.isArray(input.caseIds) && input.caseIds.length <= 500 && new Set(input.caseIds.map(String)).size === input.caseIds.length, 'Select distinct bounded existing case identities.');
  if (source.origin?.provider === 'jira') {
    const client = designClient(roots, source.origin, options), project = await client.projectIdentity(), management = await designTestManagement(roots, client, source.origin, options);
    requireThat(String(project.id) === source.origin.projectId, 'Design source and configured Jira project differ.');
    story = await client.issue(source.origin.storyId);
    requireThat(jiraStoryRevision(client, story, {attachmentIds: source.request.attachmentIds ?? []}).revision === source.revisions.find(row => row.id === 'jira-story')?.revision, 'Jira story content changed; refresh accepted source first.');
    if (management) {
      requireThat(input.localCaseSource === undefined, 'Select local case sources only for local or Jira without test management.');
      const cases = new Map((await management.storyCases(story.key)).map(item => [item.id, item]));
      for (const id of input.caseIds ?? []) if (!cases.has(id)) cases.set(id, await management.readCase(id));
      requireThat(cases.size <= 500, 'Design selection exceeds 500 linked or selected cases.');
      for (const item of cases.values()) existing.push(contextData(item, 2 * 1024 * 1024));
    } else requireThat(input.localCaseSource !== undefined || !input.caseIds?.length, 'Jira without test management needs an explicit local case source for existing cases.');
  } else if (source.origin) {
    requireThat(input.localCaseSource === undefined, 'ADO native design does not accept local case identities.');
    const client = designClient(roots, source.origin, options), project = await client.projectIdentity();
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
  } else requireThat(input.localCaseSource !== undefined || !input.caseIds?.length, 'Local requirements cannot imply native case identities.');
  if (input.localCaseSource !== undefined) {
    requireThat(typeof input.localCaseSource === 'string', 'Select a local case source path.');
    const selected = loadLocalSource(roots, input.localCaseSource); localCases = selected.source;
    requireThat((input.caseIds ?? []).every(id => selected.scenarios.some(row => row.id === id)), 'Selected local case is absent from its source.');
    for (const row of selected.scenarios.filter(row => !input.caseIds?.length || input.caseIds.includes(row.id))) {
      const revision = fingerprint(row);
      existing.push({provider: 'local', id: row.id, revision, fingerprint: revision, title: row.title, steps: row.steps.map(step => ({action: step.action, expected: step.expected.join('\n'), data: ''})), externalReferences: row.externalReferences ?? []});
    }
  }
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
  const references = await captureReferences(roots, source, requirements, story, input, options);
  // Keep the selected sanitized source fields; arbitrary raw markup can hide credentials in hrefs.
  const retainedStory = story && (source.origin.provider === 'jira' ? {id: story.id, key: story.key, updated: story.fields.updated, revision: source.revisions.find(row => row.id === 'jira-story').revision, fields: Object.fromEntries(source.parts.filter(part => part.sourceId === 'jira-story').map(part => [part.location, part.text]))} : {id: story.id, rev: story.rev, fields: Object.fromEntries(source.parts.filter(part => part.sourceId === 'story').map(part => [part.location, part.text]))});
  return {request: input, requirements: source, inventory: requirements, existing, related, ...(retainedStory ? {story: retainedStory} : {}), ...(localCases ? {localCases} : {}), context, references, conventions: captureConventions(roots, requirements), reviewContract: 'retained-run-v1'};
}

export async function requireFreshDesign(roots, state, options = {}) {
  const requirements = readRequirements(roots, state.analysisId);
  requireThat(requirements?.head === state.requirements.head, 'Requirement acceptance or source changed; revalidate and renew approval.');
  const before = state.evidence.requirements, request = {...before.request, ...(before.origin ? {attachmentIds: before.request.attachmentIds ?? []} : {})};
  const selectedOptions = {...options, ...(before.origin ? {provider: before.origin.provider ?? 'ado'} : {})};
  let current = await captureRequirements(roots, request, selectedOptions);
  const signature = value => fingerprint({consumer: value.consumer, parts: value.parts, revisions: value.revisions, omissions: value.omissions.filter(row => row.reason !== 'not-selected'), origin: value.origin ?? null, ...(before.linksVersion === 1 ? {linksVersion: value.linksVersion, links: value.links} : {})});
  if (signature(current) !== signature(before) && before.origin && before.origin.provider !== 'jira' && confirmedOutcomes(state).some(row => row.caseId.startsWith('NEW-') && row.status === 'applied')) current = await accountForCreatedLinks(roots, state, current, selectedOptions);
  const unchanged = signature(current) === signature(before);
  const ownedLinks = !unchanged && before.origin?.provider === 'jira' && await accountForJiraLinks(roots, state, current, options);
  requireThat(unchanged || ownedLinks, 'Story, comments, history, selected attachment or local source changed; refresh and renew approval.');
  if (ownedLinks) state.sourceVerification = ownedLinks;
  requireThat(!current.omissions.some(row => /inaccessible|incomplete|sensitive|unverified/.test(row.reason)), 'Unavailable or incomplete source evidence blocks publication.');
  if (state.evidence.localCases) requireThat(loadLocalSource(roots, state.evidence.localCases.path).source.sha256 === state.evidence.localCases.sha256, 'Local case source changed; refresh and renew approval.');
  if (state.evidence.context && !state.evidence.context.unavailable) {
    const {id, ...query} = state.evidence.context.selection;
    const now = searchContext(roots, id, {...query, limit: 10, maxBytes: 24000});
    requireThat(fingerprint(now) === fingerprint(state.evidence.context.result), 'Selected captured business context changed; revalidate and renew approval.');
  }
  await requireFreshReferences(roots, state, options);
  if (state.evidence.conventions) requireThat(fingerprint(captureConventions(roots, requirements)) === fingerprint(state.evidence.conventions), 'Design conventions changed; revalidate affected defaults and renew approval.');
  return requirements;
}

async function accountForJiraLinks(roots, state, current, options) {
  const before = state.evidence.requirements, oldStory = before.revisions.find(row => row.id === 'jira-story'), newStory = current.revisions.find(row => row.id === 'jira-story');
  if (!oldStory || !newStory || oldStory.content !== newStory.content || !Array.isArray(oldStory.links) || !Array.isArray(newStory.links)) return false;
  const owned = confirmedOutcomes(state).filter(row => row.status === 'applied' && row.externalId);
  if (!owned.length || !oldStory.links.every(link => newStory.links.some(now => fingerprint(now) === fingerprint(link)))) return false;
  const target = await createDesignTarget(roots, before.origin, options), verified = [];
  for (const outcome of owned) {
    const plan = readBounded(consumerPath(roots, `.harness/state/test-case-design/${state.id}/previews/${outcome.approval}.json`)), {fingerprint: approval, ...content} = plan;
    requireThat(approval === outcome.approval && fingerprint(content) === approval && plan.source === state.source && plan.proposal === state.proposal, 'Owned link approval binding changed.');
    const operation = plan.operations.find(row => row.identity === outcome.operationId && row.caseId === outcome.caseId);
    requireThat(operation?.nativePlan && operationRequestFingerprint(operation) === outcome.requestFingerprint, 'Owned link operation differs from its approval.');
    const item = await target.verify(operation, outcome.externalId, {historical: true}); verified.push({id: item.nativeId, key: item.id, type: operation.nativePlan.linkType});
  }
  const added = newStory.links.filter(link => !oldStory.links.some(old => old.id === link.id));
  if (!added.length || !added.every(link => link.direction === 'inward' && verified.some(item => item.id === link.issue.id && item.key === link.issue.key && item.type === link.type))) return false;
  const oldHistory = before.revisions.find(row => row.id === 'jira-history'), newHistory = current.revisions.find(row => row.id === 'jira-history');
  let addedHistory = [];
  if (oldHistory || newHistory) {
    if (!oldHistory?.entries || !newHistory?.entries || !oldHistory.entries.every(entry => newHistory.entries.some(now => fingerprint(now) === fingerprint(entry)))) return false;
    addedHistory = newHistory.entries.filter(entry => !oldHistory.entries.some(old => old.id === entry.id));
    if (!addedHistory.every(entry => entry.addedLinks?.length && entry.addedLinks.every(link => added.some(item => item.issue.id === link.id && item.issue.key === link.key)))) return false;
  }
  const comparable = (snapshot, newer) => {
    const parts = snapshot.parts.filter(part => !newer || part.sourceId !== 'jira-history' || !addedHistory.some(entry => part.location.startsWith(`change:${entry.id}:`))).map(part => {if (part.sourceId !== 'jira-story') return part; const {revision, ...rest} = part; return rest;});
    const links = snapshot.links.map(link => {if (link.sourceId !== 'jira-story') return link; const {revision, ...rest} = link; return rest;});
    return {consumer: snapshot.consumer, origin: snapshot.origin, parts, links, omissions: snapshot.omissions, revisions: snapshot.revisions.filter(row => !['jira-story', 'jira-history'].includes(row.id))};
  };
  if (fingerprint(comparable(before, false)) !== fingerprint(comparable(current, true))) return false;
  return {snapshot: current.fingerprint, story: newStory, ...(newHistory ? {history: newHistory} : {}), verifiedCaseIds: verified.map(item => item.key)};
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
  if (normalized.links) normalized.links = normalized.links.map(link => link.sourceId === 'story' ? {...link, revision: String(baseline)} : link);
  for (const row of normalized.revisions) if (['story', 'history'].includes(row.id)) Object.assign(row, before.revisions.find(item => item.id === row.id));
  return normalized;
}
