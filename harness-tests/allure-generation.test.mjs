import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync, readFileSync, symlinkSync, existsSync, readdirSync, cpSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fixture} from './fixtures/execution-core.mjs';
import {allureInventory, generateAllure} from '../scripts/lib/reporting/allure.mjs';
import {digest} from '../scripts/lib/execution-core/data.mjs';

const put = (root, path, content) => {mkdirSync(dirname(join(root, path)), {recursive: true}); writeFileSync(join(root, path), content);};
function captured(t, fake) {
  const f = fixture(t), root = f.roots.projectRoot, directory = 'reports/space and [brackets]';
  put(root, 'package.json', '{"type":"module"}');
  if (fake) {
    put(root, 'node_modules/allure/package.json', JSON.stringify({name: 'allure', version: fake.version ?? '3.19.1', main: 'index.js'}));
    put(root, 'node_modules/allure/index.js', ''); put(root, 'node_modules/allure/cli.js', fake.cli ?? 'process.exit(7);');
  } else symlinkSync(join(f.roots.packageRoot, 'examples/node_modules'), join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  for (const [number, status] of ['passed', 'failed', 'broken', 'skipped', 'unknown'].entries()) {
    put(root, `${directory}/allure-results/${number}-result.json`, JSON.stringify({uuid: `native-${number}`, name: `Native ${status}`,
      fullName: `Fixture.${status}`, historyId: `history-${number}`, status, stage: 'finished', start: 1000, stop: 1010,
      labels: [{name: 'epic', value: 'Synthetic suite'}, {name: 'feature', value: 'Reporting'}, {name: 'story', value: 'Compatibility'}],
      steps: [{name: 'Business action', status, steps: [{name: 'Technical operation', status,
        attachments: [{name: 'Harness execution result', type: 'application/json', source: `${number}-result-attachment.json`},
          {name: 'Harness execution report', type: 'text/html', source: `${number}-report-attachment.html`}]}]}]}));
    put(root, `${directory}/allure-results/${number}-result-attachment.json`, '{"status":"PASS","stability":"recovered"}');
    put(root, `${directory}/allure-results/${number}-report-attachment.html`, '<!doctype html><p>Required cleanup failed; assertion FAIL preserved.</p>');
  }
  const artifacts = allureInventory(join(root, directory, 'allure-results'));
  put(root, `${directory}/capture.json`, JSON.stringify({status: 'CAPTURED', source: 'playwright-native', reporter: '3.13.0', tests: 5, artifacts}));
  return {...f, root, directory, artifacts};
}

/** Inspect the pinned renderer's inline data without evaluating generated scripts. */
function inlineFiles(html) {
  return new Map([...html.matchAll(/\bd\(("(?:[^"\\]|\\.)*"),("(?:[^"\\]|\\.)*")\)/g)]
    .map(match => [JSON.parse(match[1]), Buffer.from(JSON.parse(match[2]), 'base64')]));
}

test('Allure 3 preserves native statuses, business/technical nesting and attachment bytes without Java or ambient config', async t => {
  const f = captured(t);
  put(f.root, `${f.directory}/allurerc.mjs`, "throw new Error('Consumer config must not execute');");
  const originalPath = process.env.PATH; process.env.PATH = '';
  let receipt;
  try {receipt = await generateAllure(f.roots, f.directory);} finally {process.env.PATH = originalPath;}
  assert.equal(receipt.status, 'GENERATED', JSON.stringify(receipt)); assert.equal(receipt.commandline, '3.19.1'); assert.equal(receipt.generator, 'allure');
  const bytes = readFileSync(join(f.root, receipt.artifact.path)), html = bytes.toString();
  assert.equal(bytes.length, receipt.artifact.bytes); assert.equal(digest(bytes), receipt.artifact.sha256);
  assert.deepEqual(allureInventory(join(f.root, f.directory, 'allure-results')), f.artifacts);
  assert.match(html, /Content-Security-Policy/); assert.match(html, /default-src 'none'/);
  const files = inlineFiles(html), results = [...files].filter(([name]) => /^data\/test-results\/.+\.json$/.test(name)).map(([, value]) => JSON.parse(value));
  assert.equal(results.length, 5); assert.deepEqual(results.map(r => r.status).sort(), ['broken', 'failed', 'passed', 'skipped', 'unknown']);
  for (const result of results) {
    assert.equal(result.steps[0].name, 'Business action'); assert.equal(result.steps[0].steps[0].name, 'Technical operation');
    const attachments = result.steps[0].steps[0].steps;
    assert.deepEqual(attachments.map(a => a.link.name), ['Harness execution result', 'Harness execution report']);
    for (const [index, attachment] of attachments.entries()) {
      assert.equal(attachment.type, 'attachment'); assert.equal(attachment.link.missed, false);
      assert.equal(files.get(`data/attachments/${attachment.link.id}${attachment.link.ext}`).toString(), index === 0
        ? '{"status":"PASS","stability":"recovered"}' : '<!doctype html><p>Required cleanup failed; assertion FAIL preserved.</p>');
    }
  }
  assert.equal(existsSync(join(f.root, f.directory, 'allure-report/agent')), false);
  assert.equal((await generateAllure(f.roots, f.directory)).status, 'FAILED');
});

for (const [name, fake, phase] of [
  ['unsupported version', {version: '3.0.0'}, 'DEPENDENCY'],
  ['nonzero exit', {cli: 'process.exit(7);'}, 'GENERATION'],
  ['missing HTML', {cli: 'process.exit(0);'}, 'OUTPUT'],
]) test(`Allure ${name} cannot create a successful receipt`, async t => {
  const f = captured(t, fake), result = await generateAllure(f.roots, f.directory);
  assert.equal(result.status, 'FAILED'); assert.equal(result.phase, phase);
  assert.equal(existsSync(join(f.root, f.directory, 'generation.json')), false);
  assert.deepEqual(allureInventory(join(f.root, f.directory, 'allure-results')), f.artifacts);
});

for (const [name, fails, missingGenerator] of [['passing test', false, false], ['failing test', true, false], ['missing generator', false, true]]) {
  test(`example post-flush reporting preserves a ${name}'s native outcome`, t => {
    const f = fixture(t), root = f.roots.projectRoot, example = join(f.roots.packageRoot, 'examples');
    for (const file of ['src/utils/AllureReport.ts', 'src/utils/allure-step-titles.cjs', 'src/config/reporting.ts', 'global-setup.ts', 'allurerc.json']) {
      mkdirSync(dirname(join(root, file)), {recursive: true}); cpSync(join(example, file), join(root, file));
    }
    if (missingGenerator) {
      for (const name of ['@playwright/test', 'playwright', 'playwright-core', 'allure-playwright', 'allure-js-commons']) {
        const destination = join(root, 'node_modules', name); mkdirSync(dirname(destination), {recursive: true}); symlinkSync(join(example, 'node_modules', name), destination, process.platform === 'win32' ? 'junction' : 'dir');
      }
    } else symlinkSync(join(example, 'node_modules'), join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    put(root, 'package.json', '{"type":"commonjs"}');
    const resultsDir = fails ? 'allure-results' : 'reports/custom allure-results';
    put(root, 'playwright.config.ts', `export default {testDir:'./tests',workers:1,retries:0,globalSetup:'./global-setup.ts',reporter:[['./src/utils/AllureReport.ts',{resultsDir:${JSON.stringify(resultsDir)},environmentInfo:{fixture:'after-flush'}}]]};`);
    put(root, 'tests/Report.spec.ts', `import {test,expect} from '@playwright/test'; import {step} from 'allure-js-commons'; test('native report',async()=>{await step('Business action',async()=>{await test.step('Technical operation',async()=>{await test.info().attach('Synthetic attachment',{body:'unchanged',contentType:'text/plain'});});});await expect(2).toBe(${fails ? 3 : 2});});`);
    const run = spawnSync(process.execPath, [join(example, 'node_modules/@playwright/test/cli.js'), 'test', '--config=playwright.config.ts'],
      {cwd: root, env: {...process.env, CI: '1', AUTO_ALLURE_OPEN: 'false'}, encoding: 'utf8', timeout: 90000, windowsHide: true});
    assert.equal(run.status, fails ? 1 : 0, run.stderr);
    const output = join(root, 'allure-report/index.html');
    if (missingGenerator) {assert.equal(existsSync(output), false); assert.match(run.stdout + run.stderr, /test outcomes are unchanged/); return;}
    const summary = JSON.parse(readFileSync(join(root, 'allure-report/summary.json')));
    assert.equal(summary.stats.total, 1); assert.equal(summary.status, fails ? 'failed' : 'passed');
    const html = readFileSync(output, 'utf8'), files = inlineFiles(html);
    assert([...files.values()].some(value => value.toString().includes('after-flush')));
    const archives = readdirSync(join(root, 'reports/allure-history')); assert.equal(archives.length, 1);
    assert.equal(readFileSync(join(root, 'reports/allure-history', archives[0], 'index.html'), 'utf8'), html);
  });
}

test('the example finishes Allure before entering the HTML viewer exit hook', t => {
  const f = fixture(t), root = f.roots.projectRoot, example = join(f.roots.packageRoot, 'examples');
  for (const file of ['playwright.config.ts', 'src/utils/AllureReport.ts', 'src/utils/allure-step-titles.cjs', 'src/config/reporting.ts', 'src/config/timeouts.ts', 'global-setup.ts', 'allurerc.json']) {
    mkdirSync(dirname(join(root, file)), {recursive: true}); cpSync(join(example, file), join(root, file));
  }
  symlinkSync(join(example, 'node_modules'), join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  put(root, 'package.json', '{"type":"commonjs"}');
  // Keep the shipped reporter order. Observe the point at which the real HTML viewer can block onExit.
  put(root, 'proof.config.ts', `import source from './playwright.config'; export default {...source,workers:1,retries:0,reporter:source.reporter.filter(([name])=>['list','html','./src/utils/AllureReport.ts'].includes(name)).map(([name,options])=>name==='html'?['./HtmlExitBoundary.ts']:[name,options])};`);
  put(root, 'HtmlExitBoundary.ts', `import {existsSync,writeFileSync} from 'node:fs'; export default class HtmlExitBoundary {onExit(){writeFileSync('html-exit.json',JSON.stringify({reportReady:existsSync('allure-report/index.html')}));}}`);
  put(root, 'tests/Report.spec.ts', `import {test,expect} from '@playwright/test'; test('native report ordering',()=>{expect(2).toBe(2);});`);
  const run = spawnSync(process.execPath, [join(example, 'node_modules/@playwright/test/cli.js'), 'test', '--config=proof.config.ts'],
    {cwd: root, env: {...process.env, CI: '', AUTO_ALLURE_OPEN: 'false'}, encoding: 'utf8', timeout: 90000, windowsHide: true});
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'html-exit.json'))), {reportReady: true});
  assert.equal(JSON.parse(readFileSync(join(root, 'allure-report/summary.json'))).stats.total, 1);
});
