import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fixture} from './fixtures/execution-core.mjs';
import {executionFixture, executeApi} from './fixtures/execute.mjs';
import {prepared, recorded, source, put, observed} from './fixtures/generation-report.mjs';
import {adoFixture} from './fixtures/ado.mjs';
import {createAdoClient} from '../scripts/lib/integrations/ado-client.mjs';
import {generationStatus} from '../scripts/lib/generation/index.mjs';
import {reviewRunFailures} from '../scripts/lib/bug-report/failures.mjs';
import {prepareRunBugReports as prepare, readBugReport, editBugReport, previewBugReport, approveBugReport, fileBugReport} from '../scripts/lib/bug-report/index.mjs';

const writes = ado => ado.state.requests.filter(r => r.method !== 'GET' && !['wit/wiql', 'wit/workitemsbatch'].includes(r.path) && !r.query.includes('validateOnly=true'));
const deps = (ado, roots) => ({client: createAdoClient({configuration: ado.config, roots, resolveCredential: () => ado.credential, fetchImpl: ado.fetchImpl}), inventory: async () => [{pid: process.pid, identity: '1'}]});
const prepareRunBugReports = (roots, batch, input) => prepare(roots, batch, input, {inventory: async () => [{pid: process.pid, identity: '1'}]});
const draft = {title: 'Observation is missing', description: 'The accepted observation is missing for the affected cases.', prerequisites: [], steps: ['Read the observation'], expected: 'The expected observation is visible', actual: 'The observation is missing', fields: {}};
function decision(review, classes = review.findings.map(() => 'application')) {
  const members = review.findings.filter((_, i) => classes[i] === 'application').map(row => row.id);
  return {version: 1, run: review.run, hash: review.hash,
    classifications: review.findings.map((row, i) => ({finding: row.id, classification: classes[i], reason: 'Selected source and recorded observations were compared.', nextAction: 'Review the recorded cause.'})),
    groups: members.length ? [{members, reason: 'Each selected case shows the same missing observation against the same accepted expectation.', draft}] : []};
}
async function manual(t, ado, count = 3) {
  const f = await executionFixture(t, {organizationUrl: ado.config.organizationUrl, cases: Array.from({length: count}, (_, i) => ({id: 101 + i, rev: 1, title: `Observation ${i + 1}`, parameters: null, steps: [{action: 'Read status', expected: 'Status is 200'}]})), handler: (_, res) => {res.writeHead(500); res.end('{}');}});
  for (let i = 0; i < count; i++) f.apiStep(0, i);
  f.freeze(); for (let i = 0; i < count; i++) await executeApi(f, {scenarioIndex: i});
  for (let i = 1; i < count; i++) ado.state.items.set(101 + i, {...structuredClone(ado.state.items.get(101)), id: 101 + i});
  return {...f, run: {workflow: 'execute-test', executionId: f.executionId}};
}
async function automation(t, count = 3) {
  const f = await prepared(t, {source: source(Array.from({length: count}, (_, i) => `case${i + 1}`))});
  await recorded(f); return {...f, run: {workflow: 'automate-test', sourceId: f.source.id}};
}

