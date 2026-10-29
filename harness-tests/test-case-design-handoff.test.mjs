import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {postcodeFixture, postcodeAssessment, postcodeRules} from './fixtures/postcode-design.mjs';
import {retainAssessment} from './fixtures/design-review.mjs';
import {designHandoff, designView, readDesign, saveDesign, assessDesign} from '../scripts/lib/test-case-design/index.mjs';
import {previewDesign, publishDesign, reconcileDesign} from '../scripts/lib/test-case-design/delivery.mjs';
import {loadTestSource, createAdoTestSource} from '../scripts/lib/integrations/ado-source.mjs';
import {prepareSource} from '../scripts/lib/execute/source.mjs';
import {preparationSteps, renderDesign} from '../scripts/lib/test-case-design/review.mjs';

test('unaccepted referenced rules block only postcode cases and leave valid Cancel publication available', async t => {
  const f = await postcodeFixture(t, {acceptRules: false}), options = {client: f.client};
  const view = designView(f.roots, 'postcode');
  assert.equal(view.coverage.complete, false);
  assert.deepEqual(view.coverage.gaps.map(row => row.requirementId), ['postcode']);
  await assert.rejects(previewDesign(f.roots, 'postcode', {...options, selected: ['NEW-short']}), /reference|dependency/i);
  await assert.rejects(designHandoff(f.roots, 'postcode', {...options, selected: ['NEW-trim']}), /reference|dependency/i);
  assert.equal(f.control.writes, 0);
  const preview = await previewDesign(f.roots, 'postcode', {...options, selected: ['NEW-cancel']});
  const delivered = await publishDesign(f.roots, 'postcode', {...options, approval: preview.fingerprint});
  assert.equal(delivered.outcomes[0].status, 'applied'); assert.equal(f.control.writes, 1);
  assert.equal(delivered.coverage.complete, false);
});

test('accepted postcode cases preserve every step, input variation and cleanup through both supported intakes', async t => {
  const f = await postcodeFixture(t), options = {client: f.client};
  const handoff = await designHandoff(f.roots, 'postcode', options);
  const local = await loadTestSource(f.roots, {kind: 'local', path: handoff.path});
  const preview = await previewDesign(f.roots, 'postcode', options), delivered = await publishDesign(f.roots, 'postcode', {...options, approval: preview.fingerprint});
  assert.equal(delivered.mode, 'completed'); assert.equal(delivered.coverage.complete, true);
  const executable = prepareSource(await createAdoTestSource(f.client).fetchStory(200, ['tested-by'], {tolerant: true}), {kind: 'story', storyId: 200});
  for (const row of f.proposal.cases) {
    const expected = [...preparationSteps(row, f.proposal.preparations.find(item => item.caseId === row.id)), ...row.steps].map(({action, expected}) => ({action, expected: [expected]}));
    const remoteId = delivered.outcomes.find(item => item.caseId === row.id).adoId;
    for (const steps of [local.scenarios.find(item => item.id === row.id).steps, executable.scenarios.find(item => item.caseId === remoteId).steps.map(({action, expected}) => ({action, expected}))]) {
      assert.deepEqual(steps, expected);
      const missingAction = structuredClone(steps), missingExpectation = structuredClone(steps);
      missingAction[2].action = ''; missingExpectation[2].expected = [];
      assert.throws(() => assert.deepEqual(missingAction, expected));
      assert.throws(() => assert.deepEqual(missingExpectation, expected));
    }
  }
  const afterDelivery = await designHandoff(f.roots, 'postcode', options);
  assert.equal(afterDelivery.execution, 'not-run'); assert.equal(afterDelivery.automation, 'not-generated');
  assert.equal(renderDesign(f.design.draft).summary.total, 4);
  if (process.env.DESIGN_REVIEW_EVIDENCE_DIR) {
    const directory = process.env.DESIGN_REVIEW_EVIDENCE_DIR; mkdirSync(directory, {recursive: true});
    writeFileSync(join(directory, 'postcode-cases.md'), renderDesign(f.design.draft).markdown);
    writeFileSync(join(directory, 'postcode-evidence.json'), JSON.stringify({source: f.design.evidence, proposal: f.design.draft, assessment: f.design.review, handoff: afterDelivery, local, executable, delivered}, null, 2));
  }
});

