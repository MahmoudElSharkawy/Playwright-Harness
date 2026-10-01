import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync, symlinkSync, readFileSync, existsSync, readdirSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {fixture} from './fixtures/execution-core.mjs';
import {sourceExpectations, createGenerationHandoff, beginGeneration, registerCandidate, recordGenerationReview, generationStatus} from '../scripts/lib/generation/index.mjs';
import {verifyGeneration} from '../scripts/lib/generation/verify.mjs';
import {packageRoot} from '../scripts/lib/consumer-paths.mjs';
import {generateAllure} from '../scripts/lib/reporting/allure.mjs';
const put = (root, path, content) => {mkdirSync(dirname(join(root, path)), {recursive: true}); writeFileSync(join(root, path), content);};

// Real native runner contract tests; generated text here is deliberately a small runner fixture,
// not evidence of independent POM review or live browser/database integration.
async function nativeFixture(t, body = 'await expect(2 + 2).toBe(4);', extra = '', withoutAllure = false) {
  const f = fixture(t), source = {version: 1, id: 'native-suite', title: 'Native verification', scenarios: [{id: 'case-1', title: 'Arithmetic', steps: [{action: 'Add', expected: ['The result is four']}]}]};
  const key = sourceExpectations(source)[0].key, bindings = [{key, runId: f.run.id, scenarioId: 'case-1', expectationId: 'visible'}];
  if (withoutAllure) {
    for (const name of ['@playwright/test', 'playwright', 'playwright-core']) {const target = join(f.roots.projectRoot, 'node_modules', name); mkdirSync(dirname(target), {recursive: true}); symlinkSync(join(f.roots.packageRoot, 'examples/node_modules', name), target, process.platform === 'win32' ? 'junction' : 'dir');}
  } else symlinkSync(join(f.roots.packageRoot, 'examples/node_modules'), join(f.roots.projectRoot, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  put(f.roots.projectRoot, 'package.json', '{"type":"module"}');
  put(f.roots.projectRoot, 'playwright.config.mjs', "export default {testDir:'./tests', projects:[{name:'native'}]};");
  const helper = pathToFileURL(join(f.roots.packageRoot, 'scripts/lib/generation/assertion.mjs')).href;
  put(f.roots.projectRoot, 'tests/ArithmeticTests.spec.ts', `import {test, expect} from '@playwright/test';\nimport {sourceExpectation} from ${JSON.stringify(helper)};\ntest.describe('Arithmetic',()=>{test('adds',async()=>{await sourceExpectation(test,${JSON.stringify(key)},async()=>{${body}});});test('unselected',async()=>{throw new Error('must never execute');});${extra}});`);
  await beginGeneration(f.roots, createGenerationHandoff(source, [{run: f.run, roots: f.roots, observations: f.report}], bindings), 'contract-author');
  const input = {config: 'playwright.config.mjs', tests: [{scenarioId: 'case-1', spec: 'tests/ArithmeticTests.spec.ts', project: 'native', titlePath: ['Arithmetic', 'adds']}]};
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
  assert.equal(report.status, 'passed'); assert.equal(report.tests[0].results[0].expectations[0].failed, true);
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
for (const [name, body] of [['actual failure', 'await expect(2).toBe(3);'], ['empty assertion callback', ''], ['runtime skip', 'test.skip();'], ['expected failure', 'test.fail(); await expect(2).toBe(3);']]) {
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
