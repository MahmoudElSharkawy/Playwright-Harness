import {contextParts, readFileContext, extractContextBytes} from '../context/files.mjs';
import {contextData} from '../context/model.mjs';
import {fingerprint, digest, requireThat, keys} from '../execution-core/data.mjs';
import {createAdoClient} from '../integrations/ado-client.mjs';
import {loadAdoConfiguration, adoId, adoGuid} from '../integrations/config.mjs';
import {decodeEntities} from '../integrations/ado-steps.mjs';

export const consumerIdentity = (roots, project, application) => fingerprint({root: roots.projectRoot, project, application});
export function requirementsClient(roots, options = {}) {
  return options.client ?? createAdoClient({...loadAdoConfiguration(roots, {}, options.environment), roots, fetchImpl: options.fetchImpl});
}

/** Strip real markup first; decode each entity alone so nested references stay literal. */
function ordinaryHtmlText(html) {
  const text = html.replace(/<!--[\s\S]*?-->|<(\/?)([A-Za-z][A-Za-z0-9:-]*)(?:[^"'<>]|"[^"]*"|'[^']*')*>/g, (_, closing, tag) => {
    if (!tag) return '';
    tag = tag.toLowerCase();
    if (tag === 'br' || closing && /^(p|div|li|tr|h[1-6])$/.test(tag)) return '\n';
    return !closing && tag === 'li' ? '- ' : '';
  }).replace(/&(?:#[xX][\da-fA-F]+|#\d+|[A-Za-z]+);/g, entity => decodeEntities(entity.replace(/^&#X/, '&#x')));
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
}

/** Comments have their own response-body pagination, unlike ADO value lists. */
export async function readStoryComments(client, storyId) {
  const comments = [], seen = new Set(); let continuation;
  for (let page = 0; page < 100; page++) {
    const query = new URLSearchParams({'api-version': '7.1-preview.4', includeDeleted: 'true', '$top': '200', order: 'asc'});
    if (continuation) query.set('continuationToken', continuation);
    const result = await client.read(`wit/workitems/${adoId(storyId)}/comments?${query}`);
    requireThat(Array.isArray(result.comments) && result.comments.length <= 200, 'Incomplete story discussion response.');
    for (const comment of result.comments) {
      const id = adoId(comment.id ?? comment.commentId);
      requireThat(!comments.some(value => value.id === id) && Number.isSafeInteger(comment.version) && comment.version > 0 && typeof comment.text === 'string', 'Incomplete or duplicate discussion identity.');
      comments.push({id, version: comment.version, text: comment.text, deleted: comment.isDeleted === true});
    }
    requireThat(comments.length <= 10000, 'Discussion exceeds bounded scope.');
    continuation = result.continuationToken;
    if (!continuation) {requireThat(result.totalCount === undefined || Number.isSafeInteger(result.totalCount) && comments.length >= result.totalCount, 'Discussion pagination is incomplete.'); return comments;}
    requireThat(typeof continuation === 'string' && continuation.length <= 2048 && !seen.has(continuation), 'Discussion pagination did not advance.'); seen.add(continuation);
  }
  throw new Error('Discussion exceeds 100 pages.');
}

export async function captureRequirements(roots, raw, options = {}) {
  const request = contextData(raw);
  keys(request, ['version', 'project', 'application', 'storyId', 'sources', 'attachments'], 'requirements request');
  requireThat(request.version === 1 && ['project', 'application'].every(key => typeof request[key] === 'string' && request[key].trim() && request[key].length <= 200), 'Requirements need project and application identity.');
  requireThat(Array.isArray(request.sources) && request.sources.length <= 100 && new Set(request.sources.map(source => source.id)).size === request.sources.length, 'Select distinct supplied sources.');
  if (request.attachments !== undefined) requireThat(request.storyId !== undefined && Array.isArray(request.attachments) && request.attachments.length <= 100 && new Set(request.attachments.map(item => item.attachmentId?.toLowerCase())).size === request.attachments.length && request.attachments.every(item => adoGuid(item.attachmentId) && item.extraction && typeof item.extraction === 'object'), 'Attachment reader receipts need distinct ADO attachment identities.');
  const parts = [], omissions = [], revisions = [], sourceKeys = new Set();
  function add(sourceId, revision, values, kind = 'requirement') {
    const safe = contextParts(values);
    if (safe.redacted) omissions.push({sourceId, reason: 'sensitive-content-omitted', count: safe.redacted});
    for (const part of safe.contributions) {
      const key = fingerprint({sourceId, location: part.location});
      requireThat(!sourceKeys.has(key), 'Duplicate source location.'); sourceKeys.add(key);
      parts.push({id: key, sourceId, revision, location: part.location, kind, text: part.text});
    }
  }
  let origin;
  if (request.storyId !== undefined) {
    const client = requirementsClient(roots, options), storyId = adoId(request.storyId), project = await client.projectIdentity();
    const item = await client.read(`wit/workitems/${storyId}?$expand=relations&api-version=7.1`);
    requireThat(adoId(item.id) === storyId && Number.isSafeInteger(item.rev) && item.rev > 0 && item.fields, 'Story identity/revision is incomplete.');
    await client.requireWorkItemProject(item);
    origin = {organizationUrl: client.configuration.organizationUrl, projectId: project.id, project: project.name, storyId};
    for (const [field, kind] of [['System.Title', 'context'], ['System.Description', 'requirement'], ['Microsoft.VSTS.Common.AcceptanceCriteria', 'criterion']]) {
      const value = item.fields[field];
      if (typeof value === 'string' && value.trim()) add('story', String(item.rev), [{location: field, text: field === 'System.Title' ? value : ordinaryHtmlText(value)}], kind);
      else omissions.push({sourceId: 'story', location: field, reason: 'absent'});
    }
    revisions.push({id: 'story', revision: String(item.rev), content: fingerprint(item.fields)});
    try {
      const comments = await readStoryComments(client, storyId);
      revisions.push({id: 'discussion', revision: fingerprint(comments)});
      for (const comment of comments) if (!comment.deleted) add('discussion', String(comment.version), [{location: `comment:${comment.id}`, text: ordinaryHtmlText(comment.text)}], 'discussion');
    } catch {omissions.push({sourceId: 'discussion', reason: 'inaccessible-or-incomplete'});}
    requireThat(item.relations === undefined || Array.isArray(item.relations), 'Story attachments are incomplete.');
    for (const [index, relation] of (item.relations ?? []).entries()) if (relation.rel === 'AttachedFile') {
      let sourceId = 'attachment-' + index; const name = relation.attributes?.name ?? 'attachment';
      let url; try {url = new URL(relation.url);} catch {}
      const scopes = ['', ...[project.id, project.name].map(value => '/' + encodeURIComponent(value))];
      const prefix = scopes.map(scope => client.configuration.organizationUrl + scope + '/_apis/wit/attachments/').find(value => url?.href.toLowerCase().startsWith(value.toLowerCase()));
      const attachmentId = prefix && url.pathname.slice(new URL(prefix).pathname.length);
      if (!prefix || !adoGuid(attachmentId) || url.username || url.password) {omissions.push({sourceId, reason: 'unverified-attachment-destination'}); continue;}
      sourceId = 'ado-attachment-' + attachmentId.toLowerCase();
      try {
        const bytes = await client.attachment(attachmentId);
        revisions.push({id: sourceId, revision: digest(bytes), name});
        const receipt = request.attachments?.find(item => item.attachmentId.toLowerCase() === attachmentId.toLowerCase());
        const extracted = await extractContextBytes({id: sourceId, kind: 'attachment', name, ...(receipt ? {extraction: receipt.extraction} : {})}, bytes, options);
        add(sourceId, extracted.hash, extracted.contributions.map(({location, text}) => ({location, text})));
        if (extracted.coverage !== 'complete' || extracted.redacted) omissions.push({sourceId, reason: extracted.coverage, redacted: extracted.redacted ?? 0});
      } catch {omissions.push({sourceId, reason: 'inaccessible-attachment'});}
    }
  }
  for (const source of request.sources) {
    keys(source, ['id', 'kind', 'path', 'encoding', 'delimiter', 'extraction'], 'requirements source');
    requireThat(typeof source.id === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(source.id) && !source.id.startsWith('ado-') && !['story', 'discussion'].includes(source.id) || source.id === 'story' && request.storyId === undefined, 'Invalid or reserved requirements source ID.');
    // Supplied paths are explicit inputs; reuse the existing bounded, sanitizing readers.
    const record = await readFileContext(roots, source, options), revision = record.hash ?? 'unavailable';
    revisions.push({id: source.id, revision});
    add(source.id, revision, record.contributions.map(({location, text}) => ({location, text})));
    if (record.coverage !== 'complete' || record.redacted) omissions.push({sourceId: source.id, reason: record.coverage, redacted: record.redacted ?? 0});
  }
  requireThat(parts.length > 0, 'No sanitized requirements are available; prepared/prior state is unchanged.');
  const snapshot = contextData({version: 1, consumer: consumerIdentity(roots, request.project, request.application), request, parts, omissions, revisions, ...(origin ? {origin} : {})});
  return {...snapshot, fingerprint: fingerprint(snapshot)};
}
