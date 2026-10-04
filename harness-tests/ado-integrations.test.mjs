import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync, readFileSync, mkdirSync, symlinkSync, existsSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {adoFixture, xml} from './fixtures/ado.mjs';
import {fixture, retry} from './fixtures/execution-core.mjs';
import {loadAdoConfiguration, validateAdoConfiguration, workItemLinkId} from '../scripts/lib/integrations/config.mjs';
import {createAdoTestSource, adoSuiteToSource, adoStoryToSource, loadTestSource} from '../scripts/lib/integrations/ado-source.mjs';
import {createAdoTestManagement, prepareLegacyPublication, prepareRunPublication} from '../scripts/lib/integrations/ado-management.mjs';
import {createAdoSourceControl} from '../scripts/lib/integrations/ado-delivery.mjs';
import {runCompatibility, compatibilityDiagnostic} from '../scripts/lib/integrations/compatibility.mjs';
import {packageRoot} from '../scripts/lib/consumer-paths.mjs';
import {createAdoClient, AdoError} from '../scripts/lib/integrations/ado-client.mjs';
import {renderSpec} from '../scripts/lib/integrations/ado-steps.mjs';

const put = (root, path, value) => { const file = join(root, path); mkdirSync(dirname(file), {recursive: true}); writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); };
const legacy = () => ({manifest: {cases: [{id: 101}, {id: 102}]}, state: {cases: {'101': {status: 'passed', greens: 2}, '102': {status: 'failed', classification: 'app-defect'}}}});
const publication = () => { const {manifest, state} = legacy(); return prepareLegacyPublication(manifest, state); };
const writes = f => f.state.requests.filter(req => req.method !== 'GET' && req.path !== 'wit/workitemsbatch');

test('C8: acknowledged ADO writes survive local callback failure and rejected cache entries can recover', async t => {
  const f = await adoFixture(t), delivery = f.client.delivery('bugs', true);
  await assert.rejects(delivery.write('create-bug', 'wit/workitems/$Bug?api-version=7.1', [{op: 'add', path: '/fields/System.Title', value: 'Synthetic defect'}], {method: 'POST', patch: true, onIdentity() {throw new Error('Injected local callback failure');}}), /Injected local callback/);
  const events = f.receipts()[0]; assert(events.some(event => event.event === 'acknowledged' && event.identity.workItemId)); assert(!events.some(event => event.event === 'incomplete')); assert.equal(writes(f).length, 1);
  let fail = true; f.state.fault = ({path, send}) => {if (path === 'testplan/plans' && fail) {send({}, 503); return true;}};
  await assert.rejects(f.client.cachedRead('testplan/plans?api-version=7.1')); fail = false;
  assert((await f.client.cachedRead('testplan/plans?api-version=7.1')).value);
});
const publish = (f, extra = {}) => createAdoTestManagement(f.client).publish({publication: publication(), planId: 1, suiteId: 2, ...extra});
function cli(f, command, args = []) { return runCompatibility(command, ['--project-root', f.roots.projectRoot, ...args], {fetchImpl: f.fetchImpl, environment: {[f.config.credentialRef]: f.credential}}); }
function configure(f) { put(f.roots.projectRoot, '.harness/integrations.json', {version: 1, ado: f.config}); }
const testedBy = 'Microsoft.VSTS.Common.TestedBy-Forward', link = (f, rel, id, scope = '') => ({rel, url: `${f.config.organizationUrl}${scope}/_apis/wit/workItems/${id}`});
/** Story 400 tests 101/102 (three URL forms), has a Task child 403 and a related other-project case 404. */
async function storyFixture(t) {
  const f = await adoFixture(t), item = (id, fields) => ({id, rev: 1, fields: {'System.TeamProject': 'demo', 'Microsoft.VSTS.TCM.Steps': xml(), ...fields}, relations: []});
  for (const id of [101, 102]) f.state.items.get(id).fields['System.WorkItemType'] = 'Test Case';
  f.state.items.set(400, item(400, {'System.Title': 'Synthetic story', 'System.WorkItemType': 'User Story'}));
  f.state.items.get(400).relations = [link(f, testedBy, 102), link(f, testedBy, 101, '/demo'), {rel: testedBy, url: `${link(f, testedBy, 101, `/${f.state.project.id}`).url}/`},
    link(f, 'System.LinkTypes.Hierarchy-Forward', 403), link(f, 'System.LinkTypes.Related', 404), {rel: 'AttachedFile', url: 'https://files.example.test/keep'}];
  f.state.items.set(403, item(403, {'System.Title': 'Synthetic task', 'System.WorkItemType': 'Task'}));
  f.state.items.set(404, item(404, {'System.Title': 'Foreign case', 'System.WorkItemType': 'Test Case', 'System.TeamProject': 'other'}));
  f.state.category = {name: 'Test Case Category', referenceName: 'Microsoft.TestCaseCategory', workItemTypes: [{name: 'Test Case'}]};
  f.state.fault = ({path, send}) => { if (path === 'wit/workitemtypecategories/microsoft.testcasecategory') {send(f.state.category); return true;} };
  return f;
}
const batches = f => f.state.requests.filter(req => req.path === 'wit/workitemsbatch'), contentReads = f => batches(f).filter(req => req.body.fields.includes('Microsoft.VSTS.TCM.Steps'));
const discoveryFields = ['System.Id', 'System.WorkItemType', 'System.TeamProject'];

