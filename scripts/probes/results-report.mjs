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
import {automationCompanions, automationReportView} from '../lib/generation/report.mjs';
import {renderHtml, reportView} from '../lib/reporting/index.mjs';
import {fixture, resource} from '../../harness-tests/fixtures/execution-core.mjs';
import {prepared, recorded, productionBlockers} from '../../harness-tests/fixtures/generation-report.mjs';
import {executionReportView} from '../../harness-tests/fixtures/execute-report.mjs';
import {nativeCliInstallation} from '../lib/browser/native-cli.mjs';

const [directory, mode] = process.argv.slice(2);
assert(directory && [undefined, '--base'].includes(mode), 'Use <fresh-output-directory> [--base].');
const output = resolve(directory); mkdirSync(output, {recursive: false});
const installation = nativeCliInstallation(packageRoot), require = createRequire(installation.executable), {chromium} = require('playwright');
let renderManual = renderExecutionHtml, renderAutomation = renderAutomationHtml, renderRuntime = renderHtml;
if (mode === '--base') {
  const git = path => execFileSync('git', ['-c', `safe.directory=${packageRoot.replaceAll('\\', '/')}`, 'show', `origin/main:${path}`], {cwd: packageRoot, encoding: 'utf8', windowsHide: true});
  const moduleUrl = path => JSON.stringify(pathToFileURL(join(packageRoot, path)).href);
  const code = git('scripts/lib/execute/report-html.mjs').replace("'../reporting/render.mjs'", moduleUrl('scripts/lib/reporting/render.mjs')).replace("'./report-assets.mjs'", moduleUrl('scripts/lib/reporting/case-assets.mjs')).replace("'../reporting/case-view.mjs'", moduleUrl('scripts/lib/reporting/case-view.mjs'));
  renderManual = (await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))).renderExecutionHtml;
  const automationCode = git('scripts/lib/reporting/case-view.mjs').replace("'./render.mjs'", moduleUrl('scripts/lib/reporting/render.mjs')).replace("'./case-assets.mjs'", moduleUrl('scripts/lib/reporting/case-assets.mjs'));
  renderAutomation = (await import('data:text/javascript;base64,' + Buffer.from(automationCode).toString('base64'))).renderAutomationHtml;
  const runtimeCode = git('scripts/lib/reporting/render.mjs').replace("'./model.mjs'", moduleUrl('scripts/lib/reporting/model.mjs'));
  renderRuntime = (await import('data:text/javascript;base64,' + Buffer.from(runtimeCode).toString('base64'))).renderHtml;
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
const productionCleanups = [], productionCases = [];
try {
  for (const [status, patch] of [['PASS', {}], ['READY', {}], ['NEEDS_REVIEW', {assertions: {passed: 0, failed: 0}}], ['SKIPPED', {status: 'skipped'}]]) {
    const f = await prepared({after: action => productionCleanups.push(action)});
    await recorded(f, 'PASS', 'verification-first', patch);
    if (status === 'READY') await recorded(f, 'PASS', 'verification-second');
    const view = await automationReportView(f.roots, {sourceId: f.source.id});
    assert.equal(view.cases[0].status, status);
    productionCases.push({...view.cases[0], id: `production-${status}`});
  }
} finally {for (const cleanup of productionCleanups.reverse()) await cleanup();}
automation.cases[0] = {...automation.cases[0], ...productionCases.find(row => row.status === 'PASS')};
automation.cases = statuses.map((status, index) => ({...automation.cases[{PASS: 0, FAIL: 1, BLOCKED: 2, NOT_RUN: 3, NEEDS_REVIEW: 4}[status]], id: `case-${index + 1}`, title: `Case ${index + 1} · ${'A detailed synthetic source title '.repeat(index === 3 ? 8 : 1)}`, status: status === 'NOT_RUN' ? 'NOT_GENERATED' : status}));
const surfaces = [['execute', renderManual(manual)], ['automate', renderAutomation(automation)]];
const cleanups = [], runtimeFixture = fixture({after: action => cleanups.push(action)});
resource(runtimeFixture, 'persistent');
const runtimeHtml = renderRuntime(reportView(runtimeFixture.assess()));
for (const cleanup of cleanups.reverse()) await cleanup();
const sizes = [[390,844], [768,1024], [1440,900], [2560,1440], [3840,2160]];
let browser;
const proof = {version: 5, status: 'INCOMPLETE', themes: ['light', 'dark'], surfaces: [], viewports: sizes, horizontalSweep: {from: 320, to: 3840, step: 160}};
try {
  browser = await chromium.launch({headless: true});
  const productionFolder = join(output, 'production'); mkdirSync(productionFolder);
  const commandBlockers = productionBlockers().map((blocker, index) => ({...blocker, status: 'BLOCKED', id: `blocker-${index}`, title: 'Automation stopped'}));
  writeFileSync(join(productionFolder, 'index.html'), renderAutomation({...automation, blocker: productionBlockers()[8], cases: [...productionCases, ...commandBlockers]}));
  const productionPage = await browser.newPage(); await productionPage.goto(pathToFileURL(join(productionFolder, 'index.html')).href);
  await productionPage.locator('details').evaluateAll(nodes => nodes.forEach(node => {node.open = true;}));
  const productionText = await productionPage.locator('body').innerText();
  assert(!/scoped green|verification gate|native test|register and independently review/i.test(productionText), 'Production automation reasons must use plain explanations.');
  assert(!/fingerprint|repair classification|repair count|three.round|candidate|receipt|handoff|frozen|native.runner|native verification|assertion counts|pinned consumer|protected diagnostics/i.test(productionText), 'Production command blockers must use plain explanations.');
  for (const text of ['Further verification is needed', 'Automation is ready.', 'Some required checks were not completed.', 'This test was skipped.']) assert(productionText.includes(text));
  await productionPage.close(); proof.productionReasons = 'PASS';
  if (mode === '--base') for (const [name, html] of [...surfaces, ['runtime', runtimeHtml]]) {
    const folder = join(output, `${name}-before`); mkdirSync(folder); writeFileSync(join(folder, 'index.html'), html);
    const page = await browser.newPage(); await page.goto(pathToFileURL(join(folder, 'index.html')).href);
    for (const theme of proof.themes) {await page.emulateMedia({colorScheme: theme}); for (const [width, height] of sizes) {await page.setViewportSize({width, height}); await page.screenshot({path: join(folder, `${theme}-${width}.png`), fullPage: true});}}
    await page.close();
  }
  for (const [name, html] of surfaces) {
    const folder = join(output, name); mkdirSync(folder); writeFileSync(join(folder, 'index.html'), html);
    const companions = name === 'automate' ? automationCompanions(automation) : [['summary.md', '# Synthetic execution summary\n'], ['defects.md', '# Synthetic execution defects\n']];
    for (const [file, body] of companions) writeFileSync(join(folder, file), body);
    const page = await browser.newPage(), network = [], errors = [];
    await page.route(/^https?:/, route => {network.push(route.request().url()); return route.abort();});
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(join(folder, 'index.html')).href);
    const themeSwitch = page.locator('#theme-toggle');
    assert.equal(await page.locator('.report-header #theme-toggle').count(), 1, 'The theme switch belongs above the report, at the right.');
    assert.equal((await themeSwitch.innerText()).trim(), '', 'Theme switching uses icons, without a text button.');
    assert.equal(await themeSwitch.locator('svg').count(), 2);
    assert.equal(await themeSwitch.locator('svg:visible').count(), 1);
    assert.match(await themeSwitch.getAttribute('aria-label'), /Switch to (light|dark) theme/);
    assert.equal(await page.getByRole('link', {name: 'Summary ↗', exact: true}).count(), 1, 'Both skills expose Summary.');
    assert.equal(await page.getByRole('link', {name: 'Defects ↗', exact: true}).count(), 1, 'Both skills expose Defects.');
    const userText = await page.locator('body').innerText();
    assert(!/Raw data|Evidence identifiers|Additional execution evidence|Operation provenance|Evidence inventory|SHA256|fingerprint|Scoped verification history|Native assertions|Verification rollup|repair rounds|scoped green|verification gate|native test/i.test(userText), 'User reports must not display debugging metadata.');
    const originalDetails = await page.locator('details').evaluateAll(nodes => nodes.map(node => node.open));
    await page.locator('details').evaluateAll(nodes => nodes.forEach(node => {node.open = true;}));
    const expandedText = await page.locator('body').innerText();
    assert(!/Raw data|Evidence identifiers|Additional execution evidence|Operation provenance|Evidence inventory|SHA256|fingerprint|Scoped verification history|Native assertions|Verification rollup|repair rounds|scoped green|verification gate|native test/i.test(expandedText), 'Expanded details must also be user-facing.');
    await page.locator('details').evaluateAll((nodes, states) => nodes.forEach((node, index) => {node.open = states[index];}), originalDetails);
    assert.equal(await page.getByText('How verification methods are counted', {exact: true}).count(), 0);
    assert.equal(await page.getByRole('link', {name: /Core report/i}).count(), 0, 'The duplicate report is retired.');
    assert.equal(await page.getByText(/Source exclusions/).count(), 0, 'Empty exclusion panels are omitted.');
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
        const geometry = await page.evaluate(() => {const toggle = document.getElementById('theme-toggle').getBoundingClientRect(), header = document.querySelector('.report-heading').getBoundingClientRect(); return {width: innerWidth, scroll: document.documentElement.scrollWidth, font: getComputedStyle(document.querySelector('h1')).fontSize, themeAtRight: Math.abs(toggle.right - header.right) <= 2 && Math.abs(toggle.top - header.top) <= 2, rows: [...document.querySelectorAll('[data-case]:not([hidden]) > summary')].filter(row => row.getClientRects().length).map(row => ({width: row.getBoundingClientRect().width, height: row.getBoundingClientRect().height}))};});
        assert(geometry.scroll <= geometry.width, `${name}/${theme} overflows at ${width}px (${geometry.scroll}px).`);
        assert.equal(geometry.font, '20px'); assert(geometry.rows.every(row => row.width > 0 && row.height >= 38));
        assert(geometry.themeAtRight, 'Theme icon remains at the top right across widths.');
      }
    }
    await page.locator('#theme-toggle').click(); assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    assert.equal(await themeSwitch.getAttribute('aria-label'), 'Switch to dark theme');
    await themeSwitch.focus(); await page.keyboard.press('Space');
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    assert.equal(await themeSwitch.getAttribute('aria-label'), 'Switch to light theme');
    assert.equal(await themeSwitch.locator('svg').count(), 2, 'Theme changes preserve both icons.');
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
  const folder = join(output, 'runtime'); mkdirSync(folder); writeFileSync(join(folder, 'index.html'), runtimeHtml);
  const runtime = await browser.newPage(), runtimeNetwork = [], runtimeErrors = [];
  runtime.on('pageerror', error => runtimeErrors.push(error.message));
  await runtime.route(/^https?:/, route => {runtimeNetwork.push(route.request().url()); return route.abort();});
  await runtime.goto(pathToFileURL(join(folder, 'index.html')).href);
  assert.equal(await runtime.locator('#status-filter input').count(), 1, 'Runtime attachments use the shared case controls.');
  assert.equal(await runtime.locator('[data-chart-status="PASS"]').count(), 1);
  assert.equal(await runtime.locator('a[href="summary.md"],a[href="defects.md"]').count(), 0, 'Standalone attachments have no missing companion links.');
  await runtime.locator('details').evaluateAll(nodes => nodes.forEach(node => {node.open = true;}));
  assert.equal(await runtime.getByText(/Operation provenance|Evidence inventory|Resources and lifecycle|Selected outputs|fingerprint|artifact-1|attempt-1/).count(), 0);
  assert(await runtime.getByRole('heading', {name: 'Case details'}).isVisible());
  for (const theme of proof.themes) {
    await runtime.emulateMedia({colorScheme: theme});
    for (const [width, height] of sizes) {await runtime.setViewportSize({width, height}); await runtime.screenshot({path: join(folder, `${theme}-${width}.png`), fullPage: true});}
    for (let width = 320; width <= 3840; width += 160) {
      await runtime.setViewportSize({width, height: 900});
      const geometry = await runtime.evaluate(() => ({scroll: document.documentElement.scrollWidth, width: innerWidth, font: getComputedStyle(document.querySelector('h1')).fontSize}));
      assert(geometry.scroll <= geometry.width, `Runtime/${theme} overflows at ${width}px.`); assert.equal(geometry.font, '20px');
    }
  }
  assert.deepEqual(runtimeErrors, []); assert.deepEqual(runtimeNetwork, []); await runtime.close();
  proof.surfaces.push({workflow: 'validated-runtime', cases: 1, offline: 'PASS', geometry: 'PASS', userContent: 'PASS', missingCompanions: 0});
  proof.status = 'PASS';
} finally {
  if (browser) await browser.close();
  writeFileSync(join(output, 'results-report-proof.json'), JSON.stringify(proof, null, 2) + '\n');
}
console.log(JSON.stringify(proof));
