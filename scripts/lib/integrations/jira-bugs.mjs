import {data, digest, fingerprint, requireThat} from '../execution-core/data.mjs';
import {draftMetadata, renderBugNarrative} from '../execute/bug-narrative.mjs';
import {ordinaryHtmlText} from '../requirements/sources.mjs';
import {jiraTextDocument} from './jira-adf.mjs';
import {jiraIssueKey} from './jira-config.mjs';
import {requestFingerprint} from './delivery.mjs';
import {jiraStoryRevision} from './jira-requirements.mjs';

const fieldId = value => typeof value === 'string' && /^(?:[a-z][a-zA-Z0-9]*|customfield_[1-9]\d*)$/.test(value);
const scalarId = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value);
const labels = item => Array.isArray(item.fields?.labels) ? item.fields.labels : [];
const marker = row => `harness-filing-${row.filingId}`;
const identity = value => value && typeof value === 'object' && !Array.isArray(value) ? value.id ?? value.accountId ?? value.value ?? value.name : value;
const sameValue = (actual, expected) => Array.isArray(expected) ? Array.isArray(actual) && actual.length === expected.length && expected.every((value, index) => sameValue(actual[index], value)) : typeof expected === 'object' && expected !== null && identity(expected) !== expected ? identity(actual) === identity(expected) : fingerprint(actual ?? null) === fingerprint(expected ?? null);
export function matchesJiraBugSource(original, current, row, target) {
  if (original.revision === current.revision) return true;
  const owned = link => row.workItemId && link.issue.key === row.workItemId && link.direction === 'inward' && row.links?.some(entry => entry.target === target && entry.typeId === link.type && ['DISPATCHING', 'VERIFIED'].includes(entry.state));
  return current.content === original.content && current.links.some(owned) && fingerprint(current.links.filter(link => !owned(link))) === fingerprint(original.links);
}
/** Ignore only this delivery's verified new backlinks; business edits still invalidate the captured source. */
export async function reconcileJiraBugStory(client, source, entries) {
  if (!source.story || !entries.length) return source;
  const original = source.story.version, current = jiraStoryRevision(client, await client.issue(source.story.id));
  if (current.revision === original.revision || current.content !== original.content) return source;
  const introduced = current.links.filter(link => !original.links.some(previous => fingerprint(previous) === fingerprint(link)));
  if (!introduced.length) return source;
  for (const link of introduced) {
    const row = entries.find(row => link.direction === 'inward' && row.workItemId === link.issue.key && row.sourceLinks?.some(value => value.target === source.story.id && value.typeId === link.type && value.sourceVersion.content === original.content) && row.links?.some(value => value.target === source.story.id && value.typeId === link.type && ['DISPATCHING', 'VERIFIED'].includes(value.state)));
    if (!row || !labels(await client.issue(row.workItemId)).includes(marker(row))) return source;
  }
  if (fingerprint(current.links.filter(link => !introduced.includes(link))) !== fingerprint(original.links)) return source;
  return {...source, story: {...source.story, version: current}};
}
function validValue(field, value) {
  const type = field.schema?.type;
  if (field.fieldId === 'description' || field.schema?.custom?.endsWith(':textarea')) return value?.type === 'doc' && value.version === 1 && Array.isArray(value.content);
  if (type === 'string') return typeof value === 'string';
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'integer') return Number.isSafeInteger(value);
  if (type === 'boolean') return typeof value === 'boolean';
  if (['date', 'datetime'].includes(type)) return typeof value === 'string' && Number.isFinite(Date.parse(value));
  if (type === 'array') return Array.isArray(value) && value.length <= 100 && value.every(item => validValue({schema: {type: field.schema.items}}, item));
  if (['option', 'priority', 'project', 'issuetype', 'component', 'version', 'resolution', 'securitylevel'].includes(type)) return value && typeof value === 'object' && !Array.isArray(value) && scalarId(value.id);
  if (type === 'user') return value && typeof value === 'object' && scalarId(value.accountId);
  return false;
}