test('referenced revision changes invalidate preview and reconciled completeness without changing the selected story', async t => {
  const f = await postcodeFixture(t), options = {client: f.client}, preview = await previewDesign(f.roots, 'postcode', options);
  const previewPath = join(f.roots.projectRoot, '.harness/state/test-case-design/postcode/previews', `${preview.fingerprint}.json`), bytes = readFileSync(previewPath, 'utf8');
  f.state.items.get(1180).rev++;
  await assert.rejects(publishDesign(f.roots, 'postcode', {...options, approval: preview.fingerprint}), /referenced source.*changed/i);
  assert.equal(f.control.writes, 0); assert.equal(f.state.items.get(200).rev, 1); assert.equal(readFileSync(previewPath, 'utf8'), bytes);
  const other = await postcodeFixture(t), approved = await previewDesign(other.roots, 'postcode', {client: other.client});
  await publishDesign(other.roots, 'postcode', {client: other.client, approval: approved.fingerprint});
  other.state.items.get(1180).rev++;
  const recovered = await reconcileDesign(other.roots, 'postcode', {client: other.client});
  assert(recovered.outcomes.every(row => row.status === 'applied'));
  assert.equal(recovered.coverage.complete, false, 'Reconciliation proves earlier writes, not freshness of referenced rules.');
  assert.equal(recovered.coverage.requirements.find(row => row.requirementId === 'cancel').status, 'covered');
  assert.equal(designView(other.roots, 'postcode').confirmedCoverage.complete, false);
});

test('ambiguous steps need source-backed revision and a new retained review before handoff', async t => {
  const f = await postcodeFixture(t), ambiguous = structuredClone(f.proposal);
  ambiguous.cases[0].steps[1].action = 'Enter it and save.';
  let state = saveDesign(f.roots, 'postcode', {...ambiguous, head: f.design.head});
  const review = postcodeAssessment(state);
  review.cases[0] = {id: 'NEW-leading-zero', verdict: 'revise', reason: 'The step omits target and input. The captured rule identifies the customer-owned address and 01234; name those explicitly.'};
  review.requirements[0].verdict = 'gap';
  state = assessDesign(f.roots, 'postcode', retainAssessment(f.roots, state, review));
  await assert.rejects(designHandoff(f.roots, 'postcode', {client: f.client, selected: ['NEW-leading-zero']}), /corrections/);
  const oldReview = readFileSync(join(f.roots.projectRoot, state.review.evidence.output.path), 'utf8'), before = renderDesign(state.draft).markdown;
  assert(postcodeRules.includes('Saving 01234'));
  const corrected = saveDesign(f.roots, 'postcode', {...f.proposal, head: state.head});
  assert.equal(corrected.review, null);
  assessDesign(f.roots, 'postcode', retainAssessment(f.roots, corrected, postcodeAssessment(corrected)));
  await designHandoff(f.roots, 'postcode', {client: f.client, selected: ['NEW-leading-zero']});
  assert.equal(readFileSync(join(f.roots.projectRoot, state.review.evidence.output.path), 'utf8'), oldReview);
  assert.notEqual(readDesign(f.roots, 'postcode').proposal, state.proposal);
  if (process.env.DESIGN_REVIEW_EVIDENCE_DIR) {
    const directory = process.env.DESIGN_REVIEW_EVIDENCE_DIR; mkdirSync(directory, {recursive: true});
    writeFileSync(join(directory, 'ambiguous-before.md'), before);
    writeFileSync(join(directory, 'clarified-after.md'), renderDesign(corrected.draft).markdown);
    writeFileSync(join(directory, 'ambiguity-review.json'), oldReview);
  }
});
