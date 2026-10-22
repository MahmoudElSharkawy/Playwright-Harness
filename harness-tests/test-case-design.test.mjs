import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {consumerRoots} from '../scripts/lib/consumer-paths.mjs';
import {captureRequirements, prepareRequirements, updateInventory} from '../scripts/lib/requirements/index.mjs';
import {fingerprint} from '../scripts/lib/execution-core/data.mjs';
import {putRequirementFile as put} from './fixtures/requirements.mjs';
import {prepareDesign, saveDesign, readDesign, assessDesign, designHandoff} from '../scripts/lib/test-case-design/index.mjs';
import {coverage, renderDesign} from '../scripts/lib/test-case-design/review.mjs';

export async function designFixture() {
  const roots = consumerRoots(mkdtempSync(join(tmpdir(), 'pom-design-')));
  put(roots, 'story.md', 'A valid login opens the current user dashboard.\nAn incorrect password leaves the user signed out.\nArabic labels use approved wording and RTL layout.\n');
  const request = {version: 1, project: 'sample', application: 'login', sources: [{id: 'story', kind: 'file', path: 'story.md'}]};
  let requirements = prepareRequirements(roots, 'login', await captureRequirements(roots, request));
  const changes = requirements.inventory.map((entry, index) => {
    const decision = {version: 1, authority: 'owner', actor: 'Synthetic owner', consumer: requirements.consumer, snapshot: requirements.snapshot, requirementId: entry.id, content: entry.content, disposition: 'accepted', statement: 'The selected story statement is accepted.'};
    put(roots, `decision-${index}.json`, decision);
    return {id: entry.id, disposition: 'accepted', evidence: [{kind: 'decision', path: `decision-${index}.json`, fingerprint: fingerprint(decision)}]};
  });
  requirements = updateInventory(roots, 'login', {version: 1, snapshot: requirements.snapshot, changes});
  const state = await prepareDesign(roots, 'login', {version: 1, analysisId: 'login'});
  const rows = [
    ['NEW-01', 'Sign in with valid credentials', 'Functional', 'Positive', 'Enter valid credentials and select Sign in', 'The current user dashboard displays the correct account identity.'],
    ['NEW-02', 'Reject an incorrect password', 'Functional', 'Negative', 'Enter an incorrect password and select Sign in', 'Sign-in is rejected and the user remains signed out.'],
    ['NEW-03', 'Display Arabic labels', 'Localization', 'Positive', 'Select Arabic', 'Approved Arabic labels and RTL layout are displayed.'],
  ];
  const proposal = {version: 1, author: 'designer', source: state.source, cases: rows.map((row, index) => ({id: row[0], proposedAction: 'Create', title: row[1], prerequisites: 'A dedicated active account exists; user is signed out.', testData: 'Account username and env:TEST_PASSWORD; approved Arabic labels.', coverageReferences: [{requirementId: requirements.inventory[index].id, label: `Description: ${index + 1}`}], testType: row[2], scenarioType: row[3], steps: [{action: 'Open the sign-in page', expected: 'The sign-in form is displayed.'}, {action: row[4], expected: row[5]}]})), mappings: rows.map((row, index) => ({caseId: row[0], requirementId: requirements.inventory[index].id, checks: [{step: 2, expected: row[5], data: 'Account username and env:TEST_PASSWORD; approved Arabic labels.'}]})), preparations: rows.map(row => ({caseId: row[0], expected: 'The dedicated account is active, its secret reference resolves, and no session exists.'}))};
  return {roots, state, requirements, proposal};
}

export function assessmentFor(state) {
  return {version: 1, proposal: state.proposal, reviewer: 'independent-reviewer', cases: state.draft.cases.map(row => ({id: row.id, verdict: 'pass', reason: 'Setup, action and identity-specific outcome follow the accepted source.'})), requirements: state.requirements.inventory.filter(row => row.disposition === 'accepted').map(row => ({id: row.id, verdict: 'covered', reason: 'All accepted conditions and outcomes are verified by the mapped expectations.', caseIds: state.draft.mappings.filter(mapping => mapping.requirementId === row.id).map(mapping => mapping.caseId)}))};
}

