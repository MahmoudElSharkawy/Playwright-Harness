import {adoDesignFixture} from './test-case-design.mjs';
import {putRequirementFile as put} from './requirements.mjs';
import {retainAssessment} from './design-review.mjs';
import {fingerprint} from '../../scripts/lib/execution-core/data.mjs';
import {updateInventory} from '../../scripts/lib/requirements/index.mjs';
import {prepareDesign, saveDesign, assessDesign} from '../../scripts/lib/test-case-design/index.mjs';

export const postcodeRules = 'A signed-in customer edits their own disposable checkout address, initially containing postcode 54321. Open the address editor, enter the input and select Save. Saving 01234 preserves 01234, including its leading zero. Saving 1234 is prevented and displays "Postcode must contain five digits". Saving a value with one surrounding space on each side of 01234 stores 01234 after trimming. Each case owns its address and deletes it afterward; the deleted address is absent.';
const delegated = 'Apply postcode validation from #1180 when saving.';
const cancelRule = 'A signed-in customer can open their own disposable checkout address with postcode 54321, enter 01234 and select Cancel. The editor closes and the original postcode 54321 remains unchanged. Delete the case-owned address afterward; it is then absent.';
const criteria = 'Microsoft.VSTS.Common.AcceptanceCriteria';

export async function postcodeFixture(t, {acceptRules = true} = {}) {
  const f = await adoDesignFixture(t), story = f.state.items.get(200);
  Object.assign(story.fields, {'System.Title': 'Edit checkout postcode', 'System.Description': '', [criteria]: delegated + '\n' + cancelRule});
  story.relations = []; f.history.set(200, [structuredClone(story)]);
  f.state.items.set(1180, {id: 1180, rev: 1, fields: {'System.Title': 'Postcode rules', 'System.TeamProject': 'demo', 'System.WorkItemType': 'User Story', [criteria]: postcodeRules}, relations: []});
  let state = await prepareDesign(f.roots, 'postcode', {version: 1, analysisId: 'postcode', request: {version: 1, project: 'demo', application: 'checkout', storyId: 200, sources: []}}, {client: f.client});
  const part = state.evidence.requirements.parts.find(row => row.location === criteria);
  updateInventory(f.roots, 'postcode', {version: 1, snapshot: state.requirements.snapshot, partitions: [{partId: part.id, entries: [{id: 'postcode', start: 0, end: delegated.length}, {id: 'cancel', start: delegated.length + 1, end: part.text.length}]}], changes: []});
  state = await prepareDesign(f.roots, 'postcode', {version: 1, analysisId: 'postcode'}, {client: f.client});
  const ref = state.evidence.references.items.find(row => row.workItemId === 1180);
  const selection = {version: 1, analysisId: 'postcode', references: [{id: ref.id, classification: 'required', requirementIds: ['postcode'], reason: 'The selected story delegates only saving validation.', rules: [{location: criteria, quote: postcodeRules}]}]};
  state = await prepareDesign(f.roots, 'postcode', selection, {client: f.client});
  const selected = state.evidence.references.items.find(row => row.id === ref.id);
  const entry = state.requirements.inventory.find(row => row.id === 'postcode');
  const decision = {version: 1, authority: 'owner', actor: 'Synthetic fixture owner', consumer: state.consumer, snapshot: state.requirements.snapshot, requirementId: entry.id, content: entry.content, disposition: 'accepted', statement: acceptRules ? 'These exact captured postcode rules apply to the selected story.' : 'The selected story delegation is accepted; referenced rules still need an owner decision.', ...(acceptRules ? {references: [{id: selected.id, revision: selected.revision, content: selected.content}]} : {})};
  put(f.roots, 'postcode-decision.json', decision);
  updateInventory(f.roots, 'postcode', {version: 1, snapshot: state.requirements.snapshot, changes: [
    {id: 'postcode', disposition: 'accepted', evidence: [{kind: 'decision', path: 'postcode-decision.json', fingerprint: fingerprint(decision)}]},
    {id: 'cancel', disposition: 'accepted', evidence: [{kind: 'source', partId: part.id, revision: part.revision, quote: cancelRule}]},
  ]});
  state = await prepareDesign(f.roots, 'postcode', selection, {client: f.client});
  const examples = [
    ['NEW-leading-zero', 'Preserve a leading-zero postcode', '01234', 'Positive', 'The saved postcode remains 01234, including its leading zero.'],
    ['NEW-short', 'Prevent saving a short postcode', '1234', 'Negative', 'Saving is prevented; "Postcode must contain five digits" is displayed.'],
    ['NEW-trim', 'Trim surrounding postcode spaces', ' 01234 ', 'Positive', 'The saved postcode is 01234 after trimming.'],
    ['NEW-cancel', 'Cancel a postcode edit', '01234', 'Positive', 'The editor closes; the original postcode 54321 remains unchanged.'],
  ];
  const cases = examples.map(([id, title, value, scenarioType, expected]) => ({id, proposedAction: 'Create', title,
    prerequisites: 'A signed-in customer owns a disposable checkout address, initially containing postcode 54321. Each case and run owns a separate address.',
    testData: `Original postcode: 54321. Input: ${JSON.stringify(value)}.${id === 'NEW-trim' ? ' Input has one leading and one trailing space.' : ''}`,
    coverageReferences: [{requirementId: id === 'NEW-cancel' ? 'cancel' : 'postcode', label: id === 'NEW-cancel' ? 'AC-2: Cancel edits' : 'AC-1: Accepted postcode rules from #1180'}], testType: 'Functional', scenarioType,
    steps: [{action: 'As the signed-in customer, open the editor for this case-owned checkout address.', expected: 'The address editor displays the original postcode 54321.'},
      {action: `Enter ${JSON.stringify(value)} into the postcode field for that address and select ${id === 'NEW-cancel' ? 'Cancel' : 'Save'}.`, expected},
      {action: 'Delete this case-owned checkout address.', expected: 'The case-owned address is absent.'}]}));
  const proposal = {version: 1, author: 'synthetic-designer', source: state.source, cases,
    mappings: cases.map(row => ({caseId: row.id, requirementId: row.coverageReferences[0].requirementId, checks: [{step: 2, expected: row.steps[1].expected, data: row.testData}]})),
    preparations: cases.map(row => ({caseId: row.id, expected: 'The customer is signed in and owns a separate disposable address with postcode 54321.'}))};
  state = saveDesign(f.roots, 'postcode', proposal);
  const assessment = postcodeAssessment(state, acceptRules);
  state = assessDesign(f.roots, 'postcode', retainAssessment(f.roots, state, assessment));
  return {...f, design: state, proposal, selection, assessment};
}

export function postcodeAssessment(state, accepted = true) {
  return {version: 1, proposal: state.proposal, reviewer: 'synthetic-independent-reviewer', cases: state.draft.cases.map(row => ({id: row.id, verdict: 'pass', reason: 'The captured rule identifies the customer, owned address, initial postcode, exact input, ordered action, observable outcome and cleanup.'})), requirements: ['postcode', 'cancel'].map(id => ({id, verdict: id === 'postcode' && !accepted ? 'unresolved' : 'covered', reason: id === 'postcode' && !accepted ? 'Referenced rules await owner acceptance; only Cancel is deliverable.' : 'Every accepted outcome is checked; cleanup is retained without replacing business verification.', caseIds: state.draft.cases.filter(row => row.coverageReferences.some(ref => ref.requirementId === id)).map(row => row.id)}))};
}
