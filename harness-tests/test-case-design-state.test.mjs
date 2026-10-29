import {retainAssessment} from './fixtures/design-review.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {adoDesignFixture} from './fixtures/test-case-design.mjs';
import {putRequirementFile as put} from './fixtures/requirements.mjs';
import {consumerRoots} from '../scripts/lib/consumer-paths.mjs';
import {fingerprint} from '../scripts/lib/execution-core/data.mjs';
import {captureRequirements, prepareRequirements, readRequirementsSource, updateInventory} from '../scripts/lib/requirements/index.mjs';
import {previewDesign, publishDesign, reconcileDesign} from '../scripts/lib/test-case-design/delivery.mjs';
import {readDesign, prepareDesign, saveDesign, assessDesign, rejectDesign, designHandoff, designView} from '../scripts/lib/test-case-design/index.mjs';
import {requireFreshDesign} from '../scripts/lib/test-case-design/sources.mjs';

test('successive selected approvals retain prior receipts, identities and cumulative confirmed coverage', async t => {
  const f = await adoDesignFixture(t), options = {client: f.client};
  const first = await previewDesign(f.roots, 'login', {...options, selected: ['NEW-01']});
  const created = await publishDesign(f.roots, 'login', {...options, approval: first.fingerprint});
  assert.equal(created.coverage.complete, false);
  const receiptPath = join(f.roots.projectRoot, created.outcomes[0].receipt), receipt = readFileSync(receiptPath, 'utf8');
  const second = await previewDesign(f.roots, 'login', {...options, selected: ['101']});
  const updated = await publishDesign(f.roots, 'login', {...options, approval: second.fingerprint});
  assert.equal(updated.mode, 'completed'); assert.equal(updated.coverage.complete, true); assert.equal(f.control.writes, 2);
  assert.equal(designView(f.roots, 'login').confirmedCoverage.complete, true);
  assert.equal(readDesign(f.roots, 'login').created['NEW-01'], 800);
  assert.equal(readFileSync(receiptPath, 'utf8'), receipt, 'The first approved operation receipt remains immutable.');
  const handoff = await designHandoff(f.roots, 'login', options);
  assert.deepEqual(handoff.source.scenarios.map(row => row.externalReferences[0].id), ['800', '101']);
  await publishDesign(f.roots, 'login', {...options, approval: first.fingerprint});
  await publishDesign(f.roots, 'login', {...options, approval: second.fingerprint});
  assert.equal(f.control.writes, 2, 'Repeating either approval must not replay completed operations.');
});

test('a later overlapping selection verifies completed operations without creating or updating twice', async t => {
  const f = await adoDesignFixture(t), options = {client: f.client};
  const first = await previewDesign(f.roots, 'login', {...options, selected: ['NEW-01']});
  await publishDesign(f.roots, 'login', {...options, approval: first.fingerprint});
  const second = await previewDesign(f.roots, 'login', options);
  const result = await publishDesign(f.roots, 'login', {...options, approval: second.fingerprint});
  assert.equal(result.mode, 'completed'); assert.equal(result.coverage.complete, true); assert.equal(f.control.writes, 2);
  const reconciled = await reconcileDesign(f.roots, 'login', options);
  assert.deepEqual(reconciled.outcomes.map(row => [row.adoId, row.status]), [[800, 'applied'], [101, 'applied']]);
  assert.equal(f.control.writes, 2);
});

test('newer uncertainty overrides archived success for coverage, source trust and handoff', async t => {
  const f = await adoDesignFixture(t), options = {client: f.client};
  const first = await previewDesign(f.roots, 'login', {...options, selected: ['NEW-01']});
  await publishDesign(f.roots, 'login', {...options, approval: first.fingerprint});
  const second = await previewDesign(f.roots, 'login', options);
  await publishDesign(f.roots, 'login', {...options, approval: second.fingerprint});
  const created = f.state.items.get(800), title = created.fields['System.Title'];
  created.fields['System.Title'] = 'A different case title'; created.rev++;
  const uncertain = await reconcileDesign(f.roots, 'login', options);
  assert.deepEqual(uncertain.outcomes.map(row => row.status), ['uncertain', 'applied']);
  assert.equal(uncertain.coverage.complete, false); assert.equal(designView(f.roots, 'login').confirmedCoverage.complete, false);
  assert.deepEqual(uncertain.coverage.requirements[0].caseIds, ['101'], 'The separate confirmed update remains usable.');
  await assert.rejects(requireFreshDesign(f.roots, readDesign(f.roots, 'login'), options), /changed/);
  await assert.rejects(designHandoff(f.roots, 'login', options), /changed/);
  assert.equal(f.control.writes, 2);
  created.fields['System.Title'] = title; created.rev++;
  const recovered = await reconcileDesign(f.roots, 'login', options);
  assert.equal(recovered.coverage.complete, true);
  assert.equal((await designHandoff(f.roots, 'login', options)).source.scenarios[0].externalReferences[0].id, '800');
  assert.equal(f.control.writes, 2, 'Reconciliation never replays either operation.');
});

