import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fixture} from './fixtures/execution-core.mjs';
import {createTestManagement} from '../scripts/lib/integrations/test-management.mjs';

const marker = 'pom-harness-0123456789abcdef', siteUrl = 'https://example.atlassian.net';
const nativeJira = key => ({key, project: {id: '10001', key: 'DEMO', self: siteUrl + '/rest/api/2/project/10001'}});
const testValue = {issueId: '10003', projectId: '10001', jira: nativeJira('DEMO-2'), lastModified: '2026-10-28T01:02:03.000Z', testType: {name: 'Manual'}, dataset: null,
  steps: [{id: 'step-a', action: 'Buy', data: '', result: 'Order created', attachments: [], customFields: []}], preconditions: {total: 0, results: []}};
function jiraFixture(provider = 'xray') {
  const issue = {id: '10003', key: 'DEMO-2', fields: {project: {id: '10001', key: 'DEMO'}, summary: 'Buy', labels: ['team'], updated: '2026-10-28T01:02:03.000Z'}}, properties = new Map();
  const jira = {configuration: {siteUrl, project: 'DEMO', timeoutMs: 1000, maxResponseBytes: 200000, testManagement: {provider, region: 'eu'}},
    projectIdentity: async () => ({id: '10001', key: 'DEMO', name: 'Demo'}),
    issue: async key => key === 'DEMO-100' ? {id: '10100', key, fields: {project: {id: '10001', key: 'DEMO'}}} : structuredClone(issue),
    read: async route => {if (route.includes('/properties/')) {if (properties.has(route)) return {value: properties.get(route)}; throw Object.assign(new Error('not found'), {status: 404});} throw new Error(`Unexpected read ${route}`);}};
  return {jira, issue, properties};
}
function xrayFixture() {
  const {jira, issue, properties} = jiraFixture(), raw = structuredClone(testValue), requests = [];
  const run = {id: 'run-9', lastModified: '2026-10-28', comment: '', status: {name: 'TODO'}, test: {issueId: '10003'}, testExecution: {issueId: '10100'}, parameters: [],
    steps: [{id: 'run-step-1', action: 'Buy', data: '', result: 'Order created', actualResult: '', status: {name: 'TODO'}}]};
  const transport = {query: async (query) => {
    if (query.includes('getStatuses')) return {getStatuses: [{name: 'PASSED'}, {name: 'FAILED'}], getStepStatuses: [{name: 'PASSED'}, {name: 'FAILED'}]};
    if (query.includes('getTestRun')) return {getTestRun: structuredClone(run)};
    if (query.includes('getTest(')) return {getTest: structuredClone(raw)};
    throw new Error(`Unexpected query ${query}`);
  }};
  const delivery = {write: async (operation, route, body, options) => {
    requests.push({operation, route, body, options});
    if (route.endsWith('/properties/pom-harness.automation')) {const native = route.slice(5); if (options.method === 'DELETE') properties.delete(native); else properties.set(native, body);}
    else if (route === 'jira/issue/DEMO-2') Object.assign(issue.fields, body.fields);
    else if (body.query.includes('updateTestStep(')) Object.assign(raw.steps.find(step => step.id === body.variables.id), body.variables.step);
    else if (body.query.includes('addTestStep(')) raw.steps.push({id: 'added-' + requests.length, ...body.variables.step, attachments: [], customFields: []});
    else if (body.query.includes('removeTestStep(')) raw.steps.splice(raw.steps.findIndex(step => step.id === body.variables.id), 1);
    else if (body.query.includes('updateTestRunStep(')) Object.assign(run.steps[0], {status: {name: body.variables.update.status}, actualResult: body.variables.update.actualResult});
    else if (body.query.includes('updateTestRunComment')) run.comment = body.variables.comment;
    else if (body.query.includes('updateTestRunStatus')) run.status = {name: body.variables.status};
    else throw new Error(`Unexpected write ${route}`);
    return {};
  }};
  return {adapter: createTestManagement({jira, transport}), jira, issue, properties, raw, run, requests, delivery};
}
function zephyrFixture() {
  const {jira} = jiraFixture('zephyr-scale'), raw = {id: 25, key: 'DEMO-T25', name: 'Buy', objective: 'Business goal', precondition: 'Signed in', project: {id: 37}, priority: {id: 2}, status: {id: 1}, labels: ['team'], customFields: {Risk: 'High'}}, requests = [];
  const steps = [{id: 10, inline: {description: 'Buy', testData: '', expectedResult: 'Order created', customFields: {}}}], statuses = [{id: 1, name: 'Pass'}, {id: 2, name: 'Fail'}], executions = new Map();
  const transport = {base: 'https://eu.api.zephyrscale.smartbear.com/v2/', read: async route => {
    if (route === 'projects/DEMO') return {id: 37, jiraProjectId: 10001, key: 'DEMO', enabled: true};
    if (route === 'testcases/DEMO-T25') return structuredClone(raw);
    if (route === 'testcycles/DEMO-R1') return {id: 19, key: 'DEMO-R1', project: {id: 37}};
    if (route.startsWith('testexecutions/')) return structuredClone(executions.get(route.split('/')[1])?.value);
    throw new Error(`Unexpected read ${route}`);
  }, list: async route => {
    if (route.endsWith('/attachments')) return [];
    if (route === 'testcases/DEMO-T25/teststeps') return structuredClone(steps);
    if (route.startsWith('statuses?')) return statuses;
    if (route.startsWith('testexecutions?')) return [...executions.values()].map(item => structuredClone(item.value));
    if (route.startsWith('testexecutions/')) return structuredClone(executions.get(route.split('/')[1])?.steps);
    throw new Error(`Unexpected list ${route}`);
  }};
  const delivery = {write: async (operation, route, body, options = {}) => {
    requests.push({operation, route, body, options});
    if (route === 'plugin/testcases/DEMO-T25') {Object.assign(raw, structuredClone(body)); return {};}
    if (route === 'plugin/testcases/DEMO-T25/teststeps') {
      if (body.mode === 'OVERWRITE') steps.length = 0;
      for (const item of body.items) steps.push({id: 1000 + steps.length, ...structuredClone(item)}); return {};
    }
    if (route === 'plugin/testexecutions') {
      const id = String(executions.size + 100), status = name => ({id: statuses.find(row => row.name === name).id});
      executions.set(id, {value: {id: Number(id), project: {id: 37}, testCase: {id: 25, self: transport.base + 'testcases/DEMO-T25/versions/1'}, testCycle: {id: 19}, testExecutionStatus: status(body.statusName), comment: body.comment, automated: body.automated}, steps: body.testScriptResults.map((row, index) => ({id: index + 1, inline: {status: status(row.statusName), actualResult: row.actualResult}}))});
      await options.onIdentity?.({externalId: Number(id)}); return {id: Number(id)};
    }
    throw new Error(`Unexpected write ${route}`);
  }};
  return {adapter: createTestManagement({jira, transport}), raw, requests, delivery, executions};
}

