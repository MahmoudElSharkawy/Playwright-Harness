import {existsSync, readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createAdoClient, adoRequestFingerprint} from '../integrations/ado-client.mjs';
import {createAdoTestSource} from '../integrations/ado-source.mjs';
import {createAdoTestManagement, prepareExecutionPublication} from '../integrations/ado-management.mjs';
import {loadAdoConfiguration, adoId, adoGuid, workItemLinkId} from '../integrations/config.mjs';
import {fingerprint, keys, requireThat} from '../execution-core/data.mjs';
import {escapeHtml} from '../reporting/render.mjs';
import {renderBugNarrative} from './bug-narrative.mjs';
import {collectExecution, executionDefects, deliverableDefects, readVerifiedEvidence} from './report.mjs';
import {checkSourceRevisions} from './source.mjs';
import {EXECUTION_DOCUMENT, readBounded, writeJson, ownedFile} from './storage.mjs';
import {withTransition} from './lock.mjs';
import {consumerPath, packageRoot} from '../consumer-paths.mjs';
import {digest} from '../execution-core/data.mjs';
import {loadBugSchema, inspectBugFields, allowedFieldValue} from '../integrations/bug-fields.mjs';
import {discoverWorkItems} from '../integrations/ado-discovery.mjs';

const workItem = async (client, id) => {const item = await client.read(`wit/workitems/${adoId(id)}?$expand=relations&api-version=7.1`); requireThat(adoId(item.id) === adoId(id) && Number.isInteger(item.rev) && item.rev > 0 && item.fields, 'Bug readback has an invalid identity.'); await client.requireWorkItemProject(item); return item;};
const correlationTag = tag => /^harness-(?:defect|filing)-[a-f0-9]+$/i.test(tag);
function ledger(roots, executionId, name) {const path = ownedFile(roots, executionId, `delivery/${name}.json`), bounds = name === 'bugs' ? {...EXECUTION_DOCUMENT, compact: true} : {}; return {path, value: existsSync(path) ? readBounded(path, bounds.maximum) : {version: 1, entries: []}, save(value) {writeJson(path, value, bounds);}};}
export function acknowledgedId(roots, receipt, operation, key, requestFingerprint) {
  if (!receipt || !requestFingerprint) return undefined;
  requireThat(/^\.harness\/state\/integrations\/[a-f\d-]{36}\.jsonl$/i.test(receipt), 'Invalid delivery receipt location.');
  const file = consumerPath({packageRoot, ...roots}, receipt); if (!existsSync(file)) return undefined;
  const text = readFileSync(file, 'utf8'); requireThat(Buffer.byteLength(text) <= 2 * 1024 * 1024, 'Delivery receipt exceeds its bound.');
  // A final incomplete line can be left by a terminated write; earlier fsynced identities survive.
  const lines = text.split('\n').filter(Boolean), records = [];
  for (let index = 0; index < lines.length; index++) {try {records.push(JSON.parse(lines[index]));} catch {requireThat(index === lines.length - 1, 'Delivery receipt is corrupt.');}}
  return records.findLast(record => record.event === 'acknowledged' && record.operation === operation && record.requestFingerprint === requestFingerprint)?.identity?.[key];
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
export function draftMetadata(drafts, fp, defaults, title) {
  const input = drafts?.[fp] ?? {}; requireThat(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(key => ['file', 'title', 'severity', 'priority', 'notes', 'description', 'prerequisites', 'steps', 'expected', 'actual', 'fields', 'omitFields'].includes(key)) && (input.file === undefined || typeof input.file === 'boolean'), `Invalid bug draft: ${fp}.`);
  const generated = title.length <= 255 ? title : `${title.slice(0, 252).replace(/[\uD800-\uDBFF]$/, '')}...`;
  const output = {title: input.title ?? generated, ...(input.severity === undefined ? {} : {severity: input.severity}), ...(input.priority === undefined ? {} : {priority: input.priority}), notes: input.notes ?? ''};
  requireThat(typeof output.title === 'string' && output.title.trim() && output.title.length <= 255 && typeof output.notes === 'string' && output.notes.length <= 4000, `Invalid bug title or notes: ${fp}.`);
  for (const name of ['description', 'expected', 'actual']) if (input[name] !== undefined) {requireThat(typeof input[name] === 'string' && input[name].length <= 16000, `Invalid bug draft ${name}.`); output[name] = input[name];}
  for (const name of ['prerequisites', 'steps']) if (input[name] !== undefined) {requireThat(Array.isArray(input[name]) && input[name].length <= 100 && input[name].every(value => typeof value === 'string' && value.length <= 4000), `Invalid bug draft ${name}.`); output[name] = input[name];}
  if (input.fields !== undefined) {requireThat(input.fields && !Array.isArray(input.fields) && Object.entries(input.fields).length <= 100 && Object.entries(input.fields).every(([name, value]) => /^[A-Za-z][A-Za-z0-9_.]{0,149}$/.test(name) && ['string', 'number', 'boolean'].includes(typeof value) && String(value).length <= 16000), 'Invalid bug draft fields.'); output.fields = input.fields;}
  if (input.omitFields !== undefined) {requireThat(Array.isArray(input.omitFields) && input.omitFields.length <= 100 && input.omitFields.every(name => typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_.]{0,149}$/.test(name)), 'Invalid omitted bug fields.'); output.omitFields = input.omitFields;}
  return output;
}
export {allowedFieldValue} from '../integrations/bug-fields.mjs';
async function prepareBug(client, view, defect, revisions, metadata, drafts) {
  const defaults = client.configuration.bugs ?? {}, edited = draftMetadata(drafts, defect.fingerprint, defaults, defect.title), changed = revisions.find(item => item.caseId === defect.caseId);
  const fields = {...defaults.fields, ...(defaults.tags?.length ? {'System.Tags': defaults.tags.join('; ')} : {}), ...edited.fields, [metadata.mappings.title]: edited.title};
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
  for (const name of edited.omitFields ?? []) {requireThat(!Object.values(metadata.mappings).includes(name), 'Cannot omit bug narrative fields.'); delete fields[name];}
  requireThat(!String(fields['System.Tags'] ?? '').split(';').some(tag => correlationTag(tag.trim())), 'Harness correlation tags are not supported. Review the proposed Tags field.');
  const inspection = inspectBugFields(metadata, fields);
  if (!inspection.ready) {const details = inspection.problems.map(problem => problem.code === 'allowed-value' ? `Bug field ${problem.field} is outside its allowed values.` : ['unavailable', 'read-only'].includes(problem.code) ? `Bug field ${problem.field} is unavailable or read-only.` : problem.code === 'required' ? `Required bug field ${problem.field} needs a supplied value or configured default.` : `${problem.field}:${problem.code}`); const error = new Error(`Bug fields need review: ${details.join(' ')}`); error.fieldProblems = inspection.problems; error.fieldReview = inspection.review; throw error;}
  await validatePath(client, 'areas', fields['System.AreaPath']); await validatePath(client, 'iterations', fields['System.IterationPath']);
  const body = Object.entries(fields).map(([name, value]) => ({op: 'add', path: `/fields/${name}`, value}));
  if (defaults.storyLink && view.source.scope.kind === 'story') {await workItem(client, view.source.scope.storyId); body.push({op: 'add', path: '/relations/-', value: {rel: 'System.LinkTypes.Related', url: `${client.configuration.organizationUrl}/_apis/wit/workitems/${view.source.scope.storyId}`}});}
  await client.validateWorkItem(metadata.type, body, {fresh: true});
  const request = {route: `wit/workitems/$${encodeURIComponent(metadata.type)}?api-version=7.1`, method: 'POST', body};
  const fieldSpecifications = metadata.fields.filter(field => Object.hasOwn(fields, field.referenceName)).map(({referenceName, type, isIdentity}) => ({referenceName, type, isIdentity}));
  return {defect, type: metadata.type, request, fields, fieldSpecifications, schemaFingerprint: metadata.fingerprint, review: inspection.review, revisions: changed ?? null};
}

