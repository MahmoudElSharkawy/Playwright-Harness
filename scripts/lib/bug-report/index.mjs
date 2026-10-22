import {existsSync, mkdirSync, lstatSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync} from 'node:fs';
import {dirname, extname, isAbsolute, relative, join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {consumerPath} from '../consumer-paths.mjs';
import {data, digest, fingerprint, id, requireThat} from '../execution-core/data.mjs';
import {readBounded, writeJson} from '../execute/storage.mjs';
import {withTransition} from '../execute/lock.mjs';
import {createAdoClient} from '../integrations/ado-client.mjs';
import {loadAdoConfiguration} from '../integrations/config.mjs';
import {createAdoTestSource} from '../integrations/ado-source.mjs';
import {checkSourceRevisions} from '../execute/source.mjs';
import {deliverBugReports} from '../execute/delivery.mjs';
import {collectExecution, deliverableDefects, readVerifiedEvidence} from '../execute/report.mjs';
import {prepareAnnotation, bindAnnotationReview, verifyAnnotation, inspectScreenshot} from './annotations.mjs';
import {reviewRunFailures} from './failures.mjs';

const path = (roots, reportId, name) => {id(reportId); return consumerPath(roots, `.harness/runs/${reportId}/bug-report/${name}`);};
const current = (roots, reportId) => path(roots, reportId, 'current.json');
const plain = value => typeof value === 'string' && value.length <= 16000 && !value.includes('\0');
const hasText = value => plain(value) && value.trim().length > 0;
const annotationContext = draft => fingerprint({title: draft.title, description: draft.description, prerequisites: draft.prerequisites, steps: draft.steps, expected: draft.expected, actual: draft.actual});
function acquireEdit(roots, reportId) {
  const file = path(roots, reportId, 'edit.lock'); mkdirSync(dirname(file), {recursive: true, mode: 0o700});
  let handle; try {handle = openSync(file, 'wx', 0o600);} catch {throw new Error('BUSY: bug report is being edited; recover an interrupted local edit before continuing.');}
  return () => {closeSync(handle); unlinkSync(file);};
}
function locked(roots, reportId, action) {
  const release = acquireEdit(roots, reportId); try {return action();} finally {release();}
}
async function lockedOperation(roots, reportId, action) {
  const release = acquireEdit(roots, reportId); try {return await action();} finally {release();}
}
function validateDraft(draft, confirmation) {
  requireThat(draft && Object.keys(draft).every(key => ['title', 'description', 'prerequisites', 'steps', 'expected', 'actual', 'fields', 'notes', 'severity', 'priority', 'omitFields'].includes(key)), 'Unsupported editable bug draft input.');
  for (const name of ['title', 'description', 'expected', 'actual']) requireThat(plain(draft[name]), `Invalid bug draft ${name}.`);
  requireThat(draft.title.length <= 255, 'Bug title exceeds 255 characters.');
  for (const name of ['prerequisites', 'steps']) requireThat(Array.isArray(draft[name]) && draft[name].length <= 100 && draft[name].every(plain), `Invalid bug draft ${name}.`);
  requireThat(draft.fields && typeof draft.fields === 'object' && !Array.isArray(draft.fields), 'Bug draft fields must be an object.');
  requireThat(confirmation && Object.keys(confirmation).every(key => ['user', 'agent', 'notes'].includes(key)) && ['reported', 'confirmed'].includes(confirmation.user) && ['not-run', 'reproduced', 'inconclusive', 'not-reproduced'].includes(confirmation.agent), 'Invalid bug confirmation status.');
  if (confirmation.notes !== undefined) requireThat(plain(confirmation.notes), 'Invalid confirmation notes.');
}
function save(roots, reportId, raw) {
  const state = data(raw), head = fingerprint(state), file = path(roots, reportId, `revisions/${head}.json`);
  if (!existsSync(file)) writeJson(file, state, {exclusive: true});
  writeJson(current(roots, reportId), {head});
  return {...state, head};
}
export function readBugReport(roots, reportId) {
  const {head} = readBounded(current(roots, reportId)); requireThat(/^[a-f0-9]{64}$/.test(head), 'Invalid bug report revision.');
  const state = readBounded(path(roots, reportId, `revisions/${head}.json`));
  requireThat(fingerprint(state) === head && state.reportId === reportId && state.consumer === fingerprint({projectRoot: roots.projectRoot, packageRoot: roots.packageRoot}), 'Bug report changed or belongs to another consumer.');
  const intake = readBounded(path(roots, reportId, 'intake.json'));
  requireThat(fingerprint(intake) === state.intakeFingerprint && fingerprint(state.intake) === state.intakeFingerprint, 'Original bug intake changed.');
  validateDraft(state.draft, state.confirmation); return {...state, head};
}
function selectedEvidence(roots, reportId, selected) {
  requireThat(Array.isArray(selected) && selected.length <= 20, 'Select at most 20 bug evidence artifacts.');
  return selected.map(item => {
    requireThat(item && ['screenshot', 'api', 'database', 'log'].includes(item.kind) && typeof item.path === 'string' && !isAbsolute(item.path) && ['user', 'agent', 'execution'].includes(item.origin), 'Invalid selected bug evidence.');
    const source = consumerPath(roots, item.path), stat = lstatSync(source);
    requireThat(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 2 * 1024 * 1024, 'Bug evidence is missing, linked, empty or oversized.');
    const bytes = readFileSync(source); requireThat(bytes.length === stat.size, 'Bug evidence changed while importing.');
    requireThat(plain(item.context ?? ''), 'Invalid bug evidence context.');
    const eligible = item.sanitized === true && item.verification?.privacy === true && item.verification?.relevance === true && hasText(item.context);
    if (!eligible) return {path: item.path, kind: item.kind, origin: item.origin, context: item.context ?? '', sha256: digest(bytes), eligible: false, reason: 'privacy-relevance-or-context-unverified'};
    if (item.kind !== 'screenshot') data({text: bytes.toString('utf8')}, 2 * 1024 * 1024);
    else inspectScreenshot(roots, item.path, digest(bytes));
    const sha256 = digest(bytes), suffix = item.kind === 'screenshot' ? bytes[0] === 137 ? '.png' : '.jpg' : ['.json', '.txt'].includes(extname(item.path)) ? extname(item.path) : '.txt';
    const relative = `.harness/runs/${reportId}/bug-report/artifacts/e-${sha256}${suffix}`, file = consumerPath(roots, relative);
    mkdirSync(dirname(file), {recursive: true, mode: 0o700});
    if (!existsSync(file)) writeFileSync(file, bytes, {flag: 'wx', mode: 0o600});
    requireThat(digest(readFileSync(file)) === sha256, 'Captured bug evidence changed.');
    return {id: `e-${sha256.slice(0, 24)}`, name: `e-${sha256.slice(0, 24)}${suffix}`, path: relative, bytes: bytes.length, sha256, kind: item.kind, origin: item.origin, context: item.context, eligible: true};
  });
}
export function prepareBugReport(roots, reportId, input) {
  return locked(roots, reportId, () => {
    requireThat(!existsSync(current(roots, reportId)), 'Bug report already exists; edit its current revision.');
    const intake = data(input); requireThat(intake.version === 1 && hasText(intake.description), 'Bug report needs version 1 and a user description.');
    requireThat(Object.keys(intake).every(key => ['version', 'description', 'source', 'draft', 'confirmation', 'evidence'].includes(key)), 'Unsupported bug intake input.');
    const draft = {title: intake.description.slice(0, 255), description: intake.description, prerequisites: [], steps: [], expected: intake.source?.expected ?? '', actual: intake.description, fields: {}, ...intake.draft};
    const confirmation = {user: 'reported', agent: 'not-run', ...intake.confirmation}; validateDraft(draft, confirmation);
    const evidence = selectedEvidence(roots, reportId, intake.evidence ?? []);
    writeJson(path(roots, reportId, 'intake.json'), intake, {exclusive: true});
    return save(roots, reportId, {version: 1, reportId, consumer: fingerprint({projectRoot: roots.projectRoot, packageRoot: roots.packageRoot}), intake, intakeFingerprint: fingerprint(intake), filingId: randomUUID(), draft, confirmation, evidence, annotations: [], history: []});
  });
}
export function editBugReport(roots, reportId, input) {
  return locked(roots, reportId, () => {
    const state = readBugReport(roots, reportId), patch = data(input);
    requireThat(patch.head === state.head, 'Bug draft changed; reread the current revision.');
    requireThat(Object.keys(patch).every(key => ['head', 'draft', 'confirmation', 'evidence'].includes(key)), 'Unsupported editable bug input.');
    const draft = {...state.draft, ...patch.draft}, confirmation = {...state.confirmation, ...patch.confirmation}; validateDraft(draft, confirmation);
    const {head, ...prior} = state;
    return save(roots, reportId, {...prior, draft, confirmation, evidence: patch.evidence ? selectedEvidence(roots, reportId, patch.evidence) : state.evidence, history: [...state.history, head]});
  });
}
function verifiedAttachments(roots, state) {
  const records = state.evidence.filter(item => item.eligible), attachments = [...records];
  for (const record of records) {consumerPath(roots, record.path); readVerifiedEvidence({runRoot: roots.projectRoot}, record); if (record.kind === 'screenshot') inspectScreenshot(roots, record.path, record.sha256);}
  for (const record of records.filter(item => item.kind === 'screenshot')) requireThat(state.annotations.some(item => item.record.source === record.path && item.record.sourceSha256 === record.sha256), 'Prepare a reviewed screenshot pair or an explicit bounded raw-only fallback before filing.');
  for (const annotation of state.annotations) {
    requireThat(annotation.draftFingerprint === annotationContext(state.draft), 'Annotation belongs to an earlier bug draft; revalidate its relevance.');
    if (annotation.record.state === 'RAW_ONLY') continue;
    const record = annotation.record; verifyAnnotation(roots, record);
    requireThat(records.some(item => item.path === record.source && item.sha256 === record.sourceSha256), 'Annotation has no eligible raw source in the report.');
    attachments.push({id: `annotated-${record.sha256.slice(0, 24)}`, name: `annotated-${record.sha256.slice(0, 24)}.png`, path: record.output, sha256: record.sha256, bytes: lstatSync(consumerPath(roots, record.output)).size, kind: 'screenshot', sourceSha256: record.sourceSha256});
  }
  return attachments;
}
async function sourceFresh(client, state) {
  const source = state.intake.source;
  if (source?.postRun) {
    const review = await reviewRunFailures(state.roots, source.postRun.run);
    requireThat(review.hash === source.postRun.hash, 'Post-run source or observations changed; classify the current failures and review new drafts.');
    for (const reference of source.postRun.references) await sourceFresh(client, {...state, intake: {source: reference}});
    return;
  }
  if (source?.ado) {
    const captured = source.ado;
    requireThat(captured.organizationUrl === client.configuration.organizationUrl && captured.project.toLowerCase() === client.configuration.project.toLowerCase(), 'Bug destination differs from the captured automation source.');
    const changes = await checkSourceRevisions(captured, createAdoTestSource(client));
    requireThat(changes.length === 0, 'Automated case or shared-step source revision changed; review current source before filing.');
    if (captured.storyId) {
      const story = await client.read(`wit/workitems/${captured.storyId}?api-version=7.1`); await client.requireWorkItemProject(story);
      requireThat(story.id === captured.storyId && story.rev === captured.storyRev, 'Automated story revision changed; review current source before filing.');
    }
    return;
  }
  if (source?.executionId) {
    const view = collectExecution(state.roots, source.executionId);
    requireThat(!view.integrityFailures.length && view.execution.sourceFingerprint === source.sourceFingerprint, 'Original execution source or evidence changed.');
    const defect = deliverableDefects(view).defects.find(item => item.fingerprint === source.defectFingerprint);
    requireThat(defect && fingerprint(defect.occurrences) === source.observationsFingerprint, 'Execution observations changed; review the current defect.');
    if (view.source.organizationUrl) {
      requireThat(view.source.organizationUrl === client.configuration.organizationUrl && view.source.project.toLowerCase() === client.configuration.project.toLowerCase(), 'Bug destination differs from the captured execution source.');
      const original = view.source.cases.find(item => item.id === defect.caseId), latest = await client.read(`wit/workitems/${defect.caseId}?api-version=7.1`); await client.requireWorkItemProject(latest);
      requireThat(latest.id === original.id && latest.rev === original.rev, 'Executed case revision changed; review current source before filing.');
      const changes = await checkSourceRevisions({...view.source, cases: [original]}, createAdoTestSource(client));
      requireThat(changes.length === 0, 'Executed case or shared-step source changed; review current source before filing.');
    }
    if (view.source.scope.kind === 'story') {const story = await client.read(`wit/workitems/${view.source.scope.storyId}?api-version=7.1`); await client.requireWorkItemProject(story); requireThat(story.id === view.source.scope.storyId && story.rev === view.source.scopeRev, 'Executed story revision changed; review current source before filing.');}
    return;
  }
  if (!source?.storyId) return;
  requireThat(Number.isSafeInteger(source.storyId) && source.storyId > 0 && Number.isSafeInteger(source.revision), 'Selected story needs a captured ID and revision.');
  const item = await client.read(`wit/workitems/${source.storyId}?api-version=7.1`); await client.requireWorkItemProject(item);
  requireThat(item.id === source.storyId && item.rev === source.revision, 'Selected story revision changed; capture and review the updated source.');
}
function projection(state, attachments) {
  const fp = state.intake.source?.defectFingerprint ?? `harness-defect-${fingerprint({source: state.intake.source ?? null, description: state.intake.description}).slice(0, 12)}`;
  const source = state.intake.source, scope = source?.storyId ? {kind: 'story', storyId: source.storyId} : {kind: 'report'};
  return {fingerprint: fp, view: {execution: {id: state.reportId, freezeFingerprint: state.intakeFingerprint}, source: {scope, cases: [], scenarios: []}, reportContext: {origin: source?.executionId ? 'execution' : 'user-report', source: source ?? null, confirmation: state.confirmation}, reportDefects: [{fingerprint: fp, title: state.draft.title, ...(source?.caseId ? {caseId: source.caseId} : {}), occurrences: []}], reportAttachments: attachments}};
}
const clientFor = (roots, supplied) => supplied ?? createAdoClient({...loadAdoConfiguration(roots), roots});
async function preparePreview(roots, reportId, dependencies) {
  const state = readBugReport(roots, reportId), attachments = verifiedAttachments(roots, state), problems = [];
  for (const name of ['title', 'description', 'expected', 'actual']) if (!hasText(state.draft[name])) problems.push({field: name, code: 'missing'});
  if (!state.draft.steps.length) problems.push({field: 'steps', code: 'missing'});
  if (!hasText(state.intake.source?.content ?? '')) problems.push({field: 'source', code: 'missing-accepted-context'});
  if (state.intake.source?.postRun?.classification === 'unknown') problems.push({field: 'classification', code: 'provisional-classification'});
  for (const message of state.intake.source?.postRun?.sourceGaps ?? []) problems.push({field: 'source', code: 'missing-original-revisions', message});
  const base = {version: 1, head: state.head, draft: state.draft, confirmation: state.confirmation, rejectedEvidence: state.evidence.filter(item => !item.eligible), annotations: state.annotations, problems, destination: null, ready: false, bugs: []};
  if (problems.length) return base;
  const client = clientFor(roots, dependencies.client); await sourceFresh(client, {...state, roots});
  const {view, fingerprint: fp} = projection(state, attachments), options = {draftValues: {[fp]: state.draft}, filingIds: {[fp]: state.filingId}};
  const prepared = await deliverBugReports(client, roots, reportId, view, options);
  return {...base, ...prepared, ready: true, destination: {organizationUrl: client.configuration.organizationUrl, project: client.configuration.project}, planHash: prepared.planHash};
}
export async function previewBugReport(roots, reportId, dependencies = {}) {
  return withTransition(roots, async () => {
    let preview;
    try {preview = await preparePreview(roots, reportId, dependencies);} catch (error) {const state = readBugReport(roots, reportId); preview = {version: 1, head: state.head, ready: false, destination: null, problems: error.fieldProblems ?? [{code: 'preflight-failed', message: error.message}], fieldReview: error.fieldReview ?? [], draft: state.draft, bugs: []};}
    const hash = fingerprint(preview), result = {...preview, hash}; writeJson(path(roots, reportId, 'preview.json'), result); return result;
  }, {key: `bug-report-${reportId}`, ...(dependencies.inventory ? {inventory: dependencies.inventory} : {})});
}
export function approveBugReport(roots, reportId, hash) {
  return locked(roots, reportId, () => {
    const state = readBugReport(roots, reportId), preview = readBounded(path(roots, reportId, 'preview.json')), {hash: saved, ...content} = preview;
    requireThat(saved === hash && fingerprint(content) === hash && preview.head === state.head && preview.ready, 'Approve the exact ready current bug preview.');
    writeJson(path(roots, reportId, 'approval.json'), {head: state.head, hash}); return {reportId, approved: hash};
  });
}
export async function fileBugReport(roots, reportId, hash, dependencies = {}) {
  return withTransition(roots, () => lockedOperation(roots, reportId, async () => {
    const state = readBugReport(roots, reportId), approval = readBounded(path(roots, reportId, 'approval.json'));
    requireThat(approval.hash === hash && approval.head === state.head, 'Bug approval is stale or missing.');
    const saved = readBounded(path(roots, reportId, 'preview.json')), {hash: savedHash, ...content} = saved;
    requireThat(savedHash === hash && fingerprint(content) === hash && saved.head === state.head && saved.ready, 'Approved bug preview changed.');
    const client = clientFor(roots, dependencies.client); await sourceFresh(client, {...state, roots});
    const attachments = verifiedAttachments(roots, state), {view, fingerprint: fp} = projection(state, attachments);
    return deliverBugReports(client, roots, reportId, view, {execute: true, approvedPlan: saved.planHash, draftValues: {[fp]: state.draft}, filingIds: {[fp]: state.filingId}});
  }), {key: `bug-report-${reportId}`, ...(dependencies.inventory ? {inventory: dependencies.inventory} : {})});
}
export async function annotateBugReport(roots, reportId, input, dependencies = {}) {
  const state = readBugReport(roots, reportId), selected = state.evidence.find(item => item.path === input.source && item.eligible && item.kind === 'screenshot');
  requireThat(selected, 'Select an eligible captured screenshot from the bug report.');
  requireThat(input.expected === state.draft.expected && input.actual === state.draft.actual, 'Annotation text must match the reviewed bug draft.');
  const record = await prepareAnnotation(roots, {...input, sourceSha256: selected.sha256}, dependencies);
  return locked(roots, reportId, () => {const latest = readBugReport(roots, reportId); requireThat(latest.head === state.head, 'Bug draft changed during annotation.'); const {head, ...prior} = state; return save(roots, reportId, {...prior, annotations: [...state.annotations.filter(item => item.record.source !== record.source), {draftFingerprint: annotationContext(state.draft), record}], history: [...state.history, head]});});
}
export function reviewBugAnnotation(roots, reportId, input) {
  return locked(roots, reportId, () => {
    const state = readBugReport(roots, reportId), {head, ...prior} = state; let matched = false;
    const annotations = state.annotations.map(item => {if (item.record.sourceSha256 !== input.sourceSha256) return item; matched = true; return {...item, record: bindAnnotationReview(item.record, input)};});
    requireThat(matched, 'No matching annotation to review.'); return save(roots, reportId, {...prior, annotations, history: [...state.history, head]});
  });
}
export function bugReportFromExecution(roots, reportId, executionId, selected) {
  const view = collectExecution(roots, executionId); requireThat(!view.integrityFailures.length, 'Execution integrity failure blocks bug drafting.');
  const defect = deliverableDefects(view).defects.find(item => item.fingerprint === selected); requireThat(defect, 'Select an eligible execution defect fingerprint.');
  const scenario = view.source.scenarios.find(item => item.id === defect.scenarioId), tc = view.source.cases.find(item => item.id === defect.caseId);
  const evidence = [], seen = new Set();
  for (const occurrence of defect.occurrences) {
    const run = view.runs.find(item => item.runId === occurrence.runId && item.state === 'ASSESSED');
    for (const record of (run?.result.evidence ?? []).filter(item => occurrence.evidenceIds.includes(item.id)).slice(0, 3)) {
      if (seen.has(record.sha256)) continue; seen.add(record.sha256); readVerifiedEvidence(run.roots, record);
      evidence.push({path: relative(roots.projectRoot, join(run.roots.runRoot, record.path)).replaceAll('\\', '/'), kind: record.kind === 'screenshot' ? 'screenshot' : 'log', origin: 'execution', sanitized: record.sanitized === true, verification: {privacy: record.sanitized === true, relevance: false}, context: `Execution ${executionId}; run ${occurrence.runId}; evidence ${record.id}; review attachment relevance before selection`});
    }
  }
  return prepareBugReport(roots, reportId, {version: 1, description: defect.title, source: {executionId, caseId: defect.caseId, ...(view.source.scope.kind === 'story' ? {storyId: view.source.scope.storyId} : {}), sourceFingerprint: view.execution.sourceFingerprint, defectFingerprint: selected, observationsFingerprint: fingerprint(defect.occurrences), content: JSON.stringify({executionId, sourceFingerprint: view.execution.sourceFingerprint, caseId: defect.caseId, revision: tc.rev, occurrences: defect.occurrences}), expected: scenario.steps.flatMap(item => item.expected).join('; ')},
    draft: {title: defect.title, description: defect.title, prerequisites: [], steps: scenario.steps.map(item => item.action), expected: scenario.steps.flatMap(item => item.expected).join('; '), actual: JSON.stringify(defect.occurrences), fields: {}}, confirmation: {user: 'reported', agent: 'reproduced', notes: `Verified execution ${executionId}; ${defect.fingerprint}`}, evidence: evidence.slice(0, 20)});
}

/** Persist agent classifications and evidence-backed grouping, then reuse ordinary editable drafts. */
export async function prepareRunBugReports(roots, batchId, raw, dependencies = {}) {
  id(batchId);
  const input = data(raw), review = await reviewRunFailures(roots, input.run);
  requireThat(input.version === 1 && Object.keys(input).every(key => ['version', 'run', 'hash', 'classifications', 'groups'].includes(key)), 'Invalid post-run review input.');
  requireThat(input.hash === review.hash, 'Run source or observations changed; review the current failures.');
  requireThat(Array.isArray(input.classifications) && input.classifications.length === review.findings.length && Array.isArray(input.groups), 'Classify every run finding exactly once.');
  const classifications = new Map(), grouped = new Set();
  for (const row of input.classifications) {
    requireThat(row && Object.keys(row).every(key => ['finding', 'classification', 'reason', 'nextAction'].includes(key)) && review.findings.some(finding => finding.id === row.finding) && !classifications.has(row.finding), 'Invalid or duplicate failure classification.');
    requireThat(['application', 'test', 'environment', 'unknown'].includes(row.classification) && hasText(row.reason) && hasText(row.nextAction), 'Classifications need a supported category, reason and next action.');
    classifications.set(row.finding, row);
  }
  const groupKeys = new Set();
  const plans = input.groups.map(group => {
    requireThat(group && Object.keys(group).every(key => ['key', 'members', 'reason', 'draft', 'evidence'].includes(key)) && Array.isArray(group.members) && group.members.length > 0 && new Set(group.members).size === group.members.length && hasText(group.reason), 'A defect group needs unique members and an evidence-backed grouping reason.');
    if (group.key !== undefined) {id(group.key); requireThat(!groupKeys.has(group.key), 'Use distinct keys for distinct defect groups.'); groupKeys.add(group.key);}
    const members = [...group.members].sort(), rows = members.map(member => {
      requireThat(classifications.has(member) && (!grouped.has(member) || group.key && input.groups.filter(item => item.members.includes(member)).every(item => item.key)), 'Overlapping findings need distinct explicit group keys and a separate symptom rationale.'); grouped.add(member);
      return review.findings.find(row => row.id === member);
    });
    const classification = classifications.get(members[0]).classification;
    requireThat(['application', 'unknown'].includes(classification) && members.every(member => classifications.get(member).classification === classification), 'Only uniformly classified application or provisional unknown findings form bug drafts.');
    requireThat(classification !== 'application' || rows.every(row => row.eligible), 'An application bug needs supported failure evidence; keep unresolved findings provisional.');
    const identity = {members, ...(group.key ? {key: group.key} : {})};
    const fp = members.length === 1 && input.run.workflow === 'execute-test' && !group.key ? members[0] : `harness-defect-${fingerprint({workflow: input.run.workflow, ...identity}).slice(0, 12)}`;
    const reportId = `bug-${fingerprint({batchId, ...identity}).slice(0, 24)}`;
    const confirmation = {user: 'reported', agent: classification === 'unknown' ? 'inconclusive' : input.run.workflow === 'execute-test' ? 'reproduced' : 'not-run', notes: 'Classification uses the recorded run; no additional reproduction was performed.'};
    const draft = {prerequisites: [], fields: {}, ...group.draft}; validateDraft(draft, confirmation);
    const references = rows.flatMap(row => row.references), first = references[0];
    const scenarioIds = new Set(rows.flatMap(row => [row.scenarioId, ...(row.occurrences ?? []).map(occurrence => occurrence.scenarioId)]));
    const scenarios = review.source.scenarios.filter(scenario => scenarioIds.has(scenario.id));
    const source = {content: JSON.stringify({title: review.source.title, scenarios}), expected: draft.expected, defectFingerprint: fp,
      ...(first ? {caseId: first.caseId} : {}), ...(review.source.scope?.kind === 'story' ? {storyId: review.source.scope.storyId} : first?.ado?.storyId ? {storyId: first.ado.storyId} : {}),
      postRun: {run: input.run, hash: review.hash, ...identity, classification, groupingReason: group.reason, classifications: members.map(member => classifications.get(member)), references, sourceGaps: rows.flatMap(row => row.sourceGaps ?? [])}};
    const intake = {version: 1, description: draft.description, source, draft, confirmation, evidence: group.evidence ?? []};
    return {reportId, members, classification, intake};
  });
  requireThat(input.classifications.every(row => row.classification !== 'application' || grouped.has(row.finding)), 'Every supported application defect needs a draft group.');
  return withTransition(roots, () => {
    const file = consumerPath(roots, `.harness/runs/${batchId}/bug-review.json`), hash = fingerprint(input);
    if (existsSync(file)) requireThat(readBounded(file).hash === hash, 'This run review already exists; resume its input or use a new review identity for reclassification.');
    else writeJson(file, {version: 1, hash, input}, {exclusive: true});
    const drafts = plans.map(({intake, ...plan}) => {
      if (existsSync(current(roots, plan.reportId))) requireThat(readBugReport(roots, plan.reportId).intakeFingerprint === fingerprint(intake), 'Existing draft has different source bindings.');
      else prepareBugReport(roots, plan.reportId, intake);
      const state = readBugReport(roots, plan.reportId);
      return {...plan, head: state.head, draft: state.draft};
    });
    return {batchId, hash, drafts, attention: input.classifications.filter(row => row.classification !== 'application')};
  }, {key: `bug-review-${batchId}`, ...(dependencies.inventory ? {inventory: dependencies.inventory} : {})});
}
