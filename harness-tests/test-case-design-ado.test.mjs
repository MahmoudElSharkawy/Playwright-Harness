import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fingerprint} from '../scripts/lib/execution-core/data.mjs';
import {adoDesignFixture} from './fixtures/test-case-design.mjs';
import {previewDesign, publishDesign, reconcileDesign} from '../scripts/lib/test-case-design/delivery.mjs';
import {readDesign, prepareDesign, saveDesign, assessDesign} from '../scripts/lib/test-case-design/index.mjs';
import {parseStepsXml} from '../scripts/lib/integrations/ado-steps.mjs';

test('mixed native publication preserves unrelated content/tags and prepares once with atomic story link', async t => {
  const f = await adoDesignFixture(t), options = {client: f.client};
  const preview = await previewDesign(f.roots, 'login', options); assert.equal(f.control.writes, 0);
  assert.equal(preview.operations.length, 2);
  await assert.rejects(publishDesign(f.roots, 'login', {...options, approval: 'yes'}), /approval/);
  const result = await publishDesign(f.roots, 'login', {...options, approval: preview.fingerprint});
  assert.equal(result.mode, 'completed'); assert.equal(f.control.writes, 2);
  for (const outcome of result.outcomes) {
    assert.equal(outcome.status, 'applied'); const item = f.state.items.get(outcome.adoId), steps = parseStepsXml(item.fields['Microsoft.VSTS.TCM.Steps']);
    assert.equal(steps.length, 2); assert(steps[0].action.includes('Preparation')); assert(steps[0].action.includes('Prerequisites:')); assert(steps[0].action.includes('Test data:'));
    assert.equal(steps[1].expected, f.proposal.cases[0].steps[0].expected);
    assert(item.fields['System.Description'].includes('Story 200')); assert(!item.fields['System.Description'].includes('TEST_PASSWORD'));
    assert(item.fields['System.Tags'].includes('Functional')); assert(item.fields['System.Tags'].includes('Positive'));
  }
  assert(f.state.items.get(101).fields['System.Description'].startsWith('<p>Keep unrelated content.</p>')); assert(f.state.items.get(101).fields['System.Tags'].includes('team-owned'));
  const created = f.state.items.get(result.outcomes[0].adoId); assert.equal(created.relations[0].rel, 'Microsoft.VSTS.Common.TestedBy-Reverse');
  assert.equal((await publishDesign(f.roots, 'login', {...options, approval: preview.fingerprint})).mode, 'completed'); assert.equal(f.control.writes, 2);
});

test('lost creation acknowledgement reconciles operation history and never duplicates creation', async t => {
  const f = await adoDesignFixture(t), options = {client: f.client, selected: ['NEW-01']}, preview = await previewDesign(f.roots, 'login', options); f.control.loseCreate = true;
  const uncertain = await publishDesign(f.roots, 'login', {...options, approval: preview.fingerprint}); assert.equal(uncertain.outcomes[0].status, 'uncertain'); assert.equal(f.control.writes, 1);
  assert.equal((await publishDesign(f.roots, 'login', {...options, approval: preview.fingerprint})).mode, 'reconciliation-required'); assert.equal(f.control.writes, 1);
  const recovered = await reconcileDesign(f.roots, 'login', {client: f.client}); assert.equal(recovered.outcomes[0].status, 'applied'); assert.equal(recovered.outcomes[0].adoId, 800); assert.equal(f.control.writes, 1);
  assert.equal(readDesign(f.roots, 'login').delivery.outcomes[0].adoId, 800);
});

test('changed sources, cases, fields and tag capability block affected publication before writes', async t => {
  for (const kind of ['story', 'case', 'field', 'tags', 'discussion']) {
    const f = await adoDesignFixture(t), options = {client: f.client}, preview = await previewDesign(f.roots, 'login', options);
    if (kind === 'story') f.state.items.get(200).rev++;
    if (kind === 'case') f.state.items.get(101).rev++;
    if (kind === 'field') f.control.denyField = 'System.Description';
    if (kind === 'tags') f.control.denyTags = true;
    if (kind === 'discussion') f.control.discussion.push({id: 1, version: 1, text: 'Changed expectation.'});
    await assert.rejects(publishDesign(f.roots, 'login', {...options, approval: preview.fingerprint})); assert.equal(f.control.writes, 0, kind);
  }
});

