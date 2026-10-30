import test from 'node:test';
import assert from 'node:assert/strict';
import {createZephyrScaleAdapter} from '../scripts/lib/integrations/zephyr-scale.mjs';
import {validateZephyrCaseFieldSchema} from '../scripts/lib/integrations/zephyr-fields.mjs';

const siteUrl = 'https://example.atlassian.net', marker = 'pom-harness-0123456789abcdef';
const definitions = [
  {name: 'Risk', type: 'Select List (Single Choice)', required: true, allowedValues: ['High', 'Low']},
  {name: 'Owner note', type: 'Text Field (Multi-Line)', required: false},
  {name: 'Enabled', type: 'Checkbox', required: true},
  {name: 'Build', type: 'Number', required: true}
];
function fixture({schema = true, fields = definitions, defaults = {Risk: 'High', Enabled: false, Build: 0}, existing = {Risk: 'Low', 'Owner note': 'Keep this', Enabled: false, Build: 2}, requiredStepFields = []} = {}) {
  const configuration = {siteUrl, project: 'DEMO', testManagement: {provider: 'zephyr-scale', region: 'eu', caseFields: structuredClone(defaults),
    ...(schema ? {caseFieldSchema: {siteUrl, project: 'DEMO', reviewedAt: '2026-10-30T12:00:00.000Z', fields: structuredClone(fields), requiredStepFields}} : {})}};
  const raw = {id: 25, key: 'DEMO-T25', name: 'Buy', objective: 'Keep objective', precondition: 'Keep preparation', project: {id: 37}, priority: {id: 2}, status: {id: 1}, labels: ['team'], customFields: structuredClone(existing)};
  const steps = [{id: 10, inline: {description: 'Buy', testData: '', expectedResult: 'Order created', customFields: {}}}], writes = [];
  const users = new Map(), userReads = [];
  const jira = {configuration, projectIdentity: async () => ({id: '10001', key: 'DEMO'}), issue: async key => ({id: '10002', key}), read: async route => {
    assert.ok(route.startsWith('user?accountId=')); const accountId = decodeURIComponent(route.slice('user?accountId='.length)); userReads.push(accountId);
    return users.get(accountId) ?? {accountId, active: true};
  }};
  const transport = {
    read: async route => route.startsWith('projects/') ? {id: 37, jiraProjectId: 10001, key: 'DEMO', enabled: true} : route.endsWith('/links') ? {issues: []} : structuredClone(raw),
    list: async route => route.endsWith('/attachments') ? [] : structuredClone(steps)
  };
  const delivery = {write: async (operation, route, body) => {
    writes.push({operation, route, body: structuredClone(body)});
    if (operation === 'create-case') Object.assign(raw, {name: body.name, labels: body.labels, customFields: structuredClone(body.customFields ?? {})});
    else if (operation === 'update-case' || operation === 'update-automation') Object.assign(raw, structuredClone(body));
    else if (operation === 'write-case-steps') {
      const next = body.items.map((row, index) => ({id: 50 + index, inline: structuredClone(row.inline)}));
      if (body.mode === 'OVERWRITE') steps.splice(0, steps.length, ...next); else steps.push(...next);
    }
    return {key: 'DEMO-T25'};
  }};
  const adapter = createZephyrScaleAdapter({jira, transport});
  const input = {title: 'Buy', steps: [{action: 'Buy', expected: 'Order created'}], marker};
  return {adapter, configuration, raw, steps, writes, delivery, input, users, userReads};
}

test('Zephyr requires a reviewed site/project-bound schema before case or automation mutations', async () => {
  const missing = fixture({schema: false});
  await assert.rejects(missing.adapter.prepareCase(missing.input), /schema|reviewed/i);
  await assert.rejects(missing.adapter.prepareAutomation({before: await missing.adapter.readCase('DEMO-T25'), automated: false}), /schema|reviewed/i);
  for (const mismatch of [{siteUrl: 'https://example-other.atlassian.net'}, {project: 'OTHER'}]) {
    const f = fixture(); Object.assign(f.configuration.testManagement.caseFieldSchema, mismatch);
    await assert.rejects(f.adapter.prepareCase(f.input), /schema|site|project/i);
    assert.equal(f.writes.length, 0);
  }
});

test('Zephyr create applies reviewed defaults and explicit overrides, retaining false and zero', async () => {
  const f = fixture(); const plan = await f.adapter.prepareCase({...f.input, nativeFields: {Risk: 'Low', 'Owner note': 'Reviewed note'}});
  assert.deepEqual(plan.requests[0].body.customFields, {Risk: 'Low', Enabled: false, Build: 0, 'Owner note': 'Reviewed note'});
  assert.ok(Array.isArray(plan.fieldReview)); assert.match(plan.fieldSchemaFingerprint, /^[a-f0-9]{64}$/);
  await f.adapter.writeCase(plan, f.delivery); await f.adapter.verifyCase(plan, 'DEMO-T25');
  f.raw.customFields.Risk = 'High'; await assert.rejects(f.adapter.verifyCase(plan, 'DEMO-T25'), /custom|field|readback/i);
});

