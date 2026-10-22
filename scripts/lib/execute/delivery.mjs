import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createAdoClient, adoRequestFingerprint} from '../integrations/ado-client.mjs';
import {createAdoTestSource} from '../integrations/ado-source.mjs';
import {createAdoTestManagement, prepareExecutionPublication} from '../integrations/ado-management.mjs';
import {loadAdoConfiguration, adoId, adoGuid} from '../integrations/config.mjs';
import {fingerprint, requireThat} from '../execution-core/data.mjs';
import {escapeHtml} from '../reporting/render.mjs';
import {collectExecution, executionDefects, deliverableDefects, readVerifiedEvidence} from './report.mjs';
import {checkSourceRevisions} from './source.mjs';
import {readBounded, writeJson, ownedFile} from './storage.mjs';
import {withTransition} from './lock.mjs';
import {consumerPath} from '../consumer-paths.mjs';
import {digest} from '../execution-core/data.mjs';
import {loadBugSchema, inspectBugFields, allowedFieldValue} from '../integrations/bug-fields.mjs';

const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const wiqlTag = tag => `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.Tags] CONTAINS ${quote(tag)}`;
const workItem = async (client, id) => {const item = await client.read(`wit/workitems/${adoId(id)}?$expand=relations&api-version=7.1`); requireThat(adoId(item.id) === adoId(id) && Number.isInteger(item.rev) && item.fields, 'Bug readback has an invalid identity.'); await client.requireWorkItemProject(item); return item;};
const tagsOf = item => String(item.fields['System.Tags'] ?? '').split(';').map(tag => tag.trim()).filter(Boolean);
function ledger(roots, executionId, name) {const path = ownedFile(roots, executionId, `delivery/${name}.json`); return {path, value: existsSync(path) ? readBounded(path) : {version: 1, entries: []}, save(value) {writeJson(path, value);}};}
export function acknowledgedId(roots, receipt, operation, key, requestFingerprint) {
  if (!receipt || !requestFingerprint) return undefined;
  requireThat(/^\.harness\/state\/integrations\/[a-f\d-]{36}\.jsonl$/i.test(receipt), 'Invalid delivery receipt location.');
  const file = join(roots.projectRoot, receipt); if (!existsSync(file)) return undefined;
  const text = readFileSync(file, 'utf8'); requireThat(Buffer.byteLength(text) <= 2 * 1024 * 1024, 'Delivery receipt exceeds its bound.');
  // A final incomplete line can be left by a terminated write; earlier fsynced identities survive.
  const lines = text.split('\n').filter(Boolean), records = [];
  for (let index = 0; index < lines.length; index++) {try {records.push(JSON.parse(lines[index]));} catch {requireThat(index === lines.length - 1, 'Delivery receipt is corrupt.');}}
  return records.findLast(record => record.event === 'acknowledged' && record.operation === operation && record.requestFingerprint === requestFingerprint)?.identity?.[key];
}
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
async function prepareBug(client, view, defect, revisions, metadata, drafts, intent) {
  const defaults = client.configuration.bugs ?? {}, edited = draftMetadata(drafts, defect.fingerprint, defaults, defect.title), sourceCase = view.source.cases.find(item => item.id === defect.caseId), changed = revisions.find(item => item.caseId === defect.caseId);
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
  const h = escapeHtml, sourceScenario = view.source.scenarios.find(item => item.id === defect.scenarioId);
  const originalSteps = sourceScenario?.steps.map(step => `${step.position}. ${step.action}\nExpected: ${step.expected.join('; ')}`).join('\n') ?? '';
  const narrative = view.reportContext ? `<pre>${h(JSON.stringify(view.reportContext))}</pre>` : `<p>Harness manual execution ${h(view.execution.id)}; case ${defect.caseId}; executed revision ${sourceCase.rev}; current revision ${changed?.current ?? sourceCase.rev}${changed ? '; SOURCE CHANGED' : ''}.</p><p>${h(defect.status)} (${h(defect.method)})</p>`;
  const content = `${narrative}<p>${h(edited.description ?? '')}</p><h3>Prerequisites</h3><pre>${h((edited.prerequisites ?? []).join('\n'))}</pre><h3>Steps to reproduce</h3><pre>${h(edited.steps?.map((step, index) => `${index + 1}. ${step}`).join('\n') ?? originalSteps)}</pre><h3>Expected</h3><pre>${h(edited.expected ?? originalSteps)}</pre><h3>Actual</h3><pre>${h(edited.actual ?? JSON.stringify(defect.occurrences))}</pre><p>${h(edited.notes)}</p>${changed ? `<pre>${h(JSON.stringify(changed))}</pre>` : ''}`;
  requireThat(metadata.mappings.reproSteps || metadata.mappings.description, 'Configure an available bug narrative field mapping.');
  fields[metadata.mappings.reproSteps ?? metadata.mappings.description] = content;
  if (metadata.mappings.description && metadata.mappings.description !== metadata.mappings.reproSteps) fields[metadata.mappings.description] = content;
  for (const name of ['expected', 'actual']) if (metadata.mappings[name] && edited[name] !== undefined) {const spec = metadata.fields.find(field => field.referenceName === metadata.mappings[name]); fields[metadata.mappings[name]] = /^html$/i.test(spec?.type ?? '') ? `<pre>${h(edited[name])}</pre>` : edited[name];}
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
async function reconcileBug(client, roots, row) {
  if (!row.workItemId) {const acknowledged = acknowledgedId(roots, row.receipt, 'create-bug', 'workItemId', row.requestFingerprint); if (acknowledged) row.workItemId = acknowledged;}
  if (row.workItemId) {const item = await workItem(client, row.workItemId); requireThat(tagsOf(item).includes(`harness-filing-${row.filingId.slice(0, 8)}`), 'Acknowledged bug has different filing identity.'); row.state = 'IDENTIFIED'; return;}
  const found = await taggedItems(client, `harness-filing-${row.filingId.slice(0, 8)}`); requireThat(found.length <= 1, 'Filing identity matched multiple bugs; reconcile manually.');
  if (found.length) {row.workItemId = found[0].id; row.state = 'IDENTIFIED';} else row.state = 'UNCERTAIN';
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
      if (['DISPATCHING', 'UNCERTAIN'].includes(attachment.state)) {
        const acknowledged = acknowledgedId(roots, attachment.receipt, 'upload-attachment', 'attachmentId', attachment.requestFingerprint);
        if (acknowledged) {attachment.id = acknowledged; attachment.state = 'UPLOADED';}
        else if (options.recreate === `${row.fingerprint}:${attachment.sha256}`) {attachment.previousReceipts = [...(attachment.previousReceipts ?? []), attachment.receipt]; attachment.state = 'INTENT';}
        else {attachment.state = 'UNCERTAIN'; complete = false; save(); continue;}
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
      attachment.url = `${client.configuration.organizationUrl}/_apis/wit/attachments/${attachment.id}`;
      const item = await workItem(client, row.workItemId);
      if (!(item.relations ?? []).some(relation => relation.rel === 'AttachedFile' && relation.url === attachment.url)) await delivery.write('attach-evidence', `wit/workitems/${row.workItemId}?api-version=7.1`, [{op: 'test', path: '/rev', value: item.rev}, {op: 'add', path: '/relations/-', value: {rel: 'AttachedFile', url: attachment.url, attributes: {comment: 'Verified harness execution context'}}}], {patch: true});
      const after = await workItem(client, row.workItemId); requireThat((after.relations ?? []).some(relation => relation.rel === 'AttachedFile' && relation.url === attachment.url), 'Bug attachment did not verify.'); attachment.state = 'ATTACHED'; save();
    }
  return complete;
}

async function fileBugs(client, roots, executionId, view, revisions, options) {
  const journal = ledger(roots, executionId, 'bugs'), save = () => journal.save(journal.value), metadata = await bugMetadata(client), drafts = options.draftValues ?? (options.drafts ? readBounded(options.drafts) : {}), {defects, skipped} = view.reportDefects ? {defects: view.reportDefects, skipped: []} : deliverableDefects(view, options.include), prepared = [];
  // Draft IDs are stable within this invocation; preview never persists delivery intent.
  for (const defect of defects) {
    if (drafts[defect.fingerprint]?.file === false) {skipped.push({fingerprint: defect.fingerprint, reason: 'draft-excluded'}); continue;}
    let row = journal.value.entries.find(item => item.fingerprint === defect.fingerprint);
    const intent = row ?? {fingerprint: defect.fingerprint, filingId: options.filingIds?.[defect.fingerprint] ?? randomUUID(), state: 'INTENT'};
    prepared.push({row, intent, ...await prepareBug(client, view, defect, revisions, metadata, drafts, intent)});
  }
  const attachments = view.reportAttachments ?? [];
  for (const record of attachments) {consumerPath(roots, record.path); const bytes = readVerifiedEvidence({runRoot: roots.projectRoot}, record); requireThat(bytes.length <= (client.configuration.bugs?.maxAttachmentBytes ?? 2 * 1024 * 1024), 'Bug evidence exceeds the destination attachment bound.');}
  const bugPreview = item => ({fingerprint: item.defect.fingerprint, type: item.type, fields: item.fields, review: item.review, schemaFingerprint: item.schemaFingerprint, duplicates: item.duplicates, revision: item.revisions, attachments});
  const preview = {mode: 'dry-run', executionId, revisions, skipped, bugs: prepared.map(bugPreview)};
  const planHash = () => fingerprint({executionId, revisions, skipped, bugs: preview.bugs, destination: {organizationUrl: client.configuration.organizationUrl, project: client.configuration.project}});
  preview.planHash = planHash();
  if (!options.execute) return preview;
  if (options.approvedPlan) requireThat(options.approvedPlan === preview.planHash, 'Approved bug preview changed; review and approve the updated plan.');
  const filed = [];
  for (const item of prepared) {
    let row = item.row;
    let itemPlanHash = fingerprint(preview.bugs.find(bug => bug.fingerprint === item.defect.fingerprint));
    requireThat(!row?.bodyFingerprint || row.bodyFingerprint === fingerprint(item.body), 'Previously dispatched bug content changed; reconcile its original plan before a new report.');
    requireThat(!row?.planHash || row.planHash === itemPlanHash, 'Previously dispatched bug plan changed; reconcile the original report before another delivery.');
    if (row?.state === 'COMPLETED' || row?.state === 'DUPLICATE') {filed.push({fingerprint: row.fingerprint, state: row.state, id: row.workItemId ?? null}); continue;}
    if (row && !['INTENT', 'IDENTIFIED'].includes(row.state)) {await reconcileBug(client, roots, row); save();}
    if (row?.state === 'UNCERTAIN') {
      requireThat(options.recreate === row.fingerprint, `UNCERTAIN: ${row.fingerprint}; reconcile its filing tag or use --recreate ${row.fingerprint}.`);
      requireThat(!options.approvedPlan, 'Recreation changes the filing identity; prepare and approve a new preview before dispatch.');
      const history = [...(row.history ?? []), {...row, history: []}]; row = {fingerprint: row.fingerprint, filingId: randomUUID(), state: 'INTENT', history};
      journal.value.entries = journal.value.entries.filter(entry => entry.fingerprint !== row.fingerprint); journal.value.entries.push(row); save();
      Object.assign(item, await prepareBug(client, view, item.defect, revisions, metadata, drafts, row));
      const index = preview.bugs.findIndex(bug => bug.fingerprint === item.defect.fingerprint);
      preview.bugs[index] = bugPreview(item); itemPlanHash = fingerprint(preview.bugs[index]); preview.planHash = planHash();
    }
    if (!row) {row = item.intent; journal.value.entries.push(row);}
    row.planHash ??= itemPlanHash; save();
    if (!row.workItemId && item.duplicates.open.length) {row.state = 'DUPLICATE'; row.workItemId = item.duplicates.open[0]; save(); filed.push({fingerprint: row.fingerprint, state: row.state, id: row.workItemId}); continue;}
    const delivery = client.delivery('bugs', true, view.execution.freezeFingerprint); row.receipt = delivery.receipt; save();
    try {
      if (!row.workItemId) {
        row.state = 'DISPATCHING'; row.bodyFingerprint = fingerprint(item.body); row.requestFingerprint = adoRequestFingerprint(`wit/workitems/$${encodeURIComponent(item.type)}?api-version=7.1`, 'POST', item.body); save();
        const created = await delivery.write('create-bug', `wit/workitems/$${encodeURIComponent(item.type)}?api-version=7.1`, item.body, {method: 'POST', patch: true, onIdentity(identity) {row.workItemId = adoId(identity.workItemId); row.state = 'IDENTIFIED'; save();}});
        row.workItemId = adoId(created.id); row.state = 'IDENTIFIED'; save();
      }
      const after = await workItem(client, row.workItemId); requireThat(tagsOf(after).includes(row.fingerprint) && tagsOf(after).includes(`harness-filing-${row.filingId.slice(0, 8)}`), 'Bug creation did not verify its fingerprint and filing identity.');
      for (const [name, value] of Object.entries(item.fields)) {
        const actual = after.fields[name], spec = item.fieldSpecifications.find(field => field.referenceName === name);
        const matches = name === 'System.Tags' ? String(value).split(';').map(tag => tag.trim()).filter(Boolean).every(tag => tagsOf(after).includes(tag)) : /Path$/.test(name) ? typeof actual === 'string' && actual.toLowerCase() === String(value).toLowerCase() : allowedFieldValue({...spec, allowedValues: [actual]}, value);
        requireThat(matches, `Bug field ${name} did not match its approved value at readback.`);
      }
      const attached = await attachEvidence(client, roots, delivery, row, item, view, save, options);
      if (attached) {delivery.verified({workItemId: row.workItemId}); delivery.finish();}
      row.state = attached ? 'COMPLETED' : 'ATTACHMENTS_PENDING'; save(); filed.push({fingerprint: row.fingerprint, state: row.state, id: row.workItemId, ...(attached ? {} : {uncertainAttachments: row.attachments.filter(item => item.state === 'UNCERTAIN').map(item => `${row.fingerprint}:${item.sha256}`)})});
    } catch (error) {save(); throw error;}
  }
  return {...preview, mode: 'execute', bugs: filed};
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
  const revisions = await checkSourceRevisions(view.source, createAdoTestSource(client));
  writeJson(ownedFile(roots, executionId, 'delivery/revisions.json'), {version: 1, sourceFingerprint: view.execution.sourceFingerprint, checkedAt: new Date().toISOString(), revisions});
  return command === 'file-bugs' ? fileBugs(client, roots, executionId, view, revisions, options) : publishResults(client, roots, executionId, view, revisions, options);
}
