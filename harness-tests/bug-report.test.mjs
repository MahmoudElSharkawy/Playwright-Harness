import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {deflateSync} from 'node:zlib';
import {fixture} from './fixtures/execution-core.mjs';
import {adoFixture} from './fixtures/ado.mjs';
import {executionFixture, executeApi} from './fixtures/execute.mjs';
import {createAdoClient} from '../scripts/lib/integrations/ado-client.mjs';
import {prepareBugReport, readBugReport, editBugReport, previewBugReport, approveBugReport, fileBugReport, annotateBugReport, reviewBugAnnotation, bugReportFromExecution} from '../scripts/lib/bug-report/index.mjs';
import {collectExecution, deliverableDefects} from '../scripts/lib/execute/report.mjs';

const input = () => ({version: 1, description: 'The status API returned 500 for an existing record.', source: {content: 'Existing records must return status 200.', expected: 'Status 200'},
  draft: {title: 'Existing record status request returns 500', description: 'The reported request fails.', prerequisites: ['An existing record'], steps: ['Request the record status'], expected: 'Status 200', actual: 'Status 500', fields: {}},
  confirmation: {user: 'confirmed', agent: 'not-run'}, evidence: []});
const writes = ado => ado.state.requests.filter(r => r.method !== 'GET' && !['wit/wiql', 'wit/workitemsbatch'].includes(r.path) && !r.query.includes('validateOnly=true'));
const deps = (ado, roots) => ({client: createAdoClient({configuration: ado.config, roots, resolveCredential: () => ado.credential, fetchImpl: ado.fetchImpl}), inventory: async () => [{pid: process.pid, identity: '1'}]});
function image(width, height) {
  const crc = bytes => {let value = 0xffffffff; for (const byte of bytes) {value ^= byte; for (let bit = 0; bit < 8; bit++) value = value >>> 1 ^ (value & 1 ? 0xedb88320 : 0);} return (value ^ 0xffffffff) >>> 0;};
  const chunk = (kind, bytes) => {const name = Buffer.from(kind), out = Buffer.alloc(bytes.length + 12); out.writeUInt32BE(bytes.length); name.copy(out, 4); bytes.copy(out, 8); out.writeUInt32BE(crc(Buffer.concat([name, bytes])), bytes.length + 8); return out;};
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc((width * 3 + 1) * height))), chunk('IEND', Buffer.alloc(0))]);
}

