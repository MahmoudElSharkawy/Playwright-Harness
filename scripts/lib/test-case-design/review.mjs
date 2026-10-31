import {keys, fingerprint, requireThat} from '../execution-core/data.mjs';
import {contextData} from '../context/model.mjs';
import {escapeHtml} from '../requirements/review.mjs';
import {parseStepsXml, decodeEntities} from '../integrations/ado-steps.mjs';
import {editableSteps} from '../integrations/ado-step-edit.mjs';
import {dependencyGaps, acceptedSupplemental} from './references.mjs';
import {reviewEvidenceStatus} from './review-evidence.mjs';

export const TEST_TYPES = Object.freeze(['Functional', 'Accessibility', 'Compatibility', 'UIUX', 'Security', 'Performance', 'Responsiveness', 'Localization']);
export const SCENARIO_TYPES = Object.freeze(['Positive', 'Negative']);
const text = (value, label) => requireThat(typeof value === 'string' && value.trim() && value.length <= 65536 && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value), `${label} needs nonempty bounded text.`);
const caseId = value => typeof value === 'string' && (/^NEW-[A-Za-z0-9_-]{1,60}$/.test(value) || /^[1-9]\d{0,9}$/.test(value) && Number(value) <= 2147483647);
const unique = values => new Set(values).size === values.length;
const selectedIds = (draft, selected) => {const ids = selected ?? draft.cases.map(row => row.id); requireThat(Array.isArray(ids) && unique(ids) && ids.every(id => draft.cases.some(row => row.id === id)), 'Select distinct known case IDs.'); return ids;};
export {selectedIds};
const strings = value => typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];
export function optionalSources(state) {
  return [
    ...state.evidence.requirements.parts.map(part => ({kind: 'source', id: part.id, label: sourceLabel(part, state), text: part.text})),
    ...(state.evidence.context?.unavailable ? [] : state.evidence.context?.result?.results ?? []).map(hit => ({kind: 'context', id: hit.passageId, label: hit.citation?.label ?? 'Selected business context', text: hit.excerpt})),
    ...(state.evidence.references?.items ?? []).flatMap(reference => reference.source ? [{kind: 'reference', id: reference.id, label: `Referenced work item ${reference.workItemId}`, text: reference.source.parts.map(part => part.text).join('\n')}] : []),
    ...(state.evidence.conventions?.usable ? [{kind: 'convention', id: state.evidence.conventions.path, label: 'Agreed design conventions', text: strings(state.evidence.conventions.profile).join('\n')}] : []),
  ];
}
function sourceLabel(part, state) {
  if (part.sourceId === 'story' && state.evidence.requirements.origin) return part.kind === 'criterion' ? 'Acceptance criteria' : part.location === 'System.Title' ? 'Story title' : 'Description';
  const selected = state.evidence.requirements.request?.sources?.find(source => source.id === part.sourceId);
  return selected ? `File: ${selected.path.split(/[\\/]/).at(-1)} (${part.location})` : part.sourceId === 'discussion' ? 'Story discussion' : part.sourceId === 'history' ? 'Story history' : 'Selected source material';
}
/** Resolve structured identities only. Literal source content and test data are never rewritten. */
export function readableReference(state, requirementId, supplied) {
  const entry = state?.requirements.inventory.find(row => row.id === requirementId), part = entry && state.evidence.requirements.parts.find(row => row.id === entry.partId);
  if (!part) return supplied && supplied !== requirementId ? supplied : 'Selected source requirement';
  const excerpt = part.text.slice(entry.start, entry.end).trim();
  const internal = [requirementId, part.id, ...(state.evidence.references?.items ?? []).map(row => row.id)];
  const label = supplied && !internal.some(id => supplied === id || id.length >= 16 && supplied.includes(id)) && !/\b[a-f0-9]{64}\b/.test(supplied) ? supplied : sourceLabel(part, state);
  return label.includes(excerpt) ? label : `${label} — ${excerpt}`;
}
export const designDeliveries = state => [...(state.deliveryHistory ?? []), ...(state.delivery ? [state.delivery] : [])];
export function confirmedOutcomes(state) {
  const latest = new Map();
  for (const delivery of designDeliveries(state)) for (const row of delivery.outcomes) latest.set(`${row.caseId}:${row.operationId}`, {...row, approval: row.approval ?? delivery.approval});
  return [...latest.values()].filter(row => ['applied', 'unchanged'].includes(row.status));
}