test('local source works with no ADO credentials, ignores even malformed ADO config and never invokes an adapter', async t => {
  const f = fixture(t); put(f.roots.projectRoot, '.harness/integrations.json', 'broken');
  put(f.roots.projectRoot, 'spec.json', {version: 1, id: 'local', title: 'Local', scenarios: [{id: 'one', title: 'One', steps: [{action: 'Observe', expected: ['Present']}], externalReferences: [{system: 'ado', id: '101'}]}]});
  const result = await loadTestSource(f.roots, {kind: 'local', path: 'spec.json'}, {fetchSuite() {throw new Error('must not run');}});
  assert.equal(result.source.kind, 'local'); assert.equal(result.scenarios.length, 1);
});
test('explicit configuration resolves only consumer environment references, never mutates shell environment', t => {
  const f = fixture(t), env = {}, generated = crypto.randomUUID();
  put(f.roots.projectRoot, '.harness/integrations.json', {version: 1, ado: {organizationUrl: 'https://ado.example.test/collection', project: 'demo', credentialRef: 'ADO_TEST_CREDENTIAL'}});
  put(f.roots.projectRoot, '.env', `ADO_TEST_CREDENTIAL=${generated}\n`);
  const loaded = loadAdoConfiguration(f.roots, {}, env); assert.equal(loaded.resolveCredential(), generated); assert.deepEqual(env, {});
  assert.throws(() => loadAdoConfiguration(f.roots, {project: 'other'}, env), /overrides/);
});
test('legacy configuration remains supported with explicit plan and custom field; no private defaults', t => {
  const f = fixture(t); put(f.roots.projectRoot, 'config/project.json', {azure: {orgUrl: 'https://ado.example.test/collection', project: 'demo', testPlanId: 1, automationField: 'Custom.TestAutomation'}});
  const cfg = loadAdoConfiguration(f.roots, {}, {}); assert.equal(cfg.configuration.planId, 1); assert.equal(cfg.configuration.automationField, 'Custom.TestAutomation'); assert.equal(cfg.resolveCredential(), undefined);
});
for (const change of [config => config.organizationUrl = 'http://ado.example.test', config => config.organizationUrl = 'https://ado.example.test/path?x=1', config => config.organizationUrl = ['https:', '', 'user' + '@ado.example.test'].join('/'), config => config.project = '../other', config => config.credentialRef = 'env:VALUE', config => config.automationField = 'System.Tags', config => config.extra = true, config => config.timeoutMs = 0]) {
  test(`configuration rejects unsafe or unsupported values: ${change}`, () => { const config = {organizationUrl: 'https://ado.example.test/collection', project: 'demo', credentialRef: 'ADO_TEST_CREDENTIAL'}; change(config); assert.throws(() => validateAdoConfiguration(config)); });
}
test('missing ADO configuration fails before credential resolution or transport', t => { const f = fixture(t); assert.throws(() => loadAdoConfiguration(f.roots, {}, {}), /explicit HTTPS/); });
test('destination escape is refused before sending credentials', async t => {
  const f = await adoFixture(t); for (const route of ['https://other.invalid/steal', '../other', 'wit/%2e%2e/%2e%2e/escape', '//other.invalid']) await assert.rejects(f.client.read(route)); assert.equal(f.state.requests.length, 0);
});
for (const mode of ['redirect', 'auth', 'oversize', 'invalid-json', 'timeout']) {
  test(`bounded transport rejects ${mode} and does not expose credentials or response body`, async t => {
    const f = await adoFixture(t, {timeoutMs: mode === 'timeout' ? 50 : 5000, maxResponseBytes: 1024});
    f.state.fault = ({res, send}) => {
      if (mode === 'redirect') { res.writeHead(302, {location: 'https://other.invalid/steal'}); res.end(); }
      else if (mode === 'auth') send({message: f.credential}, 401);
      else if (mode === 'oversize') send({text: f.credential.repeat(200)});
      else if (mode === 'invalid-json') { res.writeHead(200); res.end(f.credential); }
      return true;
    };
    await assert.rejects(f.client.read('wit/workitems/101?api-version=7.1'), error => !error.message.includes(f.credential)); assert.equal(f.state.requests.length, 1);
  });
}
test('retrieval follows continuation, batches reads and preserves nested shared assertions', async t => {
  const f = await adoFixture(t); f.state.items.set(300, {id: 300, fields: {'System.TeamProject': 'demo', 'Microsoft.VSTS.TCM.Steps': xml('Shared action', 'Shared expected')}}); f.state.items.get(101).fields['Microsoft.VSTS.TCM.Steps'] = '<steps><compref ref="300"/></steps>';
  const suite = await createAdoTestSource(f.client).fetchSuite(1, 2), neutral = adoSuiteToSource(suite);
  assert.equal(suite.cases.length, 2); assert.equal(neutral.scenarios[0].steps[0].expected[0], 'Shared expected'); assert.equal(writes(f).length, 0); assert.equal(f.receipts().length, 0);
});
for (const mode of ['missing-item', 'missing-shared', 'cycle', 'malformed', 'pagination-loop']) {
  test(`retrieval refuses incomplete ${mode} source`, async t => {
    const f = await adoFixture(t);
    if (mode === 'missing-item') f.state.items.delete(102);
    if (mode === 'missing-shared') f.state.items.get(101).fields['Microsoft.VSTS.TCM.Steps'] = '<steps><compref ref="300"/></steps>';
    if (mode === 'cycle') f.state.items.get(101).fields['Microsoft.VSTS.TCM.Steps'] = '<steps><compref ref="101"/></steps>';
    if (mode === 'malformed') f.state.items.get(101).fields['Microsoft.VSTS.TCM.Steps'] = '<steps><step broken></steps>';
    if (mode === 'pagination-loop') f.state.fault = ({path, send}) => { if (path.endsWith('/testcase')) {send({value: [{workItem: {id: 101}}]}, 200, {'x-ms-continuationtoken': 'same'}); return true;} };
    await assert.rejects(createAdoTestSource(f.client).fetchSuite(1, 2)); assert.equal(writes(f).length, 0);
  });
}
test('neutral conversion refuses missing assertions, action or unresolved parameter semantics', async t => {
  const f = await adoFixture(t), suite = await createAdoTestSource(f.client).fetchSuite(1, 2);
  for (const change of [s => s.cases[0].parameters = '<parameters><param name="input"/></parameters>', s => s.cases[0].steps[0].expected = '', s => s.cases[0].steps[0].action = '']) { const copy = structuredClone(suite); change(copy); assert.throws(() => adoSuiteToSource(copy)); }
});
for (const [label, parameters, data] of [
  ['absent', undefined, undefined], ['null', null, null], ['blank', '  \n', ' \t'], ['parsed-empty', [], []],
  ['self-closing', '<parameters/>', '<NewDataSet/>'], ['spaced-self-closing', ' <parameters /> ', ' <NewDataSet /> '],
  ['paired', '<parameters></parameters>', '<NewDataSet></NewDataSet>'],
  ['whitespace-paired', '<parameters> \n </parameters>', '<NewDataSet> \n </NewDataSet>']
]) test(`empty ADO ${label} metadata preserves ordinary and shared source semantics`, async t => {
  const f = await adoFixture(t), metadata = {'Microsoft.VSTS.TCM.Parameters': parameters, 'Microsoft.VSTS.TCM.LocalDataSource': data};
  Object.assign(f.state.items.get(101).fields, metadata);
  f.state.items.set(300, {id: 300, fields: {'System.TeamProject': 'demo', ...metadata, 'Microsoft.VSTS.TCM.Steps': xml('Shared empty-metadata action', 'Shared empty-metadata expected')}});
  f.state.items.get(102).fields['Microsoft.VSTS.TCM.Steps'] = '<steps><compref ref="300"/></steps>';
  const suite = await createAdoTestSource(f.client).fetchSuite(1, 2), neutral = adoSuiteToSource(suite);
  assert.equal(neutral.scenarios.length, 2); assert.deepEqual(neutral.scenarios[1].steps[0].expected, ['Shared empty-metadata expected']);
  assert.deepEqual(suite.cases[0].parameters, parameters ?? null);
  if (data !== undefined && data !== null) assert.deepEqual(suite.cases[0].dataTableXml, data);
  const parsed = structuredClone(suite); parsed.cases[0].dataTable = []; assert.equal(adoSuiteToSource(parsed).scenarios.length, 2);
  const markdown = renderSpec({tc: parsed.cases[0], planId: 1, suiteId: 2, suiteName: suite.suiteName, target: 'https://app.example.test', org: 'synthetic', project: 'demo'});
  assert.equal(markdown.includes('Parameterized test case'), false); assert.equal(markdown.includes('```json'), false);
  assert.equal(writes(f).length, 0);
});
for (const [label, field, value] of [
  ['real-parameter', 'parameters', '<parameters><param name="input"/></parameters>'],
  ['parsed-parameter', 'parameters', [{name: 'input'}]], ['malformed-parameters', 'parameters', '<parameters>'],
  ['wrong-parameter-root', 'parameters', '<other/>'], ['parameter-text', 'parameters', '<parameters>input</parameters>'],
  ['invalid-xml-token-whitespace', 'parameters', '<parameters\u000b/>'], ['non-xml-token-whitespace', 'parameters', '<parameters\u00a0/>'],
  ['invalid-xml-surrounding-whitespace', 'parameters', '\u000b<parameters/>'],
  ['populated-data', 'dataTableXml', '<NewDataSet><Table1><input>value</input></Table1></NewDataSet>'],
  ['parsed-data', 'dataTable', [{input: 'value'}]], ['malformed-data', 'dataTableXml', '<NewDataSet>'],
  ['unknown-data-child', 'dataTableXml', '<NewDataSet><Unknown/></NewDataSet>'], ['unknown-data-root', 'dataTableXml', '<other/>'],
  ['invalid-xml-content-whitespace', 'dataTableXml', '<NewDataSet>\u000c</NewDataSet>']
]) test(`nonempty or unsupported ADO ${label} is not silently discarded`, async t => {
  const f = await adoFixture(t), suite = await createAdoTestSource(f.client).fetchSuite(1, 2);
  suite.cases[0][field] = value; if (field === 'dataTableXml') suite.cases[0].dataTable = [];
  assert.throws(() => adoSuiteToSource(suite), /refinement/);
  if (field !== 'dataTable') {
    const key = field === 'parameters' ? 'Microsoft.VSTS.TCM.Parameters' : 'Microsoft.VSTS.TCM.LocalDataSource';
    f.state.items.set(300, {id: 300, fields: {'System.TeamProject': 'demo', [key]: value, 'Microsoft.VSTS.TCM.Steps': xml('Shared action', 'Shared expected')}});
    f.state.items.get(101).fields['Microsoft.VSTS.TCM.Steps'] = '<steps><compref ref="300"/></steps>';
    await assert.rejects(createAdoTestSource(f.client).fetchSuite(1, 2), /refinement/);
  }
  assert.equal(writes(f).length, 0);
});
test('legacy rendering still preserves genuine parameter guidance and rows', async t => {
  const f = await adoFixture(t), suite = await createAdoTestSource(f.client).fetchSuite(1, 2), tc = suite.cases[0];
  tc.parameters = '<parameters><param name="input"/></parameters>'; tc.dataTable = [{input: 'synthetic'}];
  const markdown = renderSpec({tc, planId: 1, suiteId: 2, suiteName: suite.suiteName, target: 'https://app.example.test', org: 'synthetic', project: 'demo'});
  assert.ok(markdown.includes('Parameterized test case')); assert.ok(markdown.includes('"input": "synthetic"'));
});
test('story retrieval follows only Tested By links by default, deduplicates URL forms and reads nothing else', async t => {
  const f = await storyFixture(t), story = await createAdoTestSource(f.client).fetchStory(400);
  assert.deepEqual(Object.keys(story), ['storyId', 'storyTitle', 'links', 'organizationUrl', 'project', 'cases', 'excluded']);
  assert.deepEqual({...story, cases: story.cases.map(tc => tc.id)}, {storyId: 400, storyTitle: 'Synthetic story', links: ['tested-by'], organizationUrl: f.config.organizationUrl, project: 'demo', cases: [101, 102], excluded: []});
  assert.deepEqual(f.state.requests.map(req => `${req.method} ${req.path}${req.query}`), ['GET wit/workitems/400?$expand=relations&api-version=7.1', 'GET projects/demo?api-version=7.1',
    'GET wit/workitemtypecategories/microsoft.testcasecategory?api-version=7.1', 'POST wit/workitemsbatch?api-version=7.1', 'POST wit/workitemsbatch?api-version=7.1']);
  assert.deepEqual(batches(f).map(req => [req.body.ids, req.body.fields]), [[[101, 102], discoveryFields], [[101, 102], ['System.Id', 'System.Title', 'System.TeamProject', 'System.State', 'System.Tags', 'Microsoft.VSTS.Common.Priority',
    'Microsoft.VSTS.TCM.Steps', 'Microsoft.VSTS.TCM.Parameters', 'Microsoft.VSTS.TCM.LocalDataSource']]]); assert.equal(writes(f).length, 0); assert.equal(f.receipts().length, 0);
});
test('selected child and related links report non-test and other-project items by ID without reading their content', async t => {
  const f = await storyFixture(t); f.state.items.get(400).relations.push(link(f, 'System.LinkTypes.Related', 101));
  const story = await createAdoTestSource(f.client).fetchStory(400, ['related', 'tested-by', 'child']);
  assert.deepEqual([story.links, story.cases.map(tc => tc.id), story.excluded], [['tested-by', 'child', 'related'], [101, 102], [{id: 403, reason: 'not-test-case'}, {id: 404, reason: 'other-project'}]]);
  assert.deepEqual(batches(f).map(req => req.body.ids), [[101, 102, 403, 404], [101, 102]]); assert.deepEqual(contentReads(f).map(req => req.body.ids), [[101, 102]]);
});
test('story retrieval accepts exactly 1000 distinct links and 500 included cases', async t => {
  const f = await storyFixture(t); f.state.items.get(400).relations = [];
  for (let id = 1000; id < 2000; id++) { f.state.items.set(id, {...structuredClone(f.state.items.get(id < 1500 ? 101 : 403)), id}); f.state.items.get(400).relations.push(link(f, testedBy, id)); }
  const story = await createAdoTestSource(f.client).fetchStory(400);
  assert.deepEqual([story.cases.length, story.excluded.length, batches(f).length - contentReads(f).length, contentReads(f).length], [500, 500, 5, 3]);
});
test('story retrieval takes test-case types from the process category, not an assumed name', async t => {
  const f = await storyFixture(t); f.state.category.workItemTypes = [{name: 'Testfall'}]; f.state.items.get(101).fields['System.WorkItemType'] = 'testfall';
  const story = await createAdoTestSource(f.client).fetchStory(400);
  assert.deepEqual([story.cases.map(tc => tc.id), story.excluded], [[101], [{id: 102, reason: 'not-test-case'}]]);
});
for (const [mode, change, pattern] of [
  ['test-case-id', f => f.state.items.get(400).fields['System.WorkItemType'] = 'Test Case', /names a test case/],
  ['no-selected-link', f => f.state.items.get(400).relations = [link(f, 'System.LinkTypes.Related', 101)], /no linked test cases/],
  ['only-excluded-links', f => f.state.items.get(400).relations = [link(f, testedBy, 403)], /no linked test cases/],
  ['foreign-host', f => f.state.items.get(400).relations.push({rel: testedBy, url: 'https://other.invalid/collection/_apis/wit/workItems/101'}), /outside the configured collection/],
  ['alias-host', f => f.state.items.get(400).relations.push({rel: testedBy, url: 'https://alias.example.test/collection/_apis/wit/workItems/101'}), /outside the configured collection/],
  ['other-project-path', f => f.state.items.get(400).relations.push(link(f, testedBy, 101, '/other')), /outside the configured collection/],
  ['story-other-project', f => f.state.items.get(400).fields['System.TeamProject'] = 'other', /ownership/],
  ['missing-linked-item', f => f.state.items.delete(102), /omitted/],
  ['incomplete-category', f => f.state.category = {referenceName: 'Microsoft.TestCaseCategory', workItemTypes: []}, /category/],
  ['wrong-category', f => f.state.category.referenceName = 'Microsoft.RequirementCategory', /category/],
  ['unclassified-item', f => delete f.state.items.get(102).fields['System.WorkItemType'], /classification/],
  ['ownership-flip', f => { let calls = 0; const base = f.state.fault; f.state.fault = context => { if (context.path === 'wit/workitemsbatch' && ++calls === 2) f.state.items.get(102).fields['System.TeamProject'] = 'other'; return base(context); }; }, /ownership/],
  ['too-many-cases', f => { f.state.items.get(400).relations = []; for (let id = 1000; id <= 1500; id++) { f.state.items.set(id, {...structuredClone(f.state.items.get(101)), id}); f.state.items.get(400).relations.push(link(f, testedBy, id)); } }, /1–500/],
  ['too-many-links', f => f.state.items.get(400).relations = Array.from({length: 1001}, (_, index) => link(f, testedBy, 2000 + index)), /bounded scope/]
]) test(`story retrieval refuses ${mode} without reading excluded or partial content`, async t => {
  const f = await storyFixture(t); change(f);
  await assert.rejects(createAdoTestSource(f.client).fetchStory(400), pattern);
  assert.equal(contentReads(f).length, mode === 'ownership-flip' ? 1 : 0); assert(batches(f).every(req => contentReads(f).includes(req) || String(req.body.fields) === String(discoveryFields)));
  assert.equal(writes(f).length, 0);
});
test('story retrieval validates its ID and link selection before any request', async t => {
  const f = await storyFixture(t), source = createAdoTestSource(f.client);
  for (const [story, links] of [[0], ['x'], [400, []], [400, ['parent']], [400, ['tested-by', 'tested-by']], [400, 'tested-by']]) await assert.rejects(source.fetchStory(story, links));
  assert.equal(f.state.requests.length, 0);
});
test('story and suite retrieval share one case reader, including nested shared steps', async t => {
  const f = await storyFixture(t); f.state.items.set(300, {id: 300, fields: {'System.TeamProject': 'demo', 'Microsoft.VSTS.TCM.Steps': xml('Shared action', 'Shared expected')}}); f.state.items.get(101).fields['Microsoft.VSTS.TCM.Steps'] = '<steps><compref ref="300"/></steps>';
  const source = createAdoTestSource(f.client), suite = await source.fetchSuite(1, 2), story = await source.fetchStory(400);
  assert.deepEqual(story.cases, suite.cases); assert.equal(story.cases[0].steps[0].fromShared, 300);
});
test('story conversion yields an ado-story neutral source and loads only through an unambiguous selection', async t => {
  const f = await storyFixture(t), source = createAdoTestSource(f.client), neutral = adoStoryToSource(await source.fetchStory(400));
  assert.deepEqual([neutral.id, neutral.title, neutral.scenarios.map(scenario => scenario.id)], ['ado-story-400', 'Synthetic story', ['tc-101', 'tc-102']]);
  assert.deepEqual(await loadTestSource(f.roots, {kind: 'ado', storyId: 400}, source), neutral);
  assert.deepEqual(await loadTestSource(f.roots, {kind: 'ado', planId: 1, suiteId: 2}, source), adoSuiteToSource(await source.fetchSuite(1, 2)));
  await assert.rejects(loadTestSource(f.roots, {kind: 'ado', storyId: 400, planId: 1, suiteId: 2}, source), /suite or story/);
});
test('relation targets resolve only in configured collection forms, exactly as relink matches them', async t => {
  const f = await adoFixture(t), org = f.config.organizationUrl, project = await f.client.projectIdentity(), management = createAdoTestManagement(f.client);
  const accepted = [`${org}/_apis/wit/workItems/200`, `${org}/demo/_apis/wit/workitems/200/`, `${org.toUpperCase()}/${project.id.toUpperCase()}/_apis/wit/workItems/200`];
  const refused = ['https://other.invalid/collection/_apis/wit/workItems/200', `${org}/other/_apis/wit/workItems/200`, `${org}/_apis/wit/workItems/0200`, `${org}/_apis/wit/workItems/200/updates`, `${org}/_apis/wit/workItems/2147483648`, `${org}/_apis/wit/workItems/201`];
  for (const url of accepted) assert.equal(workItemLinkId(url, org, project), 200, url);
  for (const url of refused) assert.notEqual(workItemLinkId(url, org, project), 200, url);
  assert.equal(workItemLinkId(undefined, org, project), undefined); assert.equal(workItemLinkId(`${org}/_apis/wit/workItems/201`, org, project), 201);
  for (const url of [...accepted, ...refused]) {
    f.state.items.get(201).relations = [{rel: 'System.LinkTypes.Hierarchy-Reverse', url}];
    assert.equal(await management.relink({ids: [201], storyId: 200}).then(() => true, () => false), workItemLinkId(url, org, project) === 200, url);
  }
});
test('story specs differ from suite specs only in their source and generator lines', () => {
  const common = {tc: {id: 101, title: 'Synthetic case', tags: [], steps: [{kind: 'step', type: 'ActionStep', action: 'Open', expected: 'Shown'}], parameters: null, dataTable: null}, target: '', org: 'https://ado.example.test/collection', project: 'demo'};
  const suite = renderSpec({...common, planId: 1, suiteId: 2, suiteName: 'Synthetic suite'}).split('\n'), story = renderSpec({...common, storyId: 400, storyTitle: 'Synthetic story'}).split('\n');
  assert.equal(story.length, suite.length); assert.deepEqual(suite.flatMap((line, index) => line === story[index] ? [] : [index]), [4, 5]);
  assert.equal(story[4], 'Source: Azure DevOps TC 101 — story 400 (Synthetic story) — org https://ado.example.test/collection, project demo'); assert.match(story[5], /GENERATED by scripts\/fetch-ado-story\.mjs/);
});
test('preview reads complete points and never mutates or creates a receipt', async t => {
  const f = await adoFixture(t), result = await publish(f); assert.equal(result.cases.length, 2); assert.equal(writes(f).length, 0); assert.equal(f.receipts().length, 0);
});
test('publication writes one run, verifies exact results and completion, and flushes sanitized receipts', async t => {
  const f = await adoFixture(t); let receiptAtDispatch = false;
  f.state.fault = ({req}) => { if (req.method !== 'GET') receiptAtDispatch = f.receipts()[0]?.at(-1).event === 'dispatching'; return false; };
  const result = await publish(f, {execute: true}); assert.equal(result.runId, 55); assert.equal(writes(f).length, 3); assert.equal(receiptAtDispatch, true);
  const events = f.receipts()[0]; assert.equal(events.at(-1).event, 'completed'); assert.equal(events.filter(event => event.event === 'dispatching').length, 3); assert(!JSON.stringify(events).includes(f.credential)); assert(!JSON.stringify(events).includes('Authorization'));
});
for (const mode of ['missing-point', 'ambiguous-point', 'missing-result', 'wrong-readback', 'lost-write']) {
  test(`publication stops on ${mode}, keeps partial history, and never retries writes`, async t => {
    const f = await adoFixture(t);
    if (mode === 'missing-point') f.state.points.pop();
    if (mode === 'ambiguous-point') f.state.points.push({id: 13, testCase: {id: '101'}});
    f.state.fault = ({path, req, res, send}) => {
      if (mode === 'lost-write' && req.method === 'POST') {res.destroy(); return true;}
      if (mode === 'missing-result' && path.endsWith('/results')) {send({value: []}); return true;}
      if (mode === 'wrong-readback' && path.endsWith('/results') && req.method === 'GET' && f.state.results[0]?.outcome) f.state.results[0].outcome = 'Failed';
      return false;
    };
    await assert.rejects(publish(f, {execute: true}));
    if (mode.endsWith('point')) assert.equal(writes(f).length, 0);
    else {assert.notEqual(f.receipts()[0].at(-1).event, 'completed'); assert.equal(writes(f).filter(req => req.method === 'POST').length, 1);}
    if (mode === 'lost-write') assert(f.receipts()[0].some(event => event.effect === 'uncertain'));
  });
}
test('explicit point mapping resolves multiple configurations without dropping cases', async t => {const f = await adoFixture(t); f.state.points.push({id: 13, testCase: {id: '101'}}); assert.equal((await publish(f, {pointIds: {101: 13}})).cases[0].pointId, 13);});
test('arbitrary verdict arrays cannot bypass result validation', async t => {const f = await adoFixture(t); await assert.rejects(publish(f, {publication: [{caseId: 101, status: 'PASS'}]}), /validated/); assert.equal(f.state.requests.length, 0);});
test('M5 publication preserves recovered pass and verifies evidence before contacting ADO', async t => {
  const f = await adoFixture(t); retry(f); const rows = prepareRunPublication(f.run, f.roots, f.report, {'case-1': 101}); assert.equal(rows[0].stability, 'recovered'); assert.equal(rows[0].status, 'PASS');
  writeFileSync(join(f.roots.runRoot, f.report.evidence[0].path), 'changed'); assert.throws(() => prepareRunPublication(f.run, f.roots, f.report, {'case-1': 101})); assert.equal(f.state.requests.length, 0);
});
for (const change of [s => s.cases['101'].greens = 1, s => s.cases['101'].status = 'pending-confirmation', s => delete s.cases['102'], s => s.cases['999'] = {status: 'passed', greens: 2}, s => s.cases['102'].classification = 'invented']) {
  test(`legacy verification refuses incomplete scope or verdict: ${change}`, () => {const {manifest, state} = legacy(); change(state); assert.throws(() => prepareLegacyPublication(manifest, state));});
}
test('tag updates retain existing tags, use revision tests, verify reads and skip duplicates', async t => {
  const f = await adoFixture(t), adapter = createAdoTestManagement(f.client);
  assert.equal((await adapter.tag({ids: [101], tag: 'synthetic'})).mode, 'dry-run'); assert.equal(writes(f).length, 0);
  assert.equal((await adapter.tag({ids: [101], tag: 'synthetic', execute: true})).mode, 'execute'); assert.equal(writes(f)[0].body[0].path, '/rev');
  assert.equal((await adapter.tag({ids: [101], tag: 'synthetic', execute: true})).mode, 'no-op'); assert.equal(writes(f).length, 1);
});
test('concurrent work-item revision conflict leaves update incomplete without replay', async t => {
  const f = await adoFixture(t); f.state.fault = ({req, path, send}) => {if (req.method === 'PATCH' && path.startsWith('wit/')) {send({}, 412); return true;}};
  await assert.rejects(createAdoTestManagement(f.client).tag({ids: [101, 102], tag: 'synthetic', execute: true}), /incomplete/); assert.equal(writes(f).length, 1); assert.equal(f.receipts()[0].at(-1).event, 'verification-incomplete');
});
test('relation conversion preserves unrelated links and verifies exact collection identity', async t => {
  const f = await adoFixture(t), management = createAdoTestManagement(f.client);
  await management.relink({ids: [201], storyId: 200, execute: true}); assert(f.state.items.get(201).relations.some(r => r.rel === 'AttachedFile')); assert.equal((await management.relink({ids: [201], storyId: 200, execute: true})).mode, 'no-op');
  f.state.items.get(201).relations = [{rel: 'System.LinkTypes.Hierarchy-Reverse', url: 'https://other.invalid/_apis/wit/workitems/200'}]; await assert.rejects(management.relink({ids: [201], storyId: 200, execute: true}), /matching story/);
});
test('automation marking needs verified script identity and has no private custom field fallback', async t => {
  const f = await adoFixture(t), management = createAdoTestManagement(f.client);
  await assert.rejects(management.markAutomation({publication: publication(), tests: {}, execute: true}), /pointer/); assert.equal(writes(f).length, 0);
  const tests = {101: {title: 'Synthetic positive', file: 'tests/SyntheticTests.spec.ts'}, 102: {title: 'Synthetic defect', file: 'tests/SyntheticTests.spec.ts'}};
  await management.markAutomation({publication: publication(), tests, execute: true}); assert.equal(writes(f).length, 2); assert(writes(f).every(req => req.body.every(op => !op.path.includes('Custom.'))));
});
test('PR delivery uses repository default main, checks both refs, previews and verifies writes', async t => {
  const f = await adoFixture(t), adapter = createAdoSourceControl(f.client), input = {repository: 'harness', source: 'feature/synthetic', title: 'Synthetic change', description: 'Synthetic description'};
  const preview = await adapter.createPullRequest(input); assert.equal(preview.target, 'main'); assert.equal(writes(f).length, 0);
  const result = await adapter.createPullRequest({...input, execute: true}); assert.equal(result.id, 77); assert.equal(writes(f).length, 1); assert.equal(f.receipts()[0].at(-1).event, 'completed');
});
test('PR delivery refuses unknown repository and missing refs before mutation', async t => {
  const f = await adoFixture(t), adapter = createAdoSourceControl(f.client), input = {source: 'feature/synthetic', title: 'Synthetic', description: 'Synthetic'};
  await assert.rejects(adapter.createPullRequest(input), /repository/);
  f.state.fault = ({path, send}) => {if (path.endsWith('/refs')) {send({value: []}); return true;}};
  await assert.rejects(adapter.createPullRequest({...input, repository: 'harness', execute: true}), /branches/); assert.equal(writes(f).length, 0);
});
test('all six entrypoints reject package-as-consumer without network', () => {
  for (const name of ['fetch-ado-suite', 'fetch-ado-story', 'publish-ado-results', 'ado-pr', 'tag-ado-workitem', 'relink-ado-story']) {
    const result = spawnSync(process.execPath, [join(packageRoot, `scripts/${name}.mjs`), '--project-root', packageRoot], {encoding: 'utf8'}); assert.notEqual(result.status, 0); assert.match(result.stderr, /separate consumer/);
  }
});
test('compatibility fetch preserves refined files, exports neutral source and invalidates stale verification', async t => {
  const f = await adoFixture(t); configure(f);
  await cli(f, 'fetch-ado-suite', ['--plan', '1', '--suite', '2', '--source-out', 'scenarios/source.json']);
  const manifestPath = 'test/ado-suite-2/_suite.json', manifest = JSON.parse(readFileSync(join(f.roots.projectRoot, manifestPath)));
  put(f.roots.projectRoot, `test/ado-suite-2/${manifest.cases[0].specFile}`, '## Refinement log\nPreserved user work');
  await cli(f, 'fetch-ado-suite', ['--plan', '1', '--suite', '2']); assert.match(readFileSync(join(f.roots.projectRoot, `test/ado-suite-2/${manifest.cases[0].specFile}`), 'utf8'), /Preserved/);
  put(f.roots.projectRoot, 'test/ado-suite-2/_verify-state.json', legacy().state);
  await assert.rejects(cli(f, 'publish-ado-results', ['--suite', '2', '--execute']), /fingerprint/); assert.equal(writes(f).length, 0);
  put(f.roots.projectRoot, 'test/ado-suite-2/_verify-state.json', {...legacy().state, sourceFingerprint: manifest.sourceFingerprint});
  assert.equal((await cli(f, 'publish-ado-results', ['--suite', '2'])).mode, 'dry-run'); assert.equal(writes(f).length, 0);
});
test('suite fetch keeps its exact requests, fingerprint, manifest layout, spec text and neutral source', async t => {
  const f = await adoFixture(t); configure(f);
  const result = await cli(f, 'fetch-ado-suite', ['--plan', '1', '--suite', '2', '--source-out', 'scenarios/source.json']), read = path => readFileSync(join(f.roots.projectRoot, path), 'utf8');
  assert.deepEqual(f.state.requests.map(req => `${req.method} ${req.path}${req.query}`), ['GET testplan/plans/1/suites/2?api-version=7.1', 'GET testplan/plans/1/suites/2/testcase?api-version=7.1&excludeFlags=0',
    'GET testplan/plans/1/suites/2/testcase?api-version=7.1&excludeFlags=0&continuationToken=second', 'POST wit/workitemsbatch?api-version=7.1', 'GET projects/demo?api-version=7.1']);
  assert.deepEqual(f.state.requests[3].body, {ids: [101, 102], fields: ['System.Id', 'System.Title', 'System.TeamProject', 'System.State', 'System.Tags', 'Microsoft.VSTS.Common.Priority', 'Microsoft.VSTS.TCM.Steps', 'Microsoft.VSTS.TCM.Parameters', 'Microsoft.VSTS.TCM.LocalDataSource'], errorPolicy: 'fail'});
  assert.deepEqual(Object.entries(result), Object.entries({mode: 'fetched', cases: 2, files: ['test/ado-suite-2/tc-101-synthetic-case-101.md', 'test/ado-suite-2/tc-102-synthetic-case-102.md', 'scenarios/source.json', 'test/ado-suite-2/_suite.json'],
    sourceFingerprint: 'cec6cecf20ab55bea9d9a166c2a7d691be35db5f52217c28c298271bfd9b5dba'}));
  const manifest = JSON.parse(read('test/ado-suite-2/_suite.json'));
  assert.deepEqual(Object.keys(manifest), ['planId', 'suiteId', 'suiteName', 'organizationUrl', 'project', 'cases', 'org', 'orgUrl', 'sourceFingerprint', 'environment', 'target', 'fetchedAt', 'suggestedFeature', 'suggestedSpecFile', 'suggestedDataFile']);
  assert.deepEqual(Object.keys(manifest.cases[0]), ['id', 'title', 'state', 'priority', 'tags', 'steps', 'parameters', 'dataTable', 'specFile', 'stepCount', 'preservedRefinement']);
  assert.equal(read('test/ado-suite-2/tc-101-synthetic-case-101.md'), ['# Spec: Synthetic case 101  (TC 101)', '', 'Target: https://example.com  <!-- set portalUrl in environments/<env>.json -->', 'Type: existing — stateful chain',
    'Source: Azure DevOps TC 101 — plan 1, suite 2 (Synthetic suite) — org https://ado.example.test/collection, project demo', '<!-- GENERATED by scripts/fetch-ado-suite.mjs (raw fetch). The automate-test REFINE phase',
    '     may restructure steps for executability (scope preserved, changes logged below).', '     Refetch keeps files with a "## Refinement log" — overwrite only with --force. -->', '', '## Acceptance criteria', '- Synthetic record is visible', '',
    '## Scenario steps  (stateful — run in order, in one session)', '1. Open synthetic record — Expected: Synthetic record is visible', '', '## Notes', '- This spec mirrors Azure DevOps test case 101; report defects against it.', ''].join('\n'));
  assert.equal(read('scenarios/source.json'), JSON.stringify({version: 1, id: 'ado-1-2', title: 'Synthetic suite', scenarios: [101, 102].map(id => ({id: `tc-${id}`, title: `Synthetic case ${id}`, externalReferences: [{system: 'ado', id: String(id)}],
    steps: [{action: 'Open synthetic record', expected: ['Synthetic record is visible']}]}))}, null, 2) + '\n');
});
test('story fetch writes its folder and source, preserves refinement and fingerprints only included content', async t => {
  const f = await storyFixture(t); configure(f);
  const read = path => readFileSync(join(f.roots.projectRoot, path), 'utf8'), manifest = () => JSON.parse(read('test/ado-story-400/_suite.json')), spec = 'test/ado-story-400/tc-101-synthetic-case-101.md';
  const first = await cli(f, 'fetch-ado-story', ['--story', '400', '--links', 'child,tested-by', '--source-out', 'scenarios/story.json']);
  assert.deepEqual(first.files, [spec, 'test/ado-story-400/tc-102-synthetic-case-102.md', 'scenarios/story.json', 'test/ado-story-400/_suite.json']); assert.deepEqual(first.excluded, [{id: 403, reason: 'not-test-case'}]);
  assert.deepEqual(Object.keys(manifest()), ['storyId', 'storyTitle', 'links', 'organizationUrl', 'project', 'cases', 'excluded', 'org', 'orgUrl', 'sourceFingerprint', 'environment', 'target', 'fetchedAt', 'suggestedFeature', 'suggestedSpecFile', 'suggestedDataFile']);
  assert.deepEqual([manifest().links, manifest().suggestedSpecFile, manifest().sourceFingerprint, JSON.parse(read('scenarios/story.json')).id], [['tested-by', 'child'], 'tests/SyntheticStoryTests.spec.ts', first.sourceFingerprint, 'ado-story-400']);
  assert.match(read(spec), /^Source: Azure DevOps TC 101 — story 400 \(Synthetic story\) — org https:\/\/ado\.example\.test\/collection, project demo$/m);
  put(f.roots.projectRoot, spec, '## Refinement log\nPreserved user work');
  f.state.items.set(405, {...structuredClone(f.state.items.get(403)), id: 405}); f.state.items.get(400).relations.push(link(f, 'System.LinkTypes.Hierarchy-Forward', 405));
  const second = await cli(f, 'fetch-ado-story', ['--story', '400', '--links', 'tested-by,child']);
  assert.equal(second.sourceFingerprint, first.sourceFingerprint); assert.deepEqual(manifest().excluded.map(item => item.id), [403, 405]);
  assert.match(read(spec), /Preserved/); assert.equal(manifest().cases[0].preservedRefinement, true);
  f.state.items.get(400).fields['System.Title'] = 'Renamed story';
  const renamed = await cli(f, 'fetch-ado-story', ['--story', '400', '--links', 'tested-by,child', '--force']);
  assert.notEqual(renamed.sourceFingerprint, first.sourceFingerprint); assert.doesNotMatch(read(spec), /Preserved/); assert.equal(manifest().storyTitle, 'Renamed story');
});
test('story fetch refuses a manifest for another destination, suite or story before writing', async t => {
  const f = await storyFixture(t); configure(f);
  for (const previous of [{orgUrl: f.config.organizationUrl, project: 'demo', storyId: 400, planId: 1, suiteId: 2}, {orgUrl: 'https://other.invalid/collection', project: 'demo', storyId: 400}, {orgUrl: f.config.organizationUrl, project: 'other', storyId: 400}, {orgUrl: f.config.organizationUrl, project: 'demo', storyId: 401}]) {
    put(f.roots.projectRoot, 'test/ado-story-400/_suite.json', previous); await assert.rejects(cli(f, 'fetch-ado-story', ['--story', '400']), /Story manifest/);
  }
  assert.equal(existsSync(join(f.roots.projectRoot, 'test/ado-story-400/tc-101-synthetic-case-101.md')), false);
});
test('story fetch previews, refuses unconvertible sources and rejects unsupported options without writing', async t => {
  const f = await storyFixture(t), folder = join(f.roots.projectRoot, 'test/ado-story-400'); configure(f);
  assert.equal((await cli(f, 'fetch-ado-story', ['--story', '400', '--dry-run'])).mode, 'dry-run'); assert.equal(existsSync(folder), false);
  f.state.items.get(101).fields['Microsoft.VSTS.TCM.Parameters'] = '<parameters><param name="input"/></parameters>';
  await assert.rejects(cli(f, 'fetch-ado-story', ['--story', '400', '--source-out', 'scenarios/story.json']), /refinement/);
  for (const [args, pattern] of [[['--story', '400', '--plan', '1'], /Unknown/], [[], /--story/], [['--story', '400', '--links', 'parent'], /Story links/], [['--story', '400', '--links', 'tested-by,'], /Story links/]]) await assert.rejects(cli(f, 'fetch-ado-story', args), pattern);
  assert.equal(existsSync(folder), false); assert.equal(existsSync(join(f.roots.projectRoot, 'scenarios')), false); assert.equal(writes(f).length, 0);
});
test('compatibility commands use consumer config and every write is opt-in', async t => {
  const f = await adoFixture(t); configure(f);
  assert.equal((await cli(f, 'tag-ado-workitem', ['--id', '101', '--tag', 'synthetic'])).mode, 'dry-run');
  assert.equal((await cli(f, 'relink-ado-story', ['--id', '201', '--story', '200'])).mode, 'dry-run');
  assert.equal((await cli(f, 'ado-pr', ['--repository', 'harness', '--source', 'feature/synthetic', '--title', 'Synthetic', '--description', 'Synthetic'])).mode, 'dry-run'); assert.equal(writes(f).length, 0);
  await cli(f, 'tag-ado-workitem', ['--id', '101', '--tag', 'synthetic', '--execute']); assert.equal(writes(f).length, 1);
});
test('receipt path junction outside consumer refuses mutation', async t => {
  const f = await adoFixture(t), outside = fixture(t).roots.projectRoot;
  mkdirSync(join(f.roots.projectRoot, '.harness/state'), {recursive: true}); symlinkSync(outside, join(f.roots.projectRoot, '.harness/state/integrations'), 'junction');
  await assert.rejects(publish(f, {execute: true})); assert.equal(writes(f).length, 0); assert.equal(existsSync(join(outside, 'integrations')), false);
});

