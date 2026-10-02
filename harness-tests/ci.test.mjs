import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {validateInstalledGraph, clearedOverrides} from '../scripts/ci/distribution.mjs';
import {checkContracts} from '../scripts/ci/contracts.mjs';
import {testCounts, completeTests, completeChecks, requiredChecks, completeNativeProof, browserDiagnostics} from '../scripts/ci/results.mjs';
import {requiredBrowserChecks} from '../scripts/probes/browser-checks.mjs';
import {within} from '../scripts/lib/skill-roots.mjs';
import {command} from '../scripts/ci/process.mjs';
import {publicationFindings} from '../scripts/lib/package-validation.mjs';
import {nativeProcess} from '../scripts/ci/native-process.mjs';
import {recoverNativeProof} from '../scripts/ci/recovery.mjs';
import {hostDatabases} from './fixtures/host-databases.mjs';
import {runChecks} from '../scripts/ci/checks.mjs';

const save = (path, value) => {mkdirSync(dirname(path), {recursive: true}); writeFileSync(path, JSON.stringify(value));};
function temporary(t) {
  const base = realpathSync(tmpdir()), root = mkdtempSync(join(base, 'harness-ci-'));
  t.after(() => {assert(within(base, realpathSync(root))); rmSync(root, {recursive: true});}); return root;
}
function graph(t, {duplicate = false} = {}) {
  const root = temporary(t), item = {version: '1.0.0', resolved: 'https://registry.npmjs.org/synthetic/-/synthetic-1.0.0.tgz', integrity: 'sha512-synthetic'};
  const expected = {packages: {'': {version: '1.0.0'}, 'node_modules/synthetic': item}};
  const paths = ['node_modules/playwright-pom-harness/node_modules/synthetic', ...(duplicate ? ['node_modules/synthetic'] : [])];
  const actual = {packages: {'': {}, 'node_modules/playwright-pom-harness': {version: '1.0.0'}, ...Object.fromEntries(paths.map(path => [path, {...item}]))}};
  for (const path of paths) save(join(root, path, 'package.json'), {name: 'synthetic', version: item.version});
  save(join(root, 'package-lock.json'), actual); return {root, expected, actual, paths};
}
test('installed graph allows npm relocation and duplicates without permitting dependency drift', t => {
  const {root, expected} = graph(t, {duplicate: true}); assert.deepEqual(validateInstalledGraph(root, expected), {dependencyIdentities: 1, installedNodes: 2});
});
test('validation consumer constraints retain cleared versions for scoped and relocated dependencies', t => {
  const {expected} = graph(t);
  expected.packages['node_modules/parent/node_modules/synthetic'] = {...expected.packages['node_modules/synthetic']};
  expected.packages['node_modules/@synthetic/types'] = {version: '2.0.0'};
  assert.deepEqual(clearedOverrides(expected), {synthetic: '1.0.0', '@synthetic/types': '2.0.0'});
  assert.equal(expected.packages['node_modules/synthetic'].version, '1.0.0');
});
test('validation consumer refuses ambiguous or missing cleared versions instead of collapsing the graph', t => {
  const {expected} = graph(t);
  assert.throws(() => clearedOverrides({packages: {'': {}}}), /Empty/);
  expected.packages['node_modules/parent/node_modules/synthetic'] = {version: '2.0.0'};
  assert.throws(() => clearedOverrides(expected), /Multiple cleared versions/);
  delete expected.packages['node_modules/parent/node_modules/synthetic'];
  delete expected.packages['node_modules/synthetic'].version;
  assert.throws(() => clearedOverrides(expected), /Missing cleared dependency version/);
});
for (const field of ['version', 'resolved', 'integrity']) test(`installed graph rejects changed ${field}`, t => {
  const {root, expected, actual, paths} = graph(t); actual.packages[paths[0]][field] = 'changed'; save(join(root, 'package-lock.json'), actual);
  assert.throws(() => validateInstalledGraph(root, expected), /provenance/);
});
test('installed graph rejects missing identities and empty locks', t => {
  const {root, expected, actual, paths} = graph(t); delete actual.packages[paths[0]]; save(join(root, 'package-lock.json'), actual);
  assert.throws(() => validateInstalledGraph(root, expected), /scope differs/); assert.throws(() => validateInstalledGraph(root, {packages: {'': {}}}), /Empty/);
});
test('installed graph checks actual package metadata as well as the lock', t => {
  const {root, expected, paths} = graph(t); save(join(root, paths[0], 'package.json'), {name: 'synthetic', version: '2.0.0'});
  assert.throws(() => validateInstalledGraph(root, expected), /metadata differs/);
});
test('installed graph rejects dependency links escaping the owned installation', t => {
  const {root, expected, paths} = graph(t), outside = temporary(t), path = join(root, paths[0]);
  assert(within(root, realpathSync(path))); rmSync(path, {recursive: true}); save(join(outside, 'package.json'), {name: 'synthetic', version: '1.0.0'});
  symlinkSync(outside, path, process.platform === 'win32' ? 'junction' : 'dir'); assert.throws(() => validateInstalledGraph(root, expected), /escapes/);
});
const counts = {tests: 12, pass: 12, fail: 0, cancelled: 0, skipped: 0, todo: 0};
test('CI accepts substantive TAP evidence and rejects zero, skipped, cancelled or missing scope', () => {
  const output = Object.entries(counts).map(([name, value]) => `# ${name} ${value}`).join('\n'); assert.deepEqual(testCounts(output), counts); assert(completeTests(counts));
  for (const change of [{tests: 0, pass: 0}, {fail: 1}, {pass: 11}, {cancelled: 1}, {skipped: 1}, {todo: 1}, {tests: NaN}]) assert.equal(completeTests({...counts, ...change}), false);
  assert.equal(completeTests(testCounts('a process succeeded but no tests ran')), false); assert.equal(completeTests({}), false);
});
test('CI requires the entire fixed checklist, unique entries and zero process errors', () => {
  const checks = requiredChecks.map(id => ({id, status: 'PASS', exitCode: 0, diagnostic: null, ...(id === 'tests' ? {counts} : {})})); assert(completeChecks(checks));
  for (const change of [checks.slice(1), [...checks, checks[0]], checks.map((check, i) => i ? check : {...check, status: 'SKIPPED'}), checks.map((check, i) => i ? check : {...check, diagnostic: 'ETIMEDOUT'}), checks.map((check, i) => i ? check : {...check, exitCode: 1})]) assert.equal(completeChecks(change), false);
});
test('process success, failure and timeout produce distinct nonpassing evidence', t => {
  const cwd = temporary(t);
  assert.equal(command(['-e', 'process.exit(0)'], {cwd}).status, 'PASS');
  assert.equal(command(['-e', 'process.exit(2)'], {cwd}).exitCode, 2);
  const timeout = command(['-e', 'setInterval(() => {}, 1000)'], {cwd, timeout: 100}); assert.equal(timeout.status, 'FAIL'); assert.equal(timeout.diagnostic, 'ETIMEDOUT');
});
test('native browser failure remains incomplete even with a fully passing assessment', () => {
  const assessment = {status: 'PASS', checks: requiredBrowserChecks.map(name => ({name, status: 'PASS'}))};
  assert(completeNativeProof('browser', {status: 'PASS'}, {complete: true}, assessment));
  for (const proof of [undefined, {status: 'FAIL', diagnostic: 'TIMEOUT'}, {status: 'UNPERFORMED'}])
    assert.equal(completeNativeProof('browser', proof, {complete: true}, assessment), false);
  assert.equal(completeNativeProof('browser', {status: 'PASS'}, {complete: false}, assessment), false);
  assert.equal(completeNativeProof('browser', {status: 'PASS'}, {complete: true}, {...assessment, checks: assessment.checks.slice(1)}), false);
});
test('incomplete browser diagnostics publish only known check names and statuses', () => {
  const checks = [{name: requiredBrowserChecks[0], status: 'FAIL', message: 'Private synthetic path and token', facts: {private: 'synthetic'}},
    {name: 'Private synthetic token', status: 'FAIL'}, {name: requiredBrowserChecks[1], status: 'Private synthetic token'}, null];
  assert.deepEqual(browserDiagnostics({status: 'INCOMPLETE', checks}), [{name: requiredBrowserChecks[0], status: 'FAIL'}]);
  assert.deepEqual(browserDiagnostics(undefined), []);
});
test('native parallel proof still requires both substantive scopes and complete cleanup', () => {
  const assessment = {status: 'PASS', comparison: {status: 'PASS'}, counts: [{scenarios: 13, assertions: 35, evidence: 166}, {scenarios: 13, assertions: 35, evidence: 166}]};
  const cleanup = {ownedDatabasesRemoved: true, fixtureServersClosed: true};
  assert(completeNativeProof('parallel', {status: 'PASS'}, {complete: true}, assessment, cleanup));
  assert.equal(completeNativeProof('parallel', {status: 'FAIL'}, {complete: true}, assessment, cleanup), false);
  assert.equal(completeNativeProof('parallel', {status: 'PASS'}, {complete: true}, {...assessment, counts: [{scenarios: 13, assertions: 0, evidence: 1}, assessment.counts[1]]}, cleanup), false);
  assert.equal(completeNativeProof('parallel', {status: 'PASS'}, {complete: true}, assessment, {...cleanup, fixtureServersClosed: false}), false);
});
test('JSON process output remains parseable with stderr notices while combined evidence retains them', t => {
  const cwd = temporary(t), log = join(cwd, 'process.log');
  const result = command(['-e', 'process.stdout.write(JSON.stringify({packed: true})); process.stderr.write("Synthetic npm notice\\n");'], {cwd, log});
  assert.equal(result.status, 'PASS'); assert.deepEqual(JSON.parse(result.stdout), {packed: true});
  assert.throws(() => JSON.parse(result.output));
  assert.match(readFileSync(log, 'utf8'), /Synthetic npm notice/); assert.equal(readFileSync(log, 'utf8'), result.output);
});
test('package contracts reject version drift and missing published dependency locks', t => {
  const root = temporary(t), source = new URL('../', import.meta.url);
  for (const file of ['package.json', 'npm-shrinkwrap.json', '.claude-plugin/plugin.json']) save(join(root, file), JSON.parse(readFileSync(new URL(file, source), 'utf8')));
  writeFileSync(join(root, 'VERSION'), readFileSync(new URL('VERSION', source))); assert.equal(checkContracts(root).scenarios, 26);
  writeFileSync(join(root, 'VERSION'), '0.0.0'); assert.throws(() => checkContracts(root));
  assert(publicationFindings({files: ['package.json', 'npm-shrinkwrap.json'], unexpected: []}, ['package.json']).some(finding => finding.file === 'npm-shrinkwrap.json'));
});
test('native supervision refuses an existing evidence log before launching a child', async t => {
  const root = temporary(t), log = join(root, 'log'); writeFileSync(log, 'preserved');
  await assert.rejects(nativeProcess('unavailable-script.mjs', root, {cwd: root, log}), {code: 'EEXIST'}); assert.equal(readFileSync(log, 'utf8'), 'preserved');
});
test('recovery rejects a partial database journal instead of treating it as clean', async t => {
  const root = temporary(t); writeFileSync(join(root, 'infrastructure-ownership.jsonl'), '{');
  const report = await recoverNativeProof(resolvePackage(), root); assert.equal(report.complete, false); assert.deepEqual(report.failures, ['DATABASE_RECOVERY']);
});
test('recovery finds malformed ownership in a nested parallel run and preserves it', async t => {
  const root = temporary(t), file = join(root, '.harness/runs/batch/scenario/protected/native-ownership.json'); save(file, {version: 1});
  const report = await recoverNativeProof(resolvePackage(), root); assert.equal(report.complete, false); assert.deepEqual(report.failures, ['BROWSER_RECOVERY']); assert(readFileSync(file).length > 0);
});
function resolvePackage() {return realpathSync(new URL('../', import.meta.url));}

test('local proof fixtures reject arbitrary database routing before provisioning', async () => {
  await assert.rejects(hostDatabases({dockerHost: 'external.example'}), /Unsupported local fixture route/);
});

test('CI rejects an in-package audit before beginning checks or writing fixtures', () => {
  const root = resolvePackage(); assert.throws(() => runChecks(root, join(root, '.validation/invalid-ci-audit')), /external audit directory/);
});
