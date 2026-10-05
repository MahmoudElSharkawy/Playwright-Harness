import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {cpSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, symlinkSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {execFile} from 'node:child_process';
import {fixture} from './fixtures/execution-core.mjs';

const command = (cwd, executable, args, env = process.env) => new Promise(resolve => {
  execFile(executable, args, {cwd, env, timeout: 60000, maxBuffer: 4 * 1024 * 1024}, (error, stdout, stderr) => resolve({status: error ? error.code : 0, stdout, stderr}));
});
const texts = directory => readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
  const path = join(directory, entry.name);
  return entry.isDirectory() ? texts(path) : /\.(?:json|txt)$/.test(entry.name) ? [readFileSync(path, 'utf8')] : [];
});

// Real native POM fixture proof, separate from M13 candidate/review attestations.
test('local schemas and disposable credentials survive two scoped processes, parallel isolation and failure cleanup', {timeout: 180000}, async t => {
  const f = fixture(t), root = f.roots.projectRoot, packageRoot = f.roots.packageRoot;
  cpSync(join(packageRoot, 'harness-tests/fixtures/disposable-consumer'), root, {recursive: true});
  for (const file of ['src/utils/ApiActions.ts', 'src/utils/Expects.ts', 'src/config/reporting.ts']) {
    mkdirSync(dirname(join(root, file)), {recursive: true});
    cpSync(join(packageRoot, 'examples', file), join(root, file));
  }
  symlinkSync(join(packageRoot, 'examples/node_modules'), join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  writeFileSync(join(root, 'package.json'), JSON.stringify({private: true, type: 'commonjs'}));
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({compilerOptions: {target: 'ES2021', module: 'NodeNext', moduleResolution: 'NodeNext', resolveJsonModule: true, strict: true, skipLibCheck: true, noEmit: true, types: ['node']}, include: ['src/**/*.ts', 'tests/**/*.ts']}));
  writeFileSync(join(root, 'playwright.config.mjs'), "export default {testDir:'./tests', fullyParallel:true, workers:2, retries:0, forbidOnly:true, use:{baseURL:process.env.DISPOSABLE_BASE_URL, trace:'off'}, outputDir:process.env.DISPOSABLE_ARTIFACTS+'/results', reporter:[['json',{outputFile:process.env.DISPOSABLE_ARTIFACTS+'/native.json'}],['allure-playwright',{resultsDir:process.env.DISPOSABLE_ARTIFACTS+'/allure-results'}]]};");

  const checked = await command(root, process.execPath, [join(packageRoot, 'scripts/check-conventions.mjs'), '--root', root, '--fail-on-warn', '--json']);
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  const compiled = await command(root, process.execPath, [join(packageRoot, 'examples/node_modules/typescript/bin/tsc'), '--project', join(root, 'tsconfig.json')]);
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
  assert(!existsSync(join(root, '.env')));
  const originalData = new Map(['CustomerAccess', 'CustomerLookup'].map(feature => {
    const path = join(root, 'resources/testData', feature + 'TestJsonFile.json');
    return [path, readFileSync(path, 'utf8')];
  }));

  // This is the synthetic application's private state, never a spec fixture/value source.
  const accounts = new Map(), registered = new Map(), audit = [];
  const digest = value => createHash('sha256').update(value ?? '').digest('hex');
  let nextId = 0, faultLogin = false, faultCreate = false;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    const credentialHash = digest(body.password), previous = registered.get(body.email);
    let status = 200, result = {responseCode: 200};
    if (request.method === 'POST' && request.url === '/accounts') {
      if (faultCreate) {status = 503; result = {responseCode: 503};}
      else if (accounts.has(body.email)) {status = 409; result = {responseCode: 409};}
      else {
        const account = {id: 'customer-' + (++nextId), credentialHash};
        accounts.set(body.email, account); registered.set(body.email, account);
        status = 201; result = {responseCode: 201, id: account.id};
      }
    } else if (request.method === 'POST' && request.url === '/login') {
      const valid = accounts.has(body.email) && previous?.credentialHash === credentialHash;
      status = faultLogin && valid ? 503 : valid ? 200 : 401; result = {responseCode: status};
    } else if (request.method === 'DELETE' && request.url === '/accounts') {
      if (!accounts.has(body.email)) {status = 404; result = {responseCode: 404};}
      else if (previous?.credentialHash !== credentialHash) {status = 401; result = {responseCode: 401};}
      else accounts.delete(body.email);
    } else if (request.method === 'GET' && request.url.startsWith('/accounts/')) {
      const found = [...accounts.values()].some(account => '/accounts/' + account.id === request.url);
      status = found ? 200 : 404; result = {responseCode: status};
    } else {status = 404; result = {responseCode: 404};}
    audit.push({method: request.method, path: request.url, email: body.email, credentialHash, status});
    response.writeHead(status, {'content-type': 'application/json'}); response.end(JSON.stringify(result));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = 'http://127.0.0.1:' + server.address().port;
  const cli = join(root, 'node_modules/@playwright/test/cli.js');

  for (const invocation of ['first', 'second', 'failure', 'creation-failure']) {
    faultLogin = invocation === 'failure';
    faultCreate = invocation === 'creation-failure';
    const failing = faultLogin || faultCreate;
    const directory = join(root, '.proof', invocation), start = audit.length;
    const env = {...process.env, DISPOSABLE_BASE_URL: url, DISPOSABLE_ARTIFACTS: directory, API_CONSOLE_LOGS: 'false', AUTO_ALLURE_OPEN: 'false'};
    const result = await command(root, process.execPath, [cli, 'test', '--config', 'playwright.config.mjs', ...(failing ? ['--grep', 'accepts owned credentials'] : [])], env);
    assert.equal(result.status, failing ? 1 : 0, result.stdout + result.stderr);
    const report = JSON.parse(readFileSync(join(directory, 'native.json'), 'utf8'));
    assert.equal(report.stats.expected, failing ? 0 : 3);
    assert.equal(report.stats.unexpected, failing ? 1 : 0);
    assert.equal(report.stats.flaky, 0); assert.equal(report.stats.skipped, 0);
    assert.equal(accounts.size, 0, 'Every owned account is removed, including after assertion failure.');
    const calls = audit.slice(start), creations = calls.filter(call => call.method === 'POST' && call.path === '/accounts' && call.status === 201);
    assert.equal(creations.length, faultCreate ? 0 : faultLogin ? 1 : 3);
    if (faultCreate) assert(!calls.some(call => call.method === 'DELETE'), 'No cleanup is registered for a rejected creation.');
    for (const creation of creations) {
      const related = calls.filter(call => call.email === creation.email);
      assert(related.some(call => call.method === 'DELETE' && call.status === 200), 'Required disposal executes.');
      assert.equal(related.filter(call => call.method === 'DELETE').length, 1, 'Successful in-test disposal cancels fallback cleanup.');
      assert(related.filter(call => call.method === 'DELETE').every(call => call.credentialHash === creation.credentialHash), 'Cleanup reuses the actual credential.');
      for (const login of related.filter(call => call.path === '/login')) {
        assert(login.status === 401 ? login.credentialHash !== creation.credentialHash : login.credentialHash === creation.credentialHash, 'Login preserves the intended actual/wrong credential relationship.');
      }
      const repeatDelete = await fetch(url + '/accounts', {method: 'DELETE', body: JSON.stringify({email: creation.email})});
      assert.equal(repeatDelete.status, 404, 'The backend rejects repeat disposal.');
    }
    const artifacts = texts(join(directory, 'allure-results'));
    const requests = artifacts.filter(text => text.includes('"body"')).map(text => JSON.parse(text));
    const credentialBodies = requests.map(request => request.body).filter(body => body && typeof body === 'object' && 'password' in body);
    assert(credentialBodies.length > 0, 'Native request attachments are captured.');
    assert(credentialBodies.every(body => body.password === '***'), 'Request attachments redact runtime credentials.');
    for (const [path, data] of originalData) assert.equal(readFileSync(path, 'utf8'), data);
    assert(!existsSync(join(root, '.env')));
  }
  const credentials = audit.filter(call => call.method === 'POST' && call.path === '/accounts' && call.status === 201).map(call => call.credentialHash);
  assert.equal(new Set(credentials).size, credentials.length, 'Credentials are isolated between tests and processes.');
});
