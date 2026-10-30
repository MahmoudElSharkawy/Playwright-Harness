import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fixture} from './fixtures/execution-core.mjs';
import {retainAssessment} from './fixtures/design-review.mjs';
import {fingerprint} from '../scripts/lib/execution-core/data.mjs';
import {createDelivery} from '../scripts/lib/integrations/delivery.mjs';
import {prepareDesign, saveDesign, assessDesign, designHandoff, readDesign} from '../scripts/lib/test-case-design/index.mjs';
import {previewDesign, publishDesign, reconcileDesign} from '../scripts/lib/test-case-design/delivery.mjs';
import {updateInventory} from '../scripts/lib/requirements/index.mjs';
import {createTestManagement} from '../scripts/lib/integrations/test-management.mjs';
import {PluginError} from '../scripts/lib/integrations/plugin-client.mjs';
import {requireFreshReferences} from '../scripts/lib/test-case-design/references.mjs';
import {preparationSteps, nativeDesignSteps, renderDesign, validateDesign} from '../scripts/lib/test-case-design/review.mjs';
import {xrayIssueType, xrayMetadataList, zephyrCaseSchema} from './fixtures/native-case-fields.mjs';

const adf = text => ({type: 'doc', version: 1, content: [{type: 'paragraph', content: [{type: 'text', text}]}]});
async function jiraDesign(t, provider = 'none', {existing = false, localCaseSource} = {}) {
  const {roots} = fixture(t), items = new Map(), history = [], control = {writes: 0, lose: false, hide: false, afterWrite: null};
  const story = {id: '100', key: 'DEMO-1', fields: {project: {id: '10', key: 'DEMO'}, updated: '2026-10-29T08:00:00Z', summary: 'Save name', description: '', customfield_10001: adf('Saving a display name shows confirmation.'), attachment: []}};
  const client = {configuration: {siteUrl: 'https://example.atlassian.net', project: 'DEMO', fields: {acceptanceCriteria: 'customfield_10001'}, testManagement: {provider, ...(provider === 'zephyr-scale' ? {caseFieldSchema: zephyrCaseSchema()} : {})}},
    async projectIdentity() {return {id: '10', key: 'DEMO', name: 'Demo'};}, async issue(key) {assert.equal(key, story.key); return structuredClone(story);}, async list(route) {return route.endsWith('/changelog') ? structuredClone(history) : [];}};
  function native(id, desired) {const value = {provider, siteUrl: client.configuration.siteUrl, project: 'DEMO', id, nativeId: '300', title: desired.title, steps: desired.steps.map((row, index) => ({id: String(index + 1), data: '', ...row})), labels: desired.labels, externalReferences: [{system: provider, id: `${client.configuration.siteUrl}/browse/${id}`}], raw: {}}; value.revision = value.fingerprint = fingerprint(value); return value;}
  const testManagement = {provider, capabilities: {remoteCases: provider !== 'none'}, async storyCases() {return [...items.values()].map(item => structuredClone(item));}, async readCase(id) {assert(items.has(id)); return structuredClone(items.get(id));},
    async prepareCase(input) {if (input.before) assert.equal(items.get(input.before.id).fingerprint, input.before.fingerprint); const desired = {title: input.title, steps: input.steps.map(row => ({data: '', ...row})), labels: [...(input.labels ?? []), input.marker]}; return {kind: 'case', provider, ...(input.before ? {id: input.before.id, beforeFingerprint: input.before.fingerprint} : {}), marker: input.marker, desired, storyKey: input.storyKey, ...(provider === 'xray' ? {linkType: '100'} : {}), requests: [{operation: input.before ? 'update-case' : 'create-case', channel: 'plugin', route: 'cases', method: 'POST', body: desired}]};},
    async writeCase(plan, delivery, options) {const result = await delivery.write(plan.id ? 'update-case' : 'create-case', 'plugin/cases', plan.desired, {method: 'POST', onIdentity: options?.onIdentity}); return result.key;},
    async verifyCase(plan, id) {const value = await this.readCase(id); assert.equal(fingerprint({title: value.title, steps: value.steps.map(({action, expected, data}) => ({action, expected, data}))}), fingerprint({title: plan.desired.title, steps: plan.desired.steps})); assert(value.labels.includes(plan.marker)); return value;},
    async findCase(marker) {return control.hide ? null : [...items.values()].find(item => item.labels.includes(marker)) ?? null;},
    delivery(kind, execute, sourceFingerprint) {return createDelivery({roots, provider, kind, execute, sourceFingerprint, base: client.configuration.siteUrl + '/' + provider, destination() {}, identityFor(operation, value) {return {externalId: value.key};}, async send(route, options) {options.beforeDispatch(); control.writes++; const id = provider === 'xray' ? 'DEMO-300' : 'DEMO-T300'; items.set(id, native(id, options.body)); control.afterWrite?.(); if (control.lose) throw new Error('connection lost'); return {key: id};}});}};
  if (existing) items.set(provider === 'xray' ? 'DEMO-300' : 'DEMO-T300', native(provider === 'xray' ? 'DEMO-300' : 'DEMO-T300', {title: 'Old case', steps: [{action: 'Old action', expected: 'Old expected'}], labels: ['team-owned']}));
  if (localCaseSource) writeFileSync(join(roots.projectRoot, 'local-cases.json'), JSON.stringify(localCaseSource));
  const options = {client, testManagement}, selection = {version: 1, analysisId: 'names', ...(localCaseSource ? {localCaseSource: 'local-cases.json'} : {})};
  let state = await prepareDesign(roots, 'names', {...selection, request: {version: 1, project: 'demo', application: 'names', provider: 'jira', storyId: 'DEMO-1', sources: []}}, options);
  const entry = state.requirements.inventory.find(row => row.kind === 'criterion'), part = state.evidence.requirements.parts.find(row => row.id === entry.partId);
  updateInventory(roots, 'names', {version: 1, snapshot: state.requirements.snapshot, changes: [{id: entry.id, disposition: 'accepted', evidence: [{kind: 'source', partId: part.id, revision: part.revision, quote: part.text}]}]});
  state = await prepareDesign(roots, 'names', selection, options);
  const caseId = existing ? [...items.keys()][0] : localCaseSource ? localCaseSource.scenarios[0].id : 'NEW-name';
  const proposal = {version: 1, author: 'designer', source: state.source, cases: [{id: caseId, proposedAction: caseId.startsWith('NEW-') ? 'Create' : 'Update', title: 'Save a display name', prerequisites: 'An editable profile is open.', testData: 'Name: Alex', coverageReferences: [{requirementId: entry.id, label: 'Save confirmation'}], testType: 'Functional', scenarioType: 'Positive', steps: [{action: 'Enter Alex and save the profile.', expected: 'The profile shows Alex and a confirmation.'}]}], mappings: [{caseId, requirementId: entry.id, checks: [{step: 1, expected: 'The profile shows Alex and a confirmation.', data: 'Name: Alex'}]}], preparations: [{caseId, expected: 'The editable profile is ready.'}]};
  state = saveDesign(roots, 'names', proposal);
  assessDesign(roots, 'names', retainAssessment(roots, state, {version: 1, proposal: state.proposal, reviewer: 'reviewer', cases: [{id: caseId, verdict: 'pass', reason: 'The display name and confirmation are observable.'}], requirements: [{id: entry.id, verdict: 'covered', reason: 'Saving displays confirmation.', caseIds: [caseId]}]}));
  return {roots, options, story, client, testManagement, items, history, control, proposal, caseId};
}

