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
const nativeResults = suite => [
  ...(suite.specs ?? []).flatMap(spec => spec.tests.flatMap(item => item.results.map(result => ({title: spec.title, ...result})))),
  ...(suite.suites ?? []).flatMap(nativeResults),
];

// Real native POM proof, separate from M13 candidate/review attestations.
test('simple domain cleanup reconciles owned attempts and preserves foreign records after failures', {timeout: 240000}, async t => {
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
  assert.deepEqual(readdirSync(join(root, 'src/utils')).sort(), ['ApiActions.ts', 'Expects.ts'], 'This consumer needs only the existing technical facades, with no replacement lifecycle or telemetry utility.');
  for (const name of readdirSync(join(root, 'tests'))) {
    const source = readFileSync(join(root, 'tests', name), 'utf8');
    assert.match(source, /import\s*\{\s*test\s*\}\s*from\s*'@playwright\/test'/);
    assert.doesNotMatch(source, /sourceExpectation|harness:expectation:|\.extend\s*[<(]/);
    assert.doesNotMatch(source, /randomUUID|randomBytes|credentialBytes/);
  }
  const service = readFileSync(join(root, 'src/apis/ApisCustomers.ts'), 'utf8');
  assert.doesNotMatch(service, /sourceExpectation|sourceKey|harness:expectation:/);
  const originalData = new Map(['CustomerAccess', 'CustomerLookup', 'CustomerSession'].map(feature => {
    const path = join(root, 'resources/testData', feature + 'TestJsonFile.json');
    return [path, readFileSync(path, 'utf8')];
  }));
  const borrowedEmail = JSON.parse(originalData.get(join(root, 'resources/testData/CustomerAccessTestJsonFile.json'))).borrowedRegistration.email;

  // Synthetic application state only. The lookup's explicit 403 ownership proof is
  // this fake API's contract, not a general interpretation of authentication errors.
  const accounts = new Map(), registered = new Map(), audit = [];
  const digest = value => createHash('sha256').update(value ?? '').digest('hex');
  const borrowedAccount = {id: 'borrowed-customer', credentialHash: digest('<borrowed-fixture-password>')};
  accounts.set(borrowedEmail, borrowedAccount);
  let nextId = 0, fault = 'none';
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    const url = new URL(request.url, 'http://127.0.0.1');
    const email = body.email ?? url.searchParams.get('email');
    const credentialHash = digest(body.password ?? request.headers.authorization?.replace(/^Bearer /, ''));
    let status = 200, result = {responseCode: 200}, disconnect = false;
    if (request.method === 'POST' && url.pathname === '/accounts') {
      if (fault === 'foreign-collision') accounts.set(email, {id: 'foreign-customer', credentialHash: borrowedAccount.credentialHash});
      if (fault === 'rejected-create') {status = 503; result = {responseCode: 503};}
      else if (accounts.has(email)) {status = 409; result = {responseCode: 409};}
      else if (!email.includes('@') && fault !== 'negative-success') {status = 400; result = {responseCode: 400};}
      else {
        const account = {id: 'customer-' + (++nextId), credentialHash};
        accounts.set(email, account); registered.set(email, account);
        status = 201; result = {responseCode: 201, id: account.id};
        disconnect = fault === 'lost-response';
      }
    } else if (request.method === 'POST' && ['/login', '/sessions'].includes(url.pathname)) {
      const valid = accounts.get(email)?.credentialHash === credentialHash;
      const unavailable = url.pathname === '/sessions' ? fault === 'partial-setup' : ['login', 'login-and-delete'].includes(fault);
      status = unavailable && valid ? 503 : valid ? 200 : 401;
      result = {responseCode: status};
    } else if (request.method === 'DELETE' && url.pathname === '/accounts') {
      if (['delete', 'login-and-delete'].includes(fault)) {status = 503; result = {responseCode: 503};}
      else if (!accounts.has(email)) {status = 404; result = {responseCode: 404};}
      else if (accounts.get(email)?.credentialHash !== credentialHash) {status = 401; result = {responseCode: 401};}
      else if (fault !== 'retained-after-delete') accounts.delete(email);
    } else if (request.method === 'GET' && url.pathname === '/accounts') {
      status = fault === 'lookup' ? 503 : !accounts.has(email) ? 404 : accounts.get(email).credentialHash === credentialHash ? 200 : 403;
      result = {responseCode: status};
    } else if (request.method === 'GET' && url.pathname.startsWith('/accounts/')) {
      const found = [...accounts.values()].some(account => '/accounts/' + account.id === url.pathname);
      status = found ? 200 : 404; result = {responseCode: status};
    } else {status = 404; result = {responseCode: 404};}
    audit.push({method: request.method, path: url.pathname, email, credentialHash, status, disconnected: disconnect});
    if (disconnect) {response.destroy(); return;}
    if (fault === 'lookup-timeout' && request.method === 'GET' && url.pathname === '/accounts') return;
    response.writeHead(status, {'content-type': 'application/json'}); response.end(JSON.stringify(result));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = 'http://127.0.0.1:' + server.address().port;
  const cli = join(root, 'node_modules/@playwright/test/cli.js');
  const invocations = [
    {name: 'first', fault: 'none', created: 4},
    {name: 'second', fault: 'none', created: 4},
    {name: 'assertion-failure', fault: 'login', created: 1},
    {name: 'rejected-creation', fault: 'rejected-create', created: 0},
    {name: 'lost-response', fault: 'lost-response', created: 1},
    {name: 'unexpected-negative-success', fault: 'negative-success', created: 1, grep: 'rejects an invalid fresh'},
    {name: 'foreign-collision', fault: 'foreign-collision', created: 0},
    {name: 'partial-setup', fault: 'partial-setup', created: 1, grep: 'after session preparation'},
    {name: 'cleanup-delete-failure', fault: 'delete', created: 1, leftover: true},
    {name: 'body-and-cleanup-failure', fault: 'login-and-delete', created: 1, leftover: true, errors: 2},
    {name: 'cleanup-lookup-failure', fault: 'lookup', created: 1, leftover: true},
    {name: 'cleanup-absence-failure', fault: 'retained-after-delete', created: 1, leftover: true},
    {name: 'bounded-cleanup', fault: 'lookup-timeout', created: 1, leftover: true},
  ];

  for (const invocation of invocations) {
    fault = invocation.fault;
    const failing = fault !== 'none';
    const directory = join(root, '.proof', invocation.name), start = audit.length;
    const env = {...process.env, DISPOSABLE_BASE_URL: url, DISPOSABLE_ARTIFACTS: directory, API_CONSOLE_LOGS: 'false', AUTO_ALLURE_OPEN: 'false'};
    const result = await command(root, process.execPath, [cli, 'test', '--config', 'playwright.config.mjs', ...(failing ? ['--grep', invocation.grep ?? 'accepts owned credentials'] : [])], env);
    assert.equal(result.status, failing ? 1 : 0, invocation.name + '\n' + result.stdout + result.stderr);
    const report = JSON.parse(readFileSync(join(directory, 'native.json'), 'utf8'));
    const results = nativeResults(report);
    assert.equal(report.stats.expected, failing ? 0 : 6, invocation.name);
    assert.equal(report.stats.unexpected, failing ? 1 : 0, invocation.name);
    assert.equal(report.stats.flaky, 0); assert.equal(report.stats.skipped, 0);
    assert.deepEqual(accounts.get(borrowedEmail), borrowedAccount, 'Borrowed state survives every invocation.');
    const calls = audit.slice(start), creations = calls.filter(call => call.method === 'POST' && call.path === '/accounts' && call.status === 201);
    assert.equal(creations.length, invocation.created, invocation.name);
    assert(!calls.some(call => call.method === 'DELETE' && call.email === borrowedEmail), 'A borrowed negative input never becomes an owned cleanup candidate.');

    if (failing) {
      assert.equal(results[0].errors.length, invocation.errors ?? 1, invocation.name);
      if (invocation.errors === 2) {
        assert.match(results[0].errors[0].message, /the login HTTP status/);
        assert.match(results[0].errors[1].message, /the cleanup deletion HTTP status/);
      }
    } else {
      assert.equal(new Set(results.map(result => result.workerIndex)).size, 2, 'Independent native workers execute the fixture.');
    }
    if (fault === 'foreign-collision') {
      const conflict = calls.find(call => call.method === 'POST');
      assert.equal(accounts.get(conflict.email).id, 'foreign-customer');
      assert(calls.some(call => call.method === 'GET' && call.status === 403));
      assert(!calls.some(call => call.method === 'DELETE'), 'Ownership mismatch cannot delete the collision.');
      accounts.delete(conflict.email);
    }
    if (fault === 'rejected-create') {
      assert(!calls.some(call => call.method === 'DELETE'));
      assert(calls.some(call => call.method === 'GET' && call.status === 404), 'An uncertain attempted identity is reconciled as absent.');
    }
    if (fault === 'partial-setup') assert(!calls.some(call => call.path === '/login'), 'The failed setup prevents the body but not cleanup.');
    if (fault === 'lost-response') assert(creations[0].disconnected, 'The application committed before losing the response.');
    if (fault === 'lookup-timeout') {
      assert.match(results[0].errors[0].message, /Timeout 2000ms exceeded/);
      assert(results[0].duration < 10000, 'A bounded cleanup request does not consume the whole test timeout.');
    }

    for (const creation of creations) {
      const related = calls.filter(call => call.email === creation.email);
      assert(related.filter(call => call.method === 'DELETE').every(call => call.credentialHash === creation.credentialHash), 'Cleanup reuses the actual credential.');
      if (invocation.leftover) {
        assert(accounts.has(creation.email), 'A real cleanup failure remains observable.');
        accounts.delete(creation.email); // Test-server isolation after verifying the failed obligation.
      } else {
        assert(!accounts.has(creation.email), 'Owned records are absent after body, setup and transport failures.');
        assert.equal(related.filter(call => call.method === 'DELETE').length, 1, 'In-test disposal is not duplicated by teardown.');
        assert(related.some(call => call.method === 'GET' && call.status === 404), 'Cleanup confirms absence.');
        const firstLookup = related.findIndex(call => call.method === 'GET' && call.path === '/accounts');
        const scenarioDeleted = related.findIndex(call => call.method === 'DELETE') < firstLookup;
        assert.equal(related.filter(call => call.method === 'GET' && call.path === '/accounts').length, scenarioDeleted ? 1 : 2, 'Later tests never inherit a prior test\'s cleanup identity.');
      }
      for (const login of related.filter(call => call.path === '/login')) {
        assert(login.status === 401 ? login.credentialHash !== creation.credentialHash : login.credentialHash === creation.credentialHash, 'Login keeps the actual/wrong credential relationship.');
      }
    }
    assert.equal(accounts.size, 1, 'Only the original borrowed account remains.');

    const artifacts = texts(join(directory, 'allure-results'));
    const requests = artifacts.filter(text => text.includes('"body"')).map(text => JSON.parse(text));
    const credentialBodies = requests.map(request => request.body).filter(body => body && typeof body === 'object' && 'password' in body);
    assert(credentialBodies.length > 0, 'Native request attachments are captured.');
    assert(credentialBodies.every(body => body.password === '***'), 'Facade request attachments redact runtime credentials.');
    for (const request of requests.filter(item => item.headers?.authorization)) assert.equal(request.headers.authorization, '***');
    for (const [path, data] of originalData) assert.equal(readFileSync(path, 'utf8'), data);
    assert(!existsSync(join(root, '.env')));
  }
  const credentials = [...registered.values()].map(account => account.credentialHash);
  assert.equal(new Set(credentials).size, credentials.length, 'This synthetic ownership contract uses distinct case/attempt credentials.');
});
