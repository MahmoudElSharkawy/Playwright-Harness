import test from 'node:test';
import assert from 'node:assert/strict';
import {adoFixture} from './fixtures/ado.mjs';
import {putRequirementFile as put, bindSyntheticReview, nativeDecisions} from './fixtures/requirements.mjs';
import {captureRequirements, prepareRequirements, readRequirements, importDecisions, updateInventory, planningHandoff} from '../scripts/lib/requirements/index.mjs';
import {readStoryComments} from '../scripts/lib/requirements/sources.mjs';
import {previewRequirementsComment, publishRequirementsComment, reconcileRequirementsComment} from '../scripts/lib/requirements/comments.mjs';
import {digest, fingerprint} from '../scripts/lib/execution-core/data.mjs';

async function setup(t) {
  const fixture = await adoFixture(t), {state} = fixture;
  Object.assign(state.items.get(200).fields, {'System.WorkItemType': 'User Story', 'System.Description': '<p>Display the saved name.</p>', 'Microsoft.VSTS.Common.AcceptanceCriteria': '<p>Names allow spaces &amp; special characters.</p>'});
  const discussion = [{id: 1, workItemId: 200, version: 1, text: '<p>Which data is required before saving?</p>'}];
  const control = {loseResponse: false, denyComments: false, page: false, beforePost: null};
  state.fault = ({path, req, res, body, send, url}) => {
    if (path === 'wit/workitems/200/comments') {
      if (control.denyComments) {send({}, 403); return true;}
      if (req.method === 'POST') {
        if (control.beforePost) control.beforePost();
        const comment = {id: discussion.length + 1, workItemId: 200, version: 1, text: body.text}; discussion.push(comment);
        if (control.loseResponse) res.destroy(); else send(comment); return true;
      }
      if (control.page && !url.searchParams.get('continuationToken')) {const nextPage = 'next'; send({comments: discussion.slice(0, 1), totalCount: discussion.length, continuationToken: nextPage}); return true;}
      send({comments: control.page ? discussion.slice(1) : discussion, totalCount: discussion.length}); return true;
    }
    const match = /^wit\/workitems\/200\/comments\/(\d+)$/.exec(path);
    if (match) {send(discussion.find(comment => comment.id === Number(match[1])) ?? {}, discussion.some(comment => comment.id === Number(match[1])) ? 200 : 404); return true;}
  };
  const request = {version: 1, project: 'sample-shop', application: 'checkout', storyId: 200, sources: []};
  const snapshot = await captureRequirements(fixture.roots, request, {client: fixture.client});
  prepareRequirements(fixture.roots, 'checkout', snapshot);
  const review = bindSyntheticReview(fixture.roots), decisions = nativeDecisions(review); put(fixture.roots, 'native.json', decisions); importDecisions(fixture.roots, 'checkout', 'native.json');
  const posts = () => state.requests.filter(request => request.method === 'POST' && request.path.endsWith('/comments'));
  return {...fixture, discussion, control, request, snapshot, decisions, posts};
}

test('story capture automatically includes criteria/discussion, and acceptance stays separate', async t => {
  const f = await setup(t), state = readRequirements(f.roots, 'checkout');
  assert(f.snapshot.parts.some(part => part.kind === 'criterion' && part.text.includes('spaces & special')));
  assert(f.snapshot.parts.some(part => part.kind === 'discussion' && part.text.includes('Which data')));
  assert.equal(state.inventory.find(item => item.kind === 'discussion').disposition, 'needs-decision');
  assert.equal(f.posts().length, 0);
  const entry = state.inventory.find(item => item.kind === 'criterion'), part = f.snapshot.parts.find(part => part.id === entry.partId);
  const accepted = updateInventory(f.roots, 'checkout', {version: 1, snapshot: state.snapshot, changes: [{id: entry.id, disposition: 'accepted', evidence: [{kind: 'source', partId: part.id, revision: part.revision, quote: part.text}], constraints: ['Allow spaces and special characters.'], dependencies: ['Saved name exists.']}]});
  const plan = planningHandoff(f.roots, 'checkout'); assert.equal(plan.inventory, accepted.inventoryPath); assert.equal(plan.analysisInvocations, 1);
  assert.equal(plan.requirements.find(item => item.id === entry.id).disposition, 'accepted');
  assert.equal(plan.requirements.find(item => item.id === state.inventory.find(item => item.kind === 'discussion').id).disposition, 'needs-decision');
});

