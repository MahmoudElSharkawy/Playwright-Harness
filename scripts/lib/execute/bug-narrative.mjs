import {escapeHtml as h} from '../reporting/render.mjs';
import {requireThat} from '../execution-core/data.mjs';

/** Summarize selected observations without implying a reproduction denominator. */
export function executionBugActual(defect) {
  const labels = {FAIL: 'Recorded failure occurrences', INDETERMINATE: 'Inconclusive observations', DIAGNOSTIC: 'Recorded diagnostics'};
  return Object.entries(labels).flatMap(([status, label]) => {
    const count = (defect.occurrences ?? []).filter(row => row.status === status).length;
    return count ? [`${label}: ${count}.`] : [];
  }).join('\n') || 'No conclusive actual result was recorded.';
}

/** Render only readable source/confirmation facts, never the captured tracking object. */
export function renderBugNarrative(view, defect, edited, changed) {
  const context = view.reportContext, source = context?.source ?? {}, workflow = source.postRun?.run.workflow;
  let captured;
  if (source.postRun || source.executionId) {try {captured = JSON.parse(source.content);} catch { /* A plain source description has no structured presentation fields. */ }}
  const origin = workflow === 'automate-test' ? 'Automated tests' : workflow === 'execute-test' || source.executionId || !context ? 'Test execution' : 'User report';
  const storyId = source.storyId ?? (view.source.scope.kind === 'story' ? view.source.scope.storyId : view.source.scope.selection?.kind === 'story' ? view.source.scope.selection.id : undefined);
  const cases = [...new Set([defect.caseId, source.caseId, ...(source.postRun?.references ?? []).map(row => row.caseId), ...(captured?.scenarios ?? []).map(row => row.caseId ?? row.id)].filter(value => typeof value === 'string' || Number.isSafeInteger(value)))];
  const references = [...new Set([...(source.externalReferences ?? []), ...(source.postRun?.references ?? []).flatMap(row => row.jira?.externalReferences ?? []), ...(captured?.scenarios ?? []).flatMap(row => row.externalReferences ?? []), ...view.source.scenarios.filter(row => row.id === defect.scenarioId || cases.includes(row.caseId)).flatMap(row => row.externalReferences ?? [])].map(ref => ref.id).filter(value => typeof value === 'string' && value.length <= 2000 && /^https?:\/\//.test(value)))];
  const sourceDetails = [`Source: ${origin}`, ...(storyId ? [`Story #${storyId}`] : []), ...cases.map(value => `Test case ${typeof value === 'number' ? '#' : ''}${value}`), ...references.map(value => `Test reference: ${value}`)];
  const confirmation = context?.confirmation;
  const user = confirmation ? confirmation.user === 'confirmed' ? 'Confirmed' : 'Not confirmed' : 'Not recorded';
  const agent = confirmation ? {'not-run': 'Not performed', reproduced: 'Reproduced', inconclusive: 'Inconclusive', 'not-reproduced': 'Not reproduced'}[confirmation.agent]
    : defect.status === 'FAIL' ? 'Failure observed in recorded execution' : defect.status === 'INDETERMINATE' ? 'Inconclusive' : 'Not established by diagnostics';
  const legacyNotes = `Verified execution ${source.executionId}; ${source.defectFingerprint}`;
  const notes = source.executionId && confirmation?.notes === legacyNotes ? 'The failure was verified in the recorded execution; no additional reproduction was performed.' : confirmation?.notes;
  const header = `<p>${sourceDetails.map(h).join('; ')}</p><p>User confirmation: ${h(user)}</p><p>Agent reproduction: ${h(agent)}</p>${notes ? `<p>${h(notes)}</p>` : ''}`;
  const scenario = view.source.scenarios.find(item => item.id === defect.scenarioId);
  const originalSteps = scenario?.steps.map(step => `${step.position}. ${step.action}\nExpected: ${step.expected.join('; ')}`).join('\n') ?? '';
  // Recognize older generated defaults without rewriting saved drafts or arbitrary API JSON supplied by a user.
  const legacyActual = source.executionId && Array.isArray(captured?.occurrences) && edited.actual === JSON.stringify(captured.occurrences);
  const actual = legacyActual ? executionBugActual(captured) : edited.actual ?? executionBugActual(defect);
  const revisions = changed ? [
    ...(changed.executed !== changed.current ? [`Test case #${changed.caseId}: executed revision ${changed.executed}, current revision ${changed.current ?? 'unavailable'}.`] : []),
    ...(changed.sharedSteps ?? []).map(row => `Shared steps #${row.id}: executed revision ${row.executed}, current revision ${row.current ?? 'unavailable'}.`)
  ] : [];
  const revision = changed ? `<p>Source changed after execution. Review the changed source before relying on this result.</p>${revisions.map(text => `<p>${h(text)}</p>`).join('')}` : '';
  return {actual, references, html: `${header}<p>${h(edited.description ?? '')}</p><h3>Prerequisites</h3><pre>${h((edited.prerequisites ?? []).join('\n'))}</pre><h3>Steps to reproduce</h3><pre>${h(edited.steps?.map((step, index) => `${index + 1}. ${step}`).join('\n') ?? originalSteps)}</pre><h3>Expected</h3><pre>${h(edited.expected ?? originalSteps)}</pre><h3>Actual</h3><pre>${h(actual)}</pre><p>${h(edited.notes ?? '')}</p>${revision}`};
}

export function draftMetadata(drafts, fp, defaults, title, {structuredFields = false} = {}) {
  const input = drafts?.[fp] ?? {}; requireThat(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(key => ['file', 'title', 'severity', 'priority', 'notes', 'description', 'prerequisites', 'steps', 'expected', 'actual', 'fields', 'omitFields'].includes(key)) && (input.file === undefined || typeof input.file === 'boolean'), `Invalid bug draft: ${fp}.`);
  const generated = title.length <= 255 ? title : `${title.slice(0, 252).replace(/[\uD800-\uDBFF]$/, '')}...`;
  const output = {title: input.title ?? generated, ...(input.severity === undefined ? {} : {severity: input.severity}), ...(input.priority === undefined ? {} : {priority: input.priority}), notes: input.notes ?? ''};
  requireThat(typeof output.title === 'string' && output.title.trim() && output.title.length <= 255 && typeof output.notes === 'string' && output.notes.length <= 4000, `Invalid bug title or notes: ${fp}.`);
  for (const name of ['description', 'expected', 'actual']) if (input[name] !== undefined) {requireThat(typeof input[name] === 'string' && input[name].length <= 16000, `Invalid bug draft ${name}.`); output[name] = input[name];}
  for (const name of ['prerequisites', 'steps']) if (input[name] !== undefined) {requireThat(Array.isArray(input[name]) && input[name].length <= 100 && input[name].every(value => typeof value === 'string' && value.length <= 4000), `Invalid bug draft ${name}.`); output[name] = input[name];}
  if (input.fields !== undefined) {requireThat(input.fields && !Array.isArray(input.fields) && Object.entries(input.fields).length <= 100 && Object.entries(input.fields).every(([name, value]) => /^[A-Za-z][A-Za-z0-9_.]{0,149}$/.test(name) && (structuredFields || ['string', 'number', 'boolean'].includes(typeof value)) && JSON.stringify(value).length <= 16000), 'Invalid bug draft fields.'); output.fields = input.fields;}
  if (input.omitFields !== undefined) {requireThat(Array.isArray(input.omitFields) && input.omitFields.length <= 100 && input.omitFields.every(name => typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_.]{0,149}$/.test(name)), 'Invalid omitted bug fields.'); output.omitFields = input.omitFields;}
  return output;
}
