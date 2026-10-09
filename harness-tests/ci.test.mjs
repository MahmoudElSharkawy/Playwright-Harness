import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {validateInstalledGraph, clearedOverrides} from '../scripts/ci/distribution.mjs';
import {checkContracts} from '../scripts/ci/contracts.mjs';
import {testCounts, completeTests, completeChecks, requiredChecks, completeNativeProof, browserDiagnostics, executeDiagnostics, testFailureLocations, testFailureDiagnostics, nativeSummaryFields} from '../scripts/ci/results.mjs';
import {parallelDiagnostic, parallelFailureDiagnostic, parallelLogDiagnostic} from '../scripts/probes/parallel-diagnostics.mjs';

test('parallel failure diagnostics retain fixed stages and source coordinates while excluding private values', () => {
  const value = {stage: 'database-fixtures', code: 'EREQUEST', exitCode: 1, reason: 'private-reason',
    location: {file: 'host-databases.mjs', line: 65, column: 7, path: 'private-path'}, message: 'private-message', credentials: 'private-credentials', query: 'private-query'};
  assert.deepEqual(parallelDiagnostic(value), {stage: 'database-fixtures', code: 'EREQUEST', exitCode: 1, location: {file: 'host-databases.mjs', line: 65, column: 7}});
  assert.equal(parallelDiagnostic({...value, stage: 'private-stage'}), undefined);
  assert.deepEqual(parallelDiagnostic({...value, code: 'private-code', exitCode: -1, location: {file: 'private-file', line: 1, column: 1}}), {stage: 'database-fixtures'});
  assert.deepEqual(parallelDiagnostic({...value, location: {file: 'parallel.mjs', line: 9007199254740992, column: 1}, exitCode: 256}), {stage: 'database-fixtures', code: 'EREQUEST'});
  assert(!JSON.stringify(parallelDiagnostic(value)).includes('private'));
});

test('parallel startup diagnostics preserve the original Docker category when cleanup also fails', () => {
  const startup = Object.assign(new Error('private-message'), {status: 125, stderr: 'toomanyrequests: private-detail', stack: 'Error: private-message\n    at docker (C:\\private-user\\host-databases.mjs:33:35)'});
  const combined = new AggregateError([startup, new Error('private-cleanup')], 'private-aggregate');
  const diagnostic = parallelFailureDiagnostic('database-fixtures', combined);
  assert.deepEqual(diagnostic, {stage: 'database-fixtures', causes: [{exitCode: 125, reason: 'image-rate-limit', location: {file: 'host-databases.mjs', line: 33, column: 35}}, {}]});
  assert(!JSON.stringify(diagnostic).includes('private'));
  assert.equal(parallelDiagnostic({...diagnostic, causes: Array(9).fill(diagnostic.causes[0])}).causes.length, 3);
});

for (const [message, reason] of [['manifest unknown: private-image', 'image-unavailable'], ['Cannot connect to the Docker daemon: private-socket', 'docker-unavailable'], ['no space left on device: private-path', 'disk-space'], ['Native database startup failed.', 'database-startup']]) test(`parallel fixture diagnostics classify ${reason} without retaining the error message`, () => {
  assert.deepEqual(parallelFailureDiagnostic('database-fixtures', new Error(message)), {stage: 'database-fixtures', reason});
});

test('parallel process diagnostics expose startup import errors and known frames without raw log content', () => {
  const output = 'Error [ERR_MODULE_NOT_FOUND]: private-module\n    at import (file:///private-user/scripts/probes/parallel.mjs:14:4)\n';
  assert.deepEqual(parallelLogDiagnostic(output), {stage: 'process-exit', code: 'ERR_MODULE_NOT_FOUND', location: {file: 'parallel.mjs', line: 14, column: 4}});
  assert.deepEqual(parallelLogDiagnostic("code: 'private-code'\n    at private (/private-user/private-file.mjs:1:1)"), {stage: 'process-exit'});
});

test('parallel failure summaries retain diagnostics while incomplete proofs continue to fail', () => {
  const summary = nativeSummaryFields('parallel', undefined, undefined, {stage: 'batch-1', code: 'ERR_ASSERTION', message: 'private-message', location: {file: 'parallel-live.mjs', line: 205, column: 9}});
  assert.deepEqual(summary, {checks: [], failure: {stage: 'batch-1', code: 'ERR_ASSERTION', location: {file: 'parallel-live.mjs', line: 205, column: 9}}});
  assert.equal(completeNativeProof('parallel', {status: 'FAIL'}, {complete: true}, summary), false);
});

