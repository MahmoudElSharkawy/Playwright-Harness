import {existsSync, readFileSync} from 'node:fs';
import {consumerPath} from '../consumer-paths.mjs';
import {fingerprint, requireThat} from '../execution-core/data.mjs';
import {writeJson, readBounded} from '../execute/storage.mjs';
import {adoId} from '../integrations/config.mjs';
import {captureRequirements, requirementsClient, readStoryComments} from './sources.mjs';
import {readRequirements, readRequirementsSource, readReviewHandoff, lockRequirements, reviewDifferences} from './index.mjs';

const pendingPath = (roots, id) => consumerPath(roots, `.harness/state/requirements/${id}/comment-attempt.json`);
function planFor(roots, id) {
  const state = readRequirements(roots, id); requireThat(state?.review?.snapshot === state.snapshot, 'Review/source binding is incomplete.');
  const source = readRequirementsSource(roots, state), handoff = readReviewHandoff(roots, state);
  requireThat(source.origin, 'Local requirements have no originating story destination; review remains local.');
  const origin = source.origin, url = `${origin.organizationUrl}/${encodeURIComponent(origin.project)}/_workitems/edit/${origin.storyId}`;
  const payload = {version: 1, consumer: state.consumer, snapshot: state.snapshot, inventory: state.head, reviewId: state.review.reviewId, handoff: state.review.handoff.sha256,
    destination: origin, url, writes: [{method: 'POST', route: `wit/workitems/${origin.storyId}/comments?format=html&api-version=7.1-preview.4`, body: {text: handoff.comment}}]};
  return {state, source, plan: {...payload, fingerprint: fingerprint(payload)}};
}
async function requireDestination(client, origin) {
  const project = await client.projectIdentity();
  requireThat(client.configuration.organizationUrl === origin.organizationUrl && project.id.toLowerCase() === origin.projectId.toLowerCase(), 'Comment destination differs from the originating story project.');
}
async function fresh(roots, source, options) {
  const current = await captureRequirements(roots, source.request, options);
  requireThat(current.fingerprint === source.fingerprint && !current.omissions.some(item => !['absent'].includes(item.reason)), 'Requirements/discussion changed or freshness is incomplete. Refresh and reconfirm exact final text.');
}
export async function previewRequirementsComment(roots, id, options = {}) {
  const {source, plan} = planFor(roots, id), client = requirementsClient(roots, options);
  await requireDestination(client, source.origin); await fresh(roots, source, {...options, client});
  return {mode: 'preview', ...plan, differences: reviewDifferences(roots, readRequirements(roots, id))};
}
async function reconcile(roots, id, client, attempt, selectedCommentId) {
  await requireDestination(client, attempt.plan.destination);
  let acknowledged = attempt.commentId;
  if (!acknowledged && attempt.receipt && existsSync(consumerPath(roots, attempt.receipt))) {
    const events = readFileSync(consumerPath(roots, attempt.receipt), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    acknowledged = events.find(event => event.event === 'acknowledged' && event.operation === 'create-comment')?.identity?.commentId;
  }
  const comments = await readStoryComments(client, attempt.plan.destination.storyId);
  const candidates = comments.filter(comment => !comment.deleted && !attempt.beforeIds.includes(comment.id) && comment.text === attempt.plan.writes[0].body.text);
  const identity = acknowledged ?? selectedCommentId;
  if (identity !== undefined) {
    const commentId = adoId(identity); requireThat(candidates.some(comment => comment.id === commentId), 'Selected or acknowledged comment does not match the exact attempted payload and destination.');
    const result = {mode: 'completed', fingerprint: attempt.plan.fingerprint, commentId, url: attempt.plan.url + '?discussionId=' + commentId, receipt: attempt.receipt, reconciled: true};
    writeJson(pendingPath(roots, id), {...attempt, status: 'completed', commentId, result}); return result;
  }
  // An identical new comment is only a candidate, not proof of this request's authorship.
  return {mode: 'reconciliation-required', fingerprint: attempt.plan.fingerprint, candidates: candidates.map(comment => ({commentId: comment.id, url: attempt.plan.url + '?discussionId=' + comment.id})), receipt: attempt.receipt, detail: 'No automatic replay. Resolve the attempt and, if found, identify its exact comment ID.'};
}
export async function reconcileRequirementsComment(roots, id, {commentId, ...options} = {}) {
  const release = lockRequirements(roots, id);
  try {
    const path = pendingPath(roots, id); requireThat(existsSync(path), 'No comment attempt to reconcile.');
    const attempt = readBounded(path); if (attempt.status === 'completed') return attempt.result;
    return await reconcile(roots, id, requirementsClient(roots, options), attempt, commentId);
  } finally {release();}
}
export async function publishRequirementsComment(roots, id, {approval, ...options} = {}) {
  const release = lockRequirements(roots, id);
  try {
    const {source, plan} = planFor(roots, id);
    requireThat(typeof approval === 'string' && approval === plan.fingerprint, 'Explicit confirmation must match the exact preview text, destination, reviewed source and ordered writes.');
    const client = requirementsClient(roots, options), path = pendingPath(roots, id), previous = existsSync(path) ? readBounded(path) : null;
    if (previous) {
      if (previous.status === 'completed' && previous.plan.fingerprint === plan.fingerprint) return previous.result;
      if (previous.status !== 'completed' && previous.status !== 'not-executed') return await reconcile(roots, id, client, previous);
    }
    await requireDestination(client, source.origin); await fresh(roots, source, {...options, client});
    const before = await readStoryComments(client, source.origin.storyId);
    requireThat(fingerprint(before) === source.revisions.find(item => item.id === 'discussion')?.revision, 'Discussion changed immediately before dispatch; refresh and reconfirm.');
    const delivery = client.delivery('story-comment', true, plan.fingerprint);
    const attempt = {version: 1, status: 'dispatching', plan, beforeIds: before.map(comment => comment.id), receipt: delivery.receipt};
    if (previous) writeJson(consumerPath(roots, `.harness/state/requirements/${id}/comment-history/${previous.plan.fingerprint}.json`), previous);
    writeJson(path, attempt);
    try {
      const write = plan.writes[0], response = await delivery.write('create-comment', write.route, write.body, {method: 'POST', onIdentity(identity) {attempt.commentId = identity.commentId; writeJson(path, attempt);}});
      const commentId = adoId(response.id ?? response.commentId);
      requireThat(response.workItemId === source.origin.storyId && response.text === write.body.text, 'Comment acknowledgement mismatch.');
      const after = await client.read(`wit/workitems/${source.origin.storyId}/comments/${commentId}?api-version=7.1-preview.4`);
      requireThat(adoId(after.id ?? after.commentId) === commentId && after.workItemId === source.origin.storyId && after.text === write.body.text && !after.isDeleted, 'Comment readback mismatch.');
      delivery.verified({commentId}); const receipt = delivery.finish();
      const result = {mode: 'completed', fingerprint: plan.fingerprint, commentId, url: plan.url + '?discussionId=' + commentId, receipt: receipt.receipt};
      writeJson(path, {...attempt, status: 'completed', result}); return result;
    } catch (error) {
      attempt.status = error.delivery?.effect === 'not-executed' ? 'not-executed' : 'uncertain'; writeJson(path, attempt);
      return {mode: attempt.status, fingerprint: plan.fingerprint, receipt: delivery.receipt, detail: 'Inspect/reconcile this durable attempt before another delivery. No automatic retry.'};
    }
  } finally {release();}
}