test('rejecting or editing away and back never revives an earlier preview approval', async t => {
  for (const change of ['reject', 'edit-back']) {
    const f = await adoDesignFixture(t), options = {client: f.client, selected: ['101']};
    const first = await previewDesign(f.roots, 'login', options), reviewed = readDesign(f.roots, 'login');
    if (change === 'reject') rejectDesign(f.roots, 'login');
    else {
      const changed = structuredClone(f.proposal); changed.cases[1].title += ' revised';
      const edited = saveDesign(f.roots, 'login', {...changed, head: reviewed.head});
      saveDesign(f.roots, 'login', {...f.proposal, head: edited.head});
    }
    assessDesign(f.roots, 'login', reviewed.review);
    await assert.rejects(publishDesign(f.roots, 'login', {...options, approval: first.fingerprint}), /renewed approval/);
    assert.equal(f.control.writes, 0, change);
    const renewed = await previewDesign(f.roots, 'login', options); assert.notEqual(renewed.fingerprint, first.fingerprint);
    assert.equal((await publishDesign(f.roots, 'login', {...options, approval: renewed.fingerprint})).mode, 'completed');
    assert.equal(f.control.writes, 1);
  }
});

test('handoff gains confirmed ADO references in new immutable source and trace artifacts', async t => {
  const f = await adoDesignFixture(t), options = {client: f.client, selected: ['NEW-01']};
  const before = await designHandoff(f.roots, 'login', options), path = join(f.roots.projectRoot, before.path);
  const tracePath = join(f.roots.projectRoot, '.harness/state/test-case-design/login/handoffs', before.path.split('/').at(-1));
  const sourceBytes = readFileSync(path, 'utf8'), traceBytes = readFileSync(tracePath, 'utf8');
  const preview = await previewDesign(f.roots, 'login', options);
  await publishDesign(f.roots, 'login', {...options, approval: preview.fingerprint});
  const after = await designHandoff(f.roots, 'login', options);
  assert.notEqual(after.path, before.path); assert.equal(after.source.scenarios[0].externalReferences[0].id, '800');
  assert.equal(JSON.parse(readFileSync(join(f.roots.projectRoot, after.path))).scenarios[0].externalReferences[0].id, '800');
  assert.equal(readFileSync(path, 'utf8'), sourceBytes); assert.equal(readFileSync(tracePath, 'utf8'), traceBytes);
  assert.deepEqual(await designHandoff(f.roots, 'login', options), after);
});

test('reuse rejects conflicting native scenario or test classifications without writes', async t => {
  for (const conflicting of ['Negative', 'Security']) {
    const f = await adoDesignFixture(t), options = {client: f.client, selected: ['101']};
    const preview = await previewDesign(f.roots, 'login', options); await publishDesign(f.roots, 'login', {...options, approval: preview.fingerprint});
    const item = f.state.items.get(101); item.fields['System.Tags'] += '; ' + conflicting; item.rev++;
    let state = await prepareDesign(f.roots, 'reuse-conflict', {version: 1, analysisId: 'login', caseIds: [101]}, {client: f.client});
    const row = {...f.proposal.cases[1], proposedAction: 'Reuse unchanged'};
    state = saveDesign(f.roots, 'reuse-conflict', {...f.proposal, source: state.source, cases: [row], mappings: f.proposal.mappings.filter(row => row.caseId === '101'), preparations: f.proposal.preparations.filter(row => row.caseId === '101')});
    assessDesign(f.roots, 'reuse-conflict', retainAssessment(f.roots, state, {version: 1, proposal: state.proposal, reviewer: 'fresh-reviewer', cases: [{id: '101', verdict: 'pass', reason: 'The step checks the correct account identity.'}], requirements: [{id: row.coverageReferences[0].requirementId, verdict: 'covered', reason: 'The step verifies the accepted outcome.', caseIds: ['101']}]}));
    await assert.rejects(previewDesign(f.roots, 'reuse-conflict', options), /classification/);
    assert.equal(f.control.writes, 1); assert(item.fields['System.Tags'].includes('team-owned'));
  }
});