test('Jira without a plugin retains reviewed local cases and story provenance without remote case calls', async t => {
  const f = await jiraDesign(t); f.testManagement.storyCases = () => {throw new Error('No native capability');};
  const preview = await previewDesign(f.roots, 'names', f.options);
  assert.equal(preview.destination.provider, 'local');
  const result = await publishDesign(f.roots, 'names', {...f.options, approval: preview.fingerprint}); assert.equal(result.mode, 'completed'); assert.equal(f.control.writes, 0);
  const handoff = await designHandoff(f.roots, 'names', f.options);
  assert.deepEqual(handoff.source.scenarios[0].externalReferences, [{system: 'jira', id: 'https://example.atlassian.net/browse/DEMO-1'}]);
  assert.equal(handoff.execution, 'not-run'); assert.equal(handoff.automation, 'not-generated');
});

for (const provider of ['xray', 'zephyr-scale']) test(`${provider} uses shared approval, verified publishing and site-qualified handoff`, async t => {
  const f = await jiraDesign(t, provider), preview = await previewDesign(f.roots, 'names', f.options);
  assert.equal(f.control.writes, 0); assert.equal(preview.destination.testManagement, provider);
  await assert.rejects(publishDesign(f.roots, 'names', {...f.options, approval: 'bad'}));
  const result = await publishDesign(f.roots, 'names', {...f.options, approval: preview.fingerprint}); assert.equal(result.mode, 'completed'); assert.equal(f.control.writes, 1);
  const repeated = await publishDesign(f.roots, 'names', {...f.options, approval: preview.fingerprint}); assert.equal(repeated.mode, 'completed'); assert.equal(f.control.writes, 1);
  const handoff = await designHandoff(f.roots, 'names', f.options); assert(handoff.source.scenarios[0].externalReferences.some(ref => ref.system === provider && ref.id.startsWith(f.client.configuration.siteUrl)));
});