test('Xray set/clear retains manual test type and unrelated labels while verifying full source identity', async () => {
  const {adapter, delivery, issue, raw, properties, requests} = xrayFixture();
  const identity = {name: 'Checkout buys item', storage: 'tests/CheckoutTests.spec.ts', type: 'Playwright', id: 'code-identity-123'};
  const set = await adapter.prepareAutomation({before: await adapter.readCase('DEMO-2'), automated: true, identity});
  await adapter.writeAutomation(set, delivery); await adapter.verifyAutomation(set);
  assert.equal(raw.testType.name, 'Manual'); assert.deepEqual(issue.fields.labels, ['team', 'pom-harness-automated']);
  assert.deepEqual(properties.get('issue/DEMO-2/properties/pom-harness.automation'), {version: 1, automated: true, ...identity});
  issue.fields.labels.push('other-team');
  const clear = await adapter.prepareAutomation({before: await adapter.readCase('DEMO-2'), automated: false});
  await adapter.writeAutomation(clear, delivery); await adapter.verifyAutomation(clear);
  assert.deepEqual(issue.fields.labels, ['team', 'other-team']); assert.equal(properties.size, 0);
  assert.ok(requests.every(request => !JSON.stringify(request).includes('updateTestType')));
});

test('Xray existing case recovery resumes the exact missing update/add/remove suffix', async () => {
  const {adapter, delivery, raw} = xrayFixture();
  const plan = await adapter.prepareCase({before: await adapter.readCase('DEMO-2'), title: 'Buy three', marker,
    steps: [1, 2, 3].map(index => ({action: 'Buy ' + index, expected: 'Order ' + index}))});
  const first = plan.requests[0]; await delivery.write(first.operation, first.channel + '/' + first.route, first.body);
  const missing = await adapter.caseCompletion(plan, 'DEMO-2');
  assert.deepEqual(missing.requests.map(row => row.operation), ['update-case-step', 'add-case-step', 'add-case-step']);
  for (const row of missing.requests) await delivery.write(row.operation, row.channel + '/' + row.route, row.body);
  await adapter.verifyCase(plan, 'DEMO-2');
  const reduced = await adapter.prepareCase({before: await adapter.readCase('DEMO-2'), title: 'Buy one', marker, steps: [{action: 'Buy one', expected: 'One order'}]});
  for (const row of reduced.requests.slice(0, 3)) await delivery.write(row.operation, row.channel + '/' + row.route, row.body);
  const trailing = await adapter.caseCompletion(reduced, 'DEMO-2');
  assert.deepEqual(trailing.requests.map(row => row.operation), ['remove-case-step']);
  raw.steps[0].result = 'Unrelated edit'; await assert.rejects(adapter.caseCompletion(reduced, 'DEMO-2'), /intermediate|approved|outside/);
  raw.steps[0].result = 'One order';
  for (const row of trailing.requests) await delivery.write(row.operation, row.channel + '/' + row.route, row.body);
  await adapter.verifyCase(reduced, 'DEMO-2'); assert.equal(raw.steps.length, 1);
});

