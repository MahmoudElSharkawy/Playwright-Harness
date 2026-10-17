import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {fixture} from './fixtures/execution-core.mjs';
import {reserveAllureReport, generateAllure, allureInventory} from '../scripts/lib/reporting/allure.mjs';

function history(t) {
  const f = fixture(t), dependencies = join(f.roots.projectRoot, 'node_modules/allure'); mkdirSync(dependencies, {recursive: true});
  writeFileSync(join(f.roots.projectRoot, 'package.json'), '{"type":"commonjs"}');
  writeFileSync(join(dependencies, 'package.json'), JSON.stringify({name: 'allure', version: '3.19.1', main: 'index.cjs'}));
  writeFileSync(join(dependencies, 'index.cjs'), '');
  writeFileSync(join(dependencies, 'cli.js'), `const fs=require('node:fs'),path=require('node:path');if(fs.existsSync('.fail'))process.exit(7);const output=process.argv[process.argv.indexOf('--output')+1];fs.appendFileSync(path.join(output,'.render-count'),'render\\n');fs.mkdirSync(path.join(output,'awesome'),{recursive:true});fs.writeFileSync(path.join(output,'awesome/index.html'),'<!doctype html><html><head></head><body>Native failed test '+require('node:crypto').randomUUID()+'</body></html>');fs.writeFileSync(path.join(output,'awesome/summary.json'),'{}');`);
  return {...f, capture(id) {
    const run = reserveAllureReport(f.roots, {id, at: new Date('2026-10-17T14:05:09.999Z')});
    mkdirSync(join(run.path, 'allure-results'));
    writeFileSync(join(run.path, 'allure-results/case-result.json'), '{"name":"native failure","status":"failed"}');
    writeFileSync(join(run.path, 'capture.json'), JSON.stringify({status: 'CAPTURED', source: 'playwright-native', tests: 1, reporter: '3.13.0', artifacts: allureInventory(join(run.path, 'allure-results'))}));
    return run;
  }};
}

test('canonical evidence and current HTML retain idempotent generation and archive only older reports', async t => {
  const f = history(t), first = f.capture('ordinary-one');
  const receipt = await generateAllure(f.roots, first.directory);
  assert.equal(receipt.status, 'GENERATED', JSON.stringify(receipt)); assert.equal(receipt.artifact.path, `${first.directory}/index.html`);
  assert.equal(receipt.latest.status, 'WRITTEN'); assert.equal(receipt.latest.target, receipt.artifact.path);
  assert.deepEqual(readdirSync(first.path).filter(name => name.endsWith('.html')), ['index.html']);
  assert.equal(existsSync(join(first.path, 'awesome')), false); assert.equal(existsSync(join(first.path, 'allure-report')), false);
  const latest = join(f.roots.projectRoot, receipt.latest.path);
  assert.equal(receipt.latest.path, 'reports/allure-report/index.html');
  assert.match(readFileSync(latest, 'utf8'), /Native failed test/);
  const second = f.capture('ordinary-two'), newer = await generateAllure(f.roots, second.directory), before = readFileSync(latest, 'utf8');
  assert.equal(newer.status, 'GENERATED'); assert.match(before, /2026-10-17_14-05-09Z-001/);
  assert.deepEqual((await generateAllure(f.roots, first.directory)).artifact, receipt.artifact);
  assert.equal(readFileSync(latest, 'utf8'), before, 'Opening an old report cannot make it latest.');
  assert.deepEqual(readdirSync(join(f.roots.projectRoot, first.historyRoot)), ['2026-10-17_14-05-09Z.html']);
});

