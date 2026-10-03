import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createAdoClient} from '../integrations/ado-client.mjs';
import {createAdoTestSource} from '../integrations/ado-source.mjs';
import {createAdoTestManagement, prepareExecutionPublication} from '../integrations/ado-management.mjs';
import {loadAdoConfiguration, adoId, adoGuid} from '../integrations/config.mjs';
import {fingerprint, requireThat} from '../execution-core/data.mjs';
import {escapeHtml} from '../reporting/render.mjs';
import {collectExecution, executionDefects} from './report.mjs';
import {checkSourceRevisions} from './source.mjs';
import {readBounded, writeJson, ownedFile} from './storage.mjs';
import {withTransition} from './lock.mjs';

const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const wiqlTag = tag => `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.Tags] CONTAINS ${quote(tag)}`;
const workItem = async (client, id) => {const item = await client.read(`wit/workitems/${adoId(id)}?$expand=relations&api-version=7.1`); requireThat(adoId(item.id) === adoId(id) && Number.isInteger(item.rev) && item.fields, 'Bug readback has an invalid identity.'); await client.requireWorkItemProject(item); return item;};
const tagsOf = item => String(item.fields['System.Tags'] ?? '').split(';').map(tag => tag.trim()).filter(Boolean);
function ledger(roots, executionId, name) {const path = ownedFile(roots, executionId, `delivery/${name}.json`); return {path, value: existsSync(path) ? readBounded(path) : {version: 1, entries: []}, save(value) {writeJson(path, value);}};}
function acknowledgedId(roots, receipt, operation, key) {
  if (!receipt) return undefined;
  requireThat(/^\.harness\/state\/integrations\/[a-f\d-]{36}\.jsonl$/i.test(receipt), 'Invalid delivery receipt location.');
  const file = join(roots.projectRoot, receipt); if (!existsSync(file)) return undefined;
  const text = readFileSync(file, 'utf8'); requireThat(Buffer.byteLength(text) <= 2 * 1024 * 1024, 'Delivery receipt exceeds its bound.');
  // A final incomplete line can be left by a terminated write; earlier fsynced identities survive.
  const lines = text.split('\n').filter(Boolean), records = [];
  for (let index = 0; index < lines.length; index++) {try {records.push(JSON.parse(lines[index]));} catch {requireThat(index === lines.length - 1, 'Delivery receipt is corrupt.');}}
  return records.findLast(record => record.event === 'acknowledged' && record.operation === operation)?.identity?.[key];
}
async function taggedItems(client, tag) {
  const result = await client.wiql(wiqlTag(tag)); requireThat(Array.isArray(result.workItems) && result.workItems.length <= 100, 'Bug duplicate query exceeded its bounded scope.');
  const items = []; for (const item of result.workItems) {const found = await workItem(client, item.id); if (tagsOf(found).includes(tag)) items.push(found);} return items;
}
async function bugMetadata(client) {
  const category = await client.cachedRead('wit/workitemtypecategories/Microsoft.BugCategory?api-version=7.1');
  requireThat(String(category.referenceName).toLowerCase() === 'microsoft.bugcategory' && Array.isArray(category.workItemTypes) && category.workItemTypes.length, 'ADO Bug category is unavailable.');
  const type = category.defaultWorkItemType?.name ?? category.workItemTypes[0].name;
  requireThat(typeof type === 'string' && type.trim(), 'ADO Bug category has no work-item type.');
  const fields = await client.cachedRead(`wit/workitemtypes/${encodeURIComponent(type)}/fields?$expand=All&api-version=7.1`), states = await client.cachedRead(`wit/workitemtypes/${encodeURIComponent(type)}/states?api-version=7.1`);
  requireThat(Array.isArray(fields.value) && Array.isArray(states.value), 'ADO Bug metadata is incomplete.'); return {type, fields: fields.value, states: states.value};
}
async function validatePath(client, group, path) {
  if (!path) return;
  const project = await client.projectIdentity(), parts = path.split('\\'); requireThat(parts[0].toLowerCase() === project.name.toLowerCase(), 'Bug path belongs to another project.');
  const suffix = parts.slice(1).map(encodeURIComponent).join('/'), found = await client.cachedRead(`wit/classificationnodes/${group}${suffix ? `/${suffix}` : ''}?api-version=7.1`);
  requireThat(typeof found.path === 'string' && found.path.replace(/^\\/, '').toLowerCase() === path.toLowerCase(), 'ADO area/iteration path did not match.');
}
function draftMetadata(drafts, fp, defaults, title) {
  const input = drafts?.[fp] ?? {}; requireThat(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(key => ['title', 'severity', 'priority', 'notes'].includes(key)), 'Only bug title, severity, priority and notes are editable.');
  const output = {title: input.title ?? title, ...(input.severity === undefined ? {} : {severity: input.severity}), ...(input.priority === undefined ? {} : {priority: input.priority}), notes: input.notes ?? ''};
  requireThat(typeof output.title === 'string' && output.title.trim() && output.title.length <= 255 && typeof output.notes === 'string' && output.notes.length <= 4000, 'Invalid bug title or notes.'); return output;
}
async function prepareBug(client, view, defect, revisions, metadata, drafts, intent) {
  const defaults = client.configuration.bugs ?? {}, edited = draftMetadata(drafts, defect.fingerprint, defaults, defect.title), sourceCase = view.source.cases.find(item => item.id === defect.caseId), changed = revisions.find(item => item.caseId === defect.caseId);
  const fields = {...defaults.fields, 'System.Title': edited.title, 'System.Tags': [...(defaults.tags ?? []), defect.fingerprint, `harness-filing-${intent.filingId.slice(0, 8)}`].join('; ')};
  let paths = {};
  if (defaults.pathsFrom) {
    requireThat(defaults.pathsFrom !== 'story' || view.source.scope.kind === 'story', 'pathsFrom:story requires story scope.');
    const parent = await workItem(client, defaults.pathsFrom === 'story' ? view.source.scope.storyId : defect.caseId); paths = parent.fields;
  }
  fields['System.AreaPath'] = defaults.areaPath ?? paths['System.AreaPath'] ?? (await client.projectIdentity()).name;
  fields['System.IterationPath'] = defaults.iterationPath ?? paths['System.IterationPath'] ?? (await client.projectIdentity()).name;
  if (defaults.assignedTo) fields['System.AssignedTo'] = defaults.assignedTo;
  if (edited.priority !== undefined) fields['Microsoft.VSTS.Common.Priority'] = edited.priority;
  if (edited.severity !== undefined) fields['Microsoft.VSTS.Common.Severity'] = edited.severity;
  const h = escapeHtml, sourceScenario = view.source.scenarios.find(item => item.id === defect.scenarioId);
  fields['Microsoft.VSTS.TCM.ReproSteps'] = `<p>Harness manual execution ${h(view.execution.id)}; case ${defect.caseId}; executed revision ${sourceCase.rev}; current revision ${changed?.current ?? sourceCase.rev}${changed ? '; SOURCE CHANGED' : ''}.</p><p>${h(defect.status)} (${h(defect.method)})</p><pre>${h(sourceScenario.steps.map(step => `${step.position}. ${step.action}\nExpected: ${step.expected.join('; ')}`).join('\n'))}</pre><p>${h(edited.notes)}</p><pre>${h(JSON.stringify(defect.occurrences))}</pre>${changed ? `<pre>${h(JSON.stringify(changed))}</pre>` : ''}`;
  for (const [name, value] of Object.entries(fields)) {
    const spec = metadata.fields.find(field => field.referenceName === name); requireThat(spec && spec.readOnly !== true, `Bug field ${name} is unavailable or read-only.`);
    if (spec.allowedValues?.length) requireThat(spec.allowedValues.some(allowed => allowed === value), `Bug field ${name} is outside its allowed values.`);
  }
  for (const spec of metadata.fields.filter(field => field.alwaysRequired && field.referenceName.startsWith('Custom.') && specMissing(field, fields))) throw new Error(`Required bug field ${spec.referenceName} needs a configured default.`);
  await validatePath(client, 'areas', fields['System.AreaPath']); await validatePath(client, 'iterations', fields['System.IterationPath']);
  const duplicates = await taggedItems(client, defect.fingerprint), completedStates = new Set(metadata.states.filter(state => state.category === 'Completed' || state.category === 'Removed').map(state => state.name));
  const open = duplicates.filter(item => !completedStates.has(item.fields['System.State'])), closed = duplicates.filter(item => completedStates.has(item.fields['System.State']));
  const body = Object.entries(fields).map(([name, value]) => ({op: 'add', path: `/fields/${name}`, value}));
  for (const item of closed) body.push({op: 'add', path: '/relations/-', value: {rel: 'System.LinkTypes.Related', url: `${client.configuration.organizationUrl}/_apis/wit/workitems/${item.id}`}});
  if (defaults.storyLink && view.source.scope.kind === 'story') {await workItem(client, view.source.scope.storyId); body.push({op: 'add', path: '/relations/-', value: {rel: 'System.LinkTypes.Related', url: `${client.configuration.organizationUrl}/_apis/wit/workitems/${view.source.scope.storyId}`}});}
  await client.validateWorkItem(metadata.type, body);
  return {defect, type: metadata.type, body, fields, duplicates: {open: open.map(item => item.id), closed: closed.map(item => item.id)}, revisions: changed ?? null};
}
const specMissing = (field, fields) => !Object.hasOwn(fields, field.referenceName) && field.defaultValue === undefined;
async function reconcileBug(client, roots, row) {
  row.workItemId ??= acknowledgedId(roots, row.receipt, 'create-bug', 'workItemId');
  if (row.workItemId) {const item = await workItem(client, row.workItemId); requireThat(tagsOf(item).includes(`harness-filing-${row.filingId.slice(0, 8)}`), 'Acknowledged bug has different filing identity.'); row.state = 'IDENTIFIED'; return;}
  const found = await taggedItems(client, `harness-filing-${row.filingId.slice(0, 8)}`); requireThat(found.length <= 1, 'Filing identity matched multiple bugs; reconcile manually.');
  if (found.length) {row.workItemId = found[0].id; row.state = 'IDENTIFIED';} else row.state = 'UNCERTAIN';
}
async function attachEvidence(client, roots, delivery, row, prepared, view, save) {
  row.attachments ??= [];
  const used = new Set();
  for (const occurrence of prepared.defect.occurrences) {
    const run = view.runs.find(item => item.runId === occurrence.runId && item.state === 'ASSESSED');
    const candidates = run.result.evidence.filter(record => record.kind === 'screenshot' && (record.identity.invocationId === prepared.defect.stepId || occurrence.evidenceIds.includes(record.id)));
    for (const record of candidates.slice(0, 3)) {
      if (used.has(record.sha256) || record.bytes > (client.configuration.bugs?.maxAttachmentBytes ?? 2 * 1024 * 1024)) continue; used.add(record.sha256);
      let attachment = row.attachments.find(item => item.sha256 === record.sha256);
      if (!attachment) {
        attachment = {sha256: record.sha256, state: 'INTENT'}; row.attachments.push(attachment); save();
      }
      if (attachment.state === 'DISPATCHING') {
        attachment.id ??= acknowledgedId(roots, attachment.receipt, 'upload-attachment', 'attachmentId');
        requireThat(attachment.id, 'UNCERTAIN attachment upload; reconcile its receipt before replaying.'); attachment.state = 'UPLOADED'; save();
      }
      if (!attachment.id) {
        const bytes = readFileSync(join(run.roots.runRoot, record.path)); requireThat(fingerprintBytes(bytes) === record.sha256, 'Attachment integrity changed.');
        attachment.receipt = delivery.receipt; attachment.state = 'DISPATCHING'; save();
        const name = `${record.id}.png`, result = await client.upload(delivery, bytes, name, {onIdentity(identity) {attachment.id = identity.attachmentId; attachment.state = 'UPLOADED'; save();}});
        requireThat(adoGuid(result.id), 'Attachment upload returned an invalid identity.'); attachment.id = result.id;
      }
      attachment.url = `${client.configuration.organizationUrl}/_apis/wit/attachments/${attachment.id}`;
      const item = await workItem(client, row.workItemId);
      if (!(item.relations ?? []).some(relation => relation.rel === 'AttachedFile' && relation.url === attachment.url)) await delivery.write('attach-evidence', `wit/workitems/${row.workItemId}?api-version=7.1`, [{op: 'test', path: '/rev', value: item.rev}, {op: 'add', path: '/relations/-', value: {rel: 'AttachedFile', url: attachment.url, attributes: {comment: 'Verified harness execution context'}}}], {patch: true});
      const after = await workItem(client, row.workItemId); requireThat((after.relations ?? []).some(relation => relation.rel === 'AttachedFile' && relation.url === attachment.url), 'Bug attachment did not verify.'); attachment.state = 'ATTACHED'; save();
    }
  }
}
import {digest as fingerprintBytes} from '../execution-core/data.mjs';