test('Zephyr existing case recovery resumes only missing append batches after an approved overwrite', async () => {
  const {adapter, delivery, raw} = zephyrFixture();
  const plan = await adapter.prepareCase({before: await adapter.readCase('DEMO-T25'), title: 'Buy many', marker,
    steps: Array.from({length: 201}, (_, index) => ({action: 'Buy ' + index, data: 'data ' + index, expected: 'Order ' + index}))});
  for (const row of plan.requests.slice(0, 2)) await delivery.write(row.operation, row.channel + '/' + row.route, row.body);
  const missing = await adapter.caseCompletion(plan, 'DEMO-T25');
  assert.deepEqual(missing.requests.map(row => [row.body.mode, row.body.items.length]), [['APPEND', 100], ['APPEND', 1]]);
  raw.customFields.Risk = 'Unrelated edit'; await assert.rejects(adapter.caseCompletion(plan, 'DEMO-T25'), /metadata|intermediate|approved/); raw.customFields.Risk = 'High';
  for (const row of missing.requests) await delivery.write(row.operation, row.channel + '/' + row.route, row.body);
  await adapter.verifyCase(plan, 'DEMO-T25'); assert.equal((await adapter.readCase('DEMO-T25')).steps.length, 201);
});

test('Zephyr set/clear preserves user edits around the owned automation block and every custom field', async () => {
  const {adapter, delivery, raw} = zephyrFixture(), identity = {name: 'Buy', storage: 'tests/BuyTests.spec.ts', type: 'Playwright', id: 'code-identity-123'};
  const set = await adapter.prepareAutomation({before: await adapter.readCase('DEMO-T25'), automated: true, identity});
  await adapter.writeAutomation(set, delivery); await adapter.verifyAutomation(set);
  assert.ok(raw.objective.includes(JSON.stringify(identity))); assert.deepEqual(raw.customFields, {Risk: 'High'});
  raw.objective += '\nNew business context'; raw.labels.push('other-team');
  const clear = await adapter.prepareAutomation({before: await adapter.readCase('DEMO-T25'), automated: false});
  await adapter.writeAutomation(clear, delivery); await adapter.verifyAutomation(clear);
  assert.equal(raw.objective, 'Business goal\nNew business context'); assert.deepEqual(raw.labels, ['team', 'other-team']); assert.equal(raw.precondition, 'Signed in');
});

