import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {designFixture, assessmentFor} from './fixtures/design-local.mjs';
import {retainAssessment} from './fixtures/design-review.mjs';
import {saveDesign, assessDesign, designView, readDesign, prepareDesign, compactDesignResult, stateToDesignView, designHandoff, lockDesign, rejectDesign} from '../scripts/lib/test-case-design/index.mjs';
import {withReviewCopy} from '../scripts/lib/test-case-design/review-copy.mjs';
import {captureRequirements, prepareRequirements, updateInventory} from '../scripts/lib/requirements/index.mjs';
import {fingerprint} from '../scripts/lib/execution-core/data.mjs';
import {putRequirementFile as put} from './fixtures/requirements.mjs';
import {adoDesignFixture} from './fixtures/test-case-design.mjs';
import {previewDesign, publishDesign, reconcileDesign} from '../scripts/lib/test-case-design/delivery.mjs';
import {postcodeFixture} from './fixtures/postcode-design.mjs';
import {validateDesign, validateAssessment, renderDesign} from '../scripts/lib/test-case-design/review.mjs';
import {requireFreshDesign} from '../scripts/lib/test-case-design/sources.mjs';

function accept(roots, requirements, entries = requirements.inventory.filter(row => ['requirement', 'criterion'].includes(row.kind))) {
  return updateInventory(roots, requirements.analysisId, {version: 1, snapshot: requirements.snapshot, changes: entries.map((entry, i) => {
    const decision = {version: 1, authority: 'owner', actor: 'Synthetic owner', consumer: requirements.consumer, snapshot: requirements.snapshot, requirementId: entry.id, content: entry.content, disposition: 'accepted', statement: 'Include this explicitly shown behavior and expectation in the proposal.'};
    const path = `owner-${i}.json`; put(roots, path, decision);
    return {id: entry.id, disposition: 'accepted', evidence: [{kind: 'decision', path, fingerprint: fingerprint(decision)}]};
  })});
}

function optional(f, unresolved = false) {
  const part = f.state.evidence.requirements.parts[0];
  return {...structuredClone(f.proposal.cases[0]), id: unresolved ? 'NEW-QUESTION' : 'NEW-OPTIONAL', title: unresolved ? 'Check response time' : 'Keyboard navigation',
    coverageReferences: [], testType: unresolved ? 'Performance' : 'Accessibility',
    sourceBasis: [{kind: 'source', id: part.id, label: 'Selected login description', excerpt: part.text}],
    questions: unresolved ? ['What response-time threshold applies?'] : [],
    steps: unresolved ? [{action: 'Measure the sign-in response time.'}] : [{action: 'Follow the agreed keyboard sequence.', expected: 'The agreed focused sign-in control is reached.'}]};
}

