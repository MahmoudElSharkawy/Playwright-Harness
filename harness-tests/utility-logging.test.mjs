import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cpSync, readFileSync, symlinkSync, writeFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {join} from 'node:path';
import test from 'node:test';
import {stripVTControlCharacters} from 'node:util';
import {packageRoot} from '../scripts/lib/consumer-paths.mjs';
import {fixture} from './fixtures/execution-core.mjs';

const examples = join(packageRoot, 'examples');

test('Logger colors only labels and supports plain output outside Playwright', () => {
  const source = stripTypeScriptTypes(readFileSync(join(examples, 'src/utils/Logger.ts'), 'utf8'));
  const script = `${source}
    Logger.info('Test', 'info'); Logger.warn('Test', 'warn'); Logger.error('Test', 'error');`;
  const run = env => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {encoding: 'utf8', env});
    assert.equal(result.status, 0, result.stderr);
    return result;
  };
  const env = {...process.env};
  delete env.FORCE_COLOR;
  delete env.NO_COLOR;
  delete env.NODE_DISABLE_COLORS;
  const colored = run({...env, FORCE_COLOR: '1'});
  assert.match(colored.stdout, /\x1b\[36m\[INFO\]\x1b\[39m \[Test\] info/);
  assert.match(colored.stderr, /\x1b\[33m\[WARN\]\x1b\[39m \[Test\] warn/);
  assert.match(colored.stderr, /\x1b\[31m\[ERROR\]\x1b\[39m \[Test\] error/);
  const plain = run({...env, NO_COLOR: '1'});
  assert.equal(plain.stdout, stripVTControlCharacters(colored.stdout));
  assert.equal(plain.stderr, stripVTControlCharacters(colored.stderr));
});

test('utility logging works with only the list reporter', {timeout: 180000}, async t => {
  const {projectRoot} = fixture(t).roots;
  cpSync(join(examples, 'src'), join(projectRoot, 'src'), {recursive: true});
  cpSync(join(packageRoot, 'harness-tests/fixtures/utility-logging-consumer/Logging.spec.ts'), join(projectRoot, 'Logging.spec.ts'));
  symlinkSync(join(examples, 'node_modules'), join(projectRoot, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  writeFileSync(join(projectRoot, 'package.json'), '{"type":"commonjs"}');
  const configPath = join(projectRoot, 'src/config/logging.ts');
  const shipped = readFileSync(configPath, 'utf8');
  const cleanEnv = {...process.env, NO_COLOR: '1'};
  for (const flag of ['UI_CONSOLE_LOGS', 'EXPECT_CONSOLE_LOGS', 'API_CONSOLE_LOGS', 'DB_CONSOLE_LOGS']) delete cleanEnv[flag];

  const check = (name, {defaults = {}, env = {}, metadata = {}, enabled = []} = {}) => t.test(name, () => {
    writeFileSync(configPath, shipped + '\nObject.assign(loggingDefaults, ' + JSON.stringify(defaults) + ');');
    writeFileSync(join(projectRoot, 'playwright.config.ts'),
      `export default {testDir:'.', reporter:'list', workers:1, metadata:${JSON.stringify(metadata)}, use:{channel:process.env.HARNESS_BROWSER_CHANNEL}};`);
    const result = spawnSync(process.execPath, [join(examples, 'node_modules/@playwright/test/cli.js'), 'test'], {
      cwd: projectRoot, encoding: 'utf8', timeout: 25000,
      env: {...cleanEnv, ...env},
    });
    const output = result.stdout + result.stderr;
    assert.equal(result.status, 0, String(result.error ?? '') + '\n' + output);
    const lines = stripVTControlCharacters(output).split(/\r?\n/);
    const logs = lines.filter(line => /^\[(INFO|WARN|ERROR)\] \[/.test(line));
    assert(!logs.some(line => line.includes('private-fixture-value')));
    const count = (level, source) => logs.filter(line => line.startsWith(`[${level}] [${source}]`)).length;
    const ui = enabled.includes('UI');
    assert.equal(count('INFO', 'UI'), ui ? 6 : 0);
    assert.equal(logs.filter(line => line === '[INFO] [UI] click succeeded').length, ui ? 2 : 0);
    assert.equal(logs.filter(line => line === '[INFO] [UI] retryUntilSucceeded succeeded').length, ui ? 1 : 0);
    for (const source of ['Expects', 'ApiActions', 'DbActions']) {
      assert.equal(count('INFO', source), enabled.includes(source) ? 2 : 0, source);
    }
    assert.equal(count('ERROR', 'UI'), 3);
    assert.equal(logs.filter(line => line === '[ERROR] [UI] fill failed').length, 1);
    assert.equal(logs.filter(line => line === '[ERROR] [UI] pressSequentially failed').length, 1);
    assert.equal(logs.filter(line => line === '[ERROR] [UI] retryUntilSucceeded failed').length, 1);
    assert.equal(count('WARN', 'UI'), 1);
    assert.equal(logs.filter(line => line === '[WARN] [UI] retryUntilSucceeded exhausted its attempts').length, 1);
    assert.equal(count('ERROR', 'Expects'), 2);
    assert.equal(count('ERROR', 'ApiActions'), 1);
    assert.equal(count('WARN', 'ApiActions'), 2);
    assert.equal(count('ERROR', 'DbActions'), 1);
    assert(logs.some(line => /^\[ERROR\] \[DbActions\] CONNECT failed/.test(line)));
  });

  await check('shipped defaults');
  await check('enable one utility', {defaults: {ui: true}, enabled: ['UI']});
  await check('enable assertions, API and DB in the consumer config', {
    defaults: {expects: true, api: true, db: true}, enabled: ['Expects', 'ApiActions', 'DbActions'],
  });
  await check('environment overrides file defaults and project metadata in both directions', {
    defaults: {ui: true}, metadata: {apiConsoleLogs: false, dbConsoleLogs: true},
    env: {UI_CONSOLE_LOGS: 'false', EXPECT_CONSOLE_LOGS: 'true', API_CONSOLE_LOGS: 'true', DB_CONSOLE_LOGS: 'false'},
    enabled: ['Expects', 'ApiActions'],
  });
  await check('explicit project metadata overrides file defaults', {
    defaults: {api: true}, metadata: {apiConsoleLogs: false, dbConsoleLogs: true}, enabled: ['DbActions'],
  });
  await check('an explicit constructor option overrides the environment', {
    env: {API_CONSOLE_LOGS: 'true', DB_CONSOLE_LOGS: 'true'}, metadata: {fixtureConsoleOption: false},
  });
});
