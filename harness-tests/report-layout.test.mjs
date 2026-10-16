import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {fixture} from './fixtures/execution-core.mjs';
import * as reporting from '../scripts/lib/reporting/index.mjs';

test('report timestamps use UTC seconds across offsets and year rollover', () => {
  assert.equal(reporting.reportTimestamp(new Date('2026-10-17T17:05:09.999+03:00')), '2026-10-17_14-05-09Z');
  assert.equal(reporting.reportTimestamp(new Date('2027-01-01T00:00:00.001Z')), '2027-01-01_00-00-00Z');
  assert.throws(() => reporting.reportTimestamp(new Date('invalid')));
});

test('timestamp allocation preserves occupied files and directories with numeric collisions', t => {
  const f = fixture(t), at = new Date('2026-10-17T14:05:09.123Z');
  const first = reporting.timestampedReportDirectory(f.roots, {parent: 'reports/harness', prefix: 'execution-', at});
  writeFileSync(join(first.path, 'retained.txt'), 'older report');
  writeFileSync(`${first.path}-001`, 'occupied file');
  const second = reporting.timestampedReportDirectory(f.roots, {parent: 'reports/harness', prefix: 'execution-', at});
  assert.equal(first.directory, 'reports/harness/execution-2026-10-17_14-05-09Z');
  assert.equal(second.directory, `${first.directory}-002`);
  assert.equal(readFileSync(join(first.path, 'retained.txt'), 'utf8'), 'older report');
  assert.equal(readFileSync(`${first.path}-001`, 'utf8'), 'occupied file');
  assert.throws(() => reporting.timestampedReportDirectory(f.roots, {parent: '../escape', at}));
  mkdirSync(join(f.roots.projectRoot, 'reports/blocked'));
  writeFileSync(join(f.roots.projectRoot, 'reports/blocked/file'), 'occupied parent');
  assert.throws(() => reporting.timestampedReportDirectory(f.roots, {parent: 'reports/blocked/file', at}));
});

test('independent processes allocate unique history entries within the same second', async t => {
  const f = fixture(t), module = new URL('../scripts/lib/reporting/index.mjs', import.meta.url).href;
  const source = `import {timestampedReportDirectory} from ${JSON.stringify(module)}; console.log(JSON.stringify(timestampedReportDirectory({projectRoot:process.argv[1]}, {parent:'reports/allure-history',at:new Date('2026-10-17T14:05:09Z')})));`;
  const allocate = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', source, f.roots.projectRoot], {windowsHide: true});
    let output = '', error = ''; child.stdout.on('data', bytes => {output += bytes;}); child.stderr.on('data', bytes => {error += bytes;});
    child.on('error', reject); child.on('close', code => code === 0 ? resolve(JSON.parse(output).directory) : reject(new Error(error)));
  });
  const directories = await Promise.all(Array.from({length: 4}, allocate));
  assert.equal(new Set(directories).size, 4);
  assert.equal(readdirSync(join(f.roots.projectRoot, 'reports/allure-history')).length, 4);
});
