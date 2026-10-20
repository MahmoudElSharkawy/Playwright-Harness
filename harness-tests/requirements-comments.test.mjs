import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {adoFixture} from './fixtures/ado.mjs';
import {putRequirementFile as put, bindChatReview, chatInput} from './fixtures/requirements.mjs';
import {captureRequirements, prepareRequirements, readRequirements, readChatReview, saveChatReview, saveRequirements, updateInventory, planningHandoff} from '../scripts/lib/requirements/index.mjs';
import {readStoryComments} from '../scripts/lib/requirements/sources.mjs';
import {previewRequirementsComment, publishRequirementsComment, reconcileRequirementsComment} from '../scripts/lib/requirements/comments.mjs';
import {digest, fingerprint} from '../scripts/lib/execution-core/data.mjs';

async function setup(t) {
  const fixture = await adoFixture(t), {state} = fixture;
  Object.assign(state.items.get(200).fields, {'System.WorkItemType': 'User Story', 'System.Description': '<p>Display the saved name.</p>', 'Microsoft.VSTS.Common.AcceptanceCriteria': '<p>Names allow spaces &amp; special characters.</p>'});
  const discussion = [{id: 1, workItemId: 200, version: 1, text: '<p>Which data is required before saving?</p>'}];
  const control = {loseResponse: false, denyComments: false, page: false, beforePost: null, transformComment: null};
  state.fault = ({path, req, res, body, send, url}) => {
    if (path === 'wit/workitems/200/comments') {
      if (control.denyComments) {send({}, 403); return true;}
      if (req.method === 'POST') {
        if (control.beforePost) control.beforePost();
        const mentions = [...body.text.matchAll(/data-vss-mention="version:2\.0,([a-f0-9-]{36})"/g)].map(match => ({artifactType: 'person', targetId: match[1]}));
        const comment = {id: discussion.length + 1, workItemId: 200, version: 1, text: control.transformComment?.(body.text) ?? body.text, mentions}; discussion.push(comment);
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
  const review = bindChatReview(fixture.roots), decisions = readChatReview(fixture.roots, review);
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

test('chat final comment is previewed exactly, with zero writes until exact confirmation', async t => {
  const f = await setup(t), options = {client: f.client};
  const preview = await previewRequirementsComment(f.roots, 'checkout', options);
  assert.equal(preview.comment, preview.summary + '\n\n' + f.decisions.comment);
  assert.match(preview.summary, /^\*\*Summary: 1 finding — 1 gap, 0 contradictions\*\*\\\n🔴 \*\*High: 0\*\* · 🟠 \*\*Medium: 1\*\* · 🔵 \*\*Low: 0\*\*/);
  assert(preview.writes[0].body.text.endsWith('<p>' + f.decisions.comment + '</p>')); assert.equal(preview.destination.storyId, 200);
  assert(preview.writes[0].body.text.indexOf('Summary: 1 finding') < preview.writes[0].body.text.indexOf(f.decisions.comment));
  assert.equal(f.posts().length, 0); assert.equal(f.receipts().length, 0);
  await assert.rejects(publishRequirementsComment(f.roots, 'checkout', options), /confirmation/);
  await assert.rejects(publishRequirementsComment(f.roots, 'checkout', {...options, approval: 'yes'}), /confirmation/);
  assert.equal(f.posts().length, 0);
  const result = await publishRequirementsComment(f.roots, 'checkout', {...options, approval: preview.fingerprint});
  assert.equal(result.mode, 'completed'); assert.equal(result.commentId, 2); assert.match(result.url, /discussionId=2/);
  assert.equal(f.posts().length, 1); assert.equal(f.posts()[0].body.text, preview.writes[0].body.text);
  assert(f.receipts()[0].some(event => event.event === 'acknowledged' && event.identity.commentId === 2));
  const repeated = await publishRequirementsComment(f.roots, 'checkout', {...options, approval: preview.fingerprint});
  assert.equal(repeated.commentId, 2); assert.equal(f.posts().length, 1);
});

test('changed source, discussion, inventory, final text, severity or finding rejects old confirmation', async t => {
  for (const change of ['source', 'discussion', 'inventory', 'text', 'severity', 'finding']) {
    const f = await setup(t), options = {client: f.client}, preview = await previewRequirementsComment(f.roots, 'checkout', options);
    if (change === 'source') {f.state.items.get(200).rev++; f.state.items.get(200).fields['System.Description'] = 'Changed rule';}
    if (change === 'discussion') f.discussion.push({id: 9, workItemId: 200, version: 1, text: 'New decision'});
    if (change === 'inventory') {const state = readRequirements(f.roots, 'checkout'); updateInventory(f.roots, 'checkout', {version: 1, snapshot: state.snapshot, changes: [{id: state.inventory[0].id, disposition: 'needs-decision', evidence: []}]});}
    if (change === 'text') {const state = readRequirements(f.roots, 'checkout'); saveChatReview(f.roots, 'checkout', chatInput(state, f.decisions.findings, {comment: 'Different final question.'}));}
    if (change === 'severity' || change === 'finding') {
      const state = readRequirements(f.roots, 'checkout'), findings = f.decisions.findings.map(finding => ({...finding, [change]: change === 'severity' ? 'High' : 'Revised business concern'}));
      saveChatReview(f.roots, 'checkout', chatInput(state, findings, {comment: f.decisions.comment}));
      const revised = await previewRequirementsComment(f.roots, 'checkout', options);
      if (change === 'severity') assert.notEqual(revised.summary, preview.summary);
      else {assert.equal(revised.summary, preview.summary); assert.notEqual(revised.table, preview.table);}
    }
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
  await assert.rejects(reconcileRequirementsComment(f.roots, 'checkout', options), /503/); assert.equal(f.posts().length, 1);
  f.state.fault = original;
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

const analystId = '77777777-7777-7777-7777-777777777777', developerId = '88888888-8888-8888-8888-888888888888', teamId = '99999999-9999-9999-9999-999999999999';
function roster(f) {
  const people = [{identity: {id: analystId, displayName: 'Sam Analyst', uniqueName: 'sam@example.test', descriptor: 'aad.' + Buffer.from(analystId).toString('base64url')}}, {identity: {id: developerId, displayName: 'Dev Engineer', uniqueName: 'dev@example.test', descriptor: 'aad.' + Buffer.from(developerId).toString('base64url')}}];
  const original = f.state.fault, base = `projects/${f.state.project.id}/teams`;
  f.state.fault = input => {
    if (input.path === base || input.path === base + '/' + teamId + '/members') {
      const all = input.path === base ? [{id: teamId, name: 'Shop'}] : people, skip = Number(input.url.searchParams.get('$skip')), value = all.slice(skip, skip + 100);
      input.send({value, count: value.length}); return true;
    }
    return original(input);
  };
  return people;
}
function edit(f, extra) {
  const state = readRequirements(f.roots, 'checkout'), draft = readChatReview(f.roots, state);
  return saveChatReview(f.roots, 'checkout', chatInput(state, draft.findings, {comment: draft.comment, mentions: draft.mentions, ...extra}));
}

test('one approved story comment contains the chat table and native resolved person mentions', async t => {
  const f = await setup(t); roster(f); edit(f, {comment: null, mentions: ['sam@example.test', analystId]});
  const options = {client: f.client}, preview = await previewRequirementsComment(f.roots, 'checkout', options);
  assert.equal(preview.mentions.length, 1); assert.equal(preview.mentions[0].id, analystId); assert.match(preview.table, /^\| Findings \| Type \| Severity \|/);
  assert.equal(preview.comment, preview.summary + '\n\n' + preview.table);
  assert.match(preview.table, /\*\*Description:\*\* /);
  for (const output of [preview.comment, preview.writes[0].body.text]) {
    assert(!/System\.Description|Microsoft\.VSTS|story \/|\(revision /.test(output));
    for (const entry of readRequirements(f.roots, 'checkout').inventory) assert(!output.includes(entry.id));
  }
  assert.match(preview.writes[0].body.text, /<table>/); assert.match(preview.writes[0].body.text, new RegExp('data-vss-mention="version:2.0,' + analystId));
  assert.equal(f.posts().length, 0);
  const result = await publishRequirementsComment(f.roots, 'checkout', {...options, approval: preview.fingerprint});
  assert.equal(result.mode, 'completed'); assert.equal(f.posts().length, 1); assert.equal(result.commentId, 2);
  assert.deepEqual(f.discussion.at(-1).mentions.map(value => value.targetId), [analystId]);
  assert.equal((await publishRequirementsComment(f.roots, 'checkout', {...options, approval: preview.fingerprint})).commentId, 2); assert.equal(f.posts().length, 1);
});

test('renamed, removed, inactive or user-edited recipients invalidate old publication approval', async t => {
  for (const kind of ['renamed', 'removed', 'inactive', 'edited']) {
    const f = await setup(t), people = roster(f); edit(f, {mentions: [analystId]});
    const options = {client: f.client}, preview = await previewRequirementsComment(f.roots, 'checkout', options);
    if (kind === 'renamed') people[0].identity.displayName = 'Renamed Analyst';
    if (kind === 'removed') people.splice(0, 1);
    if (kind === 'inactive') people[0].identity.inactive = true;
    if (kind === 'edited') edit(f, {mentions: [developerId]});
    await assert.rejects(publishRequirementsComment(f.roots, 'checkout', {...options, approval: preview.fingerprint}), /confirmation|missing|inactive/);
    assert.equal(f.posts().length, 0);
  }
});

test('mention identity is rechecked after source freshness reads and before dispatch', async t => {
  const f = await setup(t), people = roster(f); edit(f, {mentions: [analystId]});
  const options = {client: f.client}, preview = await previewRequirementsComment(f.roots, 'checkout', options), original = f.state.fault;
  f.state.fault = input => {if (input.path === 'wit/workitems/200' && input.req.method === 'GET') people[0].identity.displayName = 'Changed during source read'; return original(input);};
  await assert.rejects(publishRequirementsComment(f.roots, 'checkout', {...options, approval: preview.fingerprint}), /recipients changed/); assert.equal(f.posts().length, 0);
});

test('missing mention readback remains uncertain and reconciliation cannot silently accept it', async t => {
  const f = await setup(t); roster(f); edit(f, {mentions: [analystId]});
  const options = {client: f.client}, preview = await previewRequirementsComment(f.roots, 'checkout', options), original = f.state.fault;
  f.state.fault = input => {if (input.path === 'wit/workitems/200/comments/2') {input.send({...f.discussion.at(-1), mentions: []}); return true;} return original(input);};
  assert.equal((await publishRequirementsComment(f.roots, 'checkout', {...options, approval: preview.fingerprint})).mode, 'uncertain');
  await assert.rejects(reconcileRequirementsComment(f.roots, 'checkout', options), /mention readback/); assert.equal(f.posts().length, 1);
  f.state.fault = original;
  assert.equal((await reconcileRequirementsComment(f.roots, 'checkout', options)).mode, 'completed'); assert.equal(f.posts().length, 1);
});

test('zero findings, declined review and a local destination never create an automatic comment', async t => {
  const f = await setup(t); edit(f, {findings: []});
  const state = readRequirements(f.roots, 'checkout'); saveChatReview(f.roots, 'checkout', chatInput(state, [], {comment: null}));
  await assert.rejects(previewRequirementsComment(f.roots, 'checkout', {client: f.client}), /Zero findings/); assert.equal(f.posts().length, 0);
  put(f.roots, 'local.md', 'Local requirements only.');
  const source = await captureRequirements(f.roots, {version: 1, project: 'local', application: 'local', sources: [{id: 'notes', kind: 'file', path: 'local.md'}]});
  prepareRequirements(f.roots, 'local', source); bindChatReview(f.roots, 'local');
  await assert.rejects(previewRequirementsComment(f.roots, 'local', {client: f.client}), /no originating/); assert.equal(f.posts().length, 0);
});

test('same-severity reordering invalidates approval while retaining summary counts and manual wording', async t => {
  const f = await setup(t), options = {client: f.client};
  const findings = [f.decisions.findings[0], {...f.decisions.findings[0], id: 'F-02', finding: 'Second unresolved concern'}];
  const first = edit(f, {findings}), preview = await previewRequirementsComment(f.roots, 'checkout', options);
  const next = edit(f, {findings: findings.toReversed()}), revised = await previewRequirementsComment(f.roots, 'checkout', options);
  assert.equal(next.draft.comment, first.draft.comment); assert.equal(revised.summary, preview.summary);
  assert.notEqual(revised.table, preview.table); assert(revised.table.indexOf('F-02:') < revised.table.indexOf('F-01:'));
  assert(!revised.summary.includes('First priority'));
  await assert.rejects(publishRequirementsComment(f.roots, 'checkout', {...options, approval: preview.fingerprint}), /confirmation/);
  assert.equal(f.posts().length, 0);
});

test('unrated chat-v1 drafts cannot preview or dispatch until rated, and their saved bytes stay intact', async t => {
  const f = await setup(t), options = {client: f.client}, state = readRequirements(f.roots, 'checkout');
  const draft = {...f.decisions, version: 1, findings: f.decisions.findings.map(({severity, ...finding}) => finding)};
  const revision = fingerprint(draft), path = `.harness/state/requirements/checkout/reviews/${draft.reviewId}/${revision}.json`, bytes = JSON.stringify(draft, null, 4) + '\n';
  put(f.roots, path, bytes);
  const saved = saveRequirements(f.roots, 'checkout', {...state, review: {...state.review, format: 'chat-v1', revision, path}}), requests = f.state.requests.length;
  await assert.rejects(previewRequirementsComment(f.roots, 'checkout', options), /Assign severity/);
  await assert.rejects(publishRequirementsComment(f.roots, 'checkout', {...options, approval: 'old-approval'}), /Assign severity/);
  assert.equal(f.state.requests.length, requests); assert.equal(f.posts().length, 0); assert.equal(readRequirements(f.roots, 'checkout').head, saved.head);
  const next = saveChatReview(f.roots, 'checkout', chatInput(saved, f.decisions.findings, {comment: draft.comment, mentions: draft.mentions}));
  assert.equal(next.analysisInvocations, saved.analysisInvocations); assert.equal(next.review.reviewId, saved.review.reviewId);
  assert.equal(readFileSync(join(f.roots.projectRoot, path), 'utf8'), bytes);
  const preview = await previewRequirementsComment(f.roots, 'checkout', options);
  assert.equal((await publishRequirementsComment(f.roots, 'checkout', {...options, approval: preview.fingerprint})).mode, 'completed');
  assert.equal(f.posts().length, 1);
});

test('older rated drafts with internal-looking text preview and post after normal approval without rewriting saved bytes', async t => {
  const leakedId = 'req-70d3b394275978d0a3db7e54b2d900711ed8cb8bf61fc67d';
  for (const kind of ['finding-id', 'question', 'manual']) {
    const f = await setup(t), options = {client: f.client}, state = readRequirements(f.roots, 'checkout'), draft = structuredClone(f.decisions);
    if (kind === 'finding-id') {draft.findings[0].id = leakedId; draft.comment = null;}
    if (kind === 'question') {draft.findings[0].question = 'Clarify story / Microsoft.VSTS.Common.AcceptanceCriteria.'; draft.comment = null;}
    if (kind === 'manual') draft.comment = 'See ' + leakedId;
    const revision = fingerprint(draft), path = `.harness/state/requirements/checkout/reviews/${draft.reviewId}/${revision}.json`, bytes = JSON.stringify(draft, null, 4) + '\n';
    put(f.roots, path, bytes); const saved = saveRequirements(f.roots, 'checkout', {...state, review: {...state.review, revision, path}});
    const preview = await previewRequirementsComment(f.roots, 'checkout', options);
    if (kind === 'finding-id') assert(!preview.comment.includes(leakedId));
    if (kind === 'question') assert(preview.comment.includes(draft.findings[0].question));
    if (kind === 'manual') assert(preview.comment.includes(draft.comment));
    await assert.rejects(publishRequirementsComment(f.roots, 'checkout', {...options, approval: 'earlier-approval'}), /confirmation/);
    assert.equal(f.posts().length, 0); assert.equal(f.receipts().length, 0); assert.equal(readRequirements(f.roots, 'checkout').head, saved.head);
    assert.equal(readFileSync(join(f.roots.projectRoot, path), 'utf8'), bytes);
    assert.deepEqual(readChatReview(f.roots, saved).findings, draft.findings);
    const result = await publishRequirementsComment(f.roots, 'checkout', {...options, approval: preview.fingerprint});
    assert.equal(result.mode, 'completed'); assert.equal(f.posts().length, 1); assert.equal(f.posts()[0].body.text, preview.writes[0].body.text);
    assert.equal(readFileSync(join(f.roots.projectRoot, path), 'utf8'), bytes);
  }
});

const legacyComment = '<p>Approved questions.</p><ul>' + ['password-policy', 'address-format', 'retry-limit', 'expiry-time'].map(value => `<li data-q="${value}">Clarify ${value}.</li>`).join('') + '</ul>';
const removeDataQuotes = html => html.replace(/(data-(?:q|vss-mention))="([^"\s<>]+)"/g, '$1=$2');
const numericSeverityIcons = (html, hex = false) => html.replace(/[🔴🟠🔵]/gu, icon => `&#${hex ? 'X000' + icon.codePointAt(0).toString(16).toUpperCase() : '000' + icon.codePointAt(0)};`);
async function pendingLegacyComment(f, sent, stored, {acknowledged = true, receipt = false} = {}) {
  const {mode, differences, fingerprint: previousFingerprint, ...payload} = await previewRequirementsComment(f.roots, 'checkout', {client: f.client});
  payload.writes[0].body.text = sent;
  const attempt = {version: 1, status: 'uncertain', plan: {...payload, fingerprint: fingerprint(payload)}, beforeIds: f.discussion.map(comment => comment.id), receipt: '.harness/state/integrations/legacy-comment.jsonl'};
  if (acknowledged && !receipt) attempt.commentId = 2;
  put(f.roots, attempt.receipt, JSON.stringify(receipt ? {event: 'acknowledged', operation: 'create-comment', identity: {commentId: 2}} : {event: 'authorized'}) + '\n');
  put(f.roots, '.harness/state/requirements/checkout/comment-attempt.json', attempt);
  f.discussion.push({id: 2, workItemId: 200, version: 1, text: stored, mentions: []});
  return attempt;
}

test('optional attribute quotes in POST acknowledgements and direct readback preserve approved mentions and review data', async t => {
  for (const stage of ['acknowledgement', 'readback']) {
    const f = await setup(t); roster(f); edit(f, {mentions: [analystId]});
    if (stage === 'acknowledgement') f.control.transformComment = removeDataQuotes;
    else {
      const original = f.state.fault;
      f.state.fault = input => input.path === 'wit/workitems/200/comments/2' ? (input.send({...f.discussion.at(-1), text: removeDataQuotes(f.discussion.at(-1).text)}), true) : original(input);
    }
    const state = readRequirements(f.roots, 'checkout'), draft = readChatReview(f.roots, state), options = {client: f.client};
    const bytes = readFileSync(join(f.roots.projectRoot, state.review.path), 'utf8'), preview = await previewRequirementsComment(f.roots, 'checkout', options);
    const result = await publishRequirementsComment(f.roots, 'checkout', {...options, approval: preview.fingerprint});
    assert.equal(result.mode, 'completed'); assert.equal(result.commentId, 2); assert.equal(f.posts().length, 1);
    assert.equal(f.posts()[0].body.text, preview.writes[0].body.text);
    assert.deepEqual(readRequirements(f.roots, 'checkout'), state); assert.deepEqual(readChatReview(f.roots, state), draft);
    assert.equal(readFileSync(join(f.roots.projectRoot, state.review.path), 'utf8'), bytes);
  }
});

test('optional attribute quote formatting recovers acknowledged older attempts without reposting or changing the current draft', async t => {
  for (const receipt of [false, true]) {
    const f = await setup(t), options = {client: f.client};
    const attempt = await pendingLegacyComment(f, legacyComment, removeDataQuotes(legacyComment), {receipt});
    edit(f, {comment: 'A different current draft.'});
    const state = readRequirements(f.roots, 'checkout'), draft = readChatReview(f.roots, state), bytes = readFileSync(join(f.roots.projectRoot, state.review.path), 'utf8');
    const result = await publishRequirementsComment(f.roots, 'checkout', {...options, approval: 'new-draft-approval'});
    assert.equal(result.mode, 'completed'); assert.equal(result.reconciled, true); assert.equal(result.commentId, 2); assert.equal(result.fingerprint, attempt.plan.fingerprint);
    assert.equal(f.posts().length, 0); assert.deepEqual(readRequirements(f.roots, 'checkout'), state); assert.deepEqual(readChatReview(f.roots, state), draft);
    assert.equal(readFileSync(join(f.roots.projectRoot, state.review.path), 'utf8'), bytes);
    const refreshed = await captureRequirements(f.roots, f.request, options); prepareRequirements(f.roots, 'checkout', refreshed); bindChatReview(f.roots);
    const preview = await previewRequirementsComment(f.roots, 'checkout', options);
    await assert.rejects(publishRequirementsComment(f.roots, 'checkout', {...options, approval: attempt.plan.fingerprint}), /confirmation/);
    assert.equal((await publishRequirementsComment(f.roots, 'checkout', {...options, approval: preview.fingerprint})).commentId, 3); assert.equal(f.posts().length, 1);
  }
});

test('optional attribute quote candidates still require acknowledged or owner-selected comment identity', async t => {
  const f = await setup(t), options = {client: f.client};
  await pendingLegacyComment(f, legacyComment, removeDataQuotes(legacyComment), {acknowledged: false});
  const pending = await reconcileRequirementsComment(f.roots, 'checkout', options);
  assert.equal(pending.mode, 'reconciliation-required'); assert.equal(pending.candidates[0].commentId, 2); assert.equal(f.posts().length, 0);
  await assert.rejects(reconcileRequirementsComment(f.roots, 'checkout', {...options, commentId: 1}), /does not match/);
  assert.equal((await reconcileRequirementsComment(f.roots, 'checkout', {...options, commentId: 2})).mode, 'completed'); assert.equal(f.posts().length, 0);
});

test('optional attribute quote comparison accepts safe delimiters but preserves all other characters', async t => {
  for (const [sent, stored] of [['<p data-q="rule">Text</p>', '<p data-q=rule>Text</p>'], ['<p data-q=rule>Text</p>', '<p data-q="rule">Text</p>'], ["<p data-q='rule'>Text</p>", '<p data-q="rule">Text</p>'], ['<p title="Keep spaces" data-q="rule">Text</p>', '<p title="Keep spaces" data-q=rule>Text</p>']]) {
    const f = await setup(t); await pendingLegacyComment(f, sent, stored);
    assert.equal((await reconcileRequirementsComment(f.roots, 'checkout', {client: f.client})).mode, 'completed'); assert.equal(f.posts().length, 0);
  }
});

test('quote formatting never hides changed wording, attributes, unsafe values or literal markup text', async t => {
  const cases = [
    [legacyComment, removeDataQuotes(legacyComment).replace('Approved questions.', 'Changed questions.')],
    ['<a href="https://example.test/one">Text</a>', '<a href=https://example.test/two>Text</a>'],
    ['<p class="one">Text</p>', '<p class=two>Text</p>'],
    ['<p data-q="a b">Text</p>', '<p data-q=a b>Text</p>'],
    ['<p data-q="a=b">Text</p>', '<p data-q=a=b>Text</p>'],
    ['<p data-q="">Text</p>', '<p data-q=>Text</p>'],
    ['<img src="rule"/>', '<img src=rule/>'],
    ['<p>Literal data-q="rule"</p>', '<p>Literal data-q=rule</p>'],
    ["<p title='Literal data-q=\"rule\"'>Text</p>", "<p title='Literal data-q=rule'>Text</p>"],
    ['<!-- <p data-q="rule"> -->', '<!-- <p data-q=rule> -->'],
    ['<script>const text = \'<p data-q="rule">\';</script>', '<script>const text = \'<p data-q=rule>\';</script>'],
    ['<svg><text data-q="rule">Text</text></svg>', '<svg><text data-q=rule>Text</text></svg>'],
    ['<p data-q="rule">Text</p>', '<p data-q=rule>Text</div>'],
    ['<p data-q="rule">Text</p>', '<p data-q=rule title="added">Text</p>']
  ];
  for (const [sent, stored] of cases) {
    const f = await setup(t); await pendingLegacyComment(f, sent, stored);
    await assert.rejects(reconcileRequirementsComment(f.roots, 'checkout', {client: f.client}), /does not match/); assert.equal(f.posts().length, 0);
    assert.equal(JSON.parse(readFileSync(join(f.roots.projectRoot, '.harness/state/requirements/checkout/comment-attempt.json'), 'utf8')).status, 'uncertain');
  }
});

test('optional attribute quote recovery retains destination, comment identity and mention readback checks', async t => {
  for (const kind of ['mentions', 'identity', 'story']) {
    const f = await setup(t); roster(f); edit(f, {mentions: [analystId]}); f.control.transformComment = html => numericSeverityIcons(removeDataQuotes(html));
    const original = f.state.fault;
    f.state.fault = input => input.path === 'wit/workitems/200/comments/2' ? (input.send({...f.discussion.at(-1), ...(kind === 'mentions' ? {mentions: []} : kind === 'identity' ? {id: 99} : {workItemId: 999})}), true) : original(input);
    const options = {client: f.client}, preview = await previewRequirementsComment(f.roots, 'checkout', options);
    assert.equal((await publishRequirementsComment(f.roots, 'checkout', {...options, approval: preview.fingerprint})).mode, 'uncertain');
    await assert.rejects(reconcileRequirementsComment(f.roots, 'checkout', options), kind === 'mentions' ? /mention readback/ : /readback mismatch/); assert.equal(f.posts().length, 1);
  }
});

test('numeric severity entities in acknowledgements and direct readback verify the approved payload without changing reviews', async t => {
  for (const stage of ['acknowledgement', 'readback']) for (const hex of [false, true]) {
    const f = await setup(t); roster(f); edit(f, {comment: null, mentions: [analystId]});
    const transform = html => numericSeverityIcons(removeDataQuotes(html), hex);
    if (stage === 'acknowledgement') f.control.transformComment = transform;
    else {
      const original = f.state.fault;
      f.state.fault = input => input.path === 'wit/workitems/200/comments/2' ? (input.send({...f.discussion.at(-1), text: transform(f.discussion.at(-1).text)}), true) : original(input);
    }
    const state = readRequirements(f.roots, 'checkout'), draft = readChatReview(f.roots, state), bytes = readFileSync(join(f.roots.projectRoot, state.review.path), 'utf8');
    const options = {client: f.client}, preview = await previewRequirementsComment(f.roots, 'checkout', options);
    for (const icon of ['🔴', '🟠', '🔵']) assert(preview.writes[0].body.text.includes(icon));
    const result = await publishRequirementsComment(f.roots, 'checkout', {...options, approval: preview.fingerprint});
    assert.equal(result.mode, 'completed'); assert.equal(result.commentId, 2); assert.equal(f.posts().length, 1);
    assert.equal(f.posts()[0].body.text, preview.writes[0].body.text); assert.deepEqual(readRequirements(f.roots, 'checkout'), state);
    assert.deepEqual(readChatReview(f.roots, state), draft); assert.equal(readFileSync(join(f.roots.projectRoot, state.review.path), 'utf8'), bytes);
    assert.equal((await publishRequirementsComment(f.roots, 'checkout', {...options, approval: preview.fingerprint})).commentId, 2); assert.equal(f.posts().length, 1);
  }
});

test('numeric severity entities recover saved older three-line attempts by ID, receipt or owner selection without reposting', async t => {
  const oldSummary = '**Summary: 3 findings — 3 gaps, 0 contradictions**\n🔴 High: 1 · 🟠 Medium: 1 · 🔵 Low: 1\n**First priority:** **F-01: Approved questions**';
  const sent = '<p><strong>Summary: 3 findings — 3 gaps, 0 contradictions</strong><br>🔴 High: 1 · 🟠 Medium: 1 · 🔵 Low: 1<br><strong>First priority:</strong> <strong>F-01: Approved questions</strong></p>' + legacyComment;
  for (const identity of ['saved-id', 'receipt', 'selected']) {
    const f = await setup(t), options = {client: f.client};
    const attempt = await pendingLegacyComment(f, sent, numericSeverityIcons(removeDataQuotes(sent), identity === 'receipt'), {acknowledged: identity !== 'selected', receipt: identity === 'receipt'});
    const {fingerprint: priorFingerprint, ...payload} = attempt.plan;
    payload.summary = oldSummary; payload.comment = oldSummary + '\n\nApproved questions.';
    attempt.plan = {...payload, fingerprint: fingerprint(payload)};
    const attemptPath = '.harness/state/requirements/checkout/comment-attempt.json'; put(f.roots, attemptPath, attempt);
    const current = edit(f, {comment: 'A different current draft.'});
    const state = readRequirements(f.roots, 'checkout'), draft = readChatReview(f.roots, state), bytes = readFileSync(join(f.roots.projectRoot, state.review.path), 'utf8');
    const receipt = readFileSync(join(f.roots.projectRoot, attempt.receipt), 'utf8');
    assert(!current.summary.includes('First priority'));
    let result;
    if (identity === 'selected') {
      const pending = await reconcileRequirementsComment(f.roots, 'checkout', options);
      assert.equal(pending.mode, 'reconciliation-required'); assert.deepEqual(pending.candidates.map(item => item.commentId), [2]);
      await assert.rejects(reconcileRequirementsComment(f.roots, 'checkout', {...options, commentId: 1}), /does not match/);
      result = await reconcileRequirementsComment(f.roots, 'checkout', {...options, commentId: 2});
    } else result = await publishRequirementsComment(f.roots, 'checkout', {...options, approval: 'different-current-draft'});
    assert.equal(result.mode, 'completed'); assert.equal(result.reconciled, true); assert.equal(result.commentId, 2); assert.equal(result.fingerprint, attempt.plan.fingerprint);
    assert.equal(f.posts().length, 0); assert.deepEqual(readRequirements(f.roots, 'checkout'), state); assert.deepEqual(readChatReview(f.roots, state), draft);
    const stored = JSON.parse(readFileSync(join(f.roots.projectRoot, attemptPath), 'utf8'));
    assert.equal(stored.status, 'completed'); assert.deepEqual(stored.plan, attempt.plan);
    assert.equal(readFileSync(join(f.roots.projectRoot, state.review.path), 'utf8'), bytes); assert.equal(readFileSync(join(f.roots.projectRoot, attempt.receipt), 'utf8'), receipt);
  }
});

test('numeric severity comparison rejects unrelated entities, changed text or markup and encoded attributes', async t => {
  const cases = [
    ['<p>🔴 High</p>', '<p>&#128309; High</p>'],
    ['<p>🔴 High</p>', '<p>&#128308; Changed</p>'],
    ['<strong>🔴</strong>', '<b>&#128308;</b>'],
    ['<p>🟠</p>', '<p>&#128992</p>'],
    ['<p>🟠</p>', '<p>&#+128992;</p>'],
    ['<p>🔴</p>', '<p>&amp;#128308;</p>'],
    ['<p>&amp;#128308;</p>', '<p>&#128308;</p>'],
    ['<p>&amp;</p>', '<p>&#38;</p>'],
    ['<p>🟡</p>', '<p>&#128993;</p>'],
    ['<p title="🔴">Text</p>', '<p title="&#128308;">Text</p>'],
    ['<a href="https://example.test/🔴">Text</a>', '<a href="https://example.test/&#128308;">Text</a>'],
    ['<script>🔴</script>', '<script>&#128308;</script>'],
    ['<!-- 🔴 -->', '<!-- &#128308; -->'],
    ['<svg><text>🔴</text></svg>', '<svg><text>&#128308;</text></svg>']
  ];
  for (const [sent, stored] of cases) {
    const f = await setup(t); await pendingLegacyComment(f, sent, stored);
    await assert.rejects(reconcileRequirementsComment(f.roots, 'checkout', {client: f.client}), /does not match/); assert.equal(f.posts().length, 0);
    assert.equal(JSON.parse(readFileSync(join(f.roots.projectRoot, '.harness/state/requirements/checkout/comment-attempt.json'), 'utf8')).status, 'uncertain');
  }
});

test('question emphasis changes invalidate old approval while preserving raw analysis, mentions and exact posting', async t => {
  const f = await setup(t); roster(f); edit(f, {comment: null, mentions: [analystId]});
  const options = {client: f.client}, first = await previewRequirementsComment(f.roots, 'checkout', options);
  const state = readRequirements(f.roots, 'checkout'), draft = readChatReview(f.roots, state);
  const next = edit(f, {findings: draft.findings.map(finding => ({...finding, questionFocus: 'accepted target'}))});
  assert.equal(next.analysisInvocations, state.analysisInvocations); assert.equal(next.draft.findings[0].question, draft.findings[0].question);
  const preview = await previewRequirementsComment(f.roots, 'checkout', options);
  assert.notEqual(preview.fingerprint, first.fingerprint); assert.deepEqual(preview.mentions, first.mentions);
  assert(preview.writes[0].body.text.includes('What is the <strong>accepted target</strong>?'));
  await assert.rejects(publishRequirementsComment(f.roots, 'checkout', {...options, approval: first.fingerprint}), /confirmation/); assert.equal(f.posts().length, 0);
  assert.equal((await publishRequirementsComment(f.roots, 'checkout', {...options, approval: preview.fingerprint})).mode, 'completed');
  assert.equal(f.posts().length, 1); assert.equal(f.posts()[0].body.text, preview.writes[0].body.text);
});