test('native final comment is previewed exactly, with zero writes until exact confirmation', async t => {
  const f = await setup(t), options = {client: f.client};
  const preview = await previewRequirementsComment(f.roots, 'checkout', options);
  assert.equal(preview.writes[0].body.text, f.decisions.comment); assert.equal(preview.destination.storyId, 200);
  assert.equal(f.posts().length, 0); assert.equal(f.receipts().length, 0);
  await assert.rejects(publishRequirementsComment(f.roots, 'checkout', options), /confirmation/);
  await assert.rejects(publishRequirementsComment(f.roots, 'checkout', {...options, approval: 'yes'}), /confirmation/);
  assert.equal(f.posts().length, 0);
  const result = await publishRequirementsComment(f.roots, 'checkout', {...options, approval: preview.fingerprint});
  assert.equal(result.mode, 'completed'); assert.equal(result.commentId, 2); assert.match(result.url, /discussionId=2/);
  assert.equal(f.posts().length, 1); assert.equal(f.posts()[0].body.text, f.decisions.comment);
  assert(f.receipts()[0].some(event => event.event === 'acknowledged' && event.identity.commentId === 2));
  const repeated = await publishRequirementsComment(f.roots, 'checkout', {...options, approval: preview.fingerprint});
  assert.equal(repeated.commentId, 2); assert.equal(f.posts().length, 1);
});

test('changed source, discussion, inventory or final text rejects the old confirmation', async t => {
  for (const change of ['source', 'discussion', 'inventory', 'text']) {
    const f = await setup(t), options = {client: f.client}, preview = await previewRequirementsComment(f.roots, 'checkout', options);
    if (change === 'source') {f.state.items.get(200).rev++; f.state.items.get(200).fields['System.Description'] = 'Changed rule';}
    if (change === 'discussion') f.discussion.push({id: 9, workItemId: 200, version: 1, text: 'New decision'});
    if (change === 'inventory') {const state = readRequirements(f.roots, 'checkout'); updateInventory(f.roots, 'checkout', {version: 1, snapshot: state.snapshot, changes: [{id: state.inventory[0].id, disposition: 'needs-decision', evidence: []}]});}
    if (change === 'text') {put(f.roots, 'new.json', {...f.decisions, comment: '<p>Different final question.</p>'}); importDecisions(f.roots, 'checkout', 'new.json');}
    await assert.rejects(publishRequirementsComment(f.roots, 'checkout', {...options, approval: preview.fingerprint}), /confirmation|changed|freshness/);
    assert.equal(f.posts().length, 0);
  }
});

test('uncertain response is reconciled before retry, including owner-identified exact comment', async t => {
  const f = await setup(t), options = {client: f.client}, preview = await previewRequirementsComment(f.roots, 'checkout', options);
  f.control.loseResponse = true;
  const uncertain = await publishRequirementsComment(f.roots, 'checkout', {...options, approval: preview.fingerprint});
  assert.equal(uncertain.mode, 'uncertain'); assert.equal(f.posts().length, 1);
  const retry = await publishRequirementsComment(f.roots, 'checkout', {...options, approval: preview.fingerprint});
  assert.equal(retry.mode, 'reconciliation-required'); assert.equal(retry.candidates[0].commentId, 2); assert.equal(f.posts().length, 1);
  await assert.rejects(reconcileRequirementsComment(f.roots, 'checkout', {...options, commentId: 1}), /does not match/);
  const recovered = await reconcileRequirementsComment(f.roots, 'checkout', {...options, commentId: 2});
  assert.equal(recovered.mode, 'completed'); assert.equal(recovered.commentId, 2); assert.equal(f.posts().length, 1);
});

