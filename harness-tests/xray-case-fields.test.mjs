import test from 'node:test';
import assert from 'node:assert/strict';
import {createXrayAdapter} from '../scripts/lib/integrations/xray.mjs';

const siteUrl = 'https://example.atlassian.net', marker = 'pom-harness-0123456789abcdef';
const field = (fieldId, type, extra = {}) => ({fieldId, name: fieldId, required: false, hasDefaultValue: false, operations: ['set'], schema: {type}, ...extra});
const input = {title: 'Checkout', steps: [{action: 'Buy', expected: 'Order created'}], storyKey: 'DEMO-1', marker};
function fixture({nativeTypes = ['10010'], configuration = {}, fields = []} = {}) {
  const project = {id: '10001', key: 'DEMO', name: 'Demo'}, issueType = {id: '10010', name: 'Renamed Xray Test', subtask: false};
  const state = {fields: {project, issuetype: issueType, summary: 'Original', labels: ['team'], updated: '2026-10-30T00:00:00Z', customfield_10001: 'existing', customfield_10002: {id: 'option-1', value: 'Low'}, customfield_10003: 'preserve'},
    steps: [{id: 'step-1', action: 'Old action', data: '', result: 'Old result'}], schema: [field('summary', 'string', {required: true}), field('labels', 'array', {schema: {type: 'array', items: 'string'}}),
      field('customfield_10001', 'string', {required: true}), field('customfield_10002', 'option', {allowedValues: [{id: 'option-1', value: 'Low'}, {id: 'option-2', value: 'High'}]}), field('customfield_10003', 'string'), ...fields], writes: [], nativeTypes};
  const nativeJira = (key, type = issueType) => ({key, project: {...project, self: siteUrl + '/rest/api/3/project/10001'}, issuetype: type});
  const jira = {configuration: {siteUrl, project: project.key, testManagement: {provider: 'xray', ...configuration}}, projectIdentity: async () => project,
    issue: async key => structuredClone({id: key === 'DEMO-1' ? '10002' : '10003', key, fields: key === 'DEMO-1' ? {project, summary: 'Source story'} : state.fields}),
    list: async route => {
      if (route === 'issue/createmeta/DEMO/issuetypes') return [issueType, {id: '10011', name: 'Ordinary Test', subtask: false}];
      if (route === 'issue/createmeta/DEMO/issuetypes/10010') return structuredClone(state.schema);
      throw new Error('Unexpected list ' + route);
    },
    read: async route => {
      if (route === 'issueLinkType') return {issueLinkTypes: [{id: 'link-1', outward: 'tests', inward: 'is tested by'}]};
      if (route === 'issue/DEMO-2/editmeta') return {fields: Object.fromEntries(state.schema.map(({fieldId, ...value}) => [fieldId, value]))};
      if (route.startsWith('mypermissions?')) return {permissions: {CREATE_ISSUES: {havePermission: true}, EDIT_ISSUES: {havePermission: true}}};
      throw new Error('Unexpected read ' + route);
    }};
  const transport = {query: async (query, variables) => {
    if (query.includes('getTests(')) return {getTests: {start: variables.start, total: state.nativeTypes.length, results: state.nativeTypes.slice(variables.start, variables.start + 100).map((id, index) => ({issueId: String(10003 + variables.start + index), jira: nativeJira('DEMO-' + (2 + variables.start + index), {...issueType, id})}))}};
    if (query.includes('getCoverableIssue')) return {getCoverableIssue: {issueId: '10002', jira: nativeJira('DEMO-1')}};
    if (query.includes('getTest(')) return {getTest: {issueId: '10003', projectId: '10001', jira: nativeJira('DEMO-2'), lastModified: '2026-10-30T00:00:00Z', testType: {name: 'Manual'}, dataset: null, steps: structuredClone(state.steps), preconditions: {total: 0, results: []}}};
    throw new Error('Unexpected query ' + query);
  }};
  const delivery = {write: async (operation, route, body) => {
    state.writes.push({operation, route, body});
    if (operation === 'create-case') {Object.assign(state.fields, body.variables.jira.fields); state.steps = body.variables.steps.map((row, index) => ({id: 'step-' + (index + 1), ...row})); return {createTest: {test: {issueId: '10003', jira: {key: 'DEMO-2'}}}};}
    if (operation === 'update-case') Object.assign(state.fields, body.fields);
    if (operation === 'update-case-step') Object.assign(state.steps.find(step => step.id === body.variables.id), body.variables.step);
    if (operation === 'link-case-story') state.fields.issuelinks = [{id: 'link-instance', type: {id: 'link-1'}, outwardIssue: {key: 'DEMO-1'}}];
    return {};
  }};
  return {state, jira, transport, delivery, adapter: createXrayAdapter({jira, transport})};
}

