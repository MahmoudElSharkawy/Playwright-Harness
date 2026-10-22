import {keys, fingerprint, requireThat} from '../execution-core/data.mjs';
import {contextData} from '../context/model.mjs';
import {escapeHtml} from '../requirements/review.mjs';

export const TEST_TYPES = Object.freeze(['Functional', 'Accessibility', 'Compatibility', 'UIUX', 'Security', 'Performance', 'Responsiveness', 'Localization']);
export const SCENARIO_TYPES = Object.freeze(['Positive', 'Negative']);
const text = (value, label) => requireThat(typeof value === 'string' && value.trim() && value.length <= 65536 && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value), `${label} needs nonempty bounded text.`);
const caseId = value => typeof value === 'string' && (/^NEW-[A-Za-z0-9_-]{1,60}$/.test(value) || /^[1-9]\d{0,9}$/.test(value) && Number(value) <= 2147483647);
const unique = values => new Set(values).size === values.length;
const selectedIds = (draft, selected) => {const ids = selected ?? draft.cases.map(row => row.id); requireThat(Array.isArray(ids) && unique(ids) && ids.every(id => draft.cases.some(row => row.id === id)), 'Select distinct known case IDs.'); return ids;};
export {selectedIds};
export const designDeliveries = state => [...(state.deliveryHistory ?? []), ...(state.delivery ? [state.delivery] : [])];
export function confirmedOutcomes(state) {
  const latest = new Map();
  for (const delivery of designDeliveries(state)) for (const row of delivery.outcomes) latest.set(`${row.caseId}:${row.operationId}`, {...row, approval: row.approval ?? delivery.approval});
  return [...latest.values()].filter(row => ['applied', 'unchanged'].includes(row.status));
}

export function validateDesign(raw, state, requirements) {
  const input = contextData(raw, 2 * 1024 * 1024);
  keys(input, ['version', 'author', 'source', 'head', 'cases', 'mappings', 'preparations'], 'test-case design');
  requireThat(input.version === 1 && input.source === state.source, 'Design needs the current source fingerprint.'); text(input.author, 'Design author');
  requireThat(Array.isArray(input.cases) && input.cases.length <= 500 && unique(input.cases.map(row => row.id)), 'Design needs distinct cases, at most 500.');
  for (const row of input.cases) {
    keys(row, ['id', 'proposedAction', 'title', 'prerequisites', 'testData', 'coverageReferences', 'testType', 'scenarioType', 'steps'], 'designed case');
    requireThat(caseId(row.id) && ['Create', 'Update', 'Reuse unchanged'].includes(row.proposedAction) && (row.id.startsWith('NEW-') ? row.proposedAction === 'Create' : row.proposedAction !== 'Create'), 'Use stable NEW- IDs for creation and real ADO IDs for existing cases.');
    requireThat(!state.created?.[row.id], 'This temporary ID was already created; refresh and use its returned ADO ID.');
    for (const field of ['title', 'prerequisites', 'testData']) text(row[field], field);
    requireThat(row.title.length <= 255 && !/[\r\n]/.test(row.title), 'Case title exceeds ADO bounds.');
    requireThat(TEST_TYPES.includes(row.testType) && SCENARIO_TYPES.includes(row.scenarioType), 'Unsupported test/scenario classification.');
    requireThat(Array.isArray(row.steps) && row.steps.length > 0 && row.steps.length < 1000, 'Case needs 1–999 complete ordered business steps.');
    for (const step of row.steps) {keys(step, ['action', 'expected'], 'business step'); text(step.action, 'Step action'); text(step.expected, 'Step expectation');}
    requireThat(Array.isArray(row.coverageReferences) && row.coverageReferences.length > 0 && unique(row.coverageReferences.map(ref => ref.requirementId)), 'Case needs distinct coverage references.');
    for (const ref of row.coverageReferences) {
      keys(ref, ['requirementId', 'label'], 'coverage reference'); text(ref.label, 'Coverage label');
      const entry = requirements.inventory.find(entry => entry.id === ref.requirementId), part = entry && state.evidence.requirements.parts.find(part => part.id === entry.partId);
      requireThat(entry && part && ['requirement', 'criterion'].includes(entry.kind) && (part.sourceId === 'story' || !state.evidence.requirements.origin), 'Coverage must reference available selected-story description or acceptance criteria.');
    }
    if (!row.id.startsWith('NEW-')) requireThat(state.evidence.existing.some(item => String(item.id) === row.id), 'Existing case must come from captured current case evidence.');
  }
  requireThat(Array.isArray(input.mappings) && input.mappings.length <= 5000 && unique(input.mappings.map(row => row.caseId + ':' + row.requirementId)), 'Design mappings must be bounded and unique.');
  for (const mapping of input.mappings) {
    keys(mapping, ['caseId', 'requirementId', 'checks'], 'coverage mapping');
    const row = input.cases.find(row => row.id === mapping.caseId);
    requireThat(row?.coverageReferences.some(ref => ref.requirementId === mapping.requirementId), 'Mapping must name a case coverage reference.');
    requireThat(Array.isArray(mapping.checks) && mapping.checks.length > 0 && mapping.checks.length <= row.steps.length && unique(mapping.checks.map(check => check.step)), 'Mapping needs distinct actual verifying checks.');
    for (const check of mapping.checks) {
      keys(check, ['step', 'expected', 'data'], 'verifying check');
      requireThat(Number.isInteger(check.step) && check.step > 0 && check.step <= row.steps.length && check.expected === row.steps[check.step - 1].expected && check.data === row.testData, 'Verifying check must bind the actual ordered step, expectation and test data.');
    }
  }
  for (const row of input.cases) for (const ref of row.coverageReferences) requireThat(input.mappings.some(mapping => mapping.caseId === row.id && mapping.requirementId === ref.requirementId), 'Every coverage reference needs actual verifying-step checks.');
  requireThat(Array.isArray(input.preparations) && input.preparations.length === input.cases.length && unique(input.preparations.map(row => row.caseId)), 'Every case needs one reviewed preparation readiness expectation.');
  for (const preparation of input.preparations) {
    keys(preparation, ['caseId', 'expected', 'steps', 'reason'], 'preparation'); const row = input.cases.find(row => row.id === preparation.caseId); requireThat(row, 'Unknown preparation case.');
    if (preparation.steps === undefined) {text(preparation.expected, 'Observable preparation readiness'); requireThat(preparation.reason === undefined, 'Only split preparation needs a reason.');}
    else {
      requireThat(preparation.expected === undefined && Array.isArray(preparation.steps) && preparation.steps.length >= 2 && preparation.steps.length <= 20 && preparation.steps.length + row.steps.length <= 1000, 'Split preparation needs 2–20 distinct verified setup actions within the step bound.'); text(preparation.reason, 'Reason for independent setup verification');
      for (const step of preparation.steps) {keys(step, ['action', 'expected'], 'preparation step'); text(step.action, 'Setup action'); text(step.expected, 'Observable setup expectation');}
    }
  }
  const {head, ...draft} = input; return draft;
}