for (const workflow of ['execute-test', 'automate-test']) test(`${workflow}: classified failures become grouped editable drafts, and only approved selections file`, async t => {
  const ado = await adoFixture(t), f = workflow === 'execute-test' ? await manual(t, ado) : await automation(t);
  const before = workflow === 'automate-test' ? await generationStatus(f.roots, f.source.id) : readFileSync(join(f.projectRoot, `.harness/runs/${f.executionId}/execution.json`));
  const review = await reviewRunFailures(f.roots, f.run), input = decision(review), dependencies = deps(ado, f.roots);
  input.groups = [{...input.groups[0], members: review.findings.slice(0, 2).map(row => row.id)}, {...input.groups[0], members: [review.findings[2].id], reason: 'A distinct symptom; retain a separate report.'}];
  const result = await prepareRunBugReports(f.roots, 'post-run', input);
  assert.equal(result.drafts.length, 2); assert.equal(result.drafts[0].members.length, 2); assert.equal(writes(ado).length, 0);
  const id = result.drafts[0].reportId, initial = readBugReport(f.roots, id);
  assert.equal(initial.intake.source.postRun.members.length, 2);
  editBugReport(f.roots, id, {head: initial.head, draft: {title: 'Corrected observation failure'}});
  assert.equal((await prepareRunBugReports(f.roots, 'post-run', input)).drafts[0].reportId, id);
  assert.equal(readBugReport(f.roots, id).draft.title, 'Corrected observation failure');
  const preview = await previewBugReport(f.roots, id, dependencies); assert(preview.ready, JSON.stringify(preview.problems));
  const html = preview.bugs[0].fields['Microsoft.VSTS.TCM.ReproSteps'];
  assert(html.includes(`Source: ${workflow === 'execute-test' ? 'Test execution' : 'Automated tests'}`));
  assert(!html.includes('sourceFingerprint')); assert(!html.includes('observationsFingerprint')); assert(!html.includes('"postRun"')); assert(!html.includes(initial.intake.source.defectFingerprint));
  assert.equal(html.includes('Agent reproduction: Reproduced'), workflow === 'execute-test');
  assert(html.includes(workflow === 'execute-test' ? 'Test case #101' : 'case1')); assert(html.includes(workflow === 'execute-test' ? 'Test case #102' : 'case2'));
  await assert.rejects(fileBugReport(f.roots, id, preview.hash, dependencies)); assert.equal(writes(ado).length, 0);
  approveBugReport(f.roots, id, preview.hash); await fileBugReport(f.roots, id, preview.hash, dependencies);
  assert.equal(writes(ado).filter(row => row.path === 'wit/workitems/$bug').length, 1);
  assert.equal(ado.state.items.get(800).fields['Microsoft.VSTS.TCM.ReproSteps'], html);
  const after = workflow === 'automate-test' ? await generationStatus(f.roots, f.source.id) : readFileSync(join(f.projectRoot, `.harness/runs/${f.executionId}/execution.json`));
  assert.deepEqual(after, before);
});

test('test/environment failures remain attention items; unknown drafts are provisional', async t => {
  const f = await automation(t, 4), review = await reviewRunFailures(f.roots, f.run), input = decision(review, ['application', 'test', 'environment', 'unknown']);
  input.groups.push({members: [review.findings[3].id], reason: 'Cause remains unclassified.', draft});
  const result = await prepareRunBugReports(f.roots, 'mixed', input);
  assert.equal(result.drafts.length, 2); assert.equal(result.attention.length, 3);
  const provisional = await previewBugReport(f.roots, result.drafts[1].reportId, {inventory: async () => [{pid: process.pid, identity: '1'}]});
  assert.equal(provisional.ready, false); assert(provisional.problems.some(row => row.code === 'provisional-classification'));
  assert.throws(() => approveBugReport(f.roots, result.drafts[1].reportId, provisional.hash));
});

test('incomplete classifications, unsupported grouping and stale review cannot create drafts', async t => {
  const f = await automation(t), review = await reviewRunFailures(f.roots, f.run);
  for (const mutate of [input => input.classifications.pop(), input => input.classifications.push(input.classifications[0]), input => input.groups[0].members.pop(), input => input.groups[0].members.push(input.groups[0].members[0]), input => input.groups[0].reason = '', input => input.classifications[0].classification = 'environment', input => input.hash = 'stale']) {
    const input = decision(review); mutate(input); await assert.rejects(prepareRunBugReports(f.roots, 'invalid', input));
  }
});

test('a changed grouped execution member invalidates approval before any writes', async t => {
  const ado = await adoFixture(t), f = await manual(t, ado, 2), review = await reviewRunFailures(f.roots, f.run), result = await prepareRunBugReports(f.roots, 'source-change', decision(review)), dependencies = deps(ado, f.roots), id = result.drafts[0].reportId;
  const preview = await previewBugReport(f.roots, id, dependencies); assert(preview.ready); approveBugReport(f.roots, id, preview.hash);
  ado.state.items.get(102).rev++;
  await assert.rejects(fileBugReport(f.roots, id, preview.hash, dependencies), /revision changed/i); assert.equal(writes(ado).length, 0);
});