test('Xray preflight rejects missing required native fields before any write', async () => {
  const {adapter, state} = fixture();
  await assert.rejects(adapter.prepareCase(input), error => error.fieldProblems?.some(problem => problem.field === 'customfield_10001' && problem.code === 'required'));
  assert.equal(state.writes.length, 0);
});

test('Xray discovers renamed native Test type and previews validated custom fields', async () => {
  const {adapter, delivery, state} = fixture({configuration: {caseFields: {customfield_10001: 'default', customfield_10002: {id: 'option-1'}}}});
  const plan = await adapter.prepareCase({...input, nativeFields: {customfield_10001: 'reviewed', customfield_10002: {id: 'option-2'}}});
  assert.equal(plan.fieldSchema.issueTypeId, '10010'); assert.match(plan.fieldSchema.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(plan.fieldSchema.fields.length, 5);
  assert.deepEqual(plan.requests[0].body.variables.jira.fields.issuetype, {id: '10010'});
  assert.deepEqual(plan.nativeFields, {customfield_10001: 'reviewed', customfield_10002: {id: 'option-2'}});
  const id = await adapter.writeCase(plan, delivery); await adapter.verifyCase(plan, id);
  assert.equal(state.fields.customfield_10001, 'reviewed');
  state.fields.customfield_10002 = {id: 'option-1'};
  await assert.rejects(adapter.verifyCase(plan, id), /field.*readback|field.*approved/i);
});

test('Xray empty-project type selection is explicit and mismatches or ambiguous native types block', async () => {
  const values = {customfield_10001: 'value'};
  await assert.rejects(fixture({nativeTypes: []}).adapter.prepareCase({...input, nativeFields: values}), /issue type|issue-type|testIssueTypeId/i);
  const plan = await fixture({nativeTypes: [], configuration: {testIssueTypeId: '10010'}}).adapter.prepareCase({...input, nativeFields: values});
  assert.equal(plan.fieldSchema.issueTypeId, '10010');
  await assert.rejects(fixture({configuration: {testIssueTypeId: '10011'}}).adapter.prepareCase({...input, nativeFields: values}), /mismatch|differs|native.*type/i);
  await assert.rejects(fixture({nativeTypes: ['10010', '10011']}).adapter.prepareCase({...input, nativeFields: values}), /ambiguous|one.*type|multiple/i);
});

test('Xray rejects invalid, read-only, unknown and owned native field values', async () => {
  for (const nativeFields of [{customfield_10001: ''}, {customfield_10001: 42}, {customfield_10001: 'yes', customfield_10002: {id: 'missing'}}, {customfield_10001: 'yes', customfield_99999: 'unknown'}, {customfield_10001: 'yes', summary: 'override'}]) {
    const {adapter, state} = fixture(); await assert.rejects(adapter.prepareCase({...input, nativeFields})); assert.equal(state.writes.length, 0);
  }
  const blocked = fixture(); blocked.state.schema.find(row => row.fieldId === 'customfield_10001').operations = [];
  await assert.rejects(blocked.adapter.prepareCase({...input, nativeFields: {customfield_10001: 'yes'}}), error => error.fieldProblems?.some(row => row.code === 'read-only'));
});

test('Xray refreshes complete field metadata before create and completion', async () => {
  const {adapter, state, delivery} = fixture();
  const plan = await adapter.prepareCase({...input, nativeFields: {customfield_10001: 'value'}});
  state.schema.push(field('customfield_10004', 'string', {required: true}));
  await assert.rejects(adapter.writeCase(plan, delivery), /metadata|schema|approval/i); assert.equal(state.writes.length, 0);
  await assert.rejects(adapter.caseCompletion(plan, 'DEMO-2'), /metadata|schema|approval/i);
});

test('Xray edits preserve unspecified native fields, ignore create defaults and allow optional clear', async () => {
  const {adapter, state, delivery} = fixture({configuration: {caseFields: {customfield_10001: 'create-only'}}});
  const before = await adapter.readCase('DEMO-2');
  const plan = await adapter.prepareCase({...input, before, nativeFields: {customfield_10002: null}});
  assert.deepEqual(plan.nativeFields, {customfield_10002: null});
  assert.equal(plan.requests[0].body.fields.customfield_10001, undefined);
  await adapter.writeCase(plan, delivery); await adapter.verifyCase(plan, before.id);
  assert.equal(state.fields.customfield_10001, 'existing'); assert.equal(state.fields.customfield_10003, 'preserve'); assert.equal(state.fields.customfield_10002, null);
  const current = await adapter.readCase('DEMO-2');
  await assert.rejects(adapter.prepareCase({...input, before: current, nativeFields: {customfield_10001: null}}), error => error.fieldProblems?.some(row => row.code === 'required'));
});

test('Xray partial edit completion skips the acknowledged native field update and rejects unrelated field drift', async () => {
  const {adapter, state, delivery} = fixture(), before = await adapter.readCase('DEMO-2');
  const plan = await adapter.prepareCase({...input, before, nativeFields: {customfield_10001: 'approved'}});
  const first = plan.requests[0]; await delivery.write(first.operation, first.route, first.body);
  const completion = await adapter.caseCompletion(plan, before.id);
  assert.deepEqual(completion.requests.map(row => row.operation), ['update-case-step', 'link-case-story']);
  state.fields.customfield_10001 = 'unrelated';
  await assert.rejects(adapter.caseCompletion(plan, before.id), /intermediate|unrelated|field/i);
  state.fields.customfield_10001 = 'approved'; state.fields.customfield_10003 = 'lost';
  await assert.rejects(adapter.caseCompletion(plan, before.id), /intermediate|unrelated|field/i);
});

test('Xray discovery completes bounded pages and fails an inconsistent native result', async () => {
  const context = fixture({nativeTypes: Array(101).fill('10010')}), starts = [], original = context.transport.query;
  context.transport.query = async (query, variables) => {if (query.includes('getTests(')) starts.push(variables.start); return original(query, variables);};
  await context.adapter.prepareCase({...input, nativeFields: {customfield_10001: 'value'}});
  assert.deepEqual(starts, [0, 100]);
  context.transport.query = async (query, variables) => query.includes('getTests(') ? {getTests: {start: 0, total: 2, results: []}} : original(query, variables);
  await assert.rejects(context.adapter.prepareCase({...input, nativeFields: {customfield_10001: 'value'}}), /discovery did not complete/);
});

test('Xray supplied user fields validate active exact accounts and refresh assignability before mutation', async () => {
  const context = fixture({fields: [field('assignee', 'user'), field('customfield_10004', 'array', {schema: {type: 'array', items: 'user'}})]});
  const original = context.jira.read, lookups = []; let active = true;
  context.jira.read = async route => {
    if (route.startsWith('user/')) {lookups.push(route); return [{accountId: 'assignee-1', active}];}
    if (route.startsWith('user?')) {lookups.push(route); return {accountId: 'reviewer-1', active: true};}
    return original(route);
  };
  const plan = await context.adapter.prepareCase({...input, nativeFields: {customfield_10001: 'value', assignee: {accountId: 'assignee-1'}, customfield_10004: [{accountId: 'reviewer-1'}]}});
  assert.deepEqual(lookups, ['user/assignable/search?project=DEMO&accountId=assignee-1&startAt=0&maxResults=2', 'user?accountId=reviewer-1']);
  active = false;
  await assert.rejects(context.adapter.writeCase(plan, context.delivery), /active|assignable/); assert.equal(context.state.writes.length, 0);
  active = true;
  const before = await context.adapter.readCase('DEMO-2'); lookups.length = 0;
  await context.adapter.prepareCase({...input, before, nativeFields: {assignee: {accountId: 'assignee-1'}}});
  assert.equal(lookups[0], 'user/assignable/search?issueKey=DEMO-2&accountId=assignee-1&startAt=0&maxResults=2');
  context.jira.read = async route => route.startsWith('user?') ? {accountId: 'different-user', active: true} : original(route);
  await assert.rejects(context.adapter.prepareCase({...input, nativeFields: {customfield_10001: 'value', customfield_10004: [{accountId: 'reviewer-1'}]}}), /account|active/);
});

test('Xray accepts required Jira description and protects its approved edit during recovery', async () => {
  const {adapter, state, delivery} = fixture({fields: [field('description', 'string', {required: true})]});
  const description = {version: 1, type: 'doc', content: [{type: 'paragraph', content: [{type: 'text', text: 'Source context'}]}]};
  const created = await adapter.prepareCase({...input, nativeFields: {customfield_10001: 'value', description}});
  await adapter.writeCase(created, delivery); await adapter.verifyCase(created, 'DEMO-2');
  const before = await adapter.readCase('DEMO-2'), changed = {...description, content: [{type: 'paragraph', content: [{type: 'text', text: 'Reviewed context'}]}]};
  const edit = await adapter.prepareCase({...input, before, nativeFields: {description: changed}});
  const first = edit.requests[0]; await delivery.write(first.operation, first.route, first.body);
  assert.equal((await adapter.caseCompletion(edit, before.id)).complete, true);
  state.fields.description = description;
  await assert.rejects(adapter.verifyCase(edit, before.id), /field description/);
});

test('Xray resolution survives create, edit and partial recovery readback', async () => {
  const {adapter, state, delivery} = fixture({fields: [field('resolution', 'resolution', {allowedValues: [{id: '1', name: 'Done'}, {id: '2', name: 'Fixed'}]})]});
  const created = await adapter.prepareCase({...input, nativeFields: {customfield_10001: 'value', resolution: {id: '1'}}});
  await adapter.writeCase(created, delivery);
  const before = await adapter.verifyCase(created, 'DEMO-2');
  assert.equal(before.raw.issue.fields.resolution.id, '1');
  const edit = await adapter.prepareCase({...input, before, nativeFields: {resolution: {id: '2'}}});
  const first = edit.requests[0]; await delivery.write(first.operation, first.route, first.body);
  assert.equal((await adapter.caseCompletion(edit, before.id)).complete, true);
  await adapter.verifyCase(edit, before.id);
  state.fields.resolution = {id: '1'};
  await assert.rejects(adapter.verifyCase(edit, before.id), /field resolution/);
});

test('Xray rejects supplied or defaulted fields excluded from its stable readback snapshot', async () => {
  for (const defaults of [{required: false}, {required: true, hasDefaultValue: true}, {required: true, hasDefaultValue: true, defaultValue: 20}, {required: false, hasDefaultValue: true, defaultValue: 20}]) {
    const {adapter, state} = fixture({fields: [field('workratio', 'integer', defaults)]});
    const nativeFields = {customfield_10001: 'value', ...(defaults.hasDefaultValue ? {} : {workratio: 20})};
    await assert.rejects(adapter.prepareCase({...input, nativeFields}), /readback|retain|unsupported/i);
    assert.equal(state.writes.length, 0);
  }
});

test('Xray verifies exposed creation defaults against the approved metadata value', async () => {
  const {adapter, state, delivery} = fixture();
  Object.assign(state.schema.find(row => row.fieldId === 'customfield_10001'), {hasDefaultValue: true, defaultValue: 'approved-default'});
  const plan = await adapter.prepareCase(input);
  assert.equal(plan.fieldReview.find(row => row.field === 'customfield_10001').defaulted, true);
  await adapter.writeCase(plan, delivery);
  state.fields.customfield_10001 = 'approved-default'; await adapter.verifyCase(plan, 'DEMO-2');
  state.fields.customfield_10001 = 'different-default';
  await assert.rejects(adapter.verifyCase(plan, 'DEMO-2'), /field customfield_10001/);
});