test('durable acknowledgement recovers a failed readback without a second comment', async t => {
  const f = await setup(t), options = {client: f.client}, preview = await previewRequirementsComment(f.roots, 'checkout', options);
  const original = f.state.fault;
  f.state.fault = input => input.path === 'wit/workitems/200/comments/2' ? (input.send({}, 503), true) : original(input);
  assert.equal((await publishRequirementsComment(f.roots, 'checkout', {...options, approval: preview.fingerprint})).mode, 'uncertain');
  const recovered = await reconcileRequirementsComment(f.roots, 'checkout', options);
  assert.equal(recovered.mode, 'completed'); assert.equal(recovered.commentId, 2); assert.equal(f.posts().length, 1);
});

test('inaccessible discussion stays explicit and cannot authorize a comment', async t => {
  const f = await setup(t); f.control.denyComments = true;
  const source = await captureRequirements(f.roots, f.request, {client: f.client});
  assert(source.omissions.some(item => item.sourceId === 'discussion'));
  await assert.rejects(previewRequirementsComment(f.roots, 'checkout', {client: f.client}), /changed|freshness/); assert.equal(f.posts().length, 0);
});

test('discussion pagination includes all concerns and detects an incomplete tail', async t => {
  const f = await setup(t); f.discussion.push({id: 2, workItemId: 200, version: 1, text: 'Another unanswered concern'}); f.control.page = true;
  assert.equal((await readStoryComments(f.client, 200)).length, 2);
  const original = f.state.fault;
  f.state.fault = input => input.path.endsWith('/comments') && input.url.searchParams.get('continuationToken') ? (input.send({comments: [], totalCount: 2}), true) : original(input);
  await assert.rejects(readStoryComments(f.client, 200), /incomplete/);
});

test('only the originating authenticated project can receive the comment', async t => {
  const f = await setup(t), preview = await previewRequirementsComment(f.roots, 'checkout', {client: f.client});
  const foreign = {...f.client, projectIdentity: async () => ({id: 'ffffffff-ffff-ffff-ffff-ffffffffffff', name: 'other'})};
  await assert.rejects(publishRequirementsComment(f.roots, 'checkout', {client: foreign, approval: preview.fingerprint}), /originating/);
  assert.equal(f.posts().length, 0);
});

