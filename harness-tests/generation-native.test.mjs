import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync, symlinkSync, readFileSync, existsSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {fixture} from './fixtures/execution-core.mjs';
import {sourceExpectations, createGenerationHandoff, beginGeneration, registerCandidate, recordGenerationReview, generationStatus} from '../scripts/lib/generation/index.mjs';
import {verifyGeneration} from '../scripts/lib/generation/verify.mjs';
const put = (root, path, content) => {mkdirSync(dirname(join(root, path)), {recursive: true}); writeFileSync(join(root, path), content);};

// Real native runner contract tests; generated text here is deliberately a small runner fixture,
// not evidence of independent POM review or live browser/database integration.
async function nativeFixture(t, body = 'await expect(2 + 2).toBe(4);', extra = '') {
  const f = fixture(t), source = {version: 1, id: 'native-suite', title: 'Native verification', scenarios: [{id: 'case-1', title: 'Arithmetic', steps: [{action: 'Add', expected: ['The result is four']}]}]};
  const key = sourceExpectations(source)[0].key, bindings = [{key, runId: f.run.id, scenarioId: 'case-1', expectationId: 'visible'}];
  symlinkSync(join(f.roots.packageRoot, 'examples/node_modules'), join(f.roots.projectRoot, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
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