test('all five neutral statuses retain semantics, including review-required versus blocked', () => {
  const statuses = ['passed', 'failed', 'blocked', 'skipped', 'needs-review'], manifest = {cases: statuses.map((_, i) => ({id: i + 1}))};
  const rows = prepareLegacyPublication(manifest, {cases: Object.fromEntries(statuses.map((status, i) => [i + 1, {status, greens: 2}]))});
  assert.deepEqual(rows.map(row => row.outcome), ['Passed', 'Failed', 'Blocked', 'NotExecuted', 'Blocked']);
  assert.match(rows[4].comment, /NEEDS_REVIEW/); assert.match(rows[2].comment, /BLOCKED/);
});
test('receipt exists before dispatch and unresolved credentials record no executed effect', async t => {
  const f = fixture(t), client = createAdoClient({roots: f.roots, configuration: {organizationUrl: 'https://ado.example.test', project: 'demo', credentialRef: 'ADO_TEST_CREDENTIAL'}, resolveCredential: () => undefined, fetchImpl: () => { throw new Error('must not dispatch'); }});
  assert.throws(() => client.delivery('tags', false), /authorization/);
  const delivery = client.delivery('tags', true); await assert.rejects(delivery.write('update-work-item', 'wit/workitems/101?api-version=7.1', []));
  const events = readFileSync(join(f.roots.projectRoot, delivery.receipt), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(events.at(-1).effect, 'not-executed'); assert(!events.some(event => event.event === 'dispatching'));
});
test('acknowledged work-item write with wrong readback stays incomplete', async t => {
  const f = await adoFixture(t); f.state.fault = ({req, path, send}) => {
    if (req.method === 'GET' && path === 'wit/workitems/101' && writes(f).length) { send({...f.state.items.get(101), fields: {'System.Tags': 'wrong'}}); return true; }
  };
  await assert.rejects(createAdoTestManagement(f.client).tag({ids: [101], tag: 'synthetic', execute: true}), /verification incomplete/);
  assert.equal(writes(f).length, 1); assert(f.receipts()[0].some(event => event.event === 'acknowledged')); assert.equal(f.receipts()[0].at(-1).event, 'verification-incomplete');
});
test('lost PR response records uncertainty and never issues a second create', async t => {
  const f = await adoFixture(t); f.state.fault = ({path, req, res}) => {if (path.endsWith('/pullrequests') && req.method === 'POST') {res.destroy(); return true;}};
  await assert.rejects(createAdoSourceControl(f.client).createPullRequest({repository: 'harness', source: 'feature/synthetic', title: 'Synthetic', description: 'Synthetic', execute: true}), /incomplete/);
  assert.equal(writes(f).length, 1); assert(f.receipts()[0].some(event => event.effect === 'uncertain'));
});
test('consumer fetch rejects conflicting destination and escaping output before filesystem writes', async t => {
  const f = await adoFixture(t); configure(f);
  await assert.rejects(cli(f, 'fetch-ado-suite', ['--plan', '1', '--suite', '2', '--out', '../escape']));
  assert.equal(existsSync(join(f.roots.projectRoot, 'test')), false);
  put(f.roots.projectRoot, 'test/ado-suite-2/_suite.json', {orgUrl: 'https://other.invalid', project: 'demo', planId: 1, suiteId: 2});
  await assert.rejects(cli(f, 'fetch-ado-suite', ['--plan', '1', '--suite', '2']), /destination/);
});
test('parameter data remains lossless in compatibility retrieval while neutral export refuses it before writes', async t => {
  const f = await adoFixture(t); configure(f); const data = '<NewDataSet><Table1><Name>Alpha</Name></Table1></NewDataSet>';
  f.state.items.get(101).fields['Microsoft.VSTS.TCM.LocalDataSource'] = data;
  await assert.rejects(cli(f, 'fetch-ado-suite', ['--plan', '1', '--suite', '2', '--source-out', 'source.json']), /refinement/);
  assert.equal(existsSync(join(f.roots.projectRoot, 'test')), false);
  await cli(f, 'fetch-ado-suite', ['--plan', '1', '--suite', '2']);
  const tc = JSON.parse(readFileSync(join(f.roots.projectRoot, 'test/ado-suite-2/_suite.json'))).cases[0]; assert.equal(tc.dataTableXml, data); assert.deepEqual(tc.dataTable, [{Name: 'Alpha'}]);
});

for (const mode of ['foreign', 'missing', 'shared-foreign']) {
  test(`retrieval and work-item updates reject ${mode} project ownership`, async t => {
    const f = await adoFixture(t);
    if (mode === 'shared-foreign') {
      f.state.items.set(300, {id: 300, fields: {'System.TeamProject': 'elsewhere', 'Microsoft.VSTS.TCM.Steps': xml()}});
      f.state.items.get(101).fields['Microsoft.VSTS.TCM.Steps'] = '<steps><compref ref="300"/></steps>';
    } else f.state.items.get(101).fields['System.TeamProject'] = mode === 'foreign' ? 'elsewhere' : undefined;
    await assert.rejects(createAdoTestSource(f.client).fetchSuite(1, 2), /project ownership/);
    if (mode !== 'shared-foreign') await assert.rejects(createAdoTestManagement(f.client).tag({ids: [101], tag: 'synthetic', execute: true}), /project ownership/);
    assert.equal(writes(f).length, 0);
  });
}
test('GUID configuration resolves the same project name and guards mutation ownership', async t => {
  const f = await adoFixture(t, {project: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'});
  const source = await createAdoTestSource(f.client).fetchSuite(1, 2); assert.equal(source.cases.length, 2);
  await createAdoTestManagement(f.client).tag({ids: [101], tag: 'synthetic', execute: true}); assert.equal(writes(f).length, 1);
  assert.equal(f.state.requests.filter(req => req.path.startsWith('projects/')).length, 1);
  f.state.items.get(102).fields['System.TeamProject'] = 'elsewhere';
  await assert.rejects(createAdoTestManagement(f.client).tag({ids: [102], tag: 'synthetic', execute: true}), /project ownership/); assert.equal(writes(f).length, 1);
});
test('mismatched project identity and repository ownership fail before writes', async t => {
  const f = await adoFixture(t); f.state.project = {...f.state.project, name: 'elsewhere'};
  await assert.rejects(createAdoTestManagement(f.client).tag({ids: [101], tag: 'synthetic', execute: true}), /project identity/);
  f.state.project.name = 'demo'; f.state.repository.project = {...f.state.project, id: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff'};
  await assert.rejects(createAdoSourceControl(f.client).createPullRequest({repository: 'harness', source: 'feature/synthetic', title: 'Synthetic', description: 'Synthetic', execute: true}), /another configured project/); assert.equal(writes(f).length, 0);
});
for (const mode of ['swap', 'wrong-run', 'wrong-case']) {
  test(`publication rejects ${mode} association without completing the run`, async t => {
    const f = await adoFixture(t); let changed = false;
    f.state.fault = ({path, req}) => {
      if (!changed && req.method === 'GET' && path.endsWith('/results') && f.state.results[0]?.outcome) {
        changed = true;
        if (mode === 'swap') [f.state.results[0].testPoint, f.state.results[1].testPoint] = [f.state.results[1].testPoint, f.state.results[0].testPoint];
        if (mode === 'wrong-run') f.state.results[0].testRun = {id: '56'};
        if (mode === 'wrong-case') f.state.results[0].testCase = {id: '102'};
      }
    };
    await assert.rejects(publish(f, {execute: true}), /incomplete/); assert.equal(f.state.run.state, 'InProgress'); assert.equal(writes(f).length, 2);
  });
}
test('final result readback after completing a run must still match the verified publication', async t => {
  const f = await adoFixture(t); f.state.fault = ({req, path}) => {if (req.method === 'GET' && path.endsWith('/results') && f.state.run?.state === 'Completed') f.state.results[0].outcome = 'Failed';};
  await assert.rejects(publish(f, {execute: true}), /incomplete/); assert.equal(f.receipts()[0].at(-1).event, 'verification-incomplete');
});
test('partial work-item delivery records each known identity before its dispatch, including a lost response', async t => {
  const f = await adoFixture(t); f.state.fault = ({req, path, res}) => {if (req.method === 'PATCH' && path === 'wit/workitems/102') {res.destroy(); return true;}};
  await assert.rejects(createAdoTestManagement(f.client).tag({ids: [101, 102], tag: 'synthetic', execute: true}), /incomplete/);
  const events = f.receipts()[0], dispatched = events.flatMap((event, index) => event.event === 'dispatching' ? [index] : []);
  assert.equal(dispatched.length, 2);
  assert.equal(events.slice(0, dispatched[0]).findLast(event => event.event === 'identified').identity.workItemId, 101);
  assert.equal(events.slice(0, dispatched[1]).findLast(event => event.event === 'identified').identity.workItemId, 102);
  assert(events.some(event => event.event === 'verified' && event.identity.workItemId === 101)); assert(events.some(event => event.effect === 'uncertain'));
});
test('compatibility automation supports spaces and Unicode while rejecting unsafe relative pointers', async t => {
  const f = await adoFixture(t); configure(f);
  const file = 'tests/Customer Portal/واجهة/CustomerTests.spec.ts';
  put(f.roots.projectRoot, file, "test('Synthetic positive', async () => { allure.tms('101'); });\ntest('Synthetic defect', async () => { allure.tms('102'); });\n");
  const data = legacy(); put(f.roots.projectRoot, 'test/ado-suite-2/_suite.json', {...data.manifest, orgUrl: f.config.organizationUrl, project: f.config.project, planId: 1, suiteId: 2, resolvedSpecFiles: [file]}); put(f.roots.projectRoot, 'test/ado-suite-2/_verify-state.json', data.state);
  assert.equal((await cli(f, 'publish-ado-results', ['--suite', '2', '--mark-automated'])).mode, 'dry-run');
  assert.equal((await cli(f, 'publish-ado-results', ['--suite', '2', '--mark-automated', '--execute'])).mode, 'execute');
  assert.equal(f.state.items.get(101).fields['Microsoft.VSTS.TCM.AutomatedTestStorage'], file);
  for (const unsafe of ['/tmp/Bad.spec.ts', '../Bad.spec.ts', 'C:/Bad.spec.ts', 'tests/../Bad.spec.ts', 'tests//Bad.spec.ts']) {
    await assert.rejects(createAdoTestManagement(f.client).markAutomation({publication: publication(), tests: {101: {title: 'Synthetic', file: unsafe}, 102: {title: 'Synthetic', file}}, execute: true}), /pointer/);
  }
  assert.equal(writes(f).length, 2);
});
test('remote diagnostics preserve safe categories and HTTP status while local IO stays redacted', () => {
  for (const code of ['authentication-rejected', 'redirect-refused', 'timeout', 'request-rejected']) assert.match(compatibilityDiagnostic(new AdoError(code, 401)), new RegExp(`ADO ${code}.*401`));
  assert.doesNotMatch(compatibilityDiagnostic(Object.assign(new Error('private path detail'), {code: 'ENOENT'})), /private path/);
});
test('real compatibility entrypoint reports remote rejection without leaking body or credential', async t => {
  const f = fixture(t), credential = crypto.randomUUID(), environment = {...process.env, ADO_TEST_CREDENTIAL: credential};
  put(f.roots.projectRoot, '.harness/integrations.json', {version: 1, ado: {organizationUrl: 'https://ado.example.test', project: 'demo', credentialRef: 'ADO_TEST_CREDENTIAL'}});
  const loader = join(f.roots.projectRoot, 'fixture-loader.mjs'); writeFileSync(loader, "globalThis.fetch = async () => new Response(process.env.ADO_TEST_CREDENTIAL, {status: 401});\n");
  const {pathToFileURL} = await import('node:url');
  const result = spawnSync(process.execPath, ['--import', pathToFileURL(loader).href, join(packageRoot, 'scripts/tag-ado-workitem.mjs'), '--project-root', f.roots.projectRoot, '--id', '101', '--tag', 'synthetic'], {encoding: 'utf8', env: environment});
  assert.equal(result.status, 1); assert.match(result.stderr, /ADO authentication-rejected.*401/); assert(!result.stderr.includes(credential)); assert.doesNotMatch(result.stderr, /Local input/);
});
test('PR source guard honors a non-main default branch despite an explicit target override', async t => {
  const f = await adoFixture(t); f.state.repository.defaultBranch = 'refs/heads/trunk';
  await assert.rejects(createAdoSourceControl(f.client).createPullRequest({repository: 'harness', source: 'trunk', target: 'release', title: 'Synthetic', description: 'Synthetic', execute: true}), /non-default feature branch/); assert.equal(writes(f).length, 0);
});
