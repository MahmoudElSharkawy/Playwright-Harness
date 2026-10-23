import test from 'node:test';
import assert from 'node:assert/strict';
import {loadBugSchema, inspectBugFields, allowedFieldValue} from '../scripts/lib/integrations/bug-fields.mjs';
import {validateAdoConfiguration} from '../scripts/lib/integrations/config.mjs';

const configuration = bugs => ({organizationUrl: 'https://ado.example.test/collection', project: 'demo', credentialRef: 'ADO_TEST_CREDENTIAL', bugs});
const title = {referenceName: 'System.Title', name: 'Title', type: 'string', alwaysRequired: true};
function clientFixture({bugs = {}, fields = [title, {referenceName: 'System.Description', name: 'Description', type: 'html'}]} = {}) {
  const calls = [], state = {fields, states: [{name: 'Open', category: 'Proposed'}]};
  async function read(route, mode) {
    calls.push({route, mode});
    if (route.startsWith('wit/workitemtypecategories/')) return {referenceName: 'Microsoft.BugCategory', workItemTypes: [{name: 'Fault'}], defaultWorkItemType: {name: 'Fault'}};
    if (route.includes('/fields?')) return {value: structuredClone(state.fields)};
    if (route.includes('/states?')) return {value: structuredClone(state.states)};
    if (route.startsWith('wit/fields/')) return {referenceName: decodeURIComponent(route.split('/')[2].split('?')[0]), type: 'integer', readOnly: false};
    throw new Error('Unexpected synthetic route');
  }
  return {configuration: configuration(bugs), calls, state, cachedRead: route => read(route, 'cached'), read: route => read(route, 'fresh')};
}

test('bug configuration supports selected work-item type and stable narrative mappings', () => {
  const bugs = {workItemType: 'Customer Defect', fieldMap: {title: 'System.Title', description: 'Custom.Issue', reproSteps: 'Custom.Reproduction', expected: 'Custom.Expected', actual: 'Custom.Actual'}, fields: {'Custom.Component': 'Checkout'}};
  assert.deepEqual(validateAdoConfiguration(configuration(bugs)).bugs, bugs);
  for (const bad of [{workItemType: '../Bug'}, {workItemType: 'x'.repeat(151)}, {fieldMap: {unknown: 'System.Title'}}, {fieldMap: {title: '../title'}}, {fields: {'Custom.Component': Infinity}}, {fields: {'Custom.Component': 'x'.repeat(32769)}}]) assert.throws(() => validateAdoConfiguration(configuration(bad)));
});

test('selected work-item type bypasses category guessing and resolves only supported mappings', async () => {
  const client = clientFixture({bugs: {workItemType: 'Customer Defect', fieldMap: {reproSteps: 'Custom.Reproduction'}}, fields: [title, {referenceName: 'Custom.Reproduction', name: 'Reproduction', type: 'html'}]});
  const schema = await loadBugSchema(client);
  assert.equal(schema.type, 'Customer Defect');
  assert.deepEqual(schema.mappings, {title: 'System.Title', reproSteps: 'Custom.Reproduction'});
  assert(!client.calls.some(call => call.route.includes('workitemtypecategories')));
  assert(client.calls.some(call => call.route.includes('Customer%20Defect/fields')));
  assert.match(schema.fingerprint, /^[a-f0-9]{64}$/);
});

test('category selection uses actual defect type and never invents unsupported Severity/reproduction fields', async () => {
  const client = clientFixture(), schema = await loadBugSchema(client);
  assert.equal(schema.type, 'Fault');
  assert.deepEqual(schema.mappings, {title: 'System.Title', description: 'System.Description'});
  assert(!Object.values(schema.mappings).some(value => value.includes('Severity')));
  await assert.rejects(loadBugSchema(clientFixture({bugs: {fieldMap: {expected: 'Custom.NotPresent'}}})), /mapping|unavailable/i);
});

test('fresh schema bypasses cached reads and fingerprints changed field rules/defaults/mappings', async () => {
  const client = clientFixture(), first = await loadBugSchema(client);
  client.calls.length = 0;
  client.state.fields.push({referenceName: 'Custom.Component', name: 'Component', type: 'string', alwaysRequired: true, allowedValues: ['Store'], defaultValue: 'Store'});
  const second = await loadBugSchema(client, {refresh: true});
  assert(client.calls.every(call => call.mode === 'fresh'));
  assert.notEqual(first.fingerprint, second.fingerprint);
  assert(schemaLimit(second));
  const thirdClient = clientFixture({bugs: {fields: {'System.Title': 'Configured title'}}});
  assert.notEqual(first.fingerprint, (await loadBugSchema(thirdClient)).fingerprint);
});
const schemaLimit = schema => schema.limitations?.includes('Conditional rules, identities and paths require current server-side validation.');

test('missing field type is read from detail without overwriting instance required/allowed/default metadata', async () => {
  const client = clientFixture({fields: [title, {referenceName: 'Custom.Order', name: 'Order', alwaysRequired: true, allowedValues: ['1', '2'], defaultValue: '1'}]});
  const schema = await loadBugSchema(client), spec = schema.fields.find(field => field.referenceName === 'Custom.Order');
  assert.equal(spec.type, 'integer'); assert.equal(spec.alwaysRequired, true); assert.equal(spec.defaultValue, '1');
  assert(client.calls.some(call => call.route.includes('wit/fields/Custom.Order')));
  assert.equal(inspectBugFields(schema, {'System.Title': 'Synthetic defect', 'Custom.Order': 2}).ready, true);
});

