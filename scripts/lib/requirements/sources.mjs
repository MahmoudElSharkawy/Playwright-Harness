import {contextParts, readFileContext, extractContextBytes} from '../context/files.mjs';
import {contextData} from '../context/model.mjs';
import {fingerprint, digest, requireThat, keys} from '../execution-core/data.mjs';
import {createAdoClient} from '../integrations/ado-client.mjs';
import {loadAdoConfiguration, adoId, adoGuid} from '../integrations/config.mjs';
import {decodeEntities} from '../integrations/ado-steps.mjs';
import {credentialName, secretFindings} from '../package-validation.mjs';

export const consumerIdentity = (roots, project, application) => fingerprint({root: roots.projectRoot, project, application});
export function requirementsClient(roots, options = {}) {
  return options.client ?? createAdoClient({...loadAdoConfiguration(roots, {}, options.environment), roots, fetchImpl: options.fetchImpl});
}

/** Strip real markup first; decode each entity alone so nested references stay literal. */
export function ordinaryHtmlText(html) {return normalizedHtml(html).text;}

function normalizedHtml(html, located = false) {
  let text = html, positions = located ? Array.from({length: html.length}, (_, index) => index) : null;
  function replace(pattern, replacement) {
    if (!located) {text = text.replace(pattern, replacement); return;}
    let result = '', previous = 0; const next = [];
    function copy(start, end) {result += text.slice(start, end); for (let index = start; index < end; index++) next.push(positions[index]);}
    for (const match of text.matchAll(pattern)) {
      copy(previous, match.index);
      const value = typeof replacement === 'function' ? replacement(...match) : replacement;
      if (value === match[0]) copy(match.index, match.index + match[0].length);
      else {result += value; for (let index = 0; index < value.length; index++) next.push(positions[match.index]);}
      previous = match.index + match[0].length;
    }
    copy(previous, text.length); text = result; positions = next;
  }
  replace(/<!--[\s\S]*?-->|<(\/?)([A-Za-z][A-Za-z0-9:-]*)(?:[^"'<>]|"[^"]*"|'[^']*')*>/g, (_, closing, tag) => {
    if (!tag) return '';
    tag = tag.toLowerCase();
    if (tag === 'br' || closing && /^(p|div|li|tr|h[1-6])$/.test(tag)) return '\n';
    return !closing && tag === 'li' ? '- ' : '';
  });
  replace(/&(?:#[xX][\da-fA-F]+|#\d+|[A-Za-z]+);/g, entity => decodeEntities(entity.replace(/^&#X/, '&#x')));
  replace(/[ \t]+\n/g, '\n'); replace(/\n{3,}/g, '\n\n'); replace(/[ \t]{2,}/g, ' '); replace(/^\s+|\s+$/g, '');
  replace(/https?:\/\/[^\s<>"']+/gi, value => requirementDestination(value).status === 'redacted' ? '[REDACTED LINK]' : value);
  return {text, positions};
}

const redactRequirementLinks = text => text.replace(/https?:\/\/[^\s<>"']+/gi, value => requirementDestination(value).status === 'redacted' ? '[REDACTED LINK]' : value);

/** Destinations are provenance, not routes. Never retain credentials hidden in links. */
export function requirementDestination(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048 || /[\x00-\x20\\]/.test(value)) return {destination: '[invalid destination]', status: 'malformed'};
  if (secretFindings('reference.txt', value).length) return {destination: '[REDACTED]', status: 'redacted'};
  let url;
  try {url = new URL(value);} catch {return {destination: value, status: 'malformed'};}
  if (url.username || url.password || [...url.searchParams.keys()].some(credentialName) || secretFindings('reference.txt', value).length) return {destination: '[REDACTED]', status: 'redacted'};
  return {destination: value, status: url.protocol === 'https:' ? 'candidate' : 'unsupported'};
}

/** Inspect real anchors before decoding: encoded markup remains ordinary literal text. */
export function requirementLinks(html, sourceId, revision, location) {
  const links = [], {positions} = normalizedHtml(html, true), tags = /<!--[\s\S]*?-->|<(\/?)([A-Za-z][A-Za-z0-9:-]*)(?:[^"'<>]|"[^"]*"|'[^']*')*>/g;
  let anchor;
  for (const match of html.matchAll(tags)) {
    if (match[2]?.toLowerCase() !== 'a') continue;
    if (!match[1]) {
      if (anchor) save(anchor, match.index, false);
      anchor = {start: match.index, body: match.index + match[0].length, tag: match[0]};
    } else if (anchor) {save(anchor, match.index, true); anchor = undefined;}
    requireThat(links.length <= 1000, 'Source hyperlinks exceed bounded scope.');
  }
  if (anchor) save(anchor, html.length, false);
  function save(value, end, closed) {
    const attributes = value.tag.replace(/^<a\b/i, '').slice(0, -1), hrefs = []; let cursor = 0, valid = true;
    for (const match of attributes.matchAll(/([^\s="'<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
      if (attributes.slice(cursor, match.index).trim()) valid = false;
      if (match[1].toLowerCase() === 'href') hrefs.push(match[2] ?? match[3] ?? match[4]);
      cursor = match.index + match[0].length;
    }
    if (attributes.slice(cursor).trim().replace(/\/$/, '')) valid = false;
    const destination = typeof hrefs[0] === 'string' ? hrefs[0].replace(/&(?:#[xX][\da-fA-F]+|#\d+|[A-Za-z]+);/g, entity => decodeEntities(entity.replace(/^&#X/, '&#x'))) : '';
    const visible = ordinaryHtmlText(html.slice(value.body, end));
    const boundary = raw => {let low = 0, high = positions.length; while (low < high) {const middle = (low + high) >>> 1; if (positions[middle] < raw) low = middle + 1; else high = middle;} return low;};
    const textStart = boundary(value.body), textEnd = boundary(end);
    const safeText = contextParts(visible ? [{location, text: visible}] : []).contributions[0]?.text ?? '';
    const safe = requirementDestination(destination);
    links.push({sourceId, revision, location, start: value.start, end, textStart, textEnd, text: safeText, ...safe, ...((!closed || !valid || hrefs.length !== 1) && safe.status !== 'redacted' ? {status: 'malformed'} : {})});
  }
  return links;
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
  // Requirement inventory IDs bind to individual located lines. Business-context
  // section grouping must not merge those independent acceptance units.
  const readerOptions = {...options, nativeSections: false};
  const request = contextData(raw);
  keys(request, ['version', 'project', 'application', 'storyId', 'sources', 'attachments', 'attachmentIds', 'includeHistory'], 'requirements request');
  requireThat(request.version === 1 && ['project', 'application'].every(key => typeof request[key] === 'string' && request[key].trim() && request[key].length <= 200), 'Requirements need project and application identity.');
  requireThat(Array.isArray(request.sources) && request.sources.length <= 100 && new Set(request.sources.map(source => source.id)).size === request.sources.length, 'Select distinct supplied sources.');
  if (request.attachments !== undefined) requireThat(request.storyId !== undefined && Array.isArray(request.attachments) && request.attachments.length <= 100 && new Set(request.attachments.map(item => item.attachmentId?.toLowerCase())).size === request.attachments.length && request.attachments.every(item => adoGuid(item.attachmentId) && item.extraction && typeof item.extraction === 'object'), 'Attachment reader receipts need distinct ADO attachment identities.');
  if (request.attachmentIds !== undefined) requireThat(request.storyId !== undefined && Array.isArray(request.attachmentIds) && request.attachmentIds.length <= 100 && request.attachmentIds.every(adoGuid) && new Set(request.attachmentIds.map(value => value.toLowerCase())).size === request.attachmentIds.length, 'Select distinct attachment IDs explicitly for one story.');
  requireThat(request.includeHistory === undefined || typeof request.includeHistory === 'boolean', 'History selection must be boolean.');
  const parts = [], omissions = [], revisions = [], links = [], sourceKeys = new Set();
  function add(sourceId, revision, values, kind = 'requirement') {
    const safe = contextParts(values.map(value => ({...value, text: redactRequirementLinks(value.text)})));
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
      if (field !== 'System.Title' && typeof value === 'string') links.push(...requirementLinks(value, 'story', String(item.rev), field));
      if (typeof value === 'string' && value.trim()) add('story', String(item.rev), [{location: field, text: field === 'System.Title' ? value : ordinaryHtmlText(value)}], kind);
      else omissions.push({sourceId: 'story', location: field, reason: 'absent'});
    }
    revisions.push({id: 'story', revision: String(item.rev), content: fingerprint(item.fields)});
    try {
      const comments = await readStoryComments(client, storyId);
      revisions.push({id: 'discussion', revision: fingerprint(comments)});
      for (const comment of comments) if (!comment.deleted) add('discussion', String(comment.version), [{location: `comment:${comment.id}`, text: ordinaryHtmlText(comment.text)}], 'discussion');
    } catch {omissions.push({sourceId: 'discussion', reason: 'inaccessible-or-incomplete'});}
    if (request.includeHistory) {
      try {
        const history = [];
        for (let skip = 0; ; skip += 100) {
          const response = await client.read(`wit/workitems/${storyId}/revisions?$top=100&$skip=${skip}&api-version=7.1`);
          requireThat(Array.isArray(response.value) && response.value.length <= 100 && history.length + response.value.length <= 1000, 'Story history is incomplete or exceeds 1000 revisions.');
          for (const revision of response.value) {
            requireThat(adoId(revision.id) === storyId && Number.isInteger(revision.rev) && revision.rev > 0 && revision.fields && !history.some(row => row.rev === revision.rev), 'Story history identity is incomplete.');
            history.push({rev: revision.rev, fields: Object.fromEntries(['System.Description', 'Microsoft.VSTS.Common.AcceptanceCriteria', 'System.History'].filter(field => typeof revision.fields[field] === 'string').map(field => [field, ordinaryHtmlText(revision.fields[field])]))});
          }
          if (response.value.length < 100) break;
        }
        revisions.push({id: 'history', revision: fingerprint(history)});
        for (const revision of history) for (const [field, value] of Object.entries(revision.fields)) if (value.trim()) add('history', String(revision.rev), [{location: `revision:${revision.rev}:${field}`, text: value}], 'discussion');
      } catch {omissions.push({sourceId: 'history', reason: 'inaccessible-or-incomplete'});}
    }
    requireThat(item.relations === undefined || Array.isArray(item.relations), 'Story attachments are incomplete.');
    const missingAttachments = new Set(request.attachmentIds?.map(value => value.toLowerCase()) ?? []);
    for (const [index, relation] of (item.relations ?? []).entries()) if (relation.rel === 'AttachedFile') {
      let sourceId = 'attachment-' + index; const name = relation.attributes?.name ?? 'attachment';
      let url; try {url = new URL(relation.url);} catch {}
      const scopes = ['', ...[project.id, project.name].map(value => '/' + encodeURIComponent(value))];
      const prefix = scopes.map(scope => client.configuration.organizationUrl + scope + '/_apis/wit/attachments/').find(value => url?.href.toLowerCase().startsWith(value.toLowerCase()));
      const attachmentId = prefix && url.pathname.slice(new URL(prefix).pathname.length);
      if (!prefix || !adoGuid(attachmentId) || url.username || url.password) {omissions.push({sourceId, reason: 'unverified-attachment-destination'}); continue;}
      sourceId = 'ado-attachment-' + attachmentId.toLowerCase();
      if (request.attachmentIds !== undefined && !request.attachmentIds.some(value => value.toLowerCase() === attachmentId.toLowerCase())) {omissions.push({sourceId, reason: 'not-selected'}); continue;}
      missingAttachments.delete(attachmentId.toLowerCase());
      try {
        const bytes = await client.attachment(attachmentId);
        revisions.push({id: sourceId, revision: digest(bytes), name});
        const receipt = request.attachments?.find(item => item.attachmentId.toLowerCase() === attachmentId.toLowerCase());
        const extracted = await extractContextBytes({id: sourceId, kind: 'attachment', name, ...(receipt ? {extraction: receipt.extraction} : {})}, bytes, readerOptions);
        add(sourceId, extracted.hash, extracted.contributions.map(({location, text}) => ({location, text})));
        if (extracted.coverage !== 'complete' || extracted.redacted) omissions.push({sourceId, reason: extracted.coverage, redacted: extracted.redacted ?? 0});
      } catch {omissions.push({sourceId, reason: 'inaccessible-attachment'});}
    }
    for (const attachmentId of missingAttachments) omissions.push({sourceId: 'ado-attachment-' + attachmentId, reason: 'unverified-selected-attachment'});
  }
  for (const source of request.sources) {
    keys(source, ['id', 'kind', 'path', 'encoding', 'delimiter', 'extraction'], 'requirements source');
    requireThat(typeof source.id === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(source.id) && !source.id.startsWith('ado-') && !['story', 'discussion'].includes(source.id) || source.id === 'story' && request.storyId === undefined, 'Invalid or reserved requirements source ID.');
    // Supplied paths are explicit inputs; reuse the existing bounded, sanitizing readers.
    const record = await readFileContext(roots, source, readerOptions), revision = record.hash ?? 'unavailable';
    revisions.push({id: source.id, revision});
    for (const part of record.contributions) links.push(...requirementLinks(part.text, source.id, revision, part.location));
    add(source.id, revision, record.contributions.map(({location, text}) => ({location, text})));
    if (record.coverage !== 'complete' || record.redacted) omissions.push({sourceId: source.id, reason: record.coverage, redacted: record.redacted ?? 0});
  }
  requireThat(parts.length > 0, 'No sanitized requirements are available; prepared/prior state is unchanged.');
  const snapshot = contextData({version: 1, consumer: consumerIdentity(roots, request.project, request.application), request, parts, omissions, revisions, linksVersion: 1, links, ...(origin ? {origin} : {})});
  return {...snapshot, fingerprint: fingerprint(snapshot)};
}
