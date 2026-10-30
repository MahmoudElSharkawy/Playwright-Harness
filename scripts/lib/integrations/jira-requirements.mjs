import {fingerprint, digest, requireThat} from '../execution-core/data.mjs';
import {jiraIssueKey} from './jira-config.mjs';
import {readJiraAdf} from './jira-adf.mjs';

const id = value => (typeof value === 'string' && /^[A-Za-z0-9._:-]{1,100}$/.test(value)) || Number.isSafeInteger(value) && value > 0;
const attachmentId = value => (typeof value === 'string' || Number.isSafeInteger(value)) && /^[1-9]\d{0,19}$/.test(String(value));
const timestamp = value => typeof value === 'string' && value.length <= 100 && Number.isFinite(Date.parse(value));
const requireKey = (client, key) => requireThat(jiraIssueKey(key) && key.startsWith(client.configuration.project + '-'), 'Jira story must belong to the configured project.');

/** Bind the selected evidence, not volatile Jira response fields such as lastViewed. */
export function jiraStoryRevision(client, item, {attachmentIds = []} = {}) {
  const fields = item.fields, selected = new Set(attachmentIds.map(String));
  requireThat(fields && timestamp(fields.updated), 'Jira updated identity is incomplete.');
  const selectedFields = Object.fromEntries([...new Set(['summary', 'description', 'status', 'issuetype', client.configuration.fields?.acceptanceCriteria].filter(Boolean))].map(name => [name, fields[name] ?? null]));
  selectedFields.attachments = (fields.attachment ?? []).filter(row => selected.has(String(row.id))).map(row => Object.fromEntries(['id', 'filename', 'size', 'mimeType', 'created'].filter(name => row[name] !== undefined).map(name => [name, row[name]])));
  requireThat(Array.isArray(fields.issuelinks ?? []) && (fields.issuelinks ?? []).length <= 1000, 'Jira issue links are incomplete or exceed their bound.');
  const links = (fields.issuelinks ?? []).map(link => {
    const issue = link.inwardIssue ?? link.outwardIssue;
    requireThat(id(link.id) && id(link.type?.id) && id(issue?.id) && jiraIssueKey(issue.key) && !!link.inwardIssue !== !!link.outwardIssue, 'Jira issue link identity is incomplete.');
    return {id: String(link.id), type: String(link.type.id), direction: link.inwardIssue ? 'inward' : 'outward', issue: {id: String(issue.id), key: issue.key}};
  }).sort((a, b) => a.id.localeCompare(b.id));
  requireThat(new Set(links.map(link => link.id)).size === links.length, 'Duplicate Jira issue link identity.');
  const content = fingerprint(selectedFields), updated = fields.updated;
  return {revision: fingerprint({content, updated, links}), content, updated, links};
}

export function validateJiraRequirementsAttachments(request) {
  const selected = request.attachmentIds ?? [];
  requireThat(Array.isArray(selected) && selected.length <= 100 && selected.every(attachmentId) && new Set(selected.map(String)).size === selected.length, 'Select distinct numeric Jira attachment IDs.');
  const readers = request.attachments ?? [];
  requireThat(Array.isArray(readers) && readers.length <= 100 && readers.every(item => item && attachmentId(item.attachmentId) && item.extraction && typeof item.extraction === 'object' && !Array.isArray(item.extraction) && selected.map(String).includes(String(item.attachmentId))) && new Set(readers.map(item => String(item.attachmentId))).size === readers.length, 'Jira attachment readers require distinct explicitly selected attachment IDs.');
  return selected.map(String);
}

export async function readJiraStoryComments(client, storyId) {
  requireKey(client, storyId);
  const rows = await client.list(`issue/${storyId}/comment`, {itemsKey: 'comments'}), comments = [], seen = new Set();
  requireThat(Array.isArray(rows) && rows.length <= 10000, 'Jira discussion is incomplete or exceeds its bound.');
  for (const row of rows) {
    requireThat(id(row?.id) && timestamp(row.updated) && !seen.has(String(row.id)), 'Jira discussion identity is incomplete or duplicate.'); seen.add(String(row.id));
    const content = readJiraAdf(row.body, {location: `comment:${row.id}`});
    comments.push({id: String(row.id), updated: row.updated, version: fingerprint({id: String(row.id), updated: row.updated, body: row.body ?? null}), content: fingerprint(row.body ?? null), ...content, deleted: false});
  }
  return comments;
}