test('global read-only and identity restrictions cannot be relaxed by instance metadata', async () => {
  const client = clientFixture({fields: [title, {referenceName: 'Custom.Generated', name: 'Generated', readOnly: false, isIdentity: false}]});
  const read = client.read;
  client.cachedRead = async route => route.startsWith('wit/fields/') ? {referenceName: 'Custom.Generated', type: 'string', readOnly: true, isIdentity: true} : read(route);
  const schema = await loadBugSchema(client), field = schema.fields.find(item => item.referenceName === 'Custom.Generated');
  assert.equal(field.readOnly, true); assert.equal(field.isIdentity, true);
  assert.equal(inspectBugFields(schema, {'System.Title': 'Synthetic defect', 'Custom.Generated': 'Alex'}).ready, false);
});

test('incomplete, duplicate, read-only mapped or mismatched field metadata is rejected', async () => {
  for (const fields of [[], [title, title], [title, {referenceName: '../Bad', type: 'string'}], [title, {referenceName: 'Custom.Text', type: 'unsupported'}]]) await assert.rejects(loadBugSchema(clientFixture({fields})));
  await assert.rejects(loadBugSchema(clientFixture({fields: [{...title, readOnly: true}]})), /mapping|read-only/i);
  const client = clientFixture({fields: [{referenceName: 'System.Title', name: 'Title'}]}); client.read = client.cachedRead = async route => route.includes('/fields?') ? {value: client.state.fields} : route.includes('/states?') ? {value: []} : route.includes('workitemtypecategories') ? {referenceName: 'Microsoft.BugCategory', workItemTypes: [{name: 'Fault'}]} : {referenceName: 'Custom.Wrong', type: 'string'};
  await assert.rejects(loadBugSchema(client), /identity|incomplete/i);
});

test('review includes required fields from any namespace and supported defaults without demanding server-managed fields', () => {
  const schema = {fields: [title, {referenceName: 'Acme.Component', name: 'Component', type: 'string', alwaysRequired: true}, {referenceName: 'Custom.Channel', type: 'string', alwaysRequired: true, defaultValue: 'Web'}, {referenceName: 'System.Id', type: 'integer', alwaysRequired: true}, {referenceName: 'System.CreatedDate', type: 'dateTime', alwaysRequired: true, readOnly: true}]};
  const result = inspectBugFields(schema, {'System.Title': 'Synthetic defect'});
  assert.equal(result.ready, false); assert.deepEqual(result.problems, [{field: 'Acme.Component', code: 'required'}]);
  assert(result.review.some(row => row.field === 'Acme.Component' && row.required && !Object.hasOwn(row, 'value')));
  assert(result.review.some(row => row.field === 'Custom.Channel' && row.defaultValue === 'Web'));
  assert(result.review.some(row => row.field === 'System.CreatedDate' && row.readOnly));
});

test('type checks run without picklists; invalid required defaults and empty values stay unresolved', () => {
  const schema = {fields: [title, {referenceName: 'Custom.Count', type: 'integer'}, {referenceName: 'Custom.Flag', type: 'boolean'}, {referenceName: 'Custom.Date', type: 'dateTime'}, {referenceName: 'Custom.Required', type: 'integer', alwaysRequired: true, defaultValue: 'bad'}]};
  const result = inspectBugFields(schema, {'System.Title': '  ', 'Custom.Count': 1.2, 'Custom.Flag': 'perhaps', 'Custom.Date': 'yesterday'});
  for (const field of ['System.Title', 'Custom.Count', 'Custom.Flag', 'Custom.Date', 'Custom.Required']) assert(result.problems.some(problem => problem.field === field));
  assert.equal(result.ready, false);
});

test('unknown and read-only inputs are rejected without exposing supplied values', () => {
  const schema = {fields: [title, {referenceName: 'Custom.Generated', type: 'string', readOnly: true}]};
  const result = inspectBugFields(schema, {'System.Title': 'Synthetic defect', 'Custom.Unknown': 'private observation', 'Custom.Generated': 'private observation'});
  assert.deepEqual(result.problems, [{field: 'Custom.Unknown', code: 'unavailable'}, {field: 'Custom.Generated', code: 'read-only'}]);
  assert(!JSON.stringify(result.problems).includes('private observation'));
});

test('numeric picklists preserve compatible numeric/string choices while identities require an unambiguous match', () => {
  assert(allowedFieldValue({type: 'integer', allowedValues: ['1', '2']}, 2));
  assert(!allowedFieldValue({type: 'integer', allowedValues: [1, 2]}, '2.1'));
  assert(!allowedFieldValue({type: 'integer', allowedValues: [0]}, ''));
  assert(allowedFieldValue({type: 'boolean', allowedValues: [false]}, 'false'));
  assert(allowedFieldValue({type: 'identity', allowedValues: [{id: 'one', displayName: 'Alex'}]}, 'one'));
  assert(!allowedFieldValue({type: 'identity', allowedValues: [{id: 'one', displayName: 'Alex'}, {id: 'two', displayName: 'Alex'}]}, 'Alex'));
});

test('schema explicitly retains conditional-rule uncertainty and does not perform validation writes', async () => {
  const client = clientFixture({fields: [title, {referenceName: 'Custom.Component', type: 'string', alwaysRequired: true, allowedValues: ['Web']}]});
  const schema = await loadBugSchema(client);
  assert(schemaLimit(schema));
  assert.equal(inspectBugFields(schema, {'System.Title': 'Synthetic defect', 'Custom.Component': 'Web'}).ready, true);
  assert(client.calls.every(call => !call.route.includes('validateOnly') && !call.route.includes('wit/workitems/')));
});
