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
  writeFileSync(join(dependencies, 'cli.js'), `const fs=require('node:fs'),path=require('node:path');if(fs.existsSync('.fail'))process.exit(7);const output=process.argv[process.argv.indexOf('--output')+1];fs.mkdirSync(path.join(output,'awesome'),{recursive:true});fs.writeFileSync(path.join(output,'awesome/index.html'),'<!doctype html><html><head></head><body>Native failed test</body></html>');fs.writeFileSync(path.join(output,'awesome/summary.json'),'{}');`);
  return {...f, capture(id) {
    const run = reserveAllureReport(f.roots, {id, at: new Date('2026-10-17T14:05:09.999Z')});
    mkdirSync(join(run.path, 'allure-results'));
    writeFileSync(join(run.path, 'allure-results/case-result.json'), '{"name":"native failure","status":"failed"}');
    writeFileSync(join(run.path, 'capture.json'), JSON.stringify({status: 'CAPTURED', source: 'playwright-native', tests: 1, reporter: '3.13.0', artifacts: allureInventory(join(run.path, 'allure-results'))}));
    return run;
  }};
}

test('canonical native report has one HTML, a relative latest link, and idempotent generation', async t => {
  const f = history(t), first = f.capture('ordinary-one');
  const receipt = await generateAllure(f.roots, first.directory);
  assert.equal(receipt.status, 'GENERATED', JSON.stringify(receipt)); assert.equal(receipt.artifact.path, `${first.directory}/index.html`);
  assert.equal(receipt.latest.status, 'WRITTEN'); assert.equal(receipt.latest.target, receipt.artifact.path);
  assert.deepEqual(readdirSync(first.path).filter(name => name.endsWith('.html')), ['index.html']);
  assert.equal(existsSync(join(first.path, 'awesome')), false); assert.equal(existsSync(join(first.path, 'allure-report')), false);
  const latest = join(f.roots.projectRoot, receipt.latest.path);
  assert.match(readFileSync(latest, 'utf8'), /href="2026-10-17_14-05-09Z\/index.html"/);
  assert(readFileSync(latest).length < 1024);
  const second = f.capture('ordinary-two'), newer = await generateAllure(f.roots, second.directory), before = readFileSync(latest, 'utf8');
  assert.equal(newer.status, 'GENERATED'); assert.match(before, /2026-10-17_14-05-09Z-001\/index.html/);
  assert.deepEqual((await generateAllure(f.roots, first.directory)).artifact, receipt.artifact);
  assert.equal(readFileSync(latest, 'utf8'), before, 'Opening an old report cannot make it latest.');
  assert.equal(readdirSync(join(f.roots.projectRoot, first.historyRoot)).filter(name => /^\d{4}-/.test(name)).length, 2);
});

test('generation failure retains prior latest and resumes in the same capture directory', async t => {
  const f = history(t), first = f.capture('first'); await generateAllure(f.roots, first.directory);
  const latest = join(f.roots.projectRoot, first.historyRoot, 'latest.html'), before = readFileSync(latest, 'utf8');
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
  const f = history(t), run = f.capture('normal'), latest = join(f.roots.projectRoot, run.historyRoot, 'latest.html');
  writeFileSync(latest, 'unrelated content'); const receipt = await generateAllure(f.roots, run.directory);
  assert.equal(receipt.status, 'GENERATED'); assert.equal(receipt.latest.status, 'FAILED');
  assert.equal(readFileSync(latest, 'utf8'), 'unrelated content'); assert(existsSync(join(run.path, 'generation.json')));
});

test('concurrent finalizers publish an intact latest link to one complete canonical report', async t => {
  const f = history(t), runs = [f.capture('one'), f.capture('two'), f.capture('three')];
  const module = new URL('../scripts/lib/reporting/allure.mjs', import.meta.url).href;
  const source = `import {generateAllure} from ${JSON.stringify(module)}; console.log(JSON.stringify(await generateAllure({projectRoot:process.argv[1]},process.argv[2])));`;
  const receipts = await Promise.all(runs.map(run => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', source, f.roots.projectRoot, run.directory], {windowsHide: true});
    let output = '', error = ''; child.stdout.on('data', bytes => {output += bytes;}); child.stderr.on('data', bytes => {error += bytes;});
    child.on('error', reject); child.on('close', code => code === 0 ? resolve(JSON.parse(output)) : reject(new Error(error)));
  })));
  for (const receipt of receipts) {assert.equal(receipt.status, 'GENERATED', JSON.stringify(receipt)); assert.equal(receipt.latest.status, 'WRITTEN');}
  const latest = readFileSync(join(f.roots.projectRoot, runs[0].historyRoot, 'latest.html'), 'utf8');
  const href = latest.match(/href="([^"]+)"/)[1];
  assert(runs.some(run => href === `${run.directory.split('/').at(-1)}/index.html`));
  assert(existsSync(join(f.roots.projectRoot, runs[0].historyRoot, href.replace('/index.html', '/generation.json'))));
  assert.equal(readdirSync(join(f.roots.projectRoot, runs[0].historyRoot)).some(name => name.startsWith('.latest-')), false);
});

test('an occupied render lock prevents same-invocation writers without replacing history', async t => {
  const f = history(t), run = f.capture('normal'); writeFileSync(join(run.path, '.generation.lock'), 'another report job');
  assert.equal((await generateAllure(f.roots, run.directory)).phase, 'GENERATION');
  assert.equal(readFileSync(join(run.path, '.generation.lock'), 'utf8'), 'another report job');
  assert.equal(existsSync(join(run.path, 'index.html')), false);
});

if (process.env.HARNESS_ALLURE_HTML_PROOF === '1') test('latest relative redirect opens the canonical local report in a real browser', async t => {
  const f = history(t), run = f.capture('normal'), receipt = await generateAllure(f.roots, run.directory); assert.equal(receipt.status, 'GENERATED');
  const {pathToFileURL} = await import('node:url');
  const {chromium} = await import(pathToFileURL(join(f.roots.packageRoot, 'examples/node_modules/playwright/index.mjs')).href);
  const browser = await chromium.launch({channel: process.env.HARNESS_BROWSER_CHANNEL, headless: true}); t.after(() => browser.close());
  const page = await browser.newPage(), requests = []; page.on('request', request => {requests.push(request.url());});
  await page.goto(pathToFileURL(join(f.roots.projectRoot, receipt.latest.path)).href);
  await page.waitForURL(pathToFileURL(join(run.path, 'index.html')).href);
  assert.match(await page.locator('body').innerText(), /Native failed test/);
  assert(requests.every(url => url.startsWith('file:')));
});