test('saved optional drafts, decision questions and independent feedback survive a fresh process without notes', async () => {
  const f = await designFixture(); f.proposal.optionalDrafts = [optional(f), optional(f, true)];
  const saved = saveDesign(f.roots, 'login', f.proposal), assessment = assessmentFor(saved);
  assessment.optionalDrafts = saved.draft.optionalDrafts.map(row => ({id: row.id, verdict: row.questions.length ? 'needs-decision' : 'supported', reason: row.questions.length ? 'The threshold needs an owner decision.' : 'The selected basis supports the proposed check.'}));
  const assessed = assessDesign(f.roots, 'login', retainAssessment(f.roots, saved, assessment));
  const invoke = format => spawnSync(process.execPath, [join(f.roots.packageRoot, 'scripts/test-case-design.mjs'), '--project-root', f.roots.projectRoot, 'read', '--id', 'login', ...(format ? ['--format', format] : [])], {encoding: 'utf8'});
  const processRead = invoke(); assert.equal(processRead.status, 0, processRead.stderr);
  const view = JSON.parse(processRead.stdout);
  assert.deepEqual(view.draft.optionalDrafts, saved.draft.optionalDrafts);
  assert.deepEqual(view.review.optionalDrafts, assessed.review.optionalDrafts);
  assert.equal(view.rendered.summary.total, 3); assert.equal(view.rendered.summary.optionalDrafts.total, 2);
  assert.equal(view.coverage.complete, true); assert.equal(view.reviewFile.path, join(f.roots.projectRoot, '.harness/runs/test-case-design/login/review.md'));
  for (const text of [view.rendered.markdown, view.rendered.chatSummary]) {
    assert(text.indexOf('| Test type | Main cases | Optional drafts |') < text.indexOf('| Scenario type | Main cases | Optional drafts |'));
    assert(text.indexOf('| Scenario type |') < text.indexOf('| Case | Action | Title | Prerequisites | Final expected results | Coverage reference | Test type | Scenario type |'));
    assert.match(text, /\| Compatibility \| 0 \| 0 \|/); assert.match(text, /\| Negative \| 1 \| 0 \|/);
    assert.match(text, /Keyboard navigation/); assert.match(text, /What response-time threshold applies/);
  }
  assert.match(view.rendered.markdown, /Follow the agreed keyboard sequence/); assert.match(view.rendered.markdown, /The threshold needs an owner decision/);
  assert(!view.rendered.chatSummary.includes('**3. STEPS**')); assert(!view.rendered.chatSummary.includes('Follow the agreed keyboard sequence'));
  const result = invoke('compact'); assert.equal(result.status, 0, result.stderr); const compact = JSON.parse(result.stdout);
  assert(compact.summary.includes('| Case | Action |')); assert.equal(compact.draft, undefined); assert.equal(compact.rendered, undefined); assert(!result.stdout.includes('**3. STEPS**'));
  assert.equal(compact.bindings.head, view.head); assert.equal(compact.reviewFile.status, 'written');
  const before = readDesign(f.roots, 'login'); const invalid = invoke('tiny'); assert.equal(invalid.status, 1); assert.deepEqual(readDesign(f.roots, 'login'), before);
  const edit = {...saved.draft, head: before.head, cases: structuredClone(saved.draft.cases)}; edit.cases[0].title = 'An invalid-format edit must never apply'; put(f.roots, 'edit.json', edit);
  const invalidEdit = spawnSync(process.execPath, [join(f.roots.packageRoot, 'scripts/test-case-design.mjs'), '--project-root', f.roots.projectRoot, 'edit', '--id', 'login', '--input', 'edit.json', '--format', 'tiny'], {encoding: 'utf8'});
  assert.equal(invalidEdit.status, 1); assert.deepEqual(readDesign(f.roots, 'login'), before);
});

test('structured references are readable while literal IDs and custom words remain unchanged', async () => {
  const f = await designFixture(), id = f.proposal.cases[0].coverageReferences[0].requirementId;
  f.proposal.cases[0].coverageReferences[0].label = id;
  f.proposal.cases[0].testData += ` Literal ${id}; login is an ordinary word.`;
  f.proposal.mappings[0].checks[0].data = f.proposal.cases[0].testData;
  const saved = saveDesign(f.roots, 'login', f.proposal), view = designView(f.roots, 'login');
  assert(!view.rendered.overview.includes(id)); assert.match(view.rendered.overview, /valid login opens the current user dashboard/);
  assert(view.rendered.markdown.includes(`Literal ${id}`)); assert(view.rendered.markdown.includes('login is an ordinary word'));
  assert(!view.rendered.chatSummary.includes(saved.head)); assert(!view.rendered.markdown.includes(saved.proposal));
});

test('one current copy preserves legacy files and rejects stale views without replacing the current file', async () => {
  const f = await designFixture(), saved = saveDesign(f.roots, 'login', f.proposal), first = designView(f.roots, 'login');
  const legacy = join(f.roots.projectRoot, `.harness/runs/test-case-design/login/${saved.head}.md`); writeFileSync(legacy, 'Historical user artifact.');
  const assessed = assessDesign(f.roots, 'login', retainAssessment(f.roots, saved, assessmentFor(saved))), current = designView(f.roots, 'login');
  assert.equal(first.reviewFile.path, current.reviewFile.path); assert.equal(readFileSync(legacy, 'utf8'), 'Historical user artifact.');
  const stale = withReviewCopy(f.roots, first); assert.equal(stale.reviewFile.status, 'unavailable'); assert.equal(stale.reviewFile.path, undefined);
  assert(!stale.rendered.chatSummary.includes('[Current Markdown review]'));
  assert.equal(readFileSync(current.reviewFile.path, 'utf8'), current.rendered.markdown); assert.equal(readDesign(f.roots, 'login').head, assessed.head);
  const release = lockDesign(f.roots, 'login');
  try {const active = designView(f.roots, 'login'); assert.equal(active.reviewFile.status, 'unavailable'); assert(existsSync(join(f.roots.projectRoot, '.harness/state/test-case-design/login/lock'))); assert.equal(readFileSync(current.reviewFile.path, 'utf8'), current.rendered.markdown);}
  finally {release();}
});