// Older standalone reports retained the approved fields and relation choices separately.
async function legacyBugOperation(client, row, view, preview) {
  const original = preview?.bugs.find(bug => bug.fingerprint === row.fingerprint);
  const {organizationUrl, project} = client.configuration;
  if (!original || original.request || !row.bodyFingerprint || !Array.isArray(original.duplicates?.closed) ||
      preview.destination.organizationUrl !== organizationUrl || preview.destination.project !== project || row.planHash !== fingerprint(original)) return;
  const related = id => ({op: 'add', path: '/relations/-', value: {rel: 'System.LinkTypes.Related', url: `${organizationUrl}/_apis/wit/workitems/${adoId(id)}`}});
  const body = [...Object.entries(original.fields).map(([name, value]) => ({op: 'add', path: `/fields/${name}`, value})), ...original.duplicates.closed.map(related)];
  const candidates = view.source.scope.kind === 'story' ? [body, [...body, related(view.source.scope.storyId)]] : [body];
  const route = `wit/workitems/$${encodeURIComponent(original.type)}?api-version=7.1`, method = 'POST';
  const exact = candidates.find(patch => fingerprint(patch) === row.bodyFingerprint && adoRequestFingerprint(route, method, patch) === row.requestFingerprint);
  if (!exact) return;
  const schema = await loadBugSchema(client);
  requireThat(schema.type === original.type, 'The approved legacy bug type differs from the configured type.');
  return {type: original.type, request: {route, method, body: exact}, legacyPreview: original, fieldSpecifications: schema.fields,
    organizationUrl, projectId: (await client.projectIdentity()).id, source: view.execution.freezeFingerprint};
}

