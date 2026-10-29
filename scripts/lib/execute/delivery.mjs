import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {adoRequestFingerprint} from '../integrations/ado-client.mjs';
import {createAdoTestSource} from '../integrations/ado-source.mjs';
import {createAdoTestManagement, prepareExecutionPublication} from '../integrations/ado-management.mjs';
import {createTrackerClient, selectedTestManagement} from '../integrations/selection.mjs';
import {checkJiraSourceRevisions} from '../integrations/jira-source.mjs';
import {prepareExecutionRows} from '../integrations/publication.mjs';
import {deliverNativeResults} from '../integrations/native-publication.mjs';
import {adoId} from '../integrations/config.mjs';
import {fingerprint, requireThat} from '../execution-core/data.mjs';
import {createAdoBugs} from '../integrations/ado-bugs.mjs';
import {createJiraBugs, reconcileJiraBugStory} from '../integrations/jira-bugs.mjs';
import {trackerProvider} from '../integrations/selection.mjs';
import {requestFingerprint} from '../integrations/delivery.mjs';
export {draftMetadata} from './bug-narrative.mjs';
export {allowedFieldValue} from '../integrations/bug-fields.mjs';
import {collectExecution, executionDefects, deliverableDefects, readVerifiedEvidence} from './report.mjs';
import {checkSourceRevisions} from './source.mjs';
import {readBounded, writeJson, ownedFile} from './storage.mjs';
import {withTransition} from './lock.mjs';
import {consumerPath} from '../consumer-paths.mjs';

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
async function reconcileBug(adapter, roots, row) {
  if (!row.workItemId) {const acknowledged = acknowledgedId(roots, row.receipt, 'create-bug', adapter.identityKey, row.requestFingerprint); if (acknowledged) row.workItemId = acknowledged;}
  if (row.workItemId) {const item = await adapter.read(row.workItemId); requireThat(adapter.tags(item).includes(adapter.marker(row)), 'Acknowledged bug has different filing identity.'); row.state = 'IDENTIFIED'; return;}
  const found = await adapter.find(adapter.marker(row)); requireThat(found.length <= 1, 'Filing identity matched multiple bugs; reconcile manually.');
  if (found.length) {row.workItemId = adapter.id(found[0]); row.state = 'IDENTIFIED';} else row.state = 'UNCERTAIN';
}
async function attachEvidence(client, adapter, roots, delivery, row, prepared, view, save, options) {
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
        const acknowledged = acknowledgedId(roots, attachment.receipt, 'upload-attachment', 'attachmentId', attachment.requestFingerprint) ?? await adapter.recoverAttachment?.(row, record, attachment);
        if (acknowledged) {attachment.id = acknowledged; attachment.state = 'UPLOADED';}
        else if (options.recreate === `${row.fingerprint}:${attachment.sha256}`) {attachment.previousReceipts = [...(attachment.previousReceipts ?? []), attachment.receipt]; attachment.state = 'INTENT';}
        else {attachment.state = 'UNCERTAIN'; complete = false; save(); continue;}
        save();
      }
      if (!attachment.id) {
        if (view.reportAttachments) consumerPath(roots, record.path);
        const bytes = readVerifiedEvidence(evidenceRoots, record), request = adapter.attachmentRequest(row, record, bytes);
        attachment.receipt = delivery.receipt; attachment.state = 'DISPATCHING'; attachment.requestFingerprint = requestFingerprint(request.route, request.options.method, request.body, request.options.raw); save();
        let result;
        try {result = await delivery.write('upload-attachment', request.route, request.body, {...request.options, onIdentity(identity) {attachment.id = identity.attachmentId; attachment.state = 'UPLOADED'; save();}});}
        catch {attachment.state = attachment.id ? 'UPLOADED' : 'UNCERTAIN'; save(); return false;}
        attachment.id = adapter.attachmentIdentity(result);
      }
      await adapter.verifyAttachment(delivery, row, attachment, record); attachment.state = 'ATTACHED'; save();
    }
  return complete;
}