test('changed automation receipts invalidate the reviewed classification and filing', async t => {
  const ado = await adoFixture(t), f = await automation(t, 1), review = await reviewRunFailures(f.roots, f.run), result = await prepareRunBugReports(f.roots, 'receipt-change', decision(review)), dependencies = deps(ado, f.roots), id = result.drafts[0].reportId;
  const preview = await previewBugReport(f.roots, id, dependencies); assert(preview.ready); approveBugReport(f.roots, id, preview.hash);
  put(f.roots.projectRoot, `.harness/state/generation/${f.source.id}/verify-report/execution.json`, '{}');
  await assert.rejects(prepareRunBugReports(f.roots, 'receipt-change', decision(review)), /changed/i);
  await assert.rejects(fileBugReport(f.roots, id, preview.hash, dependencies), /changed/i); assert.equal(writes(ado).length, 0);
});

test('all-pass automation produces an empty review without drafts or ADO configuration', async t => {
  const f = await prepared(t); await recorded(f, 'PASS'); const run = {workflow: 'automate-test', sourceId: f.source.id}, review = await reviewRunFailures(f.roots, run);
  assert.equal(review.findings.length, 0); assert.deepEqual((await prepareRunBugReports(f.roots, 'no-defects', decision(review))).drafts, []);
});

test('pre-generation exploration failures retain native evidence and can prepare drafts through the CLI', async t => {
  const f = fixture(t), input = source(); observed(t, input, {first: f, statuses: ['FAIL']});
  put(f.roots.projectRoot, '.harness/sources/cases.json', input);
  put(f.roots.projectRoot, '.harness/runs/run-1/run.json', f.run);
  put(f.roots.projectRoot, '.harness/runs/run-1/observations.json', f.report);
  put(f.roots.projectRoot, '.harness/observed.json', {source: '.harness/sources/cases.json', executions: [{snapshot: '.harness/runs/run-1/run.json', runRoot: '.harness/runs/run-1'}], bindings: [{sourceScenarioId: input.scenarios[0].id, runId: f.run.id, scenarioId: 'case-1'}]});
  const run = {workflow: 'automate-test', source: '.harness/sources/cases.json', observed: '.harness/observed.json'};
  put(f.roots.projectRoot, '.harness/run-review.json', run);
  const cli = (...args) => spawnSync(process.execPath, [join(f.roots.packageRoot, 'scripts/bug-report.mjs'), ...args, '--project-root', f.roots.projectRoot], {encoding: 'utf8', windowsHide: true});
  const inspected = cli('failures', 'exploration', '--input', '.harness/run-review.json'); assert.equal(inspected.status, 0, inspected.stderr);
  const review = JSON.parse(inspected.stdout); assert.equal(review.findings[0].eligible, true);
  put(f.roots.projectRoot, '.harness/classified.json', decision(review));
  const created = cli('from-run', 'exploration', '--input', '.harness/classified.json'); assert.equal(created.status, 0, created.stderr);
  const result = JSON.parse(created.stdout); assert.equal(result.drafts.length, 1);
  assert.notEqual(cli('file', result.drafts[0].reportId, '--execute').status, 0);
  await assert.rejects(generationStatus(f.roots, input.id), /Generation has not started/);
});

test('distinct symptoms in one automated case can have independently editable drafts', async t => {
  const f = await automation(t, 1), review = await reviewRunFailures(f.roots, f.run), input = decision(review);
  input.groups = ['missing-link', 'incorrect-total'].map(key => ({...input.groups[0], key, reason: `Recorded evidence identifies the distinct ${key} symptom.`, draft: {...draft, title: key}}));
  const result = await prepareRunBugReports(f.roots, 'split', input);
  assert.equal(result.drafts.length, 2); assert.notEqual(result.drafts[0].reportId, result.drafts[1].reportId);
  assert.notEqual(readBugReport(f.roots, result.drafts[0].reportId).intake.source.defectFingerprint, readBugReport(f.roots, result.drafts[1].reportId).intake.source.defectFingerprint);
});

test('an unexecuted parameter iteration remains an attention item when another iteration fails', async t => {
  const ado = await adoFixture(t), f = await executionFixture(t, {organizationUrl: ado.config.organizationUrl,
    cases: [{id: 101, rev: 1, title: 'Parameterized observation', parameters: null, dataTableXml: '<NewDataSet><Table1><Record>A</Record></Table1><Table1><Record>B</Record></Table1></NewDataSet>', steps: [{action: 'Read status', expected: 'Status is 200'}]}], handler: (_, res) => {res.writeHead(500); res.end('{}');}});
  f.apiStep(0, 0); f.apiStep(0, 1); f.freeze(); await executeApi(f);
  const review = await reviewRunFailures(f.roots, {workflow: 'execute-test', executionId: f.executionId});
  assert.equal(review.findings.length, 2); assert(review.findings.some(row => row.scenarioId === f.source.scenarios[1].id && !row.eligible));
  const result = await prepareRunBugReports(f.roots, 'iterations', decision(review, ['application', 'environment']));
  assert.equal(result.drafts.length, 1); assert.equal(result.attention.length, 1);
});

