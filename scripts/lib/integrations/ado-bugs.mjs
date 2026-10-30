import {adoId, adoGuid} from './config.mjs';
import {loadBugSchema, inspectBugFields, allowedFieldValue} from './bug-fields.mjs';
import {fingerprint, requireThat} from '../execution-core/data.mjs';
import {escapeHtml} from '../reporting/render.mjs';
import {draftMetadata, renderBugNarrative} from '../execute/bug-narrative.mjs';
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const wiqlTag = tag => `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.Tags] CONTAINS ${quote(tag)}`;
const workItem = async (client, id) => {const item = await client.read(`wit/workitems/${adoId(id)}?$expand=relations&api-version=7.1`); requireThat(adoId(item.id) === adoId(id) && Number.isInteger(item.rev) && item.fields, 'Bug readback has an invalid identity.'); await client.requireWorkItemProject(item); return item;};
const tagsOf = item => String(item.fields['System.Tags'] ?? '').split(';').map(tag => tag.trim()).filter(Boolean);
async function taggedItems(client, tag) {
  const result = await client.wiql(wiqlTag(tag)); requireThat(Array.isArray(result.workItems) && result.workItems.length <= 100, 'Bug duplicate query exceeded its bounded scope.');
  const items = []; for (const item of result.workItems) {const found = await workItem(client, item.id); if (tagsOf(found).includes(tag)) items.push(found);} return items;
}
async function bugMetadata(client) {
  return loadBugSchema(client, {refresh: true});
}
async function validatePath(client, group, path) {
  if (!path) return;
  const project = await client.projectIdentity(), parts = path.split('\\'); requireThat(parts[0].toLowerCase() === project.name.toLowerCase(), 'Bug path belongs to another project.');
  const suffix = parts.slice(1).map(encodeURIComponent).join('/'), found = await client.cachedRead(`wit/classificationnodes/${group}${suffix ? `/${suffix}` : ''}?api-version=7.1`);
  const nodeParts = typeof found.path === 'string' ? found.path.replace(/^\\/, '').split('\\') : [];
  const structure = group === 'areas' ? 'area' : 'iteration';
  requireThat(nodeParts[1]?.toLowerCase() === structure && [nodeParts[0], ...nodeParts.slice(2)].join('\\').toLowerCase() === path.toLowerCase(), 'ADO area/iteration path did not match.');
}
async function prepareBug(client, view, defect, revisions, metadata, drafts, intent) {
  const defaults = client.configuration.bugs ?? {}, edited = draftMetadata(drafts, defect.fingerprint, defaults, defect.title), changed = revisions.find(item => item.caseId === defect.caseId);
  const fields = {...defaults.fields, ...edited.fields, [metadata.mappings.title]: edited.title, 'System.Tags': [...(defaults.tags ?? []), defect.fingerprint, `harness-filing-${intent.filingId.slice(0, 8)}`].join('; ')};
  let paths = {};
  if (defaults.pathsFrom) {
    requireThat(defaults.pathsFrom !== 'story' || view.source.scope.kind === 'story', 'pathsFrom:story requires story scope.');
    const parent = await workItem(client, defaults.pathsFrom === 'story' ? view.source.scope.storyId : defect.caseId); paths = parent.fields;
  }
  for (const [name, configured] of [['System.AreaPath', defaults.areaPath], ['System.IterationPath', defaults.iterationPath]]) if (metadata.fields.some(field => field.referenceName === name)) fields[name] ??= configured ?? paths[name] ?? (await client.projectIdentity()).name;
  if (defaults.assignedTo) fields['System.AssignedTo'] ??= defaults.assignedTo;
  if (edited.priority !== undefined) fields['Microsoft.VSTS.Common.Priority'] = edited.priority;
  if (edited.severity !== undefined) fields['Microsoft.VSTS.Common.Severity'] = edited.severity;
  const {html: content, actual} = renderBugNarrative(view, defect, edited, changed);
  requireThat(metadata.mappings.reproSteps || metadata.mappings.description, 'Configure an available bug narrative field mapping.');
  fields[metadata.mappings.reproSteps ?? metadata.mappings.description] = content;
  if (metadata.mappings.description && metadata.mappings.description !== metadata.mappings.reproSteps) fields[metadata.mappings.description] = content;
  for (const name of ['expected', 'actual']) if (metadata.mappings[name] && edited[name] !== undefined) {const spec = metadata.fields.find(field => field.referenceName === metadata.mappings[name]), value = name === 'actual' ? actual : edited[name]; fields[metadata.mappings[name]] = /^html$/i.test(spec?.type ?? '') ? `<pre>${escapeHtml(value)}</pre>` : value;}
  for (const name of edited.omitFields ?? []) {requireThat(!['System.Tags', ...Object.values(metadata.mappings)].includes(name), 'Cannot omit bug narrative or durable identity fields.'); delete fields[name];}
  const inspection = inspectBugFields(metadata, fields);
  if (!inspection.ready) {const details = inspection.problems.map(problem => problem.code === 'allowed-value' ? `Bug field ${problem.field} is outside its allowed values.` : ['unavailable', 'read-only'].includes(problem.code) ? `Bug field ${problem.field} is unavailable or read-only.` : problem.code === 'required' ? `Required bug field ${problem.field} needs a supplied value or configured default.` : `${problem.field}:${problem.code}`); const error = new Error(`Bug fields need review: ${details.join(' ')}`); error.fieldProblems = inspection.problems; error.fieldReview = inspection.review; throw error;}
  await validatePath(client, 'areas', fields['System.AreaPath']); await validatePath(client, 'iterations', fields['System.IterationPath']);
  const duplicates = (await taggedItems(client, defect.fingerprint)).filter(item => !tagsOf(item).includes(`harness-filing-${intent.filingId.slice(0, 8)}`)), completedStates = new Set(metadata.states.filter(state => state.category === 'Completed' || state.category === 'Removed').map(state => state.name));
  const open = duplicates.filter(item => !completedStates.has(item.fields['System.State'])), closed = duplicates.filter(item => completedStates.has(item.fields['System.State']));
  const body = Object.entries(fields).map(([name, value]) => ({op: 'add', path: `/fields/${name}`, value}));
  for (const item of closed) body.push({op: 'add', path: '/relations/-', value: {rel: 'System.LinkTypes.Related', url: `${client.configuration.organizationUrl}/_apis/wit/workitems/${item.id}`}});
  if (defaults.storyLink && view.source.scope.kind === 'story') {await workItem(client, view.source.scope.storyId); body.push({op: 'add', path: '/relations/-', value: {rel: 'System.LinkTypes.Related', url: `${client.configuration.organizationUrl}/_apis/wit/workitems/${view.source.scope.storyId}`}});}
  await client.validateWorkItem(metadata.type, body, {fresh: true});
  return {defect, type: metadata.type, body, fields, fieldSpecifications: metadata.fields, schemaFingerprint: metadata.fingerprint, review: inspection.review, duplicates: {open: open.map(item => item.id), closed: closed.map(item => item.id)}, revisions: changed ?? null};
}