async function fileBugs(client, roots, executionId, view, revisions, options) {
  const adapter = (trackerProvider(client) === 'jira' ? createJiraBugs : createAdoBugs)(client);
  const journal = ledger(roots, executionId, 'bugs'), save = () => journal.save(journal.value), metadata = await adapter.metadata(), drafts = options.draftValues ?? (options.drafts ? readBounded(options.drafts) : {}), {defects, skipped} = view.reportDefects ? {defects: view.reportDefects, skipped: []} : deliverableDefects(view, options.include), prepared = [];
  // Draft IDs are stable within this invocation; preview never persists delivery intent.
  for (const defect of defects) {
    if (drafts[defect.fingerprint]?.file === false) {skipped.push({fingerprint: defect.fingerprint, reason: 'draft-excluded'}); continue;}
    let row = journal.value.entries.find(item => item.fingerprint === defect.fingerprint);
    const intent = row ?? {fingerprint: defect.fingerprint, filingId: options.filingIds?.[defect.fingerprint] ?? randomUUID(), state: 'INTENT'};
    prepared.push({row, intent, ...await adapter.prepare(view, defect, revisions, metadata, drafts, intent)});
  }
  const attachments = view.reportAttachments ?? [];
  for (const record of attachments) {consumerPath(roots, record.path); const bytes = readVerifiedEvidence({runRoot: roots.projectRoot}, record); requireThat(bytes.length <= (client.configuration.bugs?.maxAttachmentBytes ?? 2 * 1024 * 1024), 'Bug evidence exceeds the destination attachment bound.');}
  const bugPreview = item => ({fingerprint: item.defect.fingerprint, type: item.type, fields: item.fields, review: item.review, schemaFingerprint: item.schemaFingerprint, duplicates: item.duplicates, revision: item.revisions, attachments, ...(item.links ? {links: item.links} : {})});
  const preview = {mode: 'dry-run', executionId, revisions, skipped, bugs: prepared.map(bugPreview)};
  const planHash = () => fingerprint({executionId, revisions, skipped, bugs: preview.bugs, destination: adapter.destination});
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
    if (row && !['INTENT', 'IDENTIFIED'].includes(row.state)) {await reconcileBug(adapter, roots, row); save();}
    if (row?.state === 'UNCERTAIN') {
      requireThat(options.recreate === row.fingerprint, `UNCERTAIN: ${row.fingerprint}; reconcile its filing tag or use --recreate ${row.fingerprint}.`);
      requireThat(!options.approvedPlan, 'Recreation changes the filing identity; prepare and approve a new preview before dispatch.');
      const history = [...(row.history ?? []), {...row, history: []}]; row = {fingerprint: row.fingerprint, filingId: randomUUID(), state: 'INTENT', history};
      journal.value.entries = journal.value.entries.filter(entry => entry.fingerprint !== row.fingerprint); journal.value.entries.push(row); save();
      Object.assign(item, await adapter.prepare(view, item.defect, revisions, metadata, drafts, row));
      const index = preview.bugs.findIndex(bug => bug.fingerprint === item.defect.fingerprint);
      preview.bugs[index] = bugPreview(item); itemPlanHash = fingerprint(preview.bugs[index]); preview.planHash = planHash();
    }
    if (!row) {row = item.intent; journal.value.entries.push(row);}
    row.planHash ??= itemPlanHash; if (item.links) row.sourceLinks ??= item.links; save();
    if (!row.workItemId && item.duplicates.open.length) {row.state = 'DUPLICATE'; row.workItemId = item.duplicates.open[0]; save(); filed.push({fingerprint: row.fingerprint, state: row.state, id: row.workItemId}); continue;}
    const delivery = client.delivery('bugs', true, view.execution.freezeFingerprint); row.receipt = delivery.receipt; save();
    try {
      if (!row.workItemId) {
        const request = adapter.createRequest(item);
        row.state = 'DISPATCHING'; row.bodyFingerprint = fingerprint(item.body); row.requestFingerprint = requestFingerprint(request.route, request.options.method, request.body); save();
        const created = await delivery.write('create-bug', request.route, request.body, {...request.options, onIdentity(identity) {row.workItemId = identity[adapter.identityKey]; row.state = 'IDENTIFIED'; save();}});
        row.workItemId = adapter.id(created); row.state = 'IDENTIFIED'; save();
      }
      adapter.verify(await adapter.read(row.workItemId), item, row);
      await adapter.completeLinks?.(delivery, row, item, save);
      const attached = await attachEvidence(client, adapter, roots, delivery, row, item, view, save, options);
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
async function publishResults(client, roots, executionId, view, revisions, options, nativeManagement) {
  const jira = view.source.provider === 'jira';
  requireThat(jira || view.source.scope.kind === 'suite', 'Story executions file bugs; publishing results requires suite scope.');
  requireThat(!jira || !options['point-map'], 'Jira publication uses native case/execution identities, not Azure test points.');
  const {planId, suiteId} = view.source.scope, journal = ledger(roots, executionId, 'publications'), save = () => journal.save(journal.value), points = jira ? [] : await client.list(`test/Plans/${planId}/Suites/${suiteId}/points?api-version=7.1`, 'offset'), suppliedPoints = options['point-map'] ? readBounded(options['point-map']) : {};
  if (jira && options['new-run']) requireThat(!journal.value.entries.some(entry => entry.state !== 'COMPLETED'), 'Reconcile unfinished publication before starting another result delivery.');
  let pointIds = {}, omitted = [], row = options['new-run'] ? undefined : journal.value.entries.at(-1);
  const bugJournal = ledger(roots, executionId, 'bugs'), index = publicationIndexes(view, points, {}, {bugs: bugJournal.value.entries, revisions});
  requireThat(suppliedPoints && typeof suppliedPoints === 'object' && !Array.isArray(suppliedPoints) && Object.keys(suppliedPoints).every(caseId => view.source.cases.some(tc => String(tc.id) === caseId)), 'Point selections contain cases outside captured scope.');
  for (const pointId of Object.values(suppliedPoints)) adoId(pointId);
  const eligible = view.source.cases.filter(tc => {
    if (index.legacyCases.has(tc.id)) {omitted.push({caseId: tc.id, reason: 'legacy-evidence'}); return false;}
    if (!options['include-changed'] && index.revisions.has(tc.id)) {omitted.push({caseId: tc.id, reason: 'source-changed'}); return false;}
    const candidates = index.points.get(tc.id) ?? [], selected = Object.hasOwn(suppliedPoints, tc.id) ? candidates.filter(point => adoId(point.id) === adoId(suppliedPoints[tc.id])) : candidates;
    if (!jira && !selected.length) {omitted.push({caseId: tc.id, reason: 'no-test-point'}); return false;} requireThat(jira || selected.length === 1, 'Ambiguous test point; provide --point-map.');
    if (!(index.scenarios.get(tc.id) ?? []).some(scenario => scenario.selectedRunId && (scenario.state === 'ASSESSED' || scenario.status === 'FAIL'))) {omitted.push({caseId: tc.id, reason: 'no-verdict'}); return false;}
    if (!jira) pointIds[tc.id] = adoId(selected[0].id); return true;
  });
  if (!eligible.length && !row?.inputs) return {mode: options.execute ? 'no-op' : 'dry-run', executionId, cases: [], omitted, revisions};
  const eligibleIds = new Set(eligible.map(tc => tc.id)), selectedRuns = new Set(view.scenarios.map(item => item.selectedRunId));
  let scope = view.source.scenarios.filter(scenario => eligibleIds.has(scenario.caseId)), selected = view.runs.filter(run => run.state === 'ASSESSED' && eligibleIds.has(index.caseByScenario.get(run.scenarioId)) && (run.result.status === 'FAIL' || selectedRuns.has(run.runId))), comments = {};
  for (const tc of eligible) {
    const scenarios = index.scenarios.get(tc.id) ?? [], methods = scenarios.reduce((sum, scenario) => ({checked: sum.checked + scenario.methods.checked, observed: sum.observed + scenario.methods.observed, mixed: sum.mixed + scenario.methods.mixed}), {checked: 0, observed: 0, mixed: 0}), bugIds = index.bugIds.get(tc.id) ?? [], current = index.revisions.get(tc.id);
    const revision = jira ? tc.revision : tc.rev;
    comments[tc.id] = `Harness manual; checked=${methods.checked}; observed=${methods.observed}; mixed=${methods.mixed}; bugs=${bugIds.join(',') || 'none'}; revision=${revision}/${current?.current ?? revision}${current ? '; SOURCE CHANGED' : ''}`.slice(0, 400);
  }
  let inputs = {scenarioIds: scope.map(item => item.id), runIds: selected.map(item => item.runId), comments, pointIds, omitted, revisions};
  if (row?.inputs) {
    inputs = row.inputs; const scenarioIds = new Set(inputs.scenarioIds);
    scope = view.source.scenarios.filter(item => scenarioIds.has(item.id)); selected = inputs.runIds.map(id => index.runs.get(id));
    requireThat(scope.length === scenarioIds.size && selected.every(item => item?.state === 'ASSESSED'), 'Stored publication inputs are missing or no longer assessable.');
    requireThat(scope.every(item => !index.legacyCases.has(item.caseId)), 'Legacy browser evidence cannot resume publication.');
    comments = inputs.comments; pointIds = inputs.pointIds; omitted = inputs.omitted;
  }
  if (jira) {
    const publication = prepareExecutionRows(selected.map(item => item.result), scope, comments);
    return publishJiraResults(nativeManagement, roots, executionId, view, {journal, save, row, inputs, publication, selected, scope, omitted, revisions}, options);
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
function jiraStepResults(item, scope, selected) {
  return item.stepIds.map((_id, index) => {
    const position = index + 1 + (item.setupSteps ?? 0), keys = new Set(scope.filter(scenario => scenario.caseId === item.id).flatMap(scenario => scenario.expectations.filter(expected => expected.step === position).map(expected => expected.key)));
    const conditions = selected.flatMap(run => run.conditions).filter(condition => keys.has(condition.key));
    const statuses = [...keys].map(key => {const history = conditions.filter(condition => condition.key === key); return history.some(condition => condition.status === 'FAIL') ? 'FAIL' : history.at(-1)?.status ?? 'NOT_EVALUATED';});
    const outcome = statuses.includes('FAIL') ? 'FAIL' : statuses.includes('INDETERMINATE') ? 'REVIEW_REQUIRED' : !statuses.length || statuses.includes('NOT_EVALUATED') ? 'NOT_RUN' : statuses.every(status => status === 'PASS') ? 'PASS' : 'REVIEW_REQUIRED';
    return {outcome, actual: `Harness assessed ${outcome}; evidence=${[...new Set(conditions.flatMap(condition => condition.evidenceIds))].join(',') || 'none'}`.slice(0, 2000)};
  });
}
async function publishJiraResults(management, roots, executionId, view, state, options) {
  const {journal, save, inputs, publication, selected, scope, omitted, revisions} = state; let {row} = state;
  const selection = view.source.scope.selection;
  const groupId = options.group ?? (selection.kind === 'execution' || management.provider === 'zephyr-scale' && selection.kind === 'suite' ? selection.id : undefined);
  requireThat(typeof groupId === 'string' && groupId, 'Select an existing native execution/cycle with --group before publishing Jira results.');
  requireThat(!row || row.groupId === groupId, 'Publication destination changed; reconcile the original delivery first.');
  if (row) requireThat(row.nativePlan && row.nativePlanFingerprint === fingerprint(row.nativePlan), 'Stored Jira publication plan changed; preserve it for recovery.');
  const number = row?.number ?? journal.value.entries.length + 1;
  const marker = row?.nativePlan.marker ?? 'pom-harness-' + fingerprint({executionId, number, groupId, inputs, publication}).slice(0, 48);
  const statuses = options.statusValues ?? (options.statuses ? readBounded(consumerPath(roots, options.statuses)) : undefined);
  const stepStatuses = options.stepStatusValues ?? (options['step-statuses'] ? readBounded(consumerPath(roots, options['step-statuses'])) : undefined);
  const plan = row?.nativePlan ?? await management.prepareResults({groupId, marker, statuses, stepStatuses, automated: false,
    results: publication.map(item => ({caseId: item.caseId, outcome: {SKIPPED: 'NOT_RUN', NEEDS_REVIEW: 'REVIEW_REQUIRED'}[item.status] ?? item.status, comment: item.comment,
      steps: jiraStepResults(view.source.cases.find(value => value.id === item.caseId), scope, selected)}))});
  const approved = fingerprint({source: view.execution.sourceFingerprint, destination: view.source.scope, plan});
  const preview = {mode: 'dry-run', executionId, fingerprint: approved, plan, omitted, revisions};
  if (!options.execute) return preview;
  requireThat(options.approval === approved, 'Explicit publication approval must match the exact native result preview.');
  if (!row) {row = {number, groupId, state: 'INTENT', inputs, nativePlan: plan, nativePlanFingerprint: fingerprint(plan), identities: []}; journal.value.entries.push(row); save();}
  return deliverNativeResults(management, {roots, row, save, plan, approved, preview});
}
export async function deliverExecution(roots, executionId, command, options = {}, dependencies = {}) {
  return withTransition(roots, () => deliverOwned(roots, executionId, command, options, dependencies), {key: `delivery-${executionId}`, attempts: 1, ...(dependencies.inventory ? {inventory: dependencies.inventory} : {})});
}
async function deliverOwned(roots, executionId, command, options, dependencies = {}) {
  const view = collectExecution(roots, executionId); requireThat(!view.integrityFailures.length, `Integrity failure blocks delivery; rerun ${view.integrityFailures.join(', ')}.`);
  if (view.source.provider === 'local' && command === 'publish-results') return {mode: 'local', executionId, cases: view.scenarios.map(({caseId, status, state}) => ({caseId, status, state})), detail: 'Results remain in the local execution history and report.'};
  const sourceProvider = view.source.provider === 'jira' ? 'jira' : view.source.provider === 'local' ? undefined : 'ado';
  requireThat(command === 'file-bugs' || options.provider === undefined || options.provider === sourceProvider, 'Result publication uses the captured test source provider.');
  const client = createTrackerClient(roots, {...dependencies, provider: options.provider ?? sourceProvider});
  const sourceClient = sourceProvider && trackerProvider(client) !== sourceProvider ? dependencies.sourceClient ?? createTrackerClient(roots, {...dependencies, client: undefined, provider: sourceProvider}) : client;
  let management, revisions = [];
  if (view.source.provider === 'jira') {
    requireThat(sourceClient.configuration.siteUrl === view.source.scope.siteUrl && sourceClient.configuration.project === view.source.scope.project, 'Jira source differs from captured source.');
    const checked = command === 'file-bugs' ? await reconcileJiraBugStory(sourceClient, view.source, ledger(roots, executionId, 'bugs').value.entries) : view.source;
    management = selectedTestManagement(roots, sourceClient, dependencies); revisions = await checkJiraSourceRevisions(checked, management, sourceClient);
  } else if (view.source.provider !== 'local') {
    requireThat(sourceClient.configuration.organizationUrl === view.source.organizationUrl && sourceClient.configuration.project.toLowerCase() === view.source.project.toLowerCase(), 'ADO source differs from captured source.');
    revisions = await checkSourceRevisions(view.source, createAdoTestSource(sourceClient));
  } else if (options.story) {
    requireThat(trackerProvider(client) === 'jira', 'An explicit local story destination currently requires Jira.');
    view.bugStory = {provider: 'jira', siteUrl: client.configuration.siteUrl, project: client.configuration.project, id: options.story};
  }
  writeJson(ownedFile(roots, executionId, 'delivery/revisions.json'), {version: 1, sourceFingerprint: view.execution.sourceFingerprint, checkedAt: new Date().toISOString(), revisions});
  return command === 'file-bugs' ? fileBugs(client, roots, executionId, view, revisions, options) : publishResults(client, roots, executionId, view, revisions, options, management);
}
