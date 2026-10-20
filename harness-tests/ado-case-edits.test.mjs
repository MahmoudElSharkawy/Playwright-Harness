import test from 'node:test';
import assert from 'node:assert/strict';
import {adoFixture} from './fixtures/ado.mjs';
import {createAdoTestManagement} from '../scripts/lib/integrations/ado-management.mjs';
import {createAdoTestSource} from '../scripts/lib/integrations/ado-source.mjs';
import {editableSteps, editStepsXml} from '../scripts/lib/integrations/ado-step-edit.mjs';
import {parameterizedText, parseStepsXml} from '../scripts/lib/integrations/ado-steps.mjs';
import {createAdoClient} from '../scripts/lib/integrations/ado-client.mjs';
import {runCompatibility} from '../scripts/lib/integrations/compatibility.mjs';
import {packageRoot} from '../scripts/lib/consumer-paths.mjs';
import {writeFileSync, readFileSync, mkdirSync, symlinkSync, existsSync, cpSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

const steps = '<steps id="0" last="6"><step id="2" type="ActionStep"><parameterizedString isformatted="true">&lt;p&gt;Open &amp;amp; wait&lt;/p&gt;</parameterizedString><parameterizedString isformatted="true"/><description/></step><step id="4" type="ValidateStep"><parameterizedString isformatted="true">&lt;b&gt;Read&lt;/b&gt;</parameterizedString><parameterizedString isformatted="true">Old result</parameterizedString><description/></step><step id="6" type="ActionStep"><parameterizedString>Close</parameterizedString><parameterizedString/></step></steps>';
const proposal = (...cases) => ({version: 1, cases});
const writes = f => f.state.requests.filter(r => r.method === 'PATCH');
async function setup(t) {
  const f = await adoFixture(t);
  for (const item of f.state.items.values()) Object.assign(item.fields, {'System.WorkItemType': 'Test Case', 'Microsoft.VSTS.TCM.Steps': steps, 'Custom.Keep': 'unchanged'});
  f.state.fault = ({path, send}) => {if (path === 'wit/workitemtypecategories/microsoft.testcasecategory') {send({referenceName: 'Microsoft.TestCaseCategory', workItemTypes: [{name: 'Test Case'}]}); return true;}};
  return {...f, management: createAdoTestManagement(f.client)};
}
const put = (f, file, data) => {const path = join(f.roots.projectRoot, file); mkdirSync(dirname(path), {recursive: true}); writeFileSync(path, typeof data === 'string' ? data : JSON.stringify(data));};
const cli = (f, command, args) => runCompatibility(command, ['--project-root', f.roots.projectRoot, ...args], {fetchImpl: f.fetchImpl, environment: {[f.config.credentialRef]: f.credential}});
const apply = async (f, input) => f.management.editCases({input, execute: true, approval: (await f.management.editCases({input})).fingerprint});

test('case edits preview exact title changes without mutation and execute the reviewed plan only', async t => {
  const f = await setup(t), original = structuredClone(f.state.items.get(101));
  const input = proposal({id: 101, revision: 1, title: 'Updated عنوان'});
  const preview = await f.management.editCases({input});
  assert.equal(preview.mode, 'dry-run'); assert.equal(writes(f).length, 0); assert.equal(f.receipts().length, 0);
  assert.equal(preview.cases[0].before.title, original.fields['System.Title']);
  assert.equal(preview.cases[0].after.title, 'Updated عنوان');
  const result = await f.management.editCases({input, execute: true, approval: preview.fingerprint});
  assert.equal(result.mode, 'execute'); assert.equal(result.cases[0].status, 'completed');
  const after = structuredClone(f.state.items.get(101));
  assert.equal(after.rev, 2); after.rev = 1; after.fields['System.Title'] = original.fields['System.Title']; assert.deepEqual(after, original);
  assert.deepEqual(writes(f)[0].body, [{op: 'test', path: '/rev', value: 1}, {op: 'add', path: '/fields/System.Title', value: 'Updated عنوان'}]);
  assert.equal(f.receipts()[0].at(-1).event, 'completed');
});

test('combined step updates, insertion, removal and reordering preserve untouched XML and Unicode', async t => {
  const f = await setup(t), untouched = editableSteps(steps).rows[1].raw;
  const input = proposal({id: 101, revision: 1, title: 'Combined edit', steps: [
    {id: 4}, {id: 2, expected: {text: 'قيمة < 3 & > 1\nNext line 😀'}},
    {id: 9, action: {html: '<p>Open <b>عنوان</b> &amp; read<br/>again</p>'}, expected: {html: '<div dir="rtl">ظاهر</div>'}}
  ], removeStepIds: [6]});
  const preview = await f.management.editCases({input});
  assert.deepEqual(preview.cases[0].before.steps.map(row => row.id), [2, 4, 6]);
  assert.deepEqual(preview.cases[0].after.steps.map(row => row.id), [4, 2, 9]);
  assert.equal((await apply(f, input)).mode, 'execute');
  const saved = f.state.items.get(101).fields['Microsoft.VSTS.TCM.Steps'], parsed = editableSteps(saved);
  assert.equal(parsed.last, 9); assert.equal(parsed.rows[0].raw, untouched);
  assert.match(saved, /&lt; 3 &amp; &gt; 1/); assert.match(saved, /\nNext line 😀/);
  assert.equal(parsed.rows[1].node.attrs.type, 'ValidateStep');
  const refetched = await createAdoTestSource(f.client).fetchSuite(1, 2, {includeRevisions: true});
  assert.equal(refetched.cases[0].rev, 2); assert.equal(refetched.cases[0].title, 'Combined edit');
  assert.equal(refetched.cases[0].steps[1].expected, 'قيمة < 3 & > 1\nNext line 😀');
});

test('action-only edits preserve expected raw HTML, descriptions, step IDs and allocation history', () => {
  const source = steps.replace('Old result', '<DIV><P>Old &amp; result</P></DIV>');
  const before = editableSteps(source), expected = source.slice(before.rows[1].expected.start, before.rows[1].expected.end);
  const after = editStepsXml(source, {}, [{id: 2}, {id: 4, action: {text: 'Changed action'}}, {id: 6}]);
  assert(after.includes(expected)); assert(after.includes(before.rows[0].raw)); assert(after.includes(before.rows[2].raw));
  const reduced = editStepsXml(after, {}, [{id: 4}], [2, 6]); assert.equal(editableSteps(reduced).last, 6);
  assert.throws(() => editStepsXml(reduced, {}, [{id: 4}, {id: 6, action: {text: 'Cannot reuse'}, expected: {text: ''}}]), /above last/);
});

test('literal plain text survives preview, save and refetch without HTML stripping or double decoding', async t => {
  const f = await setup(t), action = 'Read <Admin> &amp; literal', expected = 'Expected literal <Admin> and &amp;\n  spacing';
  const input = proposal({id: 101, revision: 1, steps: [{id: 2, action: {text: action}, expected: {text: expected}}, {id: 4}, {id: 6}]});
  const preview = await f.management.editCases({input});
  assert.equal(preview.cases[0].after.steps[0].action, action); assert.equal(preview.cases[0].after.steps[0].expected, expected);
  assert.equal((await apply(f, input)).mode, 'execute');
  const saved = await createAdoTestSource(f.client).fetchSuite(1, 2, {includeRevisions: true});
  assert.equal(saved.cases[0].steps[0].action, action); assert.equal(saved.cases[0].steps[0].expected, expected);
  assert.throws(() => editableSteps(steps.replace('Old result', ']]>')));
  assert.equal(parameterizedText('&#38;lt;Admin&#38;gt;', false), '&lt;Admin&gt;');
  const numeric = steps.replace('isformatted="true">Old result', 'isformatted="false">&#38;lt;Admin&#38;gt;');
  assert.equal(parseStepsXml(numeric)[1].expected, '&lt;Admin&gt;');
});

test('title-only edits preserve shared, parameterized and opaque step/data metadata verbatim', async t => {
  const f = await setup(t), item = f.state.items.get(101);
  Object.assign(item.fields, {'Microsoft.VSTS.TCM.Steps': '<steps id="0" last="2"><compref id="2" ref="300"/></steps>', 'Microsoft.VSTS.TCM.Parameters': '<parameters><param name="User"/></parameters>', 'Microsoft.VSTS.TCM.LocalDataSource': '<NewDataSet><Table1><User>Private</User></Table1></NewDataSet>', 'Microsoft.VSTS.TCM.DataSource': 'shared-parameters'});
  const original = structuredClone(item);
  assert.equal((await apply(f, proposal({id: 101, revision: 1, title: 'Title only'}))).mode, 'execute');
  item.rev = 1; item.fields['System.Title'] = original.fields['System.Title']; assert.deepEqual(item, original);
});

test('complete-batch preflight rejects foreign, missing, non-case and stale revisions before mutation', async t => {
  for (const fault of ['foreign', 'missing', 'non-case', 'stale']) {
    const f = await setup(t), item = f.state.items.get(102);
    if (fault === 'foreign') item.fields['System.TeamProject'] = 'other';
    if (fault === 'missing') f.state.items.delete(102);
    if (fault === 'non-case') item.fields['System.WorkItemType'] = 'Task';
    if (fault === 'stale') item.rev++;
    const result = await f.management.editCases({input: proposal({id: 101, revision: 1, title: 'First'}, {id: 102, revision: 1, title: 'Second'}), execute: true, approval: 'a'.repeat(64)});
    assert.equal(result.mode, 'incomplete'); assert.deepEqual(result.cases.map(row => row.status), ['not-executed', 'failed']);
    assert.equal(writes(f).length, 0); assert.equal(f.receipts().length, 1);
  }
});

test('approval binds exact proposal, destination, revisions and before/after bytes', async t => {
  const f = await setup(t), input = proposal({id: 101, revision: 1, title: 'Approved'}), preview = await f.management.editCases({input});
  await assert.rejects(f.management.editCases({input, execute: true}), /approval/);
  for (const candidate of [proposal({id: 101, revision: 1, title: 'Changed'}), input]) {
    if (candidate === input) f.state.items.get(101).fields['System.Title'] = 'Changed source without revision';
    const result = await f.management.editCases({input: candidate, execute: true, approval: preview.fingerprint});
    assert.equal(result.mode, 'incomplete'); assert.match(result.cases[0].reason, /fingerprint/);
  }
  const other = await setup(t), changedDestination = createAdoClient({configuration: {...other.config, organizationUrl: 'https://other.example.test/collection'}, roots: other.roots, resolveCredential: () => other.credential, fetchImpl: (url, init) => other.fetchImpl(url.replace('other.example.test', 'ado.example.test'), init)});
  assert.equal((await createAdoTestManagement(changedDestination).editCases({input, execute: true, approval: preview.fingerprint})).mode, 'incomplete');
  assert.equal(writes(f).length + writes(other).length, 0);
});

test('stale revision after preflight fails the server CAS and completed batch cannot replay', async t => {
  const f = await setup(t), input = proposal({id: 101, revision: 1, title: 'Changed'}), preview = await f.management.editCases({input});
  const prior = f.state.fault; f.state.fault = request => {if (request.req.method === 'PATCH') f.state.items.get(101).rev++; return prior(request);};
  const result = await f.management.editCases({input, execute: true, approval: preview.fingerprint});
  assert.equal(result.cases[0].status, 'failed'); assert.equal(f.state.items.get(101).fields['System.Title'], 'Synthetic case 101');
  const g = await setup(t), approved = (await g.management.editCases({input})).fingerprint;
  assert.equal((await g.management.editCases({input, execute: true, approval: approved})).mode, 'execute');
  assert.equal((await createAdoTestManagement(g.client).editCases({input, execute: true, approval: approved})).mode, 'incomplete');
  assert.equal(writes(g).length, 1);
});

test('no-op edits issue no PATCH and preserve exact source bytes', async t => {
  const f = await setup(t), input = proposal({id: 101, revision: 1, title: 'Synthetic case 101', steps: [{id: 2}, {id: 4}, {id: 6}]});
  const result = await apply(f, input); assert.equal(result.mode, 'no-op'); assert.equal(result.cases[0].status, 'no-op'); assert.equal(writes(f).length, 0);
  assert.equal(f.state.items.get(101).fields['Microsoft.VSTS.TCM.Steps'], steps);
});

test('explicit unchanged content is a byte-preserving no-op and an empty ordinary container accepts its first step', () => {
  assert.equal(editStepsXml(steps, {}, [{id: 2, action: {html: '<p>Open &amp; wait</p>'}, expected: {text: ''}}, {id: 4, expected: {text: 'Old result'}}, {id: 6}]), steps);
  const initial = editStepsXml('<steps id="0" last="0"/>', {}, [{id: 2, action: {text: 'First action'}, expected: {text: '<Admin>'}}]);
  assert.equal(editableSteps(initial).rows.length, 1); assert.equal(editableSteps(initial).last, 2);
  assert.equal(editableSteps(initial).rows[0].node.attrs.type, 'ValidateStep');
});

test('custom/localized case category is honored and missing category metadata refuses editing', async t => {
  const f = await setup(t), prior = f.state.fault;
  f.state.items.get(101).fields['System.WorkItemType'] = 'حالة اختبار';
  f.state.fault = request => {if (request.path.endsWith('microsoft.testcasecategory')) {request.send({referenceName: 'Microsoft.TestCaseCategory', workItemTypes: [{name: 'حالة اختبار'}]}); return true;} return prior(request);};
  assert.equal((await apply(f, proposal({id: 101, revision: 1, title: 'Custom category'}))).mode, 'execute');
  f.state.fault = request => {if (request.path.endsWith('microsoft.testcasecategory')) {request.send({referenceName: 'Microsoft.BugCategory', workItemTypes: []}); return true;} return prior(request);};
  await assert.rejects(f.management.editCases({input: proposal({id: 102, revision: 1, title: 'Refused'})}), /category/); assert.equal(writes(f).length, 1);
});

test('unsafe XML, embedded content, parameters and contradictory edits fail the entire batch', async t => {
  const unsafe = [steps.replace('id="4"', 'id="2"'), steps.replace('last="6"', 'last="2"'), steps.replace('<description/>', '<attachment id="1"/>'), steps.replace('<description/>', '<description>Unknown content</description>'), steps.replace('<step id="6" type="ActionStep">', '<compref id="6" ref="800">').replace('</step></steps>', '</compref></steps>'), steps.replace('Old result', '&unknown;'), steps.replace('Old result', '&lt;img src="private.png"/&gt;'), steps.replace('</steps>', ''), '<!DOCTYPE steps>' + steps, steps.replace('Old result', '@Parameter'), steps.replace('<step id=', '<step\u00a0id='), steps.replace('</step><step', '</step>\u00a0<step')];
  for (const source of unsafe) {
    const f = await setup(t); f.state.items.get(102).fields['Microsoft.VSTS.TCM.Steps'] = source;
    await assert.rejects(f.management.editCases({input: proposal({id: 101, revision: 1, title: 'Must not change'}, {id: 102, revision: 1, steps: [{id: 2}, {id: 4}, {id: 6}]})}), /refused/); assert.equal(writes(f).length, 0);
  }
  for (const field of ['Microsoft.VSTS.TCM.Parameters', 'Microsoft.VSTS.TCM.LocalDataSource', 'Microsoft.VSTS.TCM.DataSource']) {
    const f = await setup(t); f.state.items.get(101).fields[field] = '<nonempty/>';
    await assert.rejects(f.management.editCases({input: proposal({id: 101, revision: 1, steps: [{id: 2}] , removeStepIds: [4, 6]})}), /unsupported/);
  }
  for (const [desired, removed] of [[[{id: 2}], []], [[{id: 2}, {id: 2}], [4, 6]], [[{id: 2}], [2, 4, 6]], [[{id: 2}], [4, 6, 99]], [[{id: 2}, {id: 4}, {id: 6}, {id: 7}], []], [[{id: 2, action: {text: '   '}}], [4, 6]], [[{id: 2, action: {html: '<script>no</script>'}}], [4, 6]], [[{id: 2, action: {text: 'a', html: '<b>a</b>'}}], [4, 6]], [[{id: 2, expected: {text: '\u0000'}}], [4, 6]]]) assert.throws(() => editStepsXml(steps, {}, desired, removed));
});

test('malformed proposals, unknown fields and bounded request failures mutate nothing', async t => {
  const f = await setup(t);
  for (const input of [proposal(), proposal({id: 101, revision: 1}), proposal({id: 101, revision: 1, title: ''}), proposal({id: 101, revision: 1, title: 'x', fields: {'Custom.Unsafe': 'value'}}), proposal({id: 101, revision: 1, title: 'a'}, {id: '101', revision: 1, title: 'b'}), proposal({id: 101, revision: 0, title: 'x'}), proposal({id: 101, revision: 1, title: 'x', removeStepIds: [2]}), proposal(...Array.from({length: 101}, (_, i) => ({id: i + 1, revision: 1, title: 'x'})))]) await assert.rejects(f.management.editCases({input}));
  const small = createAdoTestManagement({...f.client, configuration: {...f.client.configuration, maxResponseBytes: 128}});
  await assert.rejects(small.editCases({input: proposal({id: 101, revision: 1, title: 'x'.repeat(200)})}), /body bound/);
  assert.throws(() => editStepsXml(steps, {}, [{id: 2, action: {text: 'x'.repeat(65537)}}, {id: 4}, {id: 6}]), /64 KiB/);
  assert.equal(writes(f).length, 0);
});

test('partial batches retain verified effects and classify rejection, lost response and readback failure', async t => {
  for (const failure of ['permission', 'lost-before-write', 'lost-after-write', 'readback', 'mismatch']) {
    const f = await setup(t), input = proposal(...[101, 102, 200].map(id => ({id, revision: 1, title: `Update ${id}`}))), preview = await f.management.editCases({input});
    const prior = f.state.fault; f.state.fault = request => {
      const {req, path, res, send} = request, item = f.state.items.get(102);
      if (path === 'wit/workitems/102' && req.method === 'PATCH') {
        if (failure === 'permission') {send({private: 'response-body'}, 403); return true;}
        if (failure.startsWith('lost')) {if (failure === 'lost-after-write') {item.rev++; item.fields['System.Title'] = 'Update 102';} res.destroy(); return true;}
      }
      if (path === 'wit/workitems/102' && req.method === 'GET' && item.rev === 2) {
        if (failure === 'readback') {send({}, 503); return true;}
        if (failure === 'mismatch') item.fields['System.Title'] = 'Wrong persisted content';
      }
      return prior(request);
    };
    const result = await f.management.editCases({input, execute: true, approval: preview.fingerprint});
    assert.equal(result.mode, 'incomplete'); assert.deepEqual(result.cases.map(row => row.status), ['completed', failure === 'permission' ? 'failed' : 'uncertain', 'not-executed']);
    assert.equal(writes(f).length, 2); assert.equal(f.state.items.get(101).fields['System.Title'], 'Update 101');
    const events = f.receipts()[0]; assert.equal(events.at(-1).event, 'verification-incomplete');
    assert(events.some(event => event.event === 'verified' && event.identity.workItemId === 101));
    assert(!JSON.stringify(events).includes('Update 101')); assert(!JSON.stringify(events).includes(f.credential));
    const retry = await createAdoTestManagement(f.client).editCases({input, execute: true, approval: preview.fingerprint});
    assert.equal(retry.mode, 'incomplete'); assert.equal(writes(f).length, 2);
  }
});

test('configured credentials, category metadata and receipt ownership fail closed', async t => {
  const f = await setup(t), input = proposal({id: 101, revision: 1, title: 'Change'});
  const noSecret = createAdoClient({configuration: f.config, roots: f.roots, resolveCredential: () => undefined, fetchImpl: () => {throw new Error('Must not dispatch');}});
  await assert.rejects(createAdoTestManagement(noSecret).editCases({input}), /credential/);
  const preview = await f.management.editCases({input});
  const outside = await setup(t); mkdirSync(join(f.roots.projectRoot, '.harness/state'), {recursive: true});
  symlinkSync(outside.roots.projectRoot, join(f.roots.projectRoot, '.harness/state/integrations'), 'junction');
  await assert.rejects(f.management.editCases({input, execute: true, approval: preview.fingerprint})); assert.equal(writes(f).length, 0);
});

test('CLI validates flags, preserves frozen history, and refetches explicit revisions into a fresh output', async t => {
  const f = await setup(t); put(f, '.harness/integrations.json', {version: 1, ado: f.config});
  put(f, '.harness/runs/edit/proposal.json', proposal({id: 101, revision: 1, title: 'CLI edit'}));
  for (const file of ['.harness/runs/frozen/run.json', '.harness/state/generation/history.json', 'execution-tests/ado-suite-2/_verify-state.json']) put(f, file, 'Frozen failure and repair history');
  for (const args of [[], ['--input', '../escape'], ['--input', '.harness/runs/edit/proposal.json', '--execute', '--dry-run'], ['--input', '.harness/runs/edit/proposal.json', '--fields', 'unsafe']]) await assert.rejects(cli(f, 'edit-ado-cases', args));
  const preview = await cli(f, 'edit-ado-cases', ['--input', '.harness/runs/edit/proposal.json', '--dry-run']);
  assert.equal(writes(f).length, 0);
  assert.equal((await cli(f, 'edit-ado-cases', ['--input', '.harness/runs/edit/proposal.json', '--execute', '--approval', preview.fingerprint])).mode, 'execute');
  await cli(f, 'fetch-ado-suite', ['--plan', '1', '--suite', '2', '--revisions', '--out', '.harness/runs/edit/refetched']);
  const manifest = JSON.parse(readFileSync(join(f.roots.projectRoot, '.harness/runs/edit/refetched/ado-suite-2/_suite.json'), 'utf8'));
  assert.equal(manifest.cases[0].rev, 2); assert.equal(manifest.cases[0].title, 'CLI edit');
  for (const file of ['.harness/runs/frozen/run.json', '.harness/state/generation/history.json', 'execution-tests/ado-suite-2/_verify-state.json']) assert.equal(readFileSync(join(f.roots.projectRoot, file), 'utf8'), 'Frozen failure and repair history');
});

test('real installed-layout CLI routes edit-cases, enforces approval and returns incomplete exit status without secrets', async t => {
  const f = await setup(t), root = f.roots.projectRoot, installed = join(root, 'node_modules/playwright-pom-harness');
  mkdirSync(installed, {recursive: true}); cpSync(join(packageRoot, 'scripts'), join(installed, 'scripts'), {recursive: true});
  for (const file of ['package.json', 'VERSION']) cpSync(join(packageRoot, file), join(installed, file));
  const version = JSON.parse(readFileSync(join(packageRoot, 'package.json'))).version;
  put(f, 'package-lock.json', {packages: {'node_modules/playwright-pom-harness': {version}}});
  put(f, '.harness/integrations.json', {version: 1, ado: f.config});
  put(f, '.harness/runs/proposal.json', proposal({id: 101, revision: 1, title: 'CLI reviewed title'}));
  put(f, 'loader.mjs', `const item = ${JSON.stringify(f.state.items.get(101))}, project = ${JSON.stringify(f.state.project)}; globalThis.fetch = async (url, init) => {
    if (url.includes('workitemtypecategories')) return Response.json({referenceName: 'Microsoft.TestCaseCategory', workItemTypes: [{name: 'Test Case'}]});
    if (url.includes('/projects/')) return Response.json(project);
    if (init.method === 'PATCH') return new Response(process.env.ADO_TEST_CREDENTIAL, {status: 403});
    return Response.json(item);
  };`);
  const run = args => spawnSync(process.execPath, [join(installed, 'scripts/cli.mjs'), 'edit-cases', ...args], {cwd: root, encoding: 'utf8', env: {...process.env, NODE_OPTIONS: `--import=${pathToFileURL(join(root, 'loader.mjs')).href}`, ADO_TEST_CREDENTIAL: f.credential}, windowsHide: true});
  const args = ['--input', '.harness/runs/proposal.json'], preview = run(args);
  assert.equal(preview.status, 0, preview.stderr); const fingerprint = JSON.parse(preview.stdout).fingerprint;
  const incomplete = run([...args, '--execute', '--approval', fingerprint]); assert.equal(incomplete.status, 1, incomplete.stderr);
  assert.equal(JSON.parse(incomplete.stdout).cases[0].status, 'failed'); assert(!incomplete.stdout.includes(f.credential)); assert(!incomplete.stderr.includes(f.credential));
  assert(existsSync(join(root, '.harness/state/integrations')));
});