test('simultaneous confirmations cannot create duplicate comments', async t => {
  const f = await setup(t), options = {client: f.client}, preview = await previewRequirementsComment(f.roots, 'checkout', options);
  const results = await Promise.allSettled([publishRequirementsComment(f.roots, 'checkout', {...options, approval: preview.fingerprint}), publishRequirementsComment(f.roots, 'checkout', {...options, approval: preview.fingerprint})]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal(f.posts().length, 1);
});

test('supplied attachments use bounded context readers and content-bound host extraction', async t => {
  const f = await setup(t), attachmentId = '12345678-1234-1234-1234-123456789012', bytes = Buffer.from('Synthetic PDF bytes');
  f.state.attachments.set(attachmentId, bytes);
  const original = f.state.fault;
  f.state.fault = input => {
    if (input.path === 'wit/attachments/' + attachmentId) {input.res.writeHead(200, {'content-type': 'application/pdf'}); input.res.end(bytes); return true;}
    return original(input);
  };
  f.state.items.get(200).relations.push({rel: 'AttachedFile', url: f.config.organizationUrl + '/_apis/wit/attachments/' + attachmentId, attributes: {name: 'requirements.pdf'}});
  const omitted = await captureRequirements(f.roots, f.request, {client: f.client}); assert(omitted.omissions.some(item => item.reason === 'reader-required'));
  const receipt = {attachmentId, extraction: {hash: digest(bytes), reader: 'synthetic-host-reader', coverage: 'complete', parts: [{location: 'page 1 paragraph 1', text: 'The exported name preserves spaces & punctuation.'}]}};
  const source = await captureRequirements(f.roots, {...f.request, attachments: [receipt]}, {client: f.client});
  assert(source.parts.some(part => part.sourceId === 'ado-attachment-' + attachmentId && part.text.includes('spaces & punctuation')));
  assert(!source.omissions.some(item => item.sourceId === 'ado-attachment-' + attachmentId));
});

test('discussion-only contradiction invalidates old acceptance and planning evidence', async t => {
  const f = await setup(t), state = readRequirements(f.roots, 'checkout'), entry = state.inventory.find(item => item.kind === 'criterion');
  const decision = {version: 1, authority: 'owner', actor: 'Synthetic owner', consumer: state.consumer, snapshot: state.snapshot, requirementId: entry.id, content: entry.content, disposition: 'accepted', statement: 'Names allow spaces & special characters.'};
  put(f.roots, 'owner.json', decision);
  updateInventory(f.roots, 'checkout', {version: 1, snapshot: state.snapshot, changes: [{id: entry.id, disposition: 'accepted', evidence: [{kind: 'decision', path: 'owner.json', fingerprint: fingerprint(decision)}]}]});
  const oldPlan = planningHandoff(f.roots, 'checkout');
  f.discussion.push({id: 2, workItemId: 200, version: 1, text: 'Names must exclude spaces; resolve the earlier rule.'});
  const refreshed = prepareRequirements(f.roots, 'checkout', await captureRequirements(f.roots, f.request, {client: f.client}));
  assert.notEqual(refreshed.inventory.find(item => item.id === entry.id).disposition, 'accepted');
  assert.deepEqual(refreshed.inventory.find(item => item.id === entry.id).evidence, []); assert(refreshed.staleRequirementIds.includes(entry.id));
  assert.equal(planningHandoff(f.roots, 'checkout', oldPlan).staleReferences, true);
});

test('compound ADO criteria support separate source slices and independent acceptance', async t => {
  const f = await setup(t), first = 'Maximum upload size is 10 MB.', second = 'Uploads complete quickly.';
  const item = f.state.items.get(200); item.rev++; item.fields['Microsoft.VSTS.Common.AcceptanceCriteria'] = `<p>${first}</p><p>${second}</p>`;
  const source = await captureRequirements(f.roots, f.request, {client: f.client}), state = prepareRequirements(f.roots, 'checkout', source), entry = state.inventory.find(item => item.kind === 'criterion'), part = source.parts.find(part => part.id === entry.partId);
  const evidence = [{kind: 'source', partId: part.id, revision: part.revision, quote: first}];
  assert.throws(() => updateInventory(f.roots, 'checkout', {version: 1, snapshot: state.snapshot, changes: [{id: entry.id, disposition: 'accepted', evidence}]}), /exact|whole|cover/);
  const split = updateInventory(f.roots, 'checkout', {version: 1, snapshot: state.snapshot, partitions: [{partId: part.id, entries: [{id: entry.id, start: 0, end: first.length}, {id: 'req-performance', start: part.text.indexOf(second), end: part.text.length}]}], changes: [{id: entry.id, disposition: 'accepted', evidence}]});
  const plan = planningHandoff(f.roots, 'checkout'), slices = split.inventory.filter(item => item.partId === part.id);
  assert.equal(slices.length, 2); assert.equal(plan.requirements.find(item => item.id === entry.id).disposition, 'accepted'); assert.equal(plan.requirements.find(item => item.id === 'req-performance').disposition, 'unknown');
  const sizeEntry = slices.find(item => item.id === entry.id), decision = {version: 1, authority: 'owner', actor: 'Synthetic owner', consumer: state.consumer, snapshot: state.snapshot, requirementId: sizeEntry.id, content: sizeEntry.content, disposition: 'accepted', statement: first};
  put(f.roots, 'owner-size.json', decision);
  assert.throws(() => updateInventory(f.roots, 'checkout', {version: 1, snapshot: state.snapshot, partitions: [{partId: part.id, entries: [{id: entry.id, start: 0, end: part.text.length}]}], changes: [{id: entry.id, disposition: 'accepted', evidence: [{kind: 'decision', path: 'owner-size.json', fingerprint: fingerprint(decision)}]}]}), /requirement content/);
  assert.throws(() => updateInventory(f.roots, 'checkout', {version: 1, snapshot: state.snapshot, partitions: [{partId: part.id, entries: [{id: entry.id, start: 0, end: first.length}]}], changes: []}), /coverage|cover/);
});
