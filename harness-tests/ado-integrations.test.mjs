import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync, readFileSync, mkdirSync, symlinkSync, existsSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {adoFixture, xml} from './fixtures/ado.mjs';
import {fixture, retry} from './fixtures/execution-core.mjs';
import {loadAdoConfiguration, validateAdoConfiguration} from '../scripts/lib/integrations/config.mjs';
import {createAdoTestSource, adoSuiteToSource, loadTestSource} from '../scripts/lib/integrations/ado-source.mjs';
import {createAdoTestManagement, prepareLegacyPublication, prepareRunPublication} from '../scripts/lib/integrations/ado-management.mjs';
import {createAdoSourceControl} from '../scripts/lib/integrations/ado-delivery.mjs';
import {runCompatibility, compatibilityDiagnostic} from '../scripts/lib/integrations/compatibility.mjs';
import {packageRoot} from '../scripts/lib/consumer-paths.mjs';
import {createAdoClient, AdoError} from '../scripts/lib/integrations/ado-client.mjs';

const put = (root, path, value) => { const file = join(root, path); mkdirSync(dirname(file), {recursive: true}); writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); };
const legacy = () => ({manifest: {cases: [{id: 101}, {id: 102}]}, state: {cases: {'101': {status: 'passed', greens: 2}, '102': {status: 'failed', classification: 'app-defect'}}}});
const publication = () => { const {manifest, state} = legacy(); return prepareLegacyPublication(manifest, state); };
const writes = f => f.state.requests.filter(req => req.method !== 'GET' && req.path !== 'wit/workitemsbatch');
const publish = (f, extra = {}) => createAdoTestManagement(f.client).publish({publication: publication(), planId: 1, suiteId: 2, ...extra});
function cli(f, command, args = []) { return runCompatibility(command, ['--project-root', f.roots.projectRoot, ...args], {fetchImpl: f.fetchImpl, environment: {[f.config.credentialRef]: f.credential}}); }
function configure(f) { put(f.roots.projectRoot, '.harness/integrations.json', {version: 1, ado: f.config}); }

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
  for (const change of [s => s.cases[0].parameters = '<parameters/>', s => s.cases[0].steps[0].expected = '', s => s.cases[0].steps[0].action = '']) { const copy = structuredClone(suite); change(copy); assert.throws(() => adoSuiteToSource(copy)); }
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
test('all five entrypoints reject package-as-consumer without network', () => {
  for (const name of ['fetch-ado-suite', 'publish-ado-results', 'ado-pr', 'tag-ado-workitem', 'relink-ado-story']) {
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