test('Zephyr validates required, unknown, wrong-type and invalid-choice values without writes', async () => {
  for (const nativeFields of [{Risk: null}, {Risk: 'Invented'}, {Enabled: 'false'}, {Build: '0'}, {Unexpected: 'value'}]) {
    const f = fixture(); await assert.rejects(f.adapter.prepareCase({...f.input, nativeFields}), error => Array.isArray(error.fieldProblems) && error.fieldProblems.length > 0);
    assert.equal(f.writes.length, 0);
  }
  const absent = fixture({defaults: {}}); await assert.rejects(absent.adapter.prepareCase(absent.input), /Risk|Enabled|Build|required/i);
});

test('Zephyr update preserves existing values, ignores create defaults, and includes optional nulls', async () => {
  const f = fixture({existing: {Risk: 'Low', Enabled: false, Build: 2}}), before = await f.adapter.readCase('DEMO-T25');
  const plan = await f.adapter.prepareCase({...f.input, before, title: 'Buy again'});
  assert.deepEqual(plan.requests[0].body.customFields, {Risk: 'Low', Enabled: false, Build: 2, 'Owner note': null});
  assert.equal(plan.requests[0].body.objective, 'Keep objective');
  const cleared = await f.adapter.prepareCase({...f.input, before, nativeFields: {'Owner note': null}});
  assert.equal(cleared.requests[0].body.customFields['Owner note'], null);
  await f.adapter.writeCase(plan, f.delivery); await f.adapter.verifyCase(plan, 'DEMO-T25');
});

test('Zephyr complete schema rejects unlisted existing fields instead of clearing or guessing them', async () => {
  const f = fixture({existing: {Risk: 'Low', Enabled: false, Build: 2, Unlisted: 'Retain'}});
  await assert.rejects(f.adapter.prepareCase({...f.input, before: await f.adapter.readCase('DEMO-T25')}), /schema|Unlisted|unknown/i);
  assert.equal(f.writes.length, 0);
});

test('required unsupported step fields block case creation but not metadata-only automation', async () => {
  const f = fixture({requiredStepFields: ['Evidence type']});
  await assert.rejects(f.adapter.prepareCase(f.input), /step.*field|Evidence type/i);
  assert.equal(f.writes.length, 0);
  const plan = await f.adapter.prepareAutomation({before: await f.adapter.readCase('DEMO-T25'), automated: false});
  assert.equal(plan.requests.length, 1); assert.equal(plan.requests[0].method, 'PUT');
  assert.deepEqual(plan.requests[0].body.customFields, f.raw.customFields);
});

test('schema changes invalidate unfinished writes and completion, but verified prior completion remains recoverable', async () => {
  const f = fixture(), plan = await f.adapter.prepareCase(f.input);
  f.configuration.testManagement.caseFieldSchema.reviewedAt = '2026-10-31T12:00:00.000Z';
  await assert.rejects(f.adapter.writeCase(plan, f.delivery), /schema.*chang|schema.*approv/i);
  assert.equal(f.writes.length, 0);
  f.raw.name = plan.desired.title; f.raw.labels = plan.desired.labels; f.raw.customFields = structuredClone(plan.requests[0].body.customFields); f.steps.length = 0;
  await assert.rejects(f.adapter.caseCompletion(plan, 'DEMO-T25'), /schema.*chang|schema.*approv/i);
  f.steps.push({id: 50, inline: {description: 'Buy', testData: '', expectedResult: 'Order created'}});
  assert.equal((await f.adapter.caseCompletion(plan, 'DEMO-T25')).complete, true);
});

test('automation binds and rechecks schema while preserving complete fields and allowing proven recovery', async () => {
  const f = fixture(), before = await f.adapter.readCase('DEMO-T25'), plan = await f.adapter.prepareAutomation({before, automated: true, identity: {id: 'stable', name: 'Checkout', storage: 'tests/Checkout.spec.ts', type: 'Playwright'}});
  assert.match(plan.fieldSchemaFingerprint, /^[a-f0-9]{64}$/);
  f.configuration.testManagement.caseFieldSchema.fields[0].allowedValues.push('Medium');
  await assert.rejects(f.adapter.writeAutomation(plan, f.delivery), /schema.*chang|schema.*approv/i);
  await assert.rejects(f.adapter.automationCompletion(plan), /schema.*chang|schema.*approv/i);
  assert.equal(f.writes.length, 0);
  Object.assign(f.raw, structuredClone(plan.requests[0].body));
  assert.equal((await f.adapter.automationCompletion(plan)).complete, true);
  await f.adapter.verifyAutomation(plan);
});