/** Azure-native operations behind the shared filing and attachment journal. */
export function createAdoBugs(client) {
  const marker = row => `harness-filing-${row.filingId.slice(0, 8)}`;
  return {
    destination: {organizationUrl: client.configuration.organizationUrl, project: client.configuration.project},
    identityKey: 'workItemId', marker, metadata: () => bugMetadata(client), read: id => workItem(client, id), tags: tagsOf, find: tag => taggedItems(client, tag), id: item => adoId(item.id),
    prepare: (view, defect, revisions, metadata, drafts, intent) => prepareBug(client, view, defect, revisions, metadata, drafts, intent),
    createRequest: item => ({route: `wit/workitems/$${encodeURIComponent(item.type)}?api-version=7.1`, body: item.body, options: {method: 'POST', patch: true}}),
    verify(after, item, row) {
      requireThat(tagsOf(after).includes(row.fingerprint) && tagsOf(after).includes(marker(row)), 'Bug creation did not verify its fingerprint and filing identity.');
      for (const [name, value] of Object.entries(item.fields)) {
        const actual = after.fields[name], spec = item.fieldSpecifications.find(field => field.referenceName === name);
        const matches = name === 'System.Tags' ? String(value).split(';').map(tag => tag.trim()).filter(Boolean).every(tag => tagsOf(after).includes(tag)) : /Path$/.test(name) ? typeof actual === 'string' && actual.toLowerCase() === String(value).toLowerCase() : allowedFieldValue({...spec, allowedValues: [actual]}, value);
        requireThat(matches, `Bug field ${name} did not match its approved value at readback.`);
      }
    },
    attachmentRequest(row, record, bytes) {
      const name = record.name ?? `${record.id}.png`;
      requireThat(/^[A-Za-z0-9_.-]{1,100}$/.test(name), 'Invalid attachment name.');
      return {route: `wit/attachments?fileName=${encodeURIComponent(name)}&api-version=7.1`, body: bytes, options: {method: 'POST', raw: true, contentType: 'application/octet-stream'}};
    },
    attachmentIdentity(result) {requireThat(adoGuid(result.id), 'Attachment upload returned an invalid identity.'); return result.id;},
    async verifyAttachment(delivery, row, attachment) {
      attachment.url = `${client.configuration.organizationUrl}/_apis/wit/attachments/${attachment.id}`;
      const item = await workItem(client, row.workItemId);
      if (!(item.relations ?? []).some(relation => relation.rel === 'AttachedFile' && relation.url === attachment.url)) await delivery.write('attach-evidence', `wit/workitems/${row.workItemId}?api-version=7.1`, [{op: 'test', path: '/rev', value: item.rev}, {op: 'add', path: '/relations/-', value: {rel: 'AttachedFile', url: attachment.url, attributes: {comment: 'Verified harness execution context'}}}], {patch: true});
      const after = await workItem(client, row.workItemId); requireThat((after.relations ?? []).some(relation => relation.rel === 'AttachedFile' && relation.url === attachment.url), 'Bug attachment did not verify.');
    }
  };
}
