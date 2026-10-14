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
const pattern = ['PASS', 'FAIL', 'PASS', 'BLOCKED', 'PASS', 'NOT_RUN', 'PASS', 'NEEDS_REVIEW', 'PASS', 'PASS', 'PASS', 'FAIL', 'PASS', 'PASS', 'PASS', 'BLOCKED', 'PASS', 'NOT_RUN', 'PASS', 'FAIL'];
const statuses = Array.from({length: 120}, (_, index) => pattern[index % pattern.length]);
const manual = executionReportView(statuses);
manual.execution.createdAt = 1791975600000; manual.freeze = {environment: {name: 'Synthetic QA'}};
for (const scenario of manual.scenarios.filter(row => row.status === 'BLOCKED')) {
  scenario.reason = 'The required QA account and customer fixture are unavailable.';
  scenario.nextAction = 'Provision the QA account and fixture, then resume.'; scenario.stage = 'PREPARE';
}
const automation = {id: 'automation-fixture', sourceId: 'synthetic-source', title: 'Synthetic automation report', createdAt: new Date(1791975600000).toISOString(), environment: 'Synthetic QA', sourceFingerprint: 'synthetic-fixture', status: 'NEEDS_REVIEW', rounds: 1, greens: 0,
  cases: [{id: 'case-1', title: 'Observed arithmetic', status: 'PASS', stage: 'VERIFY', reason: 'The native test passed; readiness is still incomplete.', nativeStatus: 'passed', observedStatus: 'PASS'},
    {id: 'case-2', title: 'Verify the customer record', status: 'FAIL', stage: 'VERIFY', reason: '1 native assertion failed (toHaveText).', nextAction: 'Investigate the recorded failed assertion.', nativeStatus: 'failed'},
    {id: 'case-3', title: 'Explore the fixture', status: 'BLOCKED', stage: 'EXPLORE', reason: 'The required QA account and customer fixture are unavailable.', nextAction: 'Provision the QA account and fixture, then resume.', declaredBlocker: true},
    {id: 'case-4', title: 'Pending source case', status: 'NOT_GENERATED', stage: 'AUTHOR', reason: 'No generated candidate exists.'},
    {id: 'case-5', title: 'Review the candidate', status: 'NEEDS_REVIEW', stage: 'REVIEW', reason: 'Independent approval is missing.'}]};