test('generation failure retains prior latest and resumes in the same capture directory', async t => {
  const f = history(t), first = f.capture('first'); await generateAllure(f.roots, first.directory);
  const latest = join(f.roots.projectRoot, 'reports/allure-report/index.html'), before = readFileSync(latest, 'utf8');
  const failed = f.capture('failed'); writeFileSync(join(failed.path, '.fail'), 'fail rendering');
  assert.equal((await generateAllure(f.roots, failed.directory)).status, 'FAILED');
  assert.equal(readFileSync(latest, 'utf8'), before); assert.equal(existsSync(join(failed.path, 'generation.json')), false);
  const {unlinkSync} = await import('node:fs'); unlinkSync(join(failed.path, '.fail'));
  const resumed = await generateAllure(f.roots, failed.directory); assert.equal(resumed.status, 'GENERATED');
  assert.equal(resumed.artifact.path, `${failed.directory}/index.html`); assert.notEqual(readFileSync(latest, 'utf8'), before);
});

test('missing verification identity and tampered completed HTML cannot be reported successfully', async t => {
  const f = history(t), missing = f.capture('verify-missing-reference');
  assert.equal((await generateAllure(f.roots, missing.directory)).phase, 'VERIFICATION');
  const run = f.capture('normal'), receipt = await generateAllure(f.roots, run.directory); assert.equal(receipt.status, 'GENERATED');
  writeFileSync(join(run.path, 'index.html'), 'replaced');
  assert.equal((await generateAllure(f.roots, run.directory)).status, 'FAILED');
});

test('rewritten completion receipt cannot redirect the canonical report or change native scope', async t => {
  const f = history(t), run = f.capture('normal'); await generateAllure(f.roots, run.directory);
  const path = join(run.path, 'generation.json'), original = JSON.parse(readFileSync(path, 'utf8'));
  for (const patch of [{tests: 2}, {artifact: {...original.artifact, path: `${run.directory}/../foreign.html`}}, {verification: {id: 'foreign'}}]) {
    writeFileSync(path, JSON.stringify({...original, ...patch}));
    assert.equal((await generateAllure(f.roots, run.directory)).status, 'FAILED');
  }
});

test('unknown latest file is preserved and its delivery failure remains explicit', async t => {
  const f = history(t), run = f.capture('normal'), latest = join(f.roots.projectRoot, 'reports/allure-report/index.html');
  mkdirSync(join(f.roots.projectRoot, 'reports/allure-report'), {recursive: true});
  writeFileSync(latest, 'unrelated content'); const receipt = await generateAllure(f.roots, run.directory);
  assert.equal(receipt.status, 'GENERATED'); assert.equal(receipt.latest.status, 'FAILED');
  assert.equal(readFileSync(latest, 'utf8'), 'unrelated content'); assert(existsSync(join(run.path, 'generation.json')));
  const {unlinkSync} = await import('node:fs'); unlinkSync(latest);
  const resumed = await generateAllure(f.roots, run.directory);
  assert.equal(resumed.latest.status, 'WRITTEN'); assert.match(readFileSync(latest, 'utf8'), /Native failed test/);
  assert.equal(readFileSync(join(run.path, '.render-count'), 'utf8'), 'render\n');
});

test('concurrent finalizers publish one intact current HTML and archive the other complete reports', async t => {
  const f = history(t), runs = [f.capture('one'), f.capture('two'), f.capture('three')];
  const module = new URL('../scripts/lib/reporting/allure.mjs', import.meta.url).href;
  const source = `import {generateAllure} from ${JSON.stringify(module)}; console.log(JSON.stringify(await generateAllure({projectRoot:process.argv[1]},process.argv[2])));`;
  const receipts = await Promise.all(runs.map(run => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', source, f.roots.projectRoot, run.directory], {windowsHide: true});
    let output = '', error = ''; child.stdout.on('data', bytes => {output += bytes;}); child.stderr.on('data', bytes => {error += bytes;});
    child.on('error', reject); child.on('close', code => code === 0 ? resolve(JSON.parse(output)) : reject(new Error(error)));
  })));
  for (const receipt of receipts) {assert.equal(receipt.status, 'GENERATED', JSON.stringify(receipt)); assert.equal(receipt.latest.status, 'WRITTEN');}
  const latest = readFileSync(join(f.roots.projectRoot, 'reports/allure-report/index.html'), 'utf8');
  const metadata = JSON.parse(latest.match(/^<!-- harness-allure-report\/2 (.+) -->/)[1]);
  assert(runs.some(run => run.directory === metadata.directory));
  assert(existsSync(join(f.roots.projectRoot, metadata.directory, 'generation.json')));
  const archived = readdirSync(join(f.roots.projectRoot, runs[0].historyRoot));
  assert.equal(archived.length, 2); assert(archived.every(name => name.endsWith('.html')));
  assert.deepEqual(readdirSync(join(f.roots.projectRoot, 'reports/allure-report')), ['index.html']);
});