test('moving partitioned paragraphs preserves every unambiguous slice identity and invalidates acceptance', async () => {
  const roots = consumerRoots(mkdtempSync(join(tmpdir(), 'pom-design-slices-'))), request = {version: 1, project: 'demo', application: 'login', sources: [{id: 'story', kind: 'file', path: 'story.md'}]};
  const lines = ['Alpha is allowed. Beta is denied.', 'Gamma is allowed. Delta is denied.']; put(roots, 'story.md', lines.join('\n'));
  let state = prepareRequirements(roots, 'login', await captureRequirements(roots, request)), source = readRequirementsSource(roots, state);
  state = updateInventory(roots, 'login', {version: 1, snapshot: state.snapshot, partitions: source.parts.map((part, index) => ({partId: part.id, entries: [{id: `part${index}-a`, start: 0, end: part.text.indexOf('.') + 1}, {id: `part${index}-b`, start: part.text.indexOf('.') + 2, end: part.text.length}]}))});
  const changes = state.inventory.map(entry => {
    const decision = {version: 1, authority: 'owner', actor: 'Synthetic owner', consumer: state.consumer, snapshot: state.snapshot, requirementId: entry.id, content: entry.content, disposition: 'accepted', statement: 'The selected source statement is accepted.'};
    const path = `decision-${entry.id}.json`; put(roots, path, decision);
    return {id: entry.id, disposition: 'accepted', evidence: [{kind: 'decision', path, fingerprint: fingerprint(decision)}]};
  });
  state = updateInventory(roots, 'login', {version: 1, snapshot: state.snapshot, changes});
  assert(state.inventory.every(entry => entry.disposition === 'accepted'));
  const before = Object.fromEntries(state.inventory.map(entry => [source.parts.find(part => part.id === entry.partId).text.slice(entry.start, entry.end), entry.id]));
  put(roots, 'story.md', [...lines].reverse().join('\n'));
  const refreshed = prepareRequirements(roots, 'login', await captureRequirements(roots, request)); source = readRequirementsSource(roots, refreshed);
  assert.equal(refreshed.inventory.length, 4);
  for (const entry of refreshed.inventory) {
    assert.equal(entry.id, before[source.parts.find(part => part.id === entry.partId).text.slice(entry.start, entry.end)]);
    assert.notEqual(entry.disposition, 'accepted'); assert.deepEqual(entry.evidence, []);
    assert(refreshed.staleRequirementIds.includes(entry.id));
  }
});

test('a selected attachment missing from verified story relations stays an explicit blocking omission', async t => {
  const f = await adoDesignFixture(t), attachmentId = 'aaaaaaaa-1111-2222-3333-444444444444';
  const request = {version: 1, project: 'demo', application: 'login', storyId: 200, sources: [], attachmentIds: [attachmentId]};
  const captured = await captureRequirements(f.roots, request, {client: f.client});
  assert(captured.omissions.some(row => row.sourceId === 'ado-attachment-' + attachmentId && /inaccessible|incomplete|unverified/.test(row.reason)));
  assert(!f.state.requests.some(row => row.path.includes('/attachments/')), 'Missing selection cannot authorize arbitrary attachment retrieval.');
  f.state.items.get(200).relations.push({rel: 'AttachedFile', url: `https://unrelated.example.test/_apis/wit/attachments/${attachmentId}`, attributes: {name: 'outside.md'}});
  const unverified = await captureRequirements(f.roots, request, {client: f.client});
  assert(unverified.omissions.some(row => row.sourceId === 'ado-attachment-' + attachmentId && /unverified/.test(row.reason)));
  assert(!f.state.requests.some(row => row.path.includes('/attachments/')), 'An unverified link cannot authorize retrieval.');
  const prepared = await prepareDesign(f.roots, 'missing-attachment', {version: 1, analysisId: 'missing-attachment', request}, {client: f.client});
  const entry = prepared.requirements.inventory.find(row => row.kind === 'criterion'), part = prepared.evidence.requirements.parts.find(row => row.id === entry.partId);
  updateInventory(f.roots, 'missing-attachment', {version: 1, snapshot: prepared.requirements.snapshot, changes: [{id: entry.id, disposition: 'accepted', evidence: [{kind: 'source', partId: part.id, revision: part.revision, quote: part.text}]}]});
  let state = await prepareDesign(f.roots, 'missing-attachment', {version: 1, analysisId: 'missing-attachment', caseIds: [101]}, {client: f.client});
  state = saveDesign(f.roots, 'missing-attachment', {...f.proposal, source: state.source});
  assessDesign(f.roots, 'missing-attachment', retainAssessment(f.roots, state, {...f.design.review, proposal: state.proposal}));
  await assert.rejects(previewDesign(f.roots, 'missing-attachment', {client: f.client}), /incomplete source evidence/);
  assert.equal(f.control.writes, 0);
});