test('reported issue starts without a run or credentials, keeps intake immutable and preserves revisions', t => {
  const {roots} = fixture(t), state = prepareBugReport(roots, 'bug-one', input());
  assert.equal(state.confirmation.agent, 'not-run'); assert.equal(state.intake.description, input().description);
  const edited = editBugReport(roots, 'bug-one', {head: state.head, draft: {actual: 'Status 500 and an empty response'}});
  assert.equal(edited.intake.description, state.intake.description); assert.equal(edited.draft.actual, 'Status 500 and an empty response'); assert.notEqual(edited.head, state.head);
  assert.throws(() => editBugReport(roots, 'bug-one', {head: state.head, draft: {title: 'Stale edit'}}), /changed|stale/i);
  assert.throws(() => editBugReport(roots, 'bug-one', {head: edited.head, intake: {description: 'rewrite evidence'}}), /unsupported|editable|input/i);
});
test('missing story/expectations leaves a useful provisional draft with explicit gaps', async t => {
  const {roots} = fixture(t), state = prepareBugReport(roots, 'bug-gap', {version: 1, description: 'Something failed'});
  assert.equal(state.confirmation.agent, 'not-run'); assert(readBugReport(roots, 'bug-gap').draft.title);
  const preview = await previewBugReport(roots, 'bug-gap'); assert.equal(preview.ready, false); assert(preview.problems.length); assert.equal(preview.destination, null);
});
test('exact preview approval files a user-confirmed API-only issue once, resumes lost acknowledgement, and preserves report provenance', async t => {
  const ado = await adoFixture(t), {roots} = fixture(t), dependencies = deps(ado, roots);
  prepareBugReport(roots, 'bug-api', input()); const preview = await previewBugReport(roots, 'bug-api', dependencies);
  assert.equal(preview.ready, true); assert.equal(writes(ado).length, 0); assert.equal(preview.bugs[0].attachments.length, 0);
  approveBugReport(roots, 'bug-api', preview.hash);
  ado.state.afterBugCreate = ({res}) => res.destroy(); await assert.rejects(fileBugReport(roots, 'bug-api', preview.hash, dependencies), /incomplete/); ado.state.afterBugCreate = null;
  const done = await fileBugReport(roots, 'bug-api', preview.hash, dependencies); assert.equal(done.bugs[0].state, 'COMPLETED');
  await fileBugReport(roots, 'bug-api', preview.hash, dependencies); assert.equal(writes(ado).filter(r => r.path === 'wit/workitems/$bug').length, 1);
  assert.equal(readBugReport(roots, 'bug-api').confirmation.agent, 'not-run');
});
test('editing the reviewed draft invalidates approval before any external write', async t => {
  const ado = await adoFixture(t), {roots} = fixture(t), dependencies = deps(ado, roots), state = prepareBugReport(roots, 'bug-edit', input());
  const preview = await previewBugReport(roots, 'bug-edit', dependencies); approveBugReport(roots, 'bug-edit', preview.hash);
  editBugReport(roots, 'bug-edit', {head: state.head, draft: {title: 'A corrected report title'}});
  await assert.rejects(fileBugReport(roots, 'bug-edit', preview.hash, dependencies), /approv|preview|changed/i); assert.equal(writes(ado).length, 0);
});
test('eligible logs retain original bytes and hash; changed artifacts cannot be filed', async t => {
  const ado = await adoFixture(t), {roots} = fixture(t), dependencies = deps(ado, roots), raw = input();
  writeFileSync(join(roots.projectRoot, 'selected-log.txt'), 'sanitized status=500');
  raw.evidence = [{path: 'selected-log.txt', kind: 'log', sanitized: true, verification: {privacy: true, relevance: true}, origin: 'user', context: 'Status request on synthetic QA build'}];
  prepareBugReport(roots, 'bug-log', raw); const preview = await previewBugReport(roots, 'bug-log', dependencies); assert(preview.ready); approveBugReport(roots, 'bug-log', preview.hash);
  const record = readBugReport(roots, 'bug-log').evidence[0]; assert.equal(readFileSync(join(roots.projectRoot, record.path), 'utf8'), 'sanitized status=500');
  writeFileSync(join(roots.projectRoot, record.path), 'changed');
  await assert.rejects(fileBugReport(roots, 'bug-log', preview.hash, dependencies), /evidence|artifact|changed/i); assert.equal(writes(ado).length, 0);
});
test('a missing custom mandatory field appears in the review table and cannot be guessed', async t => {
  const ado = await adoFixture(t), {roots} = fixture(t), dependencies = deps(ado, roots);
  ado.state.fault = ({path, send}) => {if (path === 'wit/workitemtypes/bug/fields') {send({value: [{referenceName: 'System.Title', type: 'string'}, {referenceName: 'System.Tags', type: 'string'}, {referenceName: 'System.Description', type: 'html'}, {referenceName: 'Custom.Component', name: 'Affected component', type: 'string', alwaysRequired: true, allowedValues: ['API', 'Portal']}]}); return true;}};
  const state = prepareBugReport(roots, 'bug-custom', input()), missing = await previewBugReport(roots, 'bug-custom', dependencies);
  assert.equal(missing.ready, false); assert(missing.fieldReview.some(item => item.field === 'Custom.Component' && item.required)); assert.equal(writes(ado).length, 0);
  editBugReport(roots, 'bug-custom', {head: state.head, draft: {fields: {'Custom.Component': 'API'}}});
  const ready = await previewBugReport(roots, 'bug-custom', dependencies); assert.equal(ready.ready, true); assert.equal(ready.bugs[0].fields['Custom.Component'], 'API'); assert(!Object.hasOwn(ready.bugs[0].fields, 'Microsoft.VSTS.Common.Severity'));
});
test('changed project rules invalidate the approved plan before writes', async t => {
  const ado = await adoFixture(t), {roots} = fixture(t), dependencies = deps(ado, roots); prepareBugReport(roots, 'bug-schema', input());
  const preview = await previewBugReport(roots, 'bug-schema', dependencies); approveBugReport(roots, 'bug-schema', preview.hash);
  ado.config.bugs = {tags: ['changed-project-default']};
  await assert.rejects(fileBugReport(roots, 'bug-schema', preview.hash, deps(ado, roots)), /preview changed/i); assert.equal(writes(ado).length, 0);
});
test('explicit assignee overrides defaults and an optional default can be omitted', async t => {
  const ado = await adoFixture(t), {roots} = fixture(t), raw = input(); ado.config.bugs = {assignedTo: 'configured@example.test', fields: {'Microsoft.VSTS.Common.Priority': 3}};
  raw.draft.fields = {'System.AssignedTo': 'selected@example.test'}; raw.draft.omitFields = ['Microsoft.VSTS.Common.Priority']; prepareBugReport(roots, 'bug-defaults', raw);
  const preview = await previewBugReport(roots, 'bug-defaults', deps(ado, roots)); assert(preview.ready); assert.equal(preview.bugs[0].fields['System.AssignedTo'], 'selected@example.test'); assert(!Object.hasOwn(preview.bugs[0].fields, 'Microsoft.VSTS.Common.Priority'));
});
test('a second report of the same intake detects the existing defect without creating twice', async t => {
  const ado = await adoFixture(t), {roots} = fixture(t), dependencies = deps(ado, roots);
  for (const reportId of ['bug-original', 'bug-second']) {prepareBugReport(roots, reportId, input()); const preview = await previewBugReport(roots, reportId, dependencies); approveBugReport(roots, reportId, preview.hash); const result = await fileBugReport(roots, reportId, preview.hash, dependencies); assert.equal(result.bugs[0].state, reportId === 'bug-original' ? 'COMPLETED' : 'DUPLICATE');}
  assert.equal(writes(ado).filter(item => item.path === 'wit/workitems/$bug').length, 1);
});
test('server readback mismatch cannot become a completed bug delivery', async t => {
  const ado = await adoFixture(t), {roots} = fixture(t), dependencies = deps(ado, roots); prepareBugReport(roots, 'bug-readback', input()); const preview = await previewBugReport(roots, 'bug-readback', dependencies); approveBugReport(roots, 'bug-readback', preview.hash);
  ado.state.afterBugCreate = ({item}) => {item.fields['System.Title'] = 'Unexpectedly transformed title';};
  await assert.rejects(fileBugReport(roots, 'bug-readback', preview.hash, dependencies), /approved value at readback/i); assert.equal(ado.state.items.get(800).id, 800);
});
test('a changed selected story revision blocks approval dispatch', async t => {
  const ado = await adoFixture(t), {roots} = fixture(t), dependencies = deps(ado, roots), raw = input(); raw.source.storyId = 200; raw.source.revision = 1;
  prepareBugReport(roots, 'bug-story', raw); const preview = await previewBugReport(roots, 'bug-story', dependencies); assert(preview.ready); approveBugReport(roots, 'bug-story', preview.hash);
  ado.state.items.get(200).rev = 2; await assert.rejects(fileBugReport(roots, 'bug-story', preview.hash, dependencies), /story revision changed/i); assert.equal(writes(ado).length, 0);
});
test('selected story preserves configured story paths and the approved story relation', async t => {
  const ado = await adoFixture(t), {roots} = fixture(t), raw = input(); raw.source.storyId = 200; raw.source.revision = 1; ado.config.bugs = {pathsFrom: 'story', storyLink: true}; const dependencies = deps(ado, roots);
  prepareBugReport(roots, 'bug-story-link', raw); const preview = await previewBugReport(roots, 'bug-story-link', dependencies); assert.equal(preview.ready, true); approveBugReport(roots, 'bug-story-link', preview.hash);
  await fileBugReport(roots, 'bug-story-link', preview.hash, dependencies); assert(ado.state.items.get(800).relations.some(item => item.rel === 'System.LinkTypes.Related' && item.url.endsWith('/200')));
});
test('invalid first evidence intake can be corrected without losing the report identity', t => {
  const {roots} = fixture(t), raw = input(); raw.evidence = [{path: 'missing.png', kind: 'screenshot', origin: 'user'}];
  assert.throws(() => prepareBugReport(roots, 'bug-recover', raw)); raw.evidence = [];
  assert.equal(prepareBugReport(roots, 'bug-recover', raw).reportId, 'bug-recover');
});
test('corrupt raw-only screenshots never become eligible merely through reviewed flags', t => {
  const {roots} = fixture(t), raw = input(), bytes = Buffer.alloc(40); Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes); writeFileSync(join(roots.projectRoot, 'corrupt.png'), bytes);
  raw.evidence = [{path: 'corrupt.png', kind: 'screenshot', origin: 'user', sanitized: true, verification: {privacy: true, relevance: true}, context: 'Claims to show the bug'}];
  assert.throws(() => prepareBugReport(roots, 'bug-corrupt', raw), /PNG|image/i);
});
test('filing owns the same draft lock as edits throughout metadata reads and dispatch', async t => {
  const ado = await adoFixture(t), {roots} = fixture(t), dependencies = deps(ado, roots), state = prepareBugReport(roots, 'bug-race', input());
  const preview = await previewBugReport(roots, 'bug-race', dependencies); approveBugReport(roots, 'bug-race', preview.hash);
  let attempted = false; ado.state.fault = ({path}) => {if (!attempted && path.includes('workitemtypecategories')) {attempted = true; assert.throws(() => editBugReport(roots, 'bug-race', {head: state.head, draft: {title: 'Concurrent edit'}}), /BUSY/);}};
  await fileBugReport(roots, 'bug-race', preview.hash, dependencies); assert(attempted); assert.equal(ado.state.items.get(800).fields['System.Title'], input().draft.title);
});
test('a completed report cannot silently claim a newly edited draft was delivered', async t => {
  const ado = await adoFixture(t), {roots} = fixture(t), dependencies = deps(ado, roots), state = prepareBugReport(roots, 'bug-complete', input());
  const initial = await previewBugReport(roots, 'bug-complete', dependencies); approveBugReport(roots, 'bug-complete', initial.hash); await fileBugReport(roots, 'bug-complete', initial.hash, dependencies);
  editBugReport(roots, 'bug-complete', {head: state.head, draft: {title: 'New reviewed wording'}}); const edited = await previewBugReport(roots, 'bug-complete', dependencies); approveBugReport(roots, 'bug-complete', edited.hash);
  await assert.rejects(fileBugReport(roots, 'bug-complete', edited.hash, dependencies), /dispatched bug (content|plan) changed/i); assert.equal(ado.state.items.get(800).fields['System.Title'], input().draft.title); assert.equal(writes(ado).filter(item => item.path === 'wit/workitems/$bug').length, 1);
});
test('reviewed raw and annotated pair uses one bug and recovers a lost second attachment-link acknowledgement', async t => {
  const ado = await adoFixture(t), {roots} = fixture(t), dependencies = deps(ado, roots), raw = input(); writeFileSync(join(roots.projectRoot, 'raw.png'), image(120, 80));
  raw.evidence = [{path: 'raw.png', kind: 'screenshot', origin: 'user', sanitized: true, verification: {privacy: true, relevance: true}, context: 'Synthetic QA image reviewed against reported status'}];
  const initial = prepareBugReport(roots, 'bug-pair', raw), source = initial.evidence[0].path;
  const annotated = await annotateBugReport(roots, 'bug-pair', {source, output: '.harness/runs/bug-pair/annotated.png', summary: 'Wrong status', expected: raw.draft.expected, actual: raw.draft.actual, boxes: [{kind: 'defect', x: 0.1, y: 0.1, width: 0.5, height: 0.5}], verification: {privacy: true, relevance: true}}, {inventory: dependencies.inventory, render: async () => ({bytes: image(120, 160), sourceDimensions: {width: 120, height: 80}, dimensions: {width: 120, height: 160}, transform: {displayWidth: 120, displayHeight: 80, offsetX: 0, offsetY: 80}})});
  const pending = await previewBugReport(roots, 'bug-pair', dependencies); assert.equal(pending.ready, false);
  const record = annotated.annotations[0].record; reviewBugAnnotation(roots, 'bug-pair', {sourceSha256: record.sourceSha256, specificationFingerprint: record.specificationFingerprint, outputSha256: record.sha256, relevance: true, placement: true, privacy: true});
  const preview = await previewBugReport(roots, 'bug-pair', dependencies); assert(preview.ready); assert.equal(preview.bugs[0].attachments.length, 2); approveBugReport(roots, 'bug-pair', preview.hash);
  let links = 0; ado.state.fault = ({req, res, path, body}) => {if (req.method === 'PATCH' && path === 'wit/workitems/800' && ++links === 2) {const item = ado.state.items.get(800); item.relations.push(body[1].value); item.rev++; res.destroy(); return true;}};
  await assert.rejects(fileBugReport(roots, 'bug-pair', preview.hash, dependencies)); ado.state.fault = null;
  const done = await fileBugReport(roots, 'bug-pair', preview.hash, dependencies); assert.equal(done.bugs[0].state, 'COMPLETED'); assert.equal(ado.state.attachments.size, 2); assert.equal(ado.state.items.get(800).relations.filter(item => item.rel === 'AttachedFile').length, 2);
  assert.equal(writes(ado).filter(item => item.path === 'wit/workitems/$bug').length, 1);
});
test('an eligible screenshot needs an annotation attempt; an explicit eligible raw-only fallback can be delivered', async t => {
  const ado = await adoFixture(t), {roots} = fixture(t), dependencies = deps(ado, roots), raw = input(); writeFileSync(join(roots.projectRoot, 'fallback.png'), image(120, 80));
  raw.evidence = [{path: 'fallback.png', kind: 'screenshot', origin: 'user', sanitized: true, verification: {privacy: true, relevance: true}, context: 'Synthetic image reviewed against this report'}]; const state = prepareBugReport(roots, 'bug-fallback', raw);
  assert.equal((await previewBugReport(roots, 'bug-fallback', dependencies)).ready, false);
  const fallback = await annotateBugReport(roots, 'bug-fallback', {source: state.evidence[0].path, output: '.harness/runs/bug-fallback/annotated.png', summary: 'Status error', expected: raw.draft.expected, actual: raw.draft.actual, boxes: [{kind: 'defect', x: 0.1, y: 0.1, width: 0.5, height: 0.5}], verification: {privacy: true, relevance: true}}, {inventory: dependencies.inventory, render: async () => {throw Object.assign(new Error('Unavailable'), {code: 'RENDERER_UNAVAILABLE'});}});
  assert.equal(fallback.annotations[0].record.state, 'RAW_ONLY'); assert.equal(fallback.annotations[0].record.reason, 'renderer-unavailable');
  const preview = await previewBugReport(roots, 'bug-fallback', dependencies); assert(preview.ready); assert.equal(preview.bugs[0].attachments.length, 1); approveBugReport(roots, 'bug-fallback', preview.hash); await fileBugReport(roots, 'bug-fallback', preview.hash, dependencies); assert.equal(ado.state.attachments.size, 1);
});
test('execution handoff retains the defect identity, verified observations and case-path configuration', async t => {
  const ado = await adoFixture(t), execution = await executionFixture(t, {organizationUrl: ado.config.organizationUrl, handler: (req, res) => {res.writeHead(500); res.end('{}');}}); execution.apiStep(); execution.freeze(); await executeApi(execution);
  const defect = deliverableDefects(collectExecution(execution.roots, execution.executionId)).defects[0]; ado.config.bugs = {pathsFrom: 'case'};
  const state = bugReportFromExecution(execution.roots, 'bug-execution', execution.executionId, defect.fingerprint), dependencies = deps(ado, execution.roots); assert.equal(state.intake.source.caseId, 101); assert.equal(state.confirmation.agent, 'reproduced');
  const preview = await previewBugReport(execution.roots, 'bug-execution', dependencies); assert.equal(preview.ready, true); assert.equal(preview.bugs[0].fingerprint, defect.fingerprint);
  ado.state.items.get(101).rev = 2; const stale = await previewBugReport(execution.roots, 'bug-execution', dependencies); assert.equal(stale.ready, false); assert.match(stale.problems[0].message, /case revision changed/i); assert.equal(writes(ado).length, 0);
});
