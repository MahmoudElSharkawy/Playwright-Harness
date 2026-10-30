import {existsSync, readFileSync} from 'node:fs';
import {consumerPath} from '../consumer-paths.mjs';
import {fingerprint, requireThat} from '../execution-core/data.mjs';
import {writeJson, readBounded} from '../execute/storage.mjs';
import {trackerProvider} from '../integrations/selection.mjs';
import {adoComments} from '../integrations/ado-comments.mjs';
import {jiraComments} from '../integrations/jira-comments.mjs';
import {captureRequirements, requirementsClient, readStoryComments} from './sources.mjs';
import {readRequirements, readRequirementsSource, readChatReview, lockRequirements, reviewDifferences} from './index.mjs';
import {renderChatTable, renderComment, renderReviewSummary} from './review.mjs';

const pendingPath = (roots, id) => consumerPath(roots, `.harness/state/requirements/${id}/comment-attempt.json`);
function readAttempt(path) {
  const attempt = readBounded(path), {fingerprint: approved, ...payload} = attempt.plan ?? {};
  requireThat(typeof approved === 'string' && approved === fingerprint(payload), 'Saved comment attempt fingerprint changed. Preserve the attempt and inspect its original approved payload before recovery.');
  return attempt;
}
function nativeComments(client, origin) {
  requireThat(trackerProvider(client) === (origin.provider ?? 'ado'), 'Comment provider differs from the originating story.');
  return origin.provider === 'jira' ? jiraComments(client, origin) : adoComments(client, origin);
}
async function planFor(roots, id, options) {
  const state = readRequirements(roots, id); requireThat(state?.review?.snapshot === state.snapshot, 'Review/source binding is incomplete.');
  const source = readRequirementsSource(roots, state), draft = readChatReview(roots, state);
  requireThat(draft.version === 2, 'Assign severity and save a version-2 chat draft before posting. Previous unrated drafts remain readable.');
  requireThat(source.origin, 'Local requirements have no originating story destination; review remains local.');
  const client = requirementsClient(roots, {...options, provider: source.origin.provider ?? 'ado'}), adapter = nativeComments(client, source.origin); await adapter.requireDestination();
  const mentions = await adapter.resolveMentions(draft.mentions), comment = renderComment(draft, state, source, mentions);
  const origin = source.origin, url = adapter.url;
  const payload = {version: 1, consumer: state.consumer, snapshot: state.snapshot, inventory: state.head, reviewId: state.review.reviewId, draft: state.review.revision,
    destination: origin, url, mentions, summary: renderReviewSummary(draft), comment: comment.text, table: renderChatTable(draft, state, source),
    writes: [adapter.write(draft, state, source, mentions)]};
  return {state, source, client, adapter, draft, plan: {...payload, fingerprint: fingerprint(payload)}};
}
export async function requirementsTeamMembers(roots, id, options = {}) {
  const state = readRequirements(roots, id); requireThat(state, 'Prepare requirements before resolving team members.');
  const source = readRequirementsSource(roots, state); requireThat(source.origin, 'Local requirements have no originating team directory.');
  const client = requirementsClient(roots, {...options, provider: source.origin.provider ?? 'ado'}), adapter = nativeComments(client, source.origin); await adapter.requireDestination();
  return adapter.candidates();
}
async function fresh(roots, source, options) {
  const current = await captureRequirements(roots, source.request, options);
  requireThat(current.fingerprint === source.fingerprint && !current.omissions.some(item => !['absent'].includes(item.reason)), 'Requirements/discussion changed or freshness is incomplete. Refresh and reconfirm exact final text.');
}
export async function previewRequirementsComment(roots, id, options = {}) {
  const {source, plan, client} = await planFor(roots, id, options);
  await fresh(roots, source, {...options, client});
  return {mode: 'preview', ...plan, differences: reviewDifferences(roots, readRequirements(roots, id))};
}
async function reconcile(roots, id, client, attempt, selectedCommentId) {
  const adapter = nativeComments(client, attempt.plan.destination); await adapter.requireDestination();
  let acknowledged = attempt.commentId;
  if (!acknowledged && attempt.receipt && existsSync(consumerPath(roots, attempt.receipt))) {
    const events = readFileSync(consumerPath(roots, attempt.receipt), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    acknowledged = events.find(event => event.event === 'acknowledged' && event.operation === 'create-comment')?.identity?.commentId;
  }
  const comments = await readStoryComments(client, attempt.plan.destination.storyId);
  const candidates = comments.filter(comment => !comment.deleted && !attempt.beforeIds.includes(comment.id) && adapter.matches(attempt.plan.writes[0], comment));
  const identity = acknowledged ?? selectedCommentId;
  if (identity !== undefined) {
    const commentId = adapter.id(identity); requireThat(candidates.some(comment => comment.id === commentId), 'Selected or acknowledged comment does not match the exact attempted payload and destination.');
    await adapter.verify(attempt.plan.writes[0], commentId, attempt.plan.mentions ?? []);
    const result = {mode: 'completed', fingerprint: attempt.plan.fingerprint, commentId, url: adapter.link(commentId), receipt: attempt.receipt, reconciled: true};
    writeJson(pendingPath(roots, id), {...attempt, status: 'completed', commentId, result}); return result;
  }
  // An identical new comment is only a candidate, not proof of this request's authorship.
  return {mode: 'reconciliation-required', fingerprint: attempt.plan.fingerprint, candidates: candidates.map(comment => ({commentId: comment.id, url: adapter.link(comment.id)})), receipt: attempt.receipt, detail: 'No automatic replay. Resolve the attempt and, if found, identify its exact comment ID.'};
}
export async function reconcileRequirementsComment(roots, id, {commentId, ...options} = {}) {
  const release = lockRequirements(roots, id);
  try {
    const path = pendingPath(roots, id); requireThat(existsSync(path), 'No comment attempt to reconcile.');
    const attempt = readAttempt(path); if (attempt.status === 'completed') return attempt.result;
    return await reconcile(roots, id, requirementsClient(roots, {...options, provider: attempt.plan.destination.provider ?? 'ado'}), attempt, commentId);
  } finally {release();}
}
export async function publishRequirementsComment(roots, id, {approval, ...options} = {}) {
  const release = lockRequirements(roots, id);
  try {
    // Resolve unfinished attempts first, even if the source/draft/roster has since changed.
    const path = pendingPath(roots, id), previous = existsSync(path) ? readAttempt(path) : null;
    if (previous && previous.status !== 'completed' && previous.status !== 'not-executed') return await reconcile(roots, id, requirementsClient(roots, {...options, provider: previous.plan.destination.provider ?? 'ado'}), previous);
    const {source, plan, client, adapter, draft} = await planFor(roots, id, options);
    requireThat(typeof approval === 'string' && approval === plan.fingerprint, 'Explicit confirmation must match the exact preview text, destination, reviewed source and ordered writes.');
    if (previous) {
      if (previous.status === 'completed' && previous.plan.fingerprint === plan.fingerprint) return previous.result;
    }
    await adapter.requireDestination(); await fresh(roots, source, {...options, client});
    requireThat(fingerprint(await adapter.resolveMentions(draft.mentions)) === fingerprint(plan.mentions), 'Mention recipients changed before dispatch. Preview and reconfirm.');
    const before = await readStoryComments(client, source.origin.storyId);
    requireThat(fingerprint(before) === source.revisions.find(item => item.id === adapter.revisionId)?.revision, 'Discussion changed immediately before dispatch; refresh and reconfirm.');
    const delivery = client.delivery('story-comment', true, plan.fingerprint);
    const attempt = {version: 1, status: 'dispatching', plan, beforeIds: before.map(comment => comment.id), receipt: delivery.receipt};
    if (previous) writeJson(consumerPath(roots, `.harness/state/requirements/${id}/comment-history/${previous.plan.fingerprint}.json`), previous);
    writeJson(path, attempt);
    try {
      const write = plan.writes[0], response = await delivery.write('create-comment', write.route, write.body, {method: 'POST', onIdentity(identity) {attempt.commentId = identity.commentId; writeJson(path, attempt);}});
      const commentId = adapter.acknowledged(write, response);
      await adapter.verify(write, commentId, plan.mentions);
      delivery.verified({commentId}); const receipt = delivery.finish();
      const result = {mode: 'completed', fingerprint: plan.fingerprint, commentId, url: adapter.link(commentId), receipt: receipt.receipt};
      writeJson(path, {...attempt, status: 'completed', result}); return result;
    } catch (error) {
      attempt.status = error.delivery?.effect === 'not-executed' ? 'not-executed' : 'uncertain'; writeJson(path, attempt);
      return {mode: attempt.status, fingerprint: plan.fingerprint, receipt: delivery.receipt, detail: 'Inspect/reconcile this durable attempt before another delivery. No automatic retry.'};
    }
  } finally {release();}
}