test('uncertain Jira creation only recovers a unique remote operation marker and never blindly retries', async t => {
  const f = await jiraDesign(t, 'xray'), preview = await previewDesign(f.roots, 'names', f.options); f.control.lose = true;
  assert.equal((await publishDesign(f.roots, 'names', {...f.options, approval: preview.fingerprint})).mode, 'reconciliation-required');
  f.control.hide = true; assert.equal((await reconcileDesign(f.roots, 'names', f.options)).mode, 'reconciliation-required');
  await publishDesign(f.roots, 'names', {...f.options, approval: preview.fingerprint}); assert.equal(f.control.writes, 1);
  f.control.hide = false; assert.equal((await reconcileDesign(f.roots, 'names', f.options)).mode, 'completed'); assert.equal(f.control.writes, 1);
});

test('opaque native case IDs update through the same proposal and stale cases invalidate approval', async t => {
  const f = await jiraDesign(t, 'zephyr-scale', {existing: true}), preview = await previewDesign(f.roots, 'names', f.options);
  assert.equal(readDesign(f.roots, 'names').draft.cases[0].id, 'DEMO-T300');
  f.items.get('DEMO-T300').fingerprint = 'changed';
  await assert.rejects(publishDesign(f.roots, 'names', {...f.options, approval: preview.fingerprint}), /changed|equal/); assert.equal(f.control.writes, 0);
});

test('Jira no-plugin design can select existing local cases without interpreting their IDs as native cases', async t => {
  const localCaseSource = {version: 1, id: 'saved', title: 'Saved local cases', scenarios: [{id: 'LOCAL-name', title: 'Old local case', steps: [{action: 'Save old name', expected: ['Old result']}]}]};
  const f = await jiraDesign(t, 'none', {localCaseSource});
  assert.equal(readDesign(f.roots, 'names').evidence.existing[0].provider, 'local');
  const handoff = await designHandoff(f.roots, 'names', f.options); assert.equal(handoff.source.scenarios[0].id, 'LOCAL-name'); assert.equal(f.control.writes, 0);
});