test('partial acknowledgement keeps completed operation and resumes only remaining authorized work', async t => {
  const f = await adoDesignFixture(t), options = {client: f.client}, preview = await previewDesign(f.roots, 'login', options);
  f.control.loseUpdate = true;
  const result = await publishDesign(f.roots, 'login', {...options, approval: preview.fingerprint}); assert.deepEqual(result.outcomes.map(row => row.status), ['applied', 'uncertain']);
  const recovered = await reconcileDesign(f.roots, 'login', options); assert.deepEqual(recovered.outcomes.map(row => row.status), ['applied', 'applied']); assert.equal(f.control.writes, 2);
});

test('reuse verifies native content and repeated update reconciles existing preparation without loss', async t => {
  const f = await adoDesignFixture(t), options = {client: f.client, selected: ['101']}, preview = await previewDesign(f.roots, 'login', options);
  await publishDesign(f.roots, 'login', {...options, approval: preview.fingerprint});
  let state = await prepareDesign(f.roots, 'login', {version: 1, analysisId: 'login', caseIds: [101]}, {client: f.client});
  const row = structuredClone(f.proposal.cases[1]); row.proposedAction = 'Reuse unchanged';
  const proposal = {...f.proposal, source: state.source, cases: [row], mappings: f.proposal.mappings.filter(row => row.caseId === '101'), preparations: f.proposal.preparations.filter(row => row.caseId === '101')};
  state = saveDesign(f.roots, 'login', proposal);
  const assessment = {version: 1, proposal: state.proposal, reviewer: 'fresh-reviewer', cases: [{id: '101', verdict: 'pass', reason: 'Actual native content matches the accepted story.'}], requirements: [{id: row.coverageReferences[0].requirementId, verdict: 'covered', reason: 'Exact observable outcome verifies the accepted rule.', caseIds: ['101']}]};
  assessDesign(f.roots, 'login', assessment);
  const unchanged = await previewDesign(f.roots, 'login', options); assert.equal(unchanged.operations[0].request, null);
  const reused = await publishDesign(f.roots, 'login', {...options, approval: unchanged.fingerprint}); assert.equal(reused.outcomes[0].status, 'unchanged'); assert.equal(f.control.writes, 1);
  state = await prepareDesign(f.roots, 'second-edit', {version: 1, analysisId: 'login', caseIds: [101]}, {client: f.client});
  row.proposedAction = 'Update'; row.title = 'Sign in with the correct identity';
  state = saveDesign(f.roots, 'second-edit', {...proposal, source: state.source, cases: [row]}); assessDesign(f.roots, 'second-edit', {...assessment, proposal: state.proposal});
  const changed = await previewDesign(f.roots, 'second-edit', options); await publishDesign(f.roots, 'second-edit', {...options, approval: changed.fingerprint});
  assert.equal(parseStepsXml(f.state.items.get(101).fields['Microsoft.VSTS.TCM.Steps']).filter(step => step.action.startsWith('Preparation')).length, 1); assert.equal(f.control.writes, 2);
});

test('concurrent requirement change after a creation blocks remaining updates despite the owned story link', async t => {
  const f = await adoDesignFixture(t), options = {client: f.client}, preview = await previewDesign(f.roots, 'login', options);
  f.control.afterWrite = item => {if (item.id === 800) f.state.items.get(200).fields['Microsoft.VSTS.Common.AcceptanceCriteria'] = 'A different accepted rule.';};
  const result = await publishDesign(f.roots, 'login', {...options, approval: preview.fingerprint});
  assert.deepEqual(result.outcomes.map(row => row.status), ['applied', 'failed']); assert.equal(f.control.writes, 1);
});

test('rewriting a saved preview with a self-consistent new hash cannot reuse the old approval', async t => {
  const f = await adoDesignFixture(t), options = {client: f.client}, preview = await previewDesign(f.roots, 'login', options);
  const path = join(f.roots.projectRoot, '.harness/state/test-case-design/login/previews', `${preview.fingerprint}.json`), saved = JSON.parse(readFileSync(path));
  delete saved.fingerprint; saved.selected = ['NEW-01']; saved.operations = saved.operations.slice(0, 1); saved.fingerprint = fingerprint(saved); writeFileSync(path, JSON.stringify(saved));
  await assert.rejects(publishDesign(f.roots, 'login', {...options, approval: preview.fingerprint}), /approved identity/); assert.equal(f.control.writes, 0);
});