test('native field types keep date, decimal, multiselect and account ID wire values', async () => {
  const fields = [
    {name: 'Due', type: 'Date Picker', required: true}, {name: 'Estimate', type: 'Decimal Number', required: true},
    {name: 'Browsers', type: 'Select List (Multi-Choice)', required: true, allowedValues: ['Chrome', 'Firefox']},
    {name: 'Owner', type: 'User Picker', required: true}, {name: 'Note', type: 'Text Field (Single Line)', required: false}
  ];
  const nativeFields = {Due: '2028-02-29', Estimate: 1.5, Browsers: ['Chrome', 'Firefox'], Owner: '12345:example-user', Note: 'Reviewed'};
  const f = fixture({fields, defaults: {}, existing: {}}), plan = await f.adapter.prepareCase({...f.input, nativeFields});
  assert.deepEqual(plan.requests[0].body.customFields, nativeFields);
  for (const invalid of [{Due: '2027-02-29'}, {Estimate: '1.5'}, {Browsers: ['Safari']}, {Browsers: 'Chrome'}, {Owner: {accountId: '12345:example-user'}}]) {
    await assert.rejects(f.adapter.prepareCase({...f.input, nativeFields: {...nativeFields, ...invalid}}), error => error.fieldProblems?.length > 0);
  }
  assert.equal(f.writes.length, 0);
});

test('schema rejects ambiguous or incomplete definitions before issuing requests', () => {
  const f = fixture(), schema = f.configuration.testManagement.caseFieldSchema;
  for (const change of [
    {reviewedAt: '2026-02-30T12:00:00.000Z'}, {requiredStepFields: undefined},
    {fields: [{name: 'Risk', type: 'Select List (Single Choice)', required: true}]},
    {fields: [definitions[0], definitions[0]]}, {fields: [{name: 'Risk', type: 'Unknown', required: true}]},
    {fields: [{name: 'Note', type: 'Text Field (Single Line)'}]},
    {fields: [{name: 'Risk', type: 'Select List (Single Choice)', required: false, allowedValues: ['High', 'High']}]}
  ]) assert.throws(() => validateZephyrCaseFieldSchema({...schema, ...change}, f.configuration), /schema|field|reviewedAt|choice/i);
});

test('schema drift after acknowledged create prevents the following step write', async () => {
  const f = fixture(), plan = await f.adapter.prepareCase(f.input);
  const delivery = {write: async (...args) => {
    const result = await f.delivery.write(...args);
    f.configuration.testManagement.caseFieldSchema.reviewedAt = '2026-10-31T12:00:00Z';
    return result;
  }};
  let acknowledged;
  await assert.rejects(f.adapter.writeCase(plan, delivery, {onIdentity: value => {acknowledged = value;}}), /schema.*chang/i);
  assert.deepEqual(acknowledged, {externalId: 'DEMO-T25'});
  assert.deepEqual(f.writes.map(write => write.operation), ['create-case']);
});

test('recovery rejects created cases with different custom fields before completing steps', async () => {
  const f = fixture(), plan = await f.adapter.prepareCase(f.input);
  f.raw.name = plan.desired.title; f.raw.labels = plan.desired.labels; f.raw.customFields = {...plan.requests[0].body.customFields, Risk: 'Low'}; f.steps.length = 0;
  await assert.rejects(f.adapter.caseCompletion(plan, 'DEMO-T25'), /field.*readback/i);
  assert.equal(f.writes.length, 0);
});

test('Zephyr user fields require exact active Jira users at preview and before dispatch', async () => {
  const fields = [{name: 'Owner', type: 'User Picker', required: true}], accountId = '12345:example-user';
  for (const response of [{accountId, active: false}, {accountId: 'other-user', active: true}, {accountId}]) {
    const f = fixture({fields, defaults: {Owner: accountId}}); f.users.set(accountId, response);
    await assert.rejects(f.adapter.prepareCase(f.input), error => error.fieldProblems?.some(row => row.field === 'Owner'));
    assert.equal(f.writes.length, 0);
  }
  const f = fixture({fields, defaults: {Owner: accountId}}), plan = await f.adapter.prepareCase(f.input);
  assert.deepEqual(f.userReads, [accountId]);
  f.users.set(accountId, {accountId, active: false});
  await assert.rejects(f.adapter.writeCase(plan, f.delivery), /user|Owner|active/i);
  assert.equal(f.writes.length, 0);
});