test('U3: CI native summary allow-lists numeric metrics and cleanup flags', () => {
  assert.deepEqual(nativeSummaryFields('execute', {diagnosticsLatencyMs: {end: 1, 'per-step': 2, unexpected: 'private'}}), {diagnosticsLatencyMs: {end: 1, 'per-step': 2}});
  assert.deepEqual(nativeSummaryFields('parallel', {counts: [{scenarios: 13, assertions: 4, evidence: 5, extra: 'private'}], databases: 'private'}, {ownedDatabasesRemoved: true, fixtureServersClosed: true, extra: 'private'}), {checks: [{scenarios: 13, assertions: 4, evidence: 5}], cleanup: {ownedDatabasesRemoved: true, fixtureServersClosed: true}});
});
import {requiredBrowserChecks} from '../scripts/probes/browser-checks.mjs';
import {retryProbeDiagnostic} from '../scripts/probes/execute-checks.mjs';
import {writeJson, readBounded} from '../scripts/lib/execute/storage.mjs';
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
test('failed execution diagnostics retain retry stages without exposing raw messages or arbitrary facts', t => {
  const checks = [{name: 'read-retry', status: 'FAIL', message: 'private-token', diagnostic: {stage: 'await-retry', hostState: 'FINISHED', attempt: 1, actual: 'private-token', token: '<synthetic-token>'}},
    {name: 'read-retry', status: 'FAIL', diagnostic: {stage: 'private-token'}}, {name: 'private-token', status: 'FAIL'}, null];
  assert.deepEqual(executeDiagnostics({checks}), [{name: 'read-retry', status: 'FAIL', diagnostic: {stage: 'await-retry', hostState: 'FINISHED', attempt: 1}}, {name: 'read-retry', status: 'FAIL'}]);
  assert.deepEqual(executeDiagnostics({checks: [{name: 'read-retry', status: 'FAIL', diagnostic: {stage: 'assessment', actual: 'INDETERMINATE'}}]}), [{name: 'read-retry', status: 'FAIL', diagnostic: {stage: 'assessment', actual: 'INDETERMINATE'}}]);
  assert.deepEqual(executeDiagnostics(undefined), []);
  const error = new Error('Host did not reach its expected state.'), file = join(temporary(t), 'assessment.json');
  const failed = {name: 'read-retry', status: 'FAIL', message: error.message, diagnostic: retryProbeDiagnostic({stage: 'await-retry', hostState: undefined, attempt: undefined, actual: error.actual})};
  writeJson(file, {checks: [failed]}); assert.deepEqual(readBounded(file), {checks: [{name: 'read-retry', status: 'FAIL', message: error.message, diagnostic: {stage: 'await-retry'}}]});
});
test('failed TAP locations expose only known test files and positive source coordinates', () => {
  const output = "not ok 1 synthetic\n  ---\n  location: 'C:\\private-user\\harness-tests\\execute-host.test.mjs:27:3'\n  error: 'private-token'\n  ...\nnot ok 2 synthetic\n  location: '/private-user/harness-tests/execute-host.test.mjs:27:3'\n  location: '/private-user/private-token.test.mjs:1:1'\n  location: '/private-user/harness-tests/execute-host.test.mjs:0:1'\n";
  assert.deepEqual(testFailureLocations(output, ['execute-host.test.mjs']), [{file: 'execute-host.test.mjs', line: 27, column: 3}]);
});

