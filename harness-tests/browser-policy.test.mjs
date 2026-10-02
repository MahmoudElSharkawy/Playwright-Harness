import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve, join} from 'node:path';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {syncBuiltinESMExports} from 'node:module';
import {createRun, defineOperation, authorizeOperation} from '../scripts/lib/execution-core/index.mjs';
import {browserLifecycleOperations, browserCapabilities} from '../scripts/lib/browser/index.mjs';
import {validateNativeArguments, classifyNative, prepareNativeSession, nativeCliInstallation} from '../scripts/lib/browser/native-cli.mjs';
import {processCall, expandTree} from '../scripts/lib/browser/processes.mjs';
import {within} from '../scripts/lib/skill-roots.mjs';
import {runInput, environment} from './fixtures/execution-core.mjs';
import {requiredBrowserChecks, completeBrowserChecks} from '../scripts/probes/browser-checks.mjs';

const env = mode => ({...environment(mode), browserTargets: ['app'], targets: {...environment().targets, browser: {app: {origins: ['https://app.example.test']}}}});
const browserOp = (capability = 'browserReads', source = 'inline') => defineOperation({id: 'observe', family: 'browser', capability, target: 'app', source: {kind: source, reference: 'fixture', version: '1.0.0'}, definition: {intent: 'Observe the application'}});
test('installed browser acceptance refuses missing, duplicate, unknown and failed native checks', () => {
  const checks = requiredBrowserChecks.map(name => ({name, status: 'PASS'}));
  assert.equal(completeBrowserChecks(checks), true);
  assert.equal(completeBrowserChecks(checks.slice(1)), false);
  assert.equal(completeBrowserChecks([...checks.slice(1), checks[1]]), false);
  assert.equal(completeBrowserChecks(checks.map((item, index) => index ? item : {...item, name: 'unknown'})), false);
  assert.equal(completeBrowserChecks(checks.map((item, index) => index ? item : {...item, status: 'INCOMPLETE'})), false);
});
async function removeFixture(root) {
  const actual = await fs.realpath(root), temporary = await fs.realpath(tmpdir());
  assert.ok(actual !== temporary && within(temporary, actual) && !(await fs.lstat(root)).isSymbolicLink());
  await fs.rm(actual, {recursive: true});
}
test('browser targets/capabilities freeze alongside existing API and database configuration', () => {
  const input = runInput({environment: env('test'), operations: [browserOp(), ...browserLifecycleOperations('app')]});
  const run = createRun(input); input.environment.targets.browser.app.origins[0] = 'https://other.example.test';
  assert.deepEqual(run.inputs.environment.targets.browser.app.origins, ['https://app.example.test']);
  assert.equal(authorizeOperation(run, browserOp(), browserCapabilities).allowed, true);
  assert.equal(authorizeOperation(run, browserOp(), []).reason, 'UNSUPPORTED_CAPABILITY');
});
for (const mode of ['protected', 'custom']) test(`${mode} browser mutation capability must be enabled explicitly`, () => {
  const op = browserOp('browserMutations'), config = env(mode);
  assert.equal(authorizeOperation(createRun(runInput({environment: config, operations: [op]})), op, browserCapabilities).allowed, false);
  config.capabilities.browserMutations = true;
  assert.equal(authorizeOperation(createRun(runInput({environment: config, operations: [op]})), op, browserCapabilities).allowed, true);
});
test('uncataloged browser intent can execute, while catalog sources cannot grant target access', () => {
  const op = browserOp('browserMutations', 'exploration'), run = createRun(runInput({environment: env('test'), operations: []}));
  assert.equal(authorizeOperation(run, op, browserCapabilities).allowed, true);
  const denied = env('test'); denied.browserTargets = [];
  const catalog = browserOp('browserReads', 'catalog');
  assert.equal(authorizeOperation(createRun(runInput({environment: denied, operations: [catalog]})), catalog, browserCapabilities).reason, 'TARGET_NOT_ENABLED');
});
test('browser origins are explicit destinations without credentials, wildcards, query strings or paths', () => {
  for (const origin of ['*', 'file:///tmp/page', 'https://' + 'user@' + 'app.example.test', 'https://app.example.test/path', 'https://app.example.test?value=1']) {
    const config = env('test'); config.targets.browser.app.origins = [origin]; assert.throws(() => createRun(runInput({environment: config})));
  }
});
test('native arguments remain native while ownership, profile, destinations and artifact paths are guarded', () => {
  const root = resolve('protected-fixture'), origins = ['https://app.example.test'];
  for (const args of [['goto', 'https://app.example.test/?a=one&b=two'], ['snapshot', '--filename=page.yml'], ['eval', 'document.title'], ['click', 'e7']]) assert.doesNotThrow(() => validateNativeArguments(args, root, origins));
  for (const args of [['kill-all'], ['close-all'], ['attach'], ['open'], ['show', '--kill'], ['show', '--port=0', '--host=0.0.0.0'], ['goto', 'https://other.example.test'], ['snapshot', '-s=other'], ['snapshot', '--config=other'], ['state-save', '../outside'], ['snapshot', '--filename=../outside'], ['run-code', '--filename', '../outside'], ['eval', '--raw']]) assert.throws(() => validateNativeArguments(args, root, origins));
});
test('native replies preserve timeout, cancellation, dispatch, error and malformed-output distinctions', () => {
  assert.equal(classifyNative({stdout: '{"result":"7"}', exitCode: 0, dispatched: true}).result, '7');
  for (const reply of [{stdout: '{}', exitCode: 1}, {stdout: '{"isError":true}', exitCode: 0}, {stdout: 'invalid', exitCode: 0}]) assert.throws(() => classifyNative(reply), /EXECUTOR/);
  for (const kind of ['TIMEOUT','CANCELLED']) assert.throws(() => classifyNative({kind, dispatched: true}), error => error.classification === kind && error.dispatched && error.interrupted);
  assert.throws(() => classifyNative({kind: 'SPAWN_FAILURE', dispatched: false}), error => error.classification === 'UNAVAILABLE' && !error.dispatched);
});
test('native child execution bounds output and supports cancellation without invoking a shell', async () => {
  const exact = await processCall(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', 'a & b'], {timeoutMs: 5000}); assert.equal(exact.stdout, 'a & b');
  const limited = await processCall(process.execPath, ['-e', 'process.stdout.write("x".repeat(10000))'], {timeoutMs: 5000, maxBytes: 100}); assert.equal(limited.kind, 'OUTPUT_LIMIT');
  const controller = new AbortController(); controller.abort();
  const cancelled = await processCall(process.execPath, ['-e', 'process.exit(9)'], {signal: controller.signal}); assert.equal(cancelled.kind, 'CANCELLED'); assert.equal(cancelled.dispatched, false);
});
test('owned process trees never adopt an older process through a reused parent PID', () => {
  // Windows keeps a dead parent's PID on its children; the daemon later reused PID 40.
  const daemon = {pid: 40, parent: 8, identity: '134041248000000005'};
  const all = [daemon, {pid: 41, parent: 40, identity: '134041248000000005'}, {pid: 42, parent: 41, identity: '134041248000000900'},
    {pid: 50, parent: 40, identity: '134041248000000004'}, {pid: 51, parent: 50, identity: '134041248000000950'}, {pid: 60, parent: 40, identity: null}];
  assert.deepEqual(expandTree(all, [daemon]).map(item => item.pid), [40, 41, 42]);
});

// A fake installed package laid out as npm installs it; versions are the proven pins.
async function fakeNativeInstallation(packageRoot, {cli = '0.1.22', playwright = '1.64.0-alpha-1790635538000'} = {}) {
  const manifests = {
    '': {name: 'playwright-pom-harness', version: '0.0.0'},
    'node_modules/@playwright/cli': {name: '@playwright/cli', version: cli},
    'node_modules/playwright': {name: 'playwright', version: playwright, exports: {'./package.json': './package.json'}},
    // The exported coreBundle target is deliberately absent, as in a damaged installation.
    'node_modules/playwright-core': {name: 'playwright-core', version: playwright, exports: {'./package.json': './package.json', './lib/coreBundle': './lib/coreBundle.js'}},
  };
  for (const [path, manifest] of Object.entries(manifests)) {
    await fs.mkdir(join(packageRoot, path), {recursive: true}); await fs.writeFile(join(packageRoot, path, 'package.json'), JSON.stringify(manifest));
  }
}

test('damaged native prerequisites fail before acquiring or copying private storage', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'harness-browser-prerequisite-'));
  try {
    const packageRoot = join(root, 'package'), projectRoot = join(root, 'consumer'), runRoot = join(projectRoot, 'run');
    await fs.mkdir(projectRoot); await fakeNativeInstallation(packageRoot);
    const storageState = join(projectRoot, 'synthetic-state.json'); await fs.writeFile(storageState, '{"cookies":[],"origins":[]}');
    await assert.rejects(prepareNativeSession({packageRoot, projectRoot, runRoot}, {origins: ['https://app.example.test'], storageState}), {code: 'MODULE_NOT_FOUND'});
    await assert.rejects(fs.stat(runRoot), {code: 'ENOENT'});
  } finally {await removeFixture(root);}
});