async function verifyBug(client, operation, id, userConfirmed = false) {
  const item = await workItem(client, id), project = await client.projectIdentity();
  const verify = async target => {
    await client.requireWorkItemProject(target);
    requireThat(target.id === id && target.fields['System.WorkItemType']?.toLowerCase() === operation.type.toLowerCase(), 'Bug readback type or ID differs from the approved creation.');
    for (const row of operation.request.body) {
      if (row.path === '/relations/-') {
        const linkId = workItemLinkId(row.value.url, client.configuration.organizationUrl, project);
        requireThat(linkId && (target.relations ?? []).some(relation => relation.rel === row.value.rel && workItemLinkId(relation.url, client.configuration.organizationUrl, project) === linkId), 'Bug readback lacks an approved relationship.');
        continue;
      }
      const name = row.path.slice('/fields/'.length), value = row.value;
      const actual = target.fields[name], spec = operation.fieldSpecifications.find(field => field.referenceName === name);
      const matches = name === 'System.Tags' ? String(value).split(';').map(tag => tag.trim()).filter(tag => tag && !(operation.legacyPreview && correlationTag(tag))).every(tag => String(actual ?? '').split(';').map(tag => tag.trim()).includes(tag)) : /Path$/.test(name) ? typeof actual === 'string' && actual.toLowerCase() === String(value).toLowerCase() : spec && allowedFieldValue({...spec, allowedValues: [actual]}, value);
      requireThat(matches, `Bug field ${name} did not match its approved value at readback.`);
    }
  };
  await verify(item);
  if (userConfirmed && item.rev !== 1) {
    const original = await client.read(`wit/workitems/${id}/revisions/1?$expand=relations&api-version=7.1`);
    requireThat(original.rev === 1, 'The original bug revision could not be verified.');
    await verify(original);
  }
  return item;
}

const terminalBug = row => row && ['COMPLETED', 'DUPLICATE'].includes(row.state);
const attachmentUrl = (client, id) => `${client.configuration.organizationUrl}/_apis/wit/attachments/${id}`;
const hasAttachment = (item, url) => (item.relations ?? []).some(relation => relation.rel === 'AttachedFile' && relation.url === url);
function recoverUpload(roots, attachment) {
  if (attachment.id || !['DISPATCHING', 'UNCERTAIN'].includes(attachment.state)) return;
  const id = acknowledgedId(roots, attachment.receipt, 'upload-attachment', 'attachmentId', attachment.requestFingerprint);
  if (id) {
    requireThat(adoGuid(id), 'Attachment receipt has an invalid identity.');
    attachment.id = id;
  }
  attachment.state = id ? 'UPLOADED' : 'UNCERTAIN';
}
function confirmAttachment(attachment, url) {
  attachment.url = url;
  attachment.state = 'ATTACHED';
  delete attachment.linkState;
  delete attachment.linkRevision;
}
function bugOutcome(row) {
  const id = row.workItemId ?? null;
  const status = terminalBug(row) || row.verified ? 'confirmed' : id ? 'acknowledged' : row.state === 'INTENT' ? 'pending' : 'uncertain';
  return {fingerprint: row.fingerprint, state: row.state, id, ...(row.reason ? {reason: row.reason} : {}),
    ...(row.requestFingerprint ? {requestFingerprint: row.requestFingerprint} : {}),
    ...(row.confirmation ? {confirmation: row.confirmation} : {}),
    writes: [{operation: row.state === 'DUPLICATE' ? 'legacy-reference' : 'create-bug', status, adoId: id, ...(row.reason ? {reason: row.reason} : {})},
      ...(row.attachments ?? []).flatMap(attachment => [
        {operation: 'upload-attachment', status: attachment.id ? 'confirmed' : attachment.state === 'INTENT' ? 'pending' : 'uncertain', ...(attachment.id ? {attachmentId: attachment.id} : {sha256: attachment.sha256})},
        {operation: 'attach-evidence', status: attachment.state === 'ATTACHED' ? 'confirmed' : attachment.linkState === 'dispatching' ? 'uncertain' : 'pending', adoId: id, ...(attachment.id ? {attachmentId: attachment.id} : {sha256: attachment.sha256})}
      ])],
    ...(row.state === 'ATTACHMENTS_PENDING' ? {uncertainAttachments: (row.attachments ?? []).filter(item => item.state === 'UNCERTAIN').map(item => `${row.fingerprint}:${item.sha256}`)} : {})};
}

