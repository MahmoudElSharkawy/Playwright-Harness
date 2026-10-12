import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {execFile} from 'node:child_process';
import {fixture} from './fixtures/execution-core.mjs';
import {listSearchFixture} from './fixtures/list-search-app.mjs';

const command = (cwd, args, env = {}) => new Promise(resolve => {
  execFile(process.execPath, args, {cwd, env: {...process.env, ...env}, timeout: 60000}, (error, stdout, stderr) => {
    resolve({code: error?.code ?? 0, stdout, stderr});
  });
});

test('search-first POM preserves exact identities, observed scope and pagination intent', {timeout: 120000}, async t => {
  const {roots} = fixture(t), root = roots.projectRoot;
  cpSync(join(roots.packageRoot, 'harness-tests/fixtures/list-search-consumer'), root, {recursive: true});
  symlinkSync(join(roots.packageRoot, 'examples/node_modules'), join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const facade = join(root, 'src/utils/Expects.ts'); mkdirSync(dirname(facade), {recursive: true});
  cpSync(join(roots.packageRoot, 'examples/src/utils/Expects.ts'), facade);
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  const app = await listSearchFixture(); t.after(() => app.close());
  const cli = join(root, 'node_modules/@playwright/test/cli.js');

  async function run(name, probes = false, grep) {
    const report = join(root, name + '.json'), allure = join(root, name + '-allure');
    const start = app.audit.length;
    const result = await command(root, [cli, 'test', '--config', 'playwright.config.ts', ...(grep ? ['--grep', grep] : [])], {
      LIST_SEARCH_ORIGIN: app.origin, LIST_SEARCH_REPORT: report, LIST_SEARCH_ALLURE: allure,
      LIST_SEARCH_PROBES: probes ? '1' : '',
    });
    assert.notEqual(result.code, 'ETIMEDOUT', result.stderr);
    const data = JSON.parse(readFileSync(report, 'utf8'));
    return {...result, data, audit: app.audit.slice(start), allure};
  }

  for (const name of ['first', 'confirmation']) {
    const result = await run(name);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.deepEqual([result.data.stats.expected, result.data.stats.unexpected, result.data.stats.flaky, result.data.stats.skipped], [6, 0, 0, 0]);
    assert.deepEqual(result.audit.filter(item => item.kind === 'open').map(({number, customer}) => [number, customer]), [['ORD-300', 'C-300'], ['ORD-DUP', 'C-401']]);
    const lists = result.audit.filter(item => item.kind === 'list');
    assert.equal(lists.filter(item => item.page > 1).length, 1, 'Only the pagination scenario traverses a page.');
    assert(lists.filter(item => item.query).every(item => item.page === 1 && item.scope === 'all-accessible'));
    assert.deepEqual(lists.filter(item => item.query).map(item => item.query), ['ORD-300', 'ORD-MISSING', 'ORD-DUP', 'ORD-DUP', 'ORD-MISSING', "ORD-'[.*]"]);
    const reports = readdirSync(result.allure).filter(file => file.endsWith('-result.json')).map(file => JSON.parse(readFileSync(join(result.allure, file), 'utf8')));
    assert.equal(reports.length, 6);
    assert(reports.every(report => report.status === 'passed'));
    const offPage = reports.find(report => report.name.startsWith('Find an off-page'));
    assert.equal(offPage.steps.filter(step => step.name === 'Search orders for ORD-300').length, 1);
    assert.equal(offPage.steps.filter(step => step.name === 'Open order ORD-300 for customer C-300').length, 1);
  }

  const rejected = await run('rejected', true, 'An absent identity|An ambiguous identity');
  assert.equal(rejected.code, 1, rejected.stdout + rejected.stderr);
  assert.equal(rejected.data.stats.unexpected, 2);
  assert.equal(rejected.audit.filter(item => item.kind === 'open').length, 0);
  assert.match(JSON.stringify(rejected.data), /strict mode violation/);
  assert.match(JSON.stringify(rejected.data), /Timeout.*exceeded/);

  app.setScope('current-page');
  const limited = await run('limited', true, 'A current-page filter');
  assert.equal(limited.code, 1, limited.stdout + limited.stderr);
  assert.equal(limited.data.stats.unexpected, 1);
  assert(limited.audit.every(item => item.kind === 'list' && item.scope === 'current-page' && item.page === 1));
  assert.match(JSON.stringify(limited.data), /Expected.*1[\s\S]*Received.*0/);

  const conventions = await command(root, [join(roots.packageRoot, 'scripts/check-conventions.mjs'), '--root', root, '--json', '--fail-on-warn']);
  assert.equal(conventions.code, 0, conventions.stdout + conventions.stderr);
  const checked = JSON.parse(conventions.stdout); assert(checked.files > 0 && checked.ruleApplications > 0);
  const types = await command(root, [join(root, 'node_modules/typescript/bin/tsc'), '--project', 'tsconfig.json']);
  assert.equal(types.code, 0, types.stdout + types.stderr);
});