export function validateDesign(raw, state, requirements, {roots} = {}) {
  const input = contextData(raw, 2 * 1024 * 1024);
  keys(input, ['version', 'author', 'source', 'head', 'cases', 'mappings', 'preparations', 'optionalDrafts'], 'test-case design');
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
      requireThat(entry && part && ['requirement', 'criterion'].includes(entry.kind) && (part.sourceId === 'story' || !state.evidence.requirements.origin || acceptedSupplemental(roots, state, entry, part)), 'Coverage must reference selected-story requirements or explicitly selected supplemental requirements accepted by an owner decision.');
    }
    if (!row.id.startsWith('NEW-')) requireThat(state.evidence.existing.some(item => String(item.id) === row.id), 'Existing case must come from captured current case evidence.');
  }
  if (input.optionalDrafts !== undefined) {
    requireThat(Array.isArray(input.optionalDrafts) && input.optionalDrafts.length <= 100 && unique([...input.cases, ...input.optionalDrafts].map(row => row.id)), 'Optional drafts need distinct IDs outside main cases, at most 100.');
    for (const row of input.optionalDrafts) {
      keys(row, ['id', 'proposedAction', 'title', 'prerequisites', 'testData', 'coverageReferences', 'testType', 'scenarioType', 'steps', 'sourceBasis', 'questions'], 'optional draft');
      requireThat(caseId(row.id) && row.id.startsWith('NEW-') && row.proposedAction === 'Create' && !state.created?.[row.id], 'Optional drafts need unused temporary creation IDs.');
      for (const field of ['title', 'prerequisites', 'testData']) text(row[field], field);
      requireThat(row.title.length <= 255 && !/[\r\n]/.test(row.title) && TEST_TYPES.includes(row.testType) && SCENARIO_TYPES.includes(row.scenarioType), 'Optional title or classification is invalid.');
      requireThat(Array.isArray(row.questions) && row.questions.length <= 30, 'Optional decision questions must be bounded.');
      for (const question of row.questions) text(question, 'Specific optional decision question');
      requireThat(Array.isArray(row.steps) && row.steps.length > 0 && row.steps.length < 1000, 'Optional drafts need ordered proposed actions.');
      for (const step of row.steps) {keys(step, ['action', 'expected'], 'optional business step'); text(step.action, 'Optional step action'); if (step.expected !== undefined) text(step.expected, 'Optional step expectation'); else requireThat(row.questions.length > 0, 'Missing optional expectations need a specific decision question.');}
      requireThat(Array.isArray(row.coverageReferences) && row.coverageReferences.length === 0, 'Optional drafts use source basis without accepted coverage mappings.');
      requireThat(Array.isArray(row.sourceBasis) && row.sourceBasis.length > 0 && row.sourceBasis.length <= 20, 'Optional drafts need actual captured source basis.');
      for (const basis of row.sourceBasis) {
        keys(basis, ['kind', 'id', 'label', 'excerpt'], 'optional source basis'); text(basis.label, 'Optional source label'); text(basis.excerpt, 'Optional source excerpt');
        requireThat(optionalSources(state).some(source => source.kind === basis.kind && source.id === basis.id && source.text.includes(basis.excerpt)), 'Optional basis must match selected captured source, context, reference or usable convention evidence.');
      }
    }
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
  keys(input, ['version', 'proposal', 'reviewer', 'cases', 'requirements', 'duplicates', 'evidence', 'optionalDrafts'], 'independent design assessment');
  requireThat(input.version === 1 && input.proposal === state.proposal, 'Assessment must bind the complete current proposal.');
  text(input.reviewer, 'Reviewer'); requireThat(input.reviewer !== state.draft.author, 'Use an independent reviewer and retain its actual assessment.');
  requireThat(input.evidence, 'Retained independent reviewer run evidence is required.');
  requireThat(Array.isArray(input.cases) && input.cases.length === state.draft.cases.length && unique(input.cases.map(row => row.id)), 'Review every complete case once.');
  for (const row of input.cases) {keys(row, ['id', 'verdict', 'reason'], 'case assessment'); requireThat(state.draft.cases.some(item => item.id === row.id) && ['pass', 'revise'].includes(row.verdict), 'Invalid case assessment.'); text(row.reason, 'Source-grounding and expectation review evidence');}
  const optional = state.draft.optionalDrafts ?? [];
  if (optional.length || input.optionalDrafts !== undefined) {
    requireThat(Array.isArray(input.optionalDrafts) && input.optionalDrafts.length === optional.length && unique(input.optionalDrafts.map(row => row.id)), 'Review every optional draft once, separately from acceptance.');
    for (const row of input.optionalDrafts) {keys(row, ['id', 'verdict', 'reason'], 'optional assessment'); const draft = optional.find(item => item.id === row.id); requireThat(draft && ['supported', 'needs-decision', 'revise'].includes(row.verdict) && (row.verdict !== 'supported' || !draft.questions.length && draft.steps.every(step => step.expected)), 'Invalid optional review or unresolved executable expectation.'); text(row.reason, 'Optional source-grounding review evidence');}
  }
  const entries = state.requirements.inventory.filter(entry => ['requirement', 'criterion'].includes(entry.kind));
  requireThat(Array.isArray(input.requirements) && input.requirements.length === entries.length && unique(input.requirements.map(row => row.id)), 'Review every description/criterion inventory entry, including unresolved requirements.');
  for (const row of input.requirements) {
    keys(row, ['id', 'verdict', 'reason', 'caseIds'], 'requirement assessment');
    const entry = entries.find(item => item.id === row.id);
    requireThat(entry && ['covered', 'gap', 'unresolved', 'context'].includes(row.verdict), 'Invalid requirement assessment.'); text(row.reason, 'Coverage review evidence');
    requireThat(Array.isArray(row.caseIds) && unique(row.caseIds) && row.caseIds.every(id => state.draft.mappings.some(mapping => mapping.caseId === id && mapping.requirementId === row.id)), 'Coverage assessment must cite actual mapped cases.');
    requireThat(row.verdict !== 'covered' || entry.disposition === 'accepted' && row.caseIds.length > 0 && row.caseIds.every(id => input.cases.find(item => item.id === id)?.verdict === 'pass'), 'Covered requirements need accepted source and passing independent case reviews.');
    requireThat(row.verdict !== 'context' || entry.disposition === 'unknown' && !entry.evidence.length && !entry.questions.length && row.caseIds.length === 0 && !state.draft.mappings.some(mapping => mapping.requirementId === row.id), 'Context verdict needs an unmapped unknown slice without an owner decision or question and an independent reason; accepted obligations cannot be discarded.');
  }
  const duplicates = exactDuplicates(state);
  requireThat(Array.isArray(input.duplicates) && input.duplicates.length === duplicates.length && unique(input.duplicates.map(row => row.id)), 'Review every exact-content duplicate warning once.');
  for (const row of input.duplicates) {
    keys(row, ['id', 'verdict', 'reason'], 'duplicate assessment');
    requireThat(duplicates.some(group => group.id === row.id) && ['retain', 'revise'].includes(row.verdict), 'Duplicate warnings need an explicit retain or revise decision.');
    text(row.reason, 'Duplicate decision evidence');
  }
  return input;
}