test('failed TAP diagnostics retain assertion coordinates and fixed metadata while excluding private output', () => {
  const output = `not ok 1 - private-test-name
  ---
  duration_ms: 6000.25
  location: 'C:\\private-user\\harness-tests\\execute-host.test.mjs:152:1'
  failureType: 'testCodeFailure'
  error: 'private-error'
  code: 'ERR_ASSERTION'
  expected: 'private-expected'
  actual: 'private-actual'
  operator: 'strictEqual'
  stack: |-
    private-stack-text
    at privateFunction (file:///private-user/scripts/private.mjs:7:1)
    TestContext.<anonymous> (file:///private-user/harness-tests/execute-host.test.mjs:159:57)
  ...
not ok 2 - private-test-name
  ---
  location: '/private-user/harness-tests/execute-host.test.mjs:180:1'
  failureType: 'private-type'
  code: 'private-code'
  operator: 'private-operator'
  stack: |-
    at privateFunction (/private-user/private-file.test.mjs:1:1)
  ...
not ok 3 - unknown
  ---
  location: '/private-user/private-file.test.mjs:1:1'
  code: 'ERR_ASSERTION'
  ...
`;
  const result = testFailureDiagnostics(output, ['execute-host.test.mjs']);
  assert.deepEqual(result, [
    {location: {file: 'execute-host.test.mjs', line: 152, column: 1}, failureType: 'testCodeFailure', code: 'ERR_ASSERTION', operator: 'strictEqual', durationMs: 6000.25, stackLocation: {file: 'execute-host.test.mjs', line: 159, column: 57}},
    {location: {file: 'execute-host.test.mjs', line: 180, column: 1}}
  ]);
  assert(!JSON.stringify(result).includes('private'));
  const invalid = output.replaceAll(':152:1', ':0:1').replaceAll(':180:1', ':9007199254740992:1');
  assert.deepEqual(testFailureDiagnostics(invalid, ['execute-host.test.mjs']), []);
  assert.equal(testFailureDiagnostics(output.repeat(60), ['execute-host.test.mjs']).length, 100);
});

test('failed TAP diagnostics identify the actual assertion in real Node test output', t => {
  const root = temporary(t), file = join(root, 'synthetic.test.mjs');
  writeFileSync(file, "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('private-test-name', () => {\n  assert.equal('private-actual', 'private-expected');\n});\n");
  const result = command(['--test', '--test-reporter=tap', file], {cwd: root, env: {NODE_TEST_CONTEXT: undefined}});
  assert.equal(result.status, 'FAIL');
  const [failure] = testFailureDiagnostics(result.output, ['synthetic.test.mjs']);
  assert.equal(failure.code, 'ERR_ASSERTION'); assert.equal(failure.operator, 'strictEqual');
  assert.equal(failure.location.line, 3); assert.equal(failure.stackLocation.line, 4);
  assert(!JSON.stringify(failure).includes('private'));
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
/** A package root holding every file the contracts read, copied from this checkout. */
function contractRoot(t) {
  const root = temporary(t), source = new URL('../', import.meta.url);
  for (const file of ['package.json', 'npm-shrinkwrap.json', '.claude-plugin/plugin.json', 'examples/package.json', 'scripts/spikes/playwright-cli/package.json', 'scripts/managed-digests.json']) save(join(root, file), JSON.parse(readFileSync(new URL(file, source), 'utf8')));
  for (const file of ['VERSION', 'CHANGELOG.md']) writeFileSync(join(root, file), readFileSync(new URL(file, source)));
  return root;
}
test('package contracts reject version drift and missing published dependency locks', t => {
  const root = contractRoot(t); assert.equal(checkContracts(root).scenarios, 26);
  writeFileSync(join(root, 'VERSION'), '0.0.0'); assert.throws(() => checkContracts(root));
  assert(publicationFindings({files: ['package.json', 'npm-shrinkwrap.json'], unexpected: []}, ['package.json']).some(finding => finding.file === 'npm-shrinkwrap.json'));
});
test('package contracts reject a native CLI pin that differs between manifests', t => {
  const root = contractRoot(t);
  const examples = JSON.parse(readFileSync(join(root, 'examples/package.json'), 'utf8')); examples.devDependencies['@playwright/cli'] = '^0.1.18'; save(join(root, 'examples/package.json'), examples);
  assert.throws(() => checkContracts(root), /native CLI pin differs/);
});
test('package contracts require upgrade actions for the newest version and a recorded instruction block', t => {
  const root = contractRoot(t), changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8').replaceAll('\r\n', '\n'), version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  writeFileSync(join(root, 'CHANGELOG.md'), changelog.replace(`## ${version} `, '## 0.0.1 '));
  assert.throws(() => checkContracts(root), /newest CHANGELOG version heading/);
  const releaseStart = changelog.indexOf(`## ${version} `);
  writeFileSync(join(root, 'CHANGELOG.md'), changelog.slice(0, releaseStart) + changelog.slice(releaseStart).replace('### Upgrade actions', '### Notes'));
  assert.throws(() => checkContracts(root), /Upgrade actions/);
  writeFileSync(join(root, 'CHANGELOG.md'), `## Unreleased — next\n\n- Later work.\n\n${changelog}`); assert.equal(checkContracts(root).status, 'PASS');
  save(join(root, 'scripts/managed-digests.json'), {instructionBlocks: []});
  assert.throws(() => checkContracts(root), /managed instruction block/);
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