/** Jira-native fields, issue links and attachments; delivery state remains shared. */
export function createJiraBugs(client) {
  const destination = {provider: 'jira', siteUrl: client.configuration.siteUrl, project: client.configuration.project};
  const read = key => client.issue(key);
  const id = item => {requireThat(jiraIssueKey(item?.key) && item.key.startsWith(client.configuration.project + '-'), 'Jira bug identity is incomplete.'); return item.key;};
  async function find(tag) {
    requireThat(/^harness-(?:filing-[a-f0-9-]{36}|defect-[a-f0-9]{12,64})$/.test(tag), 'Invalid Jira bug marker.');
    const result = await client.search(`labels = "${tag}"`, {fields: ['labels', 'status', 'issuetype', 'project'], maxItems: 100});
    const found = []; for (const value of result) {const item = await read(value.key); if (labels(item).includes(tag)) found.push(item);} return found;
  }
  async function metadata() {
    const project = await client.projectIdentity(), types = await client.list(`issue/createmeta/${project.key}/issuetypes`, {itemsKey: 'issueTypes'});
    const selection = client.configuration.issueTypes?.bug ?? 'Bug', candidates = types.filter(type => type.id === selection || type.name === selection);
    requireThat(candidates.length === 1 && scalarId(candidates[0].id) && candidates[0].subtask !== true, 'Select one available standalone Jira bug issue type.');
    const type = candidates[0], fields = await client.list(`issue/createmeta/${project.key}/issuetypes/${type.id}`, {itemsKey: 'fields', maxItems: 1000});
    requireThat(fields.length > 0 && new Set(fields.map(field => field.fieldId)).size === fields.length && fields.every(field => fieldId(field.fieldId) && typeof field.name === 'string' && Array.isArray(field.operations) && (field.allowedValues === undefined || Array.isArray(field.allowedValues) && field.allowedValues.length <= 1000)), 'Jira bug field metadata is incomplete or ambiguous.');
    const permissions = await client.read(`mypermissions?projectKey=${project.key}&permissions=CREATE_ISSUES,CREATE_ATTACHMENTS,LINK_ISSUES`);
    requireThat(permissions.permissions?.CREATE_ISSUES?.havePermission === true, 'Jira bug creation permission is unavailable.');
    const schema = {project, type: {id: type.id, name: type.name}, fields, permissions: {attachments: permissions.permissions.CREATE_ATTACHMENTS?.havePermission === true, links: permissions.permissions.LINK_ISSUES?.havePermission === true}, limitations: ['Conditional Jira workflow rules are validated by Jira when creating the issue.']};
    return {...schema, fingerprint: fingerprint({destination, ...schema, configuration: client.configuration.bugs ?? {}})};
  }
  async function prepare(view, defect, revisions, metadata, drafts, intent) {
    const defaults = client.configuration.bugs ?? {}, edited = draftMetadata(drafts, defect.fingerprint, defaults, defect.title, {structuredFields: true}), changed = revisions.find(row => row.caseId === defect.caseId);
    requireThat(edited.severity === undefined, 'Use the configured Jira field ID for severity.');
    const narrative = renderBugNarrative(view, defect, edited, changed);
    const fields = {...defaults.fields, ...edited.fields, project: {id: metadata.project.id}, issuetype: {id: metadata.type.id}, summary: edited.title,
      description: jiraTextDocument(ordinaryHtmlText(narrative.html), {links: narrative.references}), labels: [...new Set([...(defaults.labels ?? []), defect.fingerprint, marker(intent)])]};
    if (edited.priority !== undefined) fields.priority = typeof edited.priority === 'object' ? edited.priority : {id: String(edited.priority)};
    for (const name of edited.omitFields ?? []) {requireThat(!['project', 'issuetype', 'summary', 'description', 'labels'].includes(name), 'Cannot omit bug narrative or durable identity fields.'); delete fields[name];}
    data(fields, 256 * 1024);
    const problems = [], review = metadata.fields.map(field => {
      const value = fields[field.fieldId], readOnly = !field.operations.includes('set');
      if (value === undefined && field.required && !field.hasDefaultValue) problems.push({field: field.fieldId, code: 'required'});
      if (value !== undefined && (readOnly || !validValue(field, value))) problems.push({field: field.fieldId, code: readOnly ? 'read-only' : 'type'});
      if (value !== undefined && field.allowedValues?.length) {
        const values = Array.isArray(value) ? value : [value];
        if (!values.every(value => field.allowedValues.some(allowed => sameValue(allowed, value)))) problems.push({field: field.fieldId, code: 'allowed-value'});
      }
      return {field: field.fieldId, label: field.name, required: field.required === true, readOnly, type: field.schema?.type ?? 'unavailable', ...(value === undefined ? {} : {value}), ...(field.allowedValues ? {allowedValues: field.allowedValues} : {})};
    });
    for (const name of Object.keys(fields)) if (!['project', 'issuetype'].includes(name) && !metadata.fields.some(field => field.fieldId === name)) problems.push({field: name, code: 'unavailable'});
    if (problems.length) throw Object.assign(new Error('Jira bug fields need review; supply the required native field values.'), {fieldProblems: problems, fieldReview: review});
    if (view.reportAttachments?.length || defect.occurrences?.some(row => row.evidenceIds?.length)) requireThat(metadata.permissions.attachments, 'Jira attachment permission is unavailable.');
    const found = (await find(defect.fingerprint)).filter(item => !labels(item).includes(marker(intent)));
    requireThat(found.every(item => item.fields.status?.statusCategory?.key), 'Jira duplicate status metadata is incomplete.');
    const duplicates = {open: found.filter(item => item.fields.status.statusCategory.key !== 'done').map(id), closed: found.filter(item => item.fields.status.statusCategory.key === 'done').map(id)};
    const scope = view.source.scope, originStory = scope.kind === 'story' && jiraIssueKey(scope.storyId) ? scope.storyId : scope.siteUrl === destination.siteUrl && scope.project === destination.project && scope.selection?.kind === 'story' ? scope.selection.id : undefined;
    const requestedStory = view.bugStory?.id ?? (defaults.storyLink ? originStory : undefined);
    if (view.bugStory) requireThat(view.bugStory.provider === 'jira' && view.bugStory.siteUrl === destination.siteUrl && view.bugStory.project === destination.project, 'Explicit bug story belongs to another Jira destination.');
    const targets = [...new Set([...duplicates.closed, ...(requestedStory ? [requestedStory] : [])])], links = [];
    if (targets.length) {
      requireThat(metadata.permissions.links && typeof defaults.linkType === 'string', 'Configure a Jira issue-link type and link permission for the selected bug relations.');
      const available = await client.read('issueLinkType'), types = available.issueLinkTypes?.filter(type => type.id === defaults.linkType || type.name === defaults.linkType);
      requireThat(types?.length === 1 && scalarId(types[0].id), 'Configured Jira bug link type is unavailable or ambiguous.');
      for (const target of targets) {
        const issue = await read(target), current = jiraStoryRevision(client, issue), original = intent.sourceLinks?.find(link => link.target === target && link.typeId === types[0].id)?.sourceVersion;
        requireThat(!original || matchesJiraBugSource(original, current, intent, target), 'Jira bug link source changed; reconcile the original preview.');
        links.push({typeId: types[0].id, target: id(issue), sourceVersion: original ?? current});
      }
    }
    return {defect, type: metadata.type.id, body: {fields}, fields, fieldSpecifications: metadata.fields, schemaFingerprint: metadata.fingerprint, review, duplicates, revisions: changed ?? null, links};
  }
  function verify(after, item, row) {
    requireThat(labels(after).includes(row.fingerprint) && labels(after).includes(marker(row)), 'Jira bug did not verify its fingerprint and filing identity.');
    for (const [name, value] of Object.entries(item.fields)) requireThat(name === 'labels' ? value.every(label => labels(after).includes(label)) : sameValue(after.fields[name], value), `Bug field ${name} did not match its approved value at readback.`);
  }
  async function completeLinks(delivery, row, prepared, save) {
    row.links ??= [];
    for (const target of prepared.links) {
      let entry = row.links.find(entry => entry.typeId === target.typeId && entry.target === target.target);
      if (!entry) {entry = {...target, state: 'INTENT'}; row.links.push(entry); save();}
      const matches = issue => (issue.fields.issuelinks ?? []).some(link => link.type?.id === target.typeId && link.outwardIssue?.key === target.target);
      if (matches(await read(row.workItemId))) {entry.state = 'VERIFIED'; save(); continue;}
      requireThat(entry.state === 'INTENT', 'Jira issue-link acknowledgement is uncertain; reconcile the selected link before retrying.');
      const body = {type: {id: target.typeId}, inwardIssue: {key: row.workItemId}, outwardIssue: {key: target.target}};
      entry.state = 'DISPATCHING'; entry.receipt = delivery.receipt; entry.requestFingerprint = requestFingerprint('issueLink', 'POST', body); save();
      await delivery.write('link-bug', 'issueLink', body, {method: 'POST'});
      requireThat(matches(await read(row.workItemId)), 'Jira bug link did not verify.'); entry.state = 'VERIFIED'; save();
    }
  }
  const attachmentName = (row, record) => `harness-${row.filingId}-${record.sha256.slice(0, 24)}-${record.name ?? record.id + '.png'}`;
  async function recoverAttachment(row, record, attachment) {
    const issue = await read(row.workItemId), name = attachmentName(row, record);
    requireThat(Array.isArray(issue.fields.attachment), 'Jira bug attachment metadata is incomplete.');
    const matches = issue.fields.attachment.filter(item => attachment.id ? String(item.id) === String(attachment.id) : item.filename === name);
    requireThat(matches.length <= 1, 'Jira attachment identity is ambiguous; reconcile before retrying.');
    if (!matches.length) return;
    const matched = matches[0]; requireThat(matched.filename === name && matched.size === record.bytes, 'Jira attachment identity or size differs from the approved evidence.');
    requireThat(digest(await client.attachment(String(matched.id))) === record.sha256, 'Jira attachment bytes differ from the approved evidence.'); return String(matched.id);
  }
  return {destination, identityKey: 'issueKey', marker, metadata, read, tags: labels, find, id, prepare, verify, completeLinks,
    createRequest: item => ({route: 'issue', body: item.body, options: {method: 'POST'}}),
    attachmentRequest: (row, record, bytes) => client.attachmentRequest(row.workItemId, bytes, attachmentName(row, record)),
    attachmentIdentity(result) {requireThat(Array.isArray(result) && result.length === 1 && /^[1-9]\d{0,19}$/.test(String(result[0]?.id)), 'Jira attachment upload returned an invalid identity.'); return String(result[0].id);},
    recoverAttachment, async verifyAttachment(delivery, row, attachment, record) {requireThat(await recoverAttachment(row, record, attachment) === String(attachment.id), 'Jira bug attachment did not verify.'); attachment.url = `${destination.siteUrl}/rest/api/3/attachment/content/${attachment.id}`;}
  };
}
