import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures/execution-core.mjs';
import {adoFixture} from './fixtures/ado.mjs';
import {executionFixture, executeApi} from './fixtures/execute.mjs';
import {createAdoClient} from '../scripts/lib/integrations/ado-client.mjs';
import {prepareBugReport, readBugReport, editBugReport, previewBugReport, approveBugReport, fileBugReport, bugReportFromExecution} from '../scripts/lib/bug-report/index.mjs';
import {collectExecution, deliverableDefects} from '../scripts/lib/execute/report.mjs';
import {deliverExecution} from '../scripts/lib/execute/delivery.mjs';
import {renderBugNarrative} from '../scripts/lib/execute/bug-narrative.mjs';

const inventory = async () => [{pid: process.pid, identity: '1'}];
const dependencies = (ado, roots) => ({client: createAdoClient({configuration: ado.config, roots, resolveCredential: () => ado.credential, fetchImpl: ado.fetchImpl}), inventory});
const intake = () => ({version: 1, description: 'An existing record returns an error.', source: {storyId: 200, revision: 1, content: 'INTERNAL_SOURCE_SNAPSHOT', expected: 'Status 200', sourceFingerprint: 'INTERNAL_SOURCE_HASH'},
  draft: {title: 'Existing record returns an error', description: 'The existing record cannot be read.', prerequisites: ['An existing record'], steps: ['Read the record'], expected: 'Status 200', actual: 'Status 500', fields: {}},
  confirmation: {user: 'confirmed', agent: 'not-run', notes: 'User confirmed two attempts on QA.'}, evidence: []});
const narrative = fields => fields['System.Description'] ?? fields['Microsoft.VSTS.TCM.ReproSteps'];
const writes = ado => ado.state.requests.filter(row => row.method !== 'GET' && !['wit/wiql', 'wit/workitemsbatch'].includes(row.path) && !row.query.includes('validateOnly=true'));

