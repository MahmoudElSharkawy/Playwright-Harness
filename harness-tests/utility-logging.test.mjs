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

test('utility logging works with only the list reporter', {timeout: 60000}, t => {
  const {projectRoot} = fixture(t).roots;
  cpSync(join(examples, 'src'), join(projectRoot, 'src'), {recursive: true});
  cpSync(join(packageRoot, 'harness-tests/fixtures/utility-logging-consumer/Logging.spec.ts'), join(projectRoot, 'Logging.spec.ts'));
  symlinkSync(join(examples, 'node_modules'), join(projectRoot, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  writeFileSync(join(projectRoot, 'package.json'), '{"type":"commonjs"}');
  writeFileSync(join(projectRoot, 'playwright.config.ts'),
    "export default {testDir:'.', reporter:'list', workers:1, use:{channel:process.env.HARNESS_BROWSER_CHANNEL}};");

  for (const verbose of ['false', 'true']) {
    const result = spawnSync(process.execPath, [join(examples, 'node_modules/@playwright/test/cli.js'), 'test'], {
      cwd: projectRoot, encoding: 'utf8', timeout: 25000,
      env: {...process.env, NO_COLOR: '1', UI_CONSOLE_LOGS: verbose, EXPECT_CONSOLE_LOGS: verbose,
        API_CONSOLE_LOGS: verbose, DB_CONSOLE_LOGS: verbose},
    });
    const output = result.stdout + result.stderr;
    assert.equal(result.status, 0, String(result.error ?? '') + '\n' + output);
    const lines = stripVTControlCharacters(output).split(/\r?\n/);
    const logs = lines.filter(line => /^\[(INFO|WARN|ERROR)\] \[/.test(line));
    assert(!logs.some(line => line.includes('private-fixture-value')));
    const count = (level, source) => logs.filter(line => line.startsWith(`[${level}] [${source}]`)).length;
    const success = verbose === 'true' ? 1 : 0;
    assert.equal(count('INFO', 'UI'), 4 * success);
    assert.equal(count('INFO', 'Expects'), 2 * success);
    assert.equal(count('INFO', 'ApiActions'), 2 * success);
    assert.equal(count('INFO', 'DbActions'), 2 * success);
    assert.equal(count('ERROR', 'UI'), 2);
    assert.equal(logs.filter(line => line === '[ERROR] [UI] fill failed').length, 1);
    assert.equal(logs.filter(line => line === '[ERROR] [UI] pressSequentially failed').length, 1);
    assert.equal(count('WARN', 'UI'), 1);
    assert.equal(count('ERROR', 'Expects'), 2);
    assert.equal(count('ERROR', 'ApiActions'), 1);
    assert.equal(count('WARN', 'ApiActions'), 2);
    assert.equal(count('ERROR', 'DbActions'), 1);
    assert(logs.some(line => /^\[ERROR\] \[DbActions\] CONNECT failed/.test(line)));
  }
});