/** Compare exact content only; never infer missing native setup or merge case identities. */
export function exactDuplicates(state) {
  if (!state.draft) return [];
  const groups = new Map();
  const add = (content, row) => {const hash = fingerprint(content); if (!groups.has(hash)) groups.set(hash, []); groups.get(hash).push(row);};
  for (const row of state.draft.cases) {
    const preparation = state.draft.preparations.find(item => item.caseId === row.id);
    add({prerequisites: row.prerequisites, testData: row.testData, steps: row.steps, setup: preparation?.steps ?? [], readiness: preparation?.expected ?? null}, {id: row.id, origin: 'proposal', coverageReferences: row.coverageReferences});
  }
  for (const item of state.evidence.existing ?? []) {
    if (state.draft.cases.some(row => row.id === String(item.id))) continue;
    try {
      const xml = item.fields['Microsoft.VSTS.TCM.Steps']; editableSteps(xml, item.fields);
      const steps = parseStepsXml(xml).map(({action, expected}) => ({action, expected}));
      const match = /^Preparation\nPrerequisites: ([\s\S]+?)\nTest data: ([\s\S]+)$/.exec(steps[0]?.action ?? '');
      if (!match || steps.slice(1).some(step => /^Preparation \d+\n/.test(step.action))) continue;
      add({prerequisites: match[1], testData: match[2], steps: steps.slice(1), setup: [], readiness: steps[0].expected}, {id: String(item.id), origin: 'captured', coverageReferences: [{description: item.fields['System.Description'] ?? '', revision: item.rev}]});
    } catch { /* Unsupported native preparation is not guessed for duplicate detection. */ }
  }
  return [...groups].filter(([, rows]) => new Set(rows.map(row => row.id)).size > 1)
    .map(([id, cases]) => ({id, caseIds: cases.filter(row => row.origin === 'proposal').map(row => row.id), cases}));
}