/** Provider I/O only; callers own sanitization, extraction, approval and persistence. */
export async function readJiraRequirements(client, request) {
  requireKey(client, request.storyId); const selected = validateJiraRequirementsAttachments(request);
  const project = await client.projectIdentity(), item = await client.issue(request.storyId), fields = item.fields;
  requireThat(id(item.id) && item.key === request.storyId && fields?.project?.key === project.key && String(fields.project.id) === String(project.id) && timestamp(fields.updated), 'Jira story identity, project or freshness is incomplete.');
  const origin = {provider: 'jira', siteUrl: client.configuration.siteUrl, projectId: String(project.id), project: project.key, storyId: item.key, testManagement: client.configuration.testManagement?.provider ?? 'none'};
  const sections = [], revisions = [], omissions = [], links = [], attachments = [];
  const namedIdentity = value => id(value?.id) && typeof value.name === 'string' && value.name.trim() && value.name.length <= 200 ? {id: String(value.id), name: value.name} : undefined;
  const metadata = {id: String(item.id), key: item.key, type: namedIdentity(fields.issuetype), status: namedIdentity(fields.status), updated: fields.updated};
  const availableAttachments = [];
  if (fields.attachment !== undefined) {
    if (!Array.isArray(fields.attachment) || fields.attachment.length > 1000) omissions.push({sourceId: 'jira-story', location: 'attachment', reason: 'incomplete-attachment-inventory'});
    else for (const attachment of fields.attachment) {
      if (attachmentId(attachment?.id) && typeof attachment.filename === 'string' && attachment.filename.trim() && attachment.filename.length <= 300 && fields.attachment.filter(value => String(value?.id) === String(attachment.id)).length === 1) availableAttachments.push({id: String(attachment.id), name: attachment.filename});
      else omissions.push({sourceId: 'jira-story', location: 'attachment', reason: 'incomplete-attachment-inventory'});
    }
  }
  const storyIdentity = jiraStoryRevision(client, item, {attachmentIds: selected}), storyRevision = storyIdentity.revision;
  revisions.push({id: 'jira-story', ...storyIdentity});
  function section(sourceId, revision, location, body, kind) {
    const content = readJiraAdf(body, {location});
    if (content.text) sections.push({sourceId, revision, kind, values: [{location, text: content.text}]});
    else if (!content.omissions.length) omissions.push({sourceId, location, reason: 'absent'});
    omissions.push(...content.omissions.map(value => ({sourceId, ...value})));
    links.push(...content.links.map(value => ({sourceId, revision, ...value})));
  }
  section('jira-story', storyRevision, 'summary', fields.summary, 'context');
  section('jira-story', storyRevision, 'description', fields.description, 'requirement');
  const acceptance = client.configuration.fields?.acceptanceCriteria;
  if (acceptance) section('jira-story', storyRevision, acceptance, fields[acceptance], 'criterion');
  else omissions.push({sourceId: 'jira-story', location: 'acceptanceCriteria', reason: 'absent'});
  if (request.includeDiscussion !== false) {
    try {
      const comments = await readJiraStoryComments(client, request.storyId);
      revisions.push({id: 'jira-discussion', revision: fingerprint(comments)});
      for (const comment of comments) {
        if (comment.text) sections.push({sourceId: 'jira-discussion', revision: comment.version, kind: 'discussion', values: [{location: `comment:${comment.id}`, text: comment.text}]});
        omissions.push(...comment.omissions.map(value => ({sourceId: 'jira-discussion', ...value})));
        links.push(...comment.links.map(value => ({sourceId: 'jira-discussion', revision: comment.version, ...value})));
      }
    } catch {omissions.push({sourceId: 'jira-discussion', reason: 'inaccessible-or-incomplete'});}
  }
  if (request.includeHistory) {
    try {
      const history = await client.list(`issue/${request.storyId}/changelog`, {maxItems: 1000}), seen = new Set(), captured = [], entries = [];
      requireThat(Array.isArray(history) && history.length <= 1000, 'Jira history is incomplete or exceeds its bound.');
      for (const entry of history) {
        requireThat(id(entry?.id) && timestamp(entry.created) && Array.isArray(entry.items) && entry.items.length <= 200 && !seen.has(String(entry.id)), 'Jira history identity is incomplete or duplicate.'); seen.add(String(entry.id));
        const revision = fingerprint({id: String(entry.id), created: entry.created, items: entry.items});
        const addedLinks = entry.items.map(change => {
          const match = typeof change.toString === 'string' && /\b([A-Z][A-Z0-9_]*-[1-9]\d*)$/.exec(change.toString);
          return (change.fieldId === 'issuelinks' || change.field === 'Link') && change.from == null && change.fromString == null && id(change.to) && match ? {id: String(change.to), key: match[1]} : null;
        });
        entries.push({id: String(entry.id), revision, created: entry.created, ...(addedLinks.length && addedLinks.every(Boolean) ? {addedLinks} : {})});
        for (const [index, change] of entry.items.entries()) {
          const field = change.fieldId ?? change.field, location = `change:${entry.id}:${index}`;
          if (typeof field !== 'string' || !field.trim() || field.length > 200 || ![change.fromString, change.toString].some(value => typeof value === 'string')) {omissions.push({sourceId: 'jira-history', location, reason: 'unavailable-history-text'}); continue;}
          captured.push({sourceId: 'jira-history', revision, kind: 'discussion', values: [{location, text: `${field}: ${change.fromString ?? '[empty]'} → ${change.toString ?? '[empty]'}`} ]});
        }
      }
      revisions.push({id: 'jira-history', revision: fingerprint(history), entries}); sections.push(...captured);
    } catch {omissions.push({sourceId: 'jira-history', reason: 'inaccessible-or-incomplete'});}
  }
  if (selected.length) {
    requireThat(Array.isArray(fields.attachment), 'Jira story attachment metadata is incomplete.');
    for (const selectedId of selected) {
      const sourceId = `jira-attachment-${selectedId}`, matches = fields.attachment.filter(value => String(value.id) === selectedId);
      if (matches.length !== 1 || typeof matches[0].filename !== 'string' || !matches[0].filename.trim() || matches[0].filename.length > 300) {omissions.push({sourceId, reason: 'unverified-selected-attachment'}); continue;}
      const name = matches[0].filename, extraction = request.attachments?.find(value => String(value.attachmentId) === selectedId)?.extraction;
      try {
        const bytes = await client.attachment(selectedId); requireThat(Buffer.isBuffer(bytes) && bytes.length <= 8 * 1024 * 1024, 'Jira attachment exceeds its bound.');
        const revision = digest(bytes); revisions.push({id: sourceId, revision, name});
        attachments.push({sourceId, id: selectedId, name, bytes, revision, ...(extraction ? {extraction} : {})});
      } catch {omissions.push({sourceId, reason: 'inaccessible-attachment'});}
    }
  }
  return {origin, metadata, availableAttachments, sections, revisions, omissions, links, attachments};
}