test('Zephyr refuses duplicated owned metadata and stale automation approval', async () => {
  const {adapter, raw, delivery} = zephyrFixture(), before = await adapter.readCase('DEMO-T25');
  const plan = await adapter.prepareAutomation({before, automated: false}); raw.customFields.Risk = 'Critical';
  await assert.rejects(adapter.writeAutomation(plan, delivery), /changed after/);
  raw.objective += '\n[pom-harness:automation]\n{}\n[pom-harness:automation]\n{}\n[/pom-harness:automation]';
  await assert.rejects(adapter.prepareAutomation({before: await adapter.readCase('DEMO-T25'), automated: false}), /ambiguous/);
});

test('Xray publishes explicit native run and step statuses and detects changed readback', async () => {
  const {adapter, delivery, run} = xrayFixture();
  const input = {groupId: 'DEMO-100', marker, statuses: {PASS: 'PASSED', FAIL: 'FAILED'}, results: [{caseId: 'DEMO-2', outcome: 'FAIL', steps: [{outcome: 'FAIL', actual: 'Server rejected order'}]}]};
  const plan = await adapter.prepareResults(input); await adapter.writeResults(plan, delivery);
  assert.deepEqual(await adapter.verifyResults(plan), [{caseId: 'DEMO-2', id: 'run-9'}]);
  run.steps[0].status.name = 'PASSED'; await assert.rejects(adapter.verifyResults(plan), /readback differs/);
});

test('Zephyr creates manual execution with case/step outcomes, retains acknowledged identity and verifies associations', async () => {
  const {adapter, delivery, executions} = zephyrFixture(), acknowledged = [];
  const plan = await adapter.prepareResults({groupId: 'DEMO-R1', marker, statuses: {PASS: 'Pass'}, results: [{caseId: 'DEMO-T25', outcome: 'PASS', steps: [{outcome: 'PASS', actual: 'Order 11 appeared'}]}]});
  const ids = await adapter.writeResults(plan, delivery, {onIdentity: value => acknowledged.push(value)});
  await adapter.verifyResults(plan, ids); assert.deepEqual(acknowledged, ids); assert.equal(executions.get('100').value.automated, false);
  executions.get('100').value.testCycle.id = 99; await assert.rejects(adapter.verifyResults(plan, ids), /destination or outcome/);
});

test('unknown native statuses and missing per-step results fail before publication', async () => {
  for (const [fixture, caseId, groupId] of [[xrayFixture, 'DEMO-2', 'DEMO-100'], [zephyrFixture, 'DEMO-T25', 'DEMO-R1']]) {
    const {adapter, requests} = fixture();
    await assert.rejects(adapter.prepareResults({groupId, marker, statuses: {PASS: 'Invented'}, results: [{caseId, outcome: 'PASS', steps: [{outcome: 'PASS'}]}]}), /native status/);
    await assert.rejects(adapter.prepareResults({groupId, marker, statuses: {PASS: fixture === xrayFixture ? 'PASSED' : 'Pass'}, results: [{caseId, outcome: 'PASS', steps: []}]}), /step/);
    assert.equal(requests.length, 0);
  }
});

test('verified automation can publish overall outcomes without inventing step assertions', async () => {
  for (const [fixture, caseId, groupId, nativeStatus] of [[xrayFixture, 'DEMO-2', 'DEMO-100', 'PASSED'], [zephyrFixture, 'DEMO-T25', 'DEMO-R1', 'Pass']]) {
    const {adapter} = fixture();
    const plan = await adapter.prepareResults({groupId, marker, automated: true, statuses: {PASS: nativeStatus}, results: [{caseId, outcome: 'PASS'}]});
    assert.ok(plan.requests.every(request => request.operation !== 'update-result-step' && !Object.hasOwn(request.body, 'testScriptResults')));
  }
});

test('Zephyr reconciliation finds one exact owned result and refuses ambiguous or incomplete publication', async () => {
  const {adapter, delivery, executions} = zephyrFixture();
  const plan = await adapter.prepareResults({groupId: 'DEMO-R1', marker, statuses: {PASS: 'Pass'}, results: [{caseId: 'DEMO-T25', outcome: 'PASS', steps: [{outcome: 'PASS', actual: 'Created'}]}]});
  await assert.rejects(adapter.reconcileResults(plan), /incomplete/);
  const ids = await adapter.writeResults(plan, delivery);
  assert.deepEqual(await adapter.reconcileResults(plan), ids);
  executions.set('101', structuredClone(executions.get('100'))); executions.get('101').value.id = 101;
  await assert.rejects(adapter.reconcileResults(plan), /ambiguous/);
});

