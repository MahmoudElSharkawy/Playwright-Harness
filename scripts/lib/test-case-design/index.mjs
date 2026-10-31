import {existsSync, mkdirSync, openSync, closeSync, unlinkSync} from 'node:fs';
import {dirname} from 'node:path';
import {consumerPath} from '../consumer-paths.mjs';
import {fingerprint, id, requireThat} from '../execution-core/data.mjs';
import {contextData} from '../context/model.mjs';
import {readBounded, writeJson} from '../execute/storage.mjs';
import {validateLocalSource} from '../local-source.mjs';
import {readRequirements} from '../requirements/index.mjs';
import {consumerIdentity} from '../requirements/sources.mjs';
import {captureDesign, requireFreshDesign} from './sources.mjs';
import {validateDesign, validateAssessment, renderDesign, coverage, selectedIds, proposalFingerprint, preparationSteps, confirmedOutcomes, exactDuplicates, duplicateGaps, readableReference} from './review.mjs';
import {retainReviewEvidence, reviewEvidenceStatus} from './review-evidence.mjs';
import {dependencyGaps} from './references.mjs';
import {withReviewCopy} from './review-copy.mjs';

export const designPath = (roots, designId, name) => {id(designId); return consumerPath(roots, `.harness/state/test-case-design/${designId}/${name}`);};
export function lockDesign(roots, designId) {
  const path = designPath(roots, designId, 'lock'); mkdirSync(dirname(path), {recursive: true});
  let descriptor; try {descriptor = openSync(path, 'wx', 0o600);} catch {throw new Error('Design operation already active, or interrupted lock needs inspection. Preserve state before recovery.');}
  return () => {closeSync(descriptor); unlinkSync(path);};
}
export function readDesign(roots, designId) {
  const pointer = designPath(roots, designId, 'current.json'); if (!existsSync(pointer)) return null;
  const {head} = readBounded(pointer); requireThat(/^[a-f0-9]{64}$/.test(head), 'Invalid design state pointer.');
  const state = contextData(readBounded(designPath(roots, designId, `records/${head}.json`)), 2 * 1024 * 1024);
  requireThat(fingerprint(state) === head && state.version === 1 && state.id === designId && state.consumer === consumerIdentity(roots, state.requirements.project, state.requirements.application), 'Design state changed or belongs to another consumer.');
  requireThat(state.source === fingerprint(state.evidence), 'Captured design evidence changed.');
  if (state.draft) requireThat(state.proposal === proposalFingerprint(state.source, state.draft, state.requirements), 'Design proposal binding changed.');
  if (state.review) requireThat(state.review.proposal === state.proposal && state.assessment === fingerprint(state.review), 'Design assessment binding changed.');
  return {...state, head};
}
export function saveDesignState(roots, designId, input) {
  const {head: previous, ...state} = input, current = readDesign(roots, designId);
  requireThat(current?.head === previous, 'Design changed concurrently; reread before editing.');
  const head = fingerprint(state), path = designPath(roots, designId, `records/${head}.json`);
  if (!existsSync(path)) writeJson(path, state, {exclusive: true, maxNodes: 500000});
  writeJson(designPath(roots, designId, 'current.json'), {head}); return {...state, head};
}
export async function prepareDesign(roots, designId, input, options = {}) {
  const release = lockDesign(roots, designId);
  try {
    const previous = readDesign(roots, designId);
    requireThat(!previous?.delivery || previous.delivery.outcomes.every(row => ['applied', 'unchanged', 'failed'].includes(row.status)), 'Reconcile pending or uncertain delivery before refreshing design.');
    const evidence = await captureDesign(roots, input, options), source = fingerprint(evidence), requirements = evidence.inventory;
    requireThat(!previous || previous.consumer === requirements.consumer, 'Design ID belongs to another project/application.');
    if (previous?.source === source) return previous;
    return saveDesignState(roots, designId, {version: 1, id: designId, consumer: requirements.consumer, analysisId: requirements.analysisId, requirements, evidence, source,
      draft: null, proposal: null, review: null, assessment: null, approvalGeneration: (previous?.approvalGeneration ?? 0) + 1, delivery: null, deliveryHistory: [], created: previous?.created ?? {},
      history: [...(previous?.history ?? []), ...(previous ? [{head: previous.head, source: previous.source, proposal: previous.proposal, reason: 'source-refresh'}] : [])], ...(previous ? {head: previous.head} : {})});
  } finally {release();}
}
export function saveDesign(roots, designId, input) {
  const release = lockDesign(roots, designId);
  try {
    const state = readDesign(roots, designId); requireThat(state, 'Prepare design before reviewing.');
    requireThat(!state.draft || input.head === state.head, 'Design edit needs the current head.');
    requireThat(!state.delivery || state.delivery.outcomes.every(row => ['applied', 'unchanged', 'failed'].includes(row.status)), 'Reconcile pending or uncertain writes before changing content.');
    const requirements = readRequirements(roots, state.analysisId); requireThat(requirements?.head === state.requirements.head, 'Acceptance/source changed; prepare and revalidate the design.');
    const draft = validateDesign(input, state, requirements, {roots}), proposal = proposalFingerprint(state.source, draft, requirements);
    if (proposal === state.proposal) return state;
    return saveDesignState(roots, designId, {...state, draft, proposal, review: null, assessment: null, approvalGeneration: (state.approvalGeneration ?? 0) + 1, delivery: null, deliveryHistory: [],
      history: [...state.history, ...(state.proposal ? [{head: state.head, source: state.source, proposal: state.proposal, reason: 'proposal-edit'}] : [])]});
  } finally {release();}
}
export function assessDesign(roots, designId, input) {
  const release = lockDesign(roots, designId);
  try {
    const state = readDesign(roots, designId); requireThat(state?.draft && !state.delivery, 'Save the full proposal and reconcile delivery before assessment.');
    const review = retainReviewEvidence(roots, state, validateAssessment(input, state));
    return saveDesignState(roots, designId, {...state, review, assessment: fingerprint(review)});
  } finally {release();}
}
export function rejectDesign(roots, designId) {
  const release = lockDesign(roots, designId);
  try {
    const state = readDesign(roots, designId); requireThat(state?.draft && !state.delivery, 'Only an unattempted proposal can be rejected; preserve attempted delivery and reconcile it first.');
    return saveDesignState(roots, designId, {...state, review: null, assessment: null, approvalGeneration: (state.approvalGeneration ?? 0) + 1, history: [...state.history, {head: state.head, proposal: state.proposal, reason: 'rejected'}]});
  } finally {release();}
}
export function designView(roots, designId, selected, options = {}) {
  const state = readDesign(roots, designId); requireThat(state, 'Design is not prepared.');
  return stateToDesignView(roots, state, selected, options);
}
/** Reuse the just-saved immutable state; the copy writer still checks the current head under lock. */
export function stateToDesignView(roots, state, selected, options = {}) {
  if (!state.draft) return state;
  return withReviewCopy(roots, {...state, rendered: renderDesign(state.draft, state), coverage: coverage(state, selected, {roots}), duplicates: exactDuplicates(state), ...(state.delivery || state.deliveryHistory?.length ? {confirmedCoverage: coverage(state, selected, {confirmed: true, roots})} : {})}, options);
}
/** Readable diagnostics from already-loaded state; presentation never changes immutable coverage records. */
export function compactCoverage(value, state) {
  const reference = requirementId => readableReference(state, requirementId);
  const caseIds = row => [...new Set([...(row.caseIds ?? []), ...(state?.draft?.mappings ?? []).filter(mapping => mapping.requirementId === row.requirementId || row.requirementIds?.includes(mapping.requirementId)).map(mapping => mapping.caseId)])];
  const dependency = row => {
    const captured = state?.evidence?.references?.items.find(item => item.id === row.referenceId), excerpt = captured?.source?.parts[0]?.text;
    return {reference: captured?.workItemId ? `Referenced work item #${captured.workItemId}${excerpt ? ' — ' + (excerpt.length > 240 ? excerpt.slice(0, 237) + '...' : excerpt) : ''}` : 'Required reference evidence',
      requirements: (row.requirementIds ?? []).map(reference), caseIds: caseIds(row), status: row.status, reason: row.reason};
  };
  return {complete: value.complete, basis: value.basis,
    gaps: (value.gaps ?? []).map(row => ({reference: reference(row.requirementId), caseIds: caseIds(row), status: row.status, reason: row.reason})),
    dependencies: (value.dependencies ?? []).map(dependency)};
}
/** Opt-in CLI projection. Full state and all detailed renderings remain available through default JSON. */
export function compactDesignResult(result) {
  const presentation = result.presentation ?? result;
  const assessedCoverage = result.coverage && (result.presentation?.coverage ?? compactCoverage(result.coverage, result.requirements && result.evidence ? result : undefined));
  const rejected = !result.review && result.history?.at(-1)?.reason === 'rejected';
  const status = result.mode ?? (rejected ? 'rejected' : result.review ? 'assessed' : result.draft ? 'draft' : result.operations ? 'publication-preview' : result.path ? 'handoff' : 'prepared');
  const coverageNote = assessedCoverage ? assessedCoverage.complete ? ' Accepted coverage is complete.' : ' Accepted coverage is incomplete; resolve the affected case and source decisions below.' : '';
  const summary = result.mode === 'completed' ? `Publication delivery is confirmed for ${result.outcomes.length} cases.${coverageNote} Execution has not run.`
    : result.mode === 'reconciliation-required' ? `Publication needs reconciliation. Reconcile uncertain outcomes before further delivery.${coverageNote} Execution has not run.`
    : result.mode === 'incomplete' ? `Publication delivery is incomplete. Review the failed or pending case outcomes before continuing.${coverageNote} Execution has not run.`
    : rejected ? 'Proposal rejected. Edit the proposal and obtain fresh independent review before handoff or publication.'
    : result.path ? `Reviewed main cases ${(result.selected ?? []).join(', ')} saved for handoff.${coverageNote} Execution has not run.`
    : result.draft ? 'Proposal saved. Independent assessment is required before handoff or publication.'
    : 'Selected sources prepared. Save a source-grounded proposal, then obtain independent assessment.';
  const bindings = Object.fromEntries(['head', 'source', 'sourceFingerprint', 'proposal', 'assessment', 'approval', 'fingerprint', 'approvalGeneration'].filter(key => typeof result[key] === 'string' || typeof result[key] === 'number').map(key => [key, result[key]]));
  return { ...(result.id ? {id: result.id} : {}), status,
    summary: presentation.rendered?.chatSummary ? (rejected ? summary + '\n\n' : '') + presentation.rendered.chatSummary : result.note ?? summary,
    ...(presentation.rendered?.summary ? {counts: presentation.rendered.summary} : {}), ...(presentation.reviewFile ? {reviewFile: presentation.reviewFile} : {}), ...(presentation.nativePreview ? {nativePreview: presentation.nativePreview} : {}), bindings,
    ...(assessedCoverage ? {coverage: assessedCoverage} : {}),
    ...Object.fromEntries(['destination', 'selected', 'fieldPreview', 'preparationPreview', 'confirmed', 'outcomes', 'execution', 'path', 'note'].filter(key => result[key] !== undefined).map(key => [key, result[key]]))};
}
export function requireReviewed(state, selected, roots) {
  requireThat(state?.draft && state.review, 'Independent source-grounding and semantic coverage assessment is required.');
  const evidence = reviewEvidenceStatus(roots, state); requireThat(evidence.valid, evidence.reason);
  const ids = selectedIds(state.draft, selected); requireThat(ids.length > 0, 'Select at least one case.');
  for (const id of ids) {
    const row = state.draft.cases.find(row => row.id === id);
    requireThat(state.review.cases.find(row => row.id === id)?.verdict === 'pass', 'Affected case needs independent review corrections.');
    const gaps = dependencyGaps(state, row.coverageReferences.map(ref => ref.requirementId));
    requireThat(!gaps.length, `Resolve required reference evidence before delivering case ${id}: ${gaps.map(row => `${row.requirementIds.map(requirementId => readableReference(state, requirementId)).join('; ')} (${row.status})`).join(', ')}.`);
    requireThat(!duplicateGaps(state, [id]).length, 'Affected exact-content duplicate needs an independent retain or revise decision.');
    for (const ref of row.coverageReferences) requireThat(state.requirements.inventory.find(row => row.id === ref.requirementId)?.disposition === 'accepted', 'Resolve required business decisions before accepting or publishing the affected case.');
  }
  return ids;
}
export async function designHandoff(roots, designId, options = {}) {
  const release = lockDesign(roots, designId);
  try {
  const state = readDesign(roots, designId), ids = requireReviewed(state, options.selected, roots);
  requireThat(readRequirements(roots, state.analysisId)?.head === state.requirements.head, 'Requirements changed; revalidate before handoff.');
  await requireFreshDesign(roots, state, {...options, selected: ids});
  const source = validateLocalSource({version: 1, id: designId, title: `Reviewed cases: ${designId}`, scenarios: ids.map(id => {
    const row = state.draft.cases.find(row => row.id === id), receipt = confirmedOutcomes(state).find(row => row.caseId === id);
    return {id, title: row.title, steps: [...preparationSteps(row, state.draft.preparations.find(row => row.caseId === id)), ...row.steps].map(step => ({action: step.action, expected: [step.expected]})),
      ...(receipt?.adoId ? {externalReferences: [{system: 'ado', id: String(receipt.adoId)}]} : {})};
  })});
  const mappings = state.draft.mappings.filter(row => ids.includes(row.caseId)).map(mapping => {
    const stepOffset = source.scenarios.find(row => row.id === mapping.caseId).steps.length - state.draft.cases.find(row => row.id === mapping.caseId).steps.length;
    return {...mapping, checks: mapping.checks.map(check => ({...check, step: check.step + stepOffset}))};
  });
  const content = {version: 1, proposal: state.proposal, sourceFingerprint: state.source, selected: ids, source, coverage: coverage(state, ids, {roots}), mappings, execution: 'not-run', automation: 'not-generated', maintenance: 'Accepted revisions affecting existing automation belong to maintain-test; preserve failure history, cumulative budgets, independent review and two fresh scoped green runs.'};
  const identity = fingerprint(content), path = `.harness/sources/test-case-design/${designId}/${identity}.json`, tracePath = `.harness/state/test-case-design/${designId}/handoffs/${identity}.json`, result = {...content, path};
  for (const [relative, value] of [[path, source], [tracePath, result]]) {
    const file = consumerPath(roots, relative);
    if (!existsSync(file)) writeJson(file, value, {exclusive: true});
    else requireThat(fingerprint(readBounded(file)) === fingerprint(value), 'Saved handoff artifact differs from its content-bound identity.');
  }
  return {...result, presentation: {coverage: compactCoverage(result.coverage, state)}};
  } finally {release();}
}
