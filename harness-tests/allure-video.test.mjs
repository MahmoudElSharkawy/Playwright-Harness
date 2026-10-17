import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, cpSync, readFileSync, writeFileSync, readdirSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fixture} from './fixtures/execution-core.mjs';
import {linkExampleDependencies} from './fixtures/example-dependencies.mjs';

for (const [scoped, maintained] of [[false, true], [true, true], [true, false]]) for (const mode of ['default', 'environment', 'dotenv', 'option-off']) {
  const enabled = ['environment', 'dotenv'].includes(mode);
  test(`${scoped ? maintained ? 'maintained scoped' : 'official scoped' : 'ordinary'} Allure video ${mode} ${enabled ? 'includes' : 'excludes'} videos without changing native attachments`, t => {
    const f = fixture(t), root = f.roots.projectRoot, example = join(f.roots.packageRoot, 'examples');
    for (const file of ['src/utils/AllureReport.ts', 'src/config/reporting.ts', 'global-setup.ts', 'allurerc.json']) {
      if (!maintained && file === 'src/utils/AllureReport.ts') continue;
      mkdirSync(dirname(join(root, file)), {recursive: true}); cpSync(join(example, file), join(root, file));
    }
    linkExampleDependencies(root, f.roots.packageRoot);
    writeFileSync(join(root, 'package.json'), '{"type":"commonjs"}');
    const reporter = scoped ? join(f.roots.packageRoot, 'scripts/lib/reporting/allure-reporter.mjs').replaceAll('\\', '/') : './src/utils/AllureReport.ts';
    if (mode === 'dotenv') writeFileSync(join(root, '.env'), 'ALLURE_ATTACH_VIDEO=true\n');
    writeFileSync(join(root, 'playwright.config.ts'), `import {allureConfig} from './src/config/reporting';import * as dotenv from 'dotenv';dotenv.config();export default {testDir:'./tests',workers:1,retries:0,use:{video:'retain-on-failure'},reporter:[[${JSON.stringify(reporter)},{resultsDir:allureConfig.resultsDir${mode === 'option-off' ? ',attachVideo:false' : ''}}],['json',{outputFile:'reports/native.json'}],['html',{outputFolder:'reports/playwright-report',open:'never'}]]};`);
    mkdirSync(join(root, 'tests'));
    writeFileSync(join(root, 'tests/Video.spec.ts'), `import {test,expect} from '@playwright/test';test('native attachments',async()=>{await test.step('Evidence',async()=>{await test.info().attach('step video',{body:Buffer.from('synthetic video'),contentType:'video/webm'});await test.info().attach('step image',{body:Buffer.from('synthetic image'),contentType:'image/png'});});await test.info().attach('video',{body:Buffer.from('synthetic recording'),contentType:'video/webm'});await test.info().attach('details',{body:'unchanged',contentType:'text/plain'});expect(test.info().project.use.video).toBe('retain-on-failure');});`);
    const environment = {...process.env, CI: '1', AUTO_ALLURE_OPEN: 'false'}; delete environment.ALLURE_ATTACH_VIDEO;
    if (['environment', 'option-off'].includes(mode)) environment.ALLURE_ATTACH_VIDEO = 'true';
    const run = spawnSync(process.execPath, [join(example, 'node_modules/@playwright/test/cli.js'), 'test'],
      {cwd: root, env: environment, encoding: 'utf8', timeout: 90000, windowsHide: true});
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const native = JSON.parse(readFileSync(join(root, 'reports/native.json'))), result = native.suites[0].specs[0].tests[0].results[0];
    assert.deepEqual(result.attachments.map(item => item.name), ['step video', 'step image', 'video', 'details']);
    const directory = scoped ? join(root, '.harness/runs/allure', readdirSync(join(root, '.harness/runs/allure'))[0], 'allure-results') : join(root, 'reports/allure-results');
    const results = readdirSync(directory).filter(name => name.endsWith('-result.json')).map(name => JSON.parse(readFileSync(join(directory, name))));
    assert.equal(results.length, 1);
    const attachments = [];
    const visit = item => {attachments.push(...(item.attachments ?? [])); for (const step of item.steps ?? []) visit(step);};
    visit(results[0]);
    assert.equal(attachments.some(item => item.type.startsWith('video/')), enabled);
    assert(attachments.some(item => item.name === 'step image')); assert(attachments.some(item => item.name === 'details'));
    assert.equal(readdirSync(directory).some(name => name.endsWith('.webm')), enabled);
    assert(readFileSync(join(root, 'reports/playwright-report/index.html')).length > 0);
  });
}
