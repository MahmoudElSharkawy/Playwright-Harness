import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {designFixture, assessmentFor} from './fixtures/design-local.mjs';
import {retainAssessment} from './fixtures/design-review.mjs';
import {adoDesignFixture} from './fixtures/test-case-design.mjs';
import {saveDesign, assessDesign, readDesign, designView, designHandoff, saveDesignState} from '../scripts/lib/test-case-design/index.mjs';
import {previewDesign, publishDesign, reconcileDesign} from '../scripts/lib/test-case-design/delivery.mjs';
import {editStepsXml} from '../scripts/lib/integrations/ado-step-edit.mjs';
import {fingerprint, digest} from '../scripts/lib/execution-core/data.mjs';
import * as review from '../scripts/lib/test-case-design/review.mjs';

test('assessment requires retained run output bound to source, proposal and actual findings', async () => {
  const f = await designFixture(), state = saveDesign(f.roots, 'login', f.proposal), assessment = assessmentFor(state);
  assert.throws(() => assessDesign(f.roots, 'login', assessment), /retained|evidence/i);
  const receipt = retainAssessment(f.roots, state, assessment);
  const mismatched = structuredClone(receipt); mismatched.cases[0].reason = 'Different findings';
  assert.throws(() => assessDesign(f.roots, 'login', mismatched), /output|binding/i);
  const saved = assessDesign(f.roots, 'login', receipt);
  assert.match(saved.review.evidence.output.path, /state\/test-case-design\/login\/reviews\//);
  assert.equal(review.coverage(saved, undefined, {roots: f.roots}).complete, true);
});

test('retained review survives original export removal but missing retained output blocks handoff and completeness', async () => {
  const f = await designFixture(), state = saveDesign(f.roots, 'login', f.proposal);
  const receipt = retainAssessment(f.roots, state, assessmentFor(state)), saved = assessDesign(f.roots, 'login', receipt);
  unlinkSync(join(f.roots.projectRoot, receipt.evidence.output.path));
  await designHandoff(f.roots, 'login', {selected: ['NEW-01']});
  unlinkSync(join(f.roots.projectRoot, saved.review.evidence.output.path));
  assert.equal(designView(f.roots, 'login').coverage.complete, false);
  await assert.rejects(designHandoff(f.roots, 'login', {selected: ['NEW-01']}), /review|evidence/i);
  assert.equal(readDesign(f.roots, 'login').proposal, saved.proposal, 'Historical state remains readable.');
});

test('exact-content warnings preserve mappings and meaningful differences; ambiguous cases need revision', async () => {
  const f = await designFixture(), first = f.proposal.cases[0], second = f.proposal.cases[1];
  Object.assign(second, {prerequisites: first.prerequisites, testData: first.testData, steps: structuredClone(first.steps)});
  f.proposal.mappings[1].checks = [{step: 2, expected: second.steps[1].expected, data: second.testData}];
  const state = saveDesign(f.roots, 'login', f.proposal), groups = review.exactDuplicates(state);
  assert.equal(groups.length, 1); assert.deepEqual(groups[0].caseIds, ['NEW-01', 'NEW-02']);
  assert.equal(groups[0].cases.flatMap(row => row.coverageReferences).length, 2);
  const changed = structuredClone(state); changed.draft.cases[1].testData += ' Different locale.';
  assert.equal(review.exactDuplicates(changed).length, 0);
  const assessment = assessmentFor(state); assessment.cases[0] = {id: 'NEW-01', verdict: 'revise', reason: 'The action does not identify the target account; source-backed clarification is required.'};
  assessment.requirements[0].verdict = 'gap';
  assessDesign(f.roots, 'login', retainAssessment(f.roots, state, assessment));
  await assert.rejects(designHandoff(f.roots, 'login', {selected: ['NEW-01']}), /corrections/);
  assert.equal(designView(f.roots, 'login').coverage.complete, false);
});

test('malformed, stale, mismatched, sensitive or unavailable reviewer output never becomes retained proof', async () => {
  const f = await designFixture(), state = saveDesign(f.roots, 'login', f.proposal);
  const receipt = retainAssessment(f.roots, state, assessmentFor(state)), outputPath = join(f.roots.projectRoot, receipt.evidence.output.path), bytes = readFileSync(outputPath);
  for (const change of [row => row.evidence.runId = '', row => row.evidence.source = 'a'.repeat(64), row => row.evidence.output.path = '../outside.json', row => row.evidence.output.sha256 = 'b'.repeat(64)]) {
    const altered = structuredClone(receipt); change(altered); assert.throws(() => assessDesign(f.roots, 'login', altered));
  }
  for (const change of [row => row.proposal = 'a'.repeat(64), row => row.clarityQuestion = 'Looks fine?', row => row.cases[0].reason = 'password=' + 'fixture-credential-literal']) {
    const output = JSON.parse(bytes); change(output); writeFileSync(outputPath, JSON.stringify(output));
    const altered = structuredClone(receipt); altered.evidence.output.sha256 = digest(readFileSync(outputPath));
    assert.throws(() => assessDesign(f.roots, 'login', altered));
  }
  unlinkSync(outputPath); assert.throws(() => assessDesign(f.roots, 'login', receipt));
  assert.equal(readDesign(f.roots, 'login').review, null);
});

test('missing retained evidence blocks pending writes and each dispatch but never prevents uncertain recovery', async t => {
  const f = await adoDesignFixture(t), options = {client: f.client}, preview = await previewDesign(f.roots, 'login', options);
  const path = join(f.roots.projectRoot, f.design.review.evidence.output.path), bytes = readFileSync(path);
  writeFileSync(path, '{}');
  assert.equal(designView(f.roots, 'login').coverage.complete, false);
  await assert.rejects(previewDesign(f.roots, 'login', options), /review|output/i);
  await assert.rejects(publishDesign(f.roots, 'login', {...options, approval: preview.fingerprint}), /review|output/i);
  assert.equal(f.control.writes, 0);
  writeFileSync(path, bytes); f.control.afterWrite = () => unlinkSync(path);
  const partial = await publishDesign(f.roots, 'login', {...options, approval: preview.fingerprint});
  assert.deepEqual(partial.outcomes.map(row => row.status), ['applied', 'failed']); assert.equal(f.control.writes, 1); assert.equal(partial.coverage.complete, false);
  const reconciled = await reconcileDesign(f.roots, 'login', options);
  assert.equal(reconciled.outcomes[0].status, 'applied'); assert.equal(reconciled.coverage.complete, false); assert.equal(f.control.writes, 1);
});

test('legacy assessments stay readable and recover uncertain writes without claiming enhanced coverage', async t => {
  const f = await adoDesignFixture(t), options = {client: f.client, selected: ['NEW-01']}, preview = await previewDesign(f.roots, 'login', options);
  f.control.loseCreate = true; await publishDesign(f.roots, 'login', {...options, approval: preview.fingerprint});
  const state = readDesign(f.roots, 'login'); unlinkSync(join(f.roots.projectRoot, state.review.evidence.output.path));
  const recovered = await reconcileDesign(f.roots, 'login', options);
  assert.equal(recovered.outcomes[0].status, 'applied'); assert.equal(recovered.coverage.complete, false); assert.equal(f.control.writes, 1);
  const legacy = readDesign(f.roots, 'login'); delete legacy.review.evidence; legacy.assessment = fingerprint(legacy.review); saveDesignState(f.roots, 'login', legacy);
  assert.equal(designView(f.roots, 'login').coverage.reviewEvidence.valid, false);
  await assert.rejects(designHandoff(f.roots, 'login', options), /retained|evidence/i);
});

test('captured native duplicate detection preserves coverage and skips unsupported setup', async () => {
  const f = await designFixture(), state = saveDesign(f.roots, 'login', f.proposal), row = state.draft.cases[0];
  const steps = [...review.preparationSteps(row, state.draft.preparations[0]), ...row.steps];
  const xml = editStepsXml('<steps id="0" last="0"></steps>', {}, steps.map((step, index) => ({id: index + 1, action: {text: step.action}, expected: {text: step.expected}})));
  state.evidence.existing.push({id: 101, rev: 7, fields: {'Microsoft.VSTS.TCM.Steps': xml, 'System.Description': 'Story 200 accepted rule'}});
  const group = review.exactDuplicates(state)[0];
  assert.deepEqual(group.cases.map(row => row.id), ['NEW-01', '101']); assert.equal(group.cases[1].coverageReferences[0].revision, 7);
  state.evidence.existing[0].fields['Microsoft.VSTS.TCM.Steps'] = '<steps><compref id="1" ref="99"/></steps>';
  assert.deepEqual(review.exactDuplicates(state), []);
  for (const field of ['prerequisites', 'testData']) {const variant = structuredClone(state); const copy = {...structuredClone(row), id: 'NEW-copy', [field]: row[field] + ' Different role, locale or state.'}; variant.draft.cases.push(copy); assert.deepEqual(review.exactDuplicates(variant), []);}
  const variant = structuredClone(state), copy = {...structuredClone(row), id: 'NEW-copy'}; copy.steps[1].expected += ' Different outcome.'; variant.draft.cases.push(copy); assert.deepEqual(review.exactDuplicates(variant), []);
});

test('reviewed consolidation retains all verifying mappings and refreshes totals without renumbering', async t => {
  const f = await adoDesignFixture(t), warnings = review.exactDuplicates(f.design); assert.equal(warnings.length, 1);
  const input = {...f.design.review, duplicates: warnings.map(row => ({id: row.id, verdict: 'revise', reason: 'Consolidate this identical proposed new case into the selected existing case.'}))};
  assessDesign(f.roots, 'login', retainAssessment(f.roots, f.design, input));
  await assert.rejects(previewDesign(f.roots, 'login', {client: f.client, selected: ['NEW-01']}), /duplicate/i);
  let state = readDesign(f.roots, 'login');
  const proposal = {...f.proposal, head: state.head, cases: f.proposal.cases.filter(row => row.id === '101'), mappings: f.proposal.mappings.filter(row => row.caseId === '101'), preparations: f.proposal.preparations.filter(row => row.caseId === '101')};
  state = saveDesign(f.roots, 'login', proposal);
  const assessment = {version: 1, proposal: state.proposal, reviewer: 'new-reviewer', cases: [{id: '101', verdict: 'pass', reason: 'The retained case verifies the accepted rule.'}], requirements: state.requirements.inventory.filter(row => ['requirement', 'criterion'].includes(row.kind)).map(row => ({id: row.id, verdict: 'covered', reason: 'All original verification references remain on case 101.', caseIds: ['101']}))};
  state = assessDesign(f.roots, 'login', retainAssessment(f.roots, state, assessment));
  assert.equal(review.renderDesign(state.draft).summary.total, 1); assert.equal(review.coverage(state, undefined, {roots: f.roots}).complete, true); assert.equal(state.draft.cases[0].id, '101');
  assert.equal((await previewDesign(f.roots, 'login', {client: f.client})).operations.length, 1); assert.equal(f.control.writes, 0);
});

test('a new selected preview of fully confirmed operations remains an idempotent delivery', async t => {
  const f = await adoDesignFixture(t), options = {client: f.client};
  const all = await previewDesign(f.roots, 'login', options); await publishDesign(f.roots, 'login', {...options, approval: all.fingerprint});
  const selected = await previewDesign(f.roots, 'login', {...options, selected: ['101']});
  assert.equal((await publishDesign(f.roots, 'login', {...options, approval: selected.fingerprint})).mode, 'completed');
  assert.equal(f.control.writes, 2);
});