test('file failure keeps compact output concise with explicit detailed access and no stale link', async () => {
  const f = await designFixture(); saveDesign(f.roots, 'login', f.proposal);
  const directory = join(f.roots.projectRoot, '.harness/runs/test-case-design'); mkdirSync(directory, {recursive: true}); writeFileSync(join(directory, 'login'), 'Unavailable directory');
  const run = spawnSync(process.execPath, [join(f.roots.packageRoot, 'scripts/test-case-design.mjs'), '--project-root', f.roots.projectRoot, 'read', '--id', 'login', '--format', 'compact'], {encoding: 'utf8'});
  assert.equal(run.status, 0, run.stderr); const result = JSON.parse(run.stdout);
  assert.equal(result.reviewFile.status, 'unavailable'); assert.equal(result.reviewFile.path, undefined); assert(!run.stdout.includes('**3. STEPS**')); assert.match(result.summary, /explicit.*read|detailed read/i);
});

test('independent context verdict removes narrative-only false gaps and cannot discard accepted description obligations', async () => {
  const f = await designFixture(), baseline = saveDesign(f.roots, 'login', f.proposal);
  assessDesign(f.roots, 'login', retainAssessment(f.roots, baseline, assessmentFor(baseline)));
  const oldSource = readFileSync(join(f.roots.projectRoot, 'story.md'), 'utf8'); put(f.roots, 'story.md', '# Login overview\n' + oldSource);
  let requirements = prepareRequirements(f.roots, 'login', await captureRequirements(f.roots, f.state.evidence.requirements.request));
  const actual = requirements.inventory.filter(row => f.requirements.inventory.some(before => before.id === row.id)); requirements = accept(f.roots, requirements, actual);
  const prepared = await prepareDesign(f.roots, 'login', {version: 1, analysisId: 'login'}), saved = saveDesign(f.roots, 'login', {...baseline.draft, source: prepared.source});
  const assessment = assessmentFor(saved), narrative = requirements.inventory.find(row => !actual.some(item => item.id === row.id));
  assessment.requirements.push({id: narrative.id, verdict: 'context', reason: 'This section heading provides structure and states no testable obligation.', caseIds: []});
  const assessed = assessDesign(f.roots, 'login', retainAssessment(f.roots, saved, assessment)), view = designView(f.roots, 'login');
  assert.equal(view.coverage.complete, true); assert.equal(view.coverage.gaps.length, 0); assert.equal(view.coverage.requirements.find(row => row.requirementId === narrative.id).status, 'context');
  assert.deepEqual(assessed.draft.cases, baseline.draft.cases);
  const discard = structuredClone(assessment); Object.assign(discard.requirements[0], {verdict: 'context', caseIds: []});
  assert.throws(() => assessDesign(f.roots, 'login', retainAssessment(f.roots, saved, discard)), /accepted obligations/);
  const decisionState = structuredClone(saved); decisionState.requirements.inventory.find(row => row.id === narrative.id).disposition = 'needs-decision';
  assert.throws(() => validateAssessment({...assessment, evidence: {}}, decisionState), /owner decision/);
  const gap = structuredClone(assessment); Object.assign(gap.requirements[0], {verdict: 'gap', caseIds: [], reason: 'A real description obligation remains unverified.'});
  assessDesign(f.roots, 'login', retainAssessment(f.roots, saved, gap)); assert.equal(designView(f.roots, 'login').coverage.complete, false);
});