test('local design keeps acceptance authority, renders exact full tables and derives summaries', async () => {
  const f = await designFixture(), saved = saveDesign(f.roots, 'login', f.proposal), rendered = renderDesign(saved.draft);
  assert.equal(saved.requirements.head, f.requirements.head);
  assert.equal(rendered.summary.total, 3); assert.deepEqual(rendered.summary.scenarioTypes, {Positive: 2, Negative: 1});
  assert.equal(Object.keys(rendered.summary.testTypes).length, 8); assert.equal(rendered.summary.testTypes.Accessibility, 0);
  assert.equal(rendered.overview.split('\n')[0], '| ID | Proposed action | Title | Prerequisites | Final expected results | Coverage reference | Test type | Scenario type |');
  assert.equal(rendered.details.length, 3);
  for (const table of rendered.details) {assert.equal(table.split('\n').filter(line => line.startsWith('|---')).length, 1); assert(table.includes('**1. CASE DETAILS**')); assert(table.includes('**2. SETUP**')); assert(table.includes('**3. STEPS**')); assert(!table.includes('Final expected results'));}
  assert(rendered.markdown.indexOf('Total cases') < rendered.markdown.indexOf('| ID |'));
  assert.equal(coverage(saved).complete, false, 'Author mappings alone must not establish semantic coverage.');
  const assessed = assessDesign(f.roots, 'login', assessmentFor(saved));
  assert.equal(coverage(assessed).complete, true); assert.equal(coverage(assessed, ['NEW-01']).gaps.length, 2);
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
  const reviewed = assessDesign(f.roots, 'login', assessmentFor(saved));
  const changed = {...f.proposal, head: reviewed.head, cases: structuredClone(f.proposal.cases)}; changed.cases[0].steps[1].expected = 'The dashboard opens.';
  assert.throws(() => saveDesign(f.roots, 'login', changed), /expectation/);
  assert.equal(readDesign(f.roots, 'login').assessment, reviewed.assessment);
});

test('long, escaped, Arabic cases remain complete; no-change and empty proposals remain honest', async () => {
  const f = await designFixture(); f.proposal.cases[0].steps.push(...Array.from({length: 80}, (_, i) => ({action: `Observe row ${i} | <script>`, expected: `سليم ${i} & visible`}))); f.proposal.cases[0].title = 'A | B <script> *literal*';
  const saved = saveDesign(f.roots, 'login', f.proposal), rendered = renderDesign(saved.draft);
  assert(rendered.details[0].includes('**82**')); assert(!rendered.markdown.includes('<script>')); assert(rendered.markdown.includes('سليم 79'));
  const empty = saveDesign(f.roots, 'login', {...f.proposal, head: saved.head, cases: [], mappings: [], preparations: []});
  assert.equal(renderDesign(empty.draft).summary.total, 0); assert.equal(coverage(empty).gaps.length, 3); assert.equal(coverage(empty).complete, false);
});

test('reviewed local handoff uses existing intake without inventing execution or ADO identity', async () => {
  const f = await designFixture(), saved = saveDesign(f.roots, 'login', f.proposal); assessDesign(f.roots, 'login', assessmentFor(saved));
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
  const reviewed = assessDesign(f.roots, 'login', assessment);
  assert.equal(coverage(reviewed).complete, true); assert.equal(coverage(reviewed, [first.id]).requirements.find(row => row.requirementId === requirementId).status, 'gap');
  assert(renderDesign(reviewed.draft).overview.includes('correct account identity')); assert(!renderDesign(reviewed.draft).overview.includes('account no longer exists'));
});

test('explicit split preparation preserves independent readiness checks without adding chat business steps', async () => {
  const f = await designFixture();
  f.proposal.preparations[0] = {caseId: 'NEW-01', reason: 'Account activation and session reset need distinct verification.', steps: [{action: 'Activate the dedicated account.', expected: 'The dedicated account is active.'}, {action: 'Clear its previous session.', expected: 'No authenticated session exists.'}]};
  const saved = saveDesign(f.roots, 'login', f.proposal); assessDesign(f.roots, 'login', assessmentFor(saved));
  const result = await designHandoff(f.roots, 'login', {selected: ['NEW-01']});
  assert.equal(result.source.scenarios[0].steps.length, 4); assert.equal(result.source.scenarios[0].steps[1].expected[0], 'No authenticated session exists.');
  assert.equal(result.mappings[0].checks[0].step, 4);
  for (const mapping of result.mappings) for (const check of mapping.checks) assert.deepEqual(result.source.scenarios.find(row => row.id === mapping.caseId).steps[check.step - 1].expected, [check.expected]);
  assert.equal(readDesign(f.roots, 'login').draft.mappings[0].checks[0].step, 2, 'Split preparation must not mutate stored proposal coordinates.');
  assert(!renderDesign(saved.draft).details[0].includes('Activate the dedicated account.'));
});
