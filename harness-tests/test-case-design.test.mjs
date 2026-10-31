import {designFixture, assessmentFor} from './fixtures/design-local.mjs';
import {retainAssessment} from './fixtures/design-review.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {saveDesign, readDesign, assessDesign, designHandoff} from '../scripts/lib/test-case-design/index.mjs';
import {coverage, renderDesign} from '../scripts/lib/test-case-design/review.mjs';

test('local design keeps acceptance authority, renders exact full tables and derives summaries', async () => {
  const f = await designFixture(), saved = saveDesign(f.roots, 'login', f.proposal), rendered = renderDesign(saved.draft);
  assert.equal(saved.requirements.head, f.requirements.head);
  assert.equal(rendered.summary.total, 3); assert.deepEqual(rendered.summary.scenarioTypes, {Positive: 2, Negative: 1});
  assert.equal(Object.keys(rendered.summary.testTypes).length, 8); assert.equal(rendered.summary.testTypes.Accessibility, 0);
  assert.equal(rendered.overview.split('\n')[0], '| Case | Action | Title | Prerequisites | Final expected results | Coverage reference | Test type | Scenario type |');
  assert.equal(rendered.details.length, 3);
  for (const table of rendered.details) {assert.equal(table.split('\n').filter(line => line.startsWith('|---')).length, 1); assert(table.includes('**1. CASE DETAILS**')); assert(table.includes('**2. SETUP**')); assert(table.includes('**3. STEPS**')); assert(!table.includes('Final expected results'));}
  assert(rendered.markdown.indexOf('Total cases') < rendered.markdown.indexOf('| Case |'));
  assert.equal(coverage(saved, undefined, {roots: f.roots}).complete, false, 'Author mappings alone must not establish semantic coverage.');
  const assessed = assessDesign(f.roots, 'login', retainAssessment(f.roots, saved, assessmentFor(saved)));
  assert.equal(coverage(assessed, undefined, {roots: f.roots}).complete, true); assert.equal(coverage(assessed, ['NEW-01'], {roots: f.roots}).gaps.length, 2);
  assert.equal(readDesign(f.roots, 'login').assessment, assessed.assessment);
});

test('reference-only, unknown reference, invalid classification and stale edits fail closed', async () => {
  const f = await designFixture();
  for (const change of [p => p.cases[0].testType = 'Usability', p => p.cases[0].scenarioType = 'Boundary', p => p.cases[0].coverageReferences[0].requirementId = 'missing', p => p.cases[0].steps[0].expected = '', p => p.cases[1].id = p.cases[0].id, p => p.cases[0].priority = 'High']) {
    const candidate = structuredClone(f.proposal); change(candidate); assert.throws(() => saveDesign(f.roots, 'login', candidate));
  }
  const candidate = structuredClone(f.proposal); candidate.mappings[0].checks = [];
  assert.throws(() => saveDesign(f.roots, 'login', candidate), /verifying|check/);
  const saved = saveDesign(f.roots, 'login', f.proposal);
  assert.throws(() => assessDesign(f.roots, 'login', {...assessmentFor(saved), reviewer: 'designer'}), /independent/);
  const reviewed = assessDesign(f.roots, 'login', retainAssessment(f.roots, saved, assessmentFor(saved)));
  const changed = {...f.proposal, head: reviewed.head, cases: structuredClone(f.proposal.cases)}; changed.cases[0].steps[1].expected = 'The dashboard opens.';
  assert.throws(() => saveDesign(f.roots, 'login', changed), /expectation/);
  assert.equal(readDesign(f.roots, 'login').assessment, reviewed.assessment);
});

test('long, escaped, Arabic cases remain complete; no-change and empty proposals remain honest', async () => {
  const f = await designFixture(); f.proposal.cases[0].steps.push(...Array.from({length: 80}, (_, i) => ({action: `Observe row ${i} | <script>`, expected: `سليم ${i} & visible`}))); f.proposal.cases[0].title = 'A | B <script> *literal*';
  const saved = saveDesign(f.roots, 'login', f.proposal), rendered = renderDesign(saved.draft);
  assert(rendered.details[0].includes('**82**')); assert(!rendered.markdown.includes('<script>')); assert(rendered.markdown.includes('سليم 79'));
  const empty = saveDesign(f.roots, 'login', {...f.proposal, head: saved.head, cases: [], mappings: [], preparations: []});
  assert.equal(renderDesign(empty.draft).summary.total, 0); assert.equal(coverage(empty, undefined, {roots: f.roots}).gaps.length, 3); assert.equal(coverage(empty, undefined, {roots: f.roots}).complete, false);
});