for (const existing of [false, true]) test(`verified owned Jira ${existing ? 'existing' : 'new'} test links preserve handoff freshness and record actual updated identity`, async t => {
  const f = await jiraDesign(t, 'xray', {existing}), preview = await previewDesign(f.roots, 'names', f.options);
  f.control.afterWrite = () => {f.story.fields.updated = '2026-10-30T09:00:00Z'; f.story.fields.issuelinks = [{id: '900', type: {id: '100', name: 'Tests'}, inwardIssue: {id: '300', key: 'DEMO-300'}}]; f.history.push({id: '901', created: f.story.fields.updated, items: [{field: 'Link', from: null, fromString: null, to: '300', toString: 'This issue is tested by DEMO-300'}]});};
  assert.equal((await publishDesign(f.roots, 'names', {...f.options, approval: preview.fingerprint})).mode, 'completed');
  const handoff = await designHandoff(f.roots, 'names', f.options); assert.equal(handoff.sourceVerification.story.updated, f.story.fields.updated);
  f.story.fields.status = {id: '2', name: 'Changed'}; await assert.rejects(designHandoff(f.roots, 'names', f.options), /changed/);
});

for (const interruption of ['none', 'lost-create', 'rejected-steps']) test(`real Zephyr shared design completes ordered steps and links with ${interruption}`, async t => {
  const f = await jiraDesign(t, 'zephyr-scale'), cases = new Map(), steps = [], links = [], writes = [];
  let rejectSteps = interruption === 'rejected-steps';
  const transport = {base: 'https://eu.api.zephyrscale.smartbear.com/v2/', destination: route => `https://eu.api.zephyrscale.smartbear.com/v2/${route}`,
    async read(route) {if (route === 'projects/DEMO') return {id: 37, jiraProjectId: 10, key: 'DEMO', enabled: true}; if (route.endsWith('/links')) return {issues: structuredClone(links)}; if (route === 'testcases/DEMO-T300') return structuredClone(cases.get('DEMO-T300')); throw new Error(`Unexpected read ${route}`);},
    async list(route) {if (route.startsWith('testcases?')) return [...cases.values()]; if (route.endsWith('/attachments')) return []; if (route.endsWith('/teststeps')) return structuredClone(steps); throw new Error(`Unexpected list ${route}`);},
    async request(route, options) {assert.equal(options.execute, true); options.beforeDispatch(); writes.push(route); if (route === 'testcases') {cases.set('DEMO-T300', {id: 300, key: 'DEMO-T300', project: {id: 37}, name: options.body.name, labels: options.body.labels}); if (interruption === 'lost-create') throw Error('Creation accepted; response lost'); return {key: 'DEMO-T300'};} if (route.endsWith('/teststeps')) {if (rejectSteps) {rejectSteps = false; throw new PluginError('zephyr-scale', 'permission-denied', 403);} steps.push(...options.body.items.map((row, i) => ({id: i + 1, inline: row.inline}))); return {};} if (route.endsWith('/links/issues')) {links.push({issueId: options.body.issueId}); return {};} throw new Error(`Unexpected write ${route}`);}};
  f.options.testManagement = createTestManagement({jira: f.client, roots: f.roots, transport});
  const preview = await previewDesign(f.roots, 'names', f.options); let result = await publishDesign(f.roots, 'names', {...f.options, approval: preview.fingerprint});
  if (interruption !== 'none') {
    assert.equal(result.mode, 'reconciliation-required'); const attempts = writes.length;
    assert.equal((await publishDesign(f.roots, 'names', {...f.options, approval: preview.fingerprint})).mode, 'reconciliation-required'); assert.equal(writes.length, attempts);
    assert.equal((await reconcileDesign(f.roots, 'names', f.options)).mode, 'reconciliation-required'); assert.equal(writes.length, attempts);
    result = await reconcileDesign(f.roots, 'names', {...f.options, execute: true, approval: preview.fingerprint});
  }
  assert.equal(result.mode, 'completed'); assert.deepEqual(writes, ['testcases', ...(interruption === 'rejected-steps' ? ['testcases/DEMO-T300/teststeps'] : []), 'testcases/DEMO-T300/teststeps', 'testcases/DEMO-T300/links/issues']);
  const handoff = await designHandoff(f.roots, 'names', f.options); assert.equal(handoff.source.scenarios[0].steps.length, steps.length);
  assert.equal((await reconcileDesign(f.roots, 'names', f.options)).mode, 'completed'); assert.equal(writes.filter(route => route === 'testcases').length, 1);
});