test('an occupied render lock prevents same-invocation writers without replacing history', async t => {
  const f = history(t), run = f.capture('normal'); writeFileSync(join(run.path, '.generation.lock'), 'another report job');
  assert.equal((await generateAllure(f.roots, run.directory)).phase, 'GENERATION');
  assert.equal(readFileSync(join(run.path, '.generation.lock'), 'utf8'), 'another report job');
  assert.equal(existsSync(join(run.path, 'index.html')), false);
});

test('completion is rechecked under the lock when another process finishes before acquisition', async t => {
  const f = history(t), run = f.capture('one-invocation');
  const module = new URL('../scripts/lib/reporting/allure.mjs', import.meta.url).href;
  const source = `import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';import path from 'node:path';const original=fs.openSync;fs.openSync=function(file,...args){if(String(file).endsWith('.generation.lock')){fs.writeFileSync(path.join(process.argv[1],'ready'),'');const until=Date.now()+15000;while(!fs.existsSync(path.join(process.argv[1],'done'))){if(Date.now()>until)throw new Error('parent did not complete');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}}return original.call(this,file,...args);};syncBuiltinESMExports();const {generateAllure}=await import(${JSON.stringify(module)});console.log(JSON.stringify(await generateAllure({projectRoot:process.argv[1]},process.argv[2])));`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source, f.roots.projectRoot, run.directory], {windowsHide: true});
  let output = '', error = ''; child.stdout.on('data', bytes => {output += bytes;}); child.stderr.on('data', bytes => {error += bytes;});
  const completed = new Promise((resolve, reject) => {child.on('error', reject); child.on('close', code => code === 0 ? resolve(JSON.parse(output)) : reject(new Error(error)));});
  t.after(() => {if (child.exitCode === null) child.kill();});
  const {setTimeout: delay} = await import('node:timers/promises'), until = Date.now() + 15000;
  while (!existsSync(join(f.roots.projectRoot, 'ready'))) {assert(Date.now() < until, 'Child did not reach lock acquisition.'); await delay(10);}
  const first = await generateAllure(f.roots, run.directory);
  writeFileSync(join(f.roots.projectRoot, 'done'), ''); const second = await completed;
  assert.equal(first.status, 'GENERATED'); assert.equal(second.status, 'GENERATED', JSON.stringify(second));
  assert.deepEqual(second.artifact, first.artifact); assert.equal((await generateAllure(f.roots, run.directory)).status, 'GENERATED');
  assert.equal(readFileSync(join(run.path, '.render-count'), 'utf8'), 'render\n');
});

if (process.env.HARNESS_ALLURE_HTML_PROOF === '1') test('current HTML opens directly as a standalone local report in a real browser', async t => {
  const f = history(t), run = f.capture('normal'), receipt = await generateAllure(f.roots, run.directory); assert.equal(receipt.status, 'GENERATED');
  const {pathToFileURL} = await import('node:url');
  const {chromium} = await import(pathToFileURL(join(f.roots.packageRoot, 'examples/node_modules/playwright/index.mjs')).href);
  const browser = await chromium.launch({channel: process.env.HARNESS_BROWSER_CHANNEL, headless: true}); t.after(() => browser.close());
  const page = await browser.newPage(), requests = []; page.on('request', request => {requests.push(request.url());});
  await page.goto(pathToFileURL(join(f.roots.projectRoot, receipt.latest.path)).href);
  await page.waitForURL(pathToFileURL(join(f.roots.projectRoot, 'reports/allure-report/index.html')).href);
  assert.match(await page.locator('body').innerText(), /Native failed test/);
  assert(requests.every(url => url.startsWith('file:')));
});