test('reviewed local handoff uses existing intake without inventing execution or ADO identity', async () => {
  const f = await designFixture(), saved = saveDesign(f.roots, 'login', f.proposal); assessDesign(f.roots, 'login', retainAssessment(f.roots, saved, assessmentFor(saved)));
  const result = await designHandoff(f.roots, 'login', {selected: ['NEW-01']});
  assert.equal(result.source.scenarios.length, 1); assert.equal(result.source.scenarios[0].id, 'NEW-01');
  assert.equal(result.source.scenarios[0].steps[0].expected[0], f.proposal.preparations[0].expected);
  assert.equal(result.mappings[0].checks[0].step, 3);
  for (const mapping of result.mappings) for (const check of mapping.checks) assert.deepEqual(result.source.scenarios.find(row => row.id === mapping.caseId).steps[check.step - 1].expected, [check.expected]);
  assert.equal(readDesign(f.roots, 'login').draft.mappings[0].checks[0].step, 2, 'The stored proposal keeps business-step coordinates.');
  assert.equal(result.execution, 'not-run'); assert.equal(result.coverage.gaps.length, 2);
  assert.equal(result.source.scenarios[0].externalReferences, undefined);
  assert.equal(JSON.parse(readFileSync(join(f.roots.projectRoot, result.path))).scenarios[0].id, 'NEW-01');
});

test('compound requirements need every independently reviewed branch after selection and cleanup is not the business result', async () => {
  const f = await designFixture(), first = f.proposal.cases[0], second = f.proposal.cases[1], requirementId = first.coverageReferences[0].requirementId;
  second.coverageReferences.push(first.coverageReferences[0]);
  f.proposal.mappings.push({caseId: second.id, requirementId, checks: [{step: 2, expected: second.steps[1].expected, data: second.testData}]});
  first.steps.push({action: 'Remove the case-owned account.', expected: 'The account no longer exists.'});
  const saved = saveDesign(f.roots, 'login', f.proposal), assessment = assessmentFor(saved);
  assessment.requirements.find(row => row.id === requirementId).caseIds = [first.id, second.id];
  const reviewed = assessDesign(f.roots, 'login', retainAssessment(f.roots, saved, assessment));
  assert.equal(coverage(reviewed, undefined, {roots: f.roots}).complete, true); assert.equal(coverage(reviewed, [first.id], {roots: f.roots}).requirements.find(row => row.requirementId === requirementId).status, 'gap');
  assert(renderDesign(reviewed.draft).overview.includes('correct account identity')); assert(!renderDesign(reviewed.draft).overview.includes('account no longer exists'));
});

test('explicit split preparation preserves independent readiness checks without adding chat business steps', async () => {
  const f = await designFixture();
  f.proposal.preparations[0] = {caseId: 'NEW-01', reason: 'Account activation and session reset need distinct verification.', steps: [{action: 'Activate the dedicated account.', expected: 'The dedicated account is active.'}, {action: 'Clear its previous session.', expected: 'No authenticated session exists.'}]};
  const saved = saveDesign(f.roots, 'login', f.proposal); assessDesign(f.roots, 'login', retainAssessment(f.roots, saved, assessmentFor(saved)));
  const result = await designHandoff(f.roots, 'login', {selected: ['NEW-01']});
  assert.equal(result.source.scenarios[0].steps.length, 4); assert.equal(result.source.scenarios[0].steps[1].expected[0], 'No authenticated session exists.');
  assert.equal(result.mappings[0].checks[0].step, 4);
  for (const mapping of result.mappings) for (const check of mapping.checks) assert.deepEqual(result.source.scenarios.find(row => row.id === mapping.caseId).steps[check.step - 1].expected, [check.expected]);
  assert.equal(readDesign(f.roots, 'login').draft.mappings[0].checks[0].step, 2, 'Split preparation must not mutate stored proposal coordinates.');
  assert(!renderDesign(saved.draft).details[0].includes('Activate the dedicated account.'));
});