async function reconcileBugs(client, roots, executionId, view, options) {
  const journal = ledger(roots, executionId, 'bugs'), confirmation = options.confirmation;
  const project = await client.projectIdentity();
  if (confirmation !== undefined) {
    keys(confirmation, ['fingerprint', 'requestFingerprint', 'adoId'], 'bug recovery confirmation');
    const row = journal.value.entries.find(item => item.fingerprint === confirmation.fingerprint);
    requireThat(row && !row.workItemId && row.requestFingerprint && row.requestFingerprint === confirmation.requestFingerprint && ['UNCERTAIN', 'DISPATCHING'].includes(row.state), 'Confirm an unresolved bug creation for its exact request.');
    requireThat(!journal.value.entries.some(item => item.workItemId === adoId(confirmation.adoId)), 'The confirmed ADO ID is already bound to another bug.');
  }
  let candidateSearch;
  for (const row of journal.value.entries) {
    if (terminalBug(row) || row.state === 'INTENT') continue;
    try {
      const selected = confirmation?.fingerprint === row.fingerprint ? adoId(confirmation.adoId) : undefined;
      const acknowledged = acknowledgedId(roots, row.receipt, 'create-bug', 'workItemId', row.requestFingerprint);
      requireThat(!acknowledged || [row.workItemId, selected].every(id => !id || id === acknowledged), 'The selected or saved ADO ID conflicts with the acknowledged ID.');
      const known = row.workItemId || acknowledged;
      if (known) row.workItemId = adoId(known);
      const operation = row.operation ?? await legacyBugOperation(client, row, view, options.approvedPreview);
      requireThat(operation && operation.source === view.execution.freezeFingerprint && operation.organizationUrl === client.configuration.organizationUrl && operation.projectId === project.id && row.requestFingerprint === adoRequestFingerprint(operation.request.route, operation.request.method, operation.request.body), 'The original bug request or destination cannot be verified from the local journal. Preserve the existing receipt.');
      if (!known && !selected && !candidateSearch) {
        const title = operation.request.body.find(item => item.path === '/fields/System.Title')?.value;
        if (typeof title === 'string' && title.trim()) candidateSearch = {fingerprint: row.fingerprint, ...await discoverWorkItems(client, {queries: [[title.replace(/[\x00-\x1f]/g, ' ').slice(0, 100)]]}, {types: [operation.type], fields: {}})};
      }
      requireThat(known || selected, 'Creation ID is unknown. Confirm the ADO ID for this request before resuming.');
      const id = adoId(known || selected);
      const item = await verifyBug(client, operation, id, !known && Boolean(selected));
      row.workItemId = id;
      row.verified = true;
      if (!known && selected) row.confirmation = {source: 'user', adoId: id, requestFingerprint: row.requestFingerprint};
      for (const attachment of row.attachments ?? []) {
        if (attachment.state === 'ATTACHED') continue;
        recoverUpload(roots, attachment);
        if (!attachment.id) continue;
        const url = attachmentUrl(client, attachment.id);
        if (hasAttachment(item, url)) confirmAttachment(attachment, url);
      }
      row.state = row.state === 'ATTACHMENTS_PENDING' || row.attachments?.some(attachment => attachment.state !== 'ATTACHED') ? 'ATTACHMENTS_PENDING' : 'IDENTIFIED';
      delete row.reason;
    } catch (error) {row.state = 'UNCERTAIN'; row.reason = error.code ? 'Recovery read failed.' : error.message;}
    journal.save(journal.value);
  }
  return {mode: 'reconcile', executionId, bugs: journal.value.entries.map(bugOutcome), ...(candidateSearch ? {candidateSearch} : {})};
}
async function attachEvidence(client, roots, delivery, row, prepared, view, save, options) {
  row.attachments ??= [];
  const used = new Set(); let complete = true;
  const selected = view.reportAttachments ? view.reportAttachments.map(record => ({record, evidenceRoots: {runRoot: roots.projectRoot}})) : prepared.defect.occurrences.flatMap(occurrence => {
    const run = view.runs.find(item => item.runId === occurrence.runId && item.state === 'ASSESSED');
    return run.result.evidence.filter(record => record.kind === 'screenshot' && (record.identity.invocationId === prepared.defect.stepId || occurrence.evidenceIds.includes(record.id))).slice(0, 3).map(record => ({record, evidenceRoots: run.roots}));
  });
    for (const {record, evidenceRoots} of selected) {
      if (used.has(record.sha256) || record.bytes > (client.configuration.bugs?.maxAttachmentBytes ?? 2 * 1024 * 1024)) continue; used.add(record.sha256);
      let attachment = row.attachments.find(item => item.sha256 === record.sha256);
      if (!attachment) {
        attachment = {sha256: record.sha256, state: 'INTENT'}; row.attachments.push(attachment); save();
      }
      if (attachment.state === 'ATTACHED') continue;
      if (['DISPATCHING', 'UNCERTAIN'].includes(attachment.state)) {
        recoverUpload(roots, attachment);
        if (!attachment.id && options.recreate === `${row.fingerprint}:${attachment.sha256}`) {attachment.previousReceipts = [...(attachment.previousReceipts ?? []), attachment.receipt]; attachment.state = 'INTENT';}
        else if (!attachment.id) {complete = false; save(); continue;}
        save();
      }
      if (!attachment.id) {
        if (view.reportAttachments) consumerPath(roots, record.path);
        const bytes = readVerifiedEvidence(evidenceRoots, record), name = record.name ?? `${record.id}.png`;
        attachment.receipt = delivery.receipt; attachment.state = 'DISPATCHING'; attachment.requestFingerprint = adoRequestFingerprint(`wit/attachments?fileName=${encodeURIComponent(name)}&api-version=7.1`, 'POST', bytes, true); save();
        let result;
        try {result = await client.upload(delivery, bytes, name, {onIdentity(identity) {attachment.id = identity.attachmentId; attachment.state = 'UPLOADED'; save();}});}
        catch {attachment.state = attachment.id ? 'UPLOADED' : 'UNCERTAIN'; save(); return false;}
        requireThat(adoGuid(result.id), 'Attachment upload returned an invalid identity.'); attachment.id = result.id;
      }
      const url = attachmentUrl(client, attachment.id);
      const item = await workItem(client, row.workItemId);
      if (!hasAttachment(item, url)) {
        if (attachment.linkState === 'dispatching' && attachment.linkRevision !== item.rev) {complete = false; continue;}
        attachment.linkState = 'dispatching'; attachment.linkRevision = item.rev; save();
        await delivery.write('attach-evidence', `wit/workitems/${row.workItemId}?api-version=7.1`, [{op: 'test', path: '/rev', value: item.rev}, {op: 'add', path: '/relations/-', value: {rel: 'AttachedFile', url, attributes: {comment: 'Verified harness execution context'}}}], {patch: true});
      }
      const after = await workItem(client, row.workItemId); requireThat(hasAttachment(after, url), 'Bug attachment did not verify.'); confirmAttachment(attachment, url); save();
    }
  return complete;
}

