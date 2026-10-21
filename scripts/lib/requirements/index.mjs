import {existsSync, mkdirSync, openSync, closeSync, unlinkSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {consumerPath} from '../consumer-paths.mjs';
import {fingerprint, id, requireThat} from '../execution-core/data.mjs';
import {contextData} from '../context/model.mjs';
import {writeJson, readBounded} from '../execute/storage.mjs';
import {captureRequirements, consumerIdentity} from './sources.mjs';
import {validateReviewInput, validateFindings, renderChatTable, renderReviewSummary} from './review.mjs';
export {captureRequirements} from './sources.mjs';

export const requirementBase = (roots, analysisId) => {id(analysisId); return consumerPath(roots, `.harness/state/requirements/${analysisId}`);};
const file = (roots, analysisId, name) => consumerPath(roots, join(requirementBase(roots, analysisId), name));
function inventoryEntry(part, requirementId, start = 0, end = part.text.length) {
  return {id: requirementId, partId: part.id, start, end, location: part.location, revision: part.revision, partContent: fingerprint(part), content: fingerprint({part, start, end}), kind: part.kind,
    disposition: part.kind === 'discussion' ? 'needs-decision' : 'unknown', evidence: [], assumptions: [], questions: [], constraints: [], dependencies: []};
}
export function lockRequirements(roots, analysisId) {
  const path = file(roots, analysisId, 'lock'); mkdirSync(dirname(path), {recursive: true});
  let descriptor; try {descriptor = openSync(path, 'wx', 0o600);} catch {throw new Error('Requirements operation is already active, or an interrupted operation needs inspection. Preserve state and inspect the lock before recovery.');}
  return () => {closeSync(descriptor); unlinkSync(path);};
}
export function readRequirements(roots, analysisId) {
  const pointer = file(roots, analysisId, 'current.json'); if (!existsSync(pointer)) return null;
  const {head} = readBounded(pointer);
  requireThat(typeof head === 'string' && /^[a-f0-9]{64}$/.test(head), 'Invalid requirements state pointer.');
  const record = file(roots, analysisId, `records/${head}.json`), state = contextData(readBounded(record));
  requireThat(fingerprint(state) === head && state.version === 1 && state.analysisId === analysisId && state.consumer === consumerIdentity(roots, state.project, state.application), 'Requirements state belongs to another consumer or is incomplete.');
  return {...state, head, inventoryPath: `.harness/state/requirements/${analysisId}/records/${head}.json`};
}
export function saveRequirements(roots, analysisId, input) {
  const {head: previous, inventoryPath, ...state} = input, current = readRequirements(roots, analysisId);
  requireThat((current?.head ?? undefined) === previous, 'Requirements changed during this operation; reread before updating.');
  const safe = contextData(state), head = fingerprint(safe), path = file(roots, analysisId, `records/${head}.json`);
  if (!existsSync(path)) writeJson(path, safe, {exclusive: true});
  writeJson(file(roots, analysisId, 'current.json'), {head});
  return readRequirements(roots, analysisId);
}
export function readRequirementsSource(roots, state) {
  const source = contextData(readBounded(file(roots, state.analysisId, `sources/${state.snapshot}.json`)));
  const {fingerprint: hash, ...content} = source;
  requireThat(hash === state.snapshot && fingerprint(content) === hash && source.consumer === state.consumer, 'Captured requirements source changed.'); return source;
}
export function prepareRequirements(roots, analysisId, raw) {
  const release = lockRequirements(roots, analysisId);
  try {
    const source = contextData(raw), {fingerprint: hash, ...content} = source;
    requireThat(hash === fingerprint(content) && source.consumer === consumerIdentity(roots, source.request.project, source.request.application), 'Source snapshot consumer/content mismatch.');
    const previous = readRequirements(roots, analysisId);
    requireThat(!previous || previous.consumer === source.consumer, 'Analysis ID belongs to another project/application.');
    if (previous?.snapshot === hash) return previous;
    const inventory = source.parts.flatMap(part => {
      const before = (previous?.inventory ?? []).filter(item => item.partId === part.id), unchanged = before.length && before.every(item => item.partContent === fingerprint(part));
      if (unchanged) return before.map(item => ({...item, disposition: item.disposition === 'accepted' ? part.kind === 'discussion' ? 'needs-decision' : 'unknown' : item.disposition, evidence: []}));
      return [inventoryEntry(part, before[0]?.id ?? 'req-' + part.id.slice(0, 24))];
    });
    const sourcePath = file(roots, analysisId, `sources/${hash}.json`); if (!existsSync(sourcePath)) writeJson(sourcePath, source, {exclusive: true});
    const staleRequirementIds = (previous?.inventory ?? []).filter(item => item.disposition === 'accepted' || item.evidence.length > 0 || !inventory.some(next => item.id === next.id && item.content === next.content)).map(item => item.id);
    return saveRequirements(roots, analysisId, {version: 1, analysisId, consumer: source.consumer, project: source.request.project, application: source.request.application, snapshot: hash, inventory,
      omissions: source.omissions, staleRequirementIds, analysisInvocations: previous?.analysisInvocations ?? 0,
      priorReviews: [...(previous?.priorReviews ?? []), ...(previous?.review ? [{...previous.review, stale: true, snapshot: previous.snapshot}] : [])], review: null, ...(previous ? {head: previous.head} : {})});
  } finally {release();}
}
export function updateInventory(roots, analysisId, raw) {
  const release = lockRequirements(roots, analysisId);
  try {
    const state = readRequirements(roots, analysisId), input = contextData(raw), source = readRequirementsSource(roots, state);
    const changes = input.changes ?? [];
    requireThat(input.version === 1 && input.snapshot === state.snapshot && Array.isArray(changes) && new Set(changes.map(item => item.id)).size === changes.length, 'Inventory changes need the current snapshot and distinct IDs.');
    if (input.partitions !== undefined) {
      requireThat(!state.review && Array.isArray(input.partitions) && new Set(input.partitions.map(item => item.partId)).size === input.partitions.length, 'Partition source statements before starting the review.');
      for (const partition of input.partitions) {
        const part = source.parts.find(part => part.id === partition.partId), entries = [];
        requireThat(part && Array.isArray(partition.entries) && partition.entries.length > 0 && partition.entries.length <= 500, 'Inventory partition needs an existing source part and bounded entries.');
        let cursor = 0;
        for (const entry of partition.entries) {
          id(entry.id);
          requireThat(Number.isSafeInteger(entry.start) && Number.isSafeInteger(entry.end) && entry.start >= cursor && entry.end > entry.start && entry.end <= part.text.length && !part.text.slice(cursor, entry.start).trim(), 'Inventory slices must cover source text exactly once without overlap.');
          requireThat(!/[\uDC00-\uDFFF]/.test(part.text[entry.start]) && !/[\uDC00-\uDFFF]/.test(part.text[entry.end] ?? ''), 'Inventory slices cannot split a Unicode character.');
          entries.push(inventoryEntry(part, entry.id, entry.start, entry.end)); cursor = entry.end;
        }
        requireThat(!part.text.slice(cursor).trim(), 'Inventory coverage must retain every supplied statement.');
        const replaced = state.inventory.filter(entry => entry.partId === part.id);
        state.inventory = [...state.inventory.filter(entry => entry.partId !== part.id), ...entries];
        requireThat(new Set(state.inventory.map(entry => entry.id)).size === state.inventory.length, 'Inventory requirement IDs must stay unique.');
        state.staleRequirementIds = [...new Set([...state.staleRequirementIds, ...replaced.filter(entry => !entries.some(next => next.id === entry.id && next.content === entry.content)).map(entry => entry.id)])];
      }
    }
    for (const change of changes) {
      const entry = state.inventory.find(item => item.id === change.id), part = entry && source.parts.find(part => part.id === entry.partId);
      requireThat(entry && ['accepted', 'proposed', 'unknown', 'needs-decision'].includes(change.disposition) && Array.isArray(change.evidence), 'Invalid inventory decision.');
      for (const evidence of change.evidence) {
        if (evidence.kind === 'source') requireThat(part.kind === 'criterion' && evidence.partId === part.id && evidence.revision === part.revision && typeof evidence.quote === 'string' && evidence.quote.trim() && part.text.slice(entry.start, entry.end) === evidence.quote, 'Acceptance requires an exact source criterion covering the whole selected entry.');
        else {
          requireThat(evidence.kind === 'decision' && typeof evidence.path === 'string', 'Finding dispositions cannot accept business rules.');
          const decision = contextData(readBounded(consumerPath(roots, evidence.path)));
          requireThat(fingerprint(decision) === evidence.fingerprint && decision.version === 1 && decision.authority === 'owner' && typeof decision.actor === 'string' && decision.actor.trim() && decision.consumer === state.consumer && decision.snapshot === state.snapshot && decision.requirementId === entry.id && decision.content === entry.content && decision.disposition === change.disposition && typeof decision.statement === 'string' && decision.statement.trim(), 'Acceptance requires a recorded, current explicit owner decision bound to this requirement content.');
        }
      }
      requireThat(change.disposition !== 'accepted' || change.evidence.length > 0, 'Accepted requirements need explicit acceptance evidence.');
      entry.disposition = change.disposition; entry.evidence = change.evidence;
      for (const key of ['assumptions', 'questions', 'constraints', 'dependencies']) if (change[key] !== undefined) {
        requireThat(Array.isArray(change[key]) && change[key].length <= 100 && change[key].every(value => typeof value === 'string' && value.trim()), 'Inventory notes need bounded explicit values.'); entry[key] = change[key];
      }
    }
    return saveRequirements(roots, analysisId, state);
  } finally {release();}
}
export const isChatReview = review => ['chat-v1', 'chat-v2'].includes(review?.format);
export function readChatReview(roots, state, review = state.review) {
  requireThat(isChatReview(review), 'Legacy review artifacts are preserved. Create a chat draft after inspecting them; legacy exports/approvals cannot authorize publication.');
  const draft = contextData(readBounded(consumerPath(roots, review.path)));
  requireThat(fingerprint(draft) === review.revision && draft.version === (review.format === 'chat-v1' ? 1 : 2) && draft.consumer === state.consumer && draft.analysisId === state.analysisId && draft.snapshot === review.snapshot && draft.reviewId === review.reviewId, 'Chat draft content or consumer/source/review binding changed.');
  const source = readRequirementsSource(roots, {...state, snapshot: review.snapshot});
  validateFindings(draft.findings, state.snapshot === review.snapshot ? state.inventory : draft.inventory, source, {legacy: draft.version === 1});
  return draft;
}
export function saveChatReview(roots, analysisId, raw) {
  const release = lockRequirements(roots, analysisId);
  try {
    const state = readRequirements(roots, analysisId); requireThat(state, 'Prepare requirements before reviewing.');
    const source = readRequirementsSource(roots, state), input = validateReviewInput(raw, state, source);
    const previous = isChatReview(state.review) ? state.review : null;
    if (previous) readChatReview(roots, state);
    else {
      if (state.review) state.priorReviews.push({...state.review, stale: true});
      state.analysisInvocations++;
    }
    const reviewId = previous?.reviewId ?? randomUUID();
    // Retain slice boundaries only to validate historical findings after a source refresh.
    const draft = contextData({version: 2, analysisId, consumer: state.consumer, snapshot: state.snapshot, reviewId,
      parent: previous?.revision ?? null, inventory: state.inventory.map(({id, partId, start, end}) => ({id, partId, start, end})), ...input});
    const revision = fingerprint(draft), path = `.harness/state/requirements/${analysisId}/reviews/${reviewId}/${revision}.json`;
    if (!existsSync(consumerPath(roots, path))) writeJson(consumerPath(roots, path), draft, {exclusive: true});
    state.review = {format: 'chat-v2', reviewId, snapshot: state.snapshot, revision, path, status: 'draft'};
    const saved = saveRequirements(roots, analysisId, state);
    return {...saved, draft, summary: renderReviewSummary(draft), table: renderChatTable(draft, saved, source), differences: reviewDifferences(roots, saved)};
  } finally {release();}
}
export function resumeRequirementsReview(roots, analysisId) {
  const state = readRequirements(roots, analysisId); requireThat(state?.review, 'Prepare and save a chat review before resuming.');
  const draft = readChatReview(roots, state), source = readRequirementsSource(roots, state);
  return {...state, draft, summary: renderReviewSummary(draft), table: renderChatTable(draft, state, source), differences: reviewDifferences(roots, state)};
}
export function reviewDifferences(roots, state) {
  const previous = state.priorReviews.at(-1);
  if (!previous) return null;
  const oldDraft = isChatReview(previous) ? readChatReview(roots, state, previous) : null;
  const newDraft = isChatReview(state.review) ? readChatReview(roots, state) : null;
  const before = oldDraft?.findings ?? [], after = newDraft?.findings ?? [];
  const oldFindings = new Map(before.map(finding => [finding.id, finding])), newFindings = new Map(after.map(finding => [finding.id, finding]));
  const changedFindingIds = [...new Set([...oldFindings.keys(), ...newFindings.keys()])].filter(id => !oldFindings.has(id) || !newFindings.has(id) || fingerprint(oldFindings.get(id)) !== fingerprint(newFindings.get(id)));
  const affectedFindingIds = [...new Set([...changedFindingIds, ...before.filter(finding => finding.sources.some(reference => state.staleRequirementIds.includes(reference.requirementId))).map(finding => finding.id)])];
  return {previousSnapshot: previous.snapshot, currentSnapshot: state.snapshot, changedSource: previous.snapshot !== state.snapshot,
    staleRequirementIds: state.staleRequirementIds, changedFindingIds, affectedFindingIds, previousComment: oldDraft?.comment ?? null, currentComment: newDraft?.comment ?? null,
    beforeFindings: before, afterFindings: after, carriedDecisions: [], ...(oldDraft ? {} : {legacyArtifacts: previous}),
    action: 'Reassess source passages and finding meaning; preserve manual text and obtain approval for the exact current comment and recipients.'};
}
export function planningHandoff(roots, analysisId, previous) {
  const state = readRequirements(roots, analysisId); requireThat(state, 'Prepare requirements before planning.');
  const source = readRequirementsSource(roots, state);
  return {version: 1, consumer: state.consumer, snapshot: state.snapshot, inventory: state.inventoryPath,
    requirements: state.inventory.map(({id, partId, start, end, revision, content, disposition, evidence, assumptions, questions, constraints, dependencies}) => ({id, partId, start, end, revision, content, disposition, evidence, assumptions, questions, constraints, dependencies})),
    omissions: source.omissions, review: state.review ? {reviewId: state.review.reviewId, path: state.review.path ?? state.review.root, format: state.review.format ?? 'legacy', status: state.review.status} : null,
    staleReferences: previous ? previous.consumer !== state.consumer || previous.snapshot !== state.snapshot || previous.inventory !== state.inventoryPath : false, staleRequirementIds: state.staleRequirementIds, analysisInvocations: state.analysisInvocations};
}