export function duplicateGaps(state, ids) {
  return exactDuplicates(state).filter(group => group.caseIds.some(id => ids.includes(id)) && state.review?.duplicates?.find(row => row.id === group.id)?.verdict !== 'retain');
}

export function coverage(state, selected, {confirmed = false, roots} = {}) {
  const ids = selectedIds(state.draft, selected), entries = state.requirements.inventory.filter(entry => ['requirement', 'criterion'].includes(entry.kind));
  const reviewEvidence = reviewEvidenceStatus(roots, state), contextIds = reviewEvidence.valid ? state.review.requirements.filter(row => row.verdict === 'context').map(row => row.id) : [], dependencies = dependencyGaps(state, entries.filter(entry => !contextIds.includes(entry.id)).map(entry => entry.id));
  const included = confirmed ? ids.filter(id => confirmedOutcomes(state).some(row => row.caseId === id)) : ids;
  const rows = entries.map(entry => {
    const assessment = state.review?.requirements.find(row => row.id === entry.id), mapped = state.draft.mappings.filter(row => row.requirementId === entry.id && included.includes(row.caseId));
    const required = dependencies.filter(row => row.requirementIds.includes(entry.id));
    const duplicates = duplicateGaps(state, assessment?.caseIds ?? []);
    const context = contextIds.includes(entry.id), covered = reviewEvidence.valid && !required.length && entry.disposition === 'accepted' && assessment?.verdict === 'covered' && assessment.caseIds.length > 0 && assessment.caseIds.every(id => included.includes(id)) && mapped.length > 0 && !duplicates.length;
    return {requirementId: entry.id, status: context ? 'context' : covered ? 'covered' : entry.disposition !== 'accepted' || required.length ? 'unresolved' : 'gap', caseIds: mapped.map(row => row.caseId), reason: !reviewEvidence.valid ? reviewEvidence.reason : required.length ? required.map(row => `${row.status}; ${row.reason}`).join(' ') : duplicates.length ? 'Affected exact-content duplicate needs an independent retain or revise decision.' : assessment?.reason ?? 'Independent semantic coverage review is required.', ...(required.length ? {dependencies: required} : {})};
  });
  const gaps = rows.filter(row => !['covered', 'context'].includes(row.status));
  return {basis: confirmed ? 'confirmed applied or unchanged' : 'reviewed proposal', complete: entries.length > 0 && gaps.length === 0 && state.evidence.requirements.omissions.filter(row => !['absent', 'not-selected'].includes(row.reason)).length === 0, requirements: rows, gaps, reviewEvidence, dependencies};
}

