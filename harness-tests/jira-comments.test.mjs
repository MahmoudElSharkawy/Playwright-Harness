import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures/execution-core.mjs';
import {bindChatReview} from './fixtures/requirements.mjs';
import {createJiraClient} from '../scripts/lib/integrations/jira-client.mjs';
import {captureRequirements, prepareRequirements} from '../scripts/lib/requirements/index.mjs';
import {previewRequirementsComment, publishRequirementsComment, reconcileRequirementsComment} from '../scripts/lib/requirements/comments.mjs';

async function setup(t) {
  const {roots} = fixture(t), comments = [], posts = [], control = {lose: false, changed: false};
  const client = createJiraClient({roots, configuration: {siteUrl: 'https://example.atlassian.net', project: 'DEMO', emailRef: 'JIRA_EMAIL', credentialRef: 'JIRA_TOKEN'}, resolveEmail: () => 'qa@example.test', resolveCredential: () => 'synthetic', fetchImpl: async (url, options) => {
    const path = new URL(url).pathname.split('/rest/api/3/')[1];
    if (path === 'myself') return Response.json({accountId: 'account-1', active: true});
    if (path === 'project/DEMO') return Response.json({id: '10', key: 'DEMO', name: 'Demo'});
    if (path === 'issue/DEMO-1') return Response.json({id: '101', key: 'DEMO-1', fields: {project: {id: '10', key: 'DEMO'}, summary: 'Checkout', description: control.changed ? 'Changed rule.' : 'Display the saved name.', updated: '2026-10-01T00:00:00Z'}});
    if (path === 'issue/DEMO-1/comment') {
      if (options.method === 'POST') {
        const body = JSON.parse(options.body); posts.push(body);
        const comment = {id: String(1000 + comments.length), ...body, updated: '2026-10-01T00:00:00Z', author: {accountId: 'account-1'}}; comments.push(comment);
        if (control.lose) throw Error('response lost'); return Response.json(comment);
      }
      return Response.json({comments, startAt: 0, total: comments.length});
    }
    const match = /^issue\/DEMO-1\/comment\/(\d+)(?:\/properties\/pom-harness.delivery)?$/.exec(path);
    if (match) {
      const comment = comments.find(value => value.id === match[1]);
      return Response.json(path.includes('/properties/') ? comment.properties[0] : comment);
    }
    if (path === 'mypermissions') return Response.json({permissions: {USER_PICKER: {havePermission: true}}});
    if (path === 'user/viewissue/search') return Response.json([{accountId: 'account-2', displayName: 'A Reviewer', active: true, accountType: 'atlassian'}]);
    throw Error('Unexpected fixture route: ' + path);
  }});
  const request = {version: 1, provider: 'jira', project: 'sample-shop', application: 'checkout', storyId: 'DEMO-1', sources: []};
  const source = await captureRequirements(roots, request, {client}); prepareRequirements(roots, 'checkout', source); bindChatReview(roots);
  return {roots, client, control, comments, posts};
}

test('Jira comments use the shared exact-preview approval and durable readback', async t => {
  const f = await setup(t), options = {client: f.client}, plan = await previewRequirementsComment(f.roots, 'checkout', options);
  assert.equal(plan.destination.provider, 'jira'); assert.equal(plan.writes[0].body.body.type, 'doc'); assert.equal(f.posts.length, 0);
  await assert.rejects(publishRequirementsComment(f.roots, 'checkout', {...options, approval: 'yes'}), /confirmation/);
  const result = await publishRequirementsComment(f.roots, 'checkout', {...options, approval: plan.fingerprint});
  assert.equal(result.mode, 'completed'); assert.equal(result.commentId, '1000'); assert.equal(f.posts.length, 1);
  assert.deepEqual(f.posts[0], plan.writes[0].body); assert.match(result.url, /focusedCommentId=1000/);
});

test('Jira uncertain comments reconcile the exact remote marker and never create a duplicate', async t => {
  const f = await setup(t), options = {client: f.client}, plan = await previewRequirementsComment(f.roots, 'checkout', options);
  f.control.lose = true;
  assert.equal((await publishRequirementsComment(f.roots, 'checkout', {...options, approval: plan.fingerprint})).mode, 'uncertain');
  assert.equal((await publishRequirementsComment(f.roots, 'checkout', {...options, approval: plan.fingerprint})).mode, 'reconciliation-required');
  const result = await reconcileRequirementsComment(f.roots, 'checkout', {...options, commentId: '1000'});
  assert.equal(result.mode, 'completed'); assert.equal(f.posts.length, 1);
});

test('Jira content changes invalidate approval even when updated timestamp is unchanged', async t => {
  const f = await setup(t), options = {client: f.client}, plan = await previewRequirementsComment(f.roots, 'checkout', options); f.control.changed = true;
  await assert.rejects(publishRequirementsComment(f.roots, 'checkout', {...options, approval: plan.fingerprint}), /changed|freshness/); assert.equal(f.posts.length, 0);
});
