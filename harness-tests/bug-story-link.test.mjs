import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {adoFixture} from './fixtures/ado.mjs';
import {executionFixture, executeApi} from './fixtures/execute.mjs';
import {createAdoClient, adoRequestFingerprint} from '../scripts/lib/integrations/ado-client.mjs';
import {validateAdoConfiguration} from '../scripts/lib/integrations/config.mjs';
import {fingerprint} from '../scripts/lib/execution-core/data.mjs';
import {deliverExecution} from '../scripts/lib/execute/delivery.mjs';
import {ownedFile, writeJson} from '../scripts/lib/execute/storage.mjs';
import {prepareBugReport, readBugReport, editBugReport, previewBugReport, compactBugPreview, approveBugReport, fileBugReport, reconcileBugReport} from '../scripts/lib/bug-report/index.mjs';

const parent = 'System.LinkTypes.Hierarchy-Reverse', related = 'System.LinkTypes.Related';
const inventory = async () => [{pid: process.pid, identity: '1'}];
const input = (story = true) => ({version: 1, description: 'The status API returned 500.', source: {content: 'Existing records return 200.', expected: 'Status 200', ...(story ? {storyId: 200, revision: 1} : {})},
  draft: {title: 'Existing record status request returns 500', description: 'The request fails.', prerequisites: [], steps: ['Request status'], expected: 'Status 200', actual: 'Status 500', fields: {}}, evidence: []});
const dependencies = (ado, roots = ado.roots) => ({client: createAdoClient({configuration: ado.config, roots, resolveCredential: () => ado.credential, fetchImpl: ado.fetchImpl}), inventory});
const relations = bug => bug.request.body.filter(row => row.path === '/relations/-').map(row => row.value);
const creates = ado => ado.state.requests.filter(row => row.path === 'wit/workitems/$bug' && !row.query.includes('validateOnly'));
const choices = [[undefined, parent], ['parent', parent], ['related', related], [true, related], [false, null]];

for (const [setting, relation] of choices) for (const workflow of ['report', 'execution']) test(`${workflow}: storyLink ${String(setting)} creates only the selected story relation`, async t => {
  const ado = await adoFixture(t, {bugs: setting === undefined ? {} : {storyLink: setting}});
  let preview, result;
  if (workflow === 'report') {
    const deps = dependencies(ado); prepareBugReport(ado.roots, 'link', input());
    preview = await previewBugReport(ado.roots, 'link', deps); assert(preview.ready);
    assert.deepEqual(compactBugPreview(preview).bugs[0].writes[0].relations, relations(preview.bugs[0]));
    approveBugReport(ado.roots, 'link', preview.hash); result = await fileBugReport(ado.roots, 'link', preview.hash, deps);
  } else {
    const execution = await executionFixture(t, {organizationUrl: ado.config.organizationUrl, storyId: 200, handler: (_, res) => {res.writeHead(500); res.end('{}');}});
    execution.apiStep(); execution.freeze(); await executeApi(execution);
    const deps = dependencies(ado, execution.roots);
    preview = await deliverExecution(execution.roots, execution.executionId, 'file-bugs', {}, deps);
    result = await deliverExecution(execution.roots, execution.executionId, 'file-bugs', {execute: true, approvedPlan: preview.planHash}, deps);
  }
  const expected = relation ? [{rel: relation, url: `${ado.config.organizationUrl}/_apis/wit/workitems/200`}] : [];
  assert.deepEqual(relations(preview.bugs[0]), expected);
  assert.deepEqual(ado.state.items.get(800).relations, expected);
  assert.equal(result.bugs[0].state, 'COMPLETED'); assert.equal(creates(ado).length, 1);
});

test('storyLink rejects unsupported values and no-story reports add no relation', async t => {
  const ado = await adoFixture(t);
  for (const storyLink of ['child', '', null, 0, {}, []]) assert.throws(() => validateAdoConfiguration({...ado.config, bugs: {storyLink}}), /storyLink.*parent.*related.*true.*false/);
  const deps = dependencies(ado); prepareBugReport(ado.roots, 'no-story', input(false));
  const preview = await previewBugReport(ado.roots, 'no-story', deps); assert(preview.ready); assert.deepEqual(relations(preview.bugs[0]), []);
});

