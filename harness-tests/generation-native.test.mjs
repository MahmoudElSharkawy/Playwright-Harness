import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync, symlinkSync, readFileSync, existsSync, readdirSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {fixture} from './fixtures/execution-core.mjs';
import {sourceExpectations, createGenerationHandoff, beginGeneration, registerCandidate, recordGenerationReview, generationStatus} from '../scripts/lib/generation/index.mjs';
import {verifyGeneration} from '../scripts/lib/generation/verify.mjs';
import {packageRoot} from '../scripts/lib/consumer-paths.mjs';
import {generateAllure} from '../scripts/lib/reporting/allure.mjs';
import {transaction} from '../scripts/lib/generation/storage.mjs';
const put = (root, path, content) => {mkdirSync(dirname(join(root, path)), {recursive: true}); writeFileSync(join(root, path), content);};

// Real native runner contract tests; generated text here is deliberately a small runner fixture,
// not evidence of independent POM review or live browser/database integration.
async function nativeFixture(t, body = 'await expect(2 + 2).toBe(4);', extra = '', withoutAllure = false, options = {}) {
  const f = fixture(t), source = {version: 1, id: 'native-suite', title: 'Native verification', scenarios: [{id: 'case-1', title: 'Arithmetic', steps: [{action: 'Add', expected: ['The result is four']}]}]};
  const key = sourceExpectations(source)[0].key, bindings = [{key, runId: f.run.id, scenarioId: 'case-1', expectationId: 'visible'}];
  if (withoutAllure) {
    for (const name of ['@playwright/test', 'playwright', 'playwright-core']) {const target = join(f.roots.projectRoot, 'node_modules', name); mkdirSync(dirname(target), {recursive: true}); symlinkSync(join(f.roots.packageRoot, 'examples/node_modules', name), target, process.platform === 'win32' ? 'junction' : 'dir');}
  } else symlinkSync(join(f.roots.packageRoot, 'examples/node_modules'), join(f.roots.projectRoot, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  put(f.roots.projectRoot, 'package.json', JSON.stringify({type: options.packageType ?? 'module'}));
  put(f.roots.projectRoot, 'playwright.config.mjs', options.config ?? "export default {testDir:'./tests', projects:[{name:'native'}]};");
  for (const [file, contents] of Object.entries(options.files ?? {})) put(f.roots.projectRoot, file, contents);
  put(f.roots.projectRoot, 'tests/ArithmeticTests.spec.ts', `import {test, expect} from '@playwright/test';\n${options.imports ?? ''}\ntest.describe('Arithmetic',()=>{test('adds',async(${options.fixtures ?? ''})=>{${body}});test('unselected',async()=>{throw new Error('must never execute');});${extra}});`);
  await beginGeneration(f.roots, createGenerationHandoff(source, [{run: f.run, roots: f.roots, observations: f.report}], bindings), 'contract-author');
  const input = {config: 'playwright.config.mjs', tests: [{scenarioId: 'case-1', spec: 'tests/ArithmeticTests.spec.ts', project: 'native', titlePath: ['Arithmetic', 'adds'],
    mapping: [{step: 1, actions: [], expectations: [{key, validations: ['ArithmeticFixture.verifySum']}]}]}]};
  f.candidate = await registerCandidate(f.roots, source.id, input);
  put(f.roots.projectRoot, '.harness/state/review.md', 'Synthetic gate approval; no independent review claimed.');
  await recordGenerationReview(f.roots, source.id, {revision: f.candidate.revision, reviewer: 'contract-reviewer', verdict: 'APPROVE', findings: [], artifact: '.harness/state/review.md'});
  return {...f, source, input};
}
test('two separate native scoped invocations are required, excluding a failing unselected test', async t => {
  const f = await nativeFixture(t), first = await verifyGeneration(f.roots, f.source.id); assert.equal(first.status, 'PASS', JSON.stringify(first));
  assert.equal((await generationStatus(f.roots, f.source.id)).greens, 1);
  const second = await verifyGeneration(f.roots, f.source.id); assert.equal(second.status, 'PASS', JSON.stringify(second)); assert.notEqual(first.id, second.id);
  assert.equal((await generationStatus(f.roots, f.source.id)).status, 'READY');
  await assert.rejects(verifyGeneration(f.roots, f.source.id), /already recorded/);
  const file = join(f.roots.projectRoot, second.receipt.path), receipt = JSON.parse(readFileSync(file, 'utf8')); receipt.tests = []; writeFileSync(file, JSON.stringify(receipt));
  assert.equal((await generationStatus(f.roots, f.source.id)).status, 'NEEDS_REVIEW');
});
test('native title-prefix ambiguity is rejected before an unselected test can have effects', async t => {
  const f = await nativeFixture(t, undefined, "test.describe('adds',()=>{test('nested',async()=>{const {writeFileSync}=await import('node:fs');writeFileSync('.harness/state/unselected-ran','unexpected effect');});});");
  const result = await verifyGeneration(f.roots, f.source.id);
  assert.equal(result.status, 'BLOCKED'); assert.equal(result.failureClass, 'COLLECTION');
  assert.equal(existsSync(join(f.roots.projectRoot, '.harness/state/unselected-ran')), false);
  assert.equal(existsSync(join(f.roots.projectRoot, '.harness/state/generation', f.source.id, result.id, 'execution.json')), false);
  assert.equal((await generationStatus(f.roots, f.source.id)).greens, 0);
});
test('a helper cannot swallow a failed native assertion and earn a green', async t => {
  const f = await nativeFixture(t, 'const helper=async()=>{try{await expect(2).toBe(3);}catch{}};await helper();');
  const result = await verifyGeneration(f.roots, f.source.id);
  assert.equal(result.status, 'FAIL'); assert.equal(result.failureClass, 'ASSERTION_COVERAGE');
  const report = JSON.parse(readFileSync(join(f.roots.projectRoot, '.harness/state/generation', f.source.id, result.id, 'execution.json'), 'utf8'));
  assert.equal(report.status, 'passed'); assert.equal(report.version, 2); assert.equal(report.tests[0].results[0].assertions.failed, 1);
  assert.equal((await generationStatus(f.roots, f.source.id)).greens, 0);
  await assert.rejects(verifyGeneration(f.roots, f.source.id), /retry-to-green/);
});

test('Allure capture preserves the verifier FAIL when a native helper swallows an assertion', async t => {
  const f = await nativeFixture(t, 'try{await expect(2).toBe(3);}catch{}');
  const result = await verifyGeneration(f.roots, f.source.id, {allure: true});
  assert.equal(result.status, 'FAIL'); assert.equal(result.failureClass, 'ASSERTION_COVERAGE'); assert.equal(result.reporting.status, 'CAPTURED');
  const path = join(f.roots.projectRoot, result.reporting.directory);
  assert.equal(JSON.parse(readFileSync(join(path, 'capture.json'), 'utf8')).nativeStatus, 'passed');
  assert.equal(JSON.parse(readFileSync(join(path, 'verification.json'), 'utf8')).status, 'FAIL');
  assert.equal((await generationStatus(f.roots, f.source.id)).greens, 0);
  // Optional real Allure 3 generation proof, separate from the ordinary unit/runner suite.
  if (process.env.HARNESS_ALLURE_HTML_PROOF === '1') {
    const generated = await generateAllure(f.roots, result.reporting.directory);
    assert.equal(generated.status, 'GENERATED', JSON.stringify(generated)); assert.equal(generated.verification.status, 'FAIL');
    assert.match(readFileSync(join(f.roots.projectRoot, generated.artifact.path), 'utf8'), /Recorded outcome: <strong>FAIL<\/strong>/);
    assert(readFileSync(join(f.roots.projectRoot, generated.nativeArtifact.path)).length > 1000);
    assert.equal((await generateAllure(f.roots, result.reporting.directory)).status, 'FAILED');
    assert.equal((await generationStatus(f.roots, f.source.id)).greens, 0);
  }
});
test('native assertion polling remains waiting and can finish green', async t => {
  const f = await nativeFixture(t, 'let observations=0;await expect.poll(()=>++observations,{intervals:[1],timeout:5000}).toBeGreaterThan(2);');
  assert.equal((await verifyGeneration(f.roots, f.source.id)).status, 'PASS');
});
test('catching an exhausted native poll still records its assertion failure', async t => {
  const f = await nativeFixture(t, 'try{await expect.poll(()=>0,{intervals:[1],timeout:100}).toBe(1);}catch{}');
  assert.equal((await verifyGeneration(f.roots, f.source.id)).status, 'FAIL');
  assert.equal((await generationStatus(f.roots, f.source.id)).greens, 0);
});
test('a repaired native candidate requires new review and two new green processes', async t => {
  const f = await nativeFixture(t); assert.equal((await verifyGeneration(f.roots, f.source.id)).status, 'PASS');
  const spec = join(f.roots.projectRoot, f.input.tests[0].spec); writeFileSync(spec, readFileSync(spec, 'utf8') + '\n// A reviewed implementation repair.\n');
  assert.equal((await generationStatus(f.roots, f.source.id)).greens, 0);
  f.candidate = await registerCandidate(f.roots, f.source.id, {...f.input, repair: 'script-defect'});
  await assert.rejects(verifyGeneration(f.roots, f.source.id), /approval/);
  await recordGenerationReview(f.roots, f.source.id, {revision: f.candidate.revision, reviewer: 'contract-reviewer', verdict: 'APPROVE', findings: [], artifact: '.harness/state/review.md'});
  assert.equal((await verifyGeneration(f.roots, f.source.id)).status, 'PASS'); assert.equal((await generationStatus(f.roots, f.source.id)).greens, 1);
  assert.equal((await verifyGeneration(f.roots, f.source.id)).status, 'PASS'); assert.equal((await generationStatus(f.roots, f.source.id)).status, 'READY');
});
for (const [name, body] of [['actual failure', 'await expect(2).toBe(3);'], ['empty test', ''], ['runtime skip', 'test.skip();'], ['expected failure', 'test.fail(); await expect(2).toBe(3);']]) {
  test(`native ${name} cannot produce a green`, async t => {const f = await nativeFixture(t, body); const result = await verifyGeneration(f.roots, f.source.id); assert.notEqual(result.status, 'PASS'); assert.notEqual(result.failureClass, 'PREPARATION'); assert.notEqual(result.failureClass, 'COLLECTION'); await assert.rejects(verifyGeneration(f.roots, f.source.id), /retry-to-green/);});
}

test('Allure captures nested core attachments in two isolated native verification runs', async t => {
  const core = pathToFileURL(join(packageRoot, 'scripts/lib/execution-core/index.mjs')).href;
  const reporting = pathToFileURL(join(packageRoot, 'scripts/lib/reporting/index.mjs')).href;
  const body = `const {readFileSync}=await import('node:fs');const {createRun,assessRun}=await import(${JSON.stringify(core)});const {attachResult}=await import(${JSON.stringify(reporting)});
    const input=JSON.parse(readFileSync('.harness/state/report-input.json','utf8'));const run=createRun({...input.saved.inputs,id:input.saved.id,startedAt:input.saved.startedAt});
    const result=assessRun(run,input.roots,input.observations);await test.step('Shared operation',async()=>{const delivery=await attachResult(test,result);await expect(delivery.status).toBe('ATTACHED');});await expect(2+2).toBe(4);`;
  const f = await nativeFixture(t, body);
  put(f.roots.projectRoot, '.harness/state/report-input.json', JSON.stringify({saved: f.run, roots: f.roots, observations: f.report}));
  const first = await verifyGeneration(f.roots, f.source.id, {allure: true}), second = await verifyGeneration(f.roots, f.source.id, {allure: true});
  for (const result of [first, second]) {
    assert.equal(result.status, 'PASS', JSON.stringify(result)); assert.equal(result.reporting.status, 'CAPTURED', JSON.stringify(result));
    const directory = join(f.roots.projectRoot, result.reporting.directory, 'allure-results');
    const reports = readdirSync(directory).filter(name => name.endsWith('-result.json')); assert.equal(reports.length, 1);
    const report = JSON.parse(readFileSync(join(directory, reports[0]), 'utf8')); assert.equal(report.status, 'passed');
    const allSteps = steps => steps.flatMap(step => [step, ...allSteps(step.steps ?? [])]);
    const technical = allSteps(report.steps).find(step => step.name === 'Shared operation'); assert(technical, 'Technical step remains nested.');
    const attachments = [technical, ...allSteps(technical.steps ?? [])].flatMap(step => step.attachments ?? []);
    assert.deepEqual(attachments.map(a => a.name), ['Harness execution result', 'Harness execution report'], JSON.stringify(technical));
    const attachment = JSON.parse(readFileSync(join(directory, attachments[0].source), 'utf8')); assert.equal(attachment.kind, 'validated-execution'); assert.equal(attachment.status, 'PASS');
  }
  assert.notEqual(first.reporting.directory, second.reporting.directory); assert.equal((await generationStatus(f.roots, f.source.id)).status, 'READY');
});
for (const [status, body] of [['PASS', 'await expect(2).toBe(2);'], ['FAIL', 'await expect(2).toBe(3);']]) test(`missing optional Allure leaves native verification ${status} unchanged`, async t => {
  const f = await nativeFixture(t, body, '', true), result = await verifyGeneration(f.roots, f.source.id, {allure: true});
  assert.equal(result.status, status, JSON.stringify(result)); assert.equal(result.reporting.status, 'FAILED');
});

test('scoped Allure reuses the maintained class in an ESM consumer without generating normal HTML', async t => {
  const files = Object.fromEntries(['src/utils/AllureReport.ts', 'src/config/reporting.ts']
    .map(file => [file, readFileSync(join(packageRoot, 'examples', file), 'utf8')]));
  const f = await nativeFixture(t, undefined, '', false, {files});
  put(f.roots.projectRoot, 'allure-report/index.html', 'Existing normal report');
  const result = await verifyGeneration(f.roots, f.source.id, {allure: true});
  assert.equal(result.status, 'PASS'); assert.equal(result.reporting.status, 'CAPTURED', JSON.stringify(result));
  assert.equal(readFileSync(join(f.roots.projectRoot, 'allure-report/index.html'), 'utf8'), 'Existing normal report');
});

test('scoped Allure retains official capture with a legacy generation-only utility', async t => {
  const f = await nativeFixture(t, undefined, '', false, {files: {'src/utils/AllureReport.ts':
    "export default class AllureReport {onExit(){throw new Error('Legacy generator must not run');}}"}});
  const result = await verifyGeneration(f.roots, f.source.id, {allure: true});
  assert.equal(result.status, 'PASS'); assert.equal(result.reporting.status, 'CAPTURED', JSON.stringify(result));
});

test('only hook assertions cannot satisfy case coverage', async t => {
  const f = await nativeFixture(t, '', "test.beforeEach(async()=>{await expect(2).toBe(2);});test.afterEach(async()=>{await expect(3).toBe(3);});");
  const result = await verifyGeneration(f.roots, f.source.id); assert.equal(result.status, 'NEEDS_REVIEW'); assert.equal(result.failureClass, 'ASSERTION_COVERAGE');
});
for (const body of ["await test.step.skip('Skipped check', async()=>{await expect(2).toBe(3);});await expect(2).toBe(2);",
  "await test.step('Skipped check', async step=>{step.skip();await expect(2).toBe(3);});await expect(2).toBe(2);"]) test('native step skips cannot earn a scoped green', async t => {
  const f = await nativeFixture(t, body), result = await verifyGeneration(f.roots, f.source.id);
  assert.equal(result.status, 'NEEDS_REVIEW'); assert.equal(result.failureClass, 'ASSERTION_COVERAGE');
});
const probeOptions = {imports: "import {probe} from '../src/utils/UiControls';", files: {'src/utils/UiControls.ts':
  "import {expect} from '@playwright/test';export async function probe(){try{await expect(2,'Probe whether a transient gate is ready').toBe(3);}catch{}}"}};
test('a utility probe alone is not a business assertion', async t => {
  const f = await nativeFixture(t, 'await probe();', '', false, probeOptions), result = await verifyGeneration(f.roots, f.source.id);
  assert.equal(result.status, 'NEEDS_REVIEW');
});
test('a utility probe plus a real assertion can pass', async t => {
  const f = await nativeFixture(t, 'await probe();await expect(2).toBe(2);', '', false, probeOptions);
  assert.equal((await verifyGeneration(f.roots, f.source.id)).status, 'PASS');
});
test('toPass uses its terminal result after failing attempts', async t => {
  const f = await nativeFixture(t, 'let attempt=0;await expect(async()=>{await expect(++attempt).toBeGreaterThan(2);}).toPass({intervals:[1],timeout:5000});');
  assert.equal((await verifyGeneration(f.roots, f.source.id)).status, 'PASS');
});
test('deprecated source helper executes assertions without emitting marker steps', async t => {
  const helper = pathToFileURL(join(packageRoot, 'scripts/lib/generation/assertion.mjs')).href;
  const f = await nativeFixture(t, "await sourceExpectation(test,'expect-000000000000000000000000',async()=>{await expect(2).toBe(2);});", '', false,
    {imports: `import {sourceExpectation} from ${JSON.stringify(helper)};`});
  const result = await verifyGeneration(f.roots, f.source.id, {allure: true}); assert.equal(result.status, 'PASS');
  const directory = join(f.roots.projectRoot, result.reporting.directory, 'allure-results');
  for (const file of readdirSync(directory)) assert(!readFileSync(join(directory, file), 'utf8').includes('harness:expectation:'));
});
test('a legacy candidate at its repair limit migrates to a new review and two fresh native greens', async t => {
  const f = await nativeFixture(t);
  await transaction(f.roots, f.source.id, (state, save) => {
    // Synthetic historical state: existing production records are never rewritten.
    delete state.candidates[0].gate; delete state.candidates[0].tests[0].mapping; state.candidates[0].round = 3; state.rounds = 3;
    state.runs.push({id: 'historical-green', revision: f.candidate.revision, status: 'PASS'}); save(state);
  });
  f.candidate = await registerCandidate(f.roots, f.source.id, {...f.input, migration: 'case-assertions'});
  assert.equal(f.candidate.round, 3); await assert.rejects(verifyGeneration(f.roots, f.source.id), /approval/);
  put(f.roots.projectRoot, '.harness/state/migration-review.md', 'Synthetic migration review: original scenario preserved; no interrupted effects.');
  await recordGenerationReview(f.roots, f.source.id, {revision: f.candidate.revision, reviewer: 'migration-reviewer', verdict: 'APPROVE', findings: [], artifact: '.harness/state/migration-review.md'});
  assert.equal((await generationStatus(f.roots, f.source.id)).greens, 0);
  const first = await verifyGeneration(f.roots, f.source.id); assert.equal(first.status, 'PASS'); assert.equal(first.gate, 'case-assertions');
  assert.equal((await generationStatus(f.roots, f.source.id)).greens, 1);
  const second = await verifyGeneration(f.roots, f.source.id); assert.equal(second.status, 'PASS'); assert.notEqual(first.id, second.id);
  assert.equal((await generationStatus(f.roots, f.source.id)).status, 'READY');
});

const linkTemplates = {tms: {nameTemplate: 'Test: #%s', urlTemplate: 'https://dev.azure.com/example-org/Example%20Project/_workitems/edit/%s'},
  issue: {nameTemplate: 'Bug: #%s', urlTemplate: 'https://bugs.example.test/other/%s'}};
const allureResults = directory => readdirSync(directory).filter(name => name.endsWith('-result.json')).map(name => JSON.parse(readFileSync(join(directory, name), 'utf8')));
test('normal and scoped Allure both resolve IDs through the configured templates', async t => {
  const f = await nativeFixture(t, "await allure.tms('101');await allure.issue('202');await expect(2).toBe(2);", '', false, {
    imports: "import * as allure from 'allure-js-commons';",
    config: `export default {testDir:'./tests',projects:[{name:'native'}],reporter:[['allure-playwright',{resultsDir:'reports/normal/allure-results',links:${JSON.stringify(linkTemplates)}}]]};`,
  });
  const native = spawnSync(process.execPath, [join(packageRoot, 'examples/node_modules/playwright/cli.js'), 'test', '--config', f.input.config, '--grep', 'adds', '--workers', '1', '--retries', '0'],
    {cwd: f.roots.projectRoot, encoding: 'utf8', windowsHide: true, timeout: 60000});
  assert.equal(native.status, 0, native.stderr);
  const scoped = await verifyGeneration(f.roots, f.source.id, {allure: true}); assert.equal(scoped.status, 'PASS'); assert.equal(scoped.reporting.links, 'CONFIGURED');
  const normal = allureResults(join(f.roots.projectRoot, 'reports/normal/allure-results'))[0];
  const captured = allureResults(join(f.roots.projectRoot, scoped.reporting.directory, 'allure-results'))[0];
  const expected = [{type: 'tms', url: linkTemplates.tms.urlTemplate.replace('%s', '101'), name: 'Test: #101'}, {type: 'issue', url: linkTemplates.issue.urlTemplate.replace('%s', '202'), name: 'Bug: #202'}];
  assert.deepEqual(normal.links, expected); assert.deepEqual(captured.links, expected);
});
test('dynamic Allure templates are reported as unresolved without changing the verifier outcome', async t => {
  const f = await nativeFixture(t, "await allure.tms('101');await expect(2).toBe(2);", '', false, {
    imports: "import * as allure from 'allure-js-commons';",
    config: `const destination=${JSON.stringify(linkTemplates.tms.urlTemplate)};export default {testDir:'./tests',projects:[{name:'native'}],reporter:[['allure-playwright',{links:{tms:{urlTemplate:destination}}}]]};`,
  });
  const result = await verifyGeneration(f.roots, f.source.id, {allure: true}); assert.equal(result.status, 'PASS'); assert.equal(result.reporting.links, 'UNRESOLVED');
  const captured = allureResults(join(f.roots.projectRoot, result.reporting.directory, 'allure-results'))[0]; assert.equal(captured.links[0].url, '101');
});

// Opt-in browser proof: HARNESS_ALLURE_LOCATOR_PROOF=1; HARNESS_BROWSER_CHANNEL may select an installed Chrome/Edge.
if (process.env.HARNESS_ALLURE_LOCATOR_PROOF === '1') for (const fails of [false, true]) test(`normal and scoped Allure retain live locators and ${fails ? 'failed' : 'passed'} status`, async t => {
    const html = '<input id="field"><button id="submit">Submit</button><p id="message" data-state="ready" style="color:rgb(0,0,0)">Ready</p>'
      + '<div id="hidden" hidden></div><input id="disabled" disabled><input id="unchecked" type="checkbox"><input id="readonly" readonly value="synthetic-private">'
      + '<ul id="actual"><li>A</li><li>B</li></ul><ul id="reference"><li>A</li><li>B</li></ul>';
    const body = `await page.setContent(${JSON.stringify(html)});await allure.tms('101');await allure.issue('202');
      await allure.step('Business locator checks',async()=>{await test.step('Technical locator checks',async()=>{
        const field=page.locator('#field'),message=page.locator('#message'),rows=page.locator('#actual li');
        await field.fill('synthetic-user');await page.locator('#submit').click();
        await checks.expectToHaveText('the message',message,'Ready');await checks.expectToContainText('the message',message,'Ready');
        await checks.expectToHaveValue('the field',field,'synthetic-user');await checks.expectToHaveCount('the rows',rows,2);await checks.expectNotToHaveCount('the rows',rows,3);
        await checks.expectToHaveAttribute('the message',message,'data-state','ready');await checks.expectToHaveCSS('the message',message,'color','rgb(0, 0, 0)');
        await checks.expectToBeVisible('the message',message);await checks.expectToBeHidden('the hidden field',page.locator('#hidden'));
        await checks.expectToBeEnabled('the field',field);await checks.expectToBeDisabled('the disabled field',page.locator('#disabled'));
        await checks.expectNotToBeChecked('the checkbox',page.locator('#unchecked'));await checks.expectNotToBeEditable('the readonly field',page.locator('#readonly'));
        await checks.expectToContainSecretText('the message',message,'Ready');await checks.expectToHaveSecretValue('the readonly field',page.locator('#readonly'),'synthetic-private');
        await checks.expectToHaveMatchingCount('the rows',rows,page.locator('#reference li'));
        checks.expectToBe('the total',2,2);await checks.expectToHaveURL(page,'about:blank');
        await test.info().attach('Synthetic locator attachment',{body:'unchanged',contentType:'text/plain'});
        ${fails ? "await checks.expectToHaveText('the message',message,'Wrong',{timeout:100});" : ''}
      });});`;
    const files = Object.fromEntries(['src/utils/Expects.ts', 'src/utils/AllureReport.ts', 'src/config/reporting.ts', 'allurerc.json']
      .map(file => [file, readFileSync(join(packageRoot, 'examples', file), 'utf8')]));
    const f = await nativeFixture(t, body, '', false, {files, fixtures: '{page}', packageType: 'commonjs',
      imports: "import * as allure from 'allure-js-commons';import * as checks from '../src/utils/Expects';",
      config: `export default {testDir:'./tests',workers:1,retries:0,projects:[{name:'native'}],use:{channel:process.env.HARNESS_BROWSER_CHANNEL},reporter:[['list'],['./src/utils/AllureReport.ts',{resultsDir:'allure-results',links:${JSON.stringify(linkTemplates)}}]]};`,
    });
    const normal = spawnSync(process.execPath, [join(packageRoot, 'examples/node_modules/playwright/cli.js'), 'test', '--config', f.input.config, '--grep', 'adds'],
      {cwd: f.roots.projectRoot, env: {...process.env, AUTO_ALLURE_OPEN: 'false', ALLURE_HISTORY: 'false'}, encoding: 'utf8', windowsHide: true, timeout: 90000});
    assert.equal(normal.status, fails ? 1 : 0, normal.stdout + normal.stderr);
    const normalHtml = readFileSync(join(f.roots.projectRoot, 'allure-report/index.html'), 'utf8');
    const scoped = await verifyGeneration(f.roots, f.source.id, {allure: true});
    assert.equal(scoped.status, fails ? 'FAIL' : 'PASS', JSON.stringify(scoped)); assert.equal(scoped.reporting.links, 'CONFIGURED');
    const generated = await generateAllure(f.roots, scoped.reporting.directory);
    assert.equal(generated.status, 'GENERATED', JSON.stringify(generated));
    const flatten = steps => (steps ?? []).flatMap(step => [step, ...flatten(step.steps)]);
    const required = ["Click locator('#submit')", "Fill \"synthetic-user\" locator('#field')", "Expect the message to be visible → locator('#message')",
      "Expect the rows to show as many item(s) as the reference set → locator('#actual li') (reference: locator('#reference li'))",
      'Expect the total to be 2', 'Expect the page URL to be "about:blank"'];
    for (const directory of ['allure-results', `${scoped.reporting.directory}/allure-results`]) {
      const result = allureResults(join(f.roots.projectRoot, directory))[0], steps = flatten(result.steps);
      assert.equal(result.status, fails ? 'failed' : 'passed');
      for (const title of required) assert(steps.some(step => step.name === title), title);
      assert(steps.filter(step => step.name.startsWith('Expect ') && step.name.includes(' →')).every(step => !step.name.endsWith(' →')));
      if (fails) {
        const failed = steps.find(step => step.name === "Expect the message to have text \"Wrong\" → locator('#message')");
        assert(failed); assert.equal(failed.status, 'failed'); assert.match(failed.statusDetails.message, /Wrong/);
      }
      const business = result.steps.find(step => step.name === 'Business locator checks');
      assert(business.steps.some(step => step.name === 'Technical locator checks'));
      const attachments = flatten(business.steps).flatMap(step => step.attachments ?? []);
      const attachment = attachments.find(item => item.name === 'Synthetic locator attachment'); assert(attachment);
      assert.equal(readFileSync(join(f.roots.projectRoot, directory, attachment.source), 'utf8'), 'unchanged');
      assert.equal(result.links.find(link => link.type === 'tms').url, linkTemplates.tms.urlTemplate.replace('%s', '101'));
      assert.equal(result.links.find(link => link.type === 'issue').url, linkTemplates.issue.urlTemplate.replace('%s', '202'));
    }
    for (const rendered of [normalHtml, readFileSync(join(f.roots.projectRoot, generated.nativeArtifact.path), 'utf8')]) {
      const embedded = [...rendered.matchAll(/\bd\(("(?:[^"\\]|\\.)*"),("(?:[^"\\]|\\.)*")\)/g)]
        .filter(match => /^data\/test-results\/.+\.json$/.test(JSON.parse(match[1])))
        .map(match => JSON.parse(Buffer.from(JSON.parse(match[2]), 'base64').toString()));
      assert.equal(embedded.length, 1);
      for (const title of required) assert(flatten(embedded[0].steps).some(step => step.name === title), title);
    }
  });