test('combined main and optional review promotes a genuine accepted supplemental source and preserves exact native preview', async t => {
  const f = await adoDesignFixture(t), conventionPath = '.harness/knowledge/test-case-design-conventions.json';
  const keyboard = 'Keyboard focus moves from username to password to Sign in, with visible focus.';
  put(f.roots, conventionPath, {version: 1, project: 'demo', application: 'login', status: 'current', agreement: {actor: 'Synthetic owner', reference: 'Agreed keyboard convention'}, defaults: {terminology: {keyboard}}});
  let prepared = await prepareDesign(f.roots, 'login', {version: 1, analysisId: 'login', caseIds: [101]}, {client: f.client});
  const base = {...f.proposal, source: prepared.source};
  const draft = {...structuredClone(base.cases[0]), id: 'NEW-KEYBOARD', title: 'Use the agreed keyboard focus order', coverageReferences: [], testType: 'Accessibility', steps: [{action: 'Tab through username, password and Sign in.', expected: keyboard}], sourceBasis: [{kind: 'convention', id: conventionPath, label: 'Agreed keyboard convention', excerpt: keyboard}], questions: []};
  const unresolved = {...structuredClone(draft), id: 'NEW-TIMING', title: 'Measure response time', testType: 'Performance', questions: ['Which response time threshold is required?'], steps: [{action: 'Measure the login response.'}]};
  let saved = saveDesign(f.roots, 'login', {...base, optionalDrafts: [draft, unresolved]});
  let assessment = {version: 1, proposal: saved.proposal, reviewer: 'independent-fixture', cases: saved.draft.cases.map(row => ({id: row.id, verdict: 'pass', reason: 'Accepted sign-in outcome and actual identity are checked.'})), requirements: saved.requirements.inventory.filter(row => ['requirement', 'criterion'].includes(row.kind)).map(row => ({id: row.id, verdict: 'covered', caseIds: saved.draft.mappings.filter(mapping => mapping.requirementId === row.id).map(mapping => mapping.caseId), reason: 'Accepted behavior is verified.'})), optionalDrafts: [{id: draft.id, verdict: 'supported', reason: 'The agreed convention supplies the exact focus expectation.'}, {id: unresolved.id, verdict: 'needs-decision', reason: 'Timing has no agreed threshold.'}]};
  saved = assessDesign(f.roots, 'login', retainAssessment(f.roots, saved, assessment));
  const first = designView(f.roots, 'login'); assert.equal(first.rendered.summary.total, 2); assert.equal(first.rendered.summary.optionalDrafts.total, 2);
  await assert.rejects(designHandoff(f.roots, 'login', {client: f.client, selected: [draft.id]}), /known case/);
  // Promotion reuses immutable saved proposal content after an explicit local-source capture.
  put(f.roots, 'keyboard.md', keyboard);
  const request = {...prepared.evidence.requirements.request, sources: [{id: 'keyboard', kind: 'file', path: 'keyboard.md'}]};
  let requirements = prepareRequirements(f.roots, 'login', await captureRequirements(f.roots, request, {client: f.client}));
  const supplemental = requirements.inventory.find(row => !saved.requirements.inventory.some(before => before.id === row.id));
  prepared = await prepareDesign(f.roots, 'login', {version: 1, analysisId: 'login', caseIds: [101]}, {client: f.client});
  const {sourceBasis, questions, ...ordinary} = saved.draft.optionalDrafts[0]; ordinary.coverageReferences = [{requirementId: supplemental.id, label: supplemental.id}];
  const promotion = {...saved.draft, source: prepared.source, cases: [...saved.draft.cases, ordinary], optionalDrafts: saved.draft.optionalDrafts.filter(row => row.id !== draft.id), mappings: [...saved.draft.mappings, {caseId: draft.id, requirementId: supplemental.id, checks: [{step: 1, expected: keyboard, data: draft.testData}]}], preparations: [...saved.draft.preparations, {caseId: draft.id, expected: 'The sign-in controls are displayed and keyboard input is available.'}]};
  assert.throws(() => saveDesign(f.roots, 'login', promotion), /owner decision/);
  requirements = accept(f.roots, requirements);
  prepared = await prepareDesign(f.roots, 'login', {version: 1, analysisId: 'login', caseIds: [101]}, {client: f.client});
  saved = saveDesign(f.roots, 'login', {...promotion, source: prepared.source}); assert.equal(saved.review, null); assert.equal(saved.assessment, null);
  await assert.rejects(previewDesign(f.roots, 'login', {client: f.client}), /independent/i);
  assessment = {...assessment, proposal: saved.proposal, cases: [...assessment.cases, {id: draft.id, verdict: 'pass', reason: 'The promoted check retains the accepted supplemental focus expectation.'}], requirements: [...assessment.requirements, {id: supplemental.id, verdict: 'covered', caseIds: [draft.id], reason: 'The selected owner-accepted keyboard requirement is verified.'}], optionalDrafts: assessment.optionalDrafts.filter(row => row.id !== draft.id)};
  saved = assessDesign(f.roots, 'login', retainAssessment(f.roots, saved, assessment));
  const current = designView(f.roots, 'login'); assert.equal(current.reviewFile.path, first.reviewFile.path); assert.equal(current.rendered.summary.total, 3); assert.equal(current.rendered.summary.optionalDrafts.total, 1); assert.equal(current.rendered.summary.testTypes.Accessibility, 1); assert.equal(current.rendered.summary.optionalDrafts.testTypes.Accessibility, 0);
  assert.deepEqual(current.draft.optionalDrafts, [unresolved]); assert.equal(current.coverage.complete, true);
  f.control.fields.push({referenceName: 'Custom.Owner', name: 'Case owner', type: 'string', readOnly: false, alwaysRequired: true}, {referenceName: 'Custom.Channel', name: 'Channel', type: 'string', readOnly: false, alwaysRequired: true}); f.control.serverDefaults['Custom.Channel'] = 'Web';
  const selected = ['NEW-01', draft.id], fields = {version: 1, cases: selected.map((caseId, i) => ({caseId, fields: {'Custom.Owner': i ? 'Accessibility team' : 'Login team'}}))};
  const plan = await previewDesign(f.roots, 'login', {client: f.client, selected, fields}), compact = compactDesignResult(plan);
  const {presentation, fingerprint: approval, ...approved} = plan; assert.equal(fingerprint(approved), approval);
  const savedPlan = JSON.parse(readFileSync(join(f.roots.projectRoot, `.harness/state/test-case-design/login/previews/${approval}.json`), 'utf8'));
  assert.equal(savedPlan.presentation, undefined); assert.equal(savedPlan.fingerprint, approval);
  assert.deepEqual(compact.destination, plan.destination); assert.deepEqual(compact.selected, selected); assert.deepEqual(compact.fieldPreview, plan.fieldPreview); assert.deepEqual(compact.preparationPreview, plan.preparationPreview);
  assert.equal(compact.reviewFile.path, current.reviewFile.path); assert(!JSON.stringify(compact).includes('**3. STEPS**')); assert(!plan.operations.some(row => row.caseId === unresolved.id));
  const markdown = readFileSync(compact.reviewFile.path, 'utf8'); assert.match(markdown, /## Publication preview/); assert(markdown.includes('Accessibility team')); assert(markdown.includes('Login team')); assert(markdown.includes('Custom.Channel')); assert(markdown.includes('server default')); assert(markdown.includes('Tab reaches') || markdown.includes('Tab through'));
  assert(!markdown.includes(supplemental.id)); assert(!markdown.includes(approval)); assert(!markdown.includes(plan.operations[0].identity));
  assert.equal(presentation.rendered.markdown, markdown); assert.equal(compact.nativePreview.length, selected.length);
  for (const row of compact.nativePreview) {const operation = plan.operations.find(operation => operation.caseId === row.caseId); assert.equal(row.title.value, operation.fields['System.Title']); assert(row.changedFields.includes('Ordered steps')); assert.equal(row.linkedStoryId, plan.destination.storyId);}
  for (const operation of plan.operations) {
    const preview = compact.fieldPreview.find(row => row.caseId === operation.caseId);
    for (const field of preview.fields.filter(row => row.source !== 'server-default')) assert.equal(field.value, operation.request.body.find(patch => patch.path === '/fields/' + field.referenceName).value);
    assert.deepEqual(preview.fields.find(row => row.referenceName === 'Custom.Channel'), {referenceName: 'Custom.Channel', label: 'Channel', value: 'Web', source: 'server-default'});
  }
  for (const setup of compact.preparationPreview) for (const step of setup.steps) assert(markdown.includes(step.expected));
  assert.equal(f.control.writes, 0); assert.equal(f.state.items.get(200).fields['Microsoft.VSTS.Common.AcceptanceCriteria'], 'A valid login opens the current user dashboard.');
  const ownerPath = requirements.inventory.find(row => row.id === supplemental.id).evidence[0].path; put(f.roots, ownerPath, {changed: true});
  await assert.rejects(requireFreshDesign(f.roots, saved, {client: f.client, selected: [draft.id]}), /owner decision/);
  const stale = stateToDesignView(f.roots, first); assert.equal(stale.reviewFile.status, 'unavailable');
});

test('optional basis resolves selected context and references, rejects invented excerpts, and retains real review binding', async () => {
  const f = await designFixture(), state = structuredClone(f.state), draft = optional(f);
  state.evidence.context = {result: {results: [{passageId: 'selected-passage', citation: {label: 'Team keyboard guide'}, excerpt: 'Tab reaches Sign in with visible focus.'}]}};
  state.evidence.references.items = [{id: 'selected-reference', workItemId: 300, source: {parts: [{text: 'The visible focus indicator remains on the selected control.'}]}}];
  draft.sourceBasis = [{kind: 'context', id: 'selected-passage', label: 'Team keyboard guide', excerpt: 'Tab reaches Sign in with visible focus.'}, {kind: 'reference', id: 'selected-reference', label: 'Keyboard rules', excerpt: 'The visible focus indicator remains on the selected control.'}];
  const proposal = {...f.proposal, optionalDrafts: [draft]};
  assert.deepEqual(validateDesign(proposal, state, f.requirements).optionalDrafts[0].sourceBasis, draft.sourceBasis);
  const invented = structuredClone(proposal); invented.optionalDrafts[0].sourceBasis[0].excerpt = 'Invented expected response time'; assert.throws(() => validateDesign(invented, state, f.requirements), /captured/);
  const actual = saveDesign(f.roots, 'login', {...f.proposal, optionalDrafts: [optional(f)]}), assessment = assessmentFor(actual);
  assert.throws(() => assessDesign(f.roots, 'login', retainAssessment(f.roots, actual, assessment)), /every optional/);
  assessment.optionalDrafts = [{id: 'NEW-OPTIONAL', verdict: 'supported', reason: 'The actual captured source basis supports this check.'}];
  const evidence = retainAssessment(f.roots, actual, assessment), changed = structuredClone(evidence); changed.optionalDrafts[0].reason = 'Different optional feedback';
  assert.throws(() => assessDesign(f.roots, 'login', changed), /findings differ/);
});

test('ordinary-word custom identities render readable references without replacing literal data', async () => {
  const f = await designFixture(), state = structuredClone(f.state), draft = structuredClone(f.proposal), entry = state.requirements.inventory[0], before = entry.id;
  entry.id = 'login'; for (const ref of draft.cases[0].coverageReferences) if (ref.requirementId === before) Object.assign(ref, {requirementId: 'login', label: 'login'});
  for (const mapping of draft.mappings) if (mapping.requirementId === before) mapping.requirementId = 'login';
  draft.cases[0].testData = 'login and login-extra are literal input values.';
  const rendered = renderDesign(draft, state);
  assert.match(rendered.overview, /File: story.md/); assert(rendered.markdown.includes('login and login-extra are literal input values.'));
  assert(!rendered.overview.includes('AC-1'));
});

test('compact final assess consumes notes once and directly delivers the current summary and complete file', async () => {
  const f = await designFixture(); put(f.roots, 'proposal.json', f.proposal);
  const invoke = (command, input, notes) => spawnSync(process.execPath, [join(f.roots.packageRoot, 'scripts/test-case-design.mjs'), '--project-root', f.roots.projectRoot, command, '--id', 'login', '--input', input, '--format', 'compact', ...(notes ? ['--notes', notes] : [])], {encoding: 'utf8'});
  const review = invoke('review', 'proposal.json'); assert.equal(review.status, 0, review.stderr);
  const saved = readDesign(f.roots, 'login'); put(f.roots, 'assessment.json', retainAssessment(f.roots, saved, assessmentFor(saved)));
  put(f.roots, 'notes.json', {gaps: 'Catalog completeness needs the expected full product list; supported sample checks proceed.'});
  const run = invoke('assess', 'assessment.json', 'notes.json'); assert.equal(run.status, 0, run.stderr); const result = JSON.parse(run.stdout);
  assert.equal(result.status, 'assessed'); assert.equal(result.coverage.complete, true); assert.match(result.summary, /expected full product list/); assert(!result.summary.includes('**3. STEPS**'));
  assert.match(readFileSync(result.reviewFile.path, 'utf8'), /\*\*3. STEPS\*\*/); assert.equal(result.bindings.assessment, readDesign(f.roots, 'login').assessment);
  const handoff = compactDesignResult(await designHandoff(f.roots, 'login', {selected: ['NEW-01']}));
  assert.equal(handoff.status, 'handoff'); assert.equal(handoff.bindings.source, undefined); assert(!JSON.stringify(handoff).includes('Enter valid credentials'));
});

test('compact reconciliation retains readable affected cases and stale reference diagnostics after confirmed delivery', async t => {
  const f = await postcodeFixture(t), options = {client: f.client};
  const preview = await previewDesign(f.roots, 'postcode', options);
  await publishDesign(f.roots, 'postcode', {...options, approval: preview.fingerprint});
  f.state.items.get(1180).rev++;
  const result = await reconcileDesign(f.roots, 'postcode', options), compact = compactDesignResult(result);
  assert.equal(result.mode, 'completed'); assert.equal(compact.coverage.complete, false);
  assert(compact.coverage.gaps.length > 0); assert(compact.coverage.dependencies.length > 0);
  assert.match(compact.summary, /publication|delivery/i); assert.match(compact.summary, /coverage.*incomplete/i);
  const gap = compact.coverage.gaps[0], dependency = compact.coverage.dependencies[0];
  assert.match(gap.reference, /Apply postcode validation/); assert(gap.caseIds.includes('NEW-trim')); assert.match(gap.reason, /changed|revalidate/i);
  assert.match(dependency.reference, /1180/); assert(dependency.caseIds.includes('NEW-short')); assert.match(dependency.reason, /changed|revalidate/i);
  assert.equal(gap.requirementId, undefined); assert.equal(dependency.referenceId, undefined); assert(!JSON.stringify(compact.coverage).includes('ref-')); assert(!JSON.stringify(compact.coverage).includes('req-'));
  assert.equal(result.coverage.gaps[0].requirementId, 'postcode'); assert.equal(result.execution, 'not-run');
});

test('compact handoff, rejection and preparation summaries preserve actionable state without a full reread', async () => {
  const f = await designFixture(), prepared = compactDesignResult(f.state);
  assert.equal(prepared.status, 'prepared'); assert.match(prepared.summary, /save.*proposal/i);
  const saved = saveDesign(f.roots, 'login', f.proposal); assessDesign(f.roots, 'login', retainAssessment(f.roots, saved, assessmentFor(saved)));
  const handoff = await designHandoff(f.roots, 'login', {selected: ['NEW-01']}), compact = compactDesignResult(handoff);
  assert.match(compact.summary, /handoff/i); assert.match(compact.summary, /coverage.*incomplete/i); assert(compact.coverage.gaps.some(row => row.caseIds.includes('NEW-02')));
  assert(compact.coverage.gaps.every(row => row.reference && row.reason)); assert.equal(compact.coverage.gaps[0].requirementId, undefined);
  const rejected = compactDesignResult(rejectDesign(f.roots, 'login'));
  assert.equal(rejected.status, 'rejected'); assert.match(rejected.summary, /rejected.*edit|edit.*rejected/i); assert.match(rejected.summary, /independent/i);
  const unresolved = compactDesignResult({mode: 'reconciliation-required', outcomes: [{caseId: 'NEW-01', status: 'uncertain'}], execution: 'not-run'});
  assert.match(unresolved.summary, /reconcil/i); assert(!unresolved.summary.startsWith('Prepared'));
});