test('a native CLI graph other than the proven pins is refused', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'harness-browser-pins-'));
  try {
    await fakeNativeInstallation(root, {playwright: '1.64.0'});
    assert.throws(() => nativeCliInstallation(root), /exact proven native CLI graph/);
  } finally {await removeFixture(root);}
});

test('the installed native CLI resolves from the package location', async () => {
  const installation = nativeCliInstallation(resolve('.'));
  for (const file of [installation.executable, installation.coreBundle, installation.installer]) assert.equal((await fs.stat(file)).isFile(), true);
});

test('post-copy preparation failure removes only newly acquired private storage and reports remediation status', async () => {
  const projectRoot = await fs.mkdtemp(join(tmpdir(), 'harness-browser-rollback-')), runRoot = join(projectRoot, 'run');
  const storageState = join(projectRoot, 'synthetic-state.json'), original = fs.copyFile;
  await fs.writeFile(storageState, '{"cookies":[],"origins":[]}');
  fs.copyFile = async (...args) => {await original(...args); throw new Error('Injected post-copy failure');}; syncBuiltinESMExports();
  try {
    await assert.rejects(prepareNativeSession({packageRoot: resolve('.'), projectRoot, runRoot}, {origins: ['https://app.example.test'], storageState}), error => {
      assert.deepEqual(error.preparation, {storageAcquired: true, privateStorageRemoved: true, remediationRequired: false}); assert.equal(error.cause.message, 'Injected post-copy failure'); assert.equal(JSON.stringify(error).includes('Injected post-copy failure'), false); return true;
    });
    await assert.rejects(fs.stat(runRoot), {code: 'ENOENT'});
    assert.equal(await fs.readFile(storageState, 'utf8'), '{"cookies":[],"origins":[]}');
  } finally {fs.copyFile = original; syncBuiltinESMExports(); await removeFixture(projectRoot);}
});