for (const phase of ['validation', 'create']) for (const status of [400, 403, 409]) test(`${phase} rejection ${status} preserves the draft and never downgrades or replays`, async t => {
  const ado = await adoFixture(t), deps = dependencies(ado), original = prepareBugReport(ado.roots, 'reject', input());
  const reject = ({path, url, send}) => {if (path === 'wit/workitems/$bug' && (url.searchParams.has('validateOnly') ? phase === 'validation' : phase === 'create')) {send({message: 'TF99999: Synthetic hierarchy rejection'}, status); return true;}};
  if (phase === 'validation') ado.state.fault = reject;
  const preview = await previewBugReport(ado.roots, 'reject', deps);
  if (phase === 'validation') {assert.equal(preview.ready, false); assert.match(preview.problems[0].message, /TF99999/); assert.equal(creates(ado).length, 0);}
  else {
    assert(preview.ready); approveBugReport(ado.roots, 'reject', preview.hash); ado.state.fault = reject;
    await assert.rejects(fileBugReport(ado.roots, 'reject', preview.hash, deps), error => error.delivery.effect === 'not-executed' && /TF99999/.test(error.message));
    assert.equal(creates(ado).length, 1); assert(ado.receipts().flat().some(row => row.event === 'incomplete' && row.effect === 'not-executed'));
  }
  assert.equal(ado.state.items.has(800), false); assert.deepEqual(readBugReport(ado.roots, 'reject').draft, original.draft);
});

test('severity and priority use existing draft edits, picklists, payloads and approvals', async t => {
  const ado = await adoFixture(t), deps = dependencies(ado);
  ado.config.bugs = {fields: {'Microsoft.VSTS.Common.Priority': 3}};
  ado.state.fault = ({path, send}) => {if (path === 'wit/workitemtypes/bug/fields') {send({value: [
    {referenceName: 'System.Title', type: 'string'}, {referenceName: 'Microsoft.VSTS.TCM.ReproSteps', type: 'html'},
    {referenceName: 'Microsoft.VSTS.Common.Severity', type: 'string', allowedValues: ['1 - Critical', '2 - High', '3 - Medium', '4 - Low']},
    {referenceName: 'Microsoft.VSTS.Common.Priority', type: 'integer', allowedValues: [1, 2, 3, 4]}
  ]}); return true;}};
  let state = prepareBugReport(ado.roots, 'fields', input()), preview = await previewBugReport(ado.roots, 'fields', dependencies(ado));
  assert.equal(preview.bugs[0].fields['Microsoft.VSTS.Common.Priority'], 3);
  assert.equal(preview.bugs[0].review.find(row => row.field.endsWith('Severity')).allowedValues.length, 4);
  state = editBugReport(ado.roots, 'fields', {head: state.head, draft: {severity: '1 - Critical', priority: 1}});
  preview = await previewBugReport(ado.roots, 'fields', dependencies(ado)); approveBugReport(ado.roots, 'fields', preview.hash);
  state = editBugReport(ado.roots, 'fields', {head: state.head, draft: {severity: '2 - High', priority: 2}});
  await assert.rejects(fileBugReport(ado.roots, 'fields', preview.hash, deps), /approval|preview/i);
  state = editBugReport(ado.roots, 'fields', {head: state.head, draft: {severity: 'unknown'}});
  const invalid = await previewBugReport(ado.roots, 'fields', dependencies(ado)); assert.equal(invalid.ready, false);
  assert(invalid.fieldReview.find(row => row.field.endsWith('Severity')).allowedValues.includes('2 - High'));
  state = editBugReport(ado.roots, 'fields', {head: state.head, draft: {severity: '2 - High', priority: 9}});
  const invalidPriority = await previewBugReport(ado.roots, 'fields', dependencies(ado)); assert.equal(invalidPriority.ready, false);
  assert(invalidPriority.fieldReview.find(row => row.field.endsWith('Priority')).allowedValues.includes(2));
  editBugReport(ado.roots, 'fields', {head: state.head, draft: {priority: 2}});
  preview = await previewBugReport(ado.roots, 'fields', dependencies(ado)); approveBugReport(ado.roots, 'fields', preview.hash);
  await fileBugReport(ado.roots, 'fields', preview.hash, dependencies(ado));
  assert.equal(ado.state.items.get(800).fields['Microsoft.VSTS.Common.Severity'], '2 - High'); assert.equal(ado.state.items.get(800).fields['Microsoft.VSTS.Common.Priority'], 2);
});