automation.cases = statuses.map((status, index) => ({...automation.cases[{PASS: 0, FAIL: 1, BLOCKED: 2, NOT_RUN: 3, NEEDS_REVIEW: 4}[status]], id: `case-${index + 1}`, title: `Case ${index + 1} · ${'A detailed synthetic source title '.repeat(index === 3 ? 8 : 1)}`, status: status === 'NOT_RUN' ? 'NOT_GENERATED' : status}));
const surfaces = [['execute', renderManual(manual)], ...(mode === '--base' ? [] : [['automate', renderAutomationHtml(automation)]])];
const sizes = [[390,844], [768,1024], [1440,900], [2560,1440], [3840,2160]];
let browser;
const proof = {version: 2, status: 'INCOMPLETE', themes: ['light', 'dark'], surfaces: [], viewports: sizes, horizontalSweep: {from: 320, to: 3840, step: 160}};
try {
  browser = await chromium.launch({headless: true});
  for (const [name, html] of surfaces) {
    const folder = join(output, name); mkdirSync(folder); writeFileSync(join(folder, 'index.html'), html);
    const page = await browser.newPage(), network = [], errors = [];
    await page.route(/^https?:/, route => {network.push(route.request().url()); return route.abort();});
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(join(folder, 'index.html')).href);
    assert.equal(await page.locator('.status-choice input[type="checkbox"]').count(), 5, 'Multiple statuses must be independently selectable.');
    assert.equal(await page.locator('[data-group]').count(), 5);
    assert.equal(await page.locator('[data-group][open]').count(), 0, 'Groups start collapsed.');
    assert.equal(await page.locator('[data-case]:visible').count(), 0);
    assert.equal(await page.getByRole('link', {name: /Result data|JSON/i}).count(), 0);
    assert.equal(await page.getByRole('button', {name: /Result data|JSON/i}).count(), 0);
    const chart = await page.locator('[data-chart-status]').evaluateAll(nodes => nodes.map(node => [node.dataset.chartStatus, node.dataset.count]));
    const failed = page.locator('.status-choice input[value="FAIL"]'), blocked = page.locator('.status-choice input[value="BLOCKED"]');
    await failed.check(); await blocked.check();
    assert.equal(await page.locator('[data-group]:visible').count(), 2);
    assert.equal(await page.locator('[data-case]:visible').count(), 20, 'Each matching group shows at most 10 cases.');
    assert.equal(await page.locator('[data-case]:visible:not([data-status="FAIL"]):not([data-status="BLOCKED"])').count(), 0);
    assert((await page.locator('#active-filters').innerText()).includes('Failed + Blocked'));
    assert((await page.locator('#result-count').innerText()).includes('30 of 120'));
    assert(await page.locator('[data-case][data-status="FAIL"] .case-reason').first().isVisible());
    assert((await page.locator('[data-case][data-status="BLOCKED"] .case-reason').first().innerText()).includes('QA account'));
    assert.deepEqual(await page.locator('[data-chart-status]').evaluateAll(nodes => nodes.map(node => [node.dataset.chartStatus, node.dataset.count])), chart);
    const failedGroup = page.locator('[data-group-status="FAIL"]');
    await failedGroup.getByRole('button', {name: 'Next'}).click();
    assert.equal(await failedGroup.locator('[data-case]:visible').count(), 8);
    assert((await failedGroup.locator('.page-label').innerText()).includes('11–18 of 18'));
    assert(await failedGroup.getByRole('button', {name: 'Next'}).isDisabled());
    assert.equal(await failedGroup.locator('summary').first().evaluate(node => node === document.activeElement), true);
    await page.locator('#case-search').fill(name === 'execute' ? 'tc-4-r1' : 'Case 4 ·');
    assert.equal(await page.locator('[data-case]:visible').count(), 1, 'Search narrows the selected status union.');
    await page.locator('#case-search').fill('no-such-case'); assert(await page.locator('#no-results').isVisible());
    await page.locator('#clear-filters').click(); assert.equal(await page.locator('[data-group][open]').count(), 0);
    await failed.focus(); await page.keyboard.press('Space'); await blocked.focus(); await page.keyboard.press('Space');
    assert((await page.locator('#result-count').innerText()).includes('30 of 120'));
    await blocked.uncheck(); assert((await page.locator('#result-count').innerText()).includes('18 of 120'));
    await failed.uncheck(); assert((await page.locator('#result-count').innerText()).includes('120 of 120'));
    await page.locator('[data-attention]').click(); assert((await page.locator('#result-count').innerText()).includes('36 of 120'));
    await page.locator('[data-filter-status="BLOCKED"]').click(); assert(!await blocked.isChecked());
    await page.locator('#all-statuses').click();
    for (const checkbox of await page.locator('.status-choice input').all()) await checkbox.check();
    assert((await page.locator('#result-count').innerText()).includes('120 of 120'));
    await page.locator('#clear-filters').click();
    await blocked.check();
    await page.locator('[data-case][data-status="BLOCKED"] > summary').first().focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('[data-case][data-status="BLOCKED"]').first().getAttribute('open'), '');
    assert((await page.locator('[data-case][data-status="BLOCKED"] .case-body').first().innerText()).includes('Provision'));
    await page.keyboard.press('Enter');
    await failed.check();
    for (const theme of proof.themes) {
      await page.emulateMedia({colorScheme: theme});
      for (const [width, height] of sizes) {
        await page.setViewportSize({width, height}); await page.screenshot({path: join(folder, `${theme}-${width}.png`), fullPage: true});
      }
      for (let width = 320; width <= 3840; width += 160) {
        await page.setViewportSize({width, height: 900});
        const geometry = await page.evaluate(() => ({width: innerWidth, scroll: document.documentElement.scrollWidth, font: getComputedStyle(document.querySelector('h1')).fontSize, rows: [...document.querySelectorAll('[data-case]:not([hidden]) > summary')].filter(row => row.getClientRects().length).map(row => ({width: row.getBoundingClientRect().width, height: row.getBoundingClientRect().height}))}));
        assert(geometry.scroll <= geometry.width, `${name}/${theme} overflows at ${width}px (${geometry.scroll}px).`);
        assert.equal(geometry.font, '20px'); assert(geometry.rows.every(row => row.width > 0 && row.height >= 38));
      }
    }
    await page.locator('#theme-toggle').click(); assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    await page.locator('#clear-filters').click(); await page.locator('#expand-groups').click();
    assert.equal(await page.locator('[data-group][open]').count(), 5); assert.equal(await page.locator('[data-case]:visible').count(), 46);
    await page.locator('#collapse-groups').click(); assert.equal(await page.locator('[data-case]:visible').count(), 0);
    await page.evaluate(() => {location.hash = 'case-119';});
    await page.locator('#case-119').waitFor({state: 'visible'});
    assert.equal(await page.locator('#case-119').getAttribute('open'), '', 'Deep links reveal off-page cases.');
    assert.deepEqual(network, []); assert.deepEqual(errors, []);
    const fallback = await browser.newPage({javaScriptEnabled: false});
    await fallback.goto(pathToFileURL(join(folder, 'index.html')).href);
    assert.equal(await fallback.locator('[data-case]').count(), 120); await fallback.locator('[data-group-status="FAIL"] > summary').click();
    assert.equal(await fallback.locator('[data-case][data-status="FAIL"]:visible').count(), 18, 'Without JavaScript all cases remain accessible.');
    await fallback.close();
    proof.surfaces.push({workflow: name, cases: 120, groups: 5, multiStatus: 'PASS', pagination: 'PASS', keyboard: 'PASS', offline: 'PASS', geometry: 'PASS', noScriptFallback: 'PASS'});
    await page.close();
  }
  proof.status = 'PASS';
} finally {
  if (browser) await browser.close();
  writeFileSync(join(output, 'results-report-proof.json'), JSON.stringify(proof, null, 2) + '\n');
}
console.log(JSON.stringify(proof));