async function fileBugs(client, roots, executionId, view, revisions, options) {
  if (options.reconcile) {
    requireThat(!options.execute && !options.recreate, 'Reconciliation is read-only in ADO. Resume publication separately.');
    return reconcileBugs(client, roots, executionId, view, options);
  }
  requireThat(options.confirmation === undefined, 'Use reconciliation to confirm a missing ADO ID.');
  const journal = ledger(roots, executionId, 'bugs'), save = () => journal.save(journal.value), drafts = options.draftValues ?? (options.drafts ? readBounded(options.drafts) : {}), {defects, skipped} = view.reportDefects ? {defects: view.reportDefects, skipped: []} : deliverableDefects(view, options.include), prepared = [], filed = [];
  if (options.referenceId !== undefined) {
    requireThat(view.reportDefects && !journal.value.entries.some(row => row.state !== 'INTENT'), 'Reconcile the original bug delivery before changing it to an existing reference.');
    const {type} = await bugMetadata(client), item = await workItem(client, options.referenceId);
    requireThat(item.fields['System.WorkItemType']?.toLowerCase() === type.toLowerCase(), 'Selected reference has a different work-item type.');
    const reference = {id: item.id, revision: item.rev, title: item.fields['System.Title'], state: item.fields['System.State'] ?? null};
    const planHash = fingerprint({executionId, reference, destination: client.configuration.organizationUrl, project: client.configuration.project});
    if (options.execute) requireThat(options.approvedPlan === planHash, 'Approved bug reference changed; review and approve the updated preview.');
    return {mode: options.execute ? 'execute' : 'dry-run', executionId, reference, planHash, bugs: options.execute ? [{state: 'REFERENCED', id: item.id, writes: []}] : []};
  }
  let metadata;
  for (const defect of defects) {
    if (drafts[defect.fingerprint]?.file === false) {skipped.push({fingerprint: defect.fingerprint, reason: 'draft-excluded'}); continue;}
    const row = journal.value.entries.find(item => item.fingerprint === defect.fingerprint);
    if (terminalBug(row)) {
      if (options.execute && options.reportHead) requireThat(row.operation?.reportHead ? row.operation.reportHead === options.reportHead : options.approvedPreview?.bugs[0] && row.planHash === fingerprint(options.approvedPreview.bugs[0]), 'Previously dispatched bug plan changed; the edited draft was not delivered.');
      filed.push(bugOutcome(row)); continue;
    }
    const legacy = row && row.state !== 'INTENT' && !row.operation && await legacyBugOperation(client, row, view, options.approvedPreview);
    if (legacy) {prepared.push({row, defect, ...legacy}); continue;}
    metadata ??= await bugMetadata(client);
    prepared.push({row, ...await prepareBug(client, view, defect, revisions, metadata, drafts)});
  }
  const attachments = view.reportAttachments ?? [];
  for (const record of attachments) {consumerPath(roots, record.path); const bytes = readVerifiedEvidence({runRoot: roots.projectRoot}, record); requireThat(bytes.length <= (client.configuration.bugs?.maxAttachmentBytes ?? 2 * 1024 * 1024), 'Bug evidence exceeds the destination attachment bound.');}
  const bugPreview = item => item.legacyPreview ?? {fingerprint: item.defect.fingerprint, type: item.type, fields: item.fields, request: item.request, review: item.review, schemaFingerprint: item.schemaFingerprint, revision: item.revisions, attachments};
  const preview = {mode: 'dry-run', executionId, revisions, skipped, bugs: prepared.map(bugPreview), ...(filed.length ? {completed: filed} : {})};
  preview.planHash = fingerprint({executionId, revisions, skipped, bugs: preview.bugs, destination: {organizationUrl: client.configuration.organizationUrl, project: client.configuration.project}});
  if (!options.execute) return preview;
  if (options.approvedPlan && prepared.length) requireThat(options.approvedPlan === preview.planHash, 'Approved bug preview changed; review and approve the updated plan.');
  for (const item of prepared) {
    const row = item.row ?? {fingerprint: item.defect.fingerprint, state: 'INTENT'};
    const {request} = item, requestFingerprint = adoRequestFingerprint(request.route, request.method, request.body), itemPlanHash = fingerprint(bugPreview(item));
    if (item.legacyPreview) requireThat(fingerprint(item.legacyPreview.attachments) === fingerprint(attachments), 'Approved legacy bug attachments changed.');
    if (row.state !== 'INTENT') {
      requireThat(row.requestFingerprint === requestFingerprint && row.planHash === itemPlanHash, 'Previously dispatched bug plan changed; reconcile the original report before another delivery.');
      if (!row.workItemId) {
        requireThat(!item.legacyPreview, 'A legacy bug request can only resume a known creation.');
        const acknowledged = acknowledgedId(roots, row.receipt, 'create-bug', 'workItemId', row.requestFingerprint);
        if (acknowledged) row.workItemId = adoId(acknowledged);
        else {
          row.state = 'UNCERTAIN'; row.reason = 'Creation ID is unknown. Reconcile with a user-confirmed ADO ID before resuming.'; save(); filed.push(bugOutcome(row)); break;
        }
      }
    }
    const project = await client.projectIdentity(), organizationUrl = client.configuration.organizationUrl, source = view.execution.freezeFingerprint;
    if (!item.row) journal.value.entries.push(row);
    if (row.operation) requireThat(row.operation.projectId === project.id && row.operation.organizationUrl === organizationUrl && row.operation.source === source, 'Bug request destination or source changed.');
    const delivery = client.delivery('bugs', true, source);
    try {
      if (!row.workItemId) {
        Object.assign(row, {state: 'DISPATCHING', planHash: itemPlanHash, requestFingerprint, receipt: delivery.receipt,
          operation: {type: item.type, request, fieldSpecifications: item.fieldSpecifications, organizationUrl, projectId: project.id, source, ...(options.reportHead ? {reportHead: options.reportHead} : {})}});
        save();
        try {
          const created = await delivery.write('create-bug', request.route, request.body, {method: request.method, patch: true, onIdentity(identity) {row.workItemId = adoId(identity.workItemId); row.state = 'IDENTIFIED'; save();}});
          row.workItemId = adoId(created.id); row.state = 'IDENTIFIED'; save();
        } catch (error) {
          if (error.delivery?.effect === 'not-executed') {row.state = 'INTENT'; save(); throw error;}
          row.state = 'UNCERTAIN'; row.reason = 'Creation was not verified. Reconcile its local receipt before resuming.'; save(); filed.push(bugOutcome(row)); break;
        }
      }
      await verifyBug(client, item, row.workItemId);
      row.verified = true; row.state = 'ATTACHMENTS_PENDING'; delete row.reason; save();
      const attached = await attachEvidence(client, roots, delivery, row, item, view, save, options);
      if (attached) {delivery.verified({workItemId: row.workItemId}); delivery.finish();}
      row.state = attached ? 'COMPLETED' : 'ATTACHMENTS_PENDING'; save(); filed.push(bugOutcome(row));
    } catch (error) {
      if (row.state === 'IDENTIFIED') row.state = 'UNCERTAIN';
      row.reason = error.message; save(); throw error;
    }
  }
  const order = new Map(defects.map((item, index) => [item.fingerprint, index]));
  return {...preview, mode: 'execute', bugs: filed.sort((a, b) => order.get(a.fingerprint) - order.get(b.fingerprint))};
}
/** Shared filing/attachment journal; reported drafts carry no fabricated execution verdicts. */
export async function deliverBugReports(client, roots, reportId, view, options = {}) {
  requireThat(Array.isArray(view.reportDefects) && view.reportDefects.length === 1 && Array.isArray(view.reportAttachments), 'Invalid reported bug projection.');
  return fileBugs(client, roots, reportId, view, [], options);
}
async function reconcilePublication(client, roots, row, planId) {
  if (!row.runId) {const acknowledged = acknowledgedId(roots, row.receipt, 'create-run', 'runId', row.requestFingerprint); if (acknowledged) row.runId = acknowledged;} if (row.runId) {row.state = 'IDENTIFIED'; return;}
  const runs = await client.list(`test/runs?planId=${adoId(planId)}&includeRunDetails=true&api-version=7.1`, 'offset'), matches = runs.filter(run => run.name === row.name && adoId(run.plan?.id) === planId);
  requireThat(matches.length <= 1, 'Publication identity matched multiple runs; reconcile manually.');
  if (matches.length) {row.runId = adoId(matches[0].id); row.state = 'IDENTIFIED';} else row.state = 'UNCERTAIN';
}
export function publicationIndexes(view, points, counters = {}, {bugs = [], revisions = []} = {}) {
  const index = {points: new Map(), scenarios: new Map(), caseByScenario: new Map(), runs: new Map(), defectCases: new Map(), bugIds: new Map(), revisions: new Map(), legacyCases: new Set()};
  const selected = new Map(view.scenarios.map(item => [item.id, item.selectedRunId]));
  const append = (map, key, value) => {if (!map.has(key)) map.set(key, []); map.get(key).push(value);};
  for (const point of points) {append(index.points, adoId(point.testCase.id), point); counters.points = (counters.points ?? 0) + 1;}
  for (const scenario of view.scenarios) {append(index.scenarios, scenario.caseId, scenario); index.caseByScenario.set(scenario.id, scenario.caseId); counters.scenarios = (counters.scenarios ?? 0) + 1;}
  for (const run of view.runs) {
    index.runs.set(run.runId, run); counters.runs = (counters.runs ?? 0) + 1;
    if (run.state === 'ASSESSED' && (selected.get(run.scenarioId) === run.runId || run.result?.status === 'FAIL') && run.conditions.some(item => item.family === 'browser' && item.legacy)) index.legacyCases.add(index.caseByScenario.get(run.scenarioId));
  }
  counters.defectPasses = (counters.defectPasses ?? 0) + 1;
  for (const defect of executionDefects(view)) index.defectCases.set(defect.fingerprint, defect.caseId);
  for (const row of bugs) {counters.bugs = (counters.bugs ?? 0) + 1; if (row.workItemId && index.defectCases.has(row.fingerprint)) append(index.bugIds, index.defectCases.get(row.fingerprint), row.workItemId);}
  for (const change of revisions) index.revisions.set(change.caseId, change);
  return index;
}
async function publishResults(client, roots, executionId, view, revisions, options) {
  requireThat(view.source.scope.kind === 'suite', 'Story executions file bugs; publishing results requires suite scope.');
  const {planId, suiteId} = view.source.scope, journal = ledger(roots, executionId, 'publications'), save = () => journal.save(journal.value), points = await client.list(`test/Plans/${planId}/Suites/${suiteId}/points?api-version=7.1`, 'offset'), suppliedPoints = options['point-map'] ? readBounded(options['point-map']) : {};
  let pointIds = {}, omitted = [], row = options['new-run'] ? undefined : journal.value.entries.at(-1);
  const bugJournal = ledger(roots, executionId, 'bugs'), index = publicationIndexes(view, points, {}, {bugs: bugJournal.value.entries, revisions});
  requireThat(suppliedPoints && typeof suppliedPoints === 'object' && !Array.isArray(suppliedPoints) && Object.keys(suppliedPoints).every(caseId => view.source.cases.some(tc => String(tc.id) === caseId)), 'Point selections contain cases outside captured scope.');
  for (const pointId of Object.values(suppliedPoints)) adoId(pointId);
  const eligible = view.source.cases.filter(tc => {
    if (index.legacyCases.has(tc.id)) {omitted.push({caseId: tc.id, reason: 'legacy-evidence'}); return false;}
    if (!options['include-changed'] && index.revisions.has(tc.id)) {omitted.push({caseId: tc.id, reason: 'source-changed'}); return false;}
    const candidates = index.points.get(tc.id) ?? [], selected = Object.hasOwn(suppliedPoints, tc.id) ? candidates.filter(point => adoId(point.id) === adoId(suppliedPoints[tc.id])) : candidates;
    if (!selected.length) {omitted.push({caseId: tc.id, reason: 'no-test-point'}); return false;} requireThat(selected.length === 1, 'Ambiguous test point; provide --point-map.');
    if (!(index.scenarios.get(tc.id) ?? []).some(scenario => scenario.selectedRunId && (scenario.state === 'ASSESSED' || scenario.status === 'FAIL'))) {omitted.push({caseId: tc.id, reason: 'no-verdict'}); return false;}
    pointIds[tc.id] = adoId(selected[0].id); return true;
  });
  if (!eligible.length && !row?.inputs) return {mode: options.execute ? 'no-op' : 'dry-run', executionId, cases: [], omitted, revisions};
  const eligibleIds = new Set(eligible.map(tc => tc.id)), selectedRuns = new Set(view.scenarios.map(item => item.selectedRunId));
  let scope = view.source.scenarios.filter(scenario => eligibleIds.has(scenario.caseId)), selected = view.runs.filter(run => run.state === 'ASSESSED' && eligibleIds.has(index.caseByScenario.get(run.scenarioId)) && (run.result.status === 'FAIL' || selectedRuns.has(run.runId))), comments = {};
  for (const tc of eligible) {
    const scenarios = index.scenarios.get(tc.id) ?? [], methods = scenarios.reduce((sum, scenario) => ({checked: sum.checked + scenario.methods.checked, observed: sum.observed + scenario.methods.observed, mixed: sum.mixed + scenario.methods.mixed}), {checked: 0, observed: 0, mixed: 0}), bugIds = index.bugIds.get(tc.id) ?? [], current = index.revisions.get(tc.id);
    comments[tc.id] = `Harness manual; checked=${methods.checked}; observed=${methods.observed}; mixed=${methods.mixed}; bugs=${bugIds.join(',') || 'none'}; revision=${tc.rev}/${current?.current ?? tc.rev}${current ? '; SOURCE CHANGED' : ''}`.slice(0, 400);
  }
  let inputs = {scenarioIds: scope.map(item => item.id), runIds: selected.map(item => item.runId), comments, pointIds, omitted, revisions};
  if (row?.inputs) {
    inputs = row.inputs; const scenarioIds = new Set(inputs.scenarioIds);
    scope = view.source.scenarios.filter(item => scenarioIds.has(item.id)); selected = inputs.runIds.map(id => index.runs.get(id));
    requireThat(scope.length === scenarioIds.size && selected.every(item => item?.state === 'ASSESSED'), 'Stored publication inputs are missing or no longer assessable.');
    requireThat(scope.every(item => !index.legacyCases.has(item.caseId)), 'Legacy browser evidence cannot resume publication.');
    comments = inputs.comments; pointIds = inputs.pointIds; omitted = inputs.omitted;
  }
  const publication = prepareExecutionPublication(selected.map(item => item.result), scope, comments), management = createAdoTestManagement(client), preview = await management.publish({publication, planId, suiteId, pointIds, points});
  if (!options.execute) return {...preview, executionId, omitted, revisions};
  if (row && !['INTENT', 'COMPLETED'].includes(row.state)) {await reconcilePublication(client, roots, row, planId); save();}
  requireThat(!row || row.state !== 'UNCERTAIN' || options['new-run'], 'UNCERTAIN publication; reconcile its exact run name or use --new-run.');
  const publicationFingerprint = fingerprint(publication);
  if (!row || options['new-run']) {
    const publicationId = randomUUID(), number = journal.value.entries.length + 1; row = {publicationId, number, name: `Harness manual execution ${executionId} p${number}-${publicationId.slice(0, 6)}`, state: 'INTENT', publicationFingerprint, inputs};
    row.requestFingerprint = adoRequestFingerprint('test/runs?api-version=7.1', 'POST', {name: row.name, plan: {id: String(planId)}, pointIds: publication.map(item => pointIds[item.caseId]), automated: false}); journal.value.entries.push(row); save();
  }
  requireThat(row.publicationFingerprint === publicationFingerprint, 'Publication content changed; use --new-run for a new assessed scope.');
  if (row.state === 'COMPLETED') return {mode: 'resumed', runId: row.runId, executionId, omitted, revisions};
  const result = await management.publish({publication, planId, suiteId, pointIds, points, execute: true, name: row.name, ...(row.runId ? {resumeRunId: row.runId} : {}), onReceipt(receipt) {row.receipt = receipt; if (!row.runId) row.state = 'DISPATCHING'; save();}, onIdentity(identity) {row.runId = adoId(identity.runId); row.state = 'IDENTIFIED'; save();}});
  row.runId = result.runId; row.state = 'COMPLETED'; save(); return {...result, executionId, omitted, revisions};
}
export async function deliverExecution(roots, executionId, command, options = {}, dependencies = {}) {
  return withTransition(roots, () => deliverOwned(roots, executionId, command, options, dependencies), {key: `delivery-${executionId}`, attempts: 1, ...(dependencies.inventory ? {inventory: dependencies.inventory} : {})});
}
async function deliverOwned(roots, executionId, command, options, {client: provided} = {}) {
  const view = collectExecution(roots, executionId); requireThat(!view.integrityFailures.length, `Integrity failure blocks delivery; rerun ${view.integrityFailures.join(', ')}.`);
  const client = provided ?? createAdoClient({...loadAdoConfiguration(roots), roots});
  requireThat(client.configuration.organizationUrl === view.source.organizationUrl && client.configuration.project.toLowerCase() === view.source.project.toLowerCase(), 'ADO destination differs from captured source.');
  if (command === 'file-bugs' && options.reconcile) return fileBugs(client, roots, executionId, view, [], options);
  const revisions = await checkSourceRevisions(view.source, createAdoTestSource(client));
  writeJson(ownedFile(roots, executionId, 'delivery/revisions.json'), {version: 1, sourceFingerprint: view.execution.sourceFingerprint, checkedAt: new Date().toISOString(), revisions});
  return command === 'file-bugs' ? fileBugs(client, roots, executionId, view, revisions, options) : publishResults(client, roots, executionId, view, revisions, options);
}
