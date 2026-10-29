import {fingerprint, requireThat} from '../execution-core/data.mjs';
import {contextData} from '../context/model.mjs';
import {renderCommentDocument} from '../requirements/review.mjs';

const accountId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value);
const commentId = value => {requireThat(/^[1-9]\d{0,19}$/.test(String(value)), 'Invalid Jira comment identity.'); return String(value);};
async function requireDirectory(client) {
  const permissions = await client.read('mypermissions?permissions=USER_PICKER');
  requireThat(permissions?.permissions?.USER_PICKER?.havePermission === true, 'Jira Browse users and groups permission is required to verify mention recipients.');
}
async function people(client, selector) {
  await client.projectIdentity(); await requireDirectory(client);
  const values = new Map();
  // Jira filters each range of the first 1000 users. A short/empty page does not imply completion.
  for (let startAt = 0; startAt < 1000; startAt += 100) {
    const rows = await client.read(`user/viewissue/search?projectKey=${client.configuration.project}&startAt=${startAt}&maxResults=100${selector ? '&accountId=' + encodeURIComponent(selector) : ''}`);
    requireThat(Array.isArray(rows) && rows.length <= 100, 'Jira mention directory is incomplete.');
    for (const value of rows) {
      requireThat(accountId(value.accountId) && typeof value.displayName === 'string' && value.displayName.trim() && value.displayName.length <= 320, 'Jira mention identity is incomplete.');
      if (value.active === true && value.accountType === 'atlassian' && (!selector || value.accountId === selector)) values.set(value.accountId, contextData({id: value.accountId, displayName: value.displayName, uniqueName: value.accountId}));
    }
    if (selector && values.has(selector)) break;
  }
  return [...values.values()];
}
export async function jiraMentionCandidates(client) {
  return {candidates: await people(client), complete: false, detail: 'Jira limits this directory to the first 1000 users. Select an exact account ID; an absent user is unresolved.'};
}
export async function resolveJiraMentions(client, selectors) {
  requireThat(Array.isArray(selectors) && selectors.length <= 30 && selectors.every(accountId), 'Jira mentions require explicitly selected exact account IDs.');
  const result = [];
  for (const selector of new Set(selectors)) {
    const matches = await people(client, selector);
    requireThat(matches.length === 1 && matches[0].id === selector, 'Jira mention account is inactive, inaccessible or unresolved within the project.'); result.push(matches[0]);
  }
  return result;
}
export function jiraComments(client, origin) {
  return {
    revisionId: 'jira-discussion', id: commentId,
    url: `${origin.siteUrl}/browse/${origin.storyId}`,
    link: id => `${origin.siteUrl}/browse/${origin.storyId}?focusedCommentId=${commentId(id)}`,
    candidates: () => jiraMentionCandidates(client), resolveMentions: selectors => resolveJiraMentions(client, selectors),
    async requireDestination() {
      const project = await client.projectIdentity();
      requireThat(origin.provider === 'jira' && client.configuration.siteUrl === origin.siteUrl && String(project.id) === origin.projectId && project.key === origin.project, 'Comment destination differs from the originating Jira story project.');
    },
    write(draft, state, source, mentions) {
      const body = renderCommentDocument(draft, state, source, mentions);
      const marker = fingerprint({consumer: state.consumer, snapshot: state.snapshot, review: state.review, destination: origin, body});
      return {method: 'POST', route: `issue/${origin.storyId}/comment`, body: {body, properties: [{key: 'pom-harness.delivery', value: {marker}}]}};
    },
    matches: (write, comment) => comment.content === fingerprint(write.body.body),
    acknowledged(write, response) {requireThat(response && fingerprint(response.body) === fingerprint(write.body.body), 'Jira comment acknowledgement mismatch.'); return commentId(response.id);},
    async verify(write, id, mentions) {
      const after = await client.read(`issue/${origin.storyId}/comment/${commentId(id)}`);
      requireThat(commentId(after.id) === String(id) && fingerprint(after.body) === fingerprint(write.body.body), 'Jira comment readback mismatch.');
      const property = await client.read(`issue/${origin.storyId}/comment/${id}/properties/pom-harness.delivery`);
      requireThat(property.key === 'pom-harness.delivery' && fingerprint(property.value) === fingerprint(write.body.properties[0].value), 'Jira comment recovery marker mismatch.');
      const ids = []; function visit(node) {if (node.type === 'mention') ids.push(node.attrs?.id); for (const child of node.content ?? []) visit(child);} visit(after.body);
      requireThat(fingerprint([...new Set(ids)].sort()) === fingerprint(mentions.map(person => person.id).sort()), 'Jira comment mentions differ from the approved accounts.');
    }
  };
}
