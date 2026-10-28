import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {consumerRoots} from '../../scripts/lib/consumer-paths.mjs';
import {captureRequirements, prepareRequirements, updateInventory} from '../../scripts/lib/requirements/index.mjs';
import {fingerprint} from '../../scripts/lib/execution-core/data.mjs';
import {putRequirementFile as put} from './requirements.mjs';
import {prepareDesign} from '../../scripts/lib/test-case-design/index.mjs';

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

