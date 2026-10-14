#!/usr/bin/env node
// Offline, synthetic report UX proof using the package's pinned native browser.
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {packageRoot} from '../lib/consumer-paths.mjs';
import {renderExecutionHtml} from '../lib/execute/report-html.mjs';
import {renderAutomationHtml} from '../lib/reporting/case-view.mjs';
import {executionReportView} from '../../harness-tests/fixtures/execute-report.mjs';
import {nativeCliInstallation} from '../lib/browser/native-cli.mjs';

const [directory, mode] = process.argv.slice(2);
assert(directory && [undefined, '--base'].includes(mode), 'Use <fresh-output-directory> [--base].');
const output = resolve(directory); mkdirSync(output, {recursive: false});
const installation = nativeCliInstallation(packageRoot), require = createRequire(installation.executable), {chromium} = require('playwright');
let renderManual = renderExecutionHtml;
if (mode === '--base') {
  const git = path => execFileSync('git', ['-c', `safe.directory=${packageRoot.replaceAll('\\', '/')}`, 'show', `origin/main:${path}`], {cwd: packageRoot, encoding: 'utf8', windowsHide: true});
  const assets = 'data:text/javascript;base64,' + Buffer.from(git('scripts/lib/execute/report-assets.mjs')).toString('base64');
  const code = git('scripts/lib/execute/report-html.mjs').replace("'../reporting/render.mjs'", JSON.stringify(pathToFileURL(join(packageRoot, 'scripts/lib/reporting/render.mjs')).href)).replace("'./report-assets.mjs'", JSON.stringify(assets));
  renderManual = (await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))).renderExecutionHtml;
}
const manual = executionReportView(['PASS', 'FAIL', 'BLOCKED', 'NOT_RUN', 'NEEDS_REVIEW']);
manual.execution.createdAt = 1791975600000; manual.freeze = {environment: {name: 'Synthetic QA'}};
manual.scenarios[2].reason = 'The required QA account and customer fixture are unavailable.';
manual.scenarios[2].nextAction = 'Provision the QA account and fixture, then resume.'; manual.scenarios[2].stage = 'PREPARE';
const automation = {id: 'automation-fixture', sourceId: 'synthetic-source', title: 'Synthetic automation report', createdAt: new Date(1791975600000).toISOString(), environment: 'Synthetic QA', sourceFingerprint: 'synthetic-fixture', status: 'NEEDS_REVIEW', rounds: 1, greens: 0,
  cases: [{id: 'case-1', title: 'Observed arithmetic', status: 'PASS', stage: 'VERIFY', reason: 'The native test passed; readiness is still incomplete.', nativeStatus: 'passed', observedStatus: 'PASS'},
    {id: 'case-2', title: 'Verify the customer record', status: 'FAIL', stage: 'VERIFY', reason: '1 native assertion failed (toHaveText).', nextAction: 'Investigate the recorded failed assertion.', nativeStatus: 'failed'},
    {id: 'case-3', title: 'Explore the fixture', status: 'BLOCKED', stage: 'EXPLORE', reason: 'The required QA account and customer fixture are unavailable.', nextAction: 'Provision the QA account and fixture, then resume.', declaredBlocker: true},
    {id: 'case-4', title: 'Pending source case', status: 'NOT_GENERATED', stage: 'AUTHOR', reason: 'No generated candidate exists.'},
    {id: 'case-5', title: 'Review the candidate', status: 'NEEDS_REVIEW', stage: 'REVIEW', reason: 'Independent approval is missing.'}]};
const surfaces = [['execute', renderManual(manual)], ...(mode === '--base' ? [] : [['automate', renderAutomationHtml(automation)]])];
const sizes = [[390,844], [768,1024], [1440,900], [2560,1440], [3840,2160]];
let browser;
const proof = {version: 1, status: 'INCOMPLETE', theme: 'light', surfaces: [], viewports: sizes, horizontalSweep: {from: 320, to: 3840, step: 160}};
try {
  browser = await chromium.launch({headless: true});
  for (const [name, html] of surfaces) {
    const folder = join(output, name); mkdirSync(folder); writeFileSync(join(folder, 'index.html'), html);
    const page = await browser.newPage(), network = [], errors = [];
    await page.route(/^https?:/, route => {network.push(route.request().url()); return route.abort();});
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(join(folder, 'index.html')).href);
    for (const [width, height] of sizes) {
      await page.setViewportSize({width, height}); await page.screenshot({path: join(folder, `${width}.png`), fullPage: true});
    }
    assert(await page.locator('[data-case][data-status="FAIL"] .case-reason').isVisible(), 'Failure reason must be visible in the collapsed case row.');
    assert(await page.locator('[data-case][data-status="BLOCKED"] .case-reason').isVisible(), 'Blocker reason must be visible in the collapsed case row.');
    assert((await page.locator('[data-case][data-status="BLOCKED"] .case-reason').innerText()).includes('QA account'));
    const chart = await page.locator('[data-chart-status]').evaluateAll(nodes => nodes.map(node => [node.dataset.chartStatus, node.dataset.count]));
    assert.equal(await page.locator('[data-case]:visible').count(), 5);
    await page.locator('#status-filter').selectOption('FAIL'); assert.equal(await page.locator('[data-case]:visible').count(), 1);
    await page.locator('#status-filter').selectOption('BLOCKED'); assert.equal(await page.locator('[data-case]:visible').count(), 1);
    assert((await page.locator('#active-filters').innerText()).includes('BLOCKED'));
    assert((await page.locator('#result-count').innerText()).includes('1 of 5'));
    assert.deepEqual(await page.locator('[data-chart-status]').evaluateAll(nodes => nodes.map(node => [node.dataset.chartStatus, node.dataset.count])), chart);
    await page.locator('#case-search').fill('no-such-case'); assert(await page.locator('#no-results').isVisible());
    await page.locator('#clear-filters').click(); assert.equal(await page.locator('[data-case]:visible').count(), 5);
    await page.locator('#status-filter').focus(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    assert.equal(await page.locator('[data-case]:visible').count(), 1);
    await page.locator('#clear-filters').click();
    await page.locator('[data-case][data-status="BLOCKED"] > summary').focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('[data-case][data-status="BLOCKED"]').getAttribute('open'), '');
    assert((await page.locator('[data-case][data-status="BLOCKED"] .case-body').innerText()).includes('Provision'));
    await page.keyboard.press('Enter');
    for (let width = 320; width <= 3840; width += 160) {
      await page.setViewportSize({width, height: 900});
      const geometry = await page.evaluate(() => ({width: innerWidth, scroll: document.documentElement.scrollWidth, rows: [...document.querySelectorAll('[data-case]')].map(row => ({width: row.getBoundingClientRect().width, height: row.getBoundingClientRect().height}))}));
      assert(geometry.scroll <= geometry.width, `${name} overflows at ${width}px (${geometry.scroll}px).`); assert(geometry.rows.every(row => row.width > 0 && row.height > 0));
    }
    assert.deepEqual(network, []); assert.deepEqual(errors, []);
    proof.surfaces.push({workflow: name, cases: 5, filters: 'PASS', keyboard: 'PASS', offline: 'PASS', geometry: 'PASS'});
    await page.close();
  }
  proof.status = 'PASS';
} finally {
  if (browser) await browser.close();
  writeFileSync(join(output, 'results-report-proof.json'), JSON.stringify(proof, null, 2) + '\n');
}
console.log(JSON.stringify(proof));