test('a grouped execution defect retains every failing parameter iteration in the editable draft', async t => {
  const ado = await adoFixture(t), f = await executionFixture(t, {organizationUrl: ado.config.organizationUrl,
    cases: [{id: 101, rev: 1, title: 'Parameterized observation', parameters: null, dataTableXml: '<NewDataSet><Table1><Record>A</Record></Table1><Table1><Record>B</Record></Table1></NewDataSet>', steps: [{action: 'Read status', expected: 'Status is 200'}]}], handler: (_, res) => {res.writeHead(500); res.end('{}');}});
  f.apiStep(0, 0); f.apiStep(0, 1); f.freeze(); await executeApi(f); await executeApi(f, {scenarioIndex: 1});
  const review = await reviewRunFailures(f.roots, {workflow: 'execute-test', executionId: f.executionId});
  assert.equal(review.findings.length, 1); assert.equal(review.findings[0].occurrences.length, 2);
  const result = await prepareRunBugReports(f.roots, 'grouped-iterations', decision(review));
  const retained = JSON.parse(readBugReport(f.roots, result.drafts[0].reportId).intake.source.content).scenarios;
  assert.deepEqual(retained, f.source.scenarios); assert.equal(writes(ado).length, 0);
});

async function adoAutomation(t, ado, withSnapshot = true) {
  const input = source(['tc-101']); input.scenarios[0].externalReferences = [{system: 'ado', id: '101'}];
  const f = await prepared(t, {source: input}); await recorded(f);
  const snapshot = {organizationUrl: ado.config.organizationUrl, project: ado.config.project, storyId: 500, storyRev: 1, storyTitle: 'Observation story',
    cases: [{id: 101, rev: 1, title: input.scenarios[0].title, parameters: null, steps: [{action: input.scenarios[0].steps[0].action, expected: input.scenarios[0].steps[0].expected[0], fromShared: 102}], sharedRevisions: {'102': 1}}]};
  ado.state.items.set(500, {id: 500, rev: 1, fields: {'System.TeamProject': ado.config.project, 'System.Title': 'Observation story'}});
  ado.state.items.set(102, {...structuredClone(ado.state.items.get(101)), id: 102});
  put(f.roots.projectRoot, '.harness/original-ado.json', snapshot);
  return {...f, run: {workflow: 'automate-test', sourceId: input.id, ...(withSnapshot ? {adoSnapshot: '.harness/original-ado.json'} : {})}};
}
test('ADO-backed automation remains editable but cannot file without original revision bindings', async t => {
  const ado = await adoFixture(t), f = await adoAutomation(t, ado, false), review = await reviewRunFailures(f.roots, f.run), result = await prepareRunBugReports(f.roots, 'missing-ado', decision(review));
  const preview = await previewBugReport(f.roots, result.drafts[0].reportId, deps(ado, f.roots));
  assert.equal(preview.ready, false); assert(preview.problems.some(row => row.code === 'missing-original-revisions')); assert.equal(writes(ado).length, 0);
});
for (const changed of [101, 102, 500]) test(`ADO-backed automation rejects changed case/shared/story source ${changed} after approval`, async t => {
  const ado = await adoFixture(t), f = await adoAutomation(t, ado), review = await reviewRunFailures(f.roots, f.run), result = await prepareRunBugReports(f.roots, `changed-${changed}`, decision(review)), id = result.drafts[0].reportId, dependencies = deps(ado, f.roots);
  const preview = await previewBugReport(f.roots, id, dependencies); assert(preview.ready, JSON.stringify(preview.problems)); approveBugReport(f.roots, id, preview.hash);
  ado.state.items.get(changed).rev++;
  await assert.rejects(fileBugReport(f.roots, id, preview.hash, dependencies), /revision changed/i); assert.equal(writes(ado).length, 0);
});