async function fileBugs(client, roots, executionId, view, revisions, options) {
  const journal = ledger(roots, executionId, 'bugs'), save = () => journal.save(journal.value), metadata = await bugMetadata(client), drafts = options.drafts ? readBounded(options.drafts) : {}, defects = executionDefects(view), prepared = [];
  // Draft IDs are stable within this invocation; preview never persists delivery intent.
  for (const defect of defects) {
    let row = journal.value.entries.find(item => item.fingerprint === defect.fingerprint);
    const intent = row ?? {fingerprint: defect.fingerprint, filingId: randomUUID(), state: 'INTENT'};
    prepared.push({row, intent, ...await prepareBug(client, view, defect, revisions, metadata, drafts, intent)});
  }
  const preview = {mode: 'dry-run', executionId, revisions, bugs: prepared.map(item => ({fingerprint: item.defect.fingerprint, fields: item.fields, duplicates: item.duplicates, revision: item.revisions}))};
  if (!options.execute) return preview;
  const filed = [];
  for (const item of prepared) {
    let row = item.row;
    if (row?.state === 'COMPLETED' || row?.state === 'DUPLICATE') {filed.push({fingerprint: row.fingerprint, state: row.state, id: row.workItemId ?? null}); continue;}
    if (row && !['INTENT', 'IDENTIFIED'].includes(row.state)) {await reconcileBug(client, roots, row); save();}
    if (row?.state === 'UNCERTAIN') {
      requireThat(options.recreate === row.fingerprint, `UNCERTAIN: ${row.fingerprint}; reconcile its filing tag or use --recreate ${row.fingerprint}.`);
      const history = [...(row.history ?? []), {...row, history: []}]; row = {fingerprint: row.fingerprint, filingId: randomUUID(), state: 'INTENT', history};
      journal.value.entries = journal.value.entries.filter(entry => entry.fingerprint !== row.fingerprint); journal.value.entries.push(row); save();
      Object.assign(item, await prepareBug(client, view, item.defect, revisions, metadata, drafts, row));
    }
    if (!row) {row = item.intent; journal.value.entries.push(row); save();}
    if (!row.workItemId && item.duplicates.open.length) {row.state = 'DUPLICATE'; row.workItemId = item.duplicates.open[0]; save(); filed.push({fingerprint: row.fingerprint, state: row.state, id: row.workItemId}); continue;}
    const delivery = client.delivery('bugs', true, view.execution.freezeFingerprint); row.receipt = delivery.receipt; save();
    try {
      if (!row.workItemId) {
        row.state = 'DISPATCHING'; row.bodyFingerprint = fingerprint(item.body); save();
        const created = await delivery.write('create-bug', `wit/workitems/$${encodeURIComponent(item.type)}?api-version=7.1`, item.body, {method: 'POST', patch: true, onIdentity(identity) {row.workItemId = adoId(identity.workItemId); row.state = 'IDENTIFIED'; save();}});
        row.workItemId = adoId(created.id); row.state = 'IDENTIFIED'; save();
      }
      const after = await workItem(client, row.workItemId); requireThat(tagsOf(after).includes(row.fingerprint) && tagsOf(after).includes(`harness-filing-${row.filingId.slice(0, 8)}`), 'Bug creation did not verify its fingerprint and filing identity.');
      await attachEvidence(client, roots, delivery, row, item, view, save); delivery.verified({workItemId: row.workItemId}); delivery.finish(); row.state = 'COMPLETED'; save(); filed.push({fingerprint: row.fingerprint, state: row.state, id: row.workItemId});
    } catch (error) {save(); throw error;}
  }
  return {...preview, mode: 'execute', bugs: filed};
}
async function reconcilePublication(client, roots, row, planId) {
  row.runId ??= acknowledgedId(roots, row.receipt, 'create-run', 'runId'); if (row.runId) {row.state = 'IDENTIFIED'; return;}
  const runs = await client.list(`test/runs?planId=${adoId(planId)}&includeRunDetails=true&api-version=7.1`, 'offset'), matches = runs.filter(run => run.name === row.name && adoId(run.plan?.id) === planId);
  requireThat(matches.length <= 1, 'Publication identity matched multiple runs; reconcile manually.');
  if (matches.length) {row.runId = adoId(matches[0].id); row.state = 'IDENTIFIED';} else row.state = 'UNCERTAIN';
}
async function publishResults(client, roots, executionId, view, revisions, options) {
  requireThat(view.source.scope.kind === 'suite', 'Story executions file bugs; publishing results requires suite scope.');
  const {planId, suiteId} = view.source.scope, journal = ledger(roots, executionId, 'publications'), save = () => journal.save(journal.value), points = await client.list(`test/Plans/${planId}/Suites/${suiteId}/points?api-version=7.1`, 'offset'), pointIds = options['point-map'] ? readBounded(options['point-map']) : {}, omitted = [];
  const eligible = view.source.cases.filter(tc => {
    if (!options['include-changed'] && revisions.some(change => change.caseId === tc.id)) {omitted.push({caseId: tc.id, reason: 'source-changed'}); return false;}
    const candidates = points.filter(point => adoId(point.testCase.id) === tc.id), selected = Object.hasOwn(pointIds, tc.id) ? candidates.filter(point => adoId(point.id) === adoId(pointIds[tc.id])) : candidates;
    if (!selected.length) {omitted.push({caseId: tc.id, reason: 'no-test-point'}); return false;} requireThat(selected.length === 1, 'Ambiguous test point; provide --point-map.');
    if (!view.scenarios.some(scenario => scenario.caseId === tc.id && scenario.selectedRunId && (scenario.state === 'ASSESSED' || scenario.status === 'FAIL'))) {omitted.push({caseId: tc.id, reason: 'no-verdict'}); return false;}
    pointIds[tc.id] = adoId(selected[0].id); return true;
  });
  if (!eligible.length) return {mode: options.execute ? 'no-op' : 'dry-run', executionId, cases: [], omitted, revisions};
  const scope = view.source.scenarios.filter(scenario => eligible.some(tc => tc.id === scenario.caseId)), results = view.runs.filter(run => run.state === 'ASSESSED' && scope.some(item => item.id === run.scenarioId)
    && (run.result.status === 'FAIL' || view.scenarios.find(item => item.id === run.scenarioId).state === 'ASSESSED')).map(run => run.result), comments = {};
  const bugJournal = ledger(roots, executionId, 'bugs');
  for (const tc of eligible) {
    const scenarios = view.scenarios.filter(item => item.caseId === tc.id), methods = scenarios.reduce((sum, scenario) => ({checked: sum.checked + scenario.methods.checked, observed: sum.observed + scenario.methods.observed, mixed: sum.mixed + scenario.methods.mixed}), {checked: 0, observed: 0, mixed: 0}), bugIds = bugJournal.value.entries.filter(row => row.workItemId && executionDefects(view).some(defect => defect.fingerprint === row.fingerprint && defect.caseId === tc.id)).map(row => row.workItemId), current = revisions.find(item => item.caseId === tc.id);
    comments[tc.id] = `Harness manual; checked=${methods.checked}; observed=${methods.observed}; mixed=${methods.mixed}; bugs=${bugIds.join(',') || 'none'}; revision=${tc.rev}/${current?.current ?? tc.rev}${current ? '; SOURCE CHANGED' : ''}`.slice(0, 400);
  }
  const publication = prepareExecutionPublication(results, scope, comments), management = createAdoTestManagement(client), preview = await management.publish({publication, planId, suiteId, pointIds});
  if (!options.execute) return {...preview, executionId, omitted, revisions};
  let row = journal.value.entries.at(-1);
  if (row && !['INTENT', 'COMPLETED'].includes(row.state)) {await reconcilePublication(client, roots, row, planId); save();}
  requireThat(!row || row.state !== 'UNCERTAIN' || options['new-run'], 'UNCERTAIN publication; reconcile its exact run name or use --new-run.');
  const publicationFingerprint = fingerprint(publication);
  if (!row || options['new-run']) {
    const publicationId = randomUUID(), number = journal.value.entries.length + 1; row = {publicationId, number, name: `Harness manual execution ${executionId} p${number}-${publicationId.slice(0, 6)}`, state: 'INTENT', publicationFingerprint}; journal.value.entries.push(row); save();
  }
  requireThat(row.publicationFingerprint === publicationFingerprint, 'Publication content changed; use --new-run for a new assessed scope.');
  if (row.state === 'COMPLETED') return {mode: 'resumed', runId: row.runId, executionId, omitted, revisions};
  const result = await management.publish({publication, planId, suiteId, pointIds, execute: true, name: row.name, ...(row.runId ? {resumeRunId: row.runId} : {}), onReceipt(receipt) {row.receipt = receipt; if (!row.runId) row.state = 'DISPATCHING'; save();}, onIdentity(identity) {row.runId = adoId(identity.runId); row.state = 'IDENTIFIED'; save();}});
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
  return command === 'file-bugs' ? fileBugs(client, roots, executionId, view, revisions, options) : publishResults(client, roots, executionId, view, revisions, options);
}