test('Zephyr partial discovery returns only verified results and leaves a missing case for receipt-authorized recovery', async () => {
  const {adapter, delivery} = zephyrFixture();
  const plan = await adapter.prepareResults({groupId: 'DEMO-R1', marker, statuses: {PASS: 'Pass'}, results: [{caseId: 'DEMO-T25', outcome: 'PASS', steps: [{outcome: 'PASS'}]}]});
  const known = await adapter.writeResults(plan, delivery), partial = structuredClone(plan);
  partial.desired.push({...partial.desired[0], caseId: 'DEMO-T26', body: {...partial.desired[0].body, testCaseKey: 'DEMO-T26', comment: '[' + marker + ':DEMO-T26]'}});
  assert.deepEqual(await adapter.findResults(partial, known), known);
  await assert.rejects(adapter.reconcileResults(partial, known), /incomplete/);
});

test('lost Xray creation response records intent only at actual mutation and never retries', async t => {
  const {roots} = fixture(t), {jira} = jiraFixture(); let creates = 0, delivery;
  jira.read = async () => ({issueLinkTypes: [{id: '1', outward: 'tests', inward: 'is tested by'}]});
  const adapter = createTestManagement({jira, roots, resolveCredentials: () => ({clientId: '<synthetic>', clientSecret: '<synthetic-secret>'}), fetchImpl: async (url, options) => {
    const events = delivery ? readFileSync(join(roots.projectRoot, delivery.receipt), 'utf8').trim().split('\n').map(JSON.parse) : [];
    if (url.endsWith('/authenticate')) {assert.equal(events.filter(row => row.event === 'dispatching').length, 0); return new Response(JSON.stringify('<synthetic-access>'));}
    if (options.body.includes('getCoverableIssue')) return new Response(JSON.stringify({data: {getCoverableIssue: {issueId: '10100', jira: nativeJira('DEMO-100')}}}));
    creates++; assert.equal(events.at(-1).event, 'dispatching'); throw new Error('connection lost after server accepted create');
  }});
  const plan = await adapter.prepareCase({title: 'Buy', steps: [{action: 'Buy', expected: 'Order created'}], storyKey: 'DEMO-100', marker});
  delivery = adapter.delivery('case-design', true);
  await assert.rejects(adapter.writeCase(plan, delivery), error => error.delivery?.effect === 'uncertain');
  assert.equal(creates, 1);
  const events = readFileSync(join(roots.projectRoot, delivery.receipt), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(events.at(-1).effect, 'uncertain'); assert.ok(events.every(row => !JSON.stringify(row).includes('<synthetic-secret>')));
});

test('Xray freshness ignores viewed/watched metadata but detects actual content changes', async () => {
  const {adapter, issue} = xrayFixture(), before = await adapter.readCase('DEMO-2');
  issue.fields.lastViewed = '2026-10-30'; issue.fields.watches = {watchCount: 9}; issue.expand = 'renderedFields';
  assert.equal((await adapter.readCase('DEMO-2')).fingerprint, before.fingerprint);
  issue.fields.summary = 'Changed'; assert.notEqual((await adapter.readCase('DEMO-2')).fingerprint, before.fingerprint);
});

test('Xray result recovery returns only missing approved operations and refuses unrelated drift', async () => {
  const {adapter, delivery, run} = xrayFixture();
  const plan = await adapter.prepareResults({groupId: 'DEMO-100', marker, statuses: {PASS: 'PASSED'}, results: [{caseId: 'DEMO-2', outcome: 'PASS', steps: [{outcome: 'PASS', actual: 'Created'}]}]});
  const first = plan.requests[0]; await delivery.write(first.operation, 'plugin/' + first.route, first.body);
  assert.deepEqual((await adapter.resultCompletion(plan)).requests.map(row => row.operation), ['update-result-comment', 'update-result-status']);
  assert.deepEqual(await adapter.findResults(plan), []);
  run.comment = 'Unrelated user edit'; await assert.rejects(adapter.resultCompletion(plan), /outside the approved/);
});