test('failed preparation rollback reports retained private storage without losing the original cause', async () => {
  const projectRoot = await fs.mkdtemp(join(tmpdir(), 'harness-browser-remediation-')), runRoot = join(projectRoot, 'run');
  const storageState = join(projectRoot, 'synthetic-state.json'), copy = fs.copyFile, remove = fs.rm;
  await fs.writeFile(storageState, '{"cookies":[],"origins":[]}');
  fs.copyFile = async (...args) => {await copy(...args); throw new Error('Injected acquisition failure');};
  fs.rm = async () => {throw new Error('Injected removal failure');}; syncBuiltinESMExports();
  try {
    await assert.rejects(prepareNativeSession({packageRoot: resolve('.'), projectRoot, runRoot}, {origins: ['https://app.example.test'], storageState}), error => {
      assert.deepEqual(error.preparation, {storageAcquired: true, privateStorageRemoved: false, remediationRequired: true});
      assert.equal(error.cause.message, 'Injected acquisition failure'); assert.match(error.message, /requires remediation/); return true;
    });
    assert.equal(await fs.readFile(join(runRoot, 'protected/restored-state.json'), 'utf8'), '{"cookies":[],"origins":[]}');
  } finally {fs.copyFile = copy; fs.rm = remove; syncBuiltinESMExports(); await removeFixture(projectRoot);}
});