// Reconstruct an approved pre-upgrade request, with the same schema/configuration.
async function pendingBeforeUpgrade(t, relation, identity) {
  const ado = await adoFixture(t), deps = dependencies(ado), raw = input();
  writeFileSync(join(ado.roots.projectRoot, 'proof.log'), 'Synthetic sanitized status=500');
  raw.evidence = [{path: 'proof.log', kind: 'log', origin: 'user', sanitized: true, verification: {privacy: true, relevance: true}, context: 'Status response'}];
  const state = prepareBugReport(ado.roots, 'old', raw), prepared = await previewBugReport(ado.roots, 'old', deps);
  const {hash: ignored, ...preview} = JSON.parse(readFileSync(prepared.previewFile, 'utf8')), bug = preview.bugs[0];
  bug.request.body = bug.request.body.filter(row => row.path !== '/relations/-');
  if (relation) bug.request.body.push({op: 'add', path: '/relations/-', value: {rel: relation, url: `${ado.config.organizationUrl}/_apis/wit/workitems/200`}});
  preview.planHash = fingerprint({executionId: preview.executionId, revisions: preview.revisions, skipped: preview.skipped, bugs: preview.bugs, destination: preview.destination});
  const hash = fingerprint(preview); writeJson(prepared.previewFile, {...preview, hash}); approveBugReport(ado.roots, 'old', hash);
  if (identity === 'not-created') return {ado, deps, hash};
  const delivery = deps.client.delivery('bugs', true, state.intakeFingerprint), {route, method, body} = bug.request;
  if (identity === 'unknown') ado.state.afterBugCreate = ({res}) => res.destroy();
  try {await delivery.write('create-bug', route, body, {method, patch: true});} catch (error) {assert.equal(identity, 'unknown'); assert.equal(error.delivery.effect, 'uncertain');}
  ado.state.afterBugCreate = undefined;
  const requestFingerprint = adoRequestFingerprint(route, method, body), row = {fingerprint: bug.fingerprint, state: 'ATTACHMENTS_PENDING', planHash: fingerprint(bug), requestFingerprint, receipt: delivery.receipt,
    ...(identity === 'known' ? {workItemId: 800} : {}), operation: {type: bug.type, request: bug.request, fieldSpecifications: bug.review.filter(field => field.value !== undefined).map(field => ({referenceName: field.field, type: field.type})), organizationUrl: ado.config.organizationUrl, projectId: ado.state.project.id, source: state.intakeFingerprint, reportHead: state.head}};
  writeJson(ownedFile(ado.roots, 'old', 'delivery/bugs.json'), {version: 1, entries: [row]});
  return {ado, deps, hash, row};
}

test('an undispatched pre-upgrade approval returns through preview before adding a parent', async t => {
  const {ado, deps, hash} = await pendingBeforeUpgrade(t, null, 'not-created');
  await assert.rejects(fileBugReport(ado.roots, 'old', hash, deps), /preview changed/); assert.equal(creates(ado).length, 0);
  const preview = await previewBugReport(ado.roots, 'old', deps); assert.notEqual(preview.hash, hash); approveBugReport(ado.roots, 'old', preview.hash);
  await fileBugReport(ado.roots, 'old', preview.hash, deps); assert.equal(ado.state.items.get(800).relations[0].rel, parent);
});

for (const relation of [null, related]) for (const identity of ['known', 'acknowledged', 'unknown']) test(`pre-upgrade ${relation ?? 'unlinked'} creation resumes its original request (${identity} ID)`, async t => {
  const {ado, deps, hash, row} = await pendingBeforeUpgrade(t, relation, identity);
  if (identity === 'unknown') {
    assert.equal((await fileBugReport(ado.roots, 'old', hash, deps)).bugs[0].state, 'UNCERTAIN');
    const confirmation = {fingerprint: row.fingerprint, requestFingerprint: row.requestFingerprint, adoId: 800};
    assert.equal((await reconcileBugReport(ado.roots, 'old', confirmation, deps)).bugs[0].id, 800);
  }
  const resumed = await fileBugReport(ado.roots, 'old', hash, deps); assert.equal(resumed.bugs[0].state, 'COMPLETED');
  assert.deepEqual(ado.state.items.get(800).relations.filter(row => row.rel !== 'AttachedFile').map(row => row.rel), relation ? [relation] : []);
  assert.equal(ado.state.attachments.size, 1); assert.equal(creates(ado).length, 1);
  await fileBugReport(ado.roots, 'old', hash, deps); assert.equal(creates(ado).length, 1);
});

test('approved parent relation is required at readback and user-confirmed reconciliation', async t => {
  const ado = await adoFixture(t), deps = dependencies(ado); prepareBugReport(ado.roots, 'readback', input());
  const preview = await previewBugReport(ado.roots, 'readback', deps); approveBugReport(ado.roots, 'readback', preview.hash);
  ado.state.afterBugCreate = ({item, res}) => {item.relations = []; res.destroy();};
  const lost = (await fileBugReport(ado.roots, 'readback', preview.hash, deps)).bugs[0];
  const recovered = await reconcileBugReport(ado.roots, 'readback', {fingerprint: lost.fingerprint, requestFingerprint: lost.requestFingerprint, adoId: 800}, deps);
  assert.equal(recovered.bugs[0].state, 'UNCERTAIN'); assert.equal(recovered.bugs[0].id, null); assert.match(recovered.bugs[0].reason, /approved relationship/);
  assert.equal(creates(ado).length, 1);
});