export function validateAssessment(raw, state) {
  const input = contextData(raw, 2 * 1024 * 1024);
  keys(input, ['version', 'proposal', 'reviewer', 'cases', 'requirements'], 'independent design assessment');
  requireThat(input.version === 1 && input.proposal === state.proposal, 'Assessment must bind the complete current proposal.');
  text(input.reviewer, 'Reviewer'); requireThat(input.reviewer !== state.draft.author, 'Use an independent reviewer and retain its actual assessment.');
  requireThat(Array.isArray(input.cases) && input.cases.length === state.draft.cases.length && unique(input.cases.map(row => row.id)), 'Review every complete case once.');
  for (const row of input.cases) {keys(row, ['id', 'verdict', 'reason'], 'case assessment'); requireThat(state.draft.cases.some(item => item.id === row.id) && ['pass', 'revise'].includes(row.verdict), 'Invalid case assessment.'); text(row.reason, 'Source-grounding and expectation review evidence');}
  const entries = state.requirements.inventory.filter(entry => ['requirement', 'criterion'].includes(entry.kind));
  requireThat(Array.isArray(input.requirements) && input.requirements.length === entries.length && unique(input.requirements.map(row => row.id)), 'Review every description/criterion inventory entry, including unresolved requirements.');
  for (const row of input.requirements) {
    keys(row, ['id', 'verdict', 'reason', 'caseIds'], 'requirement assessment');
    const entry = entries.find(item => item.id === row.id);
    requireThat(entry && ['covered', 'gap', 'unresolved'].includes(row.verdict), 'Invalid requirement assessment.'); text(row.reason, 'Coverage review evidence');
    requireThat(Array.isArray(row.caseIds) && unique(row.caseIds) && row.caseIds.every(id => state.draft.mappings.some(mapping => mapping.caseId === id && mapping.requirementId === row.id)), 'Coverage assessment must cite actual mapped cases.');
    requireThat(row.verdict !== 'covered' || entry.disposition === 'accepted' && row.caseIds.length > 0 && row.caseIds.every(id => input.cases.find(item => item.id === id)?.verdict === 'pass'), 'Covered requirements need accepted source and passing independent case reviews.');
  }
  return input;
}