const cell = value => escapeHtml(String(value)).replaceAll('|', '&#124;').replace(/[\\`*_~\[\]{}]/g, '\\$&').replace(/\r\n?|\n/g, '<br>');
const table = rows => rows.map(row => row.every(value => /^---:?$/.test(value)) ? '|' + row.join('|') + '|' : '| ' + row.join(' | ') + ' |').join('\n');
export function renderDesign(draft, state) {
  const optional = draft.optionalDrafts ?? [], classify = cases => ({total: cases.length, testTypes: Object.fromEntries(TEST_TYPES.map(type => [type, cases.filter(row => row.testType === type).length])), scenarioTypes: Object.fromEntries(SCENARIO_TYPES.map(type => [type, cases.filter(row => row.scenarioType === type).length]))});
  const summary = {...classify(draft.cases), optionalDrafts: classify(optional)};
  const summaryText = `**Total cases: ${summary.total} main cases · ${optional.length} optional drafts**\n\n` + table([['Test type', 'Main cases', 'Optional drafts'], ['---', '---:', '---:'], ...TEST_TYPES.map(type => [type, String(summary.testTypes[type]), String(summary.optionalDrafts.testTypes[type])]), ['**Total**', `**${summary.total}**`, `**${optional.length}**`]]) + '\n\n' + table([['Scenario type', 'Main cases', 'Optional drafts'], ['---', '---:', '---:'], ...SCENARIO_TYPES.map(type => [type, String(summary.scenarioTypes[type]), String(summary.optionalDrafts.scenarioTypes[type])])]) + '\n\nBoth tables classify the same cases. Optional drafts have no accepted-coverage credit; zero counts do not imply gaps.';
  const reference = row => row.coverageReferences.map(ref => readableReference(state, ref.requirementId, ref.label)).join('; ');
  const outcome = row => {const steps = draft.mappings.filter(mapping => mapping.caseId === row.id).flatMap(mapping => mapping.checks.map(check => check.step)); return row.steps[Math.max(...steps) - 1].expected;};
  const overview = table([['Case', 'Action', 'Title', 'Prerequisites', 'Final expected results', 'Coverage reference', 'Test type', 'Scenario type'], Array(8).fill('---'), ...draft.cases.map(row => [row.id, row.proposedAction, row.title, row.prerequisites, outcome(row), reference(row), row.testType, row.scenarioType].map(cell))]);
  const detail = (row, ref) => table([
    ['**1. CASE DETAILS**', '', '', '', ''], Array(5).fill('---'),
    ['**ID**', '**Title**', '**Coverage reference**', '**Test type**', '**Scenario type**'],
    [row.id, row.title, ref, row.testType, row.scenarioType].map(cell),
    ['**2. SETUP**', '', '', '', ''], ['**Prerequisites**', cell(row.prerequisites), '', '', ''], ['**Test data**', cell(row.testData), '', '', ''],
    ['**3. STEPS**', '**Step action**', '**Step expected result**', '', ''],
    ...row.steps.map((step, index) => [`**${index + 1}**`, cell(step.action), cell(step.expected ?? 'Decision needed: ' + row.questions.join('; ')), '', '']),
  ]);
  const details = draft.cases.map(row => detail(row, reference(row)));
  const basisText = basis => {
    const actual = state && optionalSources(state).find(source => source.kind === basis.kind && source.id === basis.id);
    const label = basis.label === basis.id || /\b(?:req-|ref-)[a-f0-9]+\b|\b[a-f0-9]{64}\b/.test(basis.label) ? actual?.label ?? 'Selected supporting source' : basis.label;
    return `${label} — ${basis.excerpt}`;
  };
  const optionalTitles = optional.length ? '**Optional drafts — awaiting selection**\n\n' + optional.map(row => `- **${cell(row.id)} — ${cell(row.title)}** — ${row.testType} / ${row.scenarioType}${row.questions.length ? '; decision needed: ' + row.questions.map(cell).join('; ') : ''}`).join('\n') : '';
  const optionalDetails = optional.map(row => [`### Optional draft: ${cell(row.id)} — ${cell(row.title)}`, detail(row, row.sourceBasis.map(basisText).join('; ')), '**Source basis:** ' + row.sourceBasis.map(basis => cell(basisText(basis))).join('; '), ...(row.questions.length ? ['**Decisions needed:** ' + row.questions.map(cell).join('; ')] : []), ...(state?.review?.optionalDrafts?.find(item => item.id === row.id) ? ['**Independent optional review:** ' + cell(state.review.optionalDrafts.find(item => item.id === row.id).verdict + '; ' + state.review.optionalDrafts.find(item => item.id === row.id).reason)] : [])].join('\n\n'));
  return {summary, summaryText, overview, details, optionalTitles, optionalDetails, chatSummary: [summaryText, overview, optionalTitles].filter(Boolean).join('\n\n'), markdown: [summaryText, overview, ...details, optionalTitles, ...optionalDetails].filter(Boolean).join('\n\n')};
}

/** Presentation of the exact immutable preview. Recovery identities remain in the original JSON. */
export function renderPublication(plan, state) {
  const labels = {'System.Title': 'Title', 'System.Description': 'Description / coverage references', 'Microsoft.VSTS.TCM.Steps': 'Ordered steps', 'System.Tags': 'Tags'};
  const show = value => value === undefined ? '(not set)' : typeof value === 'string' ? value : JSON.stringify(value);
  const stepRows = value => value ? parseStepsXml(value).map(({action, expected}) => ({action, expected})) : [];
  const description = value => String(value ?? '').replace(/(<!-- pom-harness:coverage:story-\d+ -->)([\s\S]*?)(<!-- \/pom-harness:coverage:story-\d+ -->)/g, (_, begin, body, end) => {
    const managed = /^<p>Coverage reference: Story (\d+) — ([\s\S]*)\.<\/p>$/.exec(body);
    if (!managed) return begin + body + end;
    const refs = managed[2].split('; ').map(label => {
      const decoded = decodeEntities(label), entry = state.requirements.inventory.find(entry => decoded === entry.id || entry.id.length >= 16 && decoded.includes(entry.id));
      return entry ? readableReference(state, entry.id, decoded) : /\b(?:req-|ref-)[a-f0-9]+\b|\b[a-f0-9]{64}\b/.test(decoded) ? 'Earlier source requirement (original preview retains its binding)' : decoded;
    });
    return `Coverage reference: Story ${managed[1]} — ${refs.join('; ')}.`;
  });
  const nativePreview = plan.operations.map(operation => {
    const before = operation.before?.fields ?? {}, after = operation.fields, changes = operation.changedFields ?? [];
    return {caseId: operation.caseId, action: operation.action, changedFields: changes.filter(name => name !== 'System.History').map(name => labels[name] ?? operation.publicationFields?.schema.find(field => field.referenceName === name)?.name ?? name),
      title: {before: before['System.Title'] ?? null, value: after['System.Title']},
      steps: {before: stepRows(before['Microsoft.VSTS.TCM.Steps']).length, value: stepRows(after['Microsoft.VSTS.TCM.Steps']).length, changed: changes.includes('Microsoft.VSTS.TCM.Steps')},
      descriptionChanged: changes.includes('System.Description'), tags: {before: before['System.Tags'] ?? null, value: after['System.Tags']},
      linkedStoryId: operation.relation ? plan.destination.storyId : null, sharedWith: operation.sharedWith};
  });
  const sections = ['## Publication preview', `**Destination:** ${cell(plan.destination.organizationUrl)} · ${cell(plan.destination.project)} · Story ${plan.destination.storyId}`, `**Selected cases:** ${plan.selected.map(cell).join(', ')}`];
  for (const operation of plan.operations) {
    const before = operation.before?.fields ?? {}, changes = operation.changedFields ?? [];
    sections.push(`### Native changes: ${cell(operation.caseId)} — ${cell(operation.action)}`);
    const fields = ['System.Title', 'System.Description', 'System.Tags'].filter(name => changes.includes(name)).map(name => [labels[name], show(name === 'System.Description' ? description(before[name]) : before[name]), show(name === 'System.Description' ? description(operation.fields[name]) : operation.fields[name])]);
    for (const field of plan.fieldPreview.find(row => row.caseId === operation.caseId)?.fields ?? []) fields.push([`${field.label} (${field.referenceName})${field.source === 'server-default' ? ' — server default' : ''}`, show(field.before), show(field.value)]);
    if (fields.length) sections.push(table([['Field', 'Before', 'Proposed / server default'], Array(3).fill('---'), ...fields.map(row => row.map(cell))]));
    if (changes.includes('Microsoft.VSTS.TCM.Steps')) {
      const previous = stepRows(before['Microsoft.VSTS.TCM.Steps']), proposed = stepRows(operation.fields['Microsoft.VSTS.TCM.Steps']);
      sections.push(table([['Step', 'Before action', 'Before expected result', 'Proposed action', 'Proposed expected result'], Array(5).fill('---'), ...Array.from({length: Math.max(previous.length, proposed.length)}, (_, index) => [String(index + 1), previous[index]?.action ?? '', previous[index]?.expected ?? '', proposed[index]?.action ?? '', proposed[index]?.expected ?? ''].map(cell))]));
    }
    const preparation = plan.preparationPreview.find(row => row.caseId === operation.caseId);
    if (preparation) sections.push('**Reviewed preparation:**\n\n' + table([['Action', 'Readiness expectation'], ['---', '---'], ...preparation.steps.map(step => [cell(step.action), cell(step.expected)])]));
    sections.push(operation.relation ? `Creation links this case to Story ${plan.destination.storyId}.` : 'Existing relationships are preserved.');
    if (operation.sharedWith.length) sections.push(`Also linked to stories: ${operation.sharedWith.join(', ')}.`);
  }
  sections.push('The exact immutable preview JSON retains native markup, request values and recovery markers. This current Markdown file presents those changes and does not authorize publication.');
  return {nativePreview, markdown: sections.join('\n\n')};
}

export const proposalFingerprint = (source, draft, requirements) => fingerprint({source, draft, inventory: requirements.inventory});
export function preparationSteps(row, preparation) {
  const setup = `Preparation\nPrerequisites: ${row.prerequisites}\nTest data: ${row.testData}`;
  return preparation.steps ? preparation.steps.map((step, index) => ({action: index ? `Preparation ${index + 1}\n${step.action}` : `${setup}\n${step.action}`, expected: step.expected})) : [{action: setup, expected: preparation.expected}];
}