test('native reuse preserves captured per-step data in preview and local handoff', async t => {
  const f = await jiraDesign(t, 'zephyr-scale', {existing: true}), previous = readDesign(f.roots, 'names').review;
  const item = f.items.get(f.caseId); item.title = f.proposal.cases[0].title;
  item.steps = [...preparationSteps(f.proposal.cases[0], f.proposal.preparations[0]), ...f.proposal.cases[0].steps].map((step, index) => ({...step, id: String(index + 1), data: index ? 'Native customer dataset' : ''}));
  item.labels = ['Functional', 'Positive']; item.fingerprint = item.revision = fingerprint(item);
  let state = await prepareDesign(f.roots, 'names', {version: 1, analysisId: 'names'}, f.options);
  const proposal = structuredClone(f.proposal); proposal.source = state.source; proposal.cases[0].proposedAction = 'Reuse unchanged';
  state = saveDesign(f.roots, 'names', proposal); assessDesign(f.roots, 'names', retainAssessment(f.roots, state, {...previous, proposal: state.proposal}));
  const preview = await previewDesign(f.roots, 'names', f.options); assert.equal(preview.operations[0].desired.steps[1].data, 'Native customer dataset');
  const handoff = await designHandoff(f.roots, 'names', f.options); assert.match(handoff.source.scenarios[0].steps[1].action, /Native customer dataset/);
  assert.throws(() => nativeDesignSteps([{action: 'Changed', expected: 'Changed'}], {steps: [{action: 'Old', expected: 'Old', data: 'Keep'}]}), /explicit reviewed data/);
  assert.equal(nativeDesignSteps([{action: 'Changed', expected: 'Changed', data: ''}], {steps: [{action: 'Old', expected: 'Old', data: 'Keep'}]})[0].data, '');
});

test('real Xray adapter retains native key and timestamp while the shared receipt uses a safe content fingerprint', async t => {
  const f = await jiraDesign(t, 'xray'); let native, issue; const writes = [];
  f.client.configuration.testManagement.testIssueTypeId = xrayIssueType.id;
  const storyRead = f.client.issue;
  const originalList = f.client.list;
  f.client.list = async route => route.startsWith('issue/createmeta/') ? xrayMetadataList(route) : originalList(route);
  f.client.issue = async key => key === 'DEMO-1' ? storyRead(key) : structuredClone(issue);
  f.client.read = async route => {if (route.startsWith('mypermissions?')) return {permissions: {CREATE_ISSUES: {havePermission: true}}}; assert.equal(route, 'issueLinkType'); return {issueLinkTypes: [{id: '100', outward: 'tests', inward: 'is tested by'}]};};
  f.client.request = async (route, options) => {assert.equal(route, 'issueLink'); options.beforeDispatch(); writes.push(route); issue.fields.issuelinks = [{id: '900', type: {id: '100'}, outwardIssue: {id: '100', key: 'DEMO-1'}}]; return {};};
  const project = {id: '10', key: 'DEMO', self: `${f.client.configuration.siteUrl}/rest/api/3/project/10`};
  const transport = {destination: route => `https://xray.cloud.getxray.app/api/v2/${route}`, async query(query) {if (query.includes('getTests(')) return {getTests: {start: 0, total: native ? 1 : 0, results: native ? [{issueId: native.issueId, jira: native.jira}] : []}}; return query.includes('getCoverableIssue') ? {getCoverableIssue: {issueId: '100', jira: {key: 'DEMO-1', project}}} : {getTest: structuredClone(native)};}, async request(route, options) {
    options.beforeDispatch(); writes.push(route); const value = options.body.variables;
    issue = {id: '300', key: 'DEMO-300', fields: {project: {id: '10', key: 'DEMO'}, issuetype: xrayIssueType, summary: value.jira.fields.summary, labels: value.jira.fields.labels, updated: '2026-10-30T12:00:00+02:00'}};
    native = {issueId: '300', projectId: '10', jira: {key: 'DEMO-300', project, issuetype: xrayIssueType}, lastModified: '2026-10-30T12:00:00+02:00', testType: {name: 'Manual'}, dataset: null, steps: value.steps.map((step, i) => ({id: 'step-' + i, ...step, attachments: [], customFields: []})), preconditions: {total: 0, results: []}};
    return {createTest: {test: {issueId: '300', jira: {key: 'DEMO-300'}}}};
  }};
  f.options.testManagement = createTestManagement({jira: f.client, roots: f.roots, transport});
  const preview = await previewDesign(f.roots, 'names', f.options), result = await publishDesign(f.roots, 'names', {...f.options, approval: preview.fingerprint});
  assert.equal(result.mode, 'completed'); assert.equal(result.outcomes[0].externalId, 'DEMO-300'); assert.equal(result.outcomes[0].revision, native.lastModified); assert.deepEqual(writes, ['graphql', 'issueLink']);
});