test('approved ADO narratives contain readable source and confirmation while the full intake stays internal', async t => {
  const ado = await adoFixture(t), {roots} = fixture(t), raw = intake(), deps = dependencies(ado, roots);
  ado.state.fault = ({path, send}) => {if (path === 'wit/workitemtypes/bug/fields') {send({value: ['System.Title', 'System.Tags', 'System.Description', 'Microsoft.VSTS.TCM.ReproSteps'].map(referenceName => ({referenceName, type: ['System.Title', 'System.Tags'].includes(referenceName) ? 'string' : 'html'}))}); return true;}};
  prepareBugReport(roots, 'readable', raw); const preview = await previewBugReport(roots, 'readable', deps); assert(preview.ready);
  const html = narrative(preview.bugs[0].fields);
  assert.match(html, /Story #200/); assert.match(html, /User confirmation: Confirmed/); assert.match(html, /Agent reproduction: Not performed/); assert.match(html, /User confirmed two attempts on QA\./);
  for (const text of ['INTERNAL_SOURCE_SNAPSHOT', 'INTERNAL_SOURCE_HASH', 'sourceFingerprint', '"origin"', '"confirmation"']) assert(!html.includes(text), text);
  for (const field of ['System.Description', 'Microsoft.VSTS.TCM.ReproSteps']) assert.equal(preview.bugs[0].fields[field], html);
  assert.equal(writes(ado).length, 0); await assert.rejects(fileBugReport(roots, 'readable', preview.hash, deps));
  approveBugReport(roots, 'readable', preview.hash); await fileBugReport(roots, 'readable', preview.hash, deps);
  assert.equal(narrative(ado.state.items.get(800).fields), html); assert.deepEqual(readBugReport(roots, 'readable').intake, raw);
});

for (const [status, label] of [['not-run', 'Not performed'], ['reproduced', 'Reproduced'], ['inconclusive', 'Inconclusive'], ['not-reproduced', 'Not reproduced']]) test(`agent confirmation ${status} is readable and distinct from user confirmation`, async t => {
  const ado = await adoFixture(t), {roots} = fixture(t), raw = intake(); delete raw.source.storyId; delete raw.source.revision;
  raw.confirmation = {user: 'reported', agent: status}; prepareBugReport(roots, `confirmation-${status}`, raw);
  const preview = await previewBugReport(roots, `confirmation-${status}`, dependencies(ado, roots)), html = narrative(preview.bugs[0].fields);
  assert(preview.ready); assert.match(html, /Source: User report/); assert.match(html, /User confirmation: Not confirmed/); assert(html.includes(`Agent reproduction: ${label}`)); assert(!html.includes('Story #'));
});

test('readable confirmation escapes markup and preserves deliberately approved API JSON', async t => {
  const ado = await adoFixture(t), {roots} = fixture(t), raw = intake(); raw.confirmation.notes = 'QA <script>alert("x")</script> & comparison'; raw.draft.actual = '{"error":"missing record"}';
  prepareBugReport(roots, 'escaped', raw); const preview = await previewBugReport(roots, 'escaped', dependencies(ado, roots)), html = narrative(preview.bugs[0].fields);
  assert(preview.ready); assert(!html.includes('<script>')); assert(html.includes('&lt;script&gt;')); assert(html.includes('&amp; comparison')); assert(html.includes('missing record')); assert.equal(readBugReport(roots, 'escaped').draft.actual, raw.draft.actual);
});

for (const handoff of [true, false]) test(`${handoff ? 'bug-report handoff' : 'direct execution filing'} uses readable execution observations without leaking run metadata`, async t => {
  const ado = await adoFixture(t), f = await executionFixture(t, {organizationUrl: ado.config.organizationUrl, handler: (_, res) => {res.writeHead(500); res.end('{}');}});
  f.apiStep(); f.freeze(); await executeApi(f); await executeApi(f, {explicitRerun: true}); const before = collectExecution(f.roots, f.executionId), defect = deliverableDefects(before).defects[0], deps = dependencies(ado, f.roots);
  let preview;
  if (handoff) {
    const state = bugReportFromExecution(f.roots, 'execution', f.executionId, defect.fingerprint);
    assert(!state.draft.actual.includes('runId')); assert(!state.confirmation.notes.includes(defect.fingerprint)); assert.deepEqual(JSON.parse(state.intake.source.content).occurrences, defect.occurrences);
    preview = await previewBugReport(f.roots, 'execution', deps); assert(preview.ready);
  } else {
    ado.state.items.get(101).rev = 2;
    preview = await deliverExecution(f.roots, f.executionId, 'file-bugs', {}, deps);
  }
  const html = narrative(preview.bugs[0].fields); assert.match(html, /Source: Test execution/); assert.match(html, /Test case #101/); assert.match(html, /Recorded failure occurrences: 2/);
  for (const text of [f.executionId, defect.fingerprint, 'runId', 'evidenceIds', 'sourceFingerprint', ...defect.occurrences.map(row => row.runId)]) assert(!html.includes(text), text);
  if (!handoff) assert.match(html, /changed after execution.*revision 1.*revision 2/);
  assert.deepEqual(collectExecution(f.roots, f.executionId).execution, before.execution); assert.equal(writes(ado).length, 0);
});

test('older generated execution defaults are readable in narrative and custom Actual fields without rewriting saved history', async t => {
  const ado = await adoFixture(t), f = await executionFixture(t, {organizationUrl: ado.config.organizationUrl, handler: (_, res) => {res.writeHead(500); res.end('{}');}});
  f.apiStep(); f.freeze(); await executeApi(f); const defect = deliverableDefects(collectExecution(f.roots, f.executionId)).defects[0];
  const initial = bugReportFromExecution(f.roots, 'older', f.executionId, defect.fingerprint), actual = JSON.stringify(defect.occurrences), notes = `Verified execution ${f.executionId}; ${defect.fingerprint}`;
  editBugReport(f.roots, 'older', {head: initial.head, draft: {actual}, confirmation: {notes}});
  ado.config.bugs = {fieldMap: {actual: 'Custom.Actual'}};
  ado.state.fault = ({path, send}) => {if (path === 'wit/workitemtypes/bug/fields') {send({value: ['System.Title', 'System.Tags', 'Microsoft.VSTS.TCM.ReproSteps', 'Custom.Actual'].map(referenceName => ({referenceName, type: referenceName.endsWith('ReproSteps') ? 'html' : 'string'}))}); return true;}};
  const deps = dependencies(ado, f.roots), preview = await previewBugReport(f.roots, 'older', deps); assert(preview.ready);
  for (const field of ['Microsoft.VSTS.TCM.ReproSteps', 'Custom.Actual']) {assert.match(preview.bugs[0].fields[field], /Recorded failure occurrences: 1/); for (const value of [f.executionId, defect.fingerprint, 'runId', 'evidenceIds']) assert(!preview.bugs[0].fields[field].includes(value), value);}
  approveBugReport(f.roots, 'older', preview.hash); await fileBugReport(f.roots, 'older', preview.hash, deps);
  assert.equal(ado.state.items.get(800).fields['Custom.Actual'], preview.bugs[0].fields['Custom.Actual']);
  assert.equal(readBugReport(f.roots, 'older').draft.actual, actual); assert.equal(readBugReport(f.roots, 'older').confirmation.notes, notes);
});

test('shared-source changes remain readable without claiming a changed case revision or confirmed reproduction', () => {
  const view = {source: {scope: {kind: 'story', storyId: 200}, scenarios: []}}, defect = {caseId: 101, status: 'INDETERMINATE', occurrences: [{status: 'INDETERMINATE'}, {status: 'DIAGNOSTIC'}]};
  const changed = {caseId: 101, executed: 1, current: 1, sharedSteps: [{id: 102, executed: 2, current: 3}, {id: 103, executed: 4, current: null}]};
  const {html} = renderBugNarrative(view, defect, {}, changed);
  assert.match(html, /Shared steps #102.*revision 2.*revision 3/); assert.match(html, /Shared steps #103.*revision 4.*unavailable/);
  assert.match(html, /Agent reproduction: Inconclusive/); assert.match(html, /Inconclusive observations: 1/); assert.match(html, /Recorded diagnostics: 1/);
  assert(!html.includes('Recorded failure occurrences')); assert(!html.includes('"sharedSteps"')); assert(!html.includes('undefined')); assert(!html.includes('executed revision 1, current revision 1'));
});