export function coverage(state, selected, {confirmed = false} = {}) {
  const ids = selectedIds(state.draft, selected), entries = state.requirements.inventory.filter(entry => ['requirement', 'criterion'].includes(entry.kind));
  const included = confirmed ? ids.filter(id => confirmedOutcomes(state).some(row => row.caseId === id)) : ids;
  const rows = entries.map(entry => {
    const assessment = state.review?.requirements.find(row => row.id === entry.id), mapped = state.draft.mappings.filter(row => row.requirementId === entry.id && included.includes(row.caseId));
    const covered = entry.disposition === 'accepted' && assessment?.verdict === 'covered' && assessment.caseIds.length > 0 && assessment.caseIds.every(id => included.includes(id)) && mapped.length > 0;
    return {requirementId: entry.id, status: covered ? 'covered' : entry.disposition !== 'accepted' ? 'unresolved' : 'gap', caseIds: mapped.map(row => row.caseId), reason: covered ? assessment.reason : assessment?.reason ?? 'Independent semantic coverage review is required.'};
  });
  const gaps = rows.filter(row => row.status !== 'covered');
  return {basis: confirmed ? 'confirmed applied or unchanged' : 'reviewed proposal', complete: entries.length > 0 && gaps.length === 0 && state.evidence.requirements.omissions.filter(row => !['absent', 'not-selected'].includes(row.reason)).length === 0, requirements: rows, gaps};
}

const cell = value => escapeHtml(String(value)).replaceAll('|', '&#124;').replace(/[\\`*_~\[\]{}]/g, '\\$&').replace(/\r\n?|\n/g, '<br>');
const table = rows => rows.map(row => row.every(value => /^---:?$/.test(value)) ? '|' + row.join('|') + '|' : '| ' + row.join(' | ') + ' |').join('\n');
export function renderDesign(draft) {
  const summary = {total: draft.cases.length, testTypes: Object.fromEntries(TEST_TYPES.map(type => [type, draft.cases.filter(row => row.testType === type).length])), scenarioTypes: Object.fromEntries(SCENARIO_TYPES.map(type => [type, draft.cases.filter(row => row.scenarioType === type).length]))};
  const summaryText = `**Total cases: ${summary.total} · Positive: ${summary.scenarioTypes.Positive} · Negative: ${summary.scenarioTypes.Negative}**\n\n` + table([['Test type', 'Total'], ['---', '---:'], ...TEST_TYPES.map(type => [type, String(summary.testTypes[type])])]);
  const reference = row => row.coverageReferences.map(ref => ref.label).join('; ');
  const outcome = row => {const steps = draft.mappings.filter(mapping => mapping.caseId === row.id).flatMap(mapping => mapping.checks.map(check => check.step)); return row.steps[Math.max(...steps) - 1].expected;};
  const overview = table([['ID', 'Proposed action', 'Title', 'Prerequisites', 'Final expected results', 'Coverage reference', 'Test type', 'Scenario type'], Array(8).fill('---'), ...draft.cases.map(row => [row.id, row.proposedAction, row.title, row.prerequisites, outcome(row), reference(row), row.testType, row.scenarioType].map(cell))]);
  const details = draft.cases.map(row => table([
    ['**1. CASE DETAILS**', '', '', '', ''], Array(5).fill('---'),
    ['**ID**', '**Title**', '**Coverage reference**', '**Test type**', '**Scenario type**'],
    [row.id, row.title, reference(row), row.testType, row.scenarioType].map(cell),
    ['**2. SETUP**', '', '', '', ''], ['**Prerequisites**', cell(row.prerequisites), '', '', ''], ['**Test data**', cell(row.testData), '', '', ''],
    ['**3. STEPS**', '**Step action**', '**Step expected result**', '', ''],
    ...row.steps.map((step, index) => [`**${index + 1}**`, cell(step.action), cell(step.expected), '', '']),
  ]));
  return {summary, summaryText, overview, details, markdown: [summaryText, overview, ...details].join('\n\n')};
}

export const proposalFingerprint = (source, draft, requirements) => fingerprint({source, draft, inventory: requirements.inventory});
export function preparationSteps(row, preparation) {
  const setup = `Preparation\nPrerequisites: ${row.prerequisites}\nTest data: ${row.testData}`;
  return preparation.steps ? preparation.steps.map((step, index) => ({action: index ? `Preparation ${index + 1}\n${step.action}` : `${setup}\n${step.action}`, expected: step.expected})) : [{action: setup, expected: preparation.expected}];
}