test('Jira reference capture uses selected-site issue keys, bounded native reads and content freshness', async t => {
  const f = await jiraDesign(t), calls = [], reference = {id: '200', key: 'DEMO-2', fields: {project: {id: '10', key: 'DEMO'}, updated: '2026-10-30T08:00:00Z', summary: 'Name policy', description: adf('Names must contain at most 80 characters.'), attachment: []}};
  f.story.fields.customfield_10001 = {type: 'doc', version: 1, content: [{type: 'paragraph', content: [{type: 'text', text: 'Apply DEMO-2.', marks: [{type: 'link', attrs: {href: f.client.configuration.siteUrl + '/browse/DEMO-2'}}]}, {type: 'text', text: ' Untrusted https://example-other.atlassian.net/browse/DEMO-3.'}]}]};
  f.client.issue = async key => {calls.push(key); assert(['DEMO-1', 'DEMO-2'].includes(key)); return structuredClone(key === 'DEMO-1' ? f.story : reference);};
  const input = {version: 1, analysisId: 'references', request: {version: 1, project: 'demo', application: 'names', provider: 'jira', storyId: 'DEMO-1', sources: []}};
  let state = await prepareDesign(f.roots, 'references', input, f.options), found = state.evidence.references.items.find(row => row.issueKey === 'DEMO-2');
  assert(found); assert.equal(found.source.issueKey, 'DEMO-2'); assert.equal(found.workItemId, undefined); assert.equal(state.evidence.references.reads, 1); assert.equal(calls.filter(key => key === 'DEMO-2').length, 1);
  const decision = {id: found.id, classification: 'supporting', requirementIds: found.requirementIds, reason: 'Useful selected policy context.', rules: [{location: 'description', quote: 'Names must contain at most 80 characters.'}]};
  state = await prepareDesign(f.roots, 'references', {...input, references: [decision]}, f.options);
  await requireFreshReferences(f.roots, state, f.options);
  reference.fields.description = adf('Names must contain at most 40 characters.');
  await assert.rejects(requireFreshReferences(f.roots, state, f.options), /Referenced source DEMO-2 changed/);
});

test('local handoff NEW identifiers can be reused unchanged with a fresh shared review', async t => {
  const f = await jiraDesign(t), handoff = await designHandoff(f.roots, 'names', f.options);
  let state = await prepareDesign(f.roots, 'reuse', {version: 1, analysisId: 'names', localCaseSource: handoff.path}, f.options);
  const proposal = structuredClone(f.proposal); proposal.source = state.source; proposal.cases[0].proposedAction = 'Reuse unchanged';
  state = saveDesign(f.roots, 'reuse', proposal);
  const review = structuredClone(readDesign(f.roots, 'names').review); review.proposal = state.proposal;
  assessDesign(f.roots, 'reuse', retainAssessment(f.roots, state, review));
  const preview = await previewDesign(f.roots, 'reuse', f.options), result = await publishDesign(f.roots, 'reuse', {...f.options, approval: preview.fingerprint});
  assert.equal(result.outcomes[0].status, 'unchanged'); assert.equal(f.control.writes, 0);
});

for (const provider of ['xray', 'zephyr-scale']) test(`${provider} native fields stay in the shared reviewed proposal and reach its adapter`, async t => {
  const f = await jiraDesign(t, provider), original = readDesign(f.roots, 'names'), proposal = structuredClone(f.proposal);
  const nativeFields = provider === 'xray' ? {customfield_12345: {id: '12'}} : {Risk: 'High'};
  proposal.head = original.head; proposal.cases[0].nativeFields = nativeFields;
  const state = saveDesign(f.roots, 'names', proposal);
  assert.notEqual(state.proposal, original.proposal);
  assert.deepEqual(state.draft.cases[0].nativeFields, nativeFields);
  const rendered = renderDesign(state.draft).markdown;
  assert(rendered.includes(provider === 'xray' ? 'customfield\\_12345' : 'Risk')); assert(rendered.includes(provider === 'xray' ? '12' : 'High')); assert.match(rendered, /Native fields/);
  assessDesign(f.roots, 'names', retainAssessment(f.roots, state, {...original.review, proposal: state.proposal}));
  const prepare = f.testManagement.prepareCase; let received;
  f.testManagement.prepareCase = async input => {received = input; return prepare.call(f.testManagement, input);};
  await previewDesign(f.roots, 'names', f.options);
  assert.deepEqual(received.nativeFields, nativeFields); assert.equal(f.control.writes, 0);
});

for (const changed of ['schema', 'defaults']) test(`shared native publication blocks changed ${changed} before any write`, async t => {
  const f = await jiraDesign(t, 'xray'), prepare = f.testManagement.prepareCase;
  let schema = {required: false}; f.client.configuration.testManagement.caseFields = {customfield_12345: 'Portal'};
  f.testManagement.prepareCase = async input => ({...await prepare.call(f.testManagement, input), fieldSchema: structuredClone(schema), nativeFields: structuredClone(f.client.configuration.testManagement.caseFields)});
  const preview = await previewDesign(f.roots, 'names', f.options);
  if (changed === 'schema') schema = {required: true}; else f.client.configuration.testManagement.caseFields.customfield_12345 = 'API';
  await assert.rejects(publishDesign(f.roots, 'names', {...f.options, approval: preview.fingerprint}), /Native request changed/);
  assert.equal(f.control.writes, 0);
});

test('edited native field values invalidate the previous shared proposal approval', async t => {
  const f = await jiraDesign(t, 'xray'), preview = await previewDesign(f.roots, 'names', f.options), proposal = structuredClone(f.proposal);
  proposal.head = readDesign(f.roots, 'names').head; proposal.cases[0].nativeFields = {customfield_12345: 'Portal'}; saveDesign(f.roots, 'names', proposal);
  await assert.rejects(publishDesign(f.roots, 'names', {...f.options, approval: preview.fingerprint}), /Proposal|changed|approval/);
  assert.equal(f.control.writes, 0);
});

test('native field inputs cannot silently enter Azure, local or unchanged-reuse proposals', async t => {
  const f = await jiraDesign(t, 'xray'), captured = readDesign(f.roots, 'names'), proposal = structuredClone(f.proposal);
  proposal.cases[0].nativeFields = {customfield_12345: 'Portal'};
  for (const origin of [{provider: 'ado'}, {provider: 'jira', testManagement: 'none'}, undefined]) {
    const state = structuredClone(captured); state.evidence.requirements.origin = origin;
    assert.throws(() => validateDesign(proposal, state, state.requirements), /Native|native|plugin/);
  }
  const existing = await jiraDesign(t, 'xray', {existing: true}), reuse = structuredClone(existing.proposal);
  reuse.head = readDesign(existing.roots, 'names').head; reuse.cases[0].proposedAction = 'Reuse unchanged'; reuse.cases[0].nativeFields = {customfield_12345: 'Portal'};
  assert.throws(() => saveDesign(existing.roots, 'names', reuse), /Native|native|unchanged/);
});
